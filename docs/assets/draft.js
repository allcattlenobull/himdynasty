/* HIM Dynasty mock draft page. Reads data/mock_draft.json (and latest.json
   for team colors). All names are set with textContent. */
(() => {
  "use strict";
  const { el, dot, teamLink, assignColors } = window.HIM;
  const SVG = "http://www.w3.org/2000/svg";
  const safeUrl = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : null);

  let data = null;
  let board = {};
  let round = 1;
  let pos = "All";

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
      r.setAttribute("class", g.pts >= 25 ? "hot" : "bar");
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
    renderTabs(document.getElementById("round-tabs"),
      Array.from({ length: data.rounds }, (_, i) => i + 1), round,
      (v) => { round = v; renderPicks(); }, (v) => `Round ${v}`);

    const host = document.getElementById("picks");
    host.replaceChildren();
    for (const p of data.picks.filter((x) => x.round === round)) {
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
        if (p.context.set.length) bits.push(`Set at ${p.context.set.join(", ")}`);
        if (bits.length) team.appendChild(el("div", bits.join(" · "), "owner need-line"));
      }
      head.appendChild(team);
      card.appendChild(head);

      const body = el("div", null, "pick-body");
      body.appendChild(headshot(e));
      const info = el("div", null, "pick-info");
      const nameRow = el("div", null, "pick-name");
      nameRow.appendChild(el("span", e.name, "team"));
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
      host.appendChild(card);
    }
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
      text.appendChild(el("div", e.name, "team"));
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

  function renderMethod() {
    const w = data.weights;
    const f = data.format;
    const m = f.position_multipliers;
    const s = data.sources;
    const items = [
      `Prospect pool: ${s.consensus_board} prospects from the NFL Mock Draft Database consensus board and ${s.espn_board} from ESPN's big board, plus productive juniors and seniors from ${s.college_players} college stat lines. Only QB, RB, WR, and TE count.`,
      `Consensus value: the average of each prospect's board ranks, falling off quickly after the top picks the way real draft capital does.`,
      `Production value: college fantasy points per game with this league's scoring (${f.ppr} PPR), as a percentile among the top college players at the position, nudged by the last three games.`,
      `Blend: ${Math.round(w.consensus * 100)}% consensus, ${Math.round(w.production * 100)}% production right now. Production starts at 20% before the college season and grows to 40% as games are played.`,
      `League format: ${f.superflex ? "superflex" : "1-QB"} lineups, so value is multiplied by QB ${m.QB}, RB ${m.RB}, WR ${m.WR}, TE ${m.TE}.`,
      `Draft order: the projected order from the simulations, ${data.rounds} linear rounds, with traded picks going to their current owners.`,
      `Team needs: each roster's starters at every position are valued with dynasty values and compared with the league. Thin positions get a boost of up to 32%; deep positions are marked down. In a 1-QB league, a team with a starter-level QB and a real backup is "set at QB" and its QB prospects drop by about half.`,
      `Each pick: the owner takes the best value after that need adjustment. Each pick at a position eases that need for later rounds.`,
    ];
    document.getElementById("method").replaceChildren(...items.map((t) => el("li", t)));
  }

  async function load() {
    try {
      const [mock, latest] = await Promise.all([
        fetch("data/mock_draft.json", { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
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
    document.getElementById("title").replaceChildren(document.createTextNode(`${data.draft_year} Rookie `), el("em", "Mock Draft"));
    const when = new Date(data.generated_at);
    document.getElementById("updated").textContent =
      `${data.rounds} rounds · ${data.teams} teams · updated ${when.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
    renderPicks();
    renderBoard();
    renderMethod();
  }

  load();
})();
