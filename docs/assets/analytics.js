/* HIM Dynasty analytics: weekly start/sit, compare, explorer, defenses, teams,
   and player profiles.
   Data: data/startsit.json (projections, matchups, lineups), data/splits.json
   (play-by-play splits), data/analytics.json (season production), all built
   every morning. Names are set with textContent only. */
(() => {
  "use strict";
  const { el, dot, teamLink, assignColors, cssVar, themeChart, withAlpha } = window.HIM;

  let A = null;   // analytics.json
  let S = null;   // startsit.json
  let SP = null;  // splits.json
  let latest = null;
  let trade = null;
  let charts = [];
  const byId = {};  // merged player lookup

  // ---------------------------------------------------------------- //
  // Formatting and the metric catalog
  // ---------------------------------------------------------------- //
  const isNum = (v) => typeof v === "number" && isFinite(v);
  const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th"}`;
  function fmtv(v, f) {
    if (!isNum(v)) return "—";
    if (f === "pct") return `${v.toFixed(1)}%`;
    if (f === "pct0") return `${v.toFixed(0)}%`;
    if (f === "epa") return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`;
    if (f === "sgn1") return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`;
    return v.toFixed(f || 0);
  }
  const fmt = (v, d = 1, suffix = "") => (isNum(v) ? `${v.toFixed(d)}${suffix}` : "—");
  const signed = (v, d = 1) => (isNum(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}` : "—");
  const teamName = (rid) => (latest && latest.teams[String(rid)] ? latest.teams[String(rid)].team.trim() : `Team ${rid}`);

  // key: [column label, format, direction (+1 higher is better, -1 lower, 0 neutral), description]
  const M = {
    g: ["G", 0, 0, "Games played in the time frame."],
    snap: ["Snap%", "pct0", 1, "Share of the team's offensive snaps (nflverse snap counts)."],
    ppg: ["PPG", 1, 1, "Fantasy points per game in this league's scoring."],
    xfp_pg: ["xFP/G", 1, 1, "Expected fantasy points per game from usage (ffopportunity): what an average player scores with the same targets, carries, field position and depth."],
    db: ["Dropbacks", 0, 1, "Pass attempts + sacks + scrambles."],
    db_pg: ["DB/G", 1, 1, "Dropbacks per game."],
    epa_db: ["EPA/DB", "epa", 1, "Expected points added per dropback: how much each play moved the team toward points. 0 is average-ish; +0.15 is very good."],
    succ: ["Success%", "pct", 1, "Share of plays that gained enough to keep the offense on schedule (positive EPA)."],
    cmp_pct: ["Comp%", "pct", 1, "Completion rate."],
    cpoe: ["CPOE", "sgn1", 1, "Completion % over expected, given throw depth and situation."],
    ypa: ["Y/A", 2, 1, "Passing yards per attempt."],
    adot: ["aDOT", 1, 0, "Average depth of target in air yards."],
    deep_rate: ["Deep%", "pct", 0, "Share of throws 20+ air yards downfield."],
    deep_epa: ["Deep EPA", "epa", 1, "EPA per deep (20+ air yards) throw."],
    sack_rate: ["Sack%", "pct", -1, "Sacks per dropback."],
    hit_rate: ["Hit%", "pct", -1, "Hit or sacked per dropback: a pressure stand-in."],
    int_rate: ["INT%", "pct", -1, "Interceptions per attempt."],
    td_rate: ["TD%", "pct", 1, "Touchdown passes per attempt."],
    iw_rate: ["TWP%", "pct", -1, "Interception-worthy throws per dropback (FTN charting): turnover luck stripped out."],
    scr_rate: ["Scramble%", "pct", 1, "Scrambles per dropback."],
    scr_ypg: ["Scr Yds/G", 1, 1, "Scramble yards per game."],
    rz_att_pg: ["RZ Att/G", 1, 1, "Red-zone pass attempts per game (inside the 20)."],
    rz_td: ["RZ TD", 0, 1, "Red-zone touchdown passes."],
    bz_db: ["Blitzed DB", 0, 0, "Dropbacks facing a blitz."],
    bz_rate: ["Blitzed%", "pct", 0, "Share of dropbacks where the defense blitzed (FTN: any extra rusher)."],
    bz_epa: ["EPA vs Blitz", "epa", 1, "EPA per dropback when blitzed."],
    nbz_epa: ["EPA no Blitz", "epa", 1, "EPA per dropback when not blitzed."],
    bz_ypa: ["Y/A vs Blitz", 2, 1, "Yards per attempt when blitzed."],
    nbz_ypa: ["Y/A no Blitz", 2, 1, "Yards per attempt when not blitzed."],
    bz_cmp: ["Comp% vs Blitz", "pct", 1, "Completion rate when blitzed."],
    bz_sack: ["Sack% vs Blitz", "pct", -1, "Sack rate when blitzed."],
    pa_rate: ["Play-Action%", "pct", 0, "Share of dropbacks with play action (FTN)."],
    pa_epa: ["PA EPA", "epa", 1, "EPA per play-action dropback."],
    oop_rate: ["Out of Pocket%", "pct", 0, "Share of dropbacks where he left the pocket (FTN)."],
    oop_epa: ["OOP EPA", "epa", 1, "EPA per out-of-pocket dropback."],
    ttt: ["Time to Throw", 2, 0, "Average seconds from snap to throw (Next Gen Stats)."],
    aggr: ["Tight Window%", "pct", 0, "Throws into tight coverage (Next Gen Stats aggressiveness)."],
    air_diff: ["Air Yds Diff", 1, 0, "Completed minus intended air yards (Next Gen Stats); closer to 0 means he completes the deep ones."],
    car: ["Carries", 0, 1, "Designed carries (scrambles excluded)."],
    car_pg: ["Car/G", 1, 1, "Designed carries per game."],
    ryd_pg: ["Rush Yds/G", 1, 1, "Rushing yards per game on designed runs."],
    rtd: ["Rush TD", 0, 1, "Rushing touchdowns."],
    tgt: ["Targets", 0, 1, "Pass targets."],
    tgt_pg: ["Tgt/G", 1, 1, "Targets per game."],
    tgt_share: ["Tgt Share", "pct", 1, "Share of the team's targets while he played."],
    air_share: ["Air Share", "pct", 1, "Share of the team's air yards."],
    wopr: ["WOPR", 2, 1, "Weighted opportunity: 1.5 × target share + 0.7 × air-yards share. 0.7+ is an alpha."],
    rec: ["Rec", 0, 1, "Receptions."],
    rec_pg: ["Rec/G", 1, 1, "Receptions per game."],
    recyd_pg: ["Rec Yds/G", 1, 1, "Receiving yards per game."],
    rectd: ["Rec TD", 0, 1, "Receiving touchdowns."],
    catch: ["Catch%", "pct", 1, "Receptions per target."],
    ypt: ["Y/Tgt", 2, 1, "Receiving yards per target."],
    yac_rec: ["YAC/Rec", 1, 1, "Yards after catch per reception."],
    epa_tgt: ["EPA/Tgt", "epa", 1, "EPA per target."],
    rec_succ: ["Tgt Success%", "pct", 1, "Share of targets that were successful plays."],
    rz_tgt: ["RZ Tgt", 0, 1, "Red-zone targets (inside the 20)."],
    rz_tgt_share: ["RZ Tgt Share", "pct", 1, "Share of the team's red-zone targets."],
    ez_tgt: ["End-Zone Tgt", 0, 1, "Targets thrown into the end zone."],
    deep_tgt: ["Deep Tgt", 0, 1, "Targets 20+ air yards downfield."],
    deep_share: ["Deep Tgt Share", "pct", 1, "Share of the team's deep targets."],
    third_share: ["3rd-Down Share", "pct", 1, "Share of the team's third-down targets."],
    catchable: ["Catchable%", "pct", 1, "Share of his targets that were catchable (FTN): how well he's being thrown to."],
    contested: ["Contested%", "pct", 0, "Share of targets that were contested (FTN)."],
    drops: ["Drops", 0, -1, "Drops (FTN)."],
    drop_rate: ["Drop%", "pct", -1, "Drops per catchable target (FTN)."],
    created: ["Created Rec", 0, 1, "Receptions he created on off-target or contested balls (FTN)."],
    bz_share: ["Share vs Blitz", "pct", 1, "Share of the team's targets on blitzed dropbacks: is he the hot read?"],
    pa_share: ["PA Share", "pct", 1, "Share of the team's play-action targets."],
    screen_rate: ["Screen%", "pct", 0, "Share of his targets that were screens (FTN)."],
    routes: ["Routes*", 0, 1, "Estimated routes: team dropbacks × his snap share × a route rate by position (WR 97%, TE 78%, RB 62%). Public data has no route tracking, so this is an estimate."],
    yprr: ["YPRR*", 2, 1, "Receiving yards per estimated route run. Elite is 2.5+; average WR about 1.8."],
    tprr: ["TPRR*", "pct", 1, "Targets per estimated route run."],
    route_rate: ["Route%*", "pct", 1, "Estimated routes per team dropback."],
    rush_share: ["Rush Share", "pct", 1, "Share of the team's designed carries."],
    ypc: ["YPC", 2, 1, "Yards per carry."],
    epa_car: ["EPA/Car", "epa", 1, "EPA per carry."],
    run_succ: ["Run Success%", "pct", 1, "Share of carries that were successful plays."],
    exp_run: ["Explosive%", "pct", 1, "Carries of 10+ yards."],
    stuff: ["Stuffed%", "pct", -1, "Carries for zero or negative yards."],
    rz_car: ["RZ Car", 0, 1, "Red-zone carries (inside the 20)."],
    rz_car_share: ["RZ Car Share", "pct", 1, "Share of the team's red-zone carries."],
    i10_car: ["Inside-10 Car", 0, 1, "Carries inside the 10."],
    i10_share: ["Inside-10 Share", "pct", 1, "Share of the team's carries inside the 10."],
    i5_car: ["Inside-5 Car", 0, 1, "Carries inside the 5."],
    gl_td: ["Goal-Line TD", 0, 1, "Touchdowns on carries inside the 5."],
    in_ypc: ["YPC Inside", 2, 1, "Yards per carry on runs between the tackles."],
    out_ypc: ["YPC Outside", 2, 1, "Yards per carry on runs outside the tackles."],
    stack_rate: ["Stacked Box%", "pct", 0, "Carries into 8+ defenders in the box (FTN)."],
    stack_ypc: ["YPC vs 8+ Box", 2, 1, "Yards per carry into stacked boxes."],
    light_ypc: ["YPC vs Light Box", 2, 1, "Yards per carry against 6 or fewer in the box."],
    opp_pg: ["Opp/G", 1, 1, "Carries + targets per game."],
    rz_opp_pg: ["RZ Opp/G", 1, 1, "Red-zone carries + targets per game."],
    sep: ["Separation", 2, 1, "Yards from the nearest defender at the catch or incompletion (Next Gen Stats)."],
    cushion: ["Cushion", 2, 0, "Yards of cushion at the snap (Next Gen Stats)."],
    yac_oe: ["YAC over Exp", 2, 1, "Yards after catch above expected per reception (Next Gen Stats)."],
    ryoe: ["RYOE/Att", 2, 1, "Rush yards over expected per carry (Next Gen Stats): what he adds beyond his blocking."],
    ryoe_pct: ["Beat Exp%", "pct", 1, "Share of carries that beat the expected yardage (Next Gen Stats)."],
    box8_ngs: ["8+ Box% (NGS)", "pct", 0, "Carries against 8+ defenders (Next Gen Stats)."],
    ttl: ["Time to LOS", 2, 0, "Seconds to reach the line of scrimmage (Next Gen Stats)."],
  };

  const GROUPS = {
    QB: [
      ["Fantasy", ["ppg", "xfp_pg", "g"]],
      ["Volume", ["db_pg", "rz_att_pg", "car_pg", "ryd_pg"]],
      ["Efficiency", ["epa_db", "succ", "cpoe", "ypa", "td_rate", "int_rate", "iw_rate"]],
      ["Pressure", ["sack_rate", "hit_rate", "ttt"]],
      ["vs Blitz", ["bz_rate", "bz_epa", "nbz_epa", "bz_ypa", "nbz_ypa", "bz_cmp", "bz_sack"]],
      ["Play design", ["pa_rate", "pa_epa", "oop_rate", "oop_epa"]],
      ["Downfield", ["adot", "deep_rate", "deep_epa", "aggr", "air_diff"]],
      ["Rushing", ["scr_rate", "scr_ypg", "i10_car", "rtd"]],
    ],
    RB: [
      ["Fantasy", ["ppg", "xfp_pg", "g"]],
      ["Usage", ["snap", "car_pg", "rush_share", "tgt_pg", "tgt_share", "opp_pg", "route_rate"]],
      ["Rushing", ["ypc", "epa_car", "run_succ", "exp_run", "stuff", "ryoe", "ryoe_pct"]],
      ["Box & gaps", ["stack_rate", "stack_ypc", "light_ypc", "in_ypc", "out_ypc", "ttl"]],
      ["Red zone", ["rz_car", "rz_car_share", "i10_car", "i10_share", "i5_car", "gl_td", "rz_tgt", "rz_opp_pg"]],
      ["Receiving", ["routes", "yprr", "tprr", "catch", "ypt", "epa_tgt", "yac_rec", "rec_pg"]],
    ],
    WR: [
      ["Fantasy", ["ppg", "xfp_pg", "g"]],
      ["Usage", ["snap", "routes", "route_rate", "tgt_pg", "tgt_share", "air_share", "wopr", "third_share"]],
      ["Efficiency", ["yprr", "tprr", "ypt", "catch", "epa_tgt", "rec_succ", "yac_rec", "yac_oe"]],
      ["Downfield", ["adot", "deep_tgt", "deep_share", "sep", "cushion"]],
      ["Red zone", ["rz_tgt", "rz_tgt_share", "ez_tgt", "rz_opp_pg", "rectd"]],
      ["Ball quality", ["catchable", "contested", "drops", "drop_rate", "created"]],
      ["Situations", ["bz_share", "pa_share", "screen_rate"]],
    ],
  };
  GROUPS.TE = GROUPS.WR;
  const DEFAULT_GROUPS = { QB: ["Fantasy", "Efficiency", "vs Blitz"], RB: ["Fantasy", "Usage", "Rushing", "Red zone"], WR: ["Fantasy", "Usage", "Efficiency", "Red zone"], TE: ["Fantasy", "Usage", "Efficiency", "Red zone"] };
  const VOLUME = { QB: ["db", "dropbacks", 300], RB: ["opp", "carries + targets", 150], WR: ["tgt", "targets", 70], TE: ["tgt", "targets", 50] };

  // ---------------------------------------------------------------- //
  // Shared bits
  // ---------------------------------------------------------------- //
  function headshot(p, cls = "headshot") {
    const img = el("img", null, cls);
    img.alt = "";
    img.loading = "lazy";
    const id = p && p.id ? String(p.id) : "";
    if (p && p.pos === "DEF") img.src = `https://sleepercdn.com/images/team_logos/nfl/${encodeURIComponent(id.toLowerCase())}.png`;
    else img.src = (p && p.headshot) || (id && !id.startsWith("g") ? `https://sleepercdn.com/content/nfl/players/thumb/${encodeURIComponent(id)}.jpg` : "");
    img.addEventListener("error", () => { img.style.visibility = "hidden"; });
    return img;
  }
  const posBadge = (pos) => el("span", pos, `posbadge pos-${String(pos).toLowerCase()}`);

  function tile(label, value, sub) {
    const box = el("div", null, "stat");
    box.appendChild(el("div", label, "label"));
    box.appendChild(el("div", value, "value"));
    if (sub) box.appendChild(el("div", sub, "owner"));
    return box;
  }
  function group(title, tiles) {
    const g = el("div", null, "an-group");
    g.appendChild(el("div", title, "group-title"));
    const grid = el("div", null, "stats");
    tiles.filter(Boolean).forEach((t) => grid.appendChild(t));
    g.appendChild(grid);
    return g;
  }
  function chartCard(title) {
    const c = el("div", null, "chart-card");
    c.appendChild(el("div", null, "chart-head")).appendChild(el("h3", title));
    const b = el("div", null, "chart-box");
    const cv = el("canvas");
    b.appendChild(cv);
    c.appendChild(b);
    return [c, cv];
  }
  function lineChart(canvas, labels, datasets, yOpts) {
    const chart = new Chart(canvas, {
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { borderWidth: 1, padding: 10 } },
        scales: { x: { grid: {}, ticks: {} }, y: Object.assign({ grid: {}, ticks: {} }, yOpts || {}) },
      },
    });
    themeChart(chart);
    chart.options.plugins.legend.labels.color = cssVar("--muted");
    chart.update("none");
    charts.push(chart);
    return chart;
  }
  const kickCache = {};
  function kickoff(g) {
    if (!g || !g.kick) return "";
    if (kickCache[g.kick] !== undefined) return kickCache[g.kick];
    return (kickCache[g.kick] = kickoffText(g));
  }
  function kickoffText(g) {
    const [d, t] = g.kick.split(" ");
    const dt = new Date(`${d}T${t || "13:00"}:00-04:00`);
    if (isNaN(dt)) return "";
    return dt.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  }
  function gameLine(p) {
    if (p.bye) return p.nfl ? `${p.nfl} · bye` : "No team";
    const g = S.games[p.nfl];
    const bits = [`${p.nfl} ${g && g.home === false ? "@" : "vs"} ${p.opp || "?"}`];
    if (g) {
      const k = kickoff(g);
      if (k) bits.push(k);
      if (isNum(g.implied)) bits.push(`${g.implied.toFixed(1)} implied pts`);
    }
    return bits.join(" · ");
  }
  function rangeBar(p, max) {
    const wrap = el("div", null, "range");
    const fl = Math.max(0, p.floor || 0), ce = p.ceil || 0, pr = p.proj || 0;
    const seg = el("span", null, "range-seg");
    seg.style.left = `${(fl / max) * 100}%`;
    seg.style.width = `${Math.max(1, ((ce - fl) / max) * 100)}%`;
    const mark = el("span", null, "range-mark");
    mark.style.left = `${(pr / max) * 100}%`;
    wrap.append(seg, mark);
    wrap.title = `Likely range ${fl.toFixed(0)}–${ce.toFixed(0)} points`;
    return wrap;
  }
  function reasonList(items, cls) {
    const ul = el("ul", null, `reasons ${cls}`);
    items.forEach((t) => ul.appendChild(el("li", t)));
    return ul;
  }
  function setHash(h) {
    if (location.hash !== h) history.replaceState(null, "", `analytics.html${h}`);
  }

  // ---------------------------------------------------------------- //
  // Start / Sit
  // ---------------------------------------------------------------- //
  const ACTION_CLASS = { "Start": "act-start", "Start (move in)": "act-in", "Sit": "act-sit", "Bench": "act-bench" };
  const ACTION_LABEL = { "Start": "Start", "Start (move in)": "Move in", "Sit": "Sit", "Bench": "Bench" };

  function ssPlayer(p, rec, slot, max, opts = {}) {
    const card = el("article", null, `ss-card ${ACTION_CLASS[rec.action] || ""}${opts.compact ? " compact" : ""}`);
    card.appendChild(el("div", slot || "BN", "ss-slot"));
    card.appendChild(headshot(p));
    const main = el("div", null, "ss-main");
    const nm = el("div", null, "ss-name");
    const b = el("button", p.name, "team prospect-link");
    b.type = "button";
    b.addEventListener("click", () => openPlayer(p.id));
    nm.append(b, posBadge(p.pos));
    if (p.inj) nm.appendChild(el("span", p.inj, "inj"));
    main.appendChild(nm);
    main.appendChild(el("div", gameLine(p), "owner"));
    (rec.why || []).forEach((w) => main.appendChild(el("div", w, "ss-why")));
    const pros = p.pros || [], cons = p.cons || [];
    if (opts.compact && (pros.length || cons.length)) {
      const det = el("details", null, "ss-more");
      det.appendChild(el("summary", `Why · ${pros.length} for, ${cons.length} against`));
      if (pros.length) det.appendChild(reasonList(pros, "pro"));
      if (cons.length) det.appendChild(reasonList(cons, "con"));
      main.appendChild(det);
    } else {
      if (pros.length) main.appendChild(reasonList(pros, "pro"));
      if (cons.length) main.appendChild(reasonList(cons, "con"));
    }
    if (opts.compareWith) {
      const c = el("a", `Compare with ${byId[opts.compareWith] ? byId[opts.compareWith].name : "starter"}`, "chip small-link");
      c.href = `#compare/${encodeURIComponent(p.id)}/${encodeURIComponent(opts.compareWith)}`;
      main.appendChild(c);
    }
    card.appendChild(main);
    const side = el("div", null, "ss-proj");
    side.appendChild(el("div", p.bye || p.out ? "—" : p.proj.toFixed(1), "ss-points"));
    side.appendChild(el("div", p.bye || p.out ? (p.bye ? "bye" : p.inj || "out") : `${p.pos}${p.rank || "?"} · proj`, "owner"));
    if (!p.bye && !p.out) side.appendChild(rangeBar(p, max));
    side.appendChild(el("span", ACTION_LABEL[rec.action] || rec.action, `act-badge ${ACTION_CLASS[rec.action] || ""}`));
    card.appendChild(side);
    return card;
  }

  function renderLeagueOverview(host) {
    const grid = el("div", null, "ss-overview");
    const ids = Object.keys(S.teams).sort((a, b) => teamName(a).localeCompare(teamName(b)));
    for (const rid of ids) {
      const t = S.teams[rid];
      const c = el("a", null, "ss-team-card");
      c.href = `#startsit/${rid}`;
      const head = el("div", null, "teamcell");
      head.append(dot(Number(rid)), el("span", teamName(rid), "team"));
      c.appendChild(head);
      if (t.opp) c.appendChild(el("div", `vs ${teamName(t.opp)}`, "owner"));
      const row = el("div", null, "ss-team-row");
      row.appendChild(el("span", t.proj.toFixed(1), "ss-points"));
      if (isNum(t.opp_proj)) row.appendChild(el("span", `to ${t.opp_proj.toFixed(1)}`, "owner"));
      c.appendChild(row);
      if (isNum(t.win)) {
        const bar = el("div", null, "winbar");
        const fill = el("span");
        fill.style.width = `${t.win}%`;
        bar.appendChild(fill);
        c.appendChild(bar);
        c.appendChild(el("div", `${t.win.toFixed(0)}% to win`, "owner"));
      }
      c.appendChild(el("div", t.changes ? `${t.changes} player${t.changes === 1 ? "" : "s"} to move in` : "Lineup is set", t.changes ? "ss-chg" : "ss-ok"));
      grid.appendChild(c);
    }
    host.replaceChildren(grid);
  }

  function renderStartSit(rid) {
    const host = document.getElementById("ss-body");
    const sel = document.getElementById("ss-team");
    sel.value = rid || "";
    document.getElementById("ss-title").textContent = `Week ${S.week} Start / Sit`;
    document.getElementById("ss-note").textContent =
      "Projections are Sleeper's, scored with this league's settings. Matchups, usage and Vegas lines explain each call; they don't override the number, because a season of graded picks showed matchup tweaks didn't beat Sleeper. "
      + "A player is only told to sit when someone better can take his spot. Close calls go to the higher ceiling if you're an underdog this week, the steadier floor if you're a big favorite. Updated every morning.";
    if (S.offseason) {
      document.getElementById("ss-title").textContent = "Start / Sit";
      host.replaceChildren(el("p", `It's the offseason. Start/sit returns when the regular season starts. Until then, Explorer and Defenses show the ${S.stats_season || S.season} season.`, "note"));
      return;
    }
    if (!rid || !S.teams[rid]) {
      renderLeagueOverview(host);
      return;
    }
    const t = S.teams[rid];
    host.replaceChildren();
    // Matchup header
    const mh = el("div", null, "ss-matchup");
    const left = el("div", null, "ss-side");
    left.append(el("div", teamName(rid), "team"), el("div", t.proj.toFixed(1), "ss-big"));
    mh.appendChild(left);
    const mid = el("div", null, "ss-mid");
    if (isNum(t.win)) {
      mid.appendChild(el("div", `${t.win.toFixed(0)}%`, "ss-win"));
      mid.appendChild(el("div", "chance to win", "owner"));
      const mode = t.mode === "ceiling" ? "Underdog: close calls go to the higher ceiling" : t.mode === "floor" ? "Favorite: close calls go to the safer floor" : "Toss-up: close calls go to the projection";
      mid.appendChild(el("div", mode, "ss-mode"));
    } else mid.appendChild(el("div", "No matchup found this week", "owner"));
    mh.appendChild(mid);
    if (t.opp) {
      const right = el("div", null, "ss-side right");
      const a = el("a", teamName(t.opp), "team");
      a.href = `#startsit/${t.opp}`;
      right.append(a, el("div", isNum(t.opp_proj) ? t.opp_proj.toFixed(1) : "—", "ss-big"));
      mh.appendChild(right);
    }
    host.appendChild(mh);

    const ids = Object.keys(t.recs);
    const max = Math.max(30, ...ids.map((id) => (byId[id] && byId[id].ceil) || 0));
    host.appendChild(el("h3", "Best lineup", "sub-head"));
    const list = el("div", null, "ss-list");
    for (const s of t.lineup) {
      const p = byId[s.id];
      if (p) list.appendChild(ssPlayer(p, t.recs[s.id], s.slot, max));
    }
    host.appendChild(list);

    const starters = new Set(t.lineup.map((s) => s.id));
    const benchIds = ids.filter((id) => !starters.has(id) && byId[id]);
    const order = { "Sit": 0, "Bench": 1 };
    benchIds.sort((a, b) => (order[t.recs[a].action] ?? 2) - (order[t.recs[b].action] ?? 2)
      || ((byId[b].bye || byId[b].out) ? -1 : 0) - ((byId[a].bye || byId[a].out) ? -1 : 0) || byId[b].proj - byId[a].proj);
    host.appendChild(el("h3", "Bench", "sub-head"));
    const bl = el("div", null, "ss-list");
    for (const id of benchIds) {
      const p = byId[id];
      let cmp = null;
      if (!p.bye && !p.out && p.proj > 0.5) {
        const elig = t.lineup.filter((s) => { const q = byId[s.id]; return q && (q.pos === p.pos || (["FLEX"].includes(s.slot) && ["RB", "WR", "TE"].includes(p.pos))); });
        const weakest = elig.sort((a, b) => byId[a.id].proj - byId[b.id].proj)[0];
        cmp = weakest ? weakest.id : null;
      }
      bl.appendChild(ssPlayer(p, t.recs[id], "BN", max, { compact: true, compareWith: cmp }));
    }
    host.appendChild(bl);

    if (t.waivers && t.waivers.length) {
      host.appendChild(el("h3", "Free agents who'd start", "sub-head"));
      const wl = el("div", null, "ss-waivers");
      for (const w of t.waivers) {
        const add = byId[w.add], over = byId[w.over];
        if (!add || !over) continue;
        const row = el("div", null, "ss-waiver");
        row.appendChild(headshot(add));
        const tx = el("div");
        const b = el("button", add.name, "team prospect-link");
        b.type = "button";
        b.addEventListener("click", () => openPlayer(add.id));
        tx.append(b, document.createTextNode(` ${add.pos} · `), el("span", gameLine(add), "owner"));
        tx.appendChild(el("div", `Projects ${add.proj.toFixed(1)}, ${w.gain.toFixed(1)} more than ${over.name}. ${add.pros[0] || ""}`, "ss-why"));
        row.appendChild(tx);
        const c = el("a", "Compare", "chip");
        c.href = `#compare/${encodeURIComponent(add.id)}/${encodeURIComponent(over.id)}`;
        row.appendChild(c);
        wl.appendChild(row);
      }
      host.appendChild(wl);
    }
  }

  // ---------------------------------------------------------------- //
  // Compare
  // ---------------------------------------------------------------- //
  const cmp = { a: null, b: null, scope: "s" };
  const labelFor = (p) => `${p.name} · ${p.pos} · ${p.nfl || "FA"}`;
  let labelToId = {};

  let compareSetup = false;
  function setupCompare() {
    if (compareSetup) return;
    compareSetup = true;
    const dl = document.getElementById("cmp-list");
    labelToId = {};
    const all = Object.values(byId).filter((p) => p.pos && (p.proj !== undefined || p.s)).sort((a, b) => (b.proj || 0) - (a.proj || 0));
    dl.replaceChildren(...all.map((p) => { const lab = labelFor(p); labelToId[lab.toLowerCase()] = p.id; const o = el("option"); o.value = lab; return o; }));
    const pick = (input, side) => {
      const v = input.value.trim().toLowerCase();
      let id = labelToId[v];
      if (!id) {
        const hit = all.find((p) => p.name.toLowerCase() === v) || all.find((p) => p.name.toLowerCase().startsWith(v));
        id = hit && v.length >= 3 ? hit.id : null;
      }
      if (id) { cmp[side] = id; input.value = labelFor(byId[id]); renderCompare(); }
    };
    const a = document.getElementById("cmp-a"), b = document.getElementById("cmp-b");
    a.addEventListener("change", () => pick(a, "a"));
    b.addEventListener("change", () => pick(b, "b"));
    document.getElementById("cmp-swap").addEventListener("click", () => { [cmp.a, cmp.b] = [cmp.b, cmp.a]; renderCompare(); });
  }

  function metricVal(p, key, scope) {
    if (key === "ppg" || key === "xfp_pg") return p[key];
    const sc = p[scope] || {};
    if (key === "opp") return (sc.tgt || 0) + (sc.car || 0);
    return sc[key];
  }

  function renderCompare() {
    const host = document.getElementById("cmp-body");
    const A1 = byId[cmp.a], B1 = byId[cmp.b];
    document.getElementById("cmp-a").value = A1 ? labelFor(A1) : "";
    document.getElementById("cmp-b").value = B1 ? labelFor(B1) : "";
    if (A1 && B1) setHash(`#compare/${encodeURIComponent(A1.id)}/${encodeURIComponent(B1.id)}`);
    charts.forEach((c) => c.destroy());
    charts = [];
    if (!A1 || !B1) {
      host.replaceChildren(el("p", "Pick two players above. Tip: from Start / Sit, every bench player has a Compare button.", "muted"));
      return;
    }
    host.replaceChildren();
    const playing = (p) => p.proj !== undefined && !p.bye && !p.out;
    // Verdict
    const v = el("div", null, "cmp-verdict");
    let headline, detail = [];
    if (!playing(A1) || !playing(B1)) {
      const ok = playing(A1) ? A1 : playing(B1) ? B1 : null;
      headline = ok ? `Start ${ok.name}` : "Neither is playing this week";
      const other = ok === A1 ? B1 : A1;
      if (ok) detail.push(`${other.name} is ${other.bye ? "on bye" : other.out ? `listed ${other.inj || "out"}` : "not projected this week"}.`);
    } else {
      const d = A1.proj - B1.proj;
      const win = d >= 0 ? A1 : B1, lose = d >= 0 ? B1 : A1;
      if (Math.abs(d) >= 1.5) {
        headline = `Start ${win.name}`;
        detail.push(`Projects ${Math.abs(d).toFixed(1)} more (${win.proj.toFixed(1)} vs ${lose.proj.toFixed(1)}). The typical miss on a weekly projection is about 5 points, so ${Math.abs(d) >= 4 ? "this is a clear call" : "it's a lean, not a lock"}.`);
      } else {
        headline = "Close call";
        const hi = A1.ceil >= B1.ceil ? A1 : B1, safe = A1.floor >= B1.floor ? A1 : B1;
        detail.push(`Only ${Math.abs(d).toFixed(1)} apart. Need a big week? ${hi.name} has the higher ceiling (${hi.ceil.toFixed(0)}). Protecting a lead? ${safe.name} has the safer floor (${safe.floor.toFixed(0)}).`);
      }
      if (win.pros && win.pros[0]) detail.push(`For ${win.name}: ${win.pros[0]}.`);
      if (lose.cons && lose.cons[0]) detail.push(`Against ${lose.name}: ${lose.cons[0]}.`);
    }
    v.appendChild(el("div", headline, "cmp-head"));
    detail.forEach((d) => v.appendChild(el("p", d)));
    host.appendChild(v);

    // Side-by-side cards
    const max = Math.max(30, A1.ceil || 0, B1.ceil || 0);
    const pair = el("div", null, "cmp-pair");
    for (const p of [A1, B1]) {
      const c = el("div", null, "cmp-card");
      const h = el("div", null, "cmp-card-head");
      h.appendChild(headshot(p, "an-photo sm"));
      const t = el("div");
      const b = el("button", p.name, "team prospect-link");
      b.type = "button";
      b.addEventListener("click", () => openPlayer(p.id));
      t.append(b, posBadge(p.pos));
      t.appendChild(el("div", p.proj !== undefined ? gameLine(p) : `${p.nfl || "FA"}`, "owner"));
      if (p.owner) { const o = el("div", null, "owner"); o.append(dot(p.owner), document.createTextNode(` ${teamName(p.owner)}`)); t.appendChild(o); }
      else t.appendChild(el("div", "Free agent", "owner up"));
      h.appendChild(t);
      c.appendChild(h);
      if (p.proj !== undefined) {
        const pr = el("div", null, "cmp-proj");
        pr.append(el("span", playing(p) ? p.proj.toFixed(1) : "—", "ss-points"), el("span", playing(p) ? ` proj · ${p.pos}${p.rank || "?"} · range ${p.floor.toFixed(0)}–${p.ceil.toFixed(0)}` : (p.bye ? " bye" : ` ${p.inj || "not projected"}`), "owner"));
        c.appendChild(pr);
        if (playing(p)) c.appendChild(rangeBar(p, max));
        const d = p.opp && S.defenses[p.opp];
        if (d && ["QB", "RB", "WR", "TE"].includes(p.pos)) {
          const rk = d.rk || {};
          const mt = el("div", null, "cmp-matchup");
          const idx = d[`idx_${p.pos}`];
          mt.appendChild(el("span", `${p.opp} vs ${p.pos}s: ${isNum(idx) ? `${idx.toFixed(0)} index` : "—"}${rk[`idx_${p.pos}`] ? ` (${ordinal(rk[`idx_${p.pos}`])} easiest)` : ""}`, `chip ${idx >= 106 ? "good" : idx <= 94 ? "bad" : ""}`));
          const key = p.pos === "RB" ? "run_epa" : "pass_epa";
          if (isNum(d[key])) mt.appendChild(el("span", `${p.pos === "RB" ? "Run" : "Pass"} EPA allowed ${fmtv(d[key], "epa")}`, "chip"));
          c.appendChild(mt);
        }
        if (p.pros && p.pros.length) c.appendChild(reasonList(p.pros, "pro"));
        if (p.cons && p.cons.length) c.appendChild(reasonList(p.cons, "con"));
      }
      pair.appendChild(c);
    }
    host.appendChild(pair);

    // Stat duel
    const sameGroup = (GROUPS[A1.pos] && A1.pos === B1.pos) || (["WR", "TE"].includes(A1.pos) && ["WR", "TE"].includes(B1.pos));
    let keys;
    if (sameGroup) keys = GROUPS[A1.pos].flatMap(([, ks]) => ks);
    else keys = ["ppg", "xfp_pg", "snap", "opp_pg", "tgt_share", "rz_opp_pg", "yprr", "epa_tgt", "ypc"];
    keys = [...new Set(keys)].filter((k) => k !== "g");
    const scopeTabs = el("div", null, "round-tabs");
    [["s", "Season"], ["l3", "Last 3 games"]].forEach(([k, lab]) => {
      const b = el("button", lab, k === cmp.scope ? "chip is-current" : "chip");
      b.type = "button";
      b.addEventListener("click", () => { cmp.scope = k; renderCompare(); });
      scopeTabs.appendChild(b);
    });
    host.appendChild(el("h3", "Stat by stat", "sub-head"));
    host.appendChild(scopeTabs);
    const duel = el("div", null, "duel");
    const hdr = el("div", null, "duel-row duel-head");
    hdr.append(el("span", A1.name, "team"), el("span", ""), el("span", B1.name, "team right"));
    duel.appendChild(hdr);
    let wa = 0, wb = 0;
    for (const k of keys) {
      const meta = M[k];
      if (!meta) continue;
      const va = metricVal(A1, k, cmp.scope), vb = metricVal(B1, k, cmp.scope);
      if (!isNum(va) && !isNum(vb)) continue;
      const row = el("div", null, "duel-row");
      let better = 0;
      if (meta[2] !== 0 && isNum(va) && isNum(vb) && va !== vb) better = (va > vb ? 1 : -1) * meta[2];
      if (better > 0) wa++; else if (better < 0) wb++;
      const top = Math.max(Math.abs(va || 0), Math.abs(vb || 0)) || 1;
      const cell = (val, side, win) => {
        const c = el("div", null, `duel-cell ${side}${win ? " win" : ""}`);
        const bar = el("span", null, "duel-bar");
        bar.style.width = `${isNum(val) ? Math.max(3, (Math.abs(val) / top) * 100) : 0}%`;
        c.append(bar, el("span", fmtv(val, meta[1]), "duel-val"));
        return c;
      };
      const lab = el("span", meta[0], "duel-label");
      lab.title = meta[3];
      row.append(cell(va, "left", better > 0), lab, cell(vb, "right", better < 0));
      duel.appendChild(row);
    }
    host.appendChild(duel);
    host.appendChild(el("p", `${A1.name} wins ${wa} of these, ${B1.name} wins ${wb}. Hover a stat name for what it measures.`, "note"));

    // Weekly chart
    const wa1 = (A1.weekly || []), wb1 = (B1.weekly || []);
    if ((wa1.length || wb1.length) && typeof Chart !== "undefined") {
      const weeks = [...new Set([...wa1, ...wb1].map((w) => w.w))].sort((x, y) => x - y);
      const [card, cv] = chartCard("Fantasy points by week");
      host.appendChild(card);
      const red = cssVar("--red"), text = cssVar("--text");
      lineChart(cv, weeks.map((w) => `Wk ${w}`), [
        { type: "line", label: A1.name, data: weeks.map((w) => (wa1.find((x) => x.w === w) || {}).pts ?? null), borderColor: red, backgroundColor: red, pointRadius: 4, spanGaps: true },
        { type: "line", label: B1.name, data: weeks.map((w) => (wb1.find((x) => x.w === w) || {}).pts ?? null), borderColor: text, backgroundColor: text, borderDash: [5, 4], pointRadius: 4, spanGaps: true },
      ], { beginAtZero: true });
      window.HIM.initExpand && window.HIM.initExpand();
    }
  }

  // ---------------------------------------------------------------- //
  // Explorer
  // ---------------------------------------------------------------- //
  const FLEX = ["WR", "TE"];
  // QB and RB stand alone; WR and TE can be viewed together.
  function groupsFor(list) {
    if (list.length === 1) return GROUPS[list[0]];
    const merged = new Map();
    for (const pos of list) for (const [name, keys] of GROUPS[pos]) {
      const have = merged.get(name) || [];
      keys.forEach((k) => { if (!have.includes(k)) have.push(k); });
      merged.set(name, have);
    }
    return [...merged.entries()];
  }
  const defaultsFor = (list) => new Set(list.flatMap((pos) => DEFAULT_GROUPS[pos]));
  const volumeFor = (list) => (list.length === 1 ? VOLUME[list[0]] : ["tgt", "targets", 70]);
  const ex = { pos: ["WR"], scope: "s", groups: null, owner: "all", nfl: "", min: 20, q: "", sort: "ppg", dir: -1, shown: 50 };

  function exRows() {
    const [vkey, , vmax] = volumeFor(ex.pos);
    const minVol = Math.round((ex.min / 100) * vmax);
    const q = ex.q.trim().toLowerCase();
    return Object.values(byId).filter((p) => {
      if (!ex.pos.includes(p.pos) || !p.s) return false;
      const sc = p[ex.scope] || {};
      const vol = vkey === "opp" ? (sc.tgt || 0) + (sc.car || 0) : (sc[vkey] || 0);
      if (vol < minVol && !(q && p.name.toLowerCase().includes(q))) return false;
      if (ex.owner === "rostered" && !p.owner) return false;
      if (ex.owner === "fa" && p.owner) return false;
      if (!["all", "rostered", "fa"].includes(ex.owner) && String(p.owner) !== ex.owner) return false;
      if (ex.nfl && p.nfl !== ex.nfl) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function heatClass(rank, n, dir) {
    if (!dir || n < 5 || rank === null) return "";
    const pct = rank / (n - 1); // 0 = lowest value
    const good = dir > 0 ? pct : 1 - pct;
    if (good >= 0.9) return "hg3";
    if (good >= 0.75) return "hg2";
    if (good >= 0.6) return "hg1";
    if (good <= 0.1) return "hb3";
    if (good <= 0.25) return "hb2";
    if (good <= 0.4) return "hb1";
    return "";
  }

  function renderExplorer() {
    const groups = groupsFor(ex.pos);
    if (!ex.groups) ex.groups = defaultsFor(ex.pos);
    // Controls
    const pt = document.getElementById("ex-pos");
    pt.replaceChildren(...["QB", "RB", "WR", "TE"].map((v) => {
      const on = ex.pos.includes(v);
      const b = el("button", v, on ? "chip is-current" : "chip");
      b.type = "button";
      b.setAttribute("aria-pressed", String(on));
      b.title = FLEX.includes(v) ? "Tap WR and TE together to see pass catchers side by side" : `${v}s on their own`;
      b.addEventListener("click", () => {
        let next;
        if (!FLEX.includes(v) || !ex.pos.every((x) => FLEX.includes(x))) next = [v];
        else if (on) next = ex.pos.length > 1 ? ex.pos.filter((x) => x !== v) : ex.pos;
        else next = FLEX.filter((x) => ex.pos.includes(x) || x === v);
        if (next.join() === ex.pos.join()) return;
        ex.pos = next;
        ex.groups = defaultsFor(next);
        const cols = groupsFor(next).flatMap(([, ks]) => ks);
        if (ex.sort !== "name" && !cols.includes(ex.sort)) { ex.sort = "ppg"; ex.dir = -1; }
        ex.shown = 50;
        renderExplorer();
      });
      return b;
    }), el("span", "WR and TE can be combined", "owner ex-pos-hint"));
    const st = document.getElementById("ex-scope");
    st.replaceChildren(...[["s", "Season"], ["l3", "Last 3 games"]].map(([k, lab]) => {
      const b = el("button", lab, k === ex.scope ? "chip is-current" : "chip");
      b.type = "button";
      b.addEventListener("click", () => { ex.scope = k; renderExplorer(); });
      return b;
    }));
    const gt = document.getElementById("ex-groups");
    gt.replaceChildren(el("span", "Stat groups:", "owner"), ...groups.map(([name]) => {
      const on = ex.groups.has(name);
      const b = el("button", `${on ? "✓ " : "+ "}${name}`, on ? "chip is-current" : "chip");
      b.type = "button";
      b.setAttribute("aria-pressed", String(on));
      b.addEventListener("click", () => { if (on && ex.groups.size > 1) ex.groups.delete(name); else ex.groups.add(name); renderExplorer(); });
      return b;
    }));
    const [, vlabel, vmax] = volumeFor(ex.pos);
    document.getElementById("ex-min-label").textContent = `Minimum ${vlabel}: ${Math.round((ex.min / 100) * vmax)}`;

    // Columns
    const cols = [];
    for (const [name, keys] of groups) if (ex.groups.has(name)) keys.forEach((k) => { if (!cols.includes(k)) cols.push(k); });
    const rows = exRows();
    // Percentile ranks per column
    // Colors rank each player against his own position, and only on stats
    // that belong to that position (no red "carries" for a WR).
    const ranks = {};
    const posKeys = {};
    for (const pos of ex.pos) posKeys[pos] = new Set(GROUPS[pos].flatMap(([, ks]) => ks));
    for (const k of cols) {
      ranks[k] = {};
      for (const pos of ex.pos) {
        const vals = rows.filter((p) => p.pos === pos).map((p) => metricVal(p, k, ex.scope)).filter(isNum).sort((a, b) => a - b);
        ranks[k][pos] = { vals, n: vals.length };
      }
    }
    const rankOf = (k, v, pos) => {
      if (!isNum(v) || !posKeys[pos].has(k)) return null;
      const arr = ranks[k][pos].vals;
      let lo = 0, hi = arr.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
      return lo;
    };
    rows.sort((a, b) => {
      const x = ex.sort === "name" ? a.name : metricVal(a, ex.sort, ex.scope), y = ex.sort === "name" ? b.name : metricVal(b, ex.sort, ex.scope);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x > y ? 1 : -1) * ex.dir;
    });
    const table = el("table", null, "an-table ex-table");
    const head = el("tr");
    const thName = el("th", "Player", "sticky-col sortable");
    if (ex.sort === "name") thName.classList.add(ex.dir < 0 ? "desc" : "asc");
    thName.addEventListener("click", () => { ex.dir = ex.sort === "name" ? -ex.dir : 1; ex.sort = "name"; renderExplorer(); });
    head.appendChild(thName);
    head.appendChild(el("th", "Team", ""));
    if (S && !S.offseason) head.appendChild(el("th", `Wk ${S.week}`, "num"));
    for (const k of cols) {
      const th = el("th", M[k][0], "num sortable");
      th.title = M[k][3];
      if (ex.sort === k) th.classList.add(ex.dir < 0 ? "desc" : "asc");
      th.addEventListener("click", () => { ex.dir = ex.sort === k ? -ex.dir : (M[k][2] < 0 ? 1 : -1); ex.sort = k; renderExplorer(); });
      head.appendChild(th);
    }
    table.appendChild(el("thead")).appendChild(head);
    const body = el("tbody");
    for (const p of rows.slice(0, ex.shown)) {
      const tr = el("tr");
      tr.tabIndex = 0;
      tr.addEventListener("click", () => openPlayer(p.id));
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") openPlayer(p.id); });
      const who = el("td", null, "sticky-col");
      const w = el("div", null, "player");
      w.appendChild(headshot(p));
      const t = el("div");
      const nmRow = el("div", null, "ex-name");
      nmRow.appendChild(el("span", p.name, "team"));
      if (ex.pos.length > 1) nmRow.appendChild(posBadge(p.pos));
      t.appendChild(nmRow);
      t.appendChild(el("div", `${p.nfl || "FA"}${p.age ? ` · ${p.age.toFixed(1)}` : ""}`, "owner"));
      w.appendChild(t);
      who.appendChild(w);
      tr.appendChild(who);
      const own = el("td", null, "small");
      if (p.owner) { own.append(dot(p.owner), document.createTextNode(` ${teamName(p.owner)}`)); }
      else own.appendChild(el("span", "FA", "up"));
      tr.appendChild(own);
      if (S && !S.offseason) {
        const wk = el("td", null, "num");
        if (p.proj !== undefined && !p.bye) { wk.textContent = p.proj.toFixed(1); wk.title = gameLine(p); }
        else wk.textContent = p.bye ? "bye" : "—";
        tr.appendChild(wk);
      }
      for (const k of cols) {
        const v = metricVal(p, k, ex.scope);
        tr.appendChild(el("td", fmtv(v, M[k][1]), `num ${heatClass(rankOf(k, v, p.pos), ranks[k][p.pos].n, M[k][2])}`));
      }
      body.appendChild(tr);
    }
    table.appendChild(body);
    const host = document.getElementById("ex-table");
    host.replaceChildren(table);
    if (rows.length > ex.shown) {
      const more = el("button", `Show more (${rows.length - ex.shown})`, "chip");
      more.type = "button";
      more.addEventListener("click", () => { ex.shown += 50; renderExplorer(); });
      host.appendChild(more);
    }
    document.getElementById("ex-note").textContent =
      `${rows.length} ${ex.pos.join("/")}${ex.pos.length === 1 ? "s" : ""} · ${ex.scope === "s" ? `season (weeks ${SP.weeks[0]}–${SP.weeks[SP.weeks.length - 1]})` : "each player's last 3 games"} · * routes are estimated from snap share and team dropbacks.`;
  }

  let exTimer = 0;
  function scheduleExplorer(ms) {
    clearTimeout(exTimer);
    exTimer = setTimeout(renderExplorer, ms);
  }

  let explorerSetup = false;
  function setupExplorer() {
    if (explorerSetup) return;
    explorerSetup = true;
    const add = (sel, value, label) => { const o = el("option", label); o.value = value; sel.appendChild(o); };
    const owner = document.getElementById("ex-owner");
    add(owner, "all", "All players");
    add(owner, "rostered", "Rostered in HIM");
    add(owner, "fa", "Free agents");
    Object.entries(latest.teams).sort((a, b) => a[1].team.localeCompare(b[1].team)).forEach(([rid, t]) => add(owner, rid, t.team.trim()));
    owner.addEventListener("change", () => { ex.owner = owner.value; ex.shown = 50; renderExplorer(); });
    const nfl = document.getElementById("ex-nfl");
    add(nfl, "", "All NFL teams");
    [...new Set(Object.values(byId).map((p) => p.nfl).filter(Boolean))].sort().forEach((t) => add(nfl, t, t));
    nfl.addEventListener("change", () => { ex.nfl = nfl.value; renderExplorer(); });
    const min = document.getElementById("ex-min");
    min.addEventListener("input", () => {
      ex.min = Number(min.value); ex.shown = 50;
      const vol = volumeFor(ex.pos);
      document.getElementById("ex-min-label").textContent = `Minimum ${vol[1]}: ${Math.round((ex.min / 100) * vol[2])}`;
      scheduleExplorer(120);
    });
    const q = document.getElementById("ex-search");
    q.addEventListener("input", () => { ex.q = q.value; ex.shown = 50; scheduleExplorer(180); });
  }

  // ---------------------------------------------------------------- //
  // Defenses
  // ---------------------------------------------------------------- //
  const DEF_COLS = [
    ["idx_QB", "vs QB", 1, "Fantasy points allowed to QBs vs expected (100 = average; higher is easier). Opponent-adjusted, same method as the league's tracker."],
    ["idx_RB", "vs RB", 1, "Same, for RBs."],
    ["idx_WR", "vs WR", 1, "Same, for WRs."],
    ["idx_TE", "vs TE", 1, "Same, for TEs."],
    ["pass_epa", "Pass EPA", "epa", "EPA per dropback allowed (higher is easier to throw on)."],
    ["run_epa", "Run EPA", "epa", "EPA per carry allowed."],
    ["exp_pass", "Big Pass%", "pct", "Completions of 20+ yards per attempt allowed."],
    ["deep_epa", "Deep EPA", "epa", "EPA allowed on throws 20+ air yards."],
    ["sack_rate", "Sack%", "pct", "Sacks per dropback (higher is tougher on QBs)."],
    ["hit_rate", "Hit%", "pct", "QB hits + sacks per dropback."],
    ["blitz_rate", "Blitz%", "pct", "Share of dropbacks where they blitz (FTN)."],
    ["box8_rate", "8+ Box%", "pct", "Share of runs into 8+ defenders."],
    ["rz_td_rate", "RZ TD%", "pct", "Touchdowns per red-zone play allowed."],
    ["poe_faced", "Pass OE", "sgn1", "Opponents' pass rate over expected against them in neutral situations: positive = teams throw on them (pass funnel), negative = run funnel."],
    ["rb_tgt_pg", "RB Tgt/G", 1, "Targets to RBs allowed per game."],
    ["te_tgt_pg", "TE Tgt/G", 1, "Targets to TEs allowed per game."],
    ["wr_tgt_pg", "WR Tgt/G", 1, "Targets to WRs allowed per game."],
  ];
  const def = { mode: "values", sort: "idx_WR", dir: -1 };

  function renderDefenses() {
    const D = S.defenses;
    document.getElementById("def-note").textContent =
      `All 32 defenses through week ${S.data_through}. Green = generous to fantasy offenses, red = stingy (ranked 1–32). Next shows who they face in week ${S.week}.`;
    const mt = document.getElementById("def-mode");
    mt.replaceChildren(...[["values", "Values"], ["ranks", "Ranks"]].map(([k, lab]) => {
      const b = el("button", lab, k === def.mode ? "chip is-current" : "chip");
      b.type = "button";
      b.addEventListener("click", () => { def.mode = k; renderDefenses(); });
      return b;
    }));
    const teams = Object.keys(D);
    teams.sort((a, b) => {
      if (def.sort === "team") return a.localeCompare(b) * def.dir;
      const x = D[a][def.sort], y = D[b][def.sort];
      if (!isNum(x)) return 1;
      if (!isNum(y)) return -1;
      return (x - y) * def.dir;
    });
    const table = el("table", null, "an-table ex-table");
    const head = el("tr");
    const th0 = el("th", "Defense", "sticky-col sortable");
    th0.addEventListener("click", () => { def.dir = def.sort === "team" ? -def.dir : 1; def.sort = "team"; renderDefenses(); });
    head.appendChild(th0);
    head.appendChild(el("th", "Next", ""));
    for (const [k, lab, , desc] of DEF_COLS) {
      const th = el("th", lab, "num sortable");
      th.title = desc;
      if (def.sort === k) th.classList.add(def.dir < 0 ? "desc" : "asc");
      th.addEventListener("click", () => { def.dir = def.sort === k ? -def.dir : -1; def.sort = k; renderDefenses(); });
      head.appendChild(th);
    }
    table.appendChild(el("thead")).appendChild(head);
    const body = el("tbody");
    const n = teams.length;
    for (const t of teams) {
      const d = D[t];
      const tr = el("tr");
      const c0 = el("td", null, "sticky-col");
      const w = el("div", null, "player");
      w.appendChild(headshot({ id: t, pos: "DEF" }));
      w.appendChild(el("span", t, "team"));
      c0.appendChild(w);
      tr.appendChild(c0);
      const g = S.games[t];
      tr.appendChild(el("td", g ? `${g.home ? "vs" : "@"} ${g.opp}` : "bye", "small"));
      for (const [k, , f] of DEF_COLS) {
        const r = (d.rk || {})[k];
        const neutral = k === "blitz_rate" || k === "box8_rate";
        const cls = r && !neutral ? (r <= 4 ? "hg3" : r <= 8 ? "hg2" : r <= 12 ? "hg1" : r > n - 4 ? "hb3" : r > n - 8 ? "hb2" : r > n - 12 ? "hb1" : "") : "";
        const txt = def.mode === "ranks" ? (r ? String(r) : "—") : fmtv(d[k], f === 1 ? (k.startsWith("idx") ? 0 : 1) : f);
        tr.appendChild(el("td", txt, `num ${cls}`));
      }
      body.appendChild(tr);
    }
    table.appendChild(body);
    document.getElementById("def-table").replaceChildren(table);
  }

  // ---------------------------------------------------------------- //
  // Player profile
  // ---------------------------------------------------------------- //
  const SIGNAL_CLASS = {
    "Buy low": "good", "Rising usage": "good", "Ascending": "good", "Market undervalues": "good", "Running cold": "info",
    "Sell high": "bad", "Falling usage": "bad", "Age cliff": "bad", "Living on name value": "bad", "Running hot": "info",
  };

  function openPlayer(id, scroll = true) {
    if (!deepReady) { whenDeep(() => openPlayer(id, scroll)); return; }
    const p = byId[id];
    if (!p) return;
    const url = new URL(location.href);
    url.searchParams.set("player", id);
    history.replaceState(null, "", url);
    charts.forEach((c) => c.destroy());
    charts = [];
    const host = document.getElementById("detail");
    host.hidden = false;
    host.replaceChildren();

    const head = el("div", null, "an-head");
    head.appendChild(headshot(p, "an-photo"));
    const t = el("div");
    t.appendChild(el("h2", p.name, "an-name"));
    const sub = el("p", null, "team-sub");
    sub.append([p.pos, p.nfl || "FA", p.age ? `${p.age.toFixed(1)} yrs` : null, p.draft || null].filter(Boolean).join(" · ") + " · ");
    if (p.owner) sub.appendChild(teamLink(p.owner, teamName(p.owner)));
    else sub.appendChild(el("span", "Free agent in HIM", "up"));
    t.appendChild(sub);
    if (p.signals && p.signals.length) {
      const wrap = el("span", null, "sig-badges");
      for (const [name, why] of p.signals) { const b = el("span", name, `sig ${SIGNAL_CLASS[name] || ""}`); b.title = why; wrap.appendChild(b); }
      t.appendChild(wrap);
    }
    head.appendChild(t);
    const close = el("button", "✕", "remove an-close");
    close.type = "button";
    close.setAttribute("aria-label", "Close profile");
    close.addEventListener("click", () => { host.hidden = true; const u = new URL(location.href); u.searchParams.delete("player"); history.replaceState(null, "", u); });
    head.appendChild(close);
    host.appendChild(head);

    // This week
    if (p.proj !== undefined && S) {
      const wk = el("div", null, "an-week");
      const top = el("div", null, "an-week-top");
      top.appendChild(el("div", `Week ${S.week}`, "group-title"));
      top.appendChild(el("div", gameLine(p), "owner"));
      wk.appendChild(top);
      if (!p.bye) {
        const row = el("div", null, "cmp-proj");
        row.append(el("span", p.out ? "—" : p.proj.toFixed(1), "ss-points"), el("span", p.out ? ` ${p.inj}` : ` projected · ${p.pos}${p.rank || "?"} · range ${p.floor.toFixed(0)}–${p.ceil.toFixed(0)}`, "owner"));
        wk.appendChild(row);
      }
      if (p.pros && p.pros.length) wk.appendChild(reasonList(p.pros, "pro"));
      if (p.cons && p.cons.length) wk.appendChild(reasonList(p.cons, "con"));
      const c = el("a", "Compare with another player", "chip");
      c.href = `#compare/${encodeURIComponent(p.id)}/`;
      c.addEventListener("click", () => { cmp.a = p.id; cmp.b = null; });
      wk.appendChild(c);
      host.appendChild(wk);
    }

    if (p.signals && p.signals.length) {
      const ul = el("ul", null, "notes");
      p.signals.forEach(([name, why]) => { const li = el("li"); li.appendChild(el("strong", `${name}: `)); li.appendChild(document.createTextNode(why)); ul.appendChild(li); });
      host.appendChild(ul);
    }

    if (p.value || p.ppg !== undefined) {
      host.appendChild(group("Dynasty & production", [
        p.value ? tile("Dynasty value", p.value.toLocaleString(), p.value_rank ? `${p.pos}${p.value_rank} in value` : null) : null,
        isNum(p.ppg) ? tile("Points per game", fmt(p.ppg), p.ppg_rank ? `${p.pos}${p.ppg_rank} · ${p.games} games` : null) : null,
        isNum(p.xfp_pg) ? tile("xFP per game", fmt(p.xfp_pg), isNum(p.fpoe_pg) ? `${signed(p.fpoe_pg)} over expected` : null) : null,
        isNum(p.starter_rate) ? tile("Weekly starter", fmt(p.starter_rate, 0, "%"), A ? `top ${A.thresholds.starter[p.pos]} ${p.pos} weeks` : null) : null,
        isNum(p.boom_rate) ? tile("Boom / bust", `${fmt(p.boom_rate, 0)}% / ${fmt(p.bust_rate, 0)}%`) : null,
      ]));
    }
    // Splits groups (season with last-3 underneath)
    if (p.s && GROUPS[p.pos]) {
      for (const [name, keys] of GROUPS[p.pos]) {
        if (name === "Fantasy") continue;
        const tiles = keys.map((k) => {
          const v = p.s[k];
          if (!isNum(v)) return null;
          const l = p.l3 && p.l3[k];
          const subTxt = isNum(l) && p.s.g > 3 ? `last 3: ${fmtv(l, M[k][1])}` : null;
          const box = tile(M[k][0].replace("*", " (est.)"), fmtv(v, M[k][1]), subTxt);
          box.title = M[k][3];
          return box;
        }).filter(Boolean);
        if (tiles.length) host.appendChild(group(name, tiles));
      }
    }

    const charts2 = el("div", null, "an-charts");
    const weekly = p.weekly || [];
    if ((weekly.length || (p.wk && p.wk.length)) && typeof Chart !== "undefined") {
      host.appendChild(charts2);
      const red = cssVar("--red"), muted = cssVar("--muted"), text = cssVar("--text"), good = cssVar("--good");
      if (weekly.length) {
        const [c1, cv1] = chartCard("Points vs expected");
        charts2.appendChild(c1);
        lineChart(cv1, weekly.map((w) => `Wk ${w.w}`), [
          { type: "bar", label: "Points (league scoring)", data: weekly.map((w) => w.pts), backgroundColor: withAlpha(red, "cc"), borderColor: red },
          { type: "line", label: "Expected (xFP)", data: weekly.map((w) => w.xfp), borderColor: text, backgroundColor: text, borderDash: [5, 4], pointRadius: 3 },
        ]);
      }
      if (p.wk && p.wk.length) {
        const [c2, cv2] = chartCard(p.pos === "QB" ? "Dropbacks and EPA by week" : "Usage by week");
        charts2.appendChild(c2);
        const labels = p.wk.map((w) => `Wk ${w.w}`);
        if (p.pos === "QB") {
          lineChart(cv2, labels, [
            { type: "bar", label: "Dropbacks", data: p.wk.map((w) => w.db), backgroundColor: withAlpha(muted, "88"), yAxisID: "y" },
            { type: "line", label: "EPA / dropback", data: p.wk.map((w) => w.epa), borderColor: red, backgroundColor: red, yAxisID: "y1", pointRadius: 4 },
          ]);
          const ch = charts[charts.length - 1];
          ch.options.scales.y1 = { position: "right", grid: { drawOnChartArea: false }, ticks: { color: cssVar("--muted") } };
          ch.update("none");
        } else {
          lineChart(cv2, labels, [
            { type: "bar", label: "Targets", data: p.wk.map((w) => w.tgt), backgroundColor: withAlpha(good, "aa"), stack: "o" },
            { type: "bar", label: "Carries", data: p.wk.map((w) => w.car), backgroundColor: withAlpha(muted, "88"), stack: "o" },
            { type: "line", label: "Red-zone opps", data: p.wk.map((w) => w.rz), borderColor: red, backgroundColor: red, pointRadius: 4 },
            { type: "line", label: "Snap %", data: p.wk.map((w) => w.snap), borderColor: text, backgroundColor: text, borderDash: [4, 4], pointRadius: 2, yAxisID: "y1" },
          ]);
          const ch = charts[charts.length - 1];
          ch.options.scales.x.stacked = true;
          ch.options.scales.y.stacked = true;
          ch.options.scales.y1 = { position: "right", min: 0, max: 100, grid: { drawOnChartArea: false }, ticks: { color: cssVar("--muted"), callback: (v) => `${v}%` } };
          ch.update("none");
        }
      }
      window.HIM.initExpand && window.HIM.initExpand();
    }
    if (scroll) host.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------------------------------------------------------------- //
  // Teams view
  // ---------------------------------------------------------------- //
  function renderTeams() {
    if (!A) return;
    const rows = Object.keys(latest.teams).map((rid) => {
      const mine = A.players.filter((p) => String(p.owner) === rid && p.games > 0);
      const top = (pos, n) => mine.filter((p) => p.pos === pos).sort((a, b) => (b.ppg || 0) - (a.ppg || 0)).slice(0, n);
      const core = [...top("QB", 1), ...top("RB", 3), ...top("WR", 3), ...top("TE", 1)];
      const ts = trade && trade.teams ? trade.teams[rid] || {} : {};
      return {
        rid,
        corePpg: core.reduce((s, p) => s + (p.ppg || 0), 0),
        coreXfp: core.reduce((s, p) => s + (p.xfp_pg || 0), 0),
        fpoe: core.reduce((s, p) => s + (p.fpoe_pg || 0), 0),
        age: ts.avg_age, vage: ts.value_age,
        buy: mine.filter((p) => p.signals.some((s) => s[0] === "Buy low")).map((p) => p.name),
        sell: mine.filter((p) => p.signals.some((s) => s[0] === "Sell high" || s[0] === "Running hot")).map((p) => p.name),
        cliff: mine.filter((p) => p.signals.some((s) => s[0] === "Age cliff")).length,
      };
    }).sort((a, b) => b.coreXfp - a.coreXfp);
    const table = el("table");
    const head = el("tr");
    [["Team", 0], ["Core PPG", 1], ["Core xFP", 1], ["Over exp.", 1], ["Avg age", 1], ["Value age", 1], ["Age-cliff", 1], ["Buy low", 0], ["Running hot / sell", 0]]
      .forEach(([l, n]) => head.appendChild(el("th", l, n ? "num" : "")));
    table.appendChild(el("thead")).appendChild(head);
    const body = el("tbody");
    for (const r of rows) {
      const tr = el("tr");
      const c = el("td");
      const w = el("div", null, "teamcell");
      w.appendChild(dot(Number(r.rid)));
      w.appendChild(teamLink(Number(r.rid), teamName(r.rid)));
      c.appendChild(w);
      tr.appendChild(c);
      tr.appendChild(el("td", r.corePpg.toFixed(1), "num"));
      tr.appendChild(el("td", r.coreXfp.toFixed(1), "num"));
      tr.appendChild(el("td", signed(r.fpoe), `num ${r.fpoe >= 4 ? "up" : r.fpoe <= -4 ? "down" : ""}`));
      tr.appendChild(el("td", fmt(r.age), "num"));
      tr.appendChild(el("td", fmt(r.vage), "num"));
      tr.appendChild(el("td", String(r.cliff), "num"));
      tr.appendChild(el("td", r.buy.join(", ") || "—", "small wrap"));
      tr.appendChild(el("td", r.sell.join(", ") || "—", "small wrap"));
      body.appendChild(tr);
    }
    table.appendChild(body);
    document.getElementById("teams-table").replaceChildren(table);
  }

  // ---------------------------------------------------------------- //
  // Glossary, routing, load
  // ---------------------------------------------------------------- //
  function renderGlossary() {
    const items = [
      ["Projection", "Sleeper's weekly projection, rescored with this league's settings (full PPR, 4-point passing TDs)."],
      ["Range", "A likely range for the week: about the 20th to 85th percentile, from the player's own week-to-week swings blended with his position's."],
      ["Implied pts", "Points Vegas expects the team to score: half the game total, plus or minus half the spread."],
      ["Matchup index", "Fantasy points a defense allows to a position, divided by what those offenses usually score, shrunk toward 100 for small samples. 110 = 10% easier than expected."],
      ...Object.entries(M).map(([, [label, , , desc]]) => [label, desc]),
      ["Sources", "Sleeper (projections, injuries, rosters), nflverse play-by-play (EPA, CPOE, air yards, red zone), FTN charting (blitzes, play action, box counts, catchable balls, drops), Next Gen Stats (separation, RYOE, time to throw), nflverse snap counts and schedules (Vegas lines), ffopportunity (expected points), DynastyProcess (values)."],
    ];
    const seen = new Set();
    const uniq = items.filter(([k]) => !seen.has(k) && seen.add(k));
    const key = uniq.filter(([k]) => ["Projection", "Range", "Implied pts", "Matchup index", "Sources", "YPRR*", "Routes*", "EPA/DB"].includes(k));
    const rest = uniq.filter((x) => !key.includes(x));
    const g = document.getElementById("glossary");
    g.replaceChildren(...key.flatMap(([k, v]) => [el("dt", k), el("dd", v)]));
    const det = el("details", null, "gloss-more");
    det.appendChild(el("summary", `Every stat, defined (${rest.length})`));
    const dl = el("dl", null, "glossary");
    dl.replaceChildren(...rest.flatMap(([k, v]) => [el("dt", k), el("dd", v)]));
    det.appendChild(dl);
    g.after(det);
  }

  function route() {
    const h = location.hash.replace(/^#/, "");
    const [tab, a, b] = h.split("/").map((x) => decodeURIComponent(x || ""));
    const view = ["startsit", "compare", "explorer", "defenses", "teams"].includes(tab) ? tab : "startsit";
    document.querySelectorAll(".an-view").forEach((v) => { v.hidden = v.id !== `view-${view}`; });
    document.querySelectorAll("#an-tabs a").forEach((x) => x.setAttribute("aria-current", x.dataset.tab === view ? "page" : "false"));
    if (view === "startsit") {
      const want = a || new URLSearchParams(location.search).get("team") || "";
      renderStartSit(want);
    } else if (view === "compare") {
      whenDeep(() => {
        if (a && byId[a]) cmp.a = a;
        if (b && byId[b]) cmp.b = b;
        renderCompare();
      }, "cmp-body");
    } else if (view === "explorer") whenDeep(renderExplorer, "ex-table");
    else if (view === "defenses") renderDefenses();
    else if (view === "teams") whenDeep(renderTeams, "teams-table");
  }

  // Start/Sit needs only startsit.json; the bigger files load in the background
  // and the tabs that use them wait for `deep`.
  let deep = null;
  let deepReady = false;
  function mergeStartsit() {
    for (const [id, p] of Object.entries(S.players)) {
      const base = byId[id] || {};
      byId[id] = Object.assign(base, p, { id, headshot: base.headshot || p.headshot, owner: p.owner ?? base.owner });
    }
  }
  function loadDeep() {
    if (deep) return deep;
    const get = (u) => fetch(u, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
    deep = Promise.all([get("data/splits.json"), get("data/analytics.json").catch(() => null), get("data/trade.json").catch(() => null)])
      .then(([sp, a, tr]) => {
        SP = sp; A = a; trade = tr;
        for (const [id, s] of Object.entries(SP.players)) byId[id] = Object.assign(byId[id] || { id }, s, { id });
        if (A) for (const p of A.players) byId[p.id] = Object.assign(byId[p.id] || {}, p, { id: p.id });
        mergeStartsit();
        deepReady = true;
        setupCompare();
        setupExplorer();
      });
    return deep;
  }
  function whenDeep(fn, hostId) {
    if (deepReady) { fn(); return; }
    const host = hostId && document.getElementById(hostId);
    if (host && !host.childElementCount) host.replaceChildren(el("p", "Loading stats…", "muted"));
    loadDeep().then(fn).catch((err) => { if (host) host.replaceChildren(el("p", `Stats unavailable (${err.message}).`, "muted")); });
  }

  async function load() {
    const get = (u) => fetch(u, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
    try {
      [S, latest] = await Promise.all([get("data/startsit.json"), window.HIM.loadData()]);
    } catch (err) {
      document.getElementById("updated").textContent = `Analytics appear after the next morning update (${err.message}).`;
      return;
    }
    assignColors(latest.standings.map((t) => t.roster_id));
    mergeStartsit();
    document.getElementById("updated").textContent =
      `${S.offseason ? `Offseason · ${S.stats_season || S.season} stats` : `Week ${S.week} · stats through week ${S.data_through}`} · updated ${new Date(S.generated_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
    const sel = document.getElementById("ss-team");
    const o0 = el("option", "Whole league");
    o0.value = "";
    sel.appendChild(o0);
    Object.keys(S.teams).sort((a, b) => teamName(a).localeCompare(teamName(b))).forEach((rid) => { const o = el("option", teamName(rid)); o.value = rid; sel.appendChild(o); });
    sel.addEventListener("change", () => { location.hash = sel.value ? `#startsit/${sel.value}` : "#startsit"; });
    renderGlossary();
    window.addEventListener("hashchange", route);
    route();
    // Start the background load once the first view has painted.
    (window.requestIdleCallback || ((f) => setTimeout(f, 200)))(() => loadDeep());
    const pid = new URLSearchParams(location.search).get("player");
    if (pid) whenDeep(() => openPlayer(pid, false));
    document.addEventListener("him-themechange", () => {
      const open = new URLSearchParams(location.search).get("player");
      if (open) openPlayer(open, false);
      if (location.hash.startsWith("#compare")) renderCompare();
    });
  }

  load();
})();
