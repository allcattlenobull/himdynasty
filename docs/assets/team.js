/* HIM Dynasty team page: team.html?id=<roster_id>
   Header stats, roster, schedule (past, current, upcoming), and season trend. */
(() => {
  "use strict";
  const { el, dot, teamLink, teamVar, teamColor, themeChart, assignColors, loadData, updatedText, cssVar, withAlpha } = window.HIM;

  const SLOT_LABELS = {
    SUPER_FLEX: "SF", FLEX: "FLEX", WRRB_FLEX: "W/R", REC_FLEX: "W/T", IDP_FLEX: "IDP",
  };
  let chart = null;
  let trend = null;

  const safeUrl = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : null);

  function img(src, className, alt = "") {
    const i = el("img", null, className);
    i.alt = alt;
    i.loading = "lazy";
    i.src = src;
    i.addEventListener("error", () => { i.style.visibility = "hidden"; });
    return i;
  }

  function headshot(p) {
    const src = p.pos === "DEF"
      ? `https://sleepercdn.com/images/team_logos/nfl/${encodeURIComponent(String(p.id).toLowerCase())}.png`
      : `https://sleepercdn.com/content/nfl/players/thumb/${encodeURIComponent(p.id)}.jpg`;
    return img(src, "headshot");
  }

  // ------------------------------------------------------------------ //
  // Header
  // ------------------------------------------------------------------ //
  function stat(label, value) {
    const box = el("div", null, "stat");
    box.appendChild(el("div", label, "label"));
    box.appendChild(el("div", value, "value"));
    return box;
  }

  function renderHero(t, playoffTeams, ts) {
    const hero = document.getElementById("hero");
    hero.style.setProperty("--team-color", teamVar(t.roster_id));
    hero.replaceChildren();

    const avatarUrl = safeUrl(t.avatar);
    if (avatarUrl) {
      const a = img(avatarUrl, "team-avatar", `${t.team} avatar`);
      hero.appendChild(a);
    } else {
      hero.appendChild(el("div", (t.team || "?").trim().charAt(0).toUpperCase(), "team-avatar fallback"));
    }

    const text = el("div");
    text.appendChild(el("h1", t.team, "team-title"));
    const buzz = el("a", "Team Buzz →", "chip buzz-link");
    buzz.href = `buzz.html?team=${encodeURIComponent(t.roster_id)}`;
    const r = t.record;
    const record = r.ties ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
    const inPlayoffs = t.rank <= playoffTeams ? "in playoff position" : "outside the playoffs";
    text.appendChild(el("p", `${t.owner} · ${record} · #${t.rank} in the league, ${inPlayoffs}`, "team-sub"));
    text.appendChild(buzz);
    hero.appendChild(text);

    const stats = el("div", null, "stats");
    stats.append(
      stat("Rank", `#${t.rank}`),
      stat("Record", record),
      stat("PF", t.points_for.toFixed(1)),
      stat("Max PF", t.max_pf.toFixed(1)),
      stat("Playoff", `${t.playoff_odds.toFixed(1)}%`),
      stat("Title", `${t.champion_odds.toFixed(1)}%`),
      stat("#1 pick", `${t.first_pick_odds.toFixed(1)}%`),
      stat("Proj pick", t.draft_slot ? `#${t.draft_slot}` : t.avg_pick.toFixed(1)),
    );
    if (ts) {
      stats.append(
        stat("Avg age", ts.avg_age ? `${ts.avg_age}` : "—"),
        stat("Value age", ts.value_age ? `${ts.value_age}` : "—"),
        stat("Dynasty value", `#${ts.value_rank}`),
        stat("Picks owned", String(ts.picks.length)),
      );
    }
    hero.appendChild(stats);
  }

  // ------------------------------------------------------------------ //
  // The Verdict (analysis)
  // ------------------------------------------------------------------ //
  function renderAnalysis(a, when) {
    const panel = document.getElementById("analysis");
    if (!a) return;
    panel.hidden = false;
    const row = document.getElementById("verdict");
    row.replaceChildren();
    const badge = el("div", null, `verdict-badge ${a.score >= 58 ? "him" : a.score < 42 ? "ass" : "mid"}`);
    badge.appendChild(el("div", String(a.score), "verdict-score"));
    badge.appendChild(el("div", "HIM score", "label"));
    row.appendChild(badge);
    const text = el("div");
    text.appendChild(el("div", a.verdict, "verdict"));
    text.appendChild(el("p", a.summary, "muted"));
    row.appendChild(text);
    const fill = (id, list) => {
      const ul = document.getElementById(id);
      ul.replaceChildren(...list.map((t) => el("li", t)));
    };
    fill("him-list", a.him);
    fill("ass-list", a.ass);
    document.getElementById("analysis-note").textContent =
      `Written by The Analyst: generated automatically from league data every morning, so every line is backed by a number. Updated ${new Date(when).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.`;
  }

  // ------------------------------------------------------------------ //
  // Player analytics (nflverse)
  // ------------------------------------------------------------------ //
  function renderPlayerAnalytics(A, rid) {
    const mine = A.players.filter((p) => p.owner === rid);
    if (!mine.length) return;
    document.getElementById("player-analytics").hidden = false;
    const order = { QB: 0, RB: 1, WR: 2, TE: 3 };
    mine.sort((a, b) => (order[a.pos] - order[b.pos]) || ((b.ppg || 0) - (a.ppg || 0)));
    const f = (v, d = 1) => (v === null || v === undefined ? "—" : Number(v).toFixed(d));
    const share = (p) => (p.pos === "RB" ? (p.rush_share || 0) + (p.tgt_share || 0) : p.pos === "QB" ? p.rush_share : p.tgt_share);
    const table = el("table");
    const head = el("tr");
    [["Player", 0], ["Pos", 0], ["Age", 1], ["PPG", 1], ["xFP", 1], ["FPOE", 1], ["Snap%", 1], ["Share%", 1], ["Start%", 1], ["Value", 1], ["Signals", 0]]
      .forEach(([l, n]) => head.appendChild(el("th", l, n ? "num" : "")));
    table.appendChild(el("thead")).appendChild(head);
    const body = el("tbody");
    for (const p of mine) {
      const tr = el("tr");
      const td = el("td");
      const a = el("a", p.name, "team");
      a.href = `analytics.html?player=${encodeURIComponent(p.id)}`;
      td.appendChild(a);
      tr.appendChild(td);
      tr.appendChild(el("td", p.pos, "pos"));
      tr.appendChild(el("td", f(p.age), "num"));
      tr.appendChild(el("td", p.ppg === null ? "—" : `${f(p.ppg)}${p.ppg_rank ? ` · ${p.pos}${p.ppg_rank}` : ""}`, "num"));
      tr.appendChild(el("td", f(p.xfp_pg), "num"));
      const fp = p.fpoe_pg;
      tr.appendChild(el("td", fp === null ? "—" : `${fp > 0 ? "+" : ""}${f(fp)}`, `num ${fp >= 2 ? "up" : fp <= -2 ? "down" : ""}`));
      tr.appendChild(el("td", f(p.snap, 0), "num"));
      tr.appendChild(el("td", f(share(p)), "num"));
      tr.appendChild(el("td", f(p.starter_rate, 0), "num"));
      tr.appendChild(el("td", p.value ? p.value.toLocaleString() : "—", "num"));
      const sig = el("td", null, "small wrap");
      sig.textContent = p.signals.map((s) => s[0]).join(", ") || "—";
      if (p.signals.length) sig.title = p.signals.map((s) => `${s[0]}: ${s[1]}`).join("\n");
      tr.appendChild(sig);
      body.appendChild(tr);
    }
    table.appendChild(body);
    document.getElementById("pa-table").replaceChildren(table);
    const buy = mine.filter((p) => p.signals.some((s) => s[0] === "Buy low")).map((p) => p.name);
    const sell = mine.filter((p) => p.signals.some((s) => s[0] === "Sell high" || s[0] === "Running hot")).map((p) => p.name);
    const parts = [];
    if (sell.length) parts.push(`Running hot / sell candidates: ${sell.join(", ")}.`);
    if (buy.length) parts.push(`Buy-low types already here: ${buy.join(", ")}.`);
    if (parts.length) document.getElementById("pa-note").textContent = parts.join(" ") + " Click a player for the full profile.";
  }

  // ------------------------------------------------------------------ //
  // Draft picks
  // ------------------------------------------------------------------ //
  function renderPicks(ts, trade, rid) {
    const host = document.getElementById("picks");
    if (!ts) {
      host.replaceChildren(el("p", "Pick data appears after the next update.", "muted"));
      return;
    }
    const byId = Object.fromEntries(trade.assets.map((a) => [a.id, a]));
    const picks = ts.picks.map((id) => byId[id]).filter(Boolean);
    host.replaceChildren();
    if (!picks.length) {
      host.appendChild(el("p", "No draft picks owned.", "muted"));
    }
    for (const a of picks) {
      const acquired = a.original !== rid;
      const chip = el("div", null, acquired ? "pick-chip acquired" : "pick-chip");
      chip.appendChild(el("div", a.slot ? `${a.season} ${a.round}.${String(a.slot).padStart(2, "0")}` : `${a.season} Round ${a.round}`, "label"));
      chip.appendChild(el("div", acquired ? `via ${a.original_team.trim()}` : "Own pick", "owner"));
      chip.appendChild(el("div", `Value ${Math.round(a.value).toLocaleString()}`, "owner"));
      host.appendChild(chip);
    }
    document.getElementById("picks-note").textContent =
      `${picks.length} picks worth ${Math.round(ts.picks_value).toLocaleString()} in dynasty value. Green edge = acquired in a trade. Next year's picks show the projected slot; later years use generic round values.`;
  }

  // ------------------------------------------------------------------ //
  // Roster
  // ------------------------------------------------------------------ //
  function playerRow(label, p) {
    const tr = el("tr");
    const posCell = el("td");
    posCell.appendChild(el("span", label, "pos"));
    tr.appendChild(posCell);
    const cell = el("td");
    if (p) {
      const wrap = el("div", null, "player");
      wrap.appendChild(headshot(p));
      const name = el("span", p.name, "team");
      wrap.appendChild(name);
      if (p.injury) wrap.appendChild(el("span", p.injury, "inj"));
      cell.appendChild(wrap);
    } else {
      cell.appendChild(el("span", "Empty", "muted"));
    }
    tr.appendChild(cell);
    tr.appendChild(el("td", p ? p.nfl : "", "muted"));
    tr.appendChild(el("td", p && p.age ? p.age : "—", "num"));
    tr.appendChild(el("td", p ? p.pts.toFixed(1) : "", "num"));
    tr.appendChild(el("td", p && p.last !== null && p.last !== undefined ? p.last.toFixed(1) : "—", "num muted"));
    return tr;
  }

  function sectionRow(label, count) {
    const tr = el("tr", null, "section-row");
    const td = el("td", count === undefined ? label : `${label} (${count})`);
    td.colSpan = 6;
    tr.appendChild(td);
    return tr;
  }

  function renderRoster(roster) {
    const table = el("table");
    const head = el("tr");
    [["Pos", false], ["Player", false], ["NFL", false], ["Age", true], ["Pts", true], ["Last", true]]
      .forEach(([label, right]) => head.appendChild(el("th", label, right ? "num" : "")));
    table.appendChild(el("thead")).appendChild(head);

    const body = el("tbody");
    body.appendChild(sectionRow("Starters"));
    for (const s of roster.starters) body.appendChild(playerRow(SLOT_LABELS[s.slot] || s.slot, s.player));
    body.appendChild(sectionRow("Bench", roster.bench.length));
    for (const p of roster.bench) body.appendChild(playerRow(p.pos, p));
    if (roster.taxi.length) {
      body.appendChild(sectionRow("Taxi", roster.taxi.length));
      for (const p of roster.taxi) body.appendChild(playerRow(p.pos, p));
    }
    if (roster.ir.length) {
      body.appendChild(sectionRow("IR", roster.ir.length));
      for (const p of roster.ir) body.appendChild(playerRow(p.pos, p));
    }
    table.appendChild(body);
    return table;
  }

  // ------------------------------------------------------------------ //
  // Schedule
  // ------------------------------------------------------------------ //
  function renderSchedule(games, playoffStart) {
    const table = el("table");
    const head = el("tr");
    [["Wk", true], ["Opponent", false], ["", false], ["Score", true], ["", true]]
      .forEach(([label, right]) => head.appendChild(el("th", label, right ? "num" : "")));
    table.appendChild(el("thead")).appendChild(head);

    const body = el("tbody");
    let currentMarked = false;
    for (const g of games) {
      const tr = el("tr");
      tr.appendChild(el("td", g.week, "num rank"));
      if (g.status === "bye") {
        tr.appendChild(el("td", "Bye", "muted"));
        tr.append(el("td"), el("td"), el("td"));
        body.appendChild(tr);
        continue;
      }
      if (g.status !== "final" && !currentMarked) {
        tr.classList.add("is-current");
        currentMarked = true;
      }

      const opp = el("td");
      const wrap = el("div", null, "teamcell");
      wrap.appendChild(dot(g.opponent));
      const names = el("div");
      const n = el("div");
      n.appendChild(teamLink(g.opponent, g.opponent_team));
      names.appendChild(n);
      names.appendChild(el("div", g.opponent_owner, "owner"));
      wrap.appendChild(names);
      opp.appendChild(wrap);
      tr.appendChild(opp);

      const res = el("td");
      if (g.status === "final") res.appendChild(el("span", g.result, `badge ${g.result.toLowerCase()}`));
      else if (g.status === "live") res.appendChild(el("span", "Live", "badge live"));
      tr.appendChild(res);

      if (g.status === "upcoming") {
        tr.appendChild(el("td", "—", "num muted"));
        tr.appendChild(el("td", `${g.win_pct.toFixed(0)}% to win`, "num muted"));
      } else {
        tr.appendChild(el("td", `${g.points.toFixed(1)} – ${g.opp_points.toFixed(1)}`, "num"));
        tr.appendChild(el("td", g.status === "final" ? `max ${g.max.toFixed(1)}` : `${g.win_pct.toFixed(0)}% to win`, "num muted"));
      }
      body.appendChild(tr);
    }
    const tail = el("tr", null, "section-row");
    const td = el("td", `Playoffs begin week ${playoffStart}`);
    td.colSpan = 5;
    tail.appendChild(td);
    body.appendChild(tail);
    table.appendChild(body);
    return table;
  }

  // ------------------------------------------------------------------ //
  // Trend chart
  // ------------------------------------------------------------------ //
  function trendDatasets() {
    const c = teamColor(trend.rid);
    const muted = cssVar("--muted");
    return [
      { label: "Playoff odds", data: trend.series.playoff_odds, borderColor: c, backgroundColor: c, borderWidth: 3, pointRadius: 3 },
      { label: "Title odds", data: trend.series.champion_odds, borderColor: withAlpha(c, "aa"), backgroundColor: withAlpha(c, "aa"), borderDash: [6, 4], borderWidth: 2, pointRadius: 2 },
      { label: "#1 pick odds", data: trend.series.first_pick_odds || [], borderColor: muted, backgroundColor: muted, borderDash: [2, 4], borderWidth: 2, pointRadius: 2 },
    ].map((d) => Object.assign(d, { cubicInterpolationMode: "monotone", fill: false }));
  }

  function renderTrend(history, rid) {
    const canvas = document.getElementById("chart-team");
    if (typeof Chart === "undefined" || !history || !history.weeks.length) {
      canvas.parentElement.replaceChildren(el("p", "The trend starts after week 1 is final.", "chart-empty"));
      return;
    }
    trend = { rid, series: history.series[String(rid)] };
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = window.HIM.chartTheme().text;
    chart = new Chart(canvas, {
      type: "line",
      data: { labels: history.weeks.map((w) => `Wk ${w}`), datasets: trendDatasets() },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } },
          tooltip: {
            borderWidth: 1, padding: 10, usePointStyle: true,
            callbacks: { label: (item) => ` ${item.dataset.label}: ${item.parsed.y.toFixed(1)}%` },
          },
        },
        scales: {
          x: { grid: {}, ticks: {} },
          y: { min: 0, max: 100, grid: {}, ticks: { stepSize: 20, callback: (v) => `${v}%` } },
        },
      },
    });
    themeChart(chart);
    chart.update("none");
  }

  document.addEventListener("him-themechange", () => {
    if (!chart) return;
    Chart.defaults.color = window.HIM.chartTheme().text;
    chart.options.plugins.legend.labels.color = window.HIM.chartTheme().text;
    themeChart(chart);
    chart.data.datasets = trendDatasets();
    chart.update("none");
  });

  // ------------------------------------------------------------------ //
  // Load
  // ------------------------------------------------------------------ //
  function renderChips(standings, currentId) {
    const box = document.getElementById("chips");
    if (!box) return;
    box.replaceChildren();
    for (const row of standings) {
      const a = el("a", null, "chip");
      a.href = window.HIM.teamHref(row.roster_id);
      a.title = `${row.team} (${row.owner})`;
      if (String(row.roster_id) === currentId) {
        a.classList.add("is-current");
        a.setAttribute("aria-current", "page");
      }
      a.appendChild(dot(row.roster_id));
      a.appendChild(document.createTextNode(row.team));
      box.appendChild(a);
    }
    const current = box.querySelector(".is-current");
    if (current) current.scrollIntoView({ block: "nearest", inline: "center" });
  }

  async function load() {
    let data;
    let trade = null;
    let analysis = null;
    let analytics = null;
    try {
      const get = (u) => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      [data, trade, analysis, analytics] = await Promise.all([loadData(), get("data/trade.json"), get("data/analysis.json"), get("data/analytics.json")]);
    } catch (err) {
      document.getElementById("hero").replaceChildren(el("p", `Could not load league data (${err.message}).`, "error"));
      return;
    }
    const pages = data.teams || {};
    assignColors((data.history && data.history.teams.length ? data.history.teams : data.standings).map((t) => t.roster_id));

    let id = new URLSearchParams(location.search).get("id");
    if (!pages[id]) id = String(data.standings[0].roster_id);
    const t = pages[id];
    if (t) {
      const slot = (data.draft.projected_order || []).find((r) => String(r.roster_id) === id);
      if (slot) t.draft_slot = slot.slot;
    }
    if (!t) {
      document.getElementById("hero").replaceChildren(el("p", "Team pages appear after the next data update.", "muted"));
      return;
    }
    document.title = `${t.team} · HIM Dynasty`;

    renderChips(data.standings, id);
    const ts = trade && trade.teams ? trade.teams[id] : null;
    renderHero(t, data.league.playoff_teams, ts);
    renderPicks(ts, trade, Number(id));
    if (analysis && analysis.teams) renderAnalysis(analysis.teams[id], analysis.generated_at);
    if (analytics) renderPlayerAnalytics(analytics, Number(id));
    document.getElementById("roster").replaceChildren(renderRoster(t.roster));
    document.getElementById("schedule").replaceChildren(renderSchedule(t.schedule, t.playoffs_start_week));
    renderTrend(data.history, t.roster_id);
    document.getElementById("updated").textContent = updatedText(data);
  }

  load();
})();
