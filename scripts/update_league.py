#!/usr/bin/env python3
"""Fetch HIM Dynasty data from Sleeper and write standings, max PF, draft order,
playoff odds, the playoff bracket, and a week-by-week history of all of them.

Output (relative to the repo root):
  docs/data/latest.json              the most recent snapshot, read by the website
  docs/data/history/YYYY-MM-DD.json  one snapshot per day

Draft order rules:
  * Picks 1..N go to the teams that miss the playoffs, lowest max PF first.
  * Playoff teams pick after them, grouped by how far they got:
    round 1 losers first, then round 2 losers, then the finals loser,
    and the champion last. Within a group, lowest max PF picks first.

History:
  For every completed regular-season week, the script rebuilds the standings as
  they were after that week and re-runs the season simulation from that point.
  That gives rank, playoff odds, and projected draft pick for each week.

Max PF (Sleeper's "potential points") per week is computed from each team's
best possible lineup, then checked against Sleeper's season total.

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
HISTORY_SIMULATIONS = int(os.environ.get("HISTORY_SIMULATIONS", "4000"))
DEFAULT_SD = 25.0
DEFAULT_MEAN = 100.0
# How many "league average" weeks each team's scoring is blended with. Early in
# the season a team's few scores say little about its true level, so its
# expected score leans on the league average; the pull fades as games pile up.
PRIOR_WEEKS = 3

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "docs" / "data"

# Which player positions can fill each Sleeper lineup slot.
SLOT_ELIGIBILITY = {
    "QB": {"QB"},
    "RB": {"RB"},
    "WR": {"WR"},
    "TE": {"TE"},
    "K": {"K"},
    "DEF": {"DEF"},
    "FLEX": {"RB", "WR", "TE"},
    "WRRB_FLEX": {"RB", "WR"},
    "REC_FLEX": {"WR", "TE"},
    "SUPER_FLEX": {"QB", "RB", "WR", "TE"},
    "DL": {"DL", "DE", "DT"},
    "LB": {"LB"},
    "DB": {"DB", "CB", "S"},
    "IDP_FLEX": {"DL", "DE", "DT", "LB", "DB", "CB", "S"},
}


# --------------------------------------------------------------------------- #
# Sleeper API
# --------------------------------------------------------------------------- #

def get(path):
    req = urllib.request.Request(f"{API}{path}", headers={"User-Agent": "him-dynasty-updater"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def sleeper_points(settings, name):
    """Sleeper stores points as a whole part plus a *_decimal part (hundredths)."""
    return settings.get(name, 0) + settings.get(f"{name}_decimal", 0) / 100.0


def load_players():
    """Return (eligible positions by player id, full Sleeper player records)."""
    players = get("/players/nfl") or {}
    positions = {}
    for pid, p in players.items():
        pos = p.get("fantasy_positions") or ([p["position"]] if p.get("position") else [])
        positions[pid] = set(pos)
    return positions, players


def player_card(pid, players):
    p = players.get(pid) or {}
    name = p.get("full_name") or " ".join(x for x in (p.get("first_name"), p.get("last_name")) if x) or pid
    return {
        "id": pid,
        "name": name,
        "pos": p.get("position") or (p.get("fantasy_positions") or ["?"])[0],
        "nfl": p.get("team") or "FA",
        "age": p.get("age"),
        "exp": p.get("years_exp"),
        "injury": p.get("injury_status"),
    }


def read_bracket_results():
    """Completed winners-bracket games from Sleeper, keyed by the two rosters."""
    try:
        games = get(f"/league/{LEAGUE_ID}/winners_bracket") or []
    except Exception:
        return {}
    results = {}
    for g in games:
        t1, t2, w = g.get("t1"), g.get("t2"), g.get("w")
        if isinstance(t1, int) and isinstance(t2, int) and w:
            results[frozenset((t1, t2))] = w
    return results


# --------------------------------------------------------------------------- #
# Weekly data
# --------------------------------------------------------------------------- #

def best_lineup_points(matchup, slots, positions):
    """Points from the best possible lineup for one team in one week."""
    pts = matchup.get("players_points") or {}
    pool = sorted(((pts.get(pid) or 0.0, pid) for pid in (matchup.get("players") or [])), reverse=True)
    used = set()
    total = 0.0
    for slot in slots:
        eligible = SLOT_ELIGIBILITY[slot]
        for p, pid in pool:
            if pid not in used and positions.get(pid, set()) & eligible:
                used.add(pid)
                total += p
                break
    return total


def read_schedule(weeks, slots, positions):
    """One entry per regular-season week: games, scores, and max points."""
    schedule = []
    for week in weeks:
        matchups = get(f"/league/{LEAGUE_ID}/matchups/{week}") or []
        grouped = {}
        for m in matchups:
            if m.get("matchup_id") is not None:
                grouped.setdefault(m["matchup_id"], []).append(m)
        games, scores, maxes, player_pts = [], {}, {}, {}
        for pair in grouped.values():
            if len(pair) != 2:
                continue
            a, b = pair
            games.append((a["roster_id"], b["roster_id"]))
            for side in pair:
                scores[side["roster_id"]] = float(side.get("points") or 0.0)
                maxes[side["roster_id"]] = best_lineup_points(side, slots, positions)
                player_pts[side["roster_id"]] = side.get("players_points") or {}
        schedule.append({"week": week, "games": games, "scores": scores, "max": maxes, "player_pts": player_pts})
    return schedule


def reconcile_max(schedule, done, official_max):
    """Scale each team's weekly max points so the season total matches Sleeper.

    Returns a diagnostics list comparing the computed total with Sleeper's.
    """
    diagnostics = []
    for rid, official in official_max.items():
        weeks = [wk for wk in schedule[:done] if rid in wk["max"]]
        computed = sum(wk["max"][rid] for wk in weeks)
        diagnostics.append({"roster_id": rid, "computed": round(computed, 2), "official": round(official, 2)})
        if official <= 0 or not weeks:
            continue
        if computed > 0 and abs(computed - official) / official > 0.01:
            factor = official / computed
            for wk in weeks:
                wk["max"][rid] = max(wk["scores"][rid], wk["max"][rid] * factor)
        elif computed <= 0:
            pf = sum(wk["scores"][rid] for wk in weeks) or 1.0
            for wk in weeks:
                wk["max"][rid] = wk["scores"][rid] * official / pf
    return diagnostics


def tally(rids, weeks, median):
    """Standings after the given completed weeks."""
    st = {r: {"wins": 0, "losses": 0, "ties": 0, "pf": 0.0, "pa": 0.0, "max_pf": 0.0} for r in rids}
    scores = {r: [] for r in rids}
    maxes = {r: [] for r in rids}
    for wk in weeks:
        for a, b in wk["games"]:
            sa, sb = wk["scores"][a], wk["scores"][b]
            st[a]["pa"] += sb
            st[b]["pa"] += sa
            if sa > sb:
                st[a]["wins"] += 1
                st[b]["losses"] += 1
            elif sb > sa:
                st[b]["wins"] += 1
                st[a]["losses"] += 1
            else:
                st[a]["ties"] += 1
                st[b]["ties"] += 1
        for r, s in wk["scores"].items():
            st[r]["pf"] += s
            st[r]["max_pf"] += wk["max"][r]
            scores[r].append(s)
            maxes[r].append(wk["max"][r])
        if median and wk["scores"]:
            ranked = sorted(wk["scores"], key=wk["scores"].get, reverse=True)
            half = len(ranked) // 2
            for r in ranked[:half]:
                st[r]["wins"] += 1
            for r in ranked[half:]:
                st[r]["losses"] += 1
    return st, scores, maxes


def score_model(values, rids, default_mean):
    """Per-team (mean, sd, se) of weekly points.

    mean: the team's average, blended with PRIOR_WEEKS of league average.
    sd:   week-to-week spread, blended the same way with the league spread.
    se:   uncertainty in the team's true level, shrinking as weeks are played.
    """
    everything = [p for pts in values.values() for p in pts]
    league_mean = statistics.mean(everything) if everything else default_mean
    league_sd = statistics.pstdev(everything) if len(everything) >= 4 else DEFAULT_SD
    league_sd = max(league_sd, 12.0)
    model = {}
    for rid in rids:
        pts = values.get(rid, [])
        n = len(pts)
        team_mean = statistics.mean(pts) if pts else league_mean
        team_var = statistics.pvariance(pts) if n >= 2 else league_sd ** 2
        mean = (n * team_mean + PRIOR_WEEKS * league_mean) / (n + PRIOR_WEEKS)
        sd = math.sqrt((n * team_var + PRIOR_WEEKS * league_sd ** 2) / (n + PRIOR_WEEKS))
        se = sd / math.sqrt(n + PRIOR_WEEKS)
        model[rid] = (mean, sd, se)
    return model


def standing_key(st):
    return lambda r: (st[r]["wins"] + 0.5 * st[r]["ties"], st[r]["pf"])


# --------------------------------------------------------------------------- #
# Playoffs and draft
# --------------------------------------------------------------------------- #

def normal_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def win_probability(model, a, b):
    mu_a, sd_a, se_a = model[a]
    mu_b, sd_b, se_b = model[b]
    sd = math.hypot(sd_a, sd_b, se_a, se_b)
    if sd == 0:
        return 1.0 if mu_a > mu_b else 0.0 if mu_a < mu_b else 0.5
    return normal_cdf((mu_a - mu_b) / sd)


def run_bracket(seeds, decide):
    """Single elimination for 4, 6, or 8 teams. Returns rounds of (a, b, winner)."""
    n = len(seeds)
    seed_of = {rid: seed for seed, rid in seeds.items()}
    if n == 4:
        games, byes = [(seeds[1], seeds[4]), (seeds[2], seeds[3])], []
    elif n == 6:
        games, byes = [(seeds[3], seeds[6]), (seeds[4], seeds[5])], [seeds[1], seeds[2]]
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
            return rounds
        if byes:
            pool = sorted(winners + byes, key=lambda r: seed_of[r])
            games = [(pool[0], pool[-1]), (pool[1], pool[-2])]
            byes = []
        else:
            games = [(winners[i], winners[i + 1]) for i in range(0, len(winners), 2)]


def round_names(playoff_teams, count):
    tail = ["Championship", "Semifinals", "Quarterfinals", "Round of 16"]
    names = list(reversed(tail[:count]))
    if playoff_teams == 6 and count == 3:
        names[0] = "Wild Card"
    return names


def pick_order(rids, playoff_set, rounds, max_pf):
    non_playoff = sorted((r for r in rids if r not in playoff_set), key=lambda r: max_pf[r])
    stage = {}
    for k, games in enumerate(rounds, start=1):
        for a, b, w in games:
            stage[b if w == a else a] = k
    stage[rounds[-1][0][2]] = len(rounds) + 1
    return non_playoff + sorted(playoff_set, key=lambda r: (stage[r], max_pf[r]))


def simulate(base, remaining_weeks, model, max_model, playoff_teams, actual, sims, rng, median):
    """Monte Carlo the rest of the regular season, the playoffs, and the draft order."""
    rids = list(base)
    n = len(rids)
    playoff_hits = {r: 0 for r in rids}
    champion_hits = {r: 0 for r in rids}
    win_total = {r: 0.0 for r in rids}
    slot_total = {r: 0 for r in rids}
    slot_counts = {r: [0] * (n + 1) for r in rids}
    gauss = rng.gauss

    for _ in range(sims):
        # Each simulated season draws every team's true level once.
        mu = {r: (gauss(model[r][0], model[r][2]), model[r][1]) for r in rids}
        mx_mu = {r: (gauss(max_model[r][0], max_model[r][2]), max_model[r][1]) for r in rids}
        wins = {r: base[r]["wins"] + 0.5 * base[r]["ties"] for r in rids}
        pf = {r: base[r]["pf"] for r in rids}
        mx = {r: base[r]["max_pf"] for r in rids}

        for pairs in remaining_weeks:
            week_scores = {}
            for a, b in pairs:
                sa = max(0.0, gauss(*mu[a]))
                sb = max(0.0, gauss(*mu[b]))
                week_scores[a] = sa
                week_scores[b] = sb
                if sa > sb:
                    wins[a] += 1
                elif sb > sa:
                    wins[b] += 1
            for r, s in week_scores.items():
                pf[r] += s
                mx[r] += max(s, gauss(*mx_mu[r]))
            if median and week_scores:
                ranked_week = sorted(week_scores, key=week_scores.get, reverse=True)
                for r in ranked_week[: len(ranked_week) // 2]:
                    wins[r] += 1

        ranked = sorted(rids, key=lambda r: (wins[r], pf[r]), reverse=True)
        seeds = {i + 1: ranked[i] for i in range(playoff_teams)}

        def decide(a, b):
            known = actual.get(frozenset((a, b)))
            if known is not None:
                return known
            return a if gauss(*mu[a]) >= gauss(*mu[b]) else b

        rounds = run_bracket(seeds, decide)
        champion_hits[rounds[-1][0][2]] += 1
        for r in seeds.values():
            playoff_hits[r] += 1
        for r in rids:
            win_total[r] += wins[r]
        for slot, r in enumerate(pick_order(rids, set(seeds.values()), rounds, mx), start=1):
            slot_total[r] += slot
            slot_counts[r][slot] += 1

    out = {}
    for r in rids:
        counts = slot_counts[r]
        out[r] = {
            "playoff_odds": playoff_hits[r] / sims,
            "champion_odds": champion_hits[r] / sims,
            "projected_wins": win_total[r] / sims,
            "avg_pick": slot_total[r] / sims,
            "most_likely_pick": max(range(1, n + 1), key=lambda s: counts[s]),
            "first_pick_odds": counts[1] / sims,
        }
    return out


def describe_bracket(rounds, playoff_teams, teams, seed_of, model, actual):
    def side(rid):
        return {"roster_id": rid, "seed": seed_of.get(rid), "team": teams[rid]["team"], "owner": teams[rid]["owner"]}

    out = []
    for name, games in zip(round_names(playoff_teams, len(rounds)), rounds):
        out.append({
            "name": name,
            "games": [
                {
                    "status": "final" if frozenset((a, b)) in actual else "projected",
                    "a": side(a),
                    "b": side(b),
                    "a_win_pct": round(win_probability(model, a, b) * 100, 1),
                    "winner": w,
                }
                for a, b, w in games
            ],
        })
    return out


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def build_teams(rosters, users):
    teams = {}
    for r in rosters:
        user = users.get(r.get("owner_id"), {})
        meta = user.get("metadata") or {}
        owner = user.get("display_name") or "Unknown"
        s = r.get("settings") or {}
        avatar = meta.get("avatar") or (
            f"https://sleepercdn.com/avatars/thumbs/{user['avatar']}" if user.get("avatar") else None)
        teams[r["roster_id"]] = {
            "roster_id": r["roster_id"],
            "team": meta.get("team_name") or owner,
            "owner": owner,
            "avatar": avatar,
            "players": [x for x in (r.get("players") or []) if x],
            "starters": r.get("starters") or [],
            "reserve": [x for x in (r.get("reserve") or []) if x],
            "taxi": [x for x in (r.get("taxi") or []) if x],
            "wins": s.get("wins", 0),
            "losses": s.get("losses", 0),
            "ties": s.get("ties", 0),
            "pf": sleeper_points(s, "fpts"),
            "pa": sleeper_points(s, "fpts_against"),
            "max_pf": sleeper_points(s, "ppts"),
        }
    return teams


def build_team_pages(teams, rids, schedule, done, players, league, model, ranked, sims, st, playoff_start):
    """Roster and schedule for each team's page."""
    starting_slots = [x for x in (league.get("roster_positions") or []) if x not in ("BN", "IR", "TAXI")]
    rank_of = {r: i for i, r in enumerate(ranked, start=1)}
    pages = {}
    for r in rids:
        t = teams[r]

        # Fantasy points each player scored for this team, over completed weeks.
        season_pts, last_pts = {}, {}
        for i, wk in enumerate(schedule[:done]):
            for pid, pts in (wk["player_pts"].get(r) or {}).items():
                season_pts[pid] = season_pts.get(pid, 0.0) + (pts or 0.0)
                if i == done - 1:
                    last_pts[pid] = pts or 0.0

        def card(pid):
            c = player_card(pid, players)
            c["pts"] = round(season_pts.get(pid, 0.0), 2)
            c["last"] = round(last_pts[pid], 2) if pid in last_pts else None
            return c

        starters = []
        for slot, pid in zip(starting_slots, t["starters"]):
            starters.append({"slot": slot, "player": card(pid) if pid and pid != "0" else None})
        taken = set(t["starters"]) | set(t["reserve"]) | set(t["taxi"])
        bench = sorted((card(pid) for pid in t["players"] if pid not in taken), key=lambda c: -c["pts"])

        games = []
        for i, wk in enumerate(schedule):
            opp = next((b if a == r else a for a, b in wk["games"] if r in (a, b)), None)
            if opp is None:
                games.append({"week": wk["week"], "status": "bye"})
                continue
            mine, theirs = wk["scores"].get(r, 0.0), wk["scores"].get(opp, 0.0)
            if i < done:
                status = "final"
            elif i == done and (mine > 0 or theirs > 0):
                status = "live"
            else:
                status = "upcoming"
            game = {
                "week": wk["week"],
                "status": status,
                "opponent": opp,
                "opponent_team": teams[opp]["team"],
                "opponent_owner": teams[opp]["owner"],
                "win_pct": round(win_probability(model, r, opp) * 100, 1),
            }
            if status != "upcoming":
                game.update(points=round(mine, 2), opp_points=round(theirs, 2))
            if status == "final":
                game["max"] = round(wk["max"].get(r, 0.0), 2)
                game["result"] = "W" if mine > theirs else "L" if theirs > mine else "T"
            games.append(game)

        pages[str(r)] = {
            "roster_id": r,
            "team": t["team"],
            "owner": t["owner"],
            "avatar": t["avatar"],
            "rank": rank_of[r],
            "record": {"wins": st[r]["wins"], "losses": st[r]["losses"], "ties": st[r]["ties"]},
            "points_for": round(st[r]["pf"], 2),
            "points_against": round(st[r]["pa"], 2),
            "max_pf": round(st[r]["max_pf"], 2),
            "playoff_odds": round(sims[r]["playoff_odds"] * 100, 1),
            "champion_odds": round(sims[r]["champion_odds"] * 100, 1),
            "first_pick_odds": round(sims[r]["first_pick_odds"] * 100, 1),
            "avg_pick": round(sims[r]["avg_pick"], 2),
            "roster": {
                "starters": starters,
                "bench": bench,
                "taxi": [card(pid) for pid in t["taxi"]],
                "ir": [card(pid) for pid in t["reserve"]],
            },
            "schedule": games,
            "playoffs_start_week": playoff_start,
        }
    return pages


