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

  let dataPromise = null;
  function loadData() {
    if (!dataPromise) {
      dataPromise = fetch("data/latest.json", { cache: "no-store" }).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      });
      dataPromise.catch(() => { dataPromise = null; });
    }
    return dataPromise;
  }

  function updatedText(data) {
    const when = new Date(data.generated_at);
    const week = data.league.weeks_completed;
    return `${data.league.name || "League"} · ${data.league.season} · ` +
      `${week ? `through week ${week}` : "preseason"} · updated ` +
      when.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  // Full-screen charts: every .chart-card gets an Expand button. Uses a fixed
  // overlay (not the Fullscreen API) so it also works on iPhone Safari.
  let expandOpen = null;
  let expandKeyBound = false;
  function initExpand() {
    const close = () => {
      const open = expandOpen;
      if (!open) return;
      open.card.classList.remove("is-expanded");
      open.button.textContent = "⤢ Expand";
      open.button.setAttribute("aria-expanded", "false");
      document.body.classList.remove("no-scroll");
      expandOpen = null;
    };
    document.querySelectorAll(".chart-card").forEach((card) => {
      let head = card.querySelector(".chart-head");
      if (!head) {
        head = el("div", null, "chart-head");
        card.insertBefore(head, card.firstChild);
      }
      if (head.querySelector(".expand-btn")) return;
      const button = el("button", "⤢ Expand", "expand-btn");
      button.type = "button";
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("click", () => {
        if (expandOpen && expandOpen.card === card) { close(); return; }
        close();
        card.classList.add("is-expanded");
        document.body.classList.add("no-scroll");
        button.textContent = "✕ Close";
        button.setAttribute("aria-expanded", "true");
        expandOpen = { card, button };
      });
      head.appendChild(button);
    });
    if (!expandKeyBound) {
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
      expandKeyBound = true;
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initExpand);
  else initExpand();

  // ---------------------------------------------------------------- //
  // Shared header: brand, main nav, Teams menu, theme, and a phone menu.
  // Rendered synchronously (before DOMContentLoaded) so theme.js mounts the
  // theme switches inside it.
  // ---------------------------------------------------------------- //
  const NAV = [["League", "league.html"], ["Mock", "draft.html"], ["Trade", "trade.html"],
    ["Analytics", "analytics.html"], ["Buzz", "buzz.html"]];

  function renderHeader() {
    const header = document.querySelector("[data-topbar]");
    if (!header) return;
    const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    const row = el("div", null, "topbar-row");

    const brand = el("a", null, "brand");
    brand.href = "index.html";
    brand.setAttribute("aria-label", "HIM Dynasty home");
    const logo = el("img");
    logo.src = "assets/logo.svg"; logo.alt = ""; logo.width = 40; logo.height = 40;
    const wm = el("span", null, "wordmark");
    wm.append(el("span", "HIM", "wm-him"), el("span", "DYNASTY", "wm-dyn"));
    brand.append(logo, wm);
    row.appendChild(brand);

    const navLinks = (cls) => NAV.map(([label, href]) => {
      const a = el("a", label, cls);
      a.href = href;
      if (page === href) a.setAttribute("aria-current", "page");
      return a;
    });

    // Desktop nav
    const nav = el("nav", null, "nav");
    nav.setAttribute("aria-label", "Main");
    nav.append(...navLinks(""));
    const teamsWrap = el("div", null, "nav-teams");
    const teamsBtn = el("button", "Teams ▾", "nav-btn");
    teamsBtn.type = "button";
    teamsBtn.setAttribute("aria-haspopup", "true");
    teamsBtn.setAttribute("aria-expanded", "false");
    if (page === "team.html") teamsBtn.setAttribute("aria-current", "page");
    const teamsMenu = el("div", null, "teams-menu");
    teamsMenu.hidden = true;
    teamsMenu.setAttribute("data-teams-list", "");
    teamsWrap.append(teamsBtn, teamsMenu);
    nav.appendChild(teamsWrap);
    row.appendChild(nav);

    const theme = el("div", null, "desk-theme");
    theme.setAttribute("data-theme-toggle", "");
    row.appendChild(theme);

    // Phone menu button
    const menuBtn = el("button", null, "menu-btn");
    menuBtn.type = "button";
    menuBtn.setAttribute("aria-label", "Menu");
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.innerHTML = '<span></span><span></span><span></span>';
    row.appendChild(menuBtn);
    header.replaceChildren(row);

    const panel = el("div", null, "mobile-menu");
    panel.hidden = true;
    panel.id = "mobile-menu";
    menuBtn.setAttribute("aria-controls", panel.id);
    const mnav = el("nav", null, "mm-nav");
    mnav.setAttribute("aria-label", "Main");
    mnav.append(...navLinks(""));
    panel.appendChild(mnav);
    panel.appendChild(el("div", "Teams", "mm-label"));
    const mteams = el("div", null, "mm-teams");
    mteams.setAttribute("data-teams-list", "");
    panel.appendChild(mteams);
    const mtheme = el("div", null, "mm-theme");
    mtheme.appendChild(el("span", "Theme", "mm-label"));
    const mt = el("div");
    mt.setAttribute("data-theme-toggle", "");
    mtheme.appendChild(mt);
    panel.appendChild(mtheme);
    header.appendChild(panel);

    const closeAll = () => {
      teamsMenu.hidden = true; teamsBtn.setAttribute("aria-expanded", "false");
      panel.hidden = true; menuBtn.setAttribute("aria-expanded", "false");
      document.body.classList.remove("menu-open");
    };
    teamsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = teamsMenu.hidden;
      teamsMenu.hidden = !open;
      teamsBtn.setAttribute("aria-expanded", String(open));
    });
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = panel.hidden;
      panel.hidden = !open;
      menuBtn.setAttribute("aria-expanded", String(open));
      document.body.classList.toggle("menu-open", open);
    });
    document.addEventListener("click", (e) => { if (!header.contains(e.target)) closeAll(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });

    loadData().then((data) => {
      const current = page === "team.html" ? new URLSearchParams(location.search).get("id") : null;
      const teams = Object.entries(data.teams || {}).map(([rid, t]) => ({ rid, name: t.team.trim() }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      const ids = (data.history && data.history.teams.length ? data.history.teams : data.standings).map((t) => t.roster_id);
      assignColors(ids);
      document.querySelectorAll("[data-teams-list]").forEach((host) => {
        host.replaceChildren(...teams.map((t) => {
          const a = el("a", null, "tm-link");
          a.href = teamHref(t.rid);
          if (t.rid === current) a.setAttribute("aria-current", "page");
          a.appendChild(dot(Number(t.rid)));
          a.appendChild(el("span", t.name));
          return a;
        }));
      });
    }).catch(() => {});
  }
  renderHeader();

  return { initExpand, el, cssVar, assignColors, teamVar, teamColor, dot, teamHref, teamLink, oddsCell, withAlpha, chartTheme, themeChart, loadData, updatedText };
})();
