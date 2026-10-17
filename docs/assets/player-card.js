/* Site-wide NFL player and defense cards.

   Fantasy points always come from this league's Sleeper matchup records, so
   custom scoring is preserved. ESPN supplies only NFL box-score statistics,
   team schedules, and news. */
(() => {
  "use strict";
  const { el, loadData } = window.HIM;
  const SLEEPER = "https://api.sleeper.app/v1";
  const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
  const ESPN_WEB = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl";
  const ESPN_PLAYER_NEWS = "https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?limit=20&playerId=";

  const requests = new Map();
  let supportPromise = null;
  let activeModal = null;
  let openToken = 0;

  function json(url, cache = "default") {
    if (!requests.has(url)) {
      const req = fetch(url, { cache }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
      req.catch(() => requests.delete(url));
      requests.set(url, req);
    }
    return requests.get(url);
  }

  function supportData() {
    if (!supportPromise) {
      supportPromise = Promise.all([
        loadData(),
        json("data/news.json", "no-cache").catch(() => ({ players: {}, items: [] })),
        json("data/analytics.json", "no-cache").catch(() => ({ players: [] })),
        json("data/players_lite.json", "no-cache").catch(() => ({})),
      ]).then(([latest, news, analytics, lite]) => ({ latest, news, analytics, lite }));
    }
    return supportPromise;
  }

  function rosterPlayers(latest) {
    const out = {};
    for (const [rid, team] of Object.entries(latest.teams || {})) {
      const r = team.roster || {};
      const all = (r.starters || []).map((x) => x.player).concat(r.bench || [], r.taxi || [], r.ir || []).filter(Boolean);
      for (const p of all) out[String(p.id)] = Object.assign({}, out[String(p.id)] || {}, p, { owner: Number(rid) });
    }
    return out;
  }

  async function resolvePlayer(input) {
    const base = typeof input === "string" ? { id: input } : Object.assign({}, input || {});
    base.id = String(base.id || "");
    const d = await supportData();
    const roster = rosterPlayers(d.latest);
    const analytics = (d.analytics.players || []).find((p) => String(p.id) === base.id) || {};
    const savedNews = (d.news.players || {})[base.id] || {};
    const lite = (d.lite || {})[base.id] || [];
    const p = Object.assign({
      name: lite[0] || (base.id ? `Player ${base.id}` : "NFL player"),
      pos: lite[1] || "",
      nfl: lite[2] || "",
    }, analytics, roster[base.id] || {}, savedNews, base);
    p.id = base.id;
    p.espn_id = p.espn_id || savedNews.espn_id || null;
    if (p.pos === "DEF" && !p.nfl) p.nfl = p.id;
    return { player: p, data: d };
  }

  function playerButton(id, name, className = "team", meta = {}) {
    const b = el("button", name, `nfl-player-link ${className}`.trim());
    b.type = "button";
    b.setAttribute("aria-label", `Open ${name} details`);
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPlayerCard(Object.assign({}, meta, { id: String(id), name }));
    });
    return b;
  }

  function headshot(p, cls = "pc-photo") {
    const img = el("img", null, cls);
    img.alt = "";
    img.loading = "lazy";
    img.src = p.pos === "DEF"
      ? `https://sleepercdn.com/images/team_logos/nfl/${encodeURIComponent(String(p.nfl || p.id).toLowerCase())}.png`
      : `https://sleepercdn.com/content/nfl/players/thumb/${encodeURIComponent(p.id)}.jpg`;
    img.addEventListener("error", () => { img.style.visibility = "hidden"; });
    return img;
  }

  function closeModal() {
    if (!activeModal) return;
    const { node, focus } = activeModal;
    activeModal = null;
    openToken += 1;
    node.classList.add("closing");
    document.body.classList.remove("no-scroll");
    setTimeout(() => node.remove(), 190);
    if (focus && document.contains(focus)) focus.focus({ preventScroll: true });
  }

  function tabButton(label, id, panels, tabs) {
    const b = el("button", label, "pc-tab");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => {
      for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== id;
      for (const [key, tab] of Object.entries(tabs)) {
        tab.classList.toggle("is-current", key === id);
        tab.setAttribute("aria-selected", String(key === id));
      }
    });
    return b;
  }

  function loadingPanel(label) {
    const p = el("section", null, "pc-panel");
    p.setAttribute("role", "tabpanel");
    p.appendChild(el("p", `Loading ${label}…`, "muted pc-loading"));
    return p;
  }

  function shell(initial) {
    closeModal();
    const focus = document.activeElement;
    const modal = el("div", null, "modal player-modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", `${initial.name || "NFL player"} details`);
    const box = el("div", null, "modal-box player-modal-box");
    const head = el("div", null, "modal-head pc-head");
    const identity = el("div", null, "pc-identity");
    identity.appendChild(el("h2", initial.name || "NFL player", "pc-name"));
    identity.appendChild(el("div", [initial.pos, initial.nfl].filter(Boolean).join(" · "), "owner pc-sub"));
    head.append(headshot(initial), identity);
    const x = el("button", "×", "modal-close");
    x.type = "button";
    x.setAttribute("aria-label", "Close player card");
    x.addEventListener("click", closeModal);
    head.appendChild(x);
    box.appendChild(head);

    const panels = { log: loadingPanel("game log"), schedule: loadingPanel("schedule"), news: loadingPanel("news") };
    panels.schedule.hidden = true;
    panels.news.hidden = true;
    const tabs = {};
    const tabbar = el("div", null, "pc-tabs");
    tabbar.setAttribute("role", "tablist");
    tabs.log = tabButton("Game log", "log", panels, tabs);
    tabs.schedule = tabButton("Schedule", "schedule", panels, tabs);
    tabs.news = tabButton("News", "news", panels, tabs);
    tabs.log.classList.add("is-current");
    tabs.log.setAttribute("aria-selected", "true");
    tabs.schedule.setAttribute("aria-selected", "false");
    tabs.news.setAttribute("aria-selected", "false");
    tabbar.append(tabs.log, tabs.schedule, tabs.news);
    box.appendChild(tabbar);
    const body = el("div", null, "pc-body");
    body.append(panels.log, panels.schedule, panels.news);
    box.appendChild(body);
    const foot = el("div", "Fantasy scores: Sleeper · HIM Dynasty scoring. NFL stats, schedule and news: ESPN.", "modal-foot pc-source");
    box.appendChild(foot);
    modal.appendChild(box);
    modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
    document.body.appendChild(modal);
    document.body.classList.add("no-scroll");
    x.focus({ preventScroll: true });
    activeModal = { node: modal, focus };
    return { modal, identity, panels, foot };
  }

  function sleeperThroughWeek(latest, state) {
    const lg = latest.league || {};
    let week = Math.max(1, Number(lg.weeks_completed || 0) + 1);
    if (state && String(state.season) === String(lg.season)) week = Math.max(week, Number(state.display_week || state.week || 0));
    return Math.min(Number(lg.last_week || 18), week);
  }

  async function sleeperLog(p, latest) {
    const state = await json(`${SLEEPER}/state/nfl`).catch(() => null);
    const first = Number((latest.league || {}).start_week || 1);
    const last = sleeperThroughWeek(latest, state);
    const weeks = [];
    for (let w = first; w <= last; w++) weeks.push(w);
    const results = await Promise.all(weeks.map((w) =>
      json(`${SLEEPER}/league/${encodeURIComponent(latest.league.id)}/matchups/${w}`, "no-store")
        .then((rows) => [w, rows]).catch(() => [w, []])));
    const out = [];
    for (const [week, rows] of results) {
      const m = (rows || []).find((row) =>
        Object.prototype.hasOwnProperty.call(row.players_points || {}, p.id) || (row.players || []).map(String).includes(p.id));
      if (!m) continue;
      const raw = (m.players_points || {})[p.id];
      out.push({
        week,
        points: typeof raw === "number" ? raw : raw === undefined ? null : Number(raw),
        started: (m.starters || []).map(String).includes(p.id),
      });
    }
    return out;
  }

  function scheduleRows(data, nfl) {
    const out = [];
    for (const event of (data && data.events) || []) {
      const comp = (event.competitions || [])[0] || {};
      const teams = comp.competitors || [];
      const mine = teams.find((x) => String((x.team || {}).abbreviation || "").toUpperCase() === String(nfl).toUpperCase());
      const opp = teams.find((x) => x !== mine);
      const status = (comp.status || event.status || {}).type || {};
      const mineScore = mine && mine.score && (mine.score.displayValue ?? mine.score.value ?? mine.score);
      const oppScore = opp && opp.score && (opp.score.displayValue ?? opp.score.value ?? opp.score);
      let result = status.shortDetail || status.detail || "";
      if (status.state === "post" && mineScore !== undefined && oppScore !== undefined) {
        result = `${mine && mine.winner ? "W" : "L"} ${mineScore}-${oppScore}`;
      }
      out.push({
        id: event.id,
        week: Number((event.week || {}).number || 0),
        date: event.date,
        opponent: (opp && opp.team && opp.team.abbreviation) || "—",
        atVs: mine && mine.homeAway === "home" ? "vs" : "@",
        state: status.state || "pre",
        result,
      });
    }
    const bye = Number(data && data.byeWeek);
    if (bye && !out.some((row) => row.week === bye)) {
      out.push({ id: `bye-${bye}`, week: bye, date: null, opponent: "Bye", atVs: "", state: "pre", result: "Bye" });
    }
    return out.sort((a, b) => a.week - b.week || String(a.date).localeCompare(String(b.date)));
  }

  function espnStatRows(data) {
    if (!data) return { names: [], rows: [] };
    const rows = [];
    for (const season of data.seasonTypes || []) {
      for (const cat of season.categories || []) {
        if (cat.type !== "event") continue;
        for (const row of cat.events || []) {
          const event = (data.events || {})[row.eventId] || {};
          rows.push({ week: Number(event.week || 0), stats: row.stats || [], event });
        }
      }
    }
    return { names: data.names || [], rows };
  }

  const STAT_KEYS = {
    QB: [["passingYards", "Pass"], ["passingTouchdowns", "Pass TD"], ["interceptions", "INT"], ["rushingYards", "Rush"], ["rushingTouchdowns", "Rush TD"]],
    RB: [["rushingAttempts", "Car"], ["rushingYards", "Rush"], ["rushingTouchdowns", "Rush TD"], ["receptions", "Rec"], ["receivingYards", "Rec yds"], ["receivingTouchdowns", "Rec TD"]],
    WR: [["receptions", "Rec"], ["receivingTargets", "Tgt"], ["receivingYards", "Rec yds"], ["receivingTouchdowns", "Rec TD"]],
    TE: [["receptions", "Rec"], ["receivingTargets", "Tgt"], ["receivingYards", "Rec yds"], ["receivingTouchdowns", "Rec TD"]],
    K: [["fieldGoalsMade-fieldGoalAttempts", "FG"], ["extraPointsMade-extraPointAttempts", "XP"], ["longFieldGoalMade", "Long"], ["totalKickingPoints", "Kick pts"]],
  };

  function gameLogTable(p, sleeper, stats, schedule) {
    const panel = el("div");
    panel.appendChild(el("p", "HIM pts are the scores recorded by Sleeper for this league's scoring settings.", "note pc-note"));
    const statsByWeek = new Map(stats.rows.filter((r) => r.week).map((r) => [r.week, r]));
    const scheduleByWeek = new Map(schedule.filter((r) => r.week).map((r) => [r.week, r]));
    const sleeperByWeek = new Map(sleeper.map((r) => [r.week, r]));
    const weeks = [...new Set([...sleeperByWeek.keys(), ...statsByWeek.keys()])];
    for (const r of schedule) if (r.state === "post" && r.week && !weeks.includes(r.week)) weeks.push(r.week);
    weeks.sort((a, b) => b - a);
    if (!weeks.length) {
      panel.appendChild(el("p", "No game log is available yet.", "muted pc-empty"));
      return panel;
    }
    const wanted = (STAT_KEYS[p.pos] || []).map(([key, label]) => ({ key, label, index: stats.names.indexOf(key) })).filter((x) => x.index >= 0).slice(0, 6);
    const wrap = el("div", null, "pc-table-wrap");
    const table = el("table", null, "pc-table");
    const trh = el("tr");
    ["Wk", "Opp", "Result", "HIM pts", ...wanted.map((x) => x.label)].forEach((label, i) => trh.appendChild(el("th", label, i >= 3 ? "num" : "")));
    table.appendChild(el("thead")).appendChild(trh);
    const body = el("tbody");
    for (const week of weeks) {
      const sl = sleeperByWeek.get(week);
      const sr = statsByWeek.get(week);
      const sc = scheduleByWeek.get(week);
      const event = (sr && sr.event) || {};
      const row = el("tr");
      row.appendChild(el("td", String(week), "num"));
      row.appendChild(el("td", sc ? `${sc.atVs} ${sc.opponent}`.trim() : event.opponent ? `${event.atVs || ""} ${event.opponent.abbreviation || ""}`.trim() : "—"));
      row.appendChild(el("td", sc ? sc.result : event.gameResult ? `${event.gameResult} ${event.score || ""}`.trim() : "—", "small"));
      const score = el("td", sl && Number.isFinite(sl.points) ? sl.points.toFixed(2) : "—", "num pc-fpts");
      if (sl) score.title = sl.started ? "Started in a HIM Dynasty lineup" : "On a HIM Dynasty bench";
      row.appendChild(score);
      for (const col of wanted) row.appendChild(el("td", sr && sr.stats[col.index] !== undefined ? sr.stats[col.index] : "—", "num"));
      body.appendChild(row);
    }
    table.appendChild(body);
    wrap.appendChild(table);
    panel.appendChild(wrap);
    return panel;
  }

  function scheduleTable(rows) {
    if (!rows.length) return el("p", "Schedule is unavailable.", "muted pc-empty");
    const wrap = el("div", null, "pc-table-wrap");
    const table = el("table", null, "pc-table");
    const trh = el("tr");
    ["Wk", "Date", "Opponent", "Result / time"].forEach((label) => trh.appendChild(el("th", label)));
    table.appendChild(el("thead")).appendChild(trh);
    const body = el("tbody");
    for (const game of rows) {
      const date = new Date(game.date);
      const when = !game.date || isNaN(date) ? "—" : date.toLocaleDateString([], { month: "short", day: "numeric" });
      const tr = el("tr", null, game.state === "in" ? "is-live" : "");
      tr.append(el("td", game.week ? String(game.week) : "—", "num"), el("td", when), el("td", `${game.atVs} ${game.opponent}`.trim()), el("td", game.result || "—", game.state === "in" ? "pc-live" : ""));
      body.appendChild(tr);
    }
    table.appendChild(body);
    wrap.appendChild(table);
    return wrap;
  }

  function clip(text, limit = 500) {
    const clean = String(text || "").replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
      .replace(/\s+/g, " ").trim();
    return clean.length > limit ? `${clean.slice(0, limit - 1).trim()}…` : clean;
  }

  function liveNewsItems(data, p) {
    if (p.pos === "DEF") {
      return ((data && data.articles) || []).map((a) => ({
        id: String(a.id || a.headline), published: a.published || a.lastModified, source: "ESPN",
        headline: a.headline || "", body: a.description || "", link: (((a.links || {}).web || {}).href) || null,
      }));
    }
    return ((data && data.feed) || []).map((f) => ({
      id: String(f.id), published: f.published || f.lastModified,
      source: f.type === "Rotowire" ? "RotoWire via ESPN" : "ESPN",
      headline: f.headline || "", body: f.story || f.description || "", link: (((f.links || {}).web || {}).href) || null,
    }));
  }

  function newsList(items) {
    if (!items.length) return el("p", "No recent news is available.", "muted pc-empty");
    const list = el("div", null, "pc-news-list");
    for (const item of items.slice(0, 15)) {
      const card = el("article", null, "pc-news");
      const when = item.published ? new Date(item.published) : null;
      card.appendChild(el("div", `${item.source || "NFL news"}${when && !isNaN(when) ? ` · ${when.toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}`, "owner"));
      card.appendChild(el("h3", item.headline || "Update"));
      if (item.body) card.appendChild(el("p", clip(item.body)));
      if (typeof item.link === "string" && item.link.startsWith("https://")) {
        const a = el("a", "Read more", "news-link");
        a.href = item.link; a.target = "_blank"; a.rel = "noopener"; card.appendChild(a);
      }
      list.appendChild(card);
    }
    return list;
  }

  async function openPlayerCard(input) {
    const initial = typeof input === "string" ? { id: input, name: `Player ${input}` } : Object.assign({}, input || {});
    initial.id = String(initial.id || "");
    const ui = shell(initial);
    const token = ++openToken;
    try {
      const { player: p, data } = await resolvePlayer(initial);
      if (token !== openToken || !document.contains(ui.modal)) return;
      ui.modal.setAttribute("aria-label", `${p.name} details`);
      ui.identity.replaceChildren(el("h2", p.name, "pc-name"));
      const meta = [p.pos, p.nfl, p.injury || p.inj].filter(Boolean).join(" · ");
      ui.identity.appendChild(el("div", meta, "owner pc-sub"));
      ui.modal.querySelector(".pc-photo").replaceWith(headshot(p));
      if (p.pos !== "DEF") {
        const full = el("a", "Full analytics", "news-link pc-full-link");
        full.href = `analytics.html?player=${encodeURIComponent(p.id)}`;
        ui.foot.prepend(full);
      }

      const season = Number((data.latest.league || {}).season || new Date().getFullYear());
      const schedulePromise = p.nfl
        ? json(`${ESPN_SITE}/teams/${encodeURIComponent(String(p.nfl).toLowerCase())}/schedule?season=${season}`).then((x) => scheduleRows(x, p.nfl)).catch(() => [])
        : Promise.resolve([]);
      const statsPromise = p.pos !== "DEF" && p.espn_id
        ? json(`${ESPN_WEB}/athletes/${encodeURIComponent(p.espn_id)}/gamelog?season=${season}`).then(espnStatRows).catch(() => ({ names: [], rows: [] }))
        : Promise.resolve({ names: [], rows: [] });
      const sleeperPromise = sleeperLog(p, data.latest).catch(() => []);
      const newsPromise = p.pos === "DEF" && p.nfl
        ? json(`${ESPN_SITE}/teams/${encodeURIComponent(String(p.nfl).toLowerCase())}/news?limit=15`).catch(() => null)
        : p.espn_id ? json(ESPN_PLAYER_NEWS + encodeURIComponent(p.espn_id)).catch(() => null) : Promise.resolve(null);
      const [schedule, stats, sleeper, liveNews] = await Promise.all([schedulePromise, statsPromise, sleeperPromise, newsPromise]);
      if (token !== openToken || !document.contains(ui.modal)) return;

      ui.panels.log.replaceChildren(gameLogTable(p, sleeper, stats, schedule));
      ui.panels.schedule.replaceChildren(scheduleTable(schedule));
      const local = ((data.news && data.news.items) || []).filter((item) => (item.players || []).map(String).includes(p.id));
      const combined = liveNewsItems(liveNews, p).concat(local);
      const seen = new Set();
      const unique = combined.filter((item) => item.headline && !seen.has(item.id) && seen.add(item.id))
        .sort((a, b) => String(b.published || "").localeCompare(String(a.published || "")));
      ui.panels.news.replaceChildren(newsList(unique));
    } catch (err) {
      if (token !== openToken || !document.contains(ui.modal)) return;
      for (const panel of Object.values(ui.panels)) panel.replaceChildren(el("p", `Player details are unavailable (${err.message}).`, "muted pc-empty"));
    }
  }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && activeModal) closeModal(); });
  window.HIM.playerButton = playerButton;
  window.HIM.openPlayerCard = openPlayerCard;
})();
