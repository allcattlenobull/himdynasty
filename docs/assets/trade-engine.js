/* HIM Dynasty trade engine.

   Raw dynasty values (DynastyProcess) treat every asset the same no matter who
   owns it. This engine asks a better question: how much does the trade change
   each team's roster, given this league's lineup?

   Roster value =
     starters at full value (best lineup from the league's slots)
     + backups at a discount that grows with depth at the position
       (in a 1-QB league a second QB is worth little, a third almost nothing)
     + draft picks
     - anything that has to be cut to fit the roster limit
   and each asset is tilted by the team's window:
     contenders lean toward proven older players and away from picks,
     rebuilders lean toward youth and picks and away from aging players.

   A trade is judged by the change in roster value for both sides. */
window.TradeEngine = (fmt) => {
  "use strict";

  const SLOT_ELIGIBLE = {
    QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], K: ["K"], DEF: ["DEF"],
    FLEX: ["RB", "WR", "TE"], WRRB_FLEX: ["RB", "WR"], REC_FLEX: ["WR", "TE"],
    SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  };
  const slots = [];
  for (const [slot, n] of Object.entries(fmt.starters || {})) {
    if (SLOT_ELIGIBLE[slot]) for (let i = 0; i < n; i++) slots.push(slot);
  }
  slots.sort((a, b) => SLOT_ELIGIBLE[a].length - SLOT_ELIGIBLE[b].length);
  const qbStarters = slots.filter((s) => s === "QB" || s === "SUPER_FLEX").length;

  const BENCH = {
    QB: fmt.superflex ? [0.7, 0.4, 0.2, 0.1] : [0.3, 0.12, 0.05],
    RB: [0.65, 0.5, 0.38, 0.28, 0.2, 0.14, 0.1],
    WR: [0.65, 0.5, 0.38, 0.28, 0.2, 0.14, 0.1],
    TE: [0.35, 0.15, 0.08],
  };
  const capacity = (fmt.roster_size || 18) + (fmt.taxi || 0) + (fmt.ir || 0);

  // Team window tilt.
  function tilt(asset, mode) {
    if (asset.kind === "pick") return mode === "contender" ? 0.85 : mode === "rebuilder" ? 1.12 : 1;
    const age = asset.age || 26;
    if (mode === "contender") return age >= 27 ? 1.08 : age <= 22 ? 0.92 : 1;
    if (mode === "rebuilder") return age >= 30 ? 0.7 : age >= 28 ? 0.82 : age <= 24 ? 1.06 : 1;
    return 1;
  }

  function lineup(players) {
    const pool = players.slice().sort((a, b) => b.value - a.value);
    const used = new Set();
    for (const slot of slots) {
      const pick = pool.find((p) => !used.has(p.id) && SLOT_ELIGIBLE[slot].includes(p.pos));
      if (pick) used.add(pick.id);
    }
    return used;
  }

  /* Contextual value of a set of assets for one team. */
  function rosterValue(assets, mode) {
    const players = assets.filter((a) => a.kind === "player");
    const picks = assets.filter((a) => a.kind === "pick");
    const starters = lineup(players);
    const depth = {};
    const contrib = [];
    for (const p of players.slice().sort((a, b) => b.value - a.value)) {
      let w = 1;
      if (!starters.has(p.id)) {
        const list = BENCH[p.pos] || [0.05];
        const d = depth[p.pos] || 0;
        depth[p.pos] = d + 1;
        w = list[Math.min(d, list.length - 1)];
      }
      contrib.push({ asset: p, weight: w, value: p.value * w * tilt(p, mode), starter: starters.has(p.id) });
    }
    // Roster limit: the least useful non-starters get cut.
    const cuts = [];
    const over = players.length - capacity;
    if (over > 0) {
      const bench = contrib.filter((c) => !c.starter).sort((a, b) => a.value - b.value);
      for (const c of bench.slice(0, over)) {
        cuts.push(c.asset);
        c.value = 0;
      }
    }
    const lineupValue = contrib.filter((c) => c.starter).reduce((s, c) => s + c.value, 0);
    const playerValue = contrib.reduce((s, c) => s + c.value, 0);
    const pickValue = picks.reduce((s, a) => s + a.value * tilt(a, mode), 0);
    return { total: playerValue + pickValue, lineupValue, starters, cuts, contrib };
  }

  /* Package value with no team context: stars are worth more than the sum of
     smaller pieces, and extra QBs in a 1-QB format are discounted. */
  const PACKAGE_WEIGHTS = [1, 0.78, 0.62, 0.52, 0.45, 0.4, 0.36];
  function packageValue(assets) {
    const sorted = assets.slice().sort((a, b) => b.value - a.value);
    let qbs = 0;
    let total = 0;
    sorted.forEach((a, i) => {
      let v = a.value * PACKAGE_WEIGHTS[Math.min(i, PACKAGE_WEIGHTS.length - 1)];
      if (a.pos === "QB") {
        qbs += 1;
        if (qbs > qbStarters) v *= fmt.superflex ? 0.75 : 0.45;
      }
      total += v;
    });
    return total;
  }

  const sum = (list) => list.reduce((s, a) => s + a.value, 0);
  const avgAge = (list) => {
    const aged = list.filter((a) => a.kind === "player" && a.age);
    return aged.length ? aged.reduce((s, a) => s + a.age, 0) / aged.length : null;
  };

  /* Open calculator: two packages, no rosters. */
  function compare(sideA, sideB) {
    const rawA = sum(sideA), rawB = sum(sideB);
    const adjA = packageValue(sideA), adjB = packageValue(sideB);
    const notes = [];
    for (const [label, side] of [["Side A", sideA], ["Side B", sideB]]) {
      const qbs = side.filter((a) => a.pos === "QB").length;
      if (!fmt.superflex && qbs > qbStarters) {
        notes.push(`${label} sends ${qbs} QBs. In a ${qbStarters}-QB league only ${qbStarters} can start, so the extras are discounted.`);
      }
    }
    if (sideA.length && sideB.length && Math.abs(sideA.length - sideB.length) >= 2) {
      const more = sideA.length > sideB.length ? "Side A" : "Side B";
      notes.push(`${more} sends more pieces. Depth is discounted against a single better asset, because only starters score.`);
    }
    return { rawA, rawB, adjA, adjB, notes, verdict: verdict(adjB - adjA, adjA - adjB, Math.max(adjA, adjB, 1), "Side A", "Side B") };
  }

  /* Team-to-team trade. teamA gives `give` and gets `get`. */
  function evaluate(teamA, teamB, give, get) {
    const giveIds = new Set(give.map((a) => a.id));
    const getIds = new Set(get.map((a) => a.id));
    const aBefore = rosterValue(teamA.assets, teamA.mode);
    const bBefore = rosterValue(teamB.assets, teamB.mode);
    const aAfterAssets = teamA.assets.filter((a) => !giveIds.has(a.id)).concat(get);
    const bAfterAssets = teamB.assets.filter((a) => !getIds.has(a.id)).concat(give);
    const aAfter = rosterValue(aAfterAssets, teamA.mode);
    const bAfter = rosterValue(bAfterAssets, teamB.mode);
    const dA = aAfter.total - aBefore.total;
    const dB = bAfter.total - bBefore.total;

    const notes = [];
    const side = (team, before, after, received, sent) => {
      const name = team.name;
      const qbsIn = received.filter((a) => a.pos === "QB").length;
      const qbsAfter = (team === teamA ? aAfterAssets : bAfterAssets).filter((a) => a.pos === "QB").length;
      if (!fmt.superflex && qbsIn >= 2) notes.push(`${name} gets ${qbsIn} QBs but can start only ${qbStarters}.`);
      else if (!fmt.superflex && qbsIn && qbsAfter >= 3) notes.push(`${name} would carry ${qbsAfter} QBs in a ${qbStarters}-QB league.`);
      const newStarters = received.filter((a) => after.starters.has(a.id));
      if (newStarters.length) notes.push(`${newStarters.map((a) => a.name).join(", ")} would start for ${name}.`);
      const benched = received.filter((a) => a.kind === "player" && !after.starters.has(a.id));
      if (benched.length && received.length > 1) notes.push(`${benched.map((a) => a.name).join(", ")} would sit on ${name}'s bench.`);
      const lostStarters = sent.filter((a) => before.starters.has(a.id));
      const lineupChange = after.lineupValue - before.lineupValue;
      if (lostStarters.length && lineupChange < 0) {
        notes.push(`${name} loses starter${lostStarters.length > 1 ? "s" : ""} ${lostStarters.map((a) => a.name).join(", ")}; starting lineup value drops ${Math.round(-lineupChange).toLocaleString()}.`);
      }
      if (after.cuts.length) notes.push(`${name} would have to cut ${after.cuts.length} to fit the roster: ${after.cuts.map((a) => a.name).join(", ")}.`);
      const ageIn = avgAge(received), ageOut = avgAge(sent);
      if (ageIn && ageOut && Math.abs(ageIn - ageOut) >= 1.5) {
        const younger = ageIn < ageOut;
        const fits = (team.mode === "rebuilder" && younger) || (team.mode === "contender" && !younger);
        notes.push(`${name} gets ${younger ? "younger" : "older"} (${ageOut.toFixed(1)} → ${ageIn.toFixed(1)} avg age)${team.mode !== "middle" ? `, which ${fits ? "fits" : "cuts against"} a ${team.mode}` : ""}.`);
      }
    };
    side(teamA, aBefore, aAfter, get, give);
    side(teamB, bBefore, bAfter, give, get);

    const scale = Math.max(sum(give), sum(get), 1);
    return {
      dA, dB,
      rawGive: sum(give), rawGet: sum(get),
      aBefore: aBefore.total, aAfter: aAfter.total, bBefore: bBefore.total, bAfter: bAfter.total,
      lineupA: aAfter.lineupValue - aBefore.lineupValue,
      lineupB: bAfter.lineupValue - bBefore.lineupValue,
      notes,
      verdict: verdict(dA, dB, scale, teamA.name, teamB.name),
    };
  }

  /* lean in [-1, 1]: negative favors A, positive favors B. */
  function verdict(gainA, gainB, scale, nameA, nameB) {
    const diff = (gainA - gainB) / scale;
    const lean = Math.max(-1, Math.min(1, -diff / 0.5));
    let label;
    if (Math.abs(diff) < 0.08) label = "Fair";
    else if (Math.abs(diff) < 0.2) label = `Slightly favors ${diff > 0 ? nameA : nameB}`;
    else label = `Favors ${diff > 0 ? nameA : nameB}`;
    if (gainA > 0 && gainB > 0) label = `Win-win · ${label}`;
    return { label, lean, diff };
  }

  /* Trade ideas for `me` against every other team. */
  function ideas(me, others, opts = {}) {
    const usable = (list) => list.filter((a) => a.value >= 150 && a.pos !== "K" && a.pos !== "DEF")
      .sort((a, b) => b.value - a.value).slice(0, opts.depth || 14);
    const mine = usable(me.assets);
    const combos = (list) => {
      const out = list.map((a) => [a]);
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) out.push([list[i], list[j]]);
      return out;
    };
    const myCombos = combos(mine);
    const results = [];
    for (const other of others) {
      const theirCombos = combos(usable(other.assets));
      for (const give of myCombos) {
        const giveRaw = sum(give);
        for (const get of theirCombos) {
          if (give.length === 2 && get.length === 2) continue;
          const getRaw = sum(get);
          const ratio = getRaw / giveRaw;
          if (ratio < 0.7 || ratio > 1.4) continue;
          if (opts.pos && opts.pos !== "ANY" && !get.some((a) => (opts.pos === "PICK" ? a.kind === "pick" : a.pos === opts.pos))) continue;
          if (opts.goal === "younger") {
            const ai = avgAge(get), ao = avgAge(give);
            if (!(get.every((a) => a.kind === "pick" || (ai && ao && ai < ao - 1)))) continue;
          }
          if (opts.goal === "picks" && !get.some((a) => a.kind === "pick")) continue;
          if (opts.goal === "win" && get.some((a) => a.kind === "pick")) continue;
          const ev = evaluate(me, other, give, get);
          if (ev.dA <= 0 || ev.dB <= 0) continue;
          if (opts.goal === "win" && ev.lineupA <= 0) continue;
          const score = Math.min(ev.dA, ev.dB) + (opts.goal === "win" ? 0.25 * ev.lineupA : 0);
          results.push({ other, give, get, ev, score });
        }
      }
    }
    results.sort((a, b) => b.score - a.score);
    const perTeam = {};
    const seen = new Set();
    const picked = [];
    for (const r of results) {
      const key = r.give.map((a) => a.id).sort().join("|");
      if ((perTeam[r.other.rid] || 0) >= 3 || seen.has(key + r.other.rid)) continue;
      perTeam[r.other.rid] = (perTeam[r.other.rid] || 0) + 1;
      seen.add(key + r.other.rid);
      picked.push(r);
      if (picked.length >= (opts.limit || 15)) break;
    }
    return picked;
  }

  return { rosterValue, packageValue, compare, evaluate, ideas, lineup, qbStarters };
};
