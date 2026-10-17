/* HIM Dynasty mock draft page. Reads data/mock_draft.json (and latest.json
   for team colors). All names are set with textContent. */
(() => {
  "use strict";
  const { el, dot, teamLink, assignColors, shareButton, playerButton } = window.HIM;
  const SVG = "http://www.w3.org/2000/svg";
  const safeUrl = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : null);

  let data = null;
  let board = {};
  let round = 1;
  let pos = "All";
  let teamFilter = null; // roster id as a string, or null for every team
  let highlights = {};
  let highlightsEnabled = false;

  function headshot(e) {
    const src = safeUrl(e.headshot) || (e.espn_id ? `https://a.espncdn.com/i/headshots/college-football/players/full/${encodeURIComponent(e.espn_id)}.png` : null);
    const img = el("img", null, "headshot");
    img.alt = "";
    img.loading = "lazy";
    if (src) img.src = src;
    img.addEventListener("error", () => { img.style.visibility = "hidden"; });
    return img;
  }

  function posBadge(p) {
    return el("span", p, `posbadge pos-${p.toLowerCase()}`);
  }

  function sparkline(weekly) {
    const w = 96, h = 26, gap = 2;
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    svg.setAttribute("class", "spark");
    if (!weekly || !weekly.length) return svg;
    const max = Math.max(40, ...weekly.map((g) => g.pts));
    const bw = Math.max(3, Math.min(10, (w - gap * (weekly.length - 1)) / weekly.length));
    weekly.forEach((g, i) => {
      const bh = Math.max(1.5, (Math.max(0, g.pts) / max) * h);
      const r = document.createElementNS(SVG, "rect");
      r.setAttribute("x", i * (bw + gap));
      r.setAttribute("y", h - bh);
      r.setAttribute("width", bw);
      r.setAttribute("height", bh);
      r.setAttribute("class", g.pts >= 25 ? "sb hot" : "sb");
      const t = document.createElementNS(SVG, "title");
      t.textContent = `Wk ${g.week ?? "?"} ${g.at === "@" ? "@" : "vs"} ${g.opp ?? ""}: ${g.pts.toFixed(1)} pts`;
      r.appendChild(t);
      svg.appendChild(r);
    });
    return svg;
  }

  function lastLine(e) {
    if (!e.last) return e.consensus ? "No college stats yet" : "";
    const where = e.last.at === "@" ? "@" : "vs";
    return `Wk ${e.last.week ?? "?"} ${where} ${e.last.opp ?? ""}: ${e.last.line} (${e.last.pts.toFixed(1)} pts)`;
  }

  // ------------------------------------------------------------------ //
  // Picks
  // ------------------------------------------------------------------ //
  function renderTabs(host, values, current, onPick, label) {
    host.replaceChildren();
    for (const v of values) {
      const b = el("button", label(v), "chip");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(v === current));
      if (v === current) b.classList.add("is-current");
      b.addEventListener("click", () => onPick(v));
      host.appendChild(b);
    }
  }

  function renderPicks() {
    const tabs = document.getElementById("round-tabs");
    renderTabs(tabs, Array.from({ length: data.rounds }, (_, i) => i + 1), teamFilter ? null : round,
      (v) => { round = v; setTeam(null); }, (v) => `Round ${v}`);
    const shown = teamFilter
      ? data.picks.filter((x) => String(x.owner) === teamFilter)
      : data.picks.filter((x) => x.round === round);
    const note = document.getElementById("filter-note");
    if (note) {
      note.replaceChildren();
      if (teamFilter) {
        note.appendChild(el("span", `${shown.length} mock pick${shown.length === 1 ? "" : "s"} for `));
        note.appendChild(teamLink(Number(teamFilter), teamNames()[teamFilter] || `Team ${teamFilter}`));
        if (!shown.length) note.appendChild(el("span", " (this team has no picks in this draft)"));
        const clear = el("button", "Show every team", "chip");
        clear.type = "button";
        clear.addEventListener("click", () => setTeam(null));
        note.appendChild(clear);
      }
    }

    const host = document.getElementById("picks");
    host.replaceChildren();
    for (const p of shown) {
      const e = board[p.prospect];
      const card = el("article", null, "pick");

      const head = el("div", null, "pick-head");
      head.appendChild(el("span", p.label, "pick-no"));
      const team = el("div", null, "pick-team");
      const line = el("div", null, "teamcell");
      line.appendChild(dot(p.owner));
      line.appendChild(teamLink(p.owner, p.owner_team));
      team.appendChild(line);
      if (p.traded) team.appendChild(el("div", `via ${p.original_team}`, "owner"));
      if (p.context) {
        const bits = [];
        if (p.context.needs.length) bits.push(`Needs ${p.context.needs.join(", ")}`);
        if (p.context.thin && p.context.thin.length) bits.push(`Thin at ${p.context.thin.join(", ")}`);
        if (p.context.set.length) bits.push(`Set at ${p.context.set.join(", ")}`);
        if (bits.length) team.appendChild(el("div", bits.join(" · "), "owner need-line"));
        if (p.context.tendency && p.context.tendency.length) {
          team.appendChild(el("div", `Drafts: ${p.context.tendency.join(" · ")}`, "owner need-line"));
        }
      }
      head.appendChild(team);
      card.appendChild(head);

      const body = el("div", null, "pick-body");
      body.appendChild(headshot(e));
      const info = el("div", null, "pick-info");
      const nameRow = el("div", null, "pick-name");
      nameRow.appendChild(prospectButton(e));
      nameRow.appendChild(posBadge(e.pos));
      info.appendChild(nameRow);
      info.appendChild(el("div", [e.school, e.cls].filter(Boolean).join(" · "), "owner"));
      body.appendChild(info);
      card.appendChild(body);

      const stats = el("div", null, "pick-stats");
      const parts = [
        e.cons_rank ? `Consensus #${Math.round(e.cons_rank)}` : "Not on boards yet",
        e.ppg !== null && e.ppg !== undefined ? `${e.ppg.toFixed(1)} PPG` : null,
        e.last3 !== null && e.last3 !== undefined ? `last 3: ${e.last3.toFixed(1)}` : null,
      ].filter(Boolean);
      stats.appendChild(el("div", parts.join(" · ")));
      stats.appendChild(el("div", lastLine(e), "muted small"));
      card.appendChild(stats);

      const foot = el("div", null, "pick-foot");
      foot.appendChild(sparkline(e.weekly));
      foot.appendChild(el("span", p.reason, "reason"));
      card.appendChild(foot);
      card.classList.add("clickable");
      card.addEventListener("click", (ev) => {
        if (ev.target.closest("a, button")) return;
        openProspect(e, p);
      });
      host.appendChild(card);
    }
    renderRosterPlan();
  }

  function teamNames() {
    const names = {};
    for (const p of data.picks) names[p.owner] = p.owner_team;
    if (data.rosters) for (const rid of Object.keys(data.rosters.teams)) names[rid] = names[rid] || `Team ${rid}`;
    if (data.teamNames) Object.assign(names, data.teamNames);
    return names;
  }

  function setTeam(rid) {
    teamFilter = rid ? String(rid) : null;
    const sel = document.getElementById("team-filter");
    if (sel) sel.value = teamFilter || "";
    const url = new URL(window.location.href);
    if (teamFilter) url.searchParams.set("team", teamFilter); else url.searchParams.delete("team");
    history.replaceState(null, "", url);
    renderPicks();
  }

  function setupTeamFilter() {
    const sel = document.getElementById("team-filter");
    if (!sel) return;
    const names = teamNames();
    sel.replaceChildren(el("option", "All teams"));
    sel.firstChild.value = "";
    const counts = {};
    for (const p of data.picks) counts[p.owner] = (counts[p.owner] || 0) + 1;
    Object.keys(names).sort((a, b) => names[a].localeCompare(names[b])).forEach((rid) => {
      const o = el("option", `${names[rid].trim()} (${counts[rid] || 0} pick${counts[rid] === 1 ? "" : "s"})`);
      o.value = rid;
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => setTeam(sel.value || null));
    if (!document.getElementById("mock-share")) {
      const b = shareButton(() => (teamFilter ? `share/mock-${encodeURIComponent(teamFilter)}.html` : "draft.html"),
        () => (teamFilter ? `${(names[teamFilter] || "").trim()} mock draft · HIM Dynasty` : "HIM Dynasty mock draft"), "Share");
      b.id = "mock-share";
      sel.closest("label").after(b);
    }
    const want = new URLSearchParams(window.location.search).get("team");
    if (want && names[want]) teamFilter = want;
    sel.value = teamFilter || "";
  }

  // ------------------------------------------------------------------ //
  // Roster now vs after the mock
  // ------------------------------------------------------------------ //
  const POS_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];
  const GROUP_TAG = { taxi: "Taxi", ir: "IR" };

  function renderRosterPlan() {
    const host = document.getElementById("roster-plan");
    if (!host) return;
    const plan = teamFilter && data.rosters && data.rosters.teams[teamFilter];
    host.hidden = !plan;
    if (!plan) { host.replaceChildren(); return; }
    const L = data.rosters.limits;
    const cuts = new Set(plan.cuts);
    const now = plan.counts;
    const kept = plan.current.filter((p) => p.group !== "ir" && !cuts.has(p.id)).length + plan.draftees.length;

    const head = el("div", null, "plan-summary");
    head.appendChild(el("h3", "Roster: now vs after the mock", "sub-head"));
    head.appendChild(el("p",
      `Now: ${now.active}/${L.active} active · ${now.taxi}/${L.taxi} taxi · ${now.ir}/${L.ir} IR. ` +
      `After the mock: +${plan.draftees.length} rookie${plan.draftees.length === 1 ? "" : "s"}` +
      (plan.cuts.length
        ? `, so ${plan.cuts.length} player${plan.cuts.length === 1 ? "" : "s"} must go to fit ${L.active} active + ${L.taxi} taxi spots (struck out below, lowest dynasty value first).`
        : `, and everyone still fits in ${L.active} active + ${L.taxi} taxi spots.`), "note"));
    head.appendChild(el("p",
      `Assumes players on IR stay there, next year's taxi holds the new rookies and this year's rookies, and a team's only kicker and defense are kept. ${kept} players after cuts.`,
      "note small"));

    const grid = el("div", null, "plan-grid");
    grid.appendChild(rosterColumn("Now", plan.current, [], new Set()));
    grid.appendChild(rosterColumn("After the mock", plan.current, plan.draftees, cuts));
    host.replaceChildren(head, grid);
  }

  function rosterColumn(title, current, draftees, cuts) {
    const col = el("div", null, "roster-col");
    col.appendChild(el("div", title, "group-title"));
    for (const pos of POS_ORDER) {
      const players = current.filter((p) => p.pos === pos).sort((a, b) => b.value - a.value || (b.ppg || 0) - (a.ppg || 0));
      const rookies = draftees.filter((d) => d.pos === pos);
      if (!players.length && !rookies.length) continue;
      const block = el("div", null, "plan-pos");
      block.appendChild(el("div", `${pos} · ${players.length - players.filter((p) => cuts.has(p.id)).length + rookies.length}`, "plan-pos-head"));
      const list = el("ul", null, "plan-list");
      for (const d of rookies) {
        const li = el("li", null, "plan-row rookie");
        const b = prospectButton(board[d.key] || { name: d.name, pos: d.pos, key: d.key });
        li.appendChild(b);
        li.appendChild(el("span", `${d.label} rookie`, "plan-tag new"));
        list.appendChild(li);
      }
      for (const p of players) {
        const cut = cuts.has(p.id);
        const li = el("li", null, cut ? "plan-row cut" : "plan-row");
        li.appendChild(playerButton(p.id, p.name, "plan-name", p));
        const meta = [p.nfl, p.age ? `${p.age}` : null].filter(Boolean).join(" · ");
        if (meta) li.appendChild(el("span", meta, "owner"));
        if (GROUP_TAG[p.group]) li.appendChild(el("span", GROUP_TAG[p.group], "plan-tag"));
        if (cut) li.appendChild(el("span", "Release", "plan-tag drop"));
        li.appendChild(el("span", p.value ? p.value.toLocaleString() : "—", "num muted plan-val"));
        list.appendChild(li);
      }
      block.appendChild(list);
      col.appendChild(block);
    }
    return col;
  }

  // ------------------------------------------------------------------ //
  // Prospect pop-up with highlights
  // ------------------------------------------------------------------ //
  function prospectButton(e) {
    const b = el("button", e.name, "team prospect-link");
    b.type = "button";
    b.title = `Highlights and stats: ${e.name}`;
    b.addEventListener("click", (ev) => { ev.stopPropagation(); openProspect(e); });
    return b;
  }

  function closeModal() {
    const m = document.querySelector(".modal");
    if (!m) return;
    m.classList.add("closing");
    document.body.classList.remove("no-scroll");
    setTimeout(() => m.remove(), 220);
    document.removeEventListener("keydown", onModalKey);
    if (closeModal.returnTo) closeModal.returnTo.focus();
  }
  function onModalKey(ev) { if (ev.key === "Escape") closeModal(); }

  function openProspect(e, pick) {
    if (!e || !e.key) return;
    closeModal.returnTo = document.activeElement;
    const old = document.querySelector(".modal");
    if (old) old.remove();
    pick = pick || data.picks.find((x) => x.prospect === e.key);
    const modal = el("div", null, "modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", `${e.name} highlights`);
    modal.addEventListener("click", (ev) => { if (ev.target === modal) closeModal(); });
    const box = el("div", null, "modal-box");

    const head = el("div", null, "modal-head");
    head.appendChild(headshot(e));
    const who = el("div");
    const nm = el("div", null, "pick-name");
    nm.appendChild(el("span", e.name, "team"));
    if (e.pos) nm.appendChild(posBadge(e.pos));
    who.appendChild(nm);
    const sub = [e.school, e.cls, e.rank ? `Board #${e.rank}` : null,
      pick ? `Mocked ${pick.label} to ${pick.owner_team.trim()}` : null].filter(Boolean).join(" · ");
    who.appendChild(el("div", sub, "owner"));
    head.appendChild(who);
    const x = el("button", "×", "modal-close");
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", closeModal);
    head.appendChild(x);
    box.appendChild(head);

    const vids = (highlights[e.key] || {}).videos || [];
    const stage = el("div", null, "modal-stage");
    const query = `${e.name} ${e.school || ""} ${data.college_season} highlights`.replace(/\s+/g, " ").trim();
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    if (vids.length) {
      const frame = el("div", null, "video-frame");
      const play = (v) => {
        const f = document.createElement("iframe");
        f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?autoplay=1&rel=0`;
        f.title = v.title || `${e.name} highlights`;
        f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
        f.allowFullscreen = true;
        f.referrerPolicy = "strict-origin-when-cross-origin";
        frame.replaceChildren(f);
        list.querySelectorAll(".vid").forEach((n) => n.classList.toggle("is-current", n.dataset.id === v.id));
      };
      const list = el("div", null, "video-list");
      for (const v of vids) {
        const t = el("button", null, "vid");
        t.type = "button";
        t.dataset.id = v.id;
        const img = el("img");
        img.alt = "";
        img.loading = "lazy";
        img.src = `https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/mqdefault.jpg`;
        t.appendChild(img);
        const cap = el("span", null, "vid-cap");
        cap.appendChild(el("span", v.title || "Highlights", "vid-title"));
        cap.appendChild(el("span", [v.channel, v.date].filter(Boolean).join(" · "), "owner"));
        t.appendChild(cap);
        t.addEventListener("click", () => play(v));
        list.appendChild(t);
      }
      stage.append(frame, list);
      play(vids[0]);
    } else {
      const empty = el("div", null, "video-empty");
      empty.appendChild(el("p", `No highlight clips saved for ${e.name} yet.`, "team"));
      empty.appendChild(el("p", highlightsEnabled
        ? "The nightly update hasn't found an embeddable clip for him yet."
        : "Embedded clips turn on once a free YouTube key is added to the site's nightly update.", "muted small"));
      stage.appendChild(empty);
    }
    box.appendChild(stage);

    const foot = el("div", null, "modal-foot");
    const statBits = [
      e.cons_rank ? `Consensus #${Math.round(e.cons_rank)}` : "Not on expert boards yet",
      e.ppg != null ? `${e.ppg.toFixed(1)} fantasy PPG (league scoring)` : null,
      e.last3 != null ? `last 3: ${e.last3.toFixed(1)}` : null,
      e.games ? `${e.games} games` : null,
    ].filter(Boolean);
    foot.appendChild(el("div", statBits.join(" · ")));
    if (e.weekly && e.weekly.length) foot.appendChild(sparkline(e.weekly));
    const yt = el("a", "Search YouTube for more", "chip yt-link");
    yt.href = searchUrl;
    yt.target = "_blank";
    yt.rel = "noopener";
    foot.appendChild(yt);
    box.appendChild(foot);

    modal.appendChild(box);
    document.body.appendChild(modal);
    document.body.classList.add("no-scroll");
    document.addEventListener("keydown", onModalKey);
    x.focus();
  }

  // ------------------------------------------------------------------ //
  // Big board
  // ------------------------------------------------------------------ //
  function renderBoard() {
    renderTabs(document.getElementById("pos-tabs"), ["All", "QB", "RB", "WR", "TE"], pos,
      (v) => { pos = v; renderBoard(); }, (v) => v);

    const picksBy = {};
    for (const p of data.picks) picksBy[p.prospect] = p;

    const table = el("table");
    const head = el("tr");
    [["#", true], ["7d", true], ["Player", false], ["Pos", false], ["Cons", true], ["PPG", true],
     ["Weekly", false], ["Last game", false], ["Mock", false]]
      .forEach(([label, right]) => head.appendChild(el("th", label, right ? "num" : "")));
    table.appendChild(el("thead")).appendChild(head);

    const body = el("tbody");
    for (const e of data.board.filter((x) => pos === "All" || x.pos === pos)) {
      const tr = el("tr");
      tr.appendChild(el("td", e.rank, "num rank"));
      const mv = e.move7;
      tr.appendChild(el("td", mv ? (mv > 0 ? `▲${mv}` : `▼${-mv}`) : "–", `num ${mv > 0 ? "up" : mv < 0 ? "down" : "muted"}`));

      const who = el("td");
      const wrap = el("div", null, "player");
      wrap.appendChild(headshot(e));
      const text = el("div");
      text.appendChild(prospectButton(e));
      text.appendChild(el("div", [e.school, e.cls].filter(Boolean).join(" · "), "owner"));
      wrap.appendChild(text);
      who.appendChild(wrap);
      tr.appendChild(who);

      const pc = el("td");
      pc.appendChild(posBadge(e.pos));
      tr.appendChild(pc);
      tr.appendChild(el("td", e.cons_rank ? Math.round(e.cons_rank) : "—", "num"));
      tr.appendChild(el("td", e.ppg !== null && e.ppg !== undefined ? e.ppg.toFixed(1) : "—", "num"));
      const sp = el("td");
      sp.appendChild(sparkline(e.weekly));
      tr.appendChild(sp);
      tr.appendChild(el("td", lastLine(e), "muted small wrap"));
      const pk = picksBy[e.key];
      const mc = el("td");
      if (pk) {
        mc.appendChild(el("span", `${pk.label} `, "muted"));
        mc.appendChild(teamLink(pk.owner, pk.owner_team));
      } else {
        mc.appendChild(el("span", "—", "muted"));
      }
      tr.appendChild(mc);
      body.appendChild(tr);
    }
    table.appendChild(body);
    document.getElementById("board").replaceChildren(table);
  }

  function renderTendencies() {
    const host = document.getElementById("tendencies");
    const hist = data.history;
    const tend = data.tendencies;
    if (!host || !hist || !tend || !Object.keys(tend).length) {
      const panel = document.getElementById("tendency-panel");
      if (panel) panel.hidden = true;
      return;
    }
    const POS = ["QB", "RB", "WR", "TE"];
    const rookieDrafts = hist.drafts.filter((d) => d.kind === "rookie").map((d) => d.season);
    const startup = hist.drafts.find((d) => d.kind === "startup");
    document.getElementById("tendency-note").textContent =
      `From ${rookieDrafts.length ? `the ${rookieDrafts.join(" and ")} rookie drafts` : "past drafts"}` +
      `${startup ? ` and rounds 1–10 of the ${startup.season} startup (counted at 40%)` : ""}. ` +
      `A lean nudges that manager's mock picks by up to 20%; with only a few picks each, it stays a nudge.`;

    // League-wide: how each round has been spent.
    const rt = el("table");
    const rh = el("tr");
    rh.appendChild(el("th", "Round"));
    POS.forEach((p) => rh.appendChild(el("th", p, "num")));
    rh.appendChild(el("th", "Weight now", ""));
    rt.appendChild(el("thead")).appendChild(rh);
    const rb = el("tbody");
    for (const [rnd, c] of Object.entries(hist.round_counts)) {
      const tr = el("tr");
      tr.appendChild(el("td", `Round ${rnd}`));
      POS.forEach((p) => tr.appendChild(el("td", c[p] || 0, "num")));
      const pr = hist.round_priors[rnd];
      tr.appendChild(el("td", pr ? POS.map((p) => `${p} ×${pr[p].toFixed(2)}`).join(" · ") : "—", "muted small wrap"));
      rb.appendChild(tr);
    }
    rt.appendChild(rb);
    const rwrap = el("div", null, "table-wrap");
    rwrap.appendChild(rt);

    // Per manager.
    const order = Object.keys(tend).sort((a, b) =>
      (data.picks.find((p) => String(p.owner) === a) ? 0 : 1) - (data.picks.find((p) => String(p.owner) === b) ? 0 : 1) || Number(a) - Number(b));
    const names = {};
    for (const p of data.picks) names[p.owner] = p.owner_team;
    const t = el("table");
    const h = el("tr");
    [["Team", false], ["Rookie picks", false], ["QB", true], ["RB", true], ["WR", true], ["TE", true], ["Habit", false]]
      .forEach(([l, r]) => h.appendChild(el("th", l, r ? "num" : "")));
    t.appendChild(el("thead")).appendChild(h);
    const b = el("tbody");
    for (const rid of order) {
      const m = tend[rid];
      const tr = el("tr");
      const tc = el("td");
      const line = el("div", null, "teamcell");
      line.appendChild(dot(Number(rid)));
      line.appendChild(teamLink(Number(rid), names[rid] || `Team ${rid}`));
      tc.appendChild(line);
      tr.appendChild(tc);
      const list = m.rookie_picks.map((x) => `${x.season} R${x.round} ${x.pos}${x.name ? ` ${x.name}` : ""}`).join(" · ");
      tr.appendChild(el("td", list || "None here yet", "muted small wrap"));
      POS.forEach((p) => {
        const v = m.pref[p];
        const cls = v >= 1.06 ? "up" : v <= 0.92 ? "down" : "muted";
        tr.appendChild(el("td", `${m.rookie_counts[p]} · ×${v.toFixed(2)}`, `num ${cls}`));
      });
      tr.appendChild(el("td", m.labels.length ? m.labels.join(", ") : "Balanced"));
      b.appendChild(tr);
    }
    t.appendChild(b);
    const wrap = el("div", null, "table-wrap");
    wrap.appendChild(t);
    host.replaceChildren(el("h3", "How this league spends each round", "sub-head"), rwrap,
      el("h3", "Each manager", "sub-head"), wrap);
  }

  function renderMethod() {
    const w = data.weights;
    const f = data.format;
    const m = f.position_multipliers;
    const s = data.sources;
    const hist = data.history;
    const POSITIONS = ["QB", "RB", "WR", "TE"];
    const items = [
      `Prospect pool: ${s.consensus_board} prospects from the NFL Mock Draft Database consensus board and ${s.espn_board} from ESPN's big board, plus productive juniors and seniors from ${s.college_players} college stat lines. Only QB, RB, WR, and TE count.`,
      `Consensus value: the average of each prospect's board ranks, falling off quickly after the top picks the way real draft capital does.`,
      `Production value: college fantasy points per game with this league's scoring (${f.ppr} PPR), as a percentile among the top college players at the position, nudged by the last three games.`,
      `Blend: ${Math.round(w.consensus * 100)}% consensus, ${Math.round(w.production * 100)}% production right now. Production starts at 20% before the college season and grows to 40% as games are played.`,
      `League format: ${f.superflex ? "superflex" : "1-QB"} lineups, so value is multiplied by QB ${m.QB}, RB ${m.RB}, WR ${m.WR}, TE ${m.TE}. Expert boards rank NFL prospects, not fantasy value, so this is where a 1-QB league's lower QB value comes in.`,
      hist && Object.keys(hist.round_counts || {}).length
        ? `League history: Sleeper keeps every past season of this league. Each round is weighted by how this league has actually spent it (see Draft Habits): in round 1, for example, ${POSITIONS.map((p) => `${p} ×${hist.round_priors["1"][p].toFixed(2)}`).join(", ")}. On top of that, each manager's own habits nudge their picks.`
        : `League history: not available right now, so every round and manager is treated the same.`,
      `Draft order: the projected order from the simulations, ${data.rounds} linear rounds, with traded picks going to their current owners.`,
      `Team needs look at the whole roster, not just the starting lineup. Starter slots (QB1, RB1–2, WR1–3, TE1) are compared with the league median at the same slot, and being better than the median earns only a small credit, so one star can't hide an empty bench. Depth slots (QB2, RB3–4, WR4–5, TE2) are compared with a replacement-level starter at that position and only count against you when they're missing. "Thin at" means the depth behind the starters is mostly empty.`,
      `${f.superflex ? "" : "In a 1-QB league a starting QB is easy to find, so a QB hole pulls less than other holes, and a team with a starter-level QB and a real backup is set at QB. "}Each pick: the owner takes the best value × round weight × manager habit × roster need. Each pick at a position eases that need for later rounds.`,
    ];
    document.getElementById("method").replaceChildren(...items.map((t) => el("li", t)));
  }

  async function load() {
    let latest = null;
    try {
      let mock;
      [mock, latest] = await Promise.all([
        fetch("data/mock_draft.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
        window.HIM.loadData().catch(() => null),
      ]);
      data = mock;
      if (latest) {
        assignColors((latest.history && latest.history.teams.length ? latest.history.teams : latest.standings).map((t) => t.roster_id));
      }
    } catch (err) {
      document.getElementById("picks").replaceChildren(el("p", `The mock draft appears after the next data update (${err.message}).`, "muted"));
      document.getElementById("updated").textContent = "";
      return;
    }
    board = Object.fromEntries(data.board.map((e) => [e.key, e]));
    if (latest && latest.teams) {
      data.teamNames = Object.fromEntries(Object.entries(latest.teams).map(([k, t]) => [k, t.team]));
    }
    try {
      const h = await fetch("data/highlights.json", { cache: "no-cache" });
      if (h.ok) {
        const hj = await h.json();
        highlights = hj.players || {};
        highlightsEnabled = !!hj.enabled;
      }
    } catch (err) { highlights = {}; }
    setupTeamFilter();
    document.getElementById("title").replaceChildren(document.createTextNode(`${data.draft_year} Rookie `), el("em", "Mock Draft"));
    const when = new Date(data.generated_at);
    document.getElementById("updated").textContent =
      `${data.rounds} rounds · ${data.teams} teams · updated ${when.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
    renderPicks();
    renderBoard();
    renderTendencies();
    renderMethod();
  }

  load();
})();
