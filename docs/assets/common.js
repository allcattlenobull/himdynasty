/* Shared helpers for the league and team pages.
   Team colors come from CSS variables (--t0..--t15) so they follow the theme.
   Names from Sleeper are always set with textContent, never parsed as HTML. */
window.HIM = (() => {
  "use strict";

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const colorIdx = {};
  function assignColors(ids) {
    ids.slice().sort((a, b) => a - b).forEach((rid, i) => { colorIdx[rid] = i % 16; });
  }
  const teamVar = (rid) => `var(--t${colorIdx[rid] ?? 13})`;
  const teamColor = (rid) => cssVar(`--t${colorIdx[rid] ?? 13}`);

  function dot(rid) {
    const d = el("span", null, "dot");
    d.style.background = teamVar(rid);
    return d;
  }

  function teamHref(rid) {
    return `team.html?id=${encodeURIComponent(rid)}`;
  }

  function teamLink(rid, name, className = "team") {
    const a = el("a", name, className);
    a.href = teamHref(rid);
    a.addEventListener("click", (e) => e.stopPropagation());
    return a;
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

  function withAlpha(hex, alpha) {
    return /^#[0-9a-f]{6}$/i.test(hex) ? hex + alpha : hex;
  }

  function chartTheme() {
    return {
      text: cssVar("--muted"),
      grid: cssVar("--grid"),
      tooltipBg: cssVar("--tooltip-bg"),
      tooltipText: cssVar("--text"),
      red: cssVar("--red"),
    };
  }

  // Recolor axes, grid, and tooltip of a chart to the current theme.
  function themeChart(chart) {
    const t = chartTheme();
    const o = chart.options;
    for (const axis of Object.values(o.scales || {})) {
      if (axis.ticks) axis.ticks.color = t.text;
      if (axis.grid) axis.grid.color = t.grid;
      if (axis.title) axis.title.color = t.text;
    }
    const tip = o.plugins.tooltip;
    tip.backgroundColor = t.tooltipBg;
    tip.titleColor = t.tooltipText;
    tip.bodyColor = t.tooltipText;
    tip.borderColor = t.red;
  }

  async function loadData() {
    const res = await fetch("data/latest.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function updatedText(data) {
    const when = new Date(data.generated_at);
    const week = data.league.weeks_completed;
    return `${data.league.name || "League"} · ${data.league.season} · ` +
      `${week ? `through week ${week}` : "preseason"} · updated ` +
      when.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  return { el, cssVar, assignColors, teamVar, teamColor, dot, teamHref, teamLink, oddsCell, withAlpha, chartTheme, themeChart, loadData, updatedText };
})();
