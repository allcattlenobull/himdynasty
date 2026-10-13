/* HIM Dynasty weekly recap: awards, game cards, bench regret, all-play and luck.
   Data: data/recap.json (index) and data/recaps/{season}.json, rebuilt every
   morning from Sleeper lineups. Link to a week with #2026-w5.
   Names are set with textContent only. */
(() => {
  "use strict";
  const { el, dot, assignColors, teamLink, sortableTable, shareButton } = window.HIM;

  const S = { index: null, data: null, season: null, week: null, regretMode: "week", cache: {} };
  const f1 = (v) => (typeof v === "number" ? v.toFixed(1) : "—");
  const f2 = (v) => (typeof v === "number" ? v.toFixed(2) : "—");
  const signed = (v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1));
  const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th"}`;
  const others = (wk) => Object.keys(wk.teams).length - 1;
  const rec = (a) => (a[2] ? `${a[0]}-${a[1]}-${a[2]}` : `${a[0]}-${a[1]}`);

  const teamName = (rid) => (S.data.teams[String(rid)] || {}).team || `Team ${rid}`;
  const owner = (rid) => (S.data.teams[String(rid)] || {}).owner || "";
  const player = (pid) => (pid && S.data.players[pid]) || [pid || "Empty slot", "", ""];
  const pname = (pid) => (pid ? player(pid)[0] : "an empty slot");

  function teamTag(rid, withOwner = false) {
    const w = el("span", null, "teamcell");
    w.appendChild(dot(rid));
    const t = el("span");
    t.appendChild(teamLink(rid, teamName(rid)));
    if (withOwner) t.appendChild(el("div", owner(rid), "owner"));
    w.appendChild(t);
    return w;
  }

  function playerTag(pid, pts) {
    const p = player(pid);
    const w = el("span", null, "rc-player");
    if (p[1]) w.appendChild(el("span", p[1], `posbadge pos-${String(p[1]).toLowerCase()}`));
    w.appendChild(el("span", p[0], "rc-pname"));
    if (p[2] && p[1] !== "DEF") w.appendChild(el("span", p[2], "owner"));
    if (pts !== undefined) w.appendChild(el("span", f1(pts), "rc-ppts"));
    return w;
  }

  // ---------------------------------------------------------------- //
  // Loading and routing
  // ---------------------------------------------------------------- //
  async function getJson(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function loadSeason(season) {
    if (!S.cache[season]) S.cache[season] = await getJson(`data/recaps/${encodeURIComponent(season)}.json`);
    return S.cache[season];
  }

  function parseHash() {
    const m = /^#(\d{4})-w(\d{1,2})$/.exec(location.hash);
    return m ? { season: m[1], week: Number(m[2]) } : null;
  }

  const shareUrl = () => `share/recap-${S.season}-w${S.week}.html`;

  async function show(season, week, push) {
    S.season = season;
    S.data = await loadSeason(season);
    assignColors(Object.keys(S.data.teams).map(Number));
    const weeks = S.data.weeks.map((w) => w.week);
    S.week = weeks.includes(week) ? week : weeks[weeks.length - 1];
    if (push && S.week) history.replaceState(null, "", `#${S.season}-w${S.week}`);
    render();
  }

  // ---------------------------------------------------------------- //
  // Rendering
  // ---------------------------------------------------------------- //
  function render() {
    const d = S.data;
    const weekPills = document.getElementById("rc-weeks");
    weekPills.replaceChildren(...d.weeks.map((w) => {
      const b = el("button", `Week ${w.week}`, w.week === S.week ? "chip is-current" : "chip");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(w.week === S.week));
      b.addEventListener("click", () => show(S.season, w.week, true));
      return b;
    }));
    const wk = d.weeks.find((w) => w.week === S.week);
    if (!wk) {
      document.getElementById("rc-hero").replaceChildren(el("p", "No games are final yet this season. The first recap posts after week 1.", "note"));
      ["rc-awards", "rc-games"].forEach((id) => document.getElementById(id).replaceChildren());
      renderAllPlay();
      renderRegret(null);
      return;
    }
    document.title = `Week ${wk.week} Recap · HIM Dynasty`;
    renderHero(wk);
    renderAwards(wk);
    renderGames(wk);
    renderRegret(wk);
    renderAllPlay();
  }

  // Games a better lineup would have flipped.
  function flippable(wk) {
    return wk.games.filter((g) => g.winner).map((g) => {
      const loser = g.winner === g.a ? g.b : g.a;
      const lt = wk.teams[String(loser)];
      const wpts = g.winner === g.a ? g.pa : g.pb;
      return { g, loser, winner: g.winner, lmax: lt.max, wpts, regret: lt.regret };
    }).filter((x) => x.lmax > x.wpts);
  }

  function lede(wk) {
    const A = wk.awards;
    const T = (r) => teamName(r);
    const pts = (r) => wk.teams[String(r)].pts;
    const lines = [];
    const perfect = (A.perfect || []).includes(A.him);
    lines.push(`${T(A.him)} put up the week's top score, ${f1(pts(A.him))}${perfect ? ", with a perfect lineup" : ""}.`);
    if (A.blowout) {
      const g = wk.games.find((x) => x.a === A.blowout[0] && x.b === A.blowout[1]);
      if (g && g.winner) {
        const l = g.winner === g.a ? g.b : g.a;
        lines.push(`${T(g.winner)} ran ${T(l)} off the field by ${f1(g.margin)}.`);
      }
    }
    if (A.nailbiter) {
      const g = wk.games.find((x) => x.a === A.nailbiter[0] && x.b === A.nailbiter[1]);
      const same = A.blowout && A.blowout[0] === A.nailbiter[0] && A.blowout[1] === A.nailbiter[1];
      if (g && g.winner && !same) {
        const l = g.winner === g.a ? g.b : g.a;
        lines.push(`${T(g.winner)} survived ${T(l)} by just ${f2(g.margin)}.`);
      }
    }
    const flips = flippable(wk).sort((a, b) => b.regret - a.regret);
    if (flips.length) {
      const x = flips[0];
      lines.push(`${T(x.loser)} lost with ${f1(x.regret)} points on the bench; the best lineup (${f1(x.lmax)}) beats ${T(x.winner)}'s ${f1(x.wpts)}.`);
    }
    if (A.unlucky !== undefined) {
      const sorted = Object.values(wk.teams).map((t) => t.pts).sort((a, b) => b - a);
      const place = sorted.indexOf(pts(A.unlucky)) + 1;
      if (place <= 4) lines.push(`${T(A.unlucky)} scored the ${ordinal(place)}-most points (${f1(pts(A.unlucky))}) and still lost.`);
    }
    if (A.lucky !== undefined) {
      const beat = wk.teams[String(A.lucky)].ap[0];
      if (beat <= 4) lines.push(`${T(A.lucky)} won with ${f1(pts(A.lucky))}, a score that beats only ${beat} of ${others(wk)} teams.`);
    }
    return lines;
  }

  function renderHero(wk) {
    const host = document.getElementById("rc-hero");
    const head = el("div", null, "rc-hero-head");
    const title = el("h1", null, "rc-title");
    title.append(el("span", `${S.season}`, "rc-season"), el("span", `Week ${wk.week}`, "rc-week"));
    head.appendChild(title);
    head.appendChild(shareButton(shareUrl, () => `HIM Dynasty · Week ${wk.week} recap`, "Share recap"));
    const body = el("div", null, "rc-lede");
    for (const line of lede(wk)) body.appendChild(el("p", line));
    const stats = el("div", null, "rc-stats");
    const stat = (label, v) => {
      const s = el("div", null, "stat");
      s.append(el("div", label, "label"), el("div", v, "value"));
      return s;
    };
    stats.append(stat("High", f1(wk.high)), stat("Low", f1(wk.low)), stat("Average", f1(wk.avg)), stat("Median", f1(wk.median)));
    const totalRegret = Object.values(wk.teams).reduce((a, t) => a + t.regret, 0);
    stats.appendChild(stat("Left on benches", f1(totalRegret)));
    host.replaceChildren(head, body, stats);
  }

  function award(kicker, cls, build) {
    const c = el("article", null, `rc-award ${cls || ""}`);
    c.appendChild(el("p", kicker, "rc-award-k"));
    build(c);
    return c;
  }

  function renderAwards(wk) {
    const A = wk.awards;
    const T = wk.teams;
    const out = [];
    out.push(award("HIM of the week", "him", (c) => {
      c.append(teamTag(A.him, true), el("div", f1(T[String(A.him)].pts), "rc-big"));
      c.appendChild(el("p", "Top score in the league.", "rc-sub"));
    }));
    out.push(award("Ass of the week", "ass", (c) => {
      c.append(teamTag(A.ass, true), el("div", f1(T[String(A.ass)].pts), "rc-big"));
      c.appendChild(el("p", "Bottom score in the league.", "rc-sub"));
    }));
    if (A.mvp) {
      out.push(award("Player of the week", "", (c) => {
        c.append(playerTag(A.mvp[1]), el("div", f1(A.mvp[2]), "rc-big"));
        const p = el("p", "Started for ", "rc-sub");
        p.appendChild(teamLink(A.mvp[0], teamName(A.mvp[0])));
        c.appendChild(p);
      }));
    }
    const gameAward = (kicker, pair, sub) => {
      const g = wk.games.find((x) => x.a === pair[0] && x.b === pair[1]);
      if (!g) return;
      out.push(award(kicker, "", (c) => {
        const w = g.winner ?? g.a;
        const l = w === g.a ? g.b : g.a;
        const row = el("div", null, "rc-vs");
        row.append(teamTag(w), el("span", "def.", "owner"), teamTag(l));
        c.append(row, el("div", f2(g.margin), "rc-big"));
        c.appendChild(el("p", sub(g), "rc-sub"));
      }));
    };
    if (A.blowout) gameAward("Blowout", A.blowout, (g) => `${f1(Math.max(g.pa, g.pb))} to ${f1(Math.min(g.pa, g.pb))}`);
    if (A.nailbiter) gameAward("Nail-biter", A.nailbiter, (g) => `${f2(Math.max(g.pa, g.pb))} to ${f2(Math.min(g.pa, g.pb))}`);
    if (A.benchwarmer !== undefined) {
      const t = T[String(A.benchwarmer)];
      out.push(award("Bench Ass", "ass", (c) => {
        c.append(teamTag(A.benchwarmer, true), el("div", f1(t.regret), "rc-big"));
        c.appendChild(el("p", `Points left on the bench. Best lineup: ${f1(t.max)}.`, "rc-sub"));
      }));
    }
    if (A.blunder) {
      const [rid, m] = A.blunder;
      out.push(award("Worst start/sit", "ass", (c) => {
        c.appendChild(teamTag(rid));
        const sw = el("div", null, "rc-swap");
        sw.append(el("span", "Sat", "rc-swap-k"), playerTag(m.bench, m.bench_pts), el("span", "Started", "rc-swap-k"),
          m.start ? playerTag(m.start, m.start_pts) : el("span", "an empty slot", "rc-pname"));
        c.append(sw, el("div", `−${f1(m.gain)}`, "rc-big"));
      }));
    }
    if (A.unlucky !== undefined) {
      const t = T[String(A.unlucky)];
      out.push(award("Unluckiest loss", "", (c) => {
        c.append(teamTag(A.unlucky, true), el("div", f1(t.pts), "rc-big"));
        c.appendChild(el("p", `Would have beaten ${t.ap[0]} of ${others(wk)} teams. All-play ${rec(t.ap)}.`, "rc-sub"));
      }));
    }
    if (A.lucky !== undefined) {
      const t = T[String(A.lucky)];
      out.push(award("Luckiest win", "", (c) => {
        c.append(teamTag(A.lucky, true), el("div", f1(t.pts), "rc-big"));
        c.appendChild(el("p", `Would have beaten ${t.ap[0]} of ${others(wk)} teams. All-play ${rec(t.ap)}.`, "rc-sub"));
      }));
    }
    if (A.perfect && A.perfect.length) {
      out.push(award("Perfect lineup", "him", (c) => {
        const list = el("div", null, "rc-list");
        A.perfect.forEach((r) => list.appendChild(teamTag(r)));
        c.appendChild(list);
        c.appendChild(el("p", "Started the best possible lineup. Zero points on the bench.", "rc-sub"));
      }));
    }
    document.getElementById("rc-awards").replaceChildren(...out);
  }

  function side(wk, rid, pts, won) {
    const t = wk.teams[String(rid)];
    const s = el("div", null, `rc-side${won ? " won" : ""}`);
    const top = el("div", null, "rc-side-top");
    top.append(teamTag(rid, true), el("div", f2(pts), "rc-score"));
    s.appendChild(top);
    const eff = el("div", null, "rc-eff");
    const bar = el("span", null, "rc-effbar");
    const fill = el("span");
    fill.style.width = `${Math.max(0, Math.min(100, t.eff))}%`;
    bar.appendChild(fill);
    eff.append(bar, el("span", t.regret < 0.01 ? "Perfect lineup" : `${t.eff.toFixed(0)}% · ${f1(t.regret)} on bench`, "rc-effnum"));
    s.appendChild(eff);
    const best = t.lineup.filter((x) => x[1]).sort((a, b) => b[2] - a[2])[0];
    if (best) {
      const mvp = el("div", null, "rc-line");
      mvp.append(el("span", "Top starter", "rc-line-k"), playerTag(best[1], best[2]));
      s.appendChild(mvp);
    }
    if (t.moves.length) {
      const ul = el("ul", null, "rc-moves");
      for (const m of t.moves.slice(0, 3)) {
        const li = el("li");
        li.append(el("span", `+${f1(m.gain)}`, "rc-gain"), playerTag(m.bench, m.bench_pts), el("span", m.start ? "over" : "in an empty", "owner"),
          m.start ? playerTag(m.start, m.start_pts) : el("span", `${m.slot} slot`, "rc-pname"));
        ul.appendChild(li);
      }
      s.appendChild(ul);
    }
    return s;
  }

  function renderGames(wk) {
    const flips = new Map(flippable(wk).map((x) => [x.g, x]));
    const cards = wk.games.slice().sort((a, b) => a.margin - b.margin).map((g) => {
      const card = el("article", null, "rc-game");
      const tag = el("div", null, "rc-game-tags");
      const tags = [];
      if (wk.awards.nailbiter && wk.awards.nailbiter[0] === g.a && wk.awards.nailbiter[1] === g.b) tags.push(["Nail-biter", ""]);
      if (wk.awards.blowout && wk.awards.blowout[0] === g.a && wk.awards.blowout[1] === g.b) tags.push(["Blowout", ""]);
      const flip = flips.get(g);
      if (flip) tags.push([`Bench cost ${teamName(flip.loser)} the game`, "bad"]);
      tags.forEach(([t, c]) => tag.appendChild(el("span", t, `rc-tag ${c}`)));
      if (tags.length) card.appendChild(tag);
      card.appendChild(side(wk, g.a, g.pa, g.winner === g.a));
      card.appendChild(el("div", `Margin ${f2(g.margin)}`, "rc-margin"));
      card.appendChild(side(wk, g.b, g.pb, g.winner === g.b));
      return card;
    });
    document.getElementById("rc-games").replaceChildren(...cards);
  }

  function sparkRegret(values, highlightIdx) {
    const NS = "http://www.w3.org/2000/svg";
    const w = 8, gap = 3, h = 26;
    const max = Math.max(40, ...values);
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "spark");
    svg.setAttribute("width", values.length * (w + gap));
    svg.setAttribute("height", h);
    svg.setAttribute("aria-hidden", "true");
    values.forEach((v, i) => {
      const r = document.createElementNS(NS, "rect");
      const bh = Math.max(1.5, (v / max) * h);
      r.setAttribute("x", i * (w + gap));
      r.setAttribute("y", h - bh);
      r.setAttribute("width", w);
      r.setAttribute("height", bh);
      r.setAttribute("class", i === highlightIdx ? "sb hot" : "sb");
      const t = document.createElementNS(NS, "title");
      t.textContent = `Week ${S.data.weeks[i] ? S.data.weeks[i].week : i + 1}: ${v.toFixed(1)}`;
      r.appendChild(t);
      svg.appendChild(r);
    });
    return svg;
  }

  function renderRegret(wk) {
    const modes = [["week", wk ? `Week ${wk.week}` : "Week"], ["season", "Season"]];
    if (!wk) S.regretMode = "season";
    document.getElementById("rg-mode").replaceChildren(...modes.map(([k, label]) => {
      const b = el("button", label, k === S.regretMode ? "chip is-current" : "chip");
      b.type = "button";
      b.disabled = k === "week" && !wk;
      b.addEventListener("click", () => { S.regretMode = k; renderRegret(wk); });
      return b;
    }));
    const host = document.getElementById("rg-table");
    const team = { key: "team", label: "Team", val: (r) => teamName(r.rid).toLowerCase(), dir: 1, cell: (r) => teamTag(r.rid, true) };
    if (S.regretMode === "week" && wk) {
      const flips = new Set(flippable(wk).map((x) => x.loser));
      const rows = Object.entries(wk.teams).map(([rid, t]) => ({ rid: Number(rid), ...t }));
      sortableTable(host, [
        team,
        { key: "pts", label: "Scored", num: true, val: (r) => r.pts, cell: (r) => f1(r.pts) },
        { key: "max", label: "Best possible", num: true, val: (r) => r.max, cell: (r) => f1(r.max) },
        { key: "regret", label: "On bench", num: true, val: (r) => r.regret, cell: (r) => el("strong", f1(r.regret)) },
        { key: "eff", label: "Lineup %", num: true, val: (r) => r.eff, cell: (r) => `${r.eff.toFixed(1)}%`, title: "Points scored as a share of the best possible lineup" },
        { key: "res", label: "Result", val: (r) => (r.result === "W" ? 2 : r.result === "T" ? 1 : 0), cell: (r) => {
          const s = el("span", r.result || "—", `rc-res ${r.result === "W" ? "w" : r.result === "L" ? "l" : ""}`);
          if (flips.has(r.rid)) { const w = el("span"); w.append(s, el("span", " best lineup wins", "rc-flip")); return w; }
          return s;
        } },
        { key: "miss", label: "Biggest miss", val: (r) => (r.moves[0] ? r.moves[0].gain : 0), cell: (r) => {
          const m = r.moves.slice().sort((a, b) => b.gain - a.gain)[0];
          if (!m) return el("span", "—", "owner");
          const w = el("span", null, "rc-miss");
          w.append(playerTag(m.bench, m.bench_pts), el("span", m.start ? " over " : " in empty slot", "owner"));
          if (m.start) w.appendChild(playerTag(m.start, m.start_pts));
          return w;
        } },
      ], rows, { sort: { key: "regret", dir: -1 }, rowRid: (r) => r.rid });
    } else {
      const rows = S.data.season_totals;
      const idx = wk ? S.data.weeks.findIndex((w) => w.week === wk.week) : -1;
      sortableTable(host, [
        team,
        { key: "regret", label: "On bench", num: true, val: (r) => r.regret, cell: (r) => el("strong", f1(r.regret)) },
        { key: "avg", label: "Per week", num: true, val: (r) => r.regret_avg, cell: (r) => f1(r.regret_avg) },
        { key: "eff", label: "Lineup %", num: true, val: (r) => r.eff, cell: (r) => `${r.eff.toFixed(1)}%` },
        { key: "perfect", label: "Perfect wks", num: true, val: (r) => r.perfect },
        { key: "pf", label: "PF", num: true, val: (r) => r.pf, cell: (r) => f1(r.pf) },
        { key: "max", label: "Max PF", num: true, val: (r) => r.max, cell: (r) => f1(r.max) },
        { key: "weeks", label: "By week", cell: (r) => sparkRegret(r.weekly_regret, idx) },
      ], rows, { sort: { key: "regret", dir: -1 }, rowRid: (r) => r.rid });
    }
  }

  function renderAllPlay() {
    const rows = S.data.season_totals;
    const host = document.getElementById("ap-table");
    if (!rows.length) { host.replaceChildren(el("p", "All-play starts after week 1.", "note")); return; }
    sortableTable(host, [
      { key: "team", label: "Team", val: (r) => teamName(r.rid).toLowerCase(), dir: 1, cell: (r) => teamTag(r.rid, true) },
      { key: "rec", label: "Record", num: true, val: (r) => r.record[0] + r.record[2] / 2 + r.pf / 1e6, cell: (r) => rec(r.record) },
      { key: "ap", label: "All-play", num: true, val: (r) => r.allplay_pct, cell: (r) => rec(r.allplay) },
      { key: "app", label: "All-play %", num: true, val: (r) => r.allplay_pct, cell: (r) => `${r.allplay_pct.toFixed(1)}%` },
      { key: "xw", label: "Expected W", num: true, val: (r) => r.xw, cell: (r) => f1(r.xw), title: "Wins all-play says the team earned" },
      { key: "luck", label: "Luck", num: true, val: (r) => r.luck, cell: (r) => el("strong", signed(r.luck), r.luck >= 0.5 ? "up" : r.luck <= -0.5 ? "down" : ""),
        title: "Actual wins minus expected wins" },
      { key: "high", label: "Top score wks", num: true, val: (r) => r.high },
      { key: "low", label: "Bottom wks", num: true, val: (r) => r.low },
    ], rows, { sort: { key: "luck", dir: -1 }, rowRid: (r) => r.rid });
  }

  // ---------------------------------------------------------------- //
  // Boot
  // ---------------------------------------------------------------- //
  async function boot() {
    try {
      S.index = await getJson("data/recap.json");
    } catch (e) {
      document.getElementById("updated").textContent = "The recap is not available yet.";
      return;
    }
    const idx = S.index;
    const when = new Date(idx.generated_at);
    document.getElementById("updated").textContent =
      `Through week ${idx.weeks_completed || 0} · updated ${when.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
    const sel = document.getElementById("rc-season");
    sel.replaceChildren(...idx.seasons.map((s) => { const o = el("option", s); o.value = s; return o; }));
    document.getElementById("rc-season-wrap").hidden = idx.seasons.length < 2;
    sel.addEventListener("change", () => show(sel.value, null, true));
    const h = parseHash();
    const season = h && idx.seasons.includes(h.season) ? h.season : idx.current;
    sel.value = season;
    try {
      await show(season, h ? h.week : null, false);
    } catch (e) {
      document.getElementById("rc-hero").replaceChildren(el("p", `Could not load the recap (${e.message}).`, "error"));
    }
    window.addEventListener("hashchange", () => {
      const x = parseHash();
      if (x && (x.season !== S.season || x.week !== S.week)) { sel.value = x.season; show(x.season, x.week, false); }
    });
  }
  boot();
})();
