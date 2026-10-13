#!/usr/bin/env python3
"""Fetch HIM Dynasty data from Sleeper and write standings, max PF, draft order,
playoff odds, and the playoff bracket.

Output (relative to the repo root):
  docs/data/latest.json              the most recent snapshot, read by the website
  docs/data/history/YYYY-MM-DD.json  one snapshot per day

Draft order rules used here:
  * Picks 1..N go to the teams that miss the playoffs, lowest max PF first.
  * The playoff teams pick after them, grouped by how far they got:
      - teams knocked out in round 1 pick next (lowest max PF first),
      - then round 2 losers, then the finals loser,
      - the champion picks last.

Uses only the Python standard library.
"""

import datetime as dt
import json
import math
import os
import random
import statistics
import urllib.request
from pathlib import Path

API = "https://api.sleeper.app/v1"
LEAGUE_ID = os.environ.get("SLEEPER_LEAGUE_ID", "1312005038838673409")
SIMULATIONS = int(os.environ.get("SIMULATIONS", "10000"))
DEFAULT_SD = 15.0  # fallback weekly score standard deviation when history is thin
PLAYOFF_WEEKS_TO_READ = 4

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "docs" / "data"


def get(path):
    req = urllib.request.Request(f"{API}{path}", headers={"User-Agent": "him-dynasty-updater"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def sleeper_points(settings, name):
    """Sleeper stores points as a whole part plus a *_decimal part (hundredths)."""
    return settings.get(name, 0) + settings.get(f"{name}_decimal", 0) / 100.0


def group_by_matchup(matchups):
    grouped = {}
    for m in matchups:
        mid = m.get("matchup_id")
        if mid is not None:
            grouped.setdefault(mid, []).append(m)
    return grouped


def build_teams(rosters, users):
    teams = {}
    for r in rosters:
        user = users.get(r.get("owner_id"), {})
        meta = user.get("metadata") or {}
        owner = user.get("display_name") or "Unknown"
        s = r.get("settings") or {}
        teams[r["roster_id"]] = {
            "roster_id": r["roster_id"],
            "team": meta.get("team_name") or owner,
            "owner": owner,
            "owner_id": r.get("owner_id"),
            "wins": s.get("wins", 0),
            "losses": s.get("losses", 0),
            "ties": s.get("ties", 0),
            "points_for": round(sleeper_points(s, "fpts"), 2),
            "points_against": round(sleeper_points(s, "fpts_against"), 2),
            "max_pf": round(sleeper_points(s, "ppts"), 2),
        }
    return teams


def read_regular_season(last_week):
    """Return (played_scores_by_roster, remaining_games) for the regular season."""
    played = {}
    remaining = []
    for week in range(1, last_week + 1):
        for pair in group_by_matchup(get(f"/league/{LEAGUE_ID}/matchups/{week}") or []).values():
            if len(pair) != 2:
                continue  # bye week
            a, b = pair
            if (a.get("points") or 0) > 0 and (b.get("points") or 0) > 0:
                for side in pair:
                    played.setdefault(side["roster_id"], []).append(side["points"])
            else:
                remaining.append((a["roster_id"], b["roster_id"]))
    return played, remaining


def read_playoff_results(first_week):
    """Completed playoff games, keyed by the two rosters, valued by the winner."""
    results = {}
    for week in range(first_week, first_week + PLAYOFF_WEEKS_TO_READ):
        for pair in group_by_matchup(get(f"/league/{LEAGUE_ID}/matchups/{week}") or []).values():
            if len(pair) != 2:
                continue
            a, b = pair
            if (a.get("points") or 0) > 0 and (b.get("points") or 0) > 0:
                winner = a["roster_id"] if a["points"] >= b["points"] else b["roster_id"]
                results[frozenset((a["roster_id"], b["roster_id"]))] = winner
    return results


def score_model(played, roster_ids):
    """Per-team (mean, standard deviation) of weekly points, with fallbacks."""
    all_scores = [p for pts in played.values() for p in pts]
    league_mean = statistics.mean(all_scores) if all_scores else 100.0

    model = {}
    for rid in roster_ids:
        pts = played.get(rid, [])
        if len(pts) >= 2:
            model[rid] = (statistics.mean(pts), statistics.stdev(pts) or DEFAULT_SD)
        elif pts:
            model[rid] = (pts[0], DEFAULT_SD)
        else:
            model[rid] = (league_mean, DEFAULT_SD)
    return model


def normal_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def win_probability(model, a, b):
    """Chance that team a outscores team b in a single game."""
    mu_a, sd_a = model[a]
    mu_b, sd_b = model[b]
    sd = math.hypot(sd_a, sd_b)
    if sd == 0:
        return 1.0 if mu_a > mu_b else 0.0 if mu_a < mu_b else 0.5
    return normal_cdf((mu_a - mu_b) / sd)


def run_bracket(seeds, decide):
    """Play out a single-elimination bracket.

    seeds:  {seed_number: roster_id} for 4, 6, or 8 playoff teams.
    decide: function(roster_a, roster_b) -> winning roster_id.

    Returns a list of rounds. Each round is a list of (a, b, winner) games.
    Standard seeding: 6 teams -> seeds 1 and 2 get byes, seed 1 plays the lowest
    remaining seed, seed 2 plays the other.
    """
    n = len(seeds)
    seed_of = {rid: seed for seed, rid in seeds.items()}
    if n == 4:
        games = [(seeds[1], seeds[4]), (seeds[2], seeds[3])]
        byes = []
    elif n == 6:
        games = [(seeds[3], seeds[6]), (seeds[4], seeds[5])]
        byes = [seeds[1], seeds[2]]
    elif n == 8:
        games = [(seeds[1], seeds[8]), (seeds[4], seeds[5]), (seeds[3], seeds[6]), (seeds[2], seeds[7])]
        byes = []
    else:
        raise ValueError(f"Unsupported playoff size: {n}")

    rounds = []
    while True:
        results = [(a, b, decide(a, b)) for a, b in games]
        rounds.append(results)
        winners = [w for _, _, w in results]
        if len(winners) == 1:
            break
        if byes:
            pool = sorted(winners + byes, key=lambda r: seed_of[r])
            games = [(pool[0], pool[-1]), (pool[1], pool[-2])]
            byes = []
        else:
            games = [(winners[i], winners[i + 1]) for i in range(0, len(winners), 2)]
    return rounds


def round_names(playoff_teams, count):
    tail = ["Championship", "Semifinals", "Quarterfinals", "Round of 16"]
    names = list(reversed(tail[:count]))
    if playoff_teams == 6 and count == 3:
        names[0] = "Wild Card"
    return names


def pick_order(rids, playoff_set, rounds, max_pf):
    """Return roster ids in pick order, first pick first."""
    non_playoff = sorted((r for r in rids if r not in playoff_set), key=lambda r: max_pf[r])

    # Elimination round: 1 = lost in the first round, ..., final loser = last round.
    # The champion gets a value higher than any loser so they pick last.
    stage = {}
    for k, games in enumerate(rounds, start=1):
        for a, b, w in games:
            loser = b if w == a else a
            stage[loser] = k
    champion = rounds[-1][0][2]
    stage[champion] = len(rounds) + 1

    playoff_sorted = sorted(playoff_set, key=lambda r: (stage[r], max_pf[r]))
    return non_playoff + playoff_sorted


def simulate(teams, remaining, model, playoff_teams, actual_playoffs, max_pf):
    rids = list(teams)
    n = len(rids)
    rng = random.Random()

    playoff_hits = {r: 0 for r in rids}
    champion_hits = {r: 0 for r in rids}
    win_total = {r: 0.0 for r in rids}
    slot_total = {r: 0 for r in rids}
    slot_counts = {r: [0] * (n + 1) for r in rids}

    for _ in range(SIMULATIONS):
        wins = {r: teams[r]["wins"] for r in rids}
        pf = {r: teams[r]["points_for"] for r in rids}
        for a, b in remaining:
            sa = max(0.0, rng.gauss(*model[a]))
            sb = max(0.0, rng.gauss(*model[b]))
            pf[a] += sa
            pf[b] += sb
            if sa > sb:
                wins[a] += 1
            elif sb > sa:
                wins[b] += 1

        ranked = sorted(rids, key=lambda r: (wins[r], pf[r]), reverse=True)
        seeds = {i + 1: ranked[i] for i in range(playoff_teams)}

        def decide(a, b):
            known = actual_playoffs.get(frozenset((a, b)))
            if known is not None:
                return known
            sa = max(0.0, rng.gauss(*model[a]))
            sb = max(0.0, rng.gauss(*model[b]))
            return a if sa >= sb else b

        rounds = run_bracket(seeds, decide)
        champion_hits[rounds[-1][0][2]] += 1
        for r in seeds.values():
            playoff_hits[r] += 1
        for r in rids:
            win_total[r] += wins[r]

        order = pick_order(rids, set(seeds.values()), rounds, max_pf)
        for slot, r in enumerate(order, start=1):
            slot_total[r] += slot
            slot_counts[r][slot] += 1

    results = {}
    for r in rids:
        counts = slot_counts[r]
        most_likely = max(range(1, n + 1), key=lambda s: counts[s])
        results[r] = {
            "playoff_odds": playoff_hits[r] / SIMULATIONS,
            "champion_odds": champion_hits[r] / SIMULATIONS,
            "projected_wins": win_total[r] / SIMULATIONS,
            "avg_pick": slot_total[r] / SIMULATIONS,
            "most_likely_pick": most_likely,
        }
    return results


def seat(rid, teams, seed_of, model=None):
    t = teams[rid]
    row = {"roster_id": rid, "seed": seed_of.get(rid), "team": t["team"], "owner": t["owner"]}
    return row


def describe_bracket(rounds, playoff_teams, teams, seed_of, model, actual):
    names = round_names(playoff_teams, len(rounds))
    out = []
    for name, games in zip(names, rounds):
        rows = []
        for a, b, w in games:
            status = "final" if frozenset((a, b)) in actual else "projected"
            rows.append({
                "status": status,
                "a": seat(a, teams, seed_of),
                "b": seat(b, teams, seed_of),
                "a_win_pct": round(win_probability(model, a, b) * 100, 1),
                "winner": w,
            })
        out.append({"name": name, "games": rows})
    return out


def main():
    league = get(f"/league/{LEAGUE_ID}")
    users = {u["user_id"]: u for u in get(f"/league/{LEAGUE_ID}/users")}
    rosters = get(f"/league/{LEAGUE_ID}/rosters")
    drafts = get(f"/league/{LEAGUE_ID}/drafts")

    settings = league.get("settings") or {}
    playoff_teams = settings.get("playoff_teams", 6)
    playoff_start = settings.get("playoff_week_start", 15)
    if playoff_teams not in (4, 6, 8):
        raise SystemExit(f"Bracket support covers 4, 6, or 8 playoff teams; league has {playoff_teams}.")

    teams = build_teams(rosters, users)
    max_pf = {r: t["max_pf"] for r, t in teams.items()}
    played, remaining = read_regular_season(playoff_start - 1)
    model = score_model(played, teams.keys())
    actual = read_playoff_results(playoff_start)

    sims = simulate(teams, remaining, model, playoff_teams, actual, max_pf)

    # Current standings
    ranked_now = sorted(teams, key=lambda r: (teams[r]["wins"], teams[r]["points_for"]), reverse=True)
    seeds_now = {i + 1: ranked_now[i] for i in range(playoff_teams)}
    seed_of = {rid: seed for seed, rid in seeds_now.items()}

    standings = []
    for rank, rid in enumerate(ranked_now, start=1):
        t = teams[rid]
        s = sims[rid]
        standings.append({
            "rank": rank,
            "team": t["team"],
            "owner": t["owner"],
            "wins": t["wins"],
            "losses": t["losses"],
            "ties": t["ties"],
            "points_for": t["points_for"],
            "points_against": t["points_against"],
            "max_pf": t["max_pf"],
            "playoff_odds": round(s["playoff_odds"] * 100, 1),
            "champion_odds": round(s["champion_odds"] * 100, 1),
            "projected_wins": round(s["projected_wins"], 1),
            "avg_pick": round(s["avg_pick"], 1),
            "most_likely_pick": s["most_likely_pick"],
        })

    # Projected bracket: current seeds, with the favorite advancing in each game
    # until a game has actually been played.
    def favorite(a, b):
        known = actual.get(frozenset((a, b)))
        if known is not None:
            return known
        return a if win_probability(model, a, b) >= 0.5 else b

    bracket_rounds = run_bracket(seeds_now, favorite)
    bracket = describe_bracket(bracket_rounds, playoff_teams, teams, seed_of, model, actual)

    # Draft: official order from Sleeper (if set), plus the simulated projection.
    season = str(league.get("season"))
    owner_to_row = {t["owner_id"]: rid for rid, t in teams.items()}
    official = None
    current = next((d for d in drafts if str(d.get("season")) == season), None)
    if current and current.get("draft_order"):
        official = sorted(
            (
                {
                    "slot": slot,
                    "team": teams[owner_to_row[uid]]["team"],
                    "owner": teams[owner_to_row[uid]]["owner"],
                }
                for uid, slot in current["draft_order"].items()
                if uid in owner_to_row
            ),
            key=lambda row: row["slot"],
        )

    projected = sorted(
        (
            {
                "team": teams[rid]["team"],
                "owner": teams[rid]["owner"],
                "avg_pick": round(sims[rid]["avg_pick"], 1),
                "most_likely_pick": sims[rid]["most_likely_pick"],
            }
            for rid in teams
        ),
        key=lambda row: row["avg_pick"],
    )

    now = dt.datetime.now(dt.timezone.utc)
    snapshot = {
        "generated_at": now.isoformat(timespec="seconds"),
        "league": {
            "id": LEAGUE_ID,
            "name": league.get("name"),
            "season": league.get("season"),
            "status": league.get("status"),
            "playoff_teams": playoff_teams,
        },
        "simulations": SIMULATIONS,
        "remaining_games": len(remaining),
        "standings": standings,
        "playoffs": {
            "seeds": [
                {"seed": seed, "team": teams[rid]["team"], "owner": teams[rid]["owner"]}
                for seed, rid in sorted(seeds_now.items())
            ],
            "rounds": bracket,
        },
        "draft": {"official_order": official, "projected_order": projected},
    }

    payload = json.dumps(snapshot, indent=2)
    (DATA_DIR / "history").mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "latest.json").write_text(payload + "\n")
    (DATA_DIR / "history" / f"{now:%Y-%m-%d}.json").write_text(payload + "\n")
    print(f"Wrote {len(standings)} teams, {len(remaining)} games left, to {DATA_DIR}")


if __name__ == "__main__":
    main()
