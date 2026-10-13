/* HIM Dynasty history: champions, seasons, record book, rivalries, manager
   careers, draft re-grades and the trade archive.
   Data: data/history.json (rebuilt every morning; finished seasons are
   frozen in data/archive/). Names are set with textContent only. */
(() => {
  "use strict";
  const { el, dot, assignColors } = window.HIM;

  let H = null;
  let latest = null;
  const isNum = (v) => typeof v === "number" && isFinite(v);
  const fmt = (v, d = 1) => (isNum(v) ? v.toFixed(d) : "—");
  const num = (v) => (isNum(v) ? Math.round(v).toLocaleString() : "—");
  const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th"}`;
  const mgr = (u) => (H.managers[u] || { team: "Former manager", name: "", seasons: {} });
  const teamOf = (u) => mgr(u).team;

  function who(u, opts = {}) {
    const m = mgr(u);
    const w = el(opts.link === false ? "span" : "a", null, "teamcell who");
    if (opts.link !== false) w.href = `#managers/${encodeURIComponent(u)}`;
    if (isNum(m.current_rid)) w.appendChild(dot(m.current_rid));
    const t = el("span", null);
    t.appendChild(el("span", opts.teamFor && m.seasons[opts.teamFor] ? m.seasons[opts.teamFor].team : m.team, "team"));
    if (opts.sub !== false && m.name) t.appendChild(el("span", ` ${m.name}`, "owner"));
    w.appendChild(t);
    return w;
  }
  function avatar(u, cls = "h-avatar") {
    const m = mgr(u);
    const img = el("img", null, cls);
    img.alt = "";
    img.loading = "lazy";
    if (m.avatar) img.src = `https://sleepercdn.com/avatars/thumbs/${encodeURIComponent(m.avatar)}`;
    img.addEventListener("error", () => { img.style.visibility = "hidden"; });
    return img;
  }
  function pills(host, values, current, label, onPick) {
    host.replaceChildren(...values.map((v) => {
      const b = el("button", label(v), v === current ? "chip is-current" : "chip");
      b.type = "button";
      b.addEventListener("click", () => onPick(v));
      return b;
    }));
  }
  const table = (heads) => {
    const t = el("table");
    const tr = el("tr");
    heads.forEach(([l, n, tip]) => { const th = el("th", l, n ? "num" : ""); if (tip) th.title = tip; tr.appendChild(th); });
    t.appendChild(el("thead")).appendChild(tr);
    const body = el("tbody");
    t.appendChild(body);
    return [t, body];
  };

  // ---------------------------------------------------------------- //
  // Champions banner
  // ---------------------------------------------------------------- //
  function renderHof() {
    const host = document.getElementById("hof");
    host.replaceChildren(...H.seasons.slice().reverse().map((s) => {
      const c = el("a", null, `hof-card${s.complete ? "" : " live"}`);
      c.href = `#seasons/${s.season}`;
      c.appendChild(el("div", s.season, "hof-year"));
      if (s.complete && s.champion) {
        c.appendChild(el("div", "🏆 Champion", "hof-label"));
        const row = el("div", null, "hof-champ");
        const then = mgr(s.champion).seasons[s.season] ? mgr(s.champion).seasons[s.season].team : teamOf(s.champion);
        row.append(avatar(s.champion), el("span", then, "team"));
        c.appendChild(row);
        if (then !== teamOf(s.champion)) c.appendChild(el("div", `Now ${teamOf(s.champion)} · ${mgr(s.champion).name}`, "owner"));
        const bits = [];
        if (s.runner_up) bits.push(`Runner-up: ${mgr(s.runner_up).seasons[s.season] ? mgr(s.runner_up).seasons[s.season].team : teamOf(s.runner_up)}`);
        if (s.best_record) bits.push(`Best record: ${s.best_record.w}-${s.best_record.l}`);
        bits.forEach((b) => c.appendChild(el("div", b, "owner")));
      } else {
        c.appendChild(el("div", "In progress", "hof-label"));
        c.appendChild(el("div", `Through week ${Math.min(s.weeks_scored, (latest && latest.league.weeks_completed) || s.weeks_scored)}`, "team"));
        if (s.best_record) c.appendChild(el("div", `Leader: ${teamOf(s.best_record.user)} (${s.best_record.w}-${s.best_record.l})`, "owner"));
      }
      if (s.first_pick) c.appendChild(el("div", `${s.first_pick.season} 1.01: ${s.first_pick.name}`, "owner"));
      return c;
    }));
  }

  // ---------------------------------------------------------------- //
  // Seasons
  // ---------------------------------------------------------------- //
  const ROUND_NAME = (g, rounds) => (g.kind === "final" ? "Championship" : g.round === rounds ? "Placement" : g.round === rounds - 1 ? "Semifinal" : "Quarterfinal");
  function renderSeasons(season) {
    const list = H.seasons.map((s) => s.season);
    if (!list.includes(season)) season = list[list.length - 1];
    pills(document.getElementById("season-pills"), list.slice().reverse(), season, (v) => v, (v) => { location.hash = `#seasons/${v}`; });
    const s = H.seasons.find((x) => x.season === season);
    document.getElementById("season-title").textContent = `${season} Season`;
    document.getElementById("season-note").textContent = s.complete
      ? `Final standings and playoffs. Finish is where each team ended up after the playoffs; teams outside the playoffs are placed by regular-season record.`
      : `In progress: regular-season standings through week ${Math.min(s.weeks_scored, latest ? latest.league.weeks_completed : s.weeks_scored)}. The live race and playoff odds are on the League page.`;
    const host = document.getElementById("season-body");
    host.replaceChildren();
    const [t, body] = table([["#", 1], ["Team", 0], ["W-L", 1], ["PF", 1], ["PA", 1], ["Max PF", 1], ["Playoffs", 0], ["Finish", 1]]);
    for (const r of s.standings) {
      const tr = el("tr");
      if (s.complete && r.finish === 1) tr.classList.add("champ-row");
      tr.appendChild(el("td", String(r.rank), "num rank"));
      const c = el("td");
      c.appendChild(who(r.user, { teamFor: season }));
      tr.appendChild(c);
      tr.appendChild(el("td", `${r.w}-${r.l}${r.t ? `-${r.t}` : ""}`, "num"));
      tr.appendChild(el("td", fmt(r.pf), "num"));
      tr.appendChild(el("td", fmt(r.pa), "num"));
      tr.appendChild(el("td", fmt(r.max_pf), "num"));
      tr.appendChild(el("td", r.playoffs === null || r.playoffs === undefined ? "—" : r.playoffs ? "✓" : "", "small"));
      tr.appendChild(el("td", r.finish ? (r.finish === 1 ? "🏆 1st" : ordinal(r.finish)) : "—", "num"));
      body.appendChild(tr);
    }
    const wrap = el("div", null, "table-wrap");
    wrap.appendChild(t);
    host.appendChild(wrap);
    if (s.bracket.length) {
      host.appendChild(el("h3", "Playoffs", "sub-head"));
      const rounds = Math.max(...s.bracket.map((g) => g.round || 1));
      const byRound = {};
      s.bracket.forEach((g) => (byRound[g.round] = byRound[g.round] || []).push(g));
      const grid = el("div", null, "h-bracket");
      for (const r of Object.keys(byRound).sort()) {
        const col = el("div", null, "h-round");
        col.appendChild(el("div", `Week ${s.playoff_week_start + Number(r) - 1}`, "group-title"));
        byRound[r].sort((a, b) => (a.kind === "final" ? -1 : 0) - (b.kind === "final" ? -1 : 0)).forEach((g) => {
          const card = el("div", null, `h-game${g.kind === "final" ? " final" : ""}`);
          card.appendChild(el("div", ROUND_NAME(g, rounds), "owner"));
          for (const [rid, pts] of [[g.a, g.pa], [g.b, g.pb]]) {
            const u = s.teams[String(rid)] ? s.teams[String(rid)].user : null;
            const row = el("div", null, `h-side${g.winner === rid ? " win" : ""}`);
            row.appendChild(u ? who(u, { teamFor: season, sub: false }) : el("span", `Team ${rid}`));
            row.appendChild(el("span", fmt(pts, 2), "num"));
            card.appendChild(row);
          }
          col.appendChild(card);
        });
        grid.appendChild(col);
      }
      host.appendChild(grid);
    }
  }

  // ---------------------------------------------------------------- //
  // Records
  // ---------------------------------------------------------------- //
  function renderRecords() {
    const host = document.getElementById("records");
    host.replaceChildren(...H.records.filter((r) => r.rows.length).map((r) => {
      const card = el("article", null, "record");
      card.appendChild(el("h3", r.title, "record-title"));
      const top = r.rows[0];
      const lead = el("div", null, "record-lead");
      lead.appendChild(el("div", `${fmt(top.value, Number.isInteger(top.value) ? 0 : 2)}`, "record-value"));
      lead.appendChild(el("div", r.unit, "owner"));
      card.appendChild(lead);
      const ol = el("ol", null, "record-list");
      r.rows.forEach((x) => {
        const li = el("li");
        li.appendChild(who(x.user, { teamFor: x.season, sub: false }));
        const ctx = [x.season, x.week ? `wk ${x.week}` : null, x.opp ? `vs ${mgr(x.opp).seasons[x.season] ? mgr(x.opp).seasons[x.season].team : teamOf(x.opp)}` : null,
          x.kind && x.kind !== "regular" ? (x.kind === "final" ? "championship" : "playoffs") : null,
          isNum(x.pa) && x.id !== "close" && r.id !== "most_pf" && r.season_level !== true ? `${fmt(x.pf, 2)}–${fmt(x.pa, 2)}` : null,
          r.season_level && isNum(x.w) ? `${x.w}-${x.l}` : null].filter(Boolean).join(" · ");
        li.appendChild(el("span", ctx, "owner"));
        li.appendChild(el("span", fmt(x.value, Number.isInteger(x.value) ? 0 : 2), "num"));
        ol.appendChild(li);
      });
      card.appendChild(ol);
      return card;
    }));
  }

  // ---------------------------------------------------------------- //
  // Rivalries
  // ---------------------------------------------------------------- //
  const riv = { a: null, b: null };
  function activeManagers() {
    return Object.keys(H.managers).sort((x, y) => teamOf(x).localeCompare(teamOf(y)));
  }
  function renderRivalries(a, b) {
    const ids = activeManagers();
    const sa = document.getElementById("riv-a"), sb = document.getElementById("riv-b");
    if (!sa.options.length) {
      for (const sel of [sa, sb]) {
        sel.appendChild(Object.assign(el("option", "Pick a manager"), { value: "" }));
        ids.forEach((u) => { const o = el("option", teamOf(u)); o.value = u; sel.appendChild(o); });
        sel.addEventListener("change", () => { location.hash = `#rivalries/${sa.value}/${sb.value}`; });
      }
    }
    riv.a = a && H.managers[a] ? a : null;
    riv.b = b && H.managers[b] ? b : null;
    sa.value = riv.a || "";
    sb.value = riv.b || "";
    // Matrix
    const [t, body] = table([["", 0], ...ids.map((u) => [teamOf(u).slice(0, 10), 1, teamOf(u)])]);
    t.classList.add("riv-matrix");
    for (const u of ids) {
      const tr = el("tr");
      const th = el("td", null, "sticky-col");
      th.appendChild(who(u, { sub: false }));
      tr.appendChild(th);
      for (const o of ids) {
        const td = el("td", null, "num");
        if (u === o) { td.textContent = "—"; td.classList.add("muted"); }
        else {
          const h = H.h2h[`${u}|${o}`];
          if (h) {
            const a1 = el("a", `${h.w}-${h.l}${h.t ? `-${h.t}` : ""}`);
            a1.href = `#rivalries/${u}/${o}`;
            td.appendChild(a1);
            td.className = `num ${h.w > h.l ? "hg2" : h.w < h.l ? "hb2" : ""}`;
            if (riv.a === u && riv.b === o) td.classList.add("sel");
          } else td.textContent = "0-0";
        }
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    document.getElementById("riv-matrix").replaceChildren(t);
    // Detail
    const host = document.getElementById("riv-detail");
    if (!riv.a || !riv.b || riv.a === riv.b) { host.replaceChildren(); return; }
    const h = H.h2h[`${riv.a}|${riv.b}`];
    const box = el("div", null, "riv-box");
    const head = el("div", null, "riv-head");
    const side = (u, w) => { const d = el("div", null, "riv-side"); d.append(avatar(u, "h-avatar lg"), who(u), el("div", String(w), "riv-wins")); return d; };
    if (!h) {
      host.replaceChildren(el("p", `${teamOf(riv.a)} and ${teamOf(riv.b)} haven't played yet.`, "muted"));
      return;
    }
    head.append(side(riv.a, h.w), el("div", h.t ? `${h.t} tie${h.t > 1 ? "s" : ""}` : "vs", "riv-mid"), side(riv.b, h.l));
    box.appendChild(head);
    const leader = h.w > h.l ? riv.a : h.l > h.w ? riv.b : null;
    box.appendChild(el("p", `${h.g} games${h.po ? `, ${h.po} in the playoffs` : ""}. ${leader ? `${teamOf(leader)} leads the series.` : "Dead even."} Points: ${fmt(h.pf, 1)}–${fmt(h.pa, 1)} (${fmt(h.pf / h.g, 1)} to ${fmt(h.pa / h.g, 1)} a game).`, "note"));
    const ul = el("ul", null, "riv-games");
    h.games.slice().reverse().forEach(([season, w, pf, pa, kind]) => {
      const li = el("li", null, pf > pa ? "win" : pf < pa ? "loss" : "");
      li.append(el("span", `${season} wk ${w}${kind !== "regular" ? (kind === "final" ? " · Championship" : " · Playoffs") : ""}`, "owner"),
        el("span", `${fmt(pf, 2)} – ${fmt(pa, 2)}`, "num"), el("span", pf > pa ? teamOf(riv.a) : pf < pa ? teamOf(riv.b) : "Tie", "small"));
      ul.appendChild(li);
    });
    box.appendChild(ul);
    host.replaceChildren(box);
  }

  // ---------------------------------------------------------------- //
  // Managers
  // ---------------------------------------------------------------- //
  const mg = { sort: "win_pct", dir: -1 };
  const MGR_COLS = [
    ["seasons", "Yrs", (m) => Object.keys(m.seasons).length],
    ["rec", "W-L", (m) => m.w + 0.5 * m.t, (m) => `${m.w}-${m.l}${m.t ? `-${m.t}` : ""}`],
    ["win_pct", "Win%", (m) => m.win_pct, (m) => `${fmt(m.win_pct, 1)}%`],
    ["ppg", "PPG", (m) => m.ppg, (m) => fmt(m.ppg, 1)],
    ["titles", "Titles", (m) => m.titles.length + 0.01 * m.runner_up.length, (m) => (m.titles.length ? "🏆".repeat(m.titles.length) : "—")],
    ["finals", "Finals", (m) => m.titles.length + m.runner_up.length, (m) => String(m.titles.length + m.runner_up.length)],
    ["playoffs", "Playoffs", (m) => m.playoffs, (m) => String(m.playoffs)],
    ["po", "Playoff W-L", (m) => m.po_w - m.po_l, (m) => `${m.po_w}-${m.po_l}`],
    ["avg_finish", "Avg finish", (m) => (isNum(m.avg_finish) ? -m.avg_finish : null), (m) => fmt(m.avg_finish, 1)],
    ["high", "High score", (m) => m.high, (m) => fmt(m.high, 2)],
    ["streak_w", "Best streak", (m) => m.streak_w, (m) => `W${m.streak_w || 0}`],
    ["trades", "Trades", (m) => m.trades || 0, (m) => `${m.trades || 0}${m.trades ? ` (${m.trade_wins || 0}-${m.trade_losses || 0})` : ""}`],
    ["draft", "Draft +/-", (m) => m.draft_delta ?? null, (m) => (isNum(m.draft_delta) ? `${m.draft_delta > 0 ? "+" : ""}${m.draft_delta}` : "—")],
  ];
  function renderManagers(focus) {
    const rows = Object.values(H.managers);
    const col = MGR_COLS.find((c) => c[0] === mg.sort) || MGR_COLS[2];
    rows.sort((a, b) => { const x = col[2](a), y = col[2](b); if (x === y) return 0; if (x === null) return 1; if (y === null) return -1; return (x > y ? 1 : -1) * mg.dir; });
    const t = el("table");
    const hr = el("tr");
    hr.appendChild(el("th", "Manager"));
    for (const [k, l] of MGR_COLS) {
      const th = el("th", l, `num sortable${mg.sort === k ? (mg.dir < 0 ? " desc" : " asc") : ""}`);
      th.addEventListener("click", () => { mg.dir = mg.sort === k ? -mg.dir : -1; mg.sort = k; renderManagers(focus); });
      hr.appendChild(th);
    }
    t.appendChild(el("thead")).appendChild(hr);
    const body = el("tbody");
    for (const m of rows) {
      const tr = el("tr");
      tr.tabIndex = 0;
      tr.addEventListener("click", () => { location.hash = `#managers/${m.user}`; });
      const c = el("td");
      const w = el("div", null, "player");
      w.append(avatar(m.user), who(m.user, { link: false }));
      c.appendChild(w);
      tr.appendChild(c);
      for (const [, , , show] of MGR_COLS) tr.appendChild(el("td", show ? show(m) : "", "num"));
      body.appendChild(tr);
    }
    t.appendChild(body);
    document.getElementById("mgr-table").replaceChildren(t);
    renderManagerDetail(focus);
  }

  function renderManagerDetail(u) {
    const host = document.getElementById("mgr-detail");
    if (u && u.startsWith("rid:")) u = Object.keys(H.managers).find((x) => String(H.managers[x].current_rid) === u.slice(4));
    const m = u && H.managers[u];
    if (!m) { host.replaceChildren(); return; }
    const box = el("div", null, "mgr-box");
    const head = el("div", null, "an-head");
    head.appendChild(avatar(u, "an-photo"));
    const t = el("div");
    t.appendChild(el("h2", m.team, "an-name"));
    t.appendChild(el("p", `${m.name} · ${Object.keys(m.seasons).length} season${Object.keys(m.seasons).length === 1 ? "" : "s"} in HIM${m.titles.length ? ` · ${m.titles.length}× champion (${m.titles.join(", ")})` : ""}`, "team-sub"));
    const names = Object.entries(m.seasons).map(([s, x]) => `${s}: ${x.team}`).join(" · ");
    t.appendChild(el("p", `Team names: ${names}`, "owner"));
    if (isNum(m.current_rid)) {
      const a = el("a", "Current roster →", "chip");
      a.href = `team.html?id=${m.current_rid}`;
      t.appendChild(a);
    }
    head.appendChild(t);
    const close = el("a", "✕", "remove an-close");
    close.href = "#managers";
    close.setAttribute("aria-label", "Close profile");
    head.appendChild(close);
    box.appendChild(head);
    const tiles = [
      ["Record", `${m.w}-${m.l}${m.t ? `-${m.t}` : ""}`, `${fmt(m.win_pct, 1)}% · regular season`],
      ["Playoffs", `${m.po_w}-${m.po_l}`, `${m.playoffs} appearance${m.playoffs === 1 ? "" : "s"}`],
      ["Points per game", fmt(m.ppg, 1), `${num(m.pf)} total`],
      ["Best finish", m.best_finish ? ordinal(m.best_finish) : "—", isNum(m.avg_finish) ? `average ${fmt(m.avg_finish, 1)}` : null],
      ["High score", fmt(m.high, 2)],
      ["Streaks", `W${m.streak_w || 0} / L${m.streak_l || 0}`, m.streak_now ? `current: ${m.streak_now > 0 ? `W${m.streak_now}` : `L${-m.streak_now}`}` : null],
      ["Trades", String(m.trades || 0), m.trades ? `${m.trade_wins || 0} won · ${m.trade_losses || 0} lost` : null],
      ["Rookie drafting", isNum(m.draft_delta) ? `${m.draft_delta > 0 ? "+" : ""}${m.draft_delta}` : "—", m.rookie_picks ? `${m.rookie_picks} picks · spots gained vs draft slot` : null],
    ];
    const grid = el("div", null, "stats");
    tiles.forEach(([l, v, s]) => { const b = el("div", null, "stat"); b.append(el("div", l, "label"), el("div", v, "value")); if (s) b.appendChild(el("div", s, "owner")); grid.appendChild(b); });
    box.appendChild(grid);
    // Finishes by season
    const fin = el("div", null, "mgr-fin");
    for (const s of H.seasons) {
      if (!m.seasons[s.season]) continue;
      const st = s.standings.find((x) => x.user === u);
      const chip = el("a", null, `fin-chip${s.complete && st && st.finish === 1 ? " gold" : ""}`);
      chip.href = `#seasons/${s.season}`;
      chip.append(el("div", s.season, "owner"), el("div", s.complete && st ? (st.finish === 1 ? "🏆" : ordinal(st.finish)) : "Now", "fin-place"),
        el("div", st ? `${st.w}-${st.l} · ${fmt(st.pf, 0)} PF` : "", "owner"));
      fin.appendChild(chip);
    }
    box.appendChild(el("h3", "Season by season", "sub-head"));
    box.appendChild(fin);
    // Head-to-head vs everyone
    box.appendChild(el("h3", "Against everyone", "sub-head"));
    const list = el("div", null, "mgr-h2h");
    Object.keys(H.managers).filter((o) => o !== u && H.h2h[`${u}|${o}`]).sort((a, b) => {
      const x = H.h2h[`${u}|${a}`], y = H.h2h[`${u}|${b}`];
      return (y.w - y.l) - (x.w - x.l);
    }).forEach((o) => {
      const h = H.h2h[`${u}|${o}`];
      const a = el("a", null, `h2h-chip ${h.w > h.l ? "up" : h.w < h.l ? "down" : ""}`);
      a.href = `#rivalries/${u}/${o}`;
      a.append(who(o, { link: false, sub: false }), el("span", `${h.w}-${h.l}${h.t ? `-${h.t}` : ""}`, "num"));
      list.appendChild(a);
    });
    box.appendChild(list);
    // Best and worst trades
    const mine = H.trades.filter((t2) => t2.sides.some((s) => s.user === u) && t2.winner);
    const won = mine.filter((t2) => t2.winner === u).sort((a, b) => b.margin - a.margin).slice(0, 2);
    const lost = mine.filter((t2) => t2.winner !== u).sort((a, b) => b.margin - a.margin).slice(0, 2);
    if (won.length || lost.length) {
      box.appendChild(el("h3", "Best and worst trades", "sub-head"));
      const tl = el("div", null, "trade-list");
      [...won, ...lost].forEach((t2) => tl.appendChild(tradeCard(t2, u)));
      box.appendChild(tl);
    }
    host.replaceChildren(box);
    host.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------------------------------------------------------------- //
  // Drafts
  // ---------------------------------------------------------------- //
  function renderDrafts(key) {
    const drafts = H.drafts.slice().sort((a, b) => (b.season + b.kind).localeCompare(a.season + a.kind));
    const keys = drafts.map((d) => `${d.season}-${d.kind}`);
    if (!keys.includes(key)) key = keys[0];
    pills(document.getElementById("draft-pills"), keys, key, (k) => { const [s, kind] = k.split("-"); return `${s} ${kind === "rookie" ? "Rookie" : "Startup"}`; }, (k) => { location.hash = `#drafts/${k}`; });
    const d = drafts.find((x) => `${x.season}-${x.kind}` === key);
    const young = Number(d.season) >= Number(H.current_season);
    document.getElementById("draft-note").textContent =
      `Every pick re-graded with today's dynasty value (DynastyProcess 1-QB). "+/-" is the pick number minus where his value now ranks in this draft: +8 means he's worth 8 spots more than where he went. League pts = points he has scored in HIM starting lineups.${young ? " This class is brand new, so values still mostly reflect draft capital." : ""}`;
    // Manager summary
    const by = {};
    d.picks.forEach((p) => { const b = (by[p.user] = by[p.user] || { picks: 0, delta: 0, value: 0, best: null }); b.picks++; b.delta += p.delta; b.value += p.value; if (!b.best || p.delta > b.best.delta) b.best = p; });
    const sum = el("div", null, "draft-sum");
    Object.entries(by).sort((a, b) => b[1].value - a[1].value).forEach(([u, b]) => {
      const c = el("div", null, "draft-sum-card");
      c.appendChild(who(u, { teamFor: d.season, sub: false }));
      c.appendChild(el("div", `${b.picks} pick${b.picks === 1 ? "" : "s"} · ${num(b.value)} value now`, "owner"));
      c.appendChild(el("div", `${b.delta > 0 ? "+" : ""}${b.delta} vs slot`, `num ${b.delta > 0 ? "up" : b.delta < 0 ? "down" : ""}`));
      if (b.best && d.kind === "rookie") c.appendChild(el("div", `Best: ${b.best.name} (${b.best.label})`, "owner"));
      sum.appendChild(c);
    });
    document.getElementById("draft-summary").replaceChildren(sum);
    const [t, body] = table([["Pick", 0], ["Team", 0], ["Player", 0], ["Pos", 0], ["Value now", 1], ["Value rank", 1], ["+/-", 1, "Draft slot minus value rank: positive = steal"], ["League pts", 1]]);
    for (const p of d.picks) {
      const tr = el("tr");
      tr.appendChild(el("td", p.label, "num"));
      const c = el("td");
      c.appendChild(who(p.user, { teamFor: d.season, sub: false }));
      if (p.orig_user && p.orig_user !== p.user) c.appendChild(el("div", `via ${mgr(p.orig_user).seasons[d.season] ? mgr(p.orig_user).seasons[d.season].team : teamOf(p.orig_user)}`, "owner"));
      tr.appendChild(c);
      const pc = el("td");
      const a = el("a", p.name, "team");
      a.href = `analytics.html?player=${encodeURIComponent(p.pid)}#explorer`;
      pc.appendChild(a);
      if (p.nfl) pc.appendChild(el("span", ` ${p.nfl}`, "owner"));
      tr.appendChild(pc);
      tr.appendChild(el("td", p.pos || "", "pos"));
      tr.appendChild(el("td", p.value ? num(p.value) : "—", "num"));
      tr.appendChild(el("td", `#${p.vrank}`, "num"));
      tr.appendChild(el("td", `${p.delta > 0 ? "+" : ""}${p.delta}`, `num ${p.delta >= 5 ? "hg2" : p.delta >= 2 ? "hg1" : p.delta <= -5 ? "hb2" : p.delta <= -2 ? "hb1" : ""}`));
      tr.appendChild(el("td", p.league_pts ? fmt(p.league_pts, 1) : "—", "num"));
      body.appendChild(tr);
    }
    document.getElementById("draft-table").replaceChildren(t);
  }

  // ---------------------------------------------------------------- //
  // Trades
  // ---------------------------------------------------------------- //
  function tradeCard(t, focusUser) {
    const card = el("article", null, "trade-card");
    const when = t.time ? new Date(t.time).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }) : t.season;
    const head = el("div", null, "trade-head");
    head.appendChild(el("span", `${when} · ${t.season} wk ${t.week || "—"}`, "owner"));
    const verdict = t.winner ? `${teamOf(t.winner)} won it` : "Even so far";
    head.appendChild(el("span", verdict, `trade-verdict${t.winner ? (focusUser ? (t.winner === focusUser ? " up" : " down") : " up") : ""}`));
    card.appendChild(head);
    const cols = el("div", null, "trade-cols");
    for (const s of t.sides) {
      const c = el("div", null, `trade-side${t.winner === s.user ? " won" : ""}`);
      const h = el("div", null, "trade-who");
      h.appendChild(who(s.user, { teamFor: t.season, sub: false }));
      h.appendChild(el("span", "got", "owner"));
      c.appendChild(h);
      const ul = el("ul", null, "trade-items");
      if (!s.items.length) ul.appendChild(el("li", "Nothing (roster relief)", "owner"));
      s.items.forEach((it) => {
        const li = el("li");
        li.appendChild(el("span", it.became ? `${it.label} → ${it.became}` : it.label, "team"));
        if (it.pos && it.pos !== "PICK") li.appendChild(el("span", ` ${it.pos}`, "owner"));
        li.appendChild(el("span", it.value ? num(it.value) : "—", "num muted"));
        ul.appendChild(li);
      });
      c.appendChild(ul);
      c.appendChild(el("div", `Worth ${num(s.value_now)} now · ${fmt(s.points, 1)} pts started since`, "owner"));
      cols.appendChild(c);
    }
    card.appendChild(cols);
    if (t.winner) {
      const bar = el("div", null, "trade-bar");
      const a = t.sides[0].user === t.winner;
      const fill = el("span");
      fill.style.width = `${Math.min(100, 50 + t.margin * 50)}%`;
      if (!a) fill.style.marginLeft = "auto";
      bar.appendChild(fill);
      card.appendChild(bar);
    }
    return card;
  }

  const tr = { season: "", user: "", kind: "all" };
  function renderTrades() {
    const sel = (id, opts, val) => {
      const s = document.getElementById(id);
      if (!s.options.length) {
        opts.forEach(([v, l]) => { const o = el("option", l); o.value = v; s.appendChild(o); });
        s.addEventListener("change", () => { tr[id === "tr-season" ? "season" : id === "tr-user" ? "user" : "kind"] = s.value; renderTrades(); });
      }
      s.value = val;
    };
    sel("tr-season", [["", "All seasons"], ...H.seasons.map((s) => [s.season, s.season]).reverse()], tr.season);
    sel("tr-user", [["", "Everyone"], ...activeManagers().map((u) => [u, teamOf(u)])], tr.user);
    document.getElementById("tr-kind").value = tr.kind;
    if (!document.getElementById("tr-kind").dataset.bound) {
      document.getElementById("tr-kind").dataset.bound = "1";
      document.getElementById("tr-kind").addEventListener("change", (e) => { tr.kind = e.target.value; renderTrades(); });
    }
    document.getElementById("trade-note").textContent = `${H.trades.length} trades since 2024. ${H.trade_scoring} Re-scored every morning, so old trades keep getting judged.`;
    let list = H.trades.filter((t) => (!tr.season || t.season === tr.season) && (!tr.user || t.sides.some((s) => s.user === tr.user)));
    if (tr.kind === "decided") list = list.filter((t) => t.winner);
    if (tr.kind === "big") list = list.filter((t) => t.sides.some((s) => s.value_now >= 5000));
    // Leaderboard
    const board = {};
    for (const t of H.trades) for (const s of t.sides) {
      const b = (board[s.user] = board[s.user] || { n: 0, w: 0, l: 0 });
      b.n++;
      if (t.winner === s.user) b.w++; else if (t.winner) b.l++;
    }
    const lb = el("div", null, "trade-board");
    Object.entries(board).sort((a, b) => (b[1].w - b[1].l) - (a[1].w - a[1].l) || b[1].n - a[1].n).forEach(([u, b]) => {
      const c = el("button", null, `trade-lb${tr.user === u ? " is-current" : ""}`);
      c.type = "button";
      c.append(who(u, { link: false, sub: false }), el("span", `${b.w}-${b.l}`, `num ${b.w > b.l ? "up" : b.w < b.l ? "down" : ""}`), el("span", `${b.n} trades`, "owner"));
      c.addEventListener("click", () => { tr.user = tr.user === u ? "" : u; renderTrades(); });
      lb.appendChild(c);
    });
    document.getElementById("trade-board").replaceChildren(el("h3", "Trade records (won-lost)", "sub-head"), lb);
    const host = document.getElementById("trade-list");
    host.replaceChildren(...list.slice(0, 60).map((t) => tradeCard(t, tr.user || null)));
    if (!list.length) host.appendChild(el("p", "No trades match.", "muted"));
    if (list.length > 60) host.appendChild(el("p", `Showing the 60 most recent of ${list.length}. Pick a season or manager to narrow it down.`, "note"));
  }

  // ---------------------------------------------------------------- //
  function route() {
    const parts = location.hash.replace(/^#/, "").split("/").map((x) => decodeURIComponent(x || ""));
    const view = ["seasons", "records", "rivalries", "managers", "drafts", "trades"].includes(parts[0]) ? parts[0] : "seasons";
    document.querySelectorAll(".h-view").forEach((v) => { v.hidden = v.id !== `view-${view}`; });
    document.querySelectorAll("#h-tabs a").forEach((a) => a.setAttribute("aria-current", a.dataset.tab === view ? "page" : "false"));
    if (view === "seasons") renderSeasons(parts[1]);
    else if (view === "records") renderRecords();
    else if (view === "rivalries") renderRivalries(parts[1], parts[2]);
    else if (view === "managers") renderManagers(parts[1]);
    else if (view === "drafts") renderDrafts(parts[1]);
    else if (view === "trades") renderTrades();
  }

  async function load() {
    try {
      [H, latest] = await Promise.all([
        fetch("data/history.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
        window.HIM.loadData().catch(() => null),
      ]);
    } catch (err) {
      document.getElementById("updated").textContent = `History appears after the next morning update (${err.message}).`;
      return;
    }
    if (latest) assignColors(latest.standings.map((t) => t.roster_id));
    const done = H.seasons.filter((s) => s.complete).length;
    document.getElementById("updated").textContent =
      `${H.seasons.length} seasons since the ${H.seasons[0].season} startup · ${done} finished · updated ${new Date(H.generated_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
    renderHof();
    window.addEventListener("hashchange", route);
    route();
  }

  load();
})();
