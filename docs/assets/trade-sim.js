/* HIM Dynasty trade impact simulator.

   Re-runs the rest of the season (and the playoffs and draft order) in the
   browser, the same way the nightly update does, so a trade can be judged by
   what it does to each team's playoff odds, title odds, and #1 pick odds.

   How a trade moves a team: each player has a rest-of-season weekly
   projection (points per game times availability). The trade changes the
   team's best projected lineup by some number of points per week, and that
   shift is added to the team's scoring model. Max PF moves the same way.

   Before and after runs use the same random seed, so the difference comes
   from the trade, not from simulation noise. */
window.TradeSim = (sim, fmt) => {
  "use strict";
  if (!sim) return null;

  const SLOT_ELIGIBLE = {
    QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], K: ["K"], DEF: ["DEF"],
    FLEX: ["RB", "WR", "TE"], WRRB_FLEX: ["RB", "WR"], REC_FLEX: ["WR", "TE"], SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  };
  const slots = [];
  for (const [slot, n] of Object.entries(fmt.starters || {})) if (SLOT_ELIGIBLE[slot]) for (let i = 0; i < n; i++) slots.push(slot);
  slots.sort((a, b) => SLOT_ELIGIBLE[a].length - SLOT_ELIGIBLE[b].length);

  const rids = Object.keys(sim.base).map(Number);
  const actual = new Map((sim.actual || []).map(([a, b, w]) => [`${a}-${b}`, w]));

  /* Best projected weekly lineup points for a set of assets. */
  function lineupPoints(assets) {
    const pool = assets.filter((a) => a.kind === "player").sort((a, b) => (b.proj || 0) - (a.proj || 0));
    const used = new Set();
    let total = 0;
    for (const slot of slots) {
      const p = pool.find((x) => !used.has(x.id) && SLOT_ELIGIBLE[slot].includes(x.pos));
      if (p) { used.add(p.id); total += p.proj || 0; }
    }
    return total;
  }

  // Seeded random numbers (mulberry32) and normal draws.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussFrom(rand) {
    let spare = null;
    return (mu, sd) => {
      if (spare !== null) { const v = spare; spare = null; return mu + sd * v; }
      let u = 0, v = 0;
      while (u === 0) u = rand();
      v = rand();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return mu + sd * r * Math.cos(2 * Math.PI * v);
    };
  }

  function bracket(seeds, decide) {
    const n = seeds.length;
    const seedOf = new Map(seeds.map((r, i) => [r, i + 1]));
    let games, byes;
    if (n === 4) { games = [[seeds[0], seeds[3]], [seeds[1], seeds[2]]]; byes = []; }
    else if (n === 6) { games = [[seeds[2], seeds[5]], [seeds[3], seeds[4]]]; byes = [seeds[0], seeds[1]]; }
    else { games = [[seeds[0], seeds[7]], [seeds[3], seeds[4]], [seeds[2], seeds[5]], [seeds[1], seeds[6]]]; byes = []; }
    const stage = new Map();
    let round = 0;
    for (;;) {
      round += 1;
      const winners = [];
      for (const [a, b] of games) {
        const w = decide(a, b);
        stage.set(w === a ? b : a, round);
        winners.push(w);
      }
      if (winners.length === 1) { stage.set(winners[0], round + 1); return { champion: winners[0], stage }; }
      if (byes.length) {
        const pool = winners.concat(byes).sort((x, y) => seedOf.get(x) - seedOf.get(y));
        games = [[pool[0], pool[pool.length - 1]], [pool[1], pool[pool.length - 2]]];
        byes = [];
      } else {
        games = [];
        for (let i = 0; i < winners.length; i += 2) games.push([winners[i], winners[i + 1]]);
      }
    }
  }

  /* shifts: { rid: points per week added to that team's scoring and max }. */
  function run(shifts = {}, n = 4000, seed = 20261012) {
    const rand = rng(seed);
    const gauss = gaussFrom(rand);
    const playoff = {}, champ = {}, first = {};
    rids.forEach((r) => { playoff[r] = 0; champ[r] = 0; first[r] = 0; });
    const pt = sim.playoff_teams;

    for (let s = 0; s < n; s++) {
      const mu = {}, sd = {}, mxMu = {}, mxSd = {};
      const wins = {}, pf = {}, mx = {};
      for (const r of rids) {
        const [m, d, se] = sim.model[r];
        const [mm, md, mse] = sim.max_model[r];
        const shift = shifts[r] || 0;
        mu[r] = gauss(m, se) + shift; sd[r] = d;
        mxMu[r] = gauss(mm, mse) + shift; mxSd[r] = md;
        wins[r] = sim.base[r].wins; pf[r] = sim.base[r].pf; mx[r] = sim.base[r].max_pf;
      }
      for (const week of sim.remaining) {
        const scores = {};
        for (const [a, b] of week) {
          const sa = Math.max(0, gauss(mu[a], sd[a]));
          const sb = Math.max(0, gauss(mu[b], sd[b]));
          scores[a] = sa; scores[b] = sb;
          if (sa > sb) wins[a] += 1; else if (sb > sa) wins[b] += 1;
        }
        for (const r in scores) {
          pf[r] += scores[r];
          mx[r] += Math.max(scores[r], gauss(mxMu[r], mxSd[r]));
        }
        if (sim.median) {
          const order = Object.keys(scores).sort((x, y) => scores[y] - scores[x]);
          order.slice(0, Math.floor(order.length / 2)).forEach((r) => { wins[r] += 1; });
        }
      }
      const ranked = rids.slice().sort((a, b) => (wins[b] - wins[a]) || (pf[b] - pf[a]));
      const seeds = ranked.slice(0, pt);
      const { champion, stage } = bracket(seeds, (a, b) => {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (actual.has(key)) return actual.get(key);
        return gauss(mu[a], sd[a]) >= gauss(mu[b], sd[b]) ? a : b;
      });
      champ[champion] += 1;
      seeds.forEach((r) => { playoff[r] += 1; });
      // #1 pick: lowest max PF among non-playoff teams (or the first one out if everyone made it).
      const out = ranked.slice(pt);
      let top;
      if (out.length) top = out.reduce((a, b) => (mx[a] <= mx[b] ? a : b));
      else top = seeds.reduce((a, b) => ((stage.get(a) - stage.get(b)) || (mx[a] - mx[b])) <= 0 ? a : b);
      first[top] += 1;
    }
    const pct = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, (100 * v) / n]));
    return { playoff: pct(playoff), champ: pct(champ), first: pct(first) };
  }

  /* Impact of a trade between team A and team B. */
  function impact(teamA, teamB, give, get, n = 4000, baseline = null) {
    const giveIds = new Set(give.map((a) => a.id));
    const getIds = new Set(get.map((a) => a.id));
    const aBefore = lineupPoints(teamA.assets);
    const bBefore = lineupPoints(teamB.assets);
    const aAfter = lineupPoints(teamA.assets.filter((a) => !giveIds.has(a.id)).concat(get));
    const bAfter = lineupPoints(teamB.assets.filter((a) => !getIds.has(a.id)).concat(give));
    const before = baseline || run({}, n);
    const after = run({ [teamA.rid]: aAfter - aBefore, [teamB.rid]: bAfter - bBefore }, n);
    const side = (rid, lb, la) => ({
      weekly: la - lb,
      playoff: [before.playoff[rid], after.playoff[rid]],
      champ: [before.champ[rid], after.champ[rid]],
      first: [before.first[rid], after.first[rid]],
    });
    return { a: side(teamA.rid, aBefore, aAfter), b: side(teamB.rid, bBefore, bAfter), before };
  }

  return { run, impact, lineupPoints };
};
