/* HIM Dynasty trade center: calculator, builder, and idea generator.
   Values from data/trade.json; logic in trade-engine.js. Names are set with
   textContent only. */
(() => {
  "use strict";
  const { el, dot, teamLink, assignColors } = window.HIM;

  let data, E, S, byId, latest;
  let me = null;
  let baseline = null;
  const ME_KEY = "him-me";
  const calc = { a: null, b: null, A: [], B: [] };
  const build = { a: null, b: null, ga: new Set(), gb: new Set() };

  const fmtNum = (n) => Math.round(n).toLocaleString();
  const signed = (n) => `${n >= 0 ? "+" : "−"}${fmtNum(Math.abs(n))}`;
  const teamName = (rid) => (data.teams[rid] ? data.teams[rid].team.trim() : `Team ${rid}`);

  function team(rid) {
    rid = String(rid);
    return {
      rid,
      name: teamName(rid),
      mode: data.teams[rid].mode,
      assets: data.assets.filter((a) => String(a.owner) === rid),
    };
  }

  function assetMeta(a) {
    if (a.kind === "pick") {
      if (a.generic) return "Generic pick value";
      const via = a.owner !== null && a.original !== a.owner ? `via ${a.original_team.trim()}` : "own pick";
      return a.slot ? `${via} · projected slot` : via;
    }
    return [a.pos, a.age ? `${a.age.toFixed ? a.age.toFixed(1) : a.age} yrs` : null, a.nfl,
      a.owner !== null && a.owner !== undefined ? teamName(a.owner) : "Not in league"].filter(Boolean).join(" · ");
  }

  function assetLabel(a) {
    if (a.kind === "pick") return a.generic ? a.name : `${a.name} · ${a.original_team.trim()}`;
    return `${a.name} (${a.pos}${a.nfl ? ", " + a.nfl : ""})`;
  }

  function meter(lean) {
    const m = el("div", null, "meter");
    const fill = el("div", null, "meter-fill");
    const pct = Math.abs(lean) * 50;
    fill.style.width = `${pct}%`;
    if (lean < 0) fill.style.right = "50%";
    else fill.style.left = "50%";
    m.appendChild(fill);
    m.appendChild(el("div", null, "meter-mid"));
    return m;
  }

  function oddsTile(label, pair, goodWhenUp = true) {
    const [b, a] = pair;
    const d = a - b;
    const box = el("div", null, "stat odds-tile");
    box.appendChild(el("div", label, "label"));
    box.appendChild(el("div", `${a.toFixed(1)}%`, "value"));
    const cls = Math.abs(d) < 0.3 ? "muted" : (d > 0) === goodWhenUp ? "up" : "down";
    box.appendChild(el("div", `${b.toFixed(1)}% → ${a.toFixed(1)}%  (${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)})`, `owner ${cls}`));
    return box;
  }

  function oddsBlock(title, rid, side, primary) {
    const wrap = el("div", null, primary ? "odds-block primary" : "odds-block");
    const head = el("div", null, "odds-head");
    head.appendChild(dot(Number(rid)));
    head.appendChild(el("span", title, "team"));
    const w = side.weekly;
    head.appendChild(el("span", `lineup ${w >= 0 ? "+" : "−"}${Math.abs(w).toFixed(1)} pts/week`, `owner ${w > 0.2 ? "up" : w < -0.2 ? "down" : ""}`));
    wrap.appendChild(head);
    const tiles = el("div", null, "odds-tiles");
    const rebuilding = data.teams[rid] && data.teams[rid].mode === "rebuilder";
    tiles.append(oddsTile("Playoff odds", side.playoff), oddsTile("Title odds", side.champ),
      oddsTile("#1 pick odds", side.first, rebuilding));
    wrap.appendChild(tiles);
    return wrap;
  }

  function getBaseline() {
    if (!baseline && S) baseline = S.run({}, 4000);
    return baseline;
  }

  function notesList(notes) {
    const ul = el("ul", null, "notes");
    notes.forEach((n) => ul.appendChild(el("li", n)));
    return ul;
  }

  // ------------------------------------------------------------------ //
  // Tabs and URL state
  // ------------------------------------------------------------------ //
  function readHash() {
    const raw = location.hash.replace(/^#/, "");
    const [tab, ...rest] = raw.split("&");
    const params = new URLSearchParams(rest.join("&"));
    return { tab: ["calc", "build", "ideas"].includes(tab) ? tab : "calc", params };
  }

  function showTab(tab, push = true) {
    document.querySelectorAll(".tool").forEach((sec) => { sec.hidden = sec.id !== `tool-${tab}`; });
    document.querySelectorAll("[data-tab]").forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle("is-current", on);
      b.setAttribute("aria-selected", String(on));
    });
    if (push) {
      if (tab === "calc") writeCalcHash(); else writeHash(tab);
    }
  }

  function writeHash(tab) {
    let h = `#${tab}`;
    if (tab === "build" && build.a) {
      const p = new URLSearchParams({ a: build.a, b: build.b });
      if (build.ga.size) p.set("ga", [...build.ga].join(","));
      if (build.gb.size) p.set("gb", [...build.gb].join(","));
      h += "&" + p.toString();
    }
    history.replaceState(null, "", h);
  }

  // ------------------------------------------------------------------ //
  // Shared result: odds for both teams, fair meter, roster change, notes
  // ------------------------------------------------------------------ //
  function renderTradeResult(out, A, B, give, get, onAdd) {
    out.replaceChildren();
    if (!give.length && !get.length) {
      out.appendChild(el("p", "Add assets to either side to see how the trade moves both teams.", "muted"));
      return;
    }
    if (S) {
      const imp = S.impact(A, B, give, get, 4000, getBaseline());
      const odds = el("div", null, "odds-pair");
      odds.appendChild(oddsBlock(A.rid === me ? `You (${A.name})` : A.name, A.rid, imp.a, A.rid === me || B.rid !== me));
      odds.appendChild(oddsBlock(B.rid === me ? `You (${B.name})` : B.name, B.rid, imp.b, B.rid === me));
      out.appendChild(odds);
    }
    if (!give.length || !get.length) {
      out.appendChild(el("p", `${!give.length ? A.name : B.name} isn't sending anything yet. Add assets to both sides for the fair meter.`, "muted"));
      return;
    }
    const ev = E.evaluate(A, B, give, get);
    out.appendChild(el("div", ev.verdict.label, "verdict"));
    out.appendChild(meter(ev.verdict.lean));
    const ends = el("div", null, "meter-ends");
    ends.append(el("span", `◀ Favors ${A.name}`), el("span", "Fair"), el("span", `Favors ${B.name} ▶`));
    out.appendChild(ends);
    const grid = el("div", null, "result-grid");
    for (const [t, d, before, after, lineup, sends, gets] of [
      [A, ev.dA, ev.aBefore, ev.aAfter, ev.lineupA, ev.rawGive, ev.rawGet],
      [B, ev.dB, ev.bBefore, ev.bAfter, ev.lineupB, ev.rawGet, ev.rawGive],
    ]) {
      const c = el("div", null, "stat");
      const head = el("div", null, "teamcell");
      head.appendChild(dot(Number(t.rid)));
      head.appendChild(teamLink(Number(t.rid), t.name));
      c.appendChild(head);
      c.appendChild(el("div", signed(d), `value ${d >= 0 ? "up" : "down"}`));
      c.appendChild(el("div", `roster value ${fmtNum(before)} → ${fmtNum(after)}`, "owner"));
      c.appendChild(el("div", `starting lineup ${signed(lineup)} · sends ${fmtNum(sends)} raw, gets ${fmtNum(gets)} raw`, "owner"));
      grid.appendChild(c);
    }
    out.appendChild(grid);
    if (ev.notes.length) out.appendChild(notesList(ev.notes));

    // Balancing suggestions: one more asset from the team that is ahead.
    if (!ev.verdict.label.includes("Fair") && onAdd) {
      const aheadIsA = ev.dA - ev.dB > 0;
      const fromTeam = aheadIsA ? A : B;
      const taken = new Set((aheadIsA ? give : get).map((a) => a.id));
      const scored = fromTeam.assets
        .filter((a) => !taken.has(a.id) && a.value > 0 && a.pos !== "K" && a.pos !== "DEF")
        .map((a) => {
          const e2 = E.evaluate(A, B, aheadIsA ? give.concat([a]) : give, aheadIsA ? get : get.concat([a]));
          return { a, gap: Math.abs(e2.dA - e2.dB), ok: e2.dA > -50 && e2.dB > -50 };
        })
        .filter((x) => x.ok).sort((x, y) => x.gap - y.gap).slice(0, 3);
      if (scored.length) {
        const box = el("div", null, "balance");
        box.appendChild(el("span", `To even it out, ${fromTeam.name} could add: `, "muted"));
        for (const sc of scored) {
          const b = el("button", `${sc.a.name} (${fmtNum(sc.a.value)})`, "chip");
          b.type = "button";
          b.addEventListener("click", () => onAdd(aheadIsA ? "A" : "B", sc.a.id));
          box.appendChild(b);
        }
        out.appendChild(box);
      }
    }
  }

  // ------------------------------------------------------------------ //
  // Calculator: pick a team per side, add that team's assets from a dropdown
  // ------------------------------------------------------------------ //
  const ADD_GROUPS = [["QB", "Quarterbacks"], ["RB", "Running backs"], ["WR", "Wide receivers"], ["TE", "Tight ends"],
    ["K", "Kickers"], ["DEF", "Defenses"], ["PICK", "Draft picks"]];

  function calcTeam(side) { return side === "A" ? calc.a : calc.b; }

  function fillAddSelect(select, side) {
    const t = team(calcTeam(side));
    const added = new Set(calc[side]);
    select.replaceChildren();
    const first = el("option", `+ Add from ${t.name}…`);
    first.value = "";
    select.appendChild(first);
    for (const [pos, title] of ADD_GROUPS) {
      const items = t.assets.filter((a) => a.pos === pos && !added.has(a.id)).sort((a, b) => b.value - a.value);
      if (!items.length) continue;
      const g = document.createElement("optgroup");
      g.label = title;
      for (const a of items) {
        const bits = a.kind === "pick" ? [a.name, a.original !== a.owner ? `via ${a.original_team.trim()}` : null]
          : [a.name, a.age ? `${a.age} yrs` : null, a.nfl];
        const o = el("option", `${bits.filter(Boolean).join(" · ")} — ${fmtNum(a.value)}`);
        o.value = a.id;
        g.appendChild(o);
      }
      select.appendChild(g);
    }
    select.value = "";
  }

  function renderCalc() {
    for (const side of ["A", "B"]) {
      const box = document.querySelector(`.side-box[data-side="${side}"]`);
      box.querySelector(".calc-team").value = calcTeam(side);
      box.querySelector(".mode").textContent = modeLine(calcTeam(side));
      fillAddSelect(box.querySelector(".calc-add"), side);
      const list = box.querySelector(".asset-list");
      list.replaceChildren();
      for (const id of calc[side]) {
        const a = byId[id];
        const li = el("li", null, "asset");
        const info = el("div");
        info.appendChild(el("div", a.name, "team"));
        info.appendChild(el("div", assetMeta(a), "owner"));
        li.appendChild(info);
        li.appendChild(el("span", fmtNum(a.value), "num"));
        const x = el("button", "×", "remove");
        x.type = "button";
        x.setAttribute("aria-label", `Remove ${a.name}`);
        x.addEventListener("click", () => { calc[side] = calc[side].filter((v) => v !== id); renderCalc(); });
        li.appendChild(x);
        list.appendChild(li);
      }
      if (!calc[side].length) list.appendChild(el("li", "Nothing added yet.", "muted small empty-side"));
      box.querySelector(".side-total").textContent = calc[side].length
        ? `${calc[side].length} asset${calc[side].length > 1 ? "s" : ""} · raw value ${fmtNum(calc[side].reduce((s2, id) => s2 + byId[id].value, 0))}` : "";
    }
    writeCalcHash();
    renderTradeResult(document.getElementById("calc-result"), team(calc.a), team(calc.b),
      calc.A.map((id) => byId[id]), calc.B.map((id) => byId[id]),
      (side, id) => { calc[side].push(id); renderCalc(); });
  }

  function writeCalcHash() {
    if (document.getElementById("tool-calc").hidden) return;
    const p = new URLSearchParams({ a: calc.a, b: calc.b });
    if (calc.A.length) p.set("ga", calc.A.join(","));
    if (calc.B.length) p.set("gb", calc.B.join(","));
    history.replaceState(null, "", `#calc&${p.toString()}`);
  }

  function setCalcTeam(side, rid) {
    const other = side === "A" ? "B" : "A";
    if (rid === calcTeam(other)) {
      // Picking the other side's team swaps the two sides.
      [calc.a, calc.b] = [calc.b, calc.a];
      [calc.A, calc.B] = [calc.B, calc.A];
    } else {
      if (side === "A") calc.a = rid; else calc.b = rid;
      calc[side] = [];
    }
    if (side === "A" || calc.a === rid) setMe(calc.a, false);
    renderCalc();
  }

  function setupCalc(params, isCalc) {
    const ids = Object.keys(data.teams);
    calc.a = isCalc && data.teams[params.get("a")] ? params.get("a") : (me || ids[0]);
    calc.b = isCalc && data.teams[params.get("b")] && params.get("b") !== calc.a ? params.get("b") : ids.find((x) => x !== calc.a);
    const owned = (rid) => (id) => byId[id] && String(byId[id].owner) === String(rid);
    calc.A = isCalc ? (params.get("ga") || "").split(",").filter(owned(calc.a)) : [];
    calc.B = isCalc ? (params.get("gb") || "").split(",").filter(owned(calc.b)) : [];
    for (const side of ["A", "B"]) {
      const box = document.querySelector(`.side-box[data-side="${side}"]`);
      const teamSel = box.querySelector(".calc-team");
      fillTeamSelect(teamSel, calcTeam(side));
      teamSel.addEventListener("change", () => setCalcTeam(side, teamSel.value));
      const add = box.querySelector(".calc-add");
      add.addEventListener("change", () => {
        if (add.value && !calc[side].includes(add.value)) calc[side].push(add.value);
        renderCalc();
      });
    }
    renderCalc();
  }

  function openInCalc(a, b, give, get) {
    calc.a = String(a); calc.b = String(b);
    calc.A = give.map((x) => x.id); calc.B = get.map((x) => x.id);
    showTab("calc", false);
    renderCalc();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ------------------------------------------------------------------ //
  // Builder
  // ------------------------------------------------------------------ //
  const GROUPS = [["QB", "QB"], ["RB", "RB"], ["WR", "WR"], ["TE", "TE"], ["PICK", "Draft picks"]];

  function modeLine(rid) {
    const t = data.teams[rid];
    const label = { contender: "Contender", rebuilder: "Rebuilder", middle: "In the middle" }[t.mode];
    return `${label} · ${t.playoff_odds.toFixed(0)}% playoff odds · avg age ${t.avg_age ?? "—"} · value rank #${t.value_rank}`;
  }

  function renderRosterPick(side) {
    const key = side === "A" ? "a" : "b";
    const chosen = side === "A" ? build.ga : build.gb;
    const box = document.querySelector(`.side-box[data-team="${side}"]`);
    box.querySelector(".mode").textContent = modeLine(build[key]);
    const t = team(build[key]);
    const starters = E.lineup(t.assets.filter((a) => a.kind === "player"));
    const host = box.querySelector(".roster-pick");
    host.replaceChildren();
    for (const [pos, title] of GROUPS) {
      const items = t.assets.filter((a) => a.pos === pos).sort((a, b) => b.value - a.value);
      if (!items.length) continue;
      host.appendChild(el("div", title, "group-title"));
      for (const a of items) {
        const row = el("label", null, "pick-row");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = chosen.has(a.id);
        cb.addEventListener("change", () => {
          if (cb.checked) chosen.add(a.id); else chosen.delete(a.id);
          renderBuildResult();
        });
        row.appendChild(cb);
        const info = el("span", null, "pick-row-info");
        const name = el("span", a.name, "team");
        info.appendChild(name);
        if (starters.has(a.id)) info.appendChild(el("span", "S", "starter-tag"));
        info.appendChild(el("span", a.kind === "pick" ? assetMeta(a) : [a.age ? `${a.age} yrs` : null, a.nfl].filter(Boolean).join(" · "), "owner"));
        row.appendChild(info);
        row.appendChild(el("span", fmtNum(a.value), "num"));
        host.appendChild(row);
      }
    }
  }

  function renderBuildResult() {
    if (!document.getElementById("tool-build").hidden) writeHash("build");
    renderTradeResult(document.getElementById("build-result"), team(build.a), team(build.b),
      [...build.ga].map((id) => byId[id]).filter(Boolean), [...build.gb].map((id) => byId[id]).filter(Boolean),
      (side, id) => { (side === "A" ? build.ga : build.gb).add(id); renderRosterPick(side); renderBuildResult(); });
  }

  function fillTeamSelect(select, value) {
    select.replaceChildren();
    for (const rid of Object.keys(data.teams).sort((x, y) => teamName(x).localeCompare(teamName(y)))) {
      const o = document.createElement("option");
      o.value = rid;
      o.textContent = teamName(rid);
      select.appendChild(o);
    }
    select.value = value;
  }

  function setupBuild(params) {
    const ids = Object.keys(data.teams);
    build.a = params.get("a") && data.teams[params.get("a")] ? params.get("a") : (me || ids[0]);
    build.b = params.get("b") && data.teams[params.get("b")] && params.get("b") !== build.a ? params.get("b") : ids.find((x) => x !== build.a);
    (params.get("ga") || "").split(",").filter((id) => byId[id]).forEach((id) => build.ga.add(id));
    (params.get("gb") || "").split(",").filter((id) => byId[id]).forEach((id) => build.gb.add(id));

    for (const side of ["A", "B"]) {
      const select = document.querySelector(`.side-box[data-team="${side}"] select`);
      fillTeamSelect(select, side === "A" ? build.a : build.b);
      select.addEventListener("change", () => {
        const key = side === "A" ? "a" : "b";
        const other = side === "A" ? "b" : "a";
        if (select.value === build[other]) {
          build[other] = build[key];
          document.querySelector(`.side-box[data-team="${side === "A" ? "B" : "A"}"] select`).value = build[other];
          build.ga.clear(); build.gb.clear();
        } else {
          (side === "A" ? build.ga : build.gb).clear();
        }
        build[key] = select.value;
        if (side === "A") setMe(select.value, false);
        renderRosterPick("A");
        renderRosterPick("B");
        renderBuildResult();
      });
    }
    renderRosterPick("A");
    renderRosterPick("B");
    renderBuildResult();
  }

  function openInBuilder(a, b, give, get) {
    build.a = String(a); build.b = String(b);
    build.ga = new Set(give.map((x) => x.id)); build.gb = new Set(get.map((x) => x.id));
    document.querySelector('.side-box[data-team="A"] select').value = build.a;
    document.querySelector('.side-box[data-team="B"] select').value = build.b;
    renderRosterPick("A");
    renderRosterPick("B");
    renderBuildResult();
    showTab("build");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ------------------------------------------------------------------ //
  // Ideas
  // ------------------------------------------------------------------ //
  function runIdeas() {
    const rid = document.getElementById("idea-team").value;
    const out = document.getElementById("idea-results");
    out.replaceChildren(el("p", "Searching every team for trades that help both sides…", "muted"));
    setTimeout(() => {
      const meTeam = team(rid);
      const others = Object.keys(data.teams).filter((r) => r !== rid).map(team);
      const goal = document.getElementById("idea-goal").value;
      let results = E.ideas(meTeam, others, { pos: document.getElementById("idea-pos").value, goal, limit: 40 });
      if (S) {
        const base = getBaseline();
        const mode = data.teams[rid].mode;
        for (const r of results) {
          r.imp = S.impact(meTeam, r.other, r.give, r.get, 1500, null);
          const a = r.imp.a;
          const dP = a.playoff[1] - a.playoff[0], dC = a.champ[1] - a.champ[0], dF = a.first[1] - a.first[0];
          const v = r.ev.dA / 500;
          if (goal === "win") r.rank = dP + 2 * dC + v;
          else if (goal === "picks" || goal === "younger") r.rank = dF - 0.25 * dP + v;
          else if (mode === "contender") r.rank = dP + 2 * dC + v;
          else if (mode === "rebuilder") r.rank = dF + v;
          else r.rank = dP + dC + 0.5 * dF + v;
        }
        void base;
        results.sort((x, y) => y.rank - x.rank);
      }
      results = results.slice(0, 15);
      out.replaceChildren();
      if (!results.length) {
        out.appendChild(el("p", "No trades found that help both teams with these filters. Try another target or goal.", "muted"));
        return;
      }
      const grid = el("div", null, "ideas");
      for (const r of results) {
        const card = el("article", null, "idea");
        const head = el("div", null, "teamcell");
        head.appendChild(dot(Number(r.other.rid)));
        head.appendChild(teamLink(Number(r.other.rid), r.other.name));
        head.appendChild(el("span", ` · ${data.teams[r.other.rid].mode}`, "owner"));
        card.appendChild(head);
        const swap = el("div", null, "swap");
        const col = (title, list) => {
          const c = el("div");
          c.appendChild(el("div", title, "group-title"));
          for (const a of list) {
            const row = el("div", null, "swap-row");
            row.appendChild(el("span", a.name, "team"));
            row.appendChild(el("span", a.kind === "pick" ? "" : ` ${a.pos}`, "owner"));
            row.appendChild(el("span", fmtNum(a.value), "num muted"));
            c.appendChild(row);
          }
          return c;
        };
        swap.appendChild(col("You give", r.give));
        swap.appendChild(col("You get", r.get));
        card.appendChild(swap);
        if (r.imp) {
          const a = r.imp.a;
          const fmtD = (p) => `${p[1] - p[0] >= 0 ? "+" : "−"}${Math.abs(p[1] - p[0]).toFixed(1)}`;
          const odds = el("div", null, "idea-odds");
          odds.append(el("span", `Playoff ${fmtD(a.playoff)}`), el("span", `Title ${fmtD(a.champ)}`), el("span", `#1 pick ${fmtD(a.first)}`));
          card.appendChild(odds);
        }
        card.appendChild(el("div", `Roster value: yours ${signed(r.ev.dA)} · theirs ${signed(r.ev.dB)} · ${r.ev.verdict.label}`, "small muted"));
        const why = r.ev.notes.filter((n) => n.includes("would start") || n.includes("younger") || n.includes("older")).slice(0, 2);
        if (why.length) card.appendChild(notesList(why));
        const actions = el("div", null, "idea-actions");
        const b = el("button", "Open in calculator", "chip");
        b.type = "button";
        b.addEventListener("click", () => openInCalc(rid, r.other.rid, r.give, r.get));
        const b2 = el("button", "Open in builder", "chip");
        b2.type = "button";
        b2.addEventListener("click", () => openInBuilder(rid, r.other.rid, r.give, r.get));
        actions.append(b, b2);
        card.appendChild(actions);
        grid.appendChild(card);
      }
      out.appendChild(grid);
    }, 30);
  }

  function setMe(rid, rerender = true) {
    me = String(rid);
    try { localStorage.setItem(ME_KEY, me); } catch (e) { /* storage off: still works this visit */ }
    const sel = document.getElementById("me");
    if (sel.value !== me) sel.value = me;
    const ideaSel = document.getElementById("idea-team");
    if (ideaSel && ideaSel.value !== me) ideaSel.value = me;
    if (rerender) {
      if (build.a !== me) {
        if (build.b === me) build.b = build.a;
        build.a = me;
        build.ga.clear(); build.gb.clear();
        document.querySelector('.side-box[data-team="A"] select').value = build.a;
        document.querySelector('.side-box[data-team="B"] select').value = build.b;
        renderRosterPick("A");
        renderRosterPick("B");
        renderBuildResult();
      }
      if (calc.a !== me) {
        if (calc.b === me) { calc.b = calc.a; calc.B = []; }
        calc.a = me;
        calc.A = [];
      }
      renderCalc();
    }
  }

  function setupMe() {
    let saved = null;
    try { saved = localStorage.getItem(ME_KEY); } catch (e) { saved = null; }
    me = saved && data.teams[saved] ? saved : Object.keys(data.teams)[0];
    const sel = document.getElementById("me");
    fillTeamSelect(sel, me);
    sel.addEventListener("change", () => setMe(sel.value));
  }

  function setupIdeas() {
    fillTeamSelect(document.getElementById("idea-team"), me);
    document.getElementById("idea-team").addEventListener("change", (e) => setMe(e.target.value));
    document.getElementById("idea-go").addEventListener("click", runIdeas);
  }

  // ------------------------------------------------------------------ //
  // Load
  // ------------------------------------------------------------------ //
  async function load() {
    try {
      const [trade, latestData] = await Promise.all([
        fetch("data/trade.json", { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
        window.HIM.loadData().catch(() => null),
      ]);
      data = trade;
      latest = latestData;
      if (latest) assignColors(latest.standings.map((t) => t.roster_id));
    } catch (err) {
      document.getElementById("updated").textContent = `Trade values appear after the next data update (${err.message}).`;
      return;
    }
    E = window.TradeEngine(data.format);
    S = latest && latest.sim ? window.TradeSim(latest.sim, data.format) : null;
    byId = Object.fromEntries(data.assets.map((a) => [a.id, a]));
    const f = data.format;
    document.getElementById("updated").textContent =
      `${f.superflex ? "Superflex" : "1-QB"} · ${Object.entries(f.starters).filter(([k]) => k !== "K" && k !== "DEF").map(([k, v]) => `${v} ${k}`).join(", ")} · values as of ${data.source.scrape_date}`;
    const src = document.getElementById("source-note");
    src.append("Player and pick values: ");
    const a = el("a", "DynastyProcess");
    a.href = data.source.url;
    a.rel = "noopener";
    src.append(a, ` (${f.superflex ? "superflex" : "1-QB"} values, updated weekly). League picks use each team's projected slot. Team windows come from playoff odds: 55%+ contender, 25% or less rebuilder.`);

    const { tab, params } = readHash();
    setupMe();
    setupCalc(params, tab === "calc");
    setupBuild(tab === "build" ? params : new URLSearchParams());
    setupIdeas();
    document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
    showTab(tab, false);
  }

  load();
})();
