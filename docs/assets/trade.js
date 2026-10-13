/* HIM Dynasty trade center: calculator, builder, and idea generator.
   Values from data/trade.json; logic in trade-engine.js. Names are set with
   textContent only. */
(() => {
  "use strict";
  const { el, dot, teamLink, assignColors } = window.HIM;

  let data, E, byId, labelToId;
  const calc = { A: [], B: [] };
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
    document.querySelectorAll(".tool").forEach((s) => { s.hidden = s.id !== `tool-${tab}`; });
    document.querySelectorAll("[data-tab]").forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle("is-current", on);
      b.setAttribute("aria-selected", String(on));
    });
    if (push) writeHash(tab);
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
  // Calculator
  // ------------------------------------------------------------------ //
  function renderCalc() {
    for (const side of ["A", "B"]) {
      const box = document.querySelector(`.side-box[data-side="${side}"]`);
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
      box.querySelector(".side-total").textContent = calc[side].length
        ? `Raw total ${fmtNum(calc[side].reduce((s, id) => s + byId[id].value, 0))}` : "";
    }

    const out = document.getElementById("calc-result");
    out.replaceChildren();
    if (!calc.A.length || !calc.B.length) {
      out.appendChild(el("p", "Add at least one asset to each side.", "muted"));
      return;
    }
    const r = E.compare(calc.A.map((id) => byId[id]), calc.B.map((id) => byId[id]));
    out.appendChild(el("div", r.verdict.label, "verdict"));
    out.appendChild(meter(r.verdict.lean));
    const grid = el("div", null, "result-grid");
    for (const [label, raw, adj] of [["Side A sends", r.rawA, r.adjA], ["Side B sends", r.rawB, r.adjB]]) {
      const c = el("div", null, "stat");
      c.appendChild(el("div", label, "label"));
      c.appendChild(el("div", fmtNum(adj), "value"));
      c.appendChild(el("div", `league-adjusted · raw ${fmtNum(raw)}`, "owner"));
      grid.appendChild(c);
    }
    out.appendChild(grid);
    const gap = Math.abs(r.adjA - r.adjB);
    if (r.verdict.label !== "Fair") {
      r.notes.push(`${r.adjA > r.adjB ? "Side B" : "Side A"} would need to add about ${fmtNum(gap)} in adjusted value to even it out.`);
    }
    if (r.notes.length) out.appendChild(notesList(r.notes));
  }

  function setupCalc() {
    const dl = document.getElementById("all-assets");
    labelToId = {};
    const sorted = data.assets.filter((a) => a.value > 0).sort((a, b) => b.value - a.value);
    for (const a of sorted) {
      const label = assetLabel(a);
      if (labelToId[label]) continue;
      labelToId[label] = a.id;
      const o = document.createElement("option");
      o.value = label;
      dl.appendChild(o);
    }
    document.querySelectorAll(".side-box[data-side] .search").forEach((input) => {
      const side = input.closest(".side-box").dataset.side;
      const add = () => {
        const id = labelToId[input.value];
        if (!id) return;
        if (!calc.A.includes(id) && !calc.B.includes(id)) calc[side].push(id);
        input.value = "";
        renderCalc();
      };
      input.addEventListener("change", add);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
    });
    renderCalc();
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
    writeHash("build");
    const out = document.getElementById("build-result");
    out.replaceChildren();
    const A = team(build.a), B = team(build.b);
    const give = [...build.ga].map((id) => byId[id]).filter(Boolean);
    const get = [...build.gb].map((id) => byId[id]).filter(Boolean);
    if (!give.length || !get.length) {
      out.appendChild(el("p", "Check at least one asset on each side.", "muted"));
      return;
    }
    const ev = E.evaluate(A, B, give, get);
    out.appendChild(el("div", ev.verdict.label, "verdict"));
    out.appendChild(meter(ev.verdict.lean));
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
    if (!ev.verdict.label.includes("Fair")) {
      const aheadIsA = ev.dA - ev.dB > 0;
      const fromTeam = aheadIsA ? A : B;
      const taken = aheadIsA ? build.ga : build.gb;
      const candidates = fromTeam.assets.filter((a) => !taken.has(a.id) && a.value > 0 && a.pos !== "K" && a.pos !== "DEF");
      const scored = candidates.map((a) => {
        const g = aheadIsA ? give.concat([a]) : give;
        const r = aheadIsA ? get : get.concat([a]);
        const e2 = E.evaluate(A, B, g, r);
        return { a, gap: Math.abs(e2.dA - e2.dB), ok: e2.dA > -50 && e2.dB > -50 };
      }).filter((x) => x.ok).sort((x, y) => x.gap - y.gap).slice(0, 3);
      if (scored.length) {
        const box = el("div", null, "balance");
        box.appendChild(el("span", `To even it out, ${fromTeam.name} could add: `, "muted"));
        for (const s of scored) {
          const b = el("button", `${s.a.name} (${fmtNum(s.a.value)})`, "chip");
          b.type = "button";
          b.addEventListener("click", () => { taken.add(s.a.id); renderRosterPick(aheadIsA ? "A" : "B"); renderBuildResult(); });
          box.appendChild(b);
        }
        out.appendChild(box);
      }
    }
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
    build.a = params.get("a") && data.teams[params.get("a")] ? params.get("a") : ids[0];
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
      const me = team(rid);
      const others = Object.keys(data.teams).filter((r) => r !== rid).map(team);
      const results = E.ideas(me, others, {
        pos: document.getElementById("idea-pos").value,
        goal: document.getElementById("idea-goal").value,
      });
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
        card.appendChild(el("div", `Your roster ${signed(r.ev.dA)} · theirs ${signed(r.ev.dB)} · ${r.ev.verdict.label}`, "small"));
        const why = r.ev.notes.filter((n) => n.includes("would start") || n.includes("younger") || n.includes("older")).slice(0, 2);
        if (why.length) card.appendChild(notesList(why));
        const b = el("button", "Open in builder", "chip");
        b.type = "button";
        b.addEventListener("click", () => openInBuilder(rid, r.other.rid, r.give, r.get));
        card.appendChild(b);
        grid.appendChild(card);
      }
      out.appendChild(grid);
    }, 30);
  }

  function setupIdeas() {
    fillTeamSelect(document.getElementById("idea-team"), Object.keys(data.teams)[0]);
    document.getElementById("idea-go").addEventListener("click", runIdeas);
  }

  // ------------------------------------------------------------------ //
  // Load
  // ------------------------------------------------------------------ //
  async function load() {
    try {
      const [trade, latest] = await Promise.all([
        fetch("data/trade.json", { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
        window.HIM.loadData().catch(() => null),
      ]);
      data = trade;
      if (latest) assignColors(latest.standings.map((t) => t.roster_id));
    } catch (err) {
      document.getElementById("updated").textContent = `Trade values appear after the next data update (${err.message}).`;
      return;
    }
    E = window.TradeEngine(data.format);
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
    setupCalc();
    setupBuild(params);
    setupIdeas();
    document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
    showTab(tab, false);
  }

  load();
})();
