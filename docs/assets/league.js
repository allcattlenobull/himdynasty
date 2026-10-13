/* HIM Dynasty league page.
   Renders standings, bracket, draft order, and week-by-week charts from
   data/latest.json. Clicking a team anywhere focuses it everywhere.
   Team and owner names come from Sleeper, so they are only ever set with
   textContent, never parsed as HTML. */
(() => {
  "use strict";

  const PALETTE = [
    "#ff3b30", "#ff9f0a", "#ffd60a", "#30d158", "#00c7be", "#64d2ff",
    "#0a84ff", "#7d7aff", "#bf5af2", "#ff4fa3", "#d9b48f", "#e5e5ea",
    "#a2845e", "#8e8e93", "#66d4cf", "#ffb3a7",
  ];

  const state = { data: null, focus: null, charts: [], colors: {} };

  // ------------------------------------------------------------------ //
  // Helpers
  // ------------------------------------------------------------------ //
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function dot(rid) {
    const d = el("span", null, "dot");
    d.style.background = state.colors[rid] || "#888";
    return d;
  }

  function teamCell(row) {
    const td = el("td");
    const wrap = el("div", null, "teamcell");
    wrap.appendChild(dot(row.roster_id));
    const text = el("div");
    text.appendChild(el("div", row.team, "team"));
    text.appendChild(el("div", row.owner, "owner"));
    wrap.appendChild(text);
    td.appendChild(wrap);
    return td;
  }

  function oddsCell(value) {
    const td = el("td");
    const bar = el("span", null, "bar");
    const fill = el("span");
    fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
    bar.appendChild(fill);
    td.appendChild(bar);
    td.appendChild(document.createTextNode(`${value.toFixed(1)}%`));
    return td;
  }

  function focusable(node, rid) {
    node.dataset.rid = rid;
    node.addEventListener("click", () => setFocus(rid));
    return node;
  }

  function fail(id, message) {
    const target = document.getElementById(id);
    if (target) target.replaceChildren(el("p", message, "error"));
  }

  // ------------------------------------------------------------------ //
  // Focus
  // ------------------------------------------------------------------ //
  function setFocus(rid) {
    state.focus = state.focus === rid ? null : rid;
    applyFocus();
  }

  function styleDataset(ds) {
    const c = state.colors[ds.rid];
    const focused = state.focus === ds.rid;
    const on = state.focus === null || focused;
    ds.borderColor = on ? c : `${c}2e`;
    ds.backgroundColor = on ? c : `${c}2e`;
    ds.pointBorderColor = on ? c : `${c}2e`;
    ds.borderWidth = focused ? 4 : on ? 2.25 : 1.25;
    ds.pointRadius = focused ? 5 : on ? 2.5 : 0;
    ds.order = focused ? 0 : 1;
  }

  function applyFocus() {
    document.querySelectorAll("[data-rid]").forEach((node) => {
      const rid = Number(node.dataset.rid);
      node.classList.toggle("is-focus", state.focus === rid);
      node.classList.toggle("is-dim", state.focus !== null && state.focus !== rid);
      if (node.classList.contains("chip")) node.setAttribute("aria-pressed", String(state.focus === rid));
    });
    for (const chart of state.charts) {
      chart.data.datasets.forEach(styleDataset);
      chart.update("none");
    }
  }

  // ------------------------------------------------------------------ //
  // Chips
  // ------------------------------------------------------------------ //
  function renderChips(standings) {
    const box = document.getElementById("chips");
    const all = el("button", "All", "chip all");
    all.type = "button";
    all.addEventListener("click", () => { state.focus = null; applyFocus(); });
    box.replaceChildren(all);
    for (const row of standings) {
      const chip = el("button", null, "chip");
      chip.type = "button";
      chip.title = `${row.team} (${row.owner})`;
      chip.appendChild(dot(row.roster_id));
      chip.appendChild(document.createTextNode(row.team));
      box.appendChild(focusable(chip, row.roster_id));
    }
  }

  // ------------------------------------------------------------------ //
  // Tables
  // ------------------------------------------------------------------ //
  function header(labels) {
    const thead = el("thead");
    const tr = el("tr");
    for (const [label, right] of labels) tr.appendChild(el("th", label, right ? "num" : ""));
    thead.appendChild(tr);
    return thead;
  }

  function renderStandings(rows, playoffTeams) {
    const table = el("table");
    table.appendChild(header([
      ["#", true], ["Team", false], ["Record", true], ["PF", true], ["PA", true],
      ["Max PF", true], ["Proj W", true], ["Playoff", false], ["Champ", true],
    ]));
    const body = el("tbody");
    rows.forEach((row, i) => {
      const tr = focusable(el("tr"), row.roster_id);
      if (i === playoffTeams - 1) tr.classList.add("cutline");
      tr.appendChild(el("td", row.rank, "num rank"));
      tr.appendChild(teamCell(row));
      const record = row.ties ? `${row.wins}-${row.losses}-${row.ties}` : `${row.wins}-${row.losses}`;
      tr.appendChild(el("td", record, "num"));
      tr.appendChild(el("td", row.points_for.toFixed(1), "num"));
      tr.appendChild(el("td", row.points_against.toFixed(1), "num"));
      tr.appendChild(el("td", row.max_pf.toFixed(1), "num"));
      tr.appendChild(el("td", row.projected_wins.toFixed(1), "num"));
      tr.appendChild(oddsCell(row.playoff_odds));
      tr.appendChild(el("td", `${row.champion_odds.toFixed(1)}%`, "num"));
      body.appendChild(tr);
    });
    table.appendChild(body);
    const frag = document.createDocumentFragment();
    frag.appendChild(table);
    frag.appendChild(el("div", "▲ Playoff line", "cut-label"));
    return frag;
  }

  function renderDraft(rows, playoffTeams) {
    const table = el("table");
    table.appendChild(header([["Pick", true], ["Team", false], ["Max PF", true], ["vs #1", true], ["Playoff", false]]));
    const top = rows.length ? rows[0].max_pf : 0;
    const lastNonPlayoff = rows.length - playoffTeams - 1;
    const body = el("tbody");
    rows.forEach((row, i) => {
      const tr = focusable(el("tr"), row.roster_id);
      if (i === lastNonPlayoff) tr.classList.add("cutline");
      tr.appendChild(el("td", i + 1, "num rank"));
      tr.appendChild(teamCell(row));
      tr.appendChild(el("td", row.max_pf.toFixed(1), "num"));
      tr.appendChild(el("td", i === 0 ? "—" : `+${(row.max_pf - top).toFixed(1)}`, "num gap"));
      tr.appendChild(oddsCell(row.playoff_odds));
      body.appendChild(tr);
    });
    table.appendChild(body);
    const frag = document.createDocumentFragment();
    frag.appendChild(table);
    frag.appendChild(el("div", "▲ Non-playoff picks · Playoff teams ▼", "cut-label"));
    return frag;
  }

  // ------------------------------------------------------------------ //
  // Bracket
  // ------------------------------------------------------------------ //
  function renderSide(side, won, pct) {
    const row = focusable(el("div", null, won ? "side winner" : "side"), side.roster_id);
    row.appendChild(el("span", side.seed ? `#${side.seed}` : "", "seed"));
    row.appendChild(dot(side.roster_id));
    row.appendChild(el("span", side.team, "name"));
    row.appendChild(el("span", pct, "pct"));
    return row;
  }

  function renderBracket(rounds) {
    const wrap = el("div", null, "bracket");
    for (const round of rounds) {
      const col = el("div", null, "round");
      col.appendChild(el("h3", round.name));
      for (const g of round.games) {
        const box = el("div", null, "game");
        box.appendChild(renderSide(g.a, g.winner === g.a.roster_id, `${g.a_win_pct.toFixed(0)}%`));
        box.appendChild(renderSide(g.b, g.winner === g.b.roster_id, `${(100 - g.a_win_pct).toFixed(0)}%`));
        box.appendChild(el("div", g.status === "final" ? "Final" : "Projected", `status ${g.status}`));
        col.appendChild(box);
      }
      wrap.appendChild(col);
    }
    return wrap;
  }

  // ------------------------------------------------------------------ //
  // Charts
  // ------------------------------------------------------------------ //
  function setupChartDefaults() {
    Chart.defaults.color = "#9a9aa6";
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 12;
  }

  function buildChart(canvasId, key, opts) {
    const canvas = document.getElementById(canvasId);
    const history = state.data.history;
    if (!history || !history.weeks.length) {
      canvas.parentElement.replaceChildren(el("p", "The trend starts after week 1 is final.", "chart-empty"));
      return;
    }
    const labels = history.weeks.map((w) => `Wk ${w}`);
    const datasets = history.teams.map((t) => {
      const ds = {
        label: t.team,
        rid: t.roster_id,
        data: history.series[String(t.roster_id)][key],
        cubicInterpolationMode: "monotone",
        fill: false,
        pointHoverRadius: 7,
        pointHitRadius: 10,
      };
      styleDataset(ds);
      return ds;
    });

    const grid = "rgba(255,255,255,0.06)";
    const chart = new Chart(canvas, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 450 },
        interaction: { mode: "index", intersect: false },
        layout: { padding: { top: 6, right: 8 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#0b0b0d",
            borderColor: "#e3121b",
            borderWidth: 1,
            padding: 10,
            boxPadding: 4,
            usePointStyle: true,
            titleFont: { weight: "700" },
            filter: (item) => state.focus === null || item.dataset.rid === state.focus,
            itemSort: (a, b) => (opts.reverse ? a.parsed.y - b.parsed.y : b.parsed.y - a.parsed.y),
            callbacks: {
              label: (item) => ` ${item.dataset.label}: ${opts.format(item.parsed.y)}`,
              labelColor: (item) => {
                const c = state.colors[item.dataset.rid];
                return { borderColor: c, backgroundColor: c };
              },
            },
          },
        },
        scales: {
          x: { grid: { color: grid }, ticks: { color: "#9a9aa6" } },
          y: {
            reverse: !!opts.reverse,
            min: opts.min,
            max: opts.max,
            grid: { color: grid },
            ticks: {
              color: "#9a9aa6",
              stepSize: opts.step,
              callback: (v) => (opts.tick ? opts.tick(v) : v),
            },
            title: opts.title ? { display: true, text: opts.title, color: "#9a9aa6" } : undefined,
          },
        },
        onClick: (evt, _elements, c) => {
          const hits = c.getElementsAtEventForMode(evt, "nearest", { intersect: true }, false);
          if (hits.length) setFocus(c.data.datasets[hits[0].datasetIndex].rid);
        },
      },
    });
    state.charts.push(chart);
  }

  // ------------------------------------------------------------------ //
  // Load
  // ------------------------------------------------------------------ //
  async function load() {
    let data;
    try {
      const res = await fetch("data/latest.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      const msg = `Could not load league data (${err.message}).`;
      ["standings-table", "bracket", "draft-table"].forEach((id) => fail(id, msg));
      document.getElementById("updated").textContent = "Data unavailable";
      return;
    }
    state.data = data;

    const ids = (data.history && data.history.teams.length ? data.history.teams : data.standings)
      .map((t) => t.roster_id)
      .sort((a, b) => a - b);
    ids.forEach((rid, i) => { state.colors[rid] = PALETTE[i % PALETTE.length]; });

    const n = data.standings.length;
    const playoffTeams = data.league.playoff_teams;
    const when = new Date(data.generated_at);
    const week = data.league.weeks_completed;
    document.getElementById("updated").textContent =
      `${data.league.name || "League"} · ${data.league.season} · ` +
      `${week ? `through week ${week}` : "preseason"} · updated ${when.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;

    renderChips(data.standings);
    document.getElementById("standings-table").replaceChildren(renderStandings(data.standings, playoffTeams));
    document.getElementById("seeds").textContent =
      "Current seeds: " + data.playoffs.seeds.map((s) => `${s.seed}. ${s.team}`).join("  ·  ");
    document.getElementById("bracket").replaceChildren(renderBracket(data.playoffs.rounds));
    document.getElementById("draft-table").replaceChildren(renderDraft(data.draft.projected_order, playoffTeams));

    if (typeof Chart === "undefined") {
      ["chart-rank", "chart-odds", "chart-pick"].forEach((id) => {
        const c = document.getElementById(id);
        if (c) c.parentElement.replaceChildren(el("p", "Charts could not load.", "chart-empty"));
      });
    } else {
      setupChartDefaults();
      buildChart("chart-rank", "rank", {
        reverse: true, min: 1, max: n, step: 1, format: (v) => `#${v}`, title: "Rank",
      });
      buildChart("chart-odds", "playoff_odds", {
        min: 0, max: 100, step: 20, format: (v) => `${v.toFixed(1)}%`, tick: (v) => `${v}%`,
      });
      buildChart("chart-pick", "avg_pick", {
        reverse: true, min: 1, max: n, step: 1, format: (v) => `pick ${v.toFixed(1)}`, title: "Avg pick",
      });
    }
    applyFocus();
  }

  load();
})();
