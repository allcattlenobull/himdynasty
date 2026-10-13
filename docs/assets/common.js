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
      dataPromise = fetch("data/latest.json", { cache: "no-cache" }).then((res) => {
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
    ["Analytics", "analytics.html"], ["Buzz", "buzz.html"], ["History", "history.html"]];

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

  // ---------------------------------------------------------------- //
  // Score ticker: NFL games, this league's matchups, NFL headlines.
  // Live from ESPN and Sleeper in the browser; cached for a minute across
  // pages so moving around the site doesn't refetch.
  // ---------------------------------------------------------------- //
  const ESPN_BOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
  const ESPN_NEWS = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=15";
  const SLEEPER_API = "https://api.sleeper.app/v1";

  async function cachedJson(url, maxAgeMs) {
    const key = `him-tk:${url}`;
    try {
      const hit = JSON.parse(sessionStorage.getItem(key) || "null");
      if (hit && Date.now() - hit.t < maxAgeMs) return hit.d;
    } catch (e) { /* storage off */ }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d })); } catch (e) { /* full or off */ }
    return d;
  }

  function slimBoard(b) {
    return (b.events || []).map((e) => {
      const c = (e.competitions || [])[0] || {};
      const st = (e.status || {}).type || {};
      const side = (ha) => {
        const t = (c.competitors || []).find((x) => x.homeAway === ha) || {};
        return { abbr: (t.team || {}).abbreviation || "", score: t.score, logo: (t.team || {}).logo || "",
          winner: !!t.winner, poss: !!((c.situation || {}).possession && (c.situation || {}).possession === (t.team || {}).id) };
      };
      return {
        id: e.id, date: e.date, state: st.state, detail: st.shortDetail || st.detail || "",
        away: side("away"), home: side("home"),
        tv: ((c.broadcasts || [])[0] || {}).names ? c.broadcasts[0].names[0] : "",
        link: ((e.links || []).find((l) => (l.rel || []).includes("summary")) || {}).href || "",
        red: !!((c.situation || {}).isRedZone),
      };
    });
  }

  async function tickerData() {
    const out = { games: [], week: null, label: "", him: [], himWeek: null, news: [] };
    const jobs = [];
    jobs.push((async () => {
      const b = await cachedJson(ESPN_BOARD, 60000);
      let games = slimBoard(b);
      out.week = (b.week || {}).number;
      // Tuesday/Wednesday: the default board still shows last week. Show the
      // upcoming slate first, then last week's finals.
      if (games.length && games.every((g) => g.state === "post") && out.week) {
        try {
          const nb = await cachedJson(`${ESPN_BOARD}?week=${out.week + 1}&seasontype=${(b.season || {}).type || 2}&dates=${(b.season || {}).year || ""}`, 300000);
          const next = slimBoard(nb).filter((g) => g.state !== "post");
          if (next.length) { out.next = next; out.nextWeek = out.week + 1; }
        } catch (e) { /* next week not posted yet */ }
      }
      out.games = games;
    })());
    jobs.push((async () => {
      const n = await cachedJson(ESPN_NEWS, 300000);
      out.news = (n.articles || []).filter((a) => a.headline).slice(0, 12)
        .map((a) => ({ text: a.headline, link: (((a.links || {}).web) || {}).href || "" }));
    })());
    jobs.push((async () => {
      const data = await loadData();
      const state = await cachedJson(`${SLEEPER_API}/state/nfl`, 600000);
      const wk = Number(state.display_week || state.week || 0);
      if (!wk || !data.league || !data.league.id) return;
      const ms = await cachedJson(`${SLEEPER_API}/league/${data.league.id}/matchups/${wk}`, 60000);
      const by = {};
      (ms || []).forEach((m) => { if (m.matchup_id) (by[m.matchup_id] = by[m.matchup_id] || []).push(m); });
      out.himWeek = wk;
      out.him = Object.values(by).filter((p) => p.length === 2).map(([a, b]) => ({
        a: { rid: a.roster_id, name: (data.teams[a.roster_id] || {}).team || `Team ${a.roster_id}`, pts: a.points || 0 },
        b: { rid: b.roster_id, name: (data.teams[b.roster_id] || {}).team || `Team ${b.roster_id}`, pts: b.points || 0 },
      }));
    })());
    await Promise.allSettled(jobs);
    return out;
  }

  function gameTime(g) {
    const d = new Date(g.date);
    if (isNaN(d)) return g.detail;
    return d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  }

  function tickerItems(d) {
    const items = [];
    const label = (txt) => items.push(el("span", txt, "tk-label"));
    const game = (g) => {
      const a = el(g.link ? "a" : "span", null, `tk-game tk-${g.state}`);
      if (g.link) { a.href = g.link; a.target = "_blank"; a.rel = "noopener"; }
      const team = (t) => {
        const w = el("span", null, `tk-team${g.state === "post" && t.winner ? " win" : ""}`);
        if (t.logo) { const i = el("img"); i.alt = ""; i.width = 18; i.height = 18; i.loading = "lazy"; i.addEventListener("error", () => i.remove()); i.src = t.logo; w.appendChild(i); }
        w.appendChild(el("span", t.abbr, "tk-abbr"));
        if (g.state !== "pre") w.appendChild(el("span", t.score ?? "", "tk-score"));
        if (g.state === "in" && t.poss) w.appendChild(el("span", "●", "tk-poss"));
        return w;
      };
      a.append(team(g.away), team(g.home));
      const st = g.state === "pre" ? `${gameTime(g)}${g.tv ? ` · ${g.tv}` : ""}` : g.detail;
      a.appendChild(el("span", st, `tk-status${g.state === "in" ? " live" : ""}${g.red ? " rz" : ""}`));
      items.push(a);
    };
    const live = d.games.filter((g) => g.state === "in");
    const pre = d.games.filter((g) => g.state === "pre").sort((x, y) => x.date.localeCompare(y.date));
    const post = d.games.filter((g) => g.state === "post");
    if (live.length) { label("NFL · LIVE"); live.forEach(game); }
    if (d.next && d.next.length) { label(`NFL · WEEK ${d.nextWeek}`); d.next.sort((x, y) => x.date.localeCompare(y.date)).forEach(game); }
    if (pre.length) { label(`NFL · WEEK ${d.week} · UPCOMING`); pre.forEach(game); }
    if (post.length) { label(`NFL · WEEK ${d.week} · FINAL`); post.forEach(game); }
    if (d.him.length) {
      label(`HIM · WEEK ${d.himWeek}`);
      d.him.forEach((m) => {
        const a = el("a", null, "tk-game tk-him");
        a.href = "league.html#matchups";
        const side = (t, other) => {
          const w = el("span", null, `tk-team${t.pts > other.pts ? " win" : ""}`);
          w.append(dot(t.rid), el("span", t.name.trim(), "tk-abbr tk-name"), el("span", t.pts ? t.pts.toFixed(1) : "0", "tk-score"));
          return w;
        };
        a.append(side(m.a, m.b), side(m.b, m.a));
        items.push(a);
      });
    }
    if (d.news.length) {
      label("NFL HEADLINES");
      d.news.forEach((n) => {
        const a = el(n.link ? "a" : "span", n.text, "tk-news");
        if (n.link) { a.href = n.link; a.target = "_blank"; a.rel = "noopener"; }
        items.push(a);
      });
    }
    return items;
  }

  function renderTicker() {
    const header = document.querySelector("[data-topbar]");
    if (!header || document.querySelector(".ticker")) return;
    const bar = el("div", null, "ticker");
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Scores and headlines");
    const track = el("div", null, "tk-track");
    bar.appendChild(track);
    header.parentNode.insertBefore(bar, header);
    let timer = 0;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    async function refresh() {
      clearTimeout(timer);
      let d;
      try { d = await tickerData(); } catch (e) { d = null; }
      const items = d ? tickerItems(d) : [];
      if (!items.length) { bar.hidden = true; timer = setTimeout(refresh, 300000); return; }
      bar.hidden = false;
      const run = el("div", null, "tk-run");
      run.append(...items);
      const runs = reduce ? [run] : [run, run.cloneNode(true)];
      if (runs[1]) runs[1].setAttribute("aria-hidden", "true");
      track.replaceChildren(...runs);
      if (!reduce) {
        requestAnimationFrame(() => {
          const w = run.scrollWidth;
          track.style.setProperty("--tk-dur", `${Math.max(30, w / 70)}s`);
          track.classList.add("tk-move");
        });
      }
      const live = d.games.some((g) => g.state === "in");
      timer = setTimeout(() => { if (!document.hidden) refresh(); else document.addEventListener("visibilitychange", refresh, { once: true }); }, live ? 60000 : 600000);
    }
    // Let the page's own content load first.
    (window.requestIdleCallback || ((f) => setTimeout(f, 300)))(refresh, { timeout: 1500 });
  }

  // Footer note when this morning's update had a problem.
  function dataStatus() {
    const foot = document.querySelector(".foot");
    if (!foot) return;
    fetch("data/status.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then((st) => {
      if (!st) return;
      const age = (Date.now() - new Date(st.checked)) / 3600000;
      const msg = st.failed && st.failed.length ? `This morning's update had trouble with: ${st.failed.join(", ")}. Those parts show the last good data.`
        : age > 36 ? `The daily update hasn't run since ${new Date(st.checked).toLocaleDateString()}.` : "";
      if (msg) foot.appendChild(el("div", msg, "data-status"));
    }).catch(() => {});
  }

  renderHeader();
  renderTicker();
  (window.requestIdleCallback || ((f) => setTimeout(f, 800)))(dataStatus);

  return { initExpand, el, cssVar, assignColors, teamVar, teamColor, dot, teamHref, teamLink, oddsCell, withAlpha, chartTheme, themeChart, loadData, updatedText };
})();
