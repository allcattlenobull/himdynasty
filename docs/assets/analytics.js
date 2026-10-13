/* HIM Dynasty analytics: player explorer, player profiles, and team view.
   Data: data/analytics.json (built nightly from nflverse + ffopportunity). */
(() => {
  "use strict";
  const { el, dot, teamLink, assignColors, teamColor, cssVar, themeChart, withAlpha } = window.HIM;

  let A = null;          // analytics.json
  let latest = null;
  let trade = null;
  const state = { pos: "ALL", owner: "all", signal: "", q: "", sort: "ppg", dir: -1, shown: 60 };
  let charts = [];

  const fmt = (v, d = 1, suffix = "") => (v === null || v === undefined ? "—" : `${Number(v).toFixed(d)}${suffix}`);
  const signed = (v, d = 1) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`);
  const teamName = (rid) => (latest.teams[String(rid)] ? latest.teams[String(rid)].team.trim() : "");
  const SIGNAL_CLASS = {
    "Buy low": "good", "Rising usage": "good", "Ascending": "good", "Market undervalues": "good", "Running cold": "info",
    "Sell high": "bad", "Falling usage": "bad", "Age cliff": "bad", "Living on name value": "bad", "Running hot": "info",
  };

  function headshot(p, cls = "headshot") {
    const img = el("img", null, cls);
    img.alt = "";
    img.loading = "lazy";
    img.src = p.headshot || (p.id && !p.id.startsWith("g") ? `https://sleepercdn.com/content/nfl/players/thumb/${encodeURIComponent(p.id)}.jpg` : "");
    img.addEventListener("error", () => { img.style.visibility = "hidden"; });
    return img;
  }

  function badges(p, limit = 3) {
    const wrap = el("span", null, "sig-badges");
    for (const [name, why] of p.signals.slice(0, limit)) {
      const b = el("span", name, `sig ${SIGNAL_CLASS[name] || ""}`);
      b.title = why;
      wrap.appendChild(b);
    }
    return wrap;
  }

  const share = (p) => (p.pos === "RB" ? (p.rush_share || 0) + (p.tgt_share || 0) : p.pos === "QB" ? p.rush_share : p.tgt_share);

  // ---------------------------------------------------------------- //
  // Players table
  // ---------------------------------------------------------------- //
  const COLS = [
    ["player", "Player", false], ["pos", "Pos", false], ["owner", "Team", false], ["value", "Value", true],
    ["ppg", "PPG", true], ["xfp_pg", "xFP", true], ["fpoe_pg", "FPOE", true], ["snap", "Snap%", true],
    ["share", "Share%", true], ["wopr", "WOPR", true], ["starter_rate", "Start%", true], ["usage_trend", "Trend", true],
    ["signals", "Signals", false],
  ];

  function filtered() {
    const q = state.q.trim().toLowerCase();
    return A.players.filter((p) =>
      (state.pos === "ALL" || p.pos === state.pos)
      && (state.owner === "all" || (state.owner === "rostered" && p.owner) || (state.owner === "fa" && !p.owner) || String(p.owner) === state.owner)
      && (!state.signal || p.signals.some((s) => s[0] === state.signal))
      && (!q || p.name.toLowerCase().includes(q))
      && (p.games > 0 || p.owner));
  }

  function sortVal(p, key) {
    if (key === "share") return share(p);
    if (key === "player") return p.name;
    if (key === "owner") return p.owner ? teamName(p.owner) : "~";
    return p[key];
  }

  function renderTable() {
    const rows = filtered().sort((a, b) => {
      const x = sortVal(a, state.sort), y = sortVal(b, state.sort);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x > y ? 1 : -1) * state.dir;
    });
    const table = el("table", null, "an-table");
    const head = el("tr");
    for (const [key, label, num] of COLS) {
      const th = el("th", label, num ? "num" : "");
      if (key !== "signals") {
        th.classList.add("sortable");
        if (state.sort === key) th.classList.add(state.dir < 0 ? "desc" : "asc");
        th.addEventListener("click", () => {
          state.dir = state.sort === key ? -state.dir : (num ? -1 : 1);
          state.sort = key;
          renderTable();
        });
      }
      head.appendChild(th);
    }
    table.appendChild(el("thead")).appendChild(head);
    const body = el("tbody");
    for (const p of rows.slice(0, state.shown)) {
      const tr = el("tr");
      tr.tabIndex = 0;
      tr.addEventListener("click", () => openPlayer(p.id));
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") openPlayer(p.id); });
      const who = el("td");
      const w = el("div", null, "player");
      w.appendChild(headshot(p));
      const t = el("div");
      t.appendChild(el("div", p.name, "team"));
      t.appendChild(el("div", `${p.nfl || "FA"} · ${p.age ? p.age.toFixed(1) : "—"} yrs`, "owner"));
      w.appendChild(t);
      who.appendChild(w);
      tr.appendChild(who);
      tr.appendChild(el("td", p.pos, "pos"));
      const own = el("td");
      if (p.owner) { own.appendChild(dot(p.owner)); own.appendChild(document.createTextNode(" " + teamName(p.owner))); }
      else own.appendChild(el("span", "Free agent", "up small"));
      tr.appendChild(own);
      tr.appendChild(el("td", p.value ? `${p.value.toLocaleString()}${p.value_rank ? ` · ${p.pos}${p.value_rank}` : ""}` : "—", "num"));
      tr.appendChild(el("td", p.ppg !== null ? `${fmt(p.ppg)}${p.ppg_rank ? ` · ${p.pos}${p.ppg_rank}` : ""}` : "—", "num"));
      tr.appendChild(el("td", fmt(p.xfp_pg), "num"));
      tr.appendChild(el("td", signed(p.fpoe_pg), `num ${p.fpoe_pg >= 2 ? "up" : p.fpoe_pg <= -2 ? "down" : ""}`));
      tr.appendChild(el("td", fmt(p.snap, 0), "num"));
      tr.appendChild(el("td", fmt(share(p), 1), "num"));
      tr.appendChild(el("td", fmt(p.wopr, 2), "num"));
      tr.appendChild(el("td", fmt(p.starter_rate, 0), "num"));
      tr.appendChild(el("td", p.usage_trend === null ? "—" : `${p.usage_trend > 0 ? "▲" : p.usage_trend < 0 ? "▼" : ""}${Math.abs(p.usage_trend).toFixed(1)}`,
        `num ${p.usage_trend >= 3 ? "up" : p.usage_trend <= -3 ? "down" : "muted"}`));
      const sig = el("td");
      sig.appendChild(badges(p, 2));
      tr.appendChild(sig);
      body.appendChild(tr);
    }
    table.appendChild(body);
    const host = document.getElementById("players-table");
    host.replaceChildren(table);
    if (rows.length > state.shown) {
      const more = el("button", `Show more (${rows.length - state.shown})`, "chip");
      more.type = "button";
      more.addEventListener("click", () => { state.shown += 60; renderTable(); });
      host.appendChild(more);
    }
    document.getElementById("table-note").textContent =
      `${rows.length} players · click a column to sort, a row for the full profile. Share% is target share (rush + target share for RBs, rush share for QBs).`;
  }

  // ---------------------------------------------------------------- //
  // Player profile
  // ---------------------------------------------------------------- //
  function tile(label, value, sub) {
    const box = el("div", null, "stat");
    box.appendChild(el("div", label, "label"));
    box.appendChild(el("div", value, "value"));
    if (sub) box.appendChild(el("div", sub, "owner"));
    return box;
  }

  function group(title, tiles) {
    const g = el("div", null, "an-group");
    g.appendChild(el("div", title, "group-title"));
    const grid = el("div", null, "stats");
    tiles.filter(Boolean).forEach((t) => grid.appendChild(t));
    g.appendChild(grid);
    return g;
  }

  function lineChart(canvas, labels, datasets, yOpts) {
    const chart = new Chart(canvas, {
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { borderWidth: 1, padding: 10 } },
        scales: { x: { grid: {}, ticks: {} }, y: Object.assign({ grid: {}, ticks: {} }, yOpts || {}) },
      },
    });
    themeChart(chart);
    chart.options.plugins.legend.labels.color = cssVar("--muted");
    chart.update("none");
    charts.push(chart);
    return chart;
  }

  function openPlayer(id, scroll = true) {
    const p = A.players.find((x) => x.id === id);
    if (!p) return;
    history.replaceState(null, "", `analytics.html?player=${encodeURIComponent(id)}`);
    charts.forEach((c) => c.destroy());
    charts = [];
    const host = document.getElementById("detail");
    host.hidden = false;
    host.replaceChildren();

    const head = el("div", null, "an-head");
    head.appendChild(headshot(p, "an-photo"));
    const t = el("div");
    t.appendChild(el("h2", p.name, "an-name"));
    const sub = el("p", null, "team-sub");
    sub.append(`${p.pos} · ${p.nfl || "FA"} · ${p.age ? p.age.toFixed(1) + " yrs" : ""} · ${p.exp !== null ? `${p.exp} yrs exp` : ""} · ${p.draft} · `);
    if (p.owner) sub.appendChild(teamLink(p.owner, teamName(p.owner)));
    else sub.appendChild(el("span", "Free agent in HIM", "up"));
    t.appendChild(sub);
    t.appendChild(badges(p, 8));
    head.appendChild(t);
    const close = el("button", "✕", "remove an-close");
    close.type = "button";
    close.setAttribute("aria-label", "Close profile");
    close.addEventListener("click", () => { host.hidden = true; history.replaceState(null, "", "analytics.html"); });
    head.appendChild(close);
    host.appendChild(head);

    if (p.signals.length) {
      const ul = el("ul", null, "notes");
      p.signals.forEach(([name, why]) => {
        const li = el("li");
        li.appendChild(el("strong", `${name}: `));
        li.appendChild(document.createTextNode(why));
        ul.appendChild(li);
      });
      host.appendChild(ul);
    }

    const yearsLeft = p.age ? p.decline_age - p.age : null;
    host.appendChild(group("Dynasty", [
      tile("Dynasty value", p.value ? p.value.toLocaleString() : "—", p.value_rank ? `${p.pos}${p.value_rank} in value` : null),
      tile("Production rank", p.ppg_rank ? `${p.pos}${p.ppg_rank}` : "—", p.value_rank && p.ppg_rank ? (Math.abs(p.value_rank - p.ppg_rank) <= 2 ? "in line with dynasty value" : `${p.value_rank > p.ppg_rank ? "outproducing" : "underproducing"} dynasty value by ${Math.abs(p.value_rank - p.ppg_rank)} spots`) : null),
      tile("Age", p.age ? p.age.toFixed(1) : "—", yearsLeft === null ? null : yearsLeft > 0 ? `${yearsLeft.toFixed(1)} yrs before typical ${p.pos} decline (${p.decline_age})` : `past typical ${p.pos} decline age (${p.decline_age})`),
      tile("Draft capital", p.draft),
    ]));
    host.appendChild(group("Production", [
      tile("Points per game", fmt(p.ppg), `${p.games} games · ${fmt(p.total)} total`),
      tile("Weekly starter", fmt(p.starter_rate, 0, "%"), `top ${A.thresholds.starter[p.pos]} ${p.pos} weeks`),
      tile("Boom weeks", fmt(p.boom_rate, 0, "%"), `${A.thresholds.boom[p.pos]}+ points`),
      tile("Bust weeks", fmt(p.bust_rate, 0, "%"), `under ${A.thresholds.bust[p.pos]} points`),
    ]));
    host.appendChild(group("Expected points (usage)", [
      tile("xFP per game", fmt(p.xfp_pg), p.xfp_pg_rank ? `${p.pos}${p.xfp_pg_rank} in usage` : null),
      tile("Over expected", signed(p.fpoe_pg), p.fpoe_pg === null ? null : p.fpoe_pg >= 2 ? "running hot" : p.fpoe_pg <= -2 ? "running cold" : "about right"),
    ]));
    if (p.pos === "QB") {
      host.appendChild(group("Passing", [
        tile("EPA / dropback", fmt(p.epa_db, 2)), tile("CPOE", signed(p.cpoe)), tile("Yards / attempt", fmt(p.ypa)),
        tile("Rush share", fmt(p.rush_share, 1, "%"), "of team carries"), tile("Snap share", fmt(p.snap, 0, "%")),
      ]));
    } else {
      host.appendChild(group("Opportunity", [
        tile("Snap share", fmt(p.snap, 0, "%"), p.snap_trend !== null ? `${signed(p.snap_trend)} last 2 games` : null),
        p.pos === "RB" ? tile("Rush share", fmt(p.rush_share, 1, "%"), `${fmt(p.car_pg)} carries a game`) : null,
        tile("Target share", fmt(p.tgt_share, 1, "%"), `${fmt(p.tgt_pg)} targets a game`),
        p.pos !== "RB" ? tile("Air-yards share", fmt(p.air_share, 1, "%")) : null,
        tile("WOPR", fmt(p.wopr, 2), "weighted target + air-yards share"),
      ]));
      host.appendChild(group("Efficiency", [
        tile("Catch rate", fmt(p.catch, 0, "%")), tile("Yards / target", fmt(p.ypt)),
        p.pos === "RB" ? tile("Yards / carry", fmt(p.ypc)) : tile("aDOT", fmt(p.adot), "avg depth of target"),
        tile("YAC / catch", fmt(p.yac_rec)), tile("EPA / target", fmt(p.epa_tgt, 2)),
        p.pos === "RB" ? tile("EPA / carry", fmt(p.epa_car, 2)) : null,
        tile("Broken tackles", p.btk === null ? "—" : String(p.btk)), tile("Drops", p.drops === null ? "—" : String(p.drops)),
      ]));
    }

    if (p.weekly.length && typeof Chart !== "undefined") {
      const charts2 = el("div", null, "an-charts");
      const c1 = el("div", null, "chart-card");
      c1.appendChild(Object.assign(el("div", null, "chart-head"), {})).appendChild(el("h3", "Points vs expected"));
      const b1 = el("div", null, "chart-box");
      const cv1 = el("canvas");
      b1.appendChild(cv1);
      c1.appendChild(b1);
      const c2 = el("div", null, "chart-card");
      c2.appendChild(el("div", null, "chart-head")).appendChild(el("h3", "Usage by week"));
      const b2 = el("div", null, "chart-box");
      const cv2 = el("canvas");
      b2.appendChild(cv2);
      c2.appendChild(b2);
      charts2.append(c1, c2);
      host.appendChild(charts2);
      const labels = p.weekly.map((w) => `Wk ${w.w}`);
      const red = cssVar("--red"), muted = cssVar("--muted"), text = cssVar("--text"), good = cssVar("--good");
      lineChart(cv1, labels, [
        { type: "bar", label: "Points (league scoring)", data: p.weekly.map((w) => w.pts), backgroundColor: withAlpha(red, "cc"), borderColor: red },
        { type: "line", label: "Expected (xFP)", data: p.weekly.map((w) => w.xfp), borderColor: text, backgroundColor: text, borderDash: [5, 4], pointRadius: 3 },
      ]);
      lineChart(cv2, labels, [
        { type: "line", label: "Snap %", data: p.weekly.map((w) => w.snap), borderColor: muted, backgroundColor: muted, pointRadius: 3 },
        { type: "line", label: p.pos === "RB" ? "Rush + target share %" : "Target share %", data: p.weekly.map((w) => w.share), borderColor: good, backgroundColor: good, pointRadius: 3 },
      ], { min: 0, max: 100, ticks: { callback: (v) => `${v}%` } });
      window.HIM.initExpand && window.HIM.initExpand();
    }
    if (scroll) host.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------------------------------------------------------------- //
  // Teams view
  // ---------------------------------------------------------------- //
  function renderTeams() {
    const rows = Object.keys(latest.teams).map((rid) => {
      const mine = A.players.filter((p) => String(p.owner) === rid && p.games > 0);
      const sum = (k) => mine.reduce((s, p) => s + ((p[k] || 0) * (k === "fpoe_pg" ? 1 : 1)), 0);
      const top = (pos, n) => mine.filter((p) => p.pos === pos).sort((a, b) => (b.ppg || 0) - (a.ppg || 0)).slice(0, n);
      const core = [...top("QB", 1), ...top("RB", 3), ...top("WR", 3), ...top("TE", 1)];
      const ts = trade && trade.teams ? trade.teams[rid] : {};
      return {
        rid,
        corePpg: core.reduce((s, p) => s + (p.ppg || 0), 0),
        coreXfp: core.reduce((s, p) => s + (p.xfp_pg || 0), 0),
        fpoe: core.reduce((s, p) => s + (p.fpoe_pg || 0), 0),
        age: ts.avg_age, vage: ts.value_age,
        buy: mine.filter((p) => p.signals.some((s) => s[0] === "Buy low")).map((p) => p.name),
        sell: mine.filter((p) => p.signals.some((s) => s[0] === "Sell high" || s[0] === "Running hot")).map((p) => p.name),
        cliff: mine.filter((p) => p.signals.some((s) => s[0] === "Age cliff")).length,
      };
    }).sort((a, b) => b.coreXfp - a.coreXfp);
    const table = el("table");
    const head = el("tr");
    [["Team", 0], ["Core PPG", 1], ["Core xFP", 1], ["Over exp.", 1], ["Avg age", 1], ["Value age", 1], ["Age-cliff", 1], ["Buy low", 0], ["Running hot / sell", 0]]
      .forEach(([l, n]) => head.appendChild(el("th", l, n ? "num" : "")));
    table.appendChild(el("thead")).appendChild(head);
    const body = el("tbody");
    for (const r of rows) {
      const tr = el("tr");
      const c = el("td");
      const w = el("div", null, "teamcell");
      w.appendChild(dot(Number(r.rid)));
      w.appendChild(teamLink(Number(r.rid), teamName(r.rid)));
      c.appendChild(w);
      tr.appendChild(c);
      tr.appendChild(el("td", r.corePpg.toFixed(1), "num"));
      tr.appendChild(el("td", r.coreXfp.toFixed(1), "num"));
      tr.appendChild(el("td", signed(r.fpoe), `num ${r.fpoe >= 4 ? "up" : r.fpoe <= -4 ? "down" : ""}`));
      tr.appendChild(el("td", fmt(r.age), "num"));
      tr.appendChild(el("td", fmt(r.vage), "num"));
      tr.appendChild(el("td", String(r.cliff), "num"));
      tr.appendChild(el("td", r.buy.join(", ") || "—", "small wrap"));
      tr.appendChild(el("td", r.sell.join(", ") || "—", "small wrap"));
      body.appendChild(tr);
    }
    table.appendChild(body);
    document.getElementById("teams-table").replaceChildren(table);
  }

  // ---------------------------------------------------------------- //
  function renderControls() {
    const pos = document.getElementById("pos-tabs");
    pos.replaceChildren();
    for (const v of ["ALL", "QB", "RB", "WR", "TE"]) {
      const b = el("button", v === "ALL" ? "All" : v, v === state.pos ? "chip is-current" : "chip");
      b.type = "button";
      b.addEventListener("click", () => { state.pos = v; state.shown = 60; renderControls(); renderTable(); });
      pos.appendChild(b);
    }
  }

  function setupFilters() {
    const owner = document.getElementById("owner-filter");
    const add = (sel, value, label) => { const o = el("option", label); o.value = value; sel.appendChild(o); };
    add(owner, "all", "All players");
    add(owner, "rostered", "Rostered in HIM");
    add(owner, "fa", "Free agents");
    Object.entries(latest.teams).sort((a, b) => a[1].team.localeCompare(b[1].team)).forEach(([rid, t]) => add(owner, rid, t.team.trim()));
    owner.addEventListener("change", () => { state.owner = owner.value; state.shown = 60; renderTable(); });
    const sig = document.getElementById("signal-filter");
    add(sig, "", "Any");
    Object.keys(SIGNAL_CLASS).forEach((s) => add(sig, s, s));
    sig.addEventListener("change", () => { state.signal = sig.value; state.shown = 60; renderTable(); });
    const q = document.getElementById("search");
    q.addEventListener("input", () => { state.q = q.value; state.shown = 60; renderTable(); });
    document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
      document.querySelectorAll("[data-view]").forEach((x) => x.classList.toggle("is-current", x === b));
      document.getElementById("players-view").hidden = b.dataset.view !== "players";
      document.getElementById("teams-view").hidden = b.dataset.view !== "teams";
      if (b.dataset.view === "teams") renderTeams();
    }));
  }

  function renderGlossary() {
    const items = [
      ["PPG", "Fantasy points per game with this league's scoring (full PPR)."],
      ["xFP", "Expected fantasy points per game from ffopportunity: what an average player would score with the same targets, carries, field position, and depth of target."],
      ["FPOE", "Points over expected per game (actual minus xFP, PPR). Big positive numbers tend to cool off; big negative numbers tend to bounce back."],
      ["Snap%", "Share of the team's offensive snaps (nflverse snap counts)."],
      ["Share%", "Target share for WR/TE; rush share plus target share for RBs; rush share for QBs."],
      ["WOPR", "Weighted opportunity rating: 1.5 × target share + 0.7 × air-yards share. Around 0.7+ is an alpha receiver."],
      ["Start%", "Weeks finishing as a startable fantasy starter: top 12 QB/TE, top 24 RB/WR."],
      ["Trend", "Change in opportunity share over the last two games versus the season."],
      ["Value", "DynastyProcess 1-QB dynasty trade value and positional rank."],
      ["Signals", "Buy low, Sell high, Rising/Falling usage, Running hot/cold, Age cliff, Ascending, Market undervalues, Living on name value. Hover a badge for the reason."],
    ];
    document.getElementById("glossary").replaceChildren(...items.flatMap(([k, v]) => [el("dt", k), el("dd", v)]));
  }

  async function load() {
    try {
      const get = (u) => fetch(u, { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
      [A, latest, trade] = await Promise.all([get("data/analytics.json"), window.HIM.loadData(), get("data/trade.json").catch(() => null)]);
    } catch (err) {
      document.getElementById("updated").textContent = `Analytics appear after the next morning update (${err.message}).`;
      return;
    }
    assignColors(latest.standings.map((t) => t.roster_id));
    document.getElementById("updated").textContent =
      `${A.season} season · weeks ${A.weeks[0] || "—"}–${A.weeks[A.weeks.length - 1] || "—"} · ${A.players.length} players · updated ${new Date(A.generated_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · nflverse + ffopportunity`;
    setupFilters();
    renderControls();
    renderTable();
    renderGlossary();
    const pid = new URLSearchParams(location.search).get("player");
    const team = new URLSearchParams(location.search).get("team");
    if (team && latest.teams[team]) { state.owner = team; document.getElementById("owner-filter").value = team; renderTable(); }
    if (pid) openPlayer(pid, false);
    document.addEventListener("him-themechange", () => {
      const open = new URLSearchParams(location.search).get("player");
      if (open) openPlayer(open, false);
    });
  }

  load();
})();
