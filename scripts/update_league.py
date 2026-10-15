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
import sys
import random
import statistics
import urllib.request
from pathlib import Path

API = "https://api.sleeper.app/v1"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from league_pointer import current_league_id  # noqa: E402
from recap import build_recap, write_recap  # noqa: E402
import roster_strength as RS  # noqa: E402

LEAGUE_ID = current_league_id()
SIMULATIONS = int(os.environ.get("SIMULATIONS", "10000"))
HISTORY_SIMULATIONS = int(os.environ.get("HISTORY_SIMULATIONS", "4000"))
DEFAULT_SD = 25.0
DEFAULT_MEAN = 100.0
# How many "league average" weeks each team's scoring is blended with. Early in
# the season a team's few scores say little about its true level, so its
# expected score leans on the league average; the pull fades as games pile up.
PRIOR_WEEKS = 3
# How many weeks of results today's roster outlook is worth. The outlook
# (projections for the players on the roster now, with injuries and
# replacements; see roster_strength.py) is what lets trades, waiver moves and
# injuries move the odds before any games are played. With 5 weeks played,
# results carry 5/(5+6+1) of the weight; by week 12 about 2/3.
ROSTER_WEEKS = 6
ROSTER_PRIOR = 1

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
        "espn_id": p.get("espn_id"),
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
        games, scores, maxes, player_pts, starters = [], {}, {}, {}, {}
        for pair in grouped.values():
            if len(pair) != 2:
                continue
            a, b = pair
            games.append((a["roster_id"], b["roster_id"]))
            for side in pair:
                scores[side["roster_id"]] = float(side.get("points") or 0.0)
                maxes[side["roster_id"]] = best_lineup_points(side, slots, positions)
                player_pts[side["roster_id"]] = side.get("players_points") or {}
                starters[side["roster_id"]] = side.get("starters") or []
        schedule.append({"week": week, "games": games, "scores": scores, "max": maxes,
                         "player_pts": player_pts, "starters": starters})
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


