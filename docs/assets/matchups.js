/* HIM Dynasty: weekly matchups (live from Sleeper) and latest transactions.

   Which week shows by default: NFL weeks run Thursday to Monday. A week stays
   "current" from Thursday 12:00 AM Central until the following Wednesday
   11:59 PM Central, so last week's final scores stay up through Wednesday
   and the new week's matchups appear on Thursday. */
(() => {
  "use strict";
  const { el, dot, teamLink } = window.HIM;
  const SLEEPER = "https://api.sleeper.app/v1";

  let data = null;
  let lite = {};
  let shownWeek = null;
  let currentWeek = null;
  let refreshTimer = null;
  const cache = {};

  // ---------------------------------------------------------------- //
  // Week calendar
  // ---------------------------------------------------------------- //
  function chicagoOffsetMinutes(date) {
    try {
      const part = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "shortOffset" })
        .formatToParts(date).find((p) => p.type === "timeZoneName").value; // e.g. "GMT-5"
      const m = part.match(/GMT([+-])(\d+)(?::(\d+))?/);
      if (!m) return -300;
      return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
    } catch (e) {
      return -300;
    }
  }

  // Thursday 12:00 AM Central of a given week.
  function weekStart(week) {
    const lg = data.league;
    const [y, mo, d] = lg.season_start.split("-").map(Number);
    // Sleeper's season start is the day before kickoff (a Wednesday); week 1
    // begins on the Thursday on or after it.
    const first = new Date(Date.UTC(y, mo - 1, d));
    const ahead = (4 - first.getUTCDay() + 7) % 7;
    const thursday = Date.UTC(y, mo - 1, d + ahead + 7 * (week - lg.start_week));
    const guess = new Date(thursday);
    return new Date(thursday - chicagoOffsetMinutes(guess) * 60000);
  }

  function computeCurrentWeek() {
    const lg = data.league;
    const last = lg.last_week || 17;
    if (!lg.season_start) return Math.min(last, Math.max(lg.start_week || 1, (lg.weeks_completed || 0) + 1));
    const now = new Date();
    let w = lg.start_week || 1;
    while (w < last && weekStart(w + 1) <= now) w += 1;
    return w;
  }

  // ---------------------------------------------------------------- //
  // Matchups
  // ---------------------------------------------------------------- //
  function teamName(rid) {
    const t = data.teams[String(rid)];
    return t ? t.team.trim() : `Team ${rid}`;
  }

  function winPct(a, b) {
    const m = data.sim && data.sim.model;
    if (!m || !m[a] || !m[b]) return null;
    const [ma, sa, ea] = m[a], [mb, sb, eb] = m[b];
    const z = (ma - mb) / Math.sqrt(sa * sa + sb * sb + ea * ea + eb * eb);
    const erf = (x) => {
      const t = 1 / (1 + 0.3275911 * Math.abs(x));
      const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
      return x >= 0 ? y : -y;
    };
    return 50 * (1 + erf(z / Math.SQRT2));
  }

  function status(week, a, b) {
    if (week < currentWeek) return "final";
    if (week > currentWeek) return "upcoming";
    // Current week: Tuesday and Wednesday are after Monday night, so it's final.
    const day = new Date(Date.now() + chicagoOffsetMinutes(new Date()) * 60000).getUTCDay();
    if (day === 2 || day === 3) return "final";
    return (a.points || 0) > 0 || (b.points || 0) > 0 ? "live" : "upcoming";
  }

  async function loadWeek(week) {
    if (cache[week] && week !== currentWeek) return cache[week];
    try {
      const res = await fetch(`${SLEEPER}/league/${data.league.id}/matchups/${week}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      cache[week] = await res.json();
    } catch (e) {
      // Fall back to last night's saved scores.
      const games = [];
      for (const [rid, t] of Object.entries(data.teams)) {
        const g = t.schedule.find((x) => x.week === week);
        if (g && g.opponent && Number(rid) < g.opponent) {
          games.push({ roster_id: Number(rid), matchup_id: games.length + 1, points: g.points || 0 },
            { roster_id: g.opponent, matchup_id: games.length + 1, points: g.opp_points || 0 });
        }
      }
      cache[week] = games;
    }
    return cache[week];
  }

  function lineupList(m) {
    const ul = el("ul", null, "lineup");
    const slots = data.league.slots || [];
    (m.starters || []).forEach((pid, i) => {
      const li = el("li");
      const info = lite[pid];
      li.appendChild(el("span", (slots[i] || "").replace("SUPER_FLEX", "SF"), "pos"));
      li.appendChild(el("span", pid && pid !== "0" ? (info ? info[0] : `Player ${pid}`) : "Empty", "lineup-name"));
      if (info) li.appendChild(el("span", `${info[1]} · ${info[2]}`, "owner"));
      const pts = (m.starters_points || [])[i];
      li.appendChild(el("span", pts !== undefined ? pts.toFixed(2) : "—", "num"));
      ul.appendChild(li);
    });
    if (!ul.childElementCount) ul.appendChild(el("li", "Lineups appear once games start.", "muted"));
    return ul;
  }

  function sideRow(m, won, st, pct) {
    const row = el("div", null, won ? "mside winner" : "mside");
    const t = data.teams[String(m.roster_id)];
    row.appendChild(dot(m.roster_id));
    const name = el("div", null, "mname");
    name.appendChild(teamLink(m.roster_id, teamName(m.roster_id)));
    const st2 = data.standings.find((s) => s.roster_id === m.roster_id);
    if (st2) name.appendChild(el("div", `${st2.wins}-${st2.losses}${st2.ties ? "-" + st2.ties : ""}${t ? " · " + t.owner : ""}`, "owner"));
    row.appendChild(name);
    if (st === "upcoming") row.appendChild(el("span", pct === null ? "—" : `${pct.toFixed(0)}%`, "mscore muted"));
    else row.appendChild(el("span", (m.points || 0).toFixed(2), "mscore"));
    return row;
  }

  function chanceLabel(a, b, aPct) {
    if (aPct === null) return null;
    const aShown = Math.round(aPct);
    const bShown = Math.round(100 - aPct);
    if (aShown === 50 && bShown === 50) return "Toss up";
    return aPct > 50 ? `${teamName(a.roster_id)} ${aShown}%` : `${teamName(b.roster_id)} ${bShown}%`;
  }

  async function renderWeek(week) {
    shownWeek = week;
    renderPills();
    const host = document.getElementById("matchup-list");
    if (!host.childElementCount) host.appendChild(el("p", "Loading matchups…", "muted"));
    const raw = await loadWeek(week);
    if (week !== shownWeek) return;
    const groups = {};
    for (const m of raw) if (m.matchup_id !== null && m.matchup_id !== undefined) (groups[m.matchup_id] = groups[m.matchup_id] || []).push(m);
    const games = Object.values(groups).filter((g) => g.length === 2);
    host.replaceChildren();
    if (!games.length) {
      host.appendChild(el("p", week >= data.league.playoff_week_start ? "Playoff matchups appear once the bracket is set." : "No matchups for this week.", "muted"));
      return;
    }
    let anyLive = false;
    for (const [a, b] of games) {
      const st = status(week, a, b);
      if (st === "live") anyLive = true;
      const pa = st === "final" ? null : winPct(String(a.roster_id), String(b.roster_id));
      const card = el("article", null, `matchup ${st}`);
      const head = el("div", null, "mhead");
      head.appendChild(el("span", st === "final" ? "Final" : st === "live" ? "Live" : "Upcoming", `mstatus ${st}`));
      if (st === "final") {
        const diff = Math.abs((a.points || 0) - (b.points || 0));
        head.appendChild(el("span", `margin ${diff.toFixed(2)}`, "owner"));
      } else if (st === "live") {
        const diff = Math.abs((a.points || 0) - (b.points || 0));
        const chance = chanceLabel(a, b, pa);
        head.appendChild(el("span", `${chance ? `${chance} · ` : ""}margin ${diff.toFixed(2)}`, "owner matchup-summary"));
      } else {
        head.appendChild(el("span", "win chance", "owner"));
      }
      card.appendChild(head);
      const aWon = st !== "upcoming" && (a.points || 0) > (b.points || 0);
      const bWon = st !== "upcoming" && (b.points || 0) > (a.points || 0);
      card.appendChild(sideRow(a, aWon, st, pa));
      card.appendChild(sideRow(b, bWon, st, pa === null ? null : 100 - pa));
      if (st !== "upcoming") {
        const det = el("details", null, "mdetails");
        det.appendChild(el("summary", "Lineups"));
        const cols = el("div", null, "lineups");
        for (const m of [a, b]) {
          const col = el("div");
          col.appendChild(el("div", teamName(m.roster_id), "group-title"));
          col.appendChild(lineupList(m));
          cols.appendChild(col);
        }
        det.appendChild(cols);
        card.appendChild(det);
      }
      host.appendChild(card);
    }
    clearTimeout(refreshTimer);
    if (week === currentWeek && anyLive) {
      refreshTimer = setTimeout(async () => {
        if (document.hidden || shownWeek !== currentWeek) return;
        const sec = document.getElementById("matchups");
        if (sec) sec.dataset.quiet = "1"; // live refresh: no entrance animation
        try { await renderWeek(currentWeek); } finally { if (sec) delete sec.dataset.quiet; }
      }, 60000);
    }
  }

  function renderPills() {
    const host = document.getElementById("week-pills");
    host.replaceChildren();
    const lg = data.league;
    for (let w = lg.start_week || 1; w <= (lg.last_week || 17); w++) {
      const label = w >= lg.playoff_week_start ? `Wk ${w} · PO` : `Wk ${w}`;
      const b = el("button", w === currentWeek ? `${label} · Now` : label, "chip");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(w === shownWeek));
      if (w === shownWeek) b.classList.add("is-current");
      b.addEventListener("click", () => renderWeek(w));
      host.appendChild(b);
      if (w === shownWeek) requestAnimationFrame(() => b.scrollIntoView({ block: "nearest", inline: "center" }));
    }
    document.getElementById("week-prev").disabled = shownWeek <= (lg.start_week || 1);
    document.getElementById("week-next").disabled = shownWeek >= (lg.last_week || 17);
  }

  // ---------------------------------------------------------------- //
  // Transactions
  // ---------------------------------------------------------------- //
  let txAll = [];
  let txShown = 12;

  const pname = (pid) => (lite[pid] ? `${lite[pid][0]} (${lite[pid][1]})` : `Player ${pid}`);
  const roundName = (r) => ({ 1: "1st", 2: "2nd", 3: "3rd" }[r] || `${r}th`);

  function txCard(t) {
    const card = el("article", null, `tx ${t.type}`);
    const head = el("div", null, "tx-head");
    const label = { trade: "Trade", waiver: "Waiver", free_agent: "Free agent", commissioner: "Commish" }[t.type] || t.type;
    head.appendChild(el("span", label, `tx-badge ${t.type}`));
    const when = t.time ? new Date(t.time) : null;
    head.appendChild(el("span", `${when ? when.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""} · Wk ${t.week}`, "owner"));
    card.appendChild(head);
    for (const rid of t.rosters) {
      const gets = Object.entries(t.adds).filter(([, r]) => r === rid).map(([pid]) => pid);
      const loses = Object.entries(t.drops).filter(([, r]) => r === rid).map(([pid]) => pid);
      const picksIn = t.picks.filter((p) => p.to === rid);
      if (!gets.length && !loses.length && !picksIn.length) continue;
      const row = el("div", null, "tx-row");
      const who = el("div", null, "teamcell");
      who.appendChild(dot(rid));
      who.appendChild(teamLink(rid, teamName(rid)));
      row.appendChild(who);
      const what = el("div", null, "tx-what");
      if (gets.length || picksIn.length) {
        const items = gets.map(pname).concat(picksIn.map((p) => `${p.season} ${roundName(p.round)}${p.original !== rid ? ` (${teamName(p.original)})` : ""}`));
        what.appendChild(el("div", `${t.type === "trade" ? "Gets" : "Adds"} ${items.join(", ")}${t.faab ? ` · $${t.faab} FAAB` : ""}`, "tx-add"));
      }
      if (loses.length && t.type !== "trade") what.appendChild(el("div", `Drops ${loses.map(pname).join(", ")}`, "tx-drop"));
      row.appendChild(what);
      card.appendChild(row);
    }
    return card;
  }

  function renderTx() {
    const host = document.getElementById("tx-list");
    host.replaceChildren();
    if (!txAll.length) {
      host.appendChild(el("p", "No transactions yet.", "muted"));
      return;
    }
    txAll.slice(0, txShown).forEach((t) => host.appendChild(txCard(t)));
    if (txAll.length > txShown) {
      const more = el("button", `Show more (${txAll.length - txShown})`, "chip");
      more.type = "button";
      more.addEventListener("click", () => { txShown += 12; renderTx(); });
      host.appendChild(more);
    }
  }

  async function loadTx() {
    const byId = new Map((data.transactions || []).map((t) => [t.id, t]));
    const weeks = [...new Set([currentWeek, currentWeek - 1, data.league.nfl_week].filter((w) => w && w >= 1))];
    await Promise.all(weeks.map(async (w) => {
      try {
        const res = await fetch(`${SLEEPER}/league/${data.league.id}/transactions/${w}`, { cache: "no-store" });
        if (!res.ok) return;
        for (const t of await res.json()) {
          if (t.status !== "complete" || byId.has(t.transaction_id)) continue;
          byId.set(t.transaction_id, {
            id: t.transaction_id, type: t.type, week: w, time: t.status_updated || t.created,
            rosters: t.roster_ids || [], adds: t.adds || {}, drops: t.drops || {},
            picks: (t.draft_picks || []).map((d) => ({ season: d.season, round: d.round, original: d.roster_id, from: d.previous_owner_id, to: d.owner_id })),
            faab: (t.settings || {}).waiver_bid,
          });
        }
      } catch (e) { /* nightly data still shows */ }
    }));
    txAll = [...byId.values()].sort((a, b) => (b.time || 0) - (a.time || 0));
    renderTx();
  }

  // ---------------------------------------------------------------- //
  async function init() {
    try {
      const get = (u) => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
      [data, lite] = await Promise.all([window.HIM.loadData(), get("data/players_lite.json")]);
    } catch (e) {
      return;
    }
    if (!data.league.start_week) {
      document.getElementById("matchup-list").replaceChildren(el("p", "Matchups appear after the next morning update.", "muted"));
      return;
    }
    currentWeek = computeCurrentWeek();
    document.getElementById("week-prev").addEventListener("click", () => renderWeek(Math.max(data.league.start_week, shownWeek - 1)));
    document.getElementById("week-next").addEventListener("click", () => renderWeek(Math.min(data.league.last_week, shownWeek + 1)));
    renderWeek(currentWeek);
    loadTx();
    document.addEventListener("visibilitychange", () => { if (!document.hidden && shownWeek === currentWeek) renderWeek(currentWeek); });
  }

  init();
})();
