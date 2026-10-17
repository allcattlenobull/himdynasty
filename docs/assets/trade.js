/* HIM Dynasty trade center: calculator, builder, and idea generator.
   Values from data/trade.json; logic in trade-engine.js. Names are set with
   textContent only. */
(() => {
  "use strict";
  const { el, dot, teamLink, assignColors, shareButton, playerButton } = window.HIM;

  let data, E, S, byId, latest, historyData;
  let me = null;
  let baseline = null;
  let stale = null; // note for a shared link whose players moved; shown on first render only
  const ME_KEY = "him-me";
  const calc = { a: null, b: null, A: [], B: [] };
  const build = { a: null, b: null, ga: new Set(), gb: new Set() };
  const guide = { target: null };

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

  function managerForRid(rid) {
    if (!historyData) return null;
    return Object.values(historyData.managers || {}).find((x) => String(x.current_rid) === String(rid)) || null;
  }

  function tendencyFor(rid) {
    const m = managerForRid(rid);
    return m && m.tendencies && m.tendencies.deals >= 2 ? m.tendencies : null;
  }

  function tendencyAlignment(rid, receives, sends) {
    const t = tendencyFor(rid);
    if (!t) return { score: 0, tendency: null, notes: [] };
    const value = (items) => items.reduce((sum, a) => sum + Math.max(a.value || 0, 1), 0);
    const players = receives.filter((a) => a.kind === "player" && Number.isFinite(a.age));
    const playerValue = value(players);
    const youngness = playerValue ? players.reduce((sum, a) => {
      const q = a.age <= 23 ? 1 : a.age <= 24 ? 0.7 : a.age <= 25 ? 0.4 : a.age <= 26 ? 0 : a.age <= 27 ? -0.25 : a.age <= 28 ? -0.55 : -1;
      return sum + q * Math.max(a.value || 0, 1);
    }, 0) / playerValue : 0;
    const sentValue = value(sends);
    const receivedValue = value(receives);
    const pickCost = sentValue ? value(sends.filter((a) => a.kind === "pick")) / sentValue : 0;
    const pickReturn = receivedValue ? value(receives.filter((a) => a.kind === "pick")) / receivedValue : 0;
    const youth = 2.5 * t.youth_lean * youngness;
    const picks = 3 * t.pick_send_lean * pickCost + 1.5 * t.pick_receive_lean * pickReturn;
    const position = playerValue ? players.reduce((sum, a) => sum + (t.position_leans && t.position_leans[a.pos] || 0) * Math.max(a.value || 0, 1), 0) / playerValue * 1.5 : 0;
    const productiveCut = { QB: 18, RB: 12, WR: 12, TE: 9 };
    const production = playerValue ? players.reduce((sum, a) => {
      const proven = productiveCut[a.pos] && (a.ppg || 0) >= productiveCut[a.pos] ? 1 : (a.ppg || 0) > 0 ? -0.35 : -0.7;
      return sum + proven * Math.max(a.value || 0, 1);
    }, 0) / playerValue * (t.production_chase_lean || 0) * 1.5 : 0;
    const receivedPieces = receives.filter((a) => a.kind !== "faab").length;
    const sentPieces = sends.filter((a) => a.kind !== "faab").length;
    const structure = receivedPieces === sentPieces ? 0 : (sentPieces > receivedPieces ? 1 : -1) * (t.package_lean || 0) * 1.4;
    const firstCost = sends.some((a) => a.kind === "pick" && a.round === 1) ? (t.first_send_lean || 0) * 1.2 : 0;
    const size = Math.max(value(receives), value(sends));
    const dealSize = size >= 5000 ? (t.large_deal_lean || 0) * 0.8 : 0;
    let timing = 0;
    const week = latest && latest.league ? latest.league.nfl_week : null;
    if (week && week >= 10 && t.timing_label === "Deadline mover") timing = 0.35;
    else if ((!week || latest.league.status !== "in_season") && t.timing_label === "Offseason trader") timing = 0.35;
    const score = Math.max(-4, Math.min(4, youth + picks + position + production + structure + firstCost + dealSize + timing));
    const notes = [];
    if (Math.abs(youth) >= 0.45) notes.push(youth > 0 ? "The return matches this manager’s history of targeting youth." : "The player age mix runs against this manager’s past trades.");
    if (pickCost >= 0.2 && Math.abs(t.pick_send_lean) >= 0.2) notes.push(t.pick_send_lean > 0 ? "This manager has been willing to move picks." : "This manager has historically protected their picks.");
    if (pickReturn >= 0.2 && t.pick_receive_lean >= 0.2) notes.push("This manager has frequently acquired picks in past deals.");
    if (Math.abs(position) >= 0.35 && t.preferred_position) notes.push(position > 0 ? `This return matches a history of targeting ${t.preferred_position}.` : "The positions offered do not match this manager’s usual targets.");
    if (Math.abs(production) >= 0.35) notes.push(production > 0 ? `The return matches this manager’s ${t.production_label.toLowerCase()} history.` : `The return runs against this manager’s ${t.production_label.toLowerCase()} history.`);
    if (Math.abs(structure) >= 0.35) notes.push(structure > 0 ? `The package matches this manager’s ${t.package_label.toLowerCase()} habit.` : `The package shape runs against this manager’s ${t.package_label.toLowerCase()} history.`);
    return { score, tendency: t, notes };
  }

  function tendencyFit(result) {
    return tendencyAlignment(result.other.rid, result.give, result.get);
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

  function assetNameNode(a, className = "team") {
    return a.kind === "player" ? playerButton(a.id, a.name, className, a) : el("span", a.name, className);
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

  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const factorText = (label, points) => `${label} ${points > 0 ? "+" : points < 0 ? "−" : ""}${Math.abs(points)}`;

  function competitionFactor(t, side) {
    if (!side) return { points: 0, detail: "Season model unavailable" };
    const dPlayoff = side.playoff[1] - side.playoff[0];
    const dChamp = side.champ[1] - side.champ[0];
    const dFirst = side.first[1] - side.first[0];
    let raw;
    if (t.mode === "contender") raw = 0.65 * dPlayoff + 1.1 * dChamp + 0.35 * side.weekly;
    else if (t.mode === "rebuilder") raw = 0.65 * dFirst - 0.25 * dPlayoff;
    else raw = 0.6 * dPlayoff + 0.8 * dChamp + 0.25 * side.weekly;
    const points = Math.round(clamp(raw, -15, 15));
    const detail = t.mode === "rebuilder"
      ? `Rebuilder fit: #1 pick odds ${dFirst >= 0 ? "+" : "−"}${Math.abs(dFirst).toFixed(1)}`
      : `${t.mode === "contender" ? "Contender" : "Competitive"} fit: playoffs ${dPlayoff >= 0 ? "+" : "−"}${Math.abs(dPlayoff).toFixed(1)} · title ${dChamp >= 0 ? "+" : "−"}${Math.abs(dChamp).toFixed(1)}`;
    return { points, detail };
  }

  function acceptanceEstimate(t, receives, sends, gain, otherGain, ev, impact) {
    const scale = Math.max(ev.rawGive, ev.rawGet, 1);
    const fairRaw = (0.65 * gain + 0.35 * (gain - otherGain)) / scale;
    const fairness = Math.round(clamp(fairRaw * 55, -25, 25));
    const competition = competitionFactor(t, impact);
    const historyFit = tendencyAlignment(t.rid, receives, sends);
    const tendency = Math.round(clamp(historyFit.score * 3, -12, 12));
    const chance = Math.round(clamp(50 + fairness + competition.points + tendency, 5, 95));
    const label = chance >= 70 ? "Likely" : chance >= 45 ? "Toss-up" : "Long shot";
    return { chance, label, fairness, competition, tendency, historyFit };
  }

  function acceptancePanel(A, B, give, get, ev, imp) {
    const box = el("section", null, "acceptance-box");
    box.appendChild(el("div", "Estimated manager acceptance", "group-title"));
    box.appendChild(el("p", "Based on fairness, competitive fit, and each manager’s completed-trade tendencies. This is an estimate—not the manager’s actual answer.", "small muted acceptance-note"));
    const grid = el("div", null, "acceptance-grid");
    const rows = [
      [A, get, give, ev.dA, ev.dB, imp && imp.a],
      [B, give, get, ev.dB, ev.dA, imp && imp.b],
    ];
    for (const [t, receives, sends, gain, otherGain, impact] of rows) {
      const estimate = acceptanceEstimate(t, receives, sends, gain, otherGain, ev, impact);
      const card = el("article", null, `acceptance-card ${estimate.chance >= 70 ? "likely" : estimate.chance >= 45 ? "toss" : "long"}`);
      const head = el("div", null, "acceptance-head");
      const name = el("div", null, "teamcell");
      name.append(dot(Number(t.rid)), teamLink(Number(t.rid), t.name));
      head.append(name, el("span", estimate.label, "acceptance-label"));
      card.appendChild(head);
      card.appendChild(el("div", `${estimate.chance}%`, "acceptance-pct"));
      const track = el("div", null, "acceptance-track");
      const fill = el("span");
      fill.style.width = `${estimate.chance}%`;
      track.appendChild(fill);
      track.setAttribute("role", "progressbar");
      track.setAttribute("aria-label", `${t.name} estimated acceptance`);
      track.setAttribute("aria-valuenow", String(estimate.chance));
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", "100");
      card.appendChild(track);
      const factors = el("div", null, "acceptance-factors");
      for (const [label, points] of [["Fairness", estimate.fairness], ["Competition", estimate.competition.points], ["Tendencies", estimate.tendency]]) {
        factors.appendChild(el("span", factorText(label, points), points > 0 ? "up" : points < 0 ? "down" : "muted"));
      }
      card.appendChild(factors);
      card.appendChild(el("p", estimate.competition.detail, "owner"));
      const hist = estimate.historyFit.tendency;
      card.appendChild(el("p", hist ? `Past ${hist.deals} trades: ${hist.youth_label.toLowerCase()} · ${hist.production_label.toLowerCase()} · ${hist.pick_label.toLowerCase()} · ${hist.position_label.toLowerCase()} · ${hist.package_label.toLowerCase()}` : "Not enough completed trades for a tendency score.", "owner"));
      grid.appendChild(card);
    }
    box.appendChild(grid);
    return box;
  }

  // ------------------------------------------------------------------ //
  // Tabs and URL state
  // ------------------------------------------------------------------ //
  function readHash() {
    const raw = location.hash.replace(/^#/, "");
    const [tab, ...rest] = raw.split("&");
    const params = new URLSearchParams(rest.join("&"));
    return { tab: ["calc", "build", "ideas", "guide"].includes(tab) ? tab : "calc", params };
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
    } else if (tab === "guide" && guide.target) {
      h += `&m=${encodeURIComponent(guide.target)}`;
    }
    history.replaceState(null, "", h);
  }

  // ------------------------------------------------------------------ //
  // Shared result: odds for both teams, fair meter, roster change, notes
  // ------------------------------------------------------------------ //
  function lineupNotes(A, B, imp) {
    const box = el("div", null, "season-box");
    box.appendChild(el("div", "This season's starting lineups", "group-title"));
    const ul = el("ul", null, "notes");
    let changed = false;
    for (const [t, side] of [[A, imp.a], [B, imp.b]]) {
      const { in: ins, out: outs } = side.starters;
      if (!ins.length && !outs.length) {
        ul.appendChild(el("li", `${t.name}: no change to the projected starting lineup.`));
        continue;
      }
      changed = true;
      const fmtP = (a) => `${a.name} (${(a.proj || 0).toFixed(1)}/wk${a.injury ? `, ${a.injury}` : ""})`;
      const parts = [];
      if (ins.length) parts.push(`in: ${ins.map(fmtP).join(", ")}`);
      if (outs.length) parts.push(`out: ${outs.map(fmtP).join(", ")}`);
      ul.appendChild(el("li", `${t.name} ${parts.join(" · ")} → ${side.weekly >= 0 ? "+" : "−"}${Math.abs(side.weekly).toFixed(1)} pts/week.`));
    }
    box.appendChild(ul);
    if (!changed) {
      box.appendChild(el("p", "Neither team's projected starting lineup changes this season, so playoff, title, and #1 pick odds stay where they are. This trade is about long-term dynasty value; the fair meter below covers that.", "muted small"));
    }
    return box;
  }

  /* Ways to even a lopsided trade: the team that's ahead adds one asset, or the
     team that's overpaying takes one asset back. */
  function evenOptions(A, B, give, get) {
    const ev = E.evaluate(A, B, give, get);
    const gap0 = ev.dA - ev.dB;
    const aheadIsA = gap0 > 0;
    const opts = [];
    const addFrom = aheadIsA ? A : B;
    const sending = new Set((aheadIsA ? give : get).map((a) => a.id));
    const tryAdd = (extra) => {
      const e2 = aheadIsA ? E.evaluate(A, B, give.concat(extra), get) : E.evaluate(A, B, give, get.concat(extra));
      return { gap: Math.abs(e2.dA - e2.dB), label: e2.verdict.label };
    };
    const singles = [];
    for (const a of addFrom.assets) {
      if (sending.has(a.id) || !(a.value > 0) || a.pos === "K" || a.pos === "DEF") continue;
      const r = tryAdd([a]);
      singles.push({ kind: "add", side: aheadIsA ? "A" : "B", team: addFrom, assets: [a], gap: r.gap, label: r.label });
    }
    opts.push(...singles);
    // If no single asset gets it to fair, try two-piece packages from the most useful candidates.
    if (!singles.some((o) => o.label.includes("Fair"))) {
      const pool = singles.slice().sort((x, y) => x.gap - y.gap).slice(0, 14).map((o) => o.assets[0]);
      for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          const r = tryAdd([pool[i], pool[j]]);
          opts.push({ kind: "add", side: aheadIsA ? "A" : "B", team: addFrom, assets: [pool[i], pool[j]], gap: r.gap, label: r.label });
        }
      }
    }
    const behindList = aheadIsA ? get : give;
    if (behindList.length > 1) {
      for (const a of behindList) {
        const e2 = aheadIsA ? E.evaluate(A, B, give, get.filter((x) => x.id !== a.id)) : E.evaluate(A, B, give.filter((x) => x.id !== a.id), get);
        opts.push({ kind: "remove", side: aheadIsA ? "B" : "A", team: aheadIsA ? B : A, assets: [a], gap: Math.abs(e2.dA - e2.dB), label: e2.verdict.label });
      }
    }
    // Fair results first, then the smallest remaining gap; prefer fewer pieces on ties.
    const fair = (o) => (o.label.includes("Fair") ? 0 : 1);
    return opts.filter((o) => o.gap < Math.abs(gap0) * 0.7)
      .sort((x, y) => fair(x) - fair(y) || x.assets.length - y.assets.length || x.gap - y.gap)
      .slice(0, 4);
  }

  function renderTradeResult(out, A, B, give, get, onAdd, onRemove) {
    out.replaceChildren();
    if (stale && out.id === stale.id) {
      if (stale.shown) stale = null;
      else { stale.shown = true; out.appendChild(el("p", stale.text, "trade-stale")); }
    }
    if (!give.length && !get.length) {
      out.appendChild(el("p", "Add assets to either side to see how the trade moves both teams.", "muted"));
      return;
    }
    // Share this exact trade: the link carries both teams and every asset.
    const bar = el("div", null, "trade-share");
    const summary = `${A.name} sends ${give.map((x) => x.name).join(", ") || "nothing"} · ${B.name} sends ${get.map((x) => x.name).join(", ") || "nothing"}`;
    bar.append(el("span", summary, "owner"), shareButton(() => location.href, () => `HIM Dynasty trade: ${summary}`, "Share trade"));
    out.appendChild(bar);
    let imp = null;
    if (S) {
      imp = S.impact(A, B, give, get, 4000, getBaseline());
      const odds = el("div", null, "odds-pair");
      odds.appendChild(oddsBlock(A.name, A.rid, imp.a, true));
      odds.appendChild(oddsBlock(B.name, B.rid, imp.b, true));
      out.appendChild(odds);
      if (give.length || get.length) out.appendChild(lineupNotes(A, B, imp));
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
    if (out.id === "build-result") out.appendChild(acceptancePanel(A, B, give, get, ev, imp));
    if (ev.notes.length) out.appendChild(notesList(ev.notes));

    // How to even it
    if (!ev.verdict.label.includes("Fair") && onAdd) {
      const opts = evenOptions(A, B, give, get);
      const box = el("div", null, "even-box");
      box.appendChild(el("div", "How to even it", "group-title"));
      if (!opts.length) {
        box.appendChild(el("p", "No single add or removal gets this close to fair. Try swapping a bigger piece.", "muted small"));
      }
      for (const o of opts) {
        const names = o.assets.map((a) => `${a.name} (${fmtNum(a.value)})`).join(" + ");
        const text = o.kind === "add" ? `${o.team.name} adds ${names}` : `${o.team.name} takes back ${names}`;
        const b = el("button", null, "even-option");
        b.type = "button";
        b.appendChild(el("span", text, "team"));
        b.appendChild(el("span", `→ ${o.label}`, "owner"));
        b.addEventListener("click", () => {
          if (o.kind === "add") o.assets.forEach((a, i) => onAdd(o.side, a.id, i < o.assets.length - 1));
          else onRemove(o.side, o.assets[0].id);
        });
        box.appendChild(b);
      }
      out.insertBefore(box, out.querySelector(".result-grid"));
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
        info.appendChild(assetNameNode(a));
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
      (side, id, defer) => { if (!calc[side].includes(id)) calc[side].push(id); if (!defer) renderCalc(); },
      (side, id) => { calc[side] = calc[side].filter((x) => x !== id); renderCalc(); });
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

  function noteStale(n, id) {
    if (n > 0) stale = { id, shown: false, text:  `${n} item${n > 1 ? "s" : ""} in this shared link ${n > 1 ? "have" : "has"} moved to another roster since it was sent, so ${n > 1 ? "they were" : "it was"} left out.` };
  }

  function setupCalc(params, isCalc) {
    const ids = Object.keys(data.teams);
    calc.a = isCalc && data.teams[params.get("a")] ? params.get("a") : (me || ids[0]);
    calc.b = isCalc && data.teams[params.get("b")] && params.get("b") !== calc.a ? params.get("b") : ids.find((x) => x !== calc.a);
    const owned = (rid) => (id) => byId[id] && String(byId[id].owner) === String(rid);
    const wantA = isCalc ? (params.get("ga") || "").split(",").filter(Boolean) : [];
    const wantB = isCalc ? (params.get("gb") || "").split(",").filter(Boolean) : [];
    calc.A = wantA.filter(owned(calc.a));
    calc.B = wantB.filter(owned(calc.b));
    noteStale(wantA.length + wantB.length - calc.A.length - calc.B.length, "calc-result");
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
    const starters = E.lineup(t.assets.filter((a) => a.kind === "player"), t.mode);
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
        const name = assetNameNode(a);
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
      (side, id, defer) => { (side === "A" ? build.ga : build.gb).add(id); if (!defer) { renderRosterPick(side); renderBuildResult(); } },
      (side, id) => { (side === "A" ? build.ga : build.gb).delete(id); renderRosterPick(side); renderBuildResult(); });
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
    const owns = (rid) => (id) => byId[id] && String(byId[id].owner) === String(rid);
    const wantA = (params.get("ga") || "").split(",").filter(Boolean);
    const wantB = (params.get("gb") || "").split(",").filter(Boolean);
    wantA.filter(owns(build.a)).forEach((id) => build.ga.add(id));
    wantB.filter(owns(build.b)).forEach((id) => build.gb.add(id));
    noteStale(wantA.length + wantB.length - build.ga.size - build.gb.size, "build-result");

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
      let results = E.ideas(meTeam, others, { pos: document.getElementById("idea-pos").value, goal, limit: 45 });
      let dropped = 0;
      if (S) {
        const base = getBaseline();
        const mode = data.teams[rid].mode;
        // A trade only "helps both sides" if the other team's season survives it:
        // contenders and middle teams can't lose real playoff or title odds.
        results = results.filter((r) => {
          r.imp = S.impact(meTeam, r.other, r.give, r.get, 1200, null);
          const b = r.imp.b;
          const om = data.teams[r.other.rid].mode;
          const dP = b.playoff[1] - b.playoff[0], dC = b.champ[1] - b.champ[0];
          const hurts = om === "rebuilder"
            ? false
            : dP <= -5 || dC <= -Math.max(1.5, 0.15 * b.champ[0]);
          if (hurts) dropped++;
          return !hurts;
        });
        for (const r of results) {
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
      results.forEach((r, i) => {
        r.fit = tendencyFit(r);
        r.rank = (Number.isFinite(r.rank) ? r.rank : -i * 0.15) + r.fit.score;
      });
      results.sort((x, y) => y.rank - x.rank);
      results = results.slice(0, 15);
      out.replaceChildren();
      if (!results.length) {
        out.appendChild(el("p", `No trades found that help both teams with these filters${dropped ? ` (${dropped} were left out because they'd sink the other team's season)` : ""}. Try another target or goal.`, "muted"));
        return;
      }
      if (dropped) out.appendChild(el("p", `${dropped} trade${dropped === 1 ? " was" : "s were"} left out because ${dropped === 1 ? "it" : "they"} would cost the other team real playoff or title odds.`, "note"));
      const grid = el("div", null, "ideas");
      for (const r of results) {
        const card = el("article", null, "idea");
        const head = el("div", null, "teamcell");
        head.appendChild(dot(Number(r.other.rid)));
        head.appendChild(teamLink(Number(r.other.rid), r.other.name));
        head.appendChild(el("span", ` · ${data.teams[r.other.rid].mode}`, "owner"));
        card.appendChild(head);
        if (r.fit.tendency) {
          const t = r.fit.tendency;
          card.appendChild(el("div", `Past ${t.deals} trades · ${t.youth_label} · ${t.production_label} · ${t.pick_label} · ${t.position_label} · ${t.package_label}`, "idea-tendency"));
        }
        const swap = el("div", null, "swap");
        const col = (title, list) => {
          const c = el("div");
          c.appendChild(el("div", title, "group-title"));
          for (const a of list) {
            const row = el("div", null, "swap-row");
            row.appendChild(assetNameNode(a));
            row.appendChild(el("span", a.kind === "pick" ? "" : ` ${a.pos}`, "owner"));
            row.appendChild(el("span", fmtNum(a.value), "num muted"));
            c.appendChild(row);
          }
          return c;
        };
        swap.appendChild(col(`${teamName(rid)} gives`, r.give));
        swap.appendChild(col(`${teamName(rid)} gets`, r.get));
        card.appendChild(swap);
        if (r.imp) {
          const fmtD = (p) => `${p[1] - p[0] >= 0 ? "+" : "−"}${Math.abs(p[1] - p[0]).toFixed(1)}`;
          for (const [nm, side] of [[teamName(rid), r.imp.a], [r.other.name, r.imp.b]]) {
            const odds = el("div", null, "idea-odds");
            odds.appendChild(el("span", nm.trim(), "idea-odds-team"));
            odds.append(el("span", `Playoff ${fmtD(side.playoff)}`), el("span", `Title ${fmtD(side.champ)}`), el("span", `#1 pick ${fmtD(side.first)}`));
            card.appendChild(odds);
          }
        }
        card.appendChild(el("div", `Roster value: ${teamName(rid)} ${signed(r.ev.dA)} · ${r.other.name} ${signed(r.ev.dB)} · ${r.ev.verdict.label}`, "small muted"));
        const why = [];
        if (r.imp && r.imp.a.starters.in.length) why.push(`${r.imp.a.starters.in.map((a) => a.name).join(", ")} would start for ${teamName(rid)} this season.`);
        why.push(...r.fit.notes.slice(0, 2 - why.length));
        why.push(...r.ev.notes.filter((n) => n.includes("younger") || n.includes("older") || n.includes("QBs")).slice(0, 2 - why.length));
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

  // ------------------------------------------------------------------ //
  // Manager guide
  // ------------------------------------------------------------------ //
  const GUIDE_POSITIONS = ["QB", "RB", "WR", "TE"];
  const GUIDE_DEPTH = { QB: 2, RB: 4, WR: 5, TE: 2 };

  function positionRanks(rid) {
    const scores = {};
    for (const pos of GUIDE_POSITIONS) {
      scores[pos] = {};
      for (const id of Object.keys(data.teams)) {
        const vals = team(id).assets.filter((a) => a.kind === "player" && a.pos === pos).map((a) => a.value).sort((a, b) => b - a);
        scores[pos][id] = vals.slice(0, GUIDE_DEPTH[pos]).reduce((sum, v, i) => sum + v * (1 - i * 0.1), 0);
      }
    }
    const out = {};
    for (const pos of GUIDE_POSITIONS) {
      const order = Object.keys(scores[pos]).sort((a, b) => scores[pos][b] - scores[pos][a]);
      out[pos] = { rank: order.indexOf(String(rid)) + 1, value: Math.round(scores[pos][String(rid)] || 0) };
    }
    return out;
  }

  function guideAssetRow(asset, reason, target, side) {
    const row = el("div", null, "guide-asset");
    const info = el("div", null, "guide-asset-info");
    info.appendChild(assetNameNode(asset));
    info.appendChild(el("div", reason, "owner"));
    row.appendChild(info);
    row.appendChild(el("span", fmtNum(asset.value), "num"));
    const add = el("button", "Use in Builder", "chip");
    add.type = "button";
    add.addEventListener("click", () => {
      build.a = String(me);
      build.b = String(target);
      build.ga.clear(); build.gb.clear();
      (side === "A" ? build.ga : build.gb).add(asset.id);
      document.querySelector('.side-box[data-team="A"] select').value = build.a;
      document.querySelector('.side-box[data-team="B"] select').value = build.b;
      renderRosterPick("A"); renderRosterPick("B"); renderBuildResult();
      showTab("build");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    row.appendChild(add);
    return row;
  }

  function guideCandidates(fromRid, targetRid, direction) {
    const t = tendencyFor(targetRid);
    const targetRanks = positionRanks(targetRid);
    const myRanks = positionRanks(fromRid);
    const sourceRanks = positionRanks(direction === "offer" ? fromRid : targetRid);
    const assets = team(direction === "offer" ? fromRid : targetRid).assets
      .filter((a) => a.value >= 150 && a.pos !== "K" && a.pos !== "DEF");
    return assets.map((asset) => {
      let score = Math.log10(Math.max(asset.value, 10));
      const reasons = [];
      if (direction === "offer") {
        if (asset.kind === "pick") {
          score += 2 * (t ? t.pick_receive_lean : 0) + (data.teams[targetRid].mode === "rebuilder" ? 1.5 : 0);
          if (t && t.pick_receive_lean > 0.2) reasons.push("frequently acquires picks");
          if (data.teams[targetRid].mode === "rebuilder") reasons.push("fits a rebuild");
        } else {
          const need = targetRanks[asset.pos];
          score += (need.rank - 6.5) * 0.35 + (t && t.position_leans ? t.position_leans[asset.pos] * 2.5 : 0);
          if (need.rank >= 8) reasons.push(`fills their #${need.rank} ${asset.pos} room`);
          if (t && t.position_leans && t.position_leans[asset.pos] >= 0.18) reasons.push(`historically targets ${asset.pos}`);
          if (asset.age && t) {
            const ageFit = t.youth_lean * (25.5 - asset.age);
            score += ageFit * 0.35;
            if (ageFit >= 0.5) reasons.push(t.youth_lean > 0 ? "matches their youth preference" : "matches their veteran preference");
          }
          const productiveCut = { QB: 18, RB: 12, WR: 12, TE: 9 };
          if (t && t.production_chase_lean >= 0.2 && productiveCut[asset.pos] && (asset.ppg || 0) >= productiveCut[asset.pos]) {
            score += 1.1 * t.production_chase_lean;
            reasons.push("matches their proven-production habit");
          }
          if (data.teams[targetRid].mode === "contender" && asset.proj >= 10) { score += 0.8; reasons.push("can help immediately"); }
        }
      } else if (asset.kind === "pick") {
        score += 2.5 * (t ? t.pick_send_lean : 0) + (t && asset.round === 1 ? 1.5 * t.first_send_lean : 0);
        reasons.push(t && t.pick_send_lean > 0.2 ? "manager has moved picks freely" : "adds future capital");
      } else {
        const need = myRanks[asset.pos];
        const surplus = sourceRanks[asset.pos];
        score += (need.rank - 6.5) * 0.3 + (6.5 - surplus.rank) * 0.25;
        if (need.rank >= 8) reasons.push(`fills your #${need.rank} ${asset.pos} room`);
        if (surplus.rank <= 4) reasons.push(`comes from their #${surplus.rank} ${asset.pos} room`);
        if (t && t.position_leans && t.position_leans[asset.pos] >= 0.18) { score -= 0.8 * t.position_leans[asset.pos]; reasons.push(`they value ${asset.pos}—expect a premium`); }
        if (asset.age && t && t.youth_lean > 0.2 && asset.age >= 27) { score += 0.8; reasons.push("may not fit their youth preference"); }
        if (asset.age && t && t.youth_lean > 0.2 && asset.age <= 25) score -= 0.7 * t.youth_lean;
        if (asset.age && t && t.youth_lean < -0.2 && asset.age <= 24) { score += 0.5; reasons.push("may be movable for win-now help"); }
        const productiveCut = { QB: 18, RB: 12, WR: 12, TE: 9 };
        if (t && t.production_chase_lean > 0.2 && productiveCut[asset.pos] && (asset.ppg || 0) >= productiveCut[asset.pos]) score -= 0.6 * t.production_chase_lean;
      }
      return { asset, score, reason: reasons.slice(0, 2).join(" · ") || "strong value fit" };
    }).sort((a, b) => b.score - a.score).slice(0, 4);
  }

  function guideStat(label, value, sub) {
    const card = el("div", null, "stat guide-stat");
    card.append(el("div", label, "label"), el("div", value, "value"));
    if (sub) card.appendChild(el("div", sub, "owner"));
    return card;
  }

  function guideTrait(title, label, detail) {
    const card = el("article", null, "guide-trait");
    card.append(el("div", title, "group-title"), el("div", label, "team"));
    if (detail) card.appendChild(el("p", detail, "owner"));
    return card;
  }

  function pct(v) { return Number.isFinite(v) ? `${v.toFixed(1)}%` : "—"; }

  function renderGuide() {
    const host = document.getElementById("guide-content");
    if (!host || !guide.target) return;
    const rid = String(guide.target);
    const current = latest && latest.teams ? latest.teams[rid] : null;
    const standing = latest && latest.standings ? latest.standings.find((x) => String(x.roster_id) === rid) : null;
    const manager = managerForRid(rid);
    const t = tendencyFor(rid);
    if (!current || !manager || !t) {
      host.replaceChildren(el("p", "This manager needs at least two completed trades before a full guide can be built.", "muted"));
      return;
    }
    const ranks = positionRanks(rid);
    const weakest = GUIDE_POSITIONS.slice().sort((a, b) => ranks[b].rank - ranks[a].rank);
    const draft = t.draft || {};
    const profile = data.teams[rid];
    const wrap = el("div", null, "manager-guide");

    const hero = el("section", null, "guide-hero");
    const title = el("div");
    title.appendChild(el("div", "How to trade with", "group-title"));
    const name = el("div", null, "guide-name teamcell");
    name.append(dot(Number(rid)), teamLink(Number(rid), current.team));
    title.appendChild(name);
    title.appendChild(el("p", `${manager.name} · ${profile.mode} · ${t.deals} completed trades analyzed`, "owner"));
    hero.appendChild(title);
    const badges = el("div", null, "guide-badges");
    [t.youth_label, t.production_label, t.pick_label, t.position_label, t.package_label, t.activity_label].forEach((x) => badges.appendChild(el("span", x)));
    hero.appendChild(badges);
    wrap.appendChild(hero);

    const stats = el("div", null, "stats guide-current");
    const record = current.record ? `${current.record.wins}-${current.record.losses}${current.record.ties ? `-${current.record.ties}` : ""}` : "—";
    stats.append(
      guideStat("Standing", `#${current.rank}`, record),
      guideStat("Playoff odds", pct(current.playoff_odds), `${standing && Number.isFinite(standing.projected_wins) ? standing.projected_wins.toFixed(1) : "—"} projected wins`),
      guideStat("Title odds", pct(current.champion_odds), profile.mode),
      guideStat("#1 pick odds", pct(current.first_pick_odds), current.avg_pick ? `average pick ${current.avg_pick.toFixed(2)}` : null),
      guideStat("Dynasty value", `#${profile.value_rank}`, fmtNum(profile.total_value)),
      guideStat("Draft capital", fmtNum(profile.picks_value), `${profile.picks.length} tradable picks`)
    );
    wrap.appendChild(stats);

    const approach = el("section", null, "guide-approach");
    approach.appendChild(el("h3", "Best approach", "sub-head"));
    const lines = [];
    const modeLead = profile.mode === "contender" ? "Lead with a player who improves the starting lineup now" : profile.mode === "rebuilder" ? "Lead with young value or draft capital" : "Lead with a balanced present-and-future return";
    lines.push(`${modeLead}; ${weakest[0]} (ranked #${ranks[weakest[0]].rank}) and ${weakest[1]} (#${ranks[weakest[1]].rank}) are the clearest current roster needs.`);
    lines.push(t.package_lean >= 0.2 ? "Use one premium centerpiece and ask for multiple pieces back; this manager has consolidated in past deals." : t.package_lean <= -0.2 ? "Use a multi-asset package; this manager has historically preferred receiving depth." : "Either a one-for-one or a small package can work; this manager has shown no rigid deal-shape preference.");
    lines.push(`${t.value_label}. ${t.timing_label}; ${t.trades_per_season.toFixed(1)} completed trades per active season.`);
    const ul = el("ul", null, "notes");
    lines.forEach((x) => ul.appendChild(el("li", x)));
    approach.appendChild(ul);
    wrap.appendChild(approach);

    const targets = el("div", null, "guide-target-grid");
    for (const [heading, rows, side] of [
      ["Best assets to offer", guideCandidates(me, rid, "offer"), "A"],
      ["Best assets to ask for", guideCandidates(me, rid, "ask"), "B"],
    ]) {
      const card = el("section", null, "guide-targets");
      card.appendChild(el("h3", heading, "sub-head"));
      rows.forEach((x) => card.appendChild(guideAssetRow(x.asset, x.reason, rid, side)));
      targets.appendChild(card);
    }
    wrap.appendChild(targets);

    const traits = el("div", null, "guide-traits");
    traits.append(
      guideTrait("Player profile", `${t.youth_label} · ${t.production_label} · ${t.position_label}`, `${t.players_acquired} players acquired · ${t.avg_acquired_age ?? "—"} average age at trade · ${t.proven_producers}/${t.production_sample} established recent producers · QB ${t.position_counts.QB || 0}, RB ${t.position_counts.RB || 0}, WR ${t.position_counts.WR || 0}, TE ${t.position_counts.TE || 0}`),
      guideTrait("Pick behavior", `${t.pick_label} · ${t.first_label}`, `${t.picks_sent} picks sent / ${t.picks_received} acquired · ${t.firsts_sent} firsts sent / ${t.firsts_received} acquired · ${t.future_picks_sent} future picks sent`),
      guideTrait("Deal structure", `${t.package_label} · ${t.large_label}`, `${t.consolidations} consolidation deals · ${t.depth_deals} depth deals · ${t.large_deals} blockbusters · ${t.multi_asset_deals} multi-asset deals`),
      guideTrait("Activity and timing", `${t.activity_label} · ${t.timing_label}`, `${t.trades_per_season.toFixed(1)} trades/season · ${Math.round(t.offseason_rate * 100)}% offseason · ${Math.round(t.deadline_rate * 100)}% week 10 or later`),
      guideTrait("Value outcomes", t.value_label, `${Math.round(t.balanced_value_rate * 100)}% finish within 10% in current value · median current-value edge ${t.median_current_value_edge >= 0 ? "+" : ""}${Math.round(t.median_current_value_edge * 100)}%. This is hindsight, not value on trade day.`),
      guideTrait("Rookie draft", draft.style_label || "Not enough rookie picks", draft.rookie_picks ? `${draft.rookie_picks} picks · ${draft.capital_label} · average value result ${draft.avg_value_delta > 0 ? "+" : ""}${draft.avg_value_delta} slots${draft.best_pick ? ` · best: ${draft.best_pick.name} (${draft.best_pick.season} ${draft.best_pick.label})` : ""}` : null),
      guideTrait("Current position value", `Needs: ${weakest[0]} #${ranks[weakest[0]].rank} · ${weakest[1]} #${ranks[weakest[1]].rank}`, GUIDE_POSITIONS.map((p) => `${p} #${ranks[p].rank}`).join(" · ")),
      guideTrait("Injury-risk tendency", t.risk.label, "Sleeper does not preserve reliable injury status from the exact date of old trades. Current injuries still affect contender fit and acceptance estimates.")
    );
    wrap.appendChild(el("h3", "Full tendency report", "sub-head"));
    wrap.appendChild(traits);

    const partners = el("section", null, "guide-partners");
    partners.appendChild(el("h3", "Frequent trade partners", "sub-head"));
    const partnerList = el("div", null, "guide-partner-list");
    (t.favorite_partners || []).forEach((p) => {
      const pm = historyData.managers[p.user];
      partnerList.appendChild(el("span", `${pm ? pm.team : "Former manager"} · ${p.deals} deals`, "chip"));
    });
    if (!(t.favorite_partners || []).length) partnerList.appendChild(el("span", "No repeat partner yet", "muted"));
    partners.appendChild(partnerList);
    wrap.appendChild(partners);
    host.replaceChildren(wrap);
  }

  function setupGuide(params) {
    const mine = document.getElementById("guide-me");
    const target = document.getElementById("guide-manager");
    fillTeamSelect(mine, me);
    fillTeamSelect(target, me);
    const requested = params.get("m");
    guide.target = requested && data.teams[requested] && requested !== me ? requested : Object.keys(data.teams).find((x) => x !== me);
    target.value = guide.target;
    mine.addEventListener("change", () => {
      setMe(mine.value, false);
      if (guide.target === me) guide.target = Object.keys(data.teams).find((x) => x !== me);
      target.value = guide.target;
      writeHash("guide");
      renderGuide();
    });
    target.addEventListener("change", () => {
      if (target.value === me) {
        target.value = guide.target;
        return;
      }
      guide.target = target.value;
      writeHash("guide");
      renderGuide();
    });
    renderGuide();
  }

  function setMe(rid, rerender = true) {
    me = String(rid);
    try { localStorage.setItem(ME_KEY, me); } catch (e) { /* storage off: still works this visit */ }
    const ideaSel = document.getElementById("idea-team");
    if (ideaSel && ideaSel.value !== me) ideaSel.value = me;
    const guideMe = document.getElementById("guide-me");
    if (guideMe && guideMe.value !== me) guideMe.value = me;
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
      if (guide.target) {
        if (guide.target === me) guide.target = Object.keys(data.teams).find((x) => x !== me);
        const target = document.getElementById("guide-manager");
        if (target) target.value = guide.target;
        renderGuide();
      }
    }
  }

  function setupMe() {
    let saved = null;
    try { saved = localStorage.getItem(ME_KEY); } catch (e) { saved = null; }
    me = saved && data.teams[saved] ? saved : Object.keys(data.teams)[0];
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
      const [trade, latestData, managerHistory] = await Promise.all([
        fetch("data/trade.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
        window.HIM.loadData().catch(() => null),
        fetch("data/history.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      data = trade;
      latest = latestData;
      historyData = managerHistory;
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
    setupGuide(tab === "guide" ? params : new URLSearchParams());
    document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
    showTab(tab, false);
    // Rewrite the URL so a re-shared link drops anything that moved rosters.
    if (stale) { if (tab === "calc") writeCalcHash(); else if (tab === "build") writeHash("build"); }
  }

  load();
})();
