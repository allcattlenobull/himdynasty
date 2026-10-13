/* HIM Dynasty league page.
   Standings, bracket, draft order, and week-by-week charts from data/latest.json.
   Clicking a row, line, chip, or bracket slot focuses that team everywhere;
   clicking a team name opens its team page. */
(() => {
  "use strict";
  const { el, dot, teamLink, oddsCell, withAlpha, teamColor, themeChart, assignColors, loadData, updatedText } = window.HIM;

  const state = { data: null, focus: null, charts: [] };

  function teamCell(row) {
    const td = el("td");
    const wrap = el("div", null, "teamcell");
    wrap.appendChild(dot(row.roster_id));
    const text = el("div");
    const name = el("div");
    name.appendChild(teamLink(row.roster_id, row.team));
    text.appendChild(name);
    text.appendChild(el("div", row.owner, "owner"));
    wrap.appendChild(text);
    td.appendChild(wrap);
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
    const c = teamColor(ds.rid);
    const focused = state.focus === ds.rid;
    const on = state.focus === null || focused;
    const faded = withAlpha(c, "2e");
    ds.borderColor = on ? c : faded;
    ds.backgroundColor = on ? c : faded;
    ds.pointBorderColor = on ? c : faded;
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

  function retheme() {
    if (typeof Chart === "undefined") return;
    Chart.defaults.color = window.HIM.chartTheme().text;
    for (const chart of state.charts) {
      themeChart(chart);
      chart.data.datasets.forEach(styleDataset);
      chart.update("none");
    }
  }
  document.addEventListener("him-themechange", retheme);

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
    table.appendChild(header([["Pick", true], ["Team", false], ["Max PF", true], ["vs #1", true], ["#1 pick", false]]));
    const top = rows.length ? rows[0].max_pf : 0;
    const lastNonPlayoff = rows.length - playoffTeams - 1;
    const body = el("tbody");
    rows.forEach((row, i) => {
      const tr = focusable(el("tr"), row.roster_id);
      if (i === lastNonPlayoff) tr.classList.add("cutline");
      tr.appendChild(el("td", i + 1, "num rank"));
      tr.appendChild(teamCell(row));
      tr.appendChild(el("td", row.max_pf.toFixed(1), "num"));
      const diff = row.max_pf - top;
      tr.appendChild(el("td", i === 0 ? "—" : `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}`, "num gap"));
      tr.appendChild(oddsCell(row.first_pick_odds ?? 0));
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
    row.appendChild(teamLink(side.roster_id, side.team, "name team"));
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
                const c = teamColor(item.dataset.rid);
                return { borderColor: c, backgroundColor: c };
              },
            },
          },
        },
        scales: {
          x: { grid: {}, ticks: {} },
          y: {
            reverse: !!opts.reverse,
            min: opts.min,
            max: opts.max,
            grid: {},
            ticks: { stepSize: opts.step, callback: (v) => (opts.tick ? opts.tick(v) : v) },
            title: opts.title ? { display: true, text: opts.title } : undefined,
          },
        },
        onClick: (evt, _elements, c) => {
          const hits = c.getElementsAtEventForMode(evt, "nearest", { intersect: true }, false);
          if (hits.length) setFocus(c.data.datasets[hits[0].datasetIndex].rid);
        },
      },
    });
    themeChart(chart);
    chart.update("none");
    state.charts.push(chart);
  }

  // ------------------------------------------------------------------ //
  // Load
  // ------------------------------------------------------------------ //
  async function load() {
    let data;
    try {
      data = await loadData();
    } catch (err) {
      const msg = `Could not load league data (${err.message}).`;
      ["standings-table", "bracket", "draft-table"].forEach((id) => fail(id, msg));
      document.getElementById("updated").textContent = "Data unavailable";
      return;
    }
    state.data = data;
    assignColors((data.history && data.history.teams.length ? data.history.teams : data.standings).map((t) => t.roster_id));

    const n = data.standings.length;
    const playoffTeams = data.league.playoff_teams;
    document.getElementById("updated").textContent = updatedText(data);

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
      Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
      Chart.defaults.font.size = 12;
      Chart.defaults.color = window.HIM.chartTheme().text;
      buildChart("chart-rank", "rank", {
        reverse: true, min: 1, max: n, step: 1, format: (v) => `#${v}`, title: "Rank",
      });
      buildChart("chart-odds", "playoff_odds", {
        min: 0, max: 100, step: 20, format: (v) => `${v.toFixed(1)}%`, tick: (v) => `${v}%`,
      });
      const pickKey = data.history && data.history.teams.length &&
        data.history.series[String(data.history.teams[0].roster_id)].draft_slot ? "draft_slot" : "avg_pick";
      buildChart("chart-pick", pickKey, {
        reverse: true, min: 1, max: n, step: 1, format: (v) => `pick ${Math.round(v * 10) / 10}`, title: "Pick",
      });
    }
    applyFocus();
  }

  load();
})();