def main():
    league = get(f"/league/{LEAGUE_ID}")
    users = {u["user_id"]: u for u in get(f"/league/{LEAGUE_ID}/users")}
    rosters = get(f"/league/{LEAGUE_ID}/rosters")

    settings = league.get("settings") or {}
    season = str(league.get("season"))
    playoff_teams = settings.get("playoff_teams", 6)
    playoff_start = settings.get("playoff_week_start", 15)
    start_week = settings.get("start_week", 1) or 1
    median = settings.get("league_average_match", 0) == 1
    if playoff_teams not in (4, 6, 8):
        raise SystemExit(f"Bracket support covers 4, 6, or 8 playoff teams; league has {playoff_teams}.")

    teams = build_teams(rosters, users)
    rids = sorted(teams)

    slots = sorted(
        (s for s in league.get("roster_positions") or [] if s in SLOT_ELIGIBILITY),
        key=lambda s: len(SLOT_ELIGIBILITY[s]),
    )
    positions, players = load_players()
    schedule = read_schedule(range(start_week, playoff_start), slots, positions)

    # Completed regular-season weeks, from the official records.
    games_per_week = 2 if median else 1
    played = max((t["wins"] + t["losses"] + t["ties"] for t in teams.values()), default=0)
    done = min(played // games_per_week, len(schedule))

    diagnostics = reconcile_max(schedule, done, {r: t["max_pf"] for r, t in teams.items()})
    actual = read_bracket_results()

    def evaluate(n_weeks, is_current):
        st, scores, maxes = tally(rids, schedule[:n_weeks], median)
        if is_current:
            for r in rids:
                t = teams[r]
                st[r].update(wins=t["wins"], losses=t["losses"], ties=t["ties"],
                             pf=t["pf"], pa=t["pa"], max_pf=t["max_pf"])
        model = score_model(scores, rids, DEFAULT_MEAN)
        max_model = score_model(maxes, rids, DEFAULT_MEAN * 1.15)
        remaining = [wk["games"] for wk in schedule[n_weeks:]]
        week_label = schedule[n_weeks - 1]["week"] if n_weeks else 0
        rng = random.Random(f"{LEAGUE_ID}-{season}-{week_label}")
        sims = simulate(st, remaining, model, max_model, playoff_teams,
                        actual if is_current else {},
                        SIMULATIONS if is_current else HISTORY_SIMULATIONS, rng, median)
        ranked = sorted(rids, key=standing_key(st), reverse=True)
        return st, model, ranked, sims, len(remaining)

    # Week-by-week history
    series = {r: {k: [] for k in ("rank", "wins", "points_for", "max_pf", "playoff_odds",
                                  "champion_odds", "avg_pick", "first_pick_odds")} for r in rids}
    history_weeks = []
    for n in range(1, done + 1):
        st, _, ranked, sims, _ = evaluate(n, is_current=(n == done))
        history_weeks.append(schedule[n - 1]["week"])
        for rank, r in enumerate(ranked, start=1):
            s = series[r]
            s["rank"].append(rank)
            s["wins"].append(st[r]["wins"])
            s["points_for"].append(round(st[r]["pf"], 2))
            s["max_pf"].append(round(st[r]["max_pf"], 2))
            s["playoff_odds"].append(round(sims[r]["playoff_odds"] * 100, 1))
            s["champion_odds"].append(round(sims[r]["champion_odds"] * 100, 1))
            s["avg_pick"].append(round(sims[r]["avg_pick"], 2))
            s["first_pick_odds"].append(round(sims[r]["first_pick_odds"] * 100, 1))

    # Current state (same as the last history point, or preseason if no games yet)
    st, model, ranked, sims, remaining_games = evaluate(done, is_current=True)

    standings = []
    for rank, r in enumerate(ranked, start=1):
        t, s = st[r], sims[r]
        standings.append({
            "rank": rank,
            "roster_id": r,
            "team": teams[r]["team"],
            "owner": teams[r]["owner"],
            "wins": t["wins"],
            "losses": t["losses"],
            "ties": t["ties"],
            "points_for": round(t["pf"], 2),
            "points_against": round(t["pa"], 2),
            "max_pf": round(t["max_pf"], 2),
            "playoff_odds": round(s["playoff_odds"] * 100, 1),
            "champion_odds": round(s["champion_odds"] * 100, 1),
            "projected_wins": round(s["projected_wins"], 1),
        })

    seeds_now = {i + 1: ranked[i] for i in range(playoff_teams)}
    seed_of = {rid: seed for seed, rid in seeds_now.items()}

    def favorite(a, b):
        known = actual.get(frozenset((a, b)))
        if known is not None:
            return known
        return a if win_probability(model, a, b) >= 0.5 else b

    bracket = describe_bracket(run_bracket(seeds_now, favorite), playoff_teams, teams, seed_of, model, actual)

    projected = sorted(
        (
            {
                "roster_id": r,
                "team": teams[r]["team"],
                "owner": teams[r]["owner"],
                "max_pf": round(st[r]["max_pf"], 2),
                "playoff_odds": round(sims[r]["playoff_odds"] * 100, 1),
                "first_pick_odds": round(sims[r]["first_pick_odds"] * 100, 1),
                "avg_pick": round(sims[r]["avg_pick"], 2),
                "most_likely_pick": sims[r]["most_likely_pick"],
            }
            for r in rids
        ),
        key=lambda row: row["avg_pick"],
    )

    team_pages = build_team_pages(teams, rids, schedule, done, players, league, model,
                                  ranked, sims, st, playoff_start)

    now = dt.datetime.now(dt.timezone.utc)
    snapshot = {
        "generated_at": now.isoformat(timespec="seconds"),
        "league": {
            "id": LEAGUE_ID,
            "name": league.get("name"),
            "season": league.get("season"),
            "status": league.get("status"),
            "playoff_teams": playoff_teams,
            "weeks_completed": done,
        },
        "simulations": SIMULATIONS,
        "remaining_games": sum(len(g) for g in (wk["games"] for wk in schedule[done:])),
        "standings": standings,
        "playoffs": {
            "seeds": [
                {"seed": seed, "roster_id": r, "team": teams[r]["team"], "owner": teams[r]["owner"]}
                for seed, r in sorted(seeds_now.items())
            ],
            "rounds": bracket,
        },
        "draft": {"projected_order": projected},
        "history": {
            "weeks": history_weeks,
            "teams": [{"roster_id": r, "team": teams[r]["team"], "owner": teams[r]["owner"]} for r in rids],
            "series": {str(r): series[r] for r in rids},
        },
        "teams": team_pages,
        "diagnostics": {"max_pf_check": diagnostics},
    }

    payload = json.dumps(snapshot, indent=2, ensure_ascii=False)
    (DATA_DIR / "history").mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "latest.json").write_text(payload + "\n", encoding="utf-8")
    (DATA_DIR / "history" / f"{now:%Y-%m-%d}.json").write_text(payload + "\n", encoding="utf-8")
    print(f"Wrote {len(standings)} teams, {done} weeks of history, {remaining_games} weeks left, to {DATA_DIR}")
    for d in diagnostics:
        print(f"  max PF check roster {d['roster_id']}: computed {d['computed']} vs Sleeper {d['official']}")


if __name__ == "__main__":
    main()