def score_model(values, rids, default_mean, roster=None):
    """Per-team (mean, sd, se) of weekly points.

    mean: the team's average, blended with PRIOR_WEEKS of league average.
          With a roster outlook, it blends results (one share per week
          played), the outlook (ROSTER_WEEKS shares) and the league average
          (ROSTER_PRIOR share).
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
        if roster and rid in roster:
            mean = (n * team_mean + ROSTER_WEEKS * roster[rid] + ROSTER_PRIOR * league_mean) / (n + ROSTER_WEEKS + ROSTER_PRIOR)
        else:
            mean = (n * team_mean + PRIOR_WEEKS * league_mean) / (n + PRIOR_WEEKS)
        sd = math.sqrt((n * team_var + PRIOR_WEEKS * league_sd ** 2) / (n + PRIOR_WEEKS))
        se = sd / math.sqrt(n + PRIOR_WEEKS)
        model[rid] = (mean, sd, se)
    return model


def with_roster(scores, maxes, rids, roster):
    """Score and max-PF models with the roster outlook blended in. The max-PF
    model moves by the same amount as the score model."""
    base = score_model(scores, rids, DEFAULT_MEAN)
    model = score_model(scores, rids, DEFAULT_MEAN, roster)
    max_model = score_model(maxes, rids, DEFAULT_MEAN * 1.15)
    if roster:
        for r in rids:
            m, sd, se = max_model[r]
            max_model[r] = (m + model[r][0] - base[r][0], sd, se)
    return model, max_model, base


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

def read_transactions(weeks, players):
    """Completed league transactions, newest first, with player names."""
    out = []
    for w in weeks:
        try:
            items = get(f"/league/{LEAGUE_ID}/transactions/{w}") or []
        except Exception:  # noqa: BLE001
            continue
        for t in items:
            if t.get("status") != "complete":
                continue
            out.append({
                "id": t.get("transaction_id"),
                "type": t.get("type"),
                "week": w,
                "time": t.get("status_updated") or t.get("created"),
                "rosters": t.get("roster_ids") or [],
                "adds": t.get("adds") or {},
                "drops": t.get("drops") or {},
                "picks": [{"season": d.get("season"), "round": d.get("round"), "original": d.get("roster_id"),
                           "from": d.get("previous_owner_id"), "to": d.get("owner_id")} for d in (t.get("draft_picks") or [])],
                "faab": (t.get("settings") or {}).get("waiver_bid"),
            })
    out.sort(key=lambda x: x["time"] or 0, reverse=True)
    return out


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


def projected_draft_order(rids, st, ranked, model, playoff_teams, actual):
    """Draft order if the season ended today.

    Picks 1..N: teams currently outside the playoffs, lowest max PF first.
    Remaining picks: current playoff teams in the order the projected bracket
    (current seeds, favorite wins each game) eliminates them, lowest max PF
    first within a round, champion last.
    """
    seeds = {i + 1: ranked[i] for i in range(playoff_teams)}

    def favorite(a, b):
        known = actual.get(frozenset((a, b)))
        if known is not None:
            return known
        return a if win_probability(model, a, b) >= 0.5 else b

    rounds = run_bracket(seeds, favorite)
    order = pick_order(rids, set(seeds.values()), rounds, {r: st[r]["max_pf"] for r in rids})
    return order, rounds


AVAILABILITY = {"IR": 0.0, "PUP": 0.0, "Sus": 0.0, "NA": 0.0, "Out": 0.5, "Doubtful": 0.7, "Questionable": 0.95}


def player_rates(schedule, done):
    """League-wide fantasy points per game for every player, from weeks he scored."""
    total, games = {}, {}
    for wk in schedule[:done]:
        for pts_by_player in wk["player_pts"].values():
            for pid, pts in pts_by_player.items():
                if pts:
                    total[pid] = total.get(pid, 0.0) + pts
                    games[pid] = games.get(pid, 0) + 1
    return {pid: total[pid] / games[pid] for pid in total}


def build_team_pages(teams, rids, schedule, done, players, league, model, ranked, sims, st, playoff_start):
    """Roster and schedule for each team's page."""
    rates = player_rates(schedule, done)
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
            ppg = rates.get(pid, 0.0)
            c["ppg"] = round(ppg, 2)
            # Rest-of-season weekly projection: scoring rate times availability.
            c["proj"] = round(ppg * AVAILABILITY.get(c.get("injury") or "", 1.0), 2)
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


