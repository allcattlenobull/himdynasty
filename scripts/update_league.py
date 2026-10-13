#!/usr/bin/env python3
"""Fetch HIM Dynasty data from Sleeper and write standings, draft order, and playoff odds.

Output (relative to the repo root):
  docs/data/latest.json              the most recent snapshot, read by the website
  docs/data/history/YYYY-MM-DD.json  one snapshot per day

Uses only the Python standard library.
"""

import datetime as dt
import json
import os
import random
import statistics
import urllib.request
from pathlib import Path

API = "https://api.sleeper.app/v1"
LEAGUE_ID = os.environ.get("SLEEPER_LEAGUE_ID", "1312005038838673409")
SIMULATIONS = int(os.environ.get("SIMULATIONS", "10000"))
DEFAULT_SD = 15.0  # fallback weekly score standard deviation when history is thin

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "docs" / "data"


def get(path):
    req = urllib.request.Request(f"{API}{path}", headers={"User-Agent": "him-dynasty-updater"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def points_for(roster):
    s = roster.get("settings") or {}
    return s.get("fpts", 0) + s.get("fpts_decimal", 0) / 100.0


def points_against(roster):
    s = roster.get("settings") or {}
    return s.get("fpts_against", 0) + s.get("fpts_against_decimal", 0) / 100.0


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
            "points_for": round(points_for(r), 2),
            "points_against": round(points_against(r), 2),
        }
    return teams


def read_schedule(last_regular_week):
    """Return (scores_by_roster, remaining_games) from the regular-season matchups."""
    played_scores = {}
    remaining = []
    for week in range(1, last_regular_week + 1):
        matchups = get(f"/league/{LEAGUE_ID}/matchups/{week}") or []
        by_matchup = {}
        for m in matchups:
            mid = m.get("matchup_id")
            if mid is None:
                continue  # bye week: no opponent
            by_matchup.setdefault(mid, []).append(m)

        for pair in by_matchup.values():
            if len(pair) != 2:
                continue
            a, b = pair
            if (a.get("points") or 0) > 0 and (b.get("points") or 0) > 0:
                for side in pair:
                    played_scores.setdefault(side["roster_id"], []).append(side["points"])
            else:
                remaining.append((a["roster_id"], b["roster_id"]))
    return played_scores, remaining


def score_model(played_scores, roster_ids):
    """Per-team (mean, standard deviation) of weekly points, with fallbacks."""
    all_scores = [p for pts in played_scores.values() for p in pts]
    league_mean = statistics.mean(all_scores) if all_scores else 100.0

    model = {}
    for rid in roster_ids:
        pts = played_scores.get(rid, [])
        if len(pts) >= 2:
            model[rid] = (statistics.mean(pts), statistics.stdev(pts) or DEFAULT_SD)
        elif pts:
            model[rid] = (pts[0], DEFAULT_SD)
        else:
            model[rid] = (league_mean, DEFAULT_SD)
    return model


def simulate(teams, remaining, model, playoff_teams):
    """Monte Carlo the rest of the regular season.

    Returns playoff probability and average projected wins for each roster.
    """
    rids = list(teams)
    playoff_hits = {rid: 0 for rid in rids}
    win_total = {rid: 0.0 for rid in rids}
    rng = random.Random()

    for _ in range(SIMULATIONS):
        wins = {rid: teams[rid]["wins"] for rid in rids}
        pf = {rid: teams[rid]["points_for"] for rid in rids}

        for a, b in remaining:
            mu_a, sd_a = model[a]
            mu_b, sd_b = model[b]
            score_a = max(0.0, rng.gauss(mu_a, sd_a))
            score_b = max(0.0, rng.gauss(mu_b, sd_b))
            pf[a] += score_a
            pf[b] += score_b
            if score_a > score_b:
                wins[a] += 1
            elif score_b > score_a:
                wins[b] += 1

        ranked = sorted(rids, key=lambda r: (wins[r], pf[r]), reverse=True)
        for rid in ranked[:playoff_teams]:
            playoff_hits[rid] += 1
        for rid in rids:
            win_total[rid] += wins[rid]

    return (
        {rid: playoff_hits[rid] / SIMULATIONS for rid in rids},
        {rid: win_total[rid] / SIMULATIONS for rid in rids},
    )


def build_standings(teams, odds, avg_wins):
    rows = sorted(
        teams.values(),
        key=lambda t: (t["wins"], t["points_for"]),
        reverse=True,
    )
    standings = []
    for rank, t in enumerate(rows, start=1):
        rid = t["roster_id"]
        standings.append({
            "rank": rank,
            "team": t["team"],
            "owner": t["owner"],
            "wins": t["wins"],
            "losses": t["losses"],
            "ties": t["ties"],
            "points_for": t["points_for"],
            "points_against": t["points_against"],
            "playoff_odds": round(odds[rid] * 100, 1),
            "projected_wins": round(avg_wins[rid], 1),
        })
    return standings


def build_draft(league, drafts, teams, standings):
    season = str(league.get("season"))
    owner_to_team = {t["owner_id"]: t["team"] for t in teams.values()}
    owner_to_name = {t["owner_id"]: t["owner"] for t in teams.values()}

    # Official slot order from the most recent draft for this season, if one has been set.
    official = None
    current = next((d for d in drafts if str(d.get("season")) == season), None)
    if current and current.get("draft_order"):
        official = sorted(
            (
                {
                    "slot": slot,
                    "team": owner_to_team.get(uid, "Unknown"),
                    "owner": owner_to_name.get(uid, "Unknown"),
                }
                for uid, slot in current["draft_order"].items()
            ),
            key=lambda row: row["slot"],
        )

    # Projection for the next draft: worst record picks first.
    projected = [
        {"slot": i, "team": row["team"], "owner": row["owner"]}
        for i, row in enumerate(reversed(standings), start=1)
    ]

    return {"official_order": official, "projected_order": projected}


def main():
    league = get(f"/league/{LEAGUE_ID}")
    users = {u["user_id"]: u for u in get(f"/league/{LEAGUE_ID}/users")}
    rosters = get(f"/league/{LEAGUE_ID}/rosters")
    drafts = get(f"/league/{LEAGUE_ID}/drafts")

    settings = league.get("settings") or {}
    playoff_teams = settings.get("playoff_teams", 6)
    last_regular_week = settings.get("playoff_week_start", 15) - 1

    teams = build_teams(rosters, users)
    played_scores, remaining = read_schedule(last_regular_week)
    model = score_model(played_scores, teams.keys())
    odds, avg_wins = simulate(teams, remaining, model, playoff_teams)
    standings = build_standings(teams, odds, avg_wins)
    draft = build_draft(league, drafts, teams, standings)

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
        "draft": draft,
    }

    payload = json.dumps(snapshot, indent=2)
    (DATA_DIR / "history").mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "latest.json").write_text(payload + "\n")
    (DATA_DIR / "history" / f"{now:%Y-%m-%d}.json").write_text(payload + "\n")
    print(f"Wrote {len(standings)} teams, {len(remaining)} games left, to {DATA_DIR}")


if __name__ == "__main__":
    main()