def prune_snapshots(folder, today):
    """Keep every daily snapshot for 3 weeks, then one a week (Tuesdays).

    Each snapshot is ~200 KB; this keeps the repo growing by ~10 MB a year
    instead of ~70 MB. Season results live on in docs/data/archive.
    """
    for f in folder.glob("*.json"):
        try:
            day = dt.date.fromisoformat(f.stem)
        except ValueError:
            continue
        if (today - day).days > 21 and day.weekday() != 1:
            f.unlink()


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

    # NFL calendar (for the matchup week shown on the site) and transactions.
    try:
        state = get("/state/nfl") or {}
    except Exception:  # noqa: BLE001
        state = {}
    last_week = playoff_start + max(1, (playoff_teams - 1).bit_length()) - 1
    tx_weeks = range(start_week, min(last_week, max(done + 1, int(state.get("week") or 0))) + 1)
    transactions = read_transactions(tx_weeks, players)
    actual = read_bracket_results()

    # Rest-of-season roster outlook (trades, moves, injuries, replacements).
    roster_now, outlook = None, {}
    try:
        sc = league.get("scoring_settings") or {}
        first = start_week + done
        weeks_left = list(range(first, last_week + 1))
        if weeks_left:
            proj = RS.load_projections(season, weeks_left[:RS.MAX_WEEKS], sc)
            outlook = RS.roster_strength(rosters, players, positions, league.get("roster_positions") or [],
                                         schedule, done, weeks_left, proj, now_week=first, seed=f"{LEAGUE_ID}-{season}")
        if outlook:
            raw = {r: o["mean"] for r, o in outlook.items() if r in teams}
            # Projections run on their own scale; match the league's actual
            # scoring level so only the differences between rosters matter.
            _, sc_hist, _ = tally(rids, schedule[:done], median)
            played = [p for v in sc_hist.values() for p in v]
            factor = (statistics.mean(played) / statistics.mean(raw.values())) if played and raw else 1.0
            roster_now = {r: v * factor for r, v in raw.items()}
            for r, o in outlook.items():
                o["scaled"] = round(o["mean"] * factor, 2)
            print(f"Roster outlook for {len(roster_now)} teams over weeks {outlook[next(iter(outlook))]['weeks']} (scale {factor:.3f})")
    except Exception as exc:  # noqa: BLE001 - odds fall back to results only
        print(f"Roster outlook skipped: {exc}")
        roster_now, outlook = None, {}

    def evaluate(n_weeks, is_current):
        st, scores, maxes = tally(rids, schedule[:n_weeks], median)
        if is_current:
            for r in rids:
                t = teams[r]
                st[r].update(wins=t["wins"], losses=t["losses"], ties=t["ties"],
                             pf=t["pf"], pa=t["pa"], max_pf=t["max_pf"])
        model, max_model, _ = with_roster(scores, maxes, rids, roster_now if is_current else None)
        remaining = [wk["games"] for wk in schedule[n_weeks:]]
        week_label = schedule[n_weeks - 1]["week"] if n_weeks else 0
        rng = random.Random(f"{LEAGUE_ID}-{season}-{week_label}")
        sims = simulate(st, remaining, model, max_model, playoff_teams,
                        actual if is_current else {},
                        SIMULATIONS if is_current else HISTORY_SIMULATIONS, rng, median)
        ranked = sorted(rids, key=standing_key(st), reverse=True)
        order, rounds = projected_draft_order(rids, st, ranked, model, playoff_teams, actual if is_current else {})
        return st, model, ranked, sims, len(remaining), order, rounds

    # Week-by-week history
    series = {r: {k: [] for k in ("rank", "wins", "points_for", "max_pf", "playoff_odds",
                                  "champion_odds", "avg_pick", "first_pick_odds", "draft_slot")} for r in rids}
    history_weeks = []
    for n in range(1, done + 1):
        st, _, ranked, sims, _, order, _ = evaluate(n, is_current=(n == done))
        slot_of = {r: i for i, r in enumerate(order, start=1)}
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
            s["draft_slot"].append(slot_of[r])

    # Current state (same as the last history point, or preseason if no games yet)
    st, model, ranked, sims, remaining_games, draft_order, bracket_rounds = evaluate(done, is_current=True)

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
            "roster_ppg": outlook[r]["scaled"] if r in outlook and "scaled" in outlook[r] else None,
        })

    seeds_now = {i + 1: ranked[i] for i in range(playoff_teams)}
    seed_of = {rid: seed for seed, rid in seeds_now.items()}

    bracket = describe_bracket(bracket_rounds, playoff_teams, teams, seed_of, model, actual)

    projected = [
        {
            "slot": slot,
            "roster_id": r,
            "team": teams[r]["team"],
            "owner": teams[r]["owner"],
            "max_pf": round(st[r]["max_pf"], 2),
            "in_playoffs": r in seed_of,
            "playoff_odds": round(sims[r]["playoff_odds"] * 100, 1),
            "first_pick_odds": round(sims[r]["first_pick_odds"] * 100, 1),
            "avg_pick": round(sims[r]["avg_pick"], 2),
            "most_likely_pick": sims[r]["most_likely_pick"],
        }
        for slot, r in enumerate(draft_order, start=1)
    ]

    _, scores_now, maxes_now = tally(rids, schedule[:done], median)
    _, max_model_now, _ = with_roster(scores_now, maxes_now, rids, roster_now)
    sim_inputs = {
        "remaining": [[list(g) for g in wk["games"]] for wk in schedule[done:]],
        "base": {str(r): {"wins": st[r]["wins"] + 0.5 * st[r]["ties"], "pf": round(st[r]["pf"], 2),
                          "max_pf": round(st[r]["max_pf"], 2)} for r in rids},
        "model": {str(r): [round(x, 3) for x in model[r]] for r in rids},
        "max_model": {str(r): [round(x, 3) for x in max_model_now[r]] for r in rids},
        "playoff_teams": playoff_teams,
        "median": median,
        "actual": [[min(k), max(k), w] for k, w in actual.items()],
        # Share of each team's strength that comes from its roster outlook; the
        # trade calculator scales a trade's lineup change by this so its
        # "after" odds match what the daily odds will do once the trade happens.
        "roster_share": round(ROSTER_WEEKS / (done + ROSTER_WEEKS + ROSTER_PRIOR), 3) if roster_now else 1.0,
    }

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
            "start_week": start_week,
            "playoff_week_start": playoff_start,
            "last_week": last_week,
            "season_start": state.get("season_start_date") if str(state.get("season")) == season else None,
            "nfl_week": state.get("week"),
            "slots": [x for x in (league.get("roster_positions") or []) if x not in ("BN", "IR", "TAXI")],
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
        "outlook": {
            "method": ("Odds blend each team's results with its roster outlook: projected points per week "
                       "from here for the players on the roster today, scored with league settings, with injured "
                       "players' chances of playing and waiver-level replacements filling holes. "
                       f"Results count one share per week played, the roster outlook {ROSTER_WEEKS} shares."),
            "roster_weeks": ROSTER_WEEKS,
            "results_weight": round(done / (done + ROSTER_WEEKS + ROSTER_PRIOR), 3) if roster_now else 1.0,
            "teams": {str(r): {**o, "results_ppg": round(statistics.mean(scores_now[r]), 2) if scores_now.get(r) else None,
                                "blended_ppg": round(model[r][0], 2)}
                      for r, o in outlook.items() if r in teams},
        },
        "sim": sim_inputs,
        "transactions": transactions[:80],
        "diagnostics": {"max_pf_check": diagnostics},
    }

    lite_ids = set()
    for wk in schedule:
        for pts in wk["player_pts"].values():
            lite_ids.update(pts.keys())
    for t in teams.values():
        lite_ids.update(t["players"])
    for tx in transactions:
        lite_ids.update(tx["adds"].keys())
        lite_ids.update(tx["drops"].keys())
    lite = {}
    for pid in lite_ids:
        c = player_card(pid, players)
        lite[pid] = [c["name"], c["pos"], c["nfl"]]
    (DATA_DIR / "players_lite.json").write_text(json.dumps(lite, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    payload = json.dumps(snapshot, indent=2, ensure_ascii=False)
    (DATA_DIR / "history").mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "latest.json").write_text(payload + "\n", encoding="utf-8")
    (DATA_DIR / "history" / f"{now:%Y-%m-%d}.json").write_text(payload + "\n", encoding="utf-8")
    prune_snapshots(DATA_DIR / "history", now.date())

    # Weekly recap: bench regret, all-play, luck, awards.
    try:
        start_slots = [x for x in (league.get("roster_positions") or []) if x in SLOT_ELIGIBILITY]
        def name_of(pid):
            c = player_card(pid, players)
            return [c["name"], c["pos"], c["nfl"]]
        recap = build_recap(schedule, done, teams, positions, start_slots, season, name_of)
        write_recap(DATA_DIR, recap, snapshot["generated_at"])
        print(f"Wrote recap for {len(recap['weeks'])} weeks")
    except Exception as exc:  # noqa: BLE001 - the recap must never block standings
        print(f"Recap skipped: {exc}")
    print(f"Wrote {len(standings)} teams, {done} weeks of history, {remaining_games} weeks left, to {DATA_DIR}")
    for d in diagnostics:
        print(f"  max PF check roster {d['roster_id']}: computed {d['computed']} vs Sleeper {d['official']}")


if __name__ == "__main__":
    main()
