#!/usr/bin/env python3
"""Dynasty trade values for HIM Dynasty, for the trade tools and team pages.

Values come from DynastyProcess (https://github.com/dynastyprocess/data), an
open dataset of dynasty values updated weekly, with separate 1-QB and
superflex columns. This league's format decides which column is used.

Every pick the league can trade gets its own value:
  * Next year's picks use the team's projected draft slot (Early 1-4, Mid 5-8,
    Late 9-12, interpolated), blended 60/40 with the generic value for that
    round because the final slot is not settled yet.
  * Later years use the generic value for that round; years past what the
    data covers are discounted 15% per year.

Writes docs/data/trade.json. Runs after update_league.py (reads latest.json).
"""

import csv
import datetime as dt
import io
import json
import os
import re
import statistics
import time
import urllib.request
from pathlib import Path

LEAGUE_ID = os.environ.get("SLEEPER_LEAGUE_ID", "1312005038838673409")
REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "docs" / "data"
DP = "https://raw.githubusercontent.com/dynastyprocess/data/master/files"
SLEEPER = "https://api.sleeper.app/v1"
FUTURE_YEARS = 3
ROUND_NAMES = {1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th"}


def fetch(url, as_json=True, retries=3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "him-dynasty-trade-values"})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read().decode("utf-8", "replace")
            return json.loads(body) if as_json else body
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (attempt + 1))
    raise last


def norm(name):
    s = re.sub(r"[^a-z ]", "", (name or "").lower().replace("-", " ").replace(".", ""))
    return " ".join(w for w in s.split() if w not in ("jr", "sr", "ii", "iii", "iv", "v"))


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def interpolate(points, x):
    """Piecewise-linear through (x, y) points, clamped to the end slopes."""
    pts = sorted(points)
    if x <= pts[0][0]:
        (x0, y0), (x1, y1) = pts[0], pts[1]
    elif x >= pts[-1][0]:
        (x0, y0), (x1, y1) = pts[-2], pts[-1]
    else:
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            if x0 <= x <= x1:
                break
    y = y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return max(y, min(y0, y1) * 0.5)


def main():
    latest = json.loads((DATA_DIR / "latest.json").read_text())
    league = fetch(f"{SLEEPER}/league/{LEAGUE_ID}")
    traded = fetch(f"{SLEEPER}/league/{LEAGUE_ID}/traded_picks") or []

    positions = league.get("roster_positions") or []
    settings = league.get("settings") or {}
    superflex = "SUPER_FLEX" in positions or positions.count("QB") > 1
    col = "value_2qb" if superflex else "value_1qb"
    rounds = settings.get("draft_rounds") or 3
    season = int(league.get("season"))
    first_year = season + 1 if league.get("status") in ("in_season", "post_season", "complete") else season

    # ---- DynastyProcess values ----
    values_csv = list(csv.DictReader(io.StringIO(fetch(f"{DP}/values.csv", as_json=False))))
    ids_csv = list(csv.DictReader(io.StringIO(fetch(f"{DP}/db_playerids.csv", as_json=False))))
    fp_to_sleeper = {r["fantasypros_id"]: r["sleeper_id"] for r in ids_csv
                     if r.get("sleeper_id") not in (None, "", "NA") and r.get("fantasypros_id") not in (None, "", "NA")}
    scrape_date = next((r["scrape_date"] for r in values_csv if r.get("scrape_date")), None)

    dp_players, dp_by_name, pick_values = {}, {}, {}
    for r in values_csv:
        v = num(r.get(col)) or 0.0
        if r["pos"] == "PICK":
            pick_values[r["player"]] = v
            continue
        row = {"name": r["player"], "pos": r["pos"], "nfl": r["team"], "age": num(r["age"]), "value": v}
        sid = fp_to_sleeper.get(r.get("fp_id"))
        if sid:
            dp_players[sid] = row
        dp_by_name.setdefault(norm(r["player"]), row)

    # ---- Pick values ----
    def generic_pick(year, rnd):
        name = f"{year} {ROUND_NAMES.get(rnd, str(rnd))}"
        if name in pick_values:
            return pick_values[name]
        # Discount from the latest year the data covers.
        for back in range(1, 4):
            older = f"{year - back} {ROUND_NAMES.get(rnd, str(rnd))}"
            if older in pick_values:
                return pick_values[older] * (0.85 ** back)
        return 0.0

    def slot_pick(year, rnd, slot, teams_n):
        tiers = [(f"{year} Early {ROUND_NAMES[rnd]}", teams_n * 0.21), (f"{year} Mid {ROUND_NAMES[rnd]}", teams_n * 0.54),
                 (f"{year} Late {ROUND_NAMES[rnd]}", teams_n * 0.875)]
        pts = [(x, pick_values[n]) for n, x in tiers if n in pick_values]
        generic = generic_pick(year, rnd)
        if len(pts) < 2:
            return generic
        return 0.6 * interpolate(pts, slot) + 0.4 * generic

    # ---- Teams and rosters (from latest.json) ----
    teams = {int(k): v for k, v in (latest.get("teams") or {}).items()}
    order = latest["draft"]["projected_order"]
    slot_of = {row["roster_id"]: row["slot"] for row in order}
    teams_n = len(order)
    odds = {row["roster_id"]: row["playoff_odds"] for row in latest["standings"]}

    assets = []
    owner_assets = {rid: [] for rid in teams}
    rostered = set()
    for rid, t in teams.items():
        r = t["roster"]
        sections = ([("starter", s["player"]) for s in r["starters"] if s.get("player")]
                    + [("bench", p) for p in r["bench"]] + [("taxi", p) for p in r["taxi"]] + [("ir", p) for p in r["ir"]])
        for section, p in sections:
            dp = dp_players.get(p["id"]) or dp_by_name.get(norm(p["name"]))
            value = dp["value"] if dp and dp["pos"] == p["pos"] else (dp["value"] if dp else 0.0)
            a = {"id": f"p{p['id']}", "kind": "player", "name": p["name"], "pos": p["pos"], "nfl": p["nfl"],
                 "age": p.get("age") or (dp or {}).get("age"), "value": round(value), "owner": rid, "section": section}
            assets.append(a)
            owner_assets[rid].append(a)
            rostered.add(p["id"])

    # Every pick in the tradable window, then apply trades.
    pick_owner = {}
    for year in range(first_year, first_year + FUTURE_YEARS):
        for rnd in range(1, rounds + 1):
            for rid in teams:
                pick_owner[(year, rnd, rid)] = rid
    for p in traded:
        key = (int(p["season"]), p["round"], p["roster_id"])
        if key in pick_owner:
            pick_owner[key] = p["owner_id"]
    for (year, rnd, original), owner in sorted(pick_owner.items()):
        if year == first_year and original in slot_of:
            slot = slot_of[original]
            value = slot_pick(year, rnd, slot, teams_n)
            label = f"{year} {rnd}.{slot:02d}"
        else:
            slot = None
            value = generic_pick(year, rnd)
            label = f"{year} Round {rnd}"
        a = {"id": f"k{year}-{rnd}-{original}", "kind": "pick", "name": label, "pos": "PICK", "season": year,
             "round": rnd, "slot": slot, "original": original, "original_team": teams[original]["team"],
             "value": round(value), "owner": owner}
        assets.append(a)
        owner_assets.setdefault(owner, []).append(a)

    # Free agents and players outside the league, for the open calculator.
    for sid, d in dp_players.items():
        if sid not in rostered:
            assets.append({"id": f"p{sid}", "kind": "player", "name": d["name"], "pos": d["pos"], "nfl": d["nfl"],
                           "age": d["age"], "value": round(d["value"]), "owner": None, "section": None})
    for name, v in pick_values.items():
        year = int(name[:4]) if name[:4].isdigit() else 0
        if year >= first_year:
            assets.append({"id": "g" + norm(name).replace(" ", "-"), "kind": "pick", "name": name, "pos": "PICK",
                           "season": year, "value": round(v), "owner": None, "generic": True})

    # ---- Team summaries ----
    summaries = {}
    totals = {}
    for rid, t in teams.items():
        mine = owner_assets.get(rid, [])
        players = [a for a in mine if a["kind"] == "player"]
        picks = [a for a in mine if a["kind"] == "pick"]
        aged = [a for a in players if a.get("age")]
        valued = [a for a in aged if a["value"] > 0]
        po = odds.get(rid, 0)
        mode = "contender" if po >= 55 else "rebuilder" if po <= 25 else "middle"
        totals[rid] = sum(a["value"] for a in mine)
        summaries[str(rid)] = {
            "team": t["team"],
            "owner": t["owner"],
            "mode": mode,
            "playoff_odds": po,
            "avg_age": round(statistics.mean(a["age"] for a in aged), 1) if aged else None,
            "value_age": round(sum(a["age"] * a["value"] for a in valued) / sum(a["value"] for a in valued), 1) if valued else None,
            "players_value": sum(a["value"] for a in players),
            "picks_value": sum(a["value"] for a in picks),
            "total_value": totals[rid],
            "picks": [a["id"] for a in sorted(picks, key=lambda a: (a["season"], a["round"], a.get("slot") or 99))],
        }
    for i, rid in enumerate(sorted(totals, key=totals.get, reverse=True), start=1):
        summaries[str(rid)]["value_rank"] = i
    ages = sorted((s["avg_age"], rid) for rid, s in summaries.items() if s["avg_age"])
    for i, (_, rid) in enumerate(ages, start=1):
        summaries[rid]["age_rank"] = i  # 1 = youngest

    starters = [p for p in positions if p not in ("BN", "IR", "TAXI")]
    out = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "source": {"name": "DynastyProcess", "url": "https://github.com/dynastyprocess/data",
                   "scrape_date": scrape_date, "column": col},
        "format": {
            "superflex": superflex,
            "starters": {s: starters.count(s) for s in sorted(set(starters))},
            "bench": positions.count("BN"),
            "taxi": settings.get("taxi_slots") or 0,
            "ir": settings.get("reserve_slots") or 0,
            "roster_size": len(positions),
            "draft_rounds": rounds,
            "pick_years": [first_year + i for i in range(FUTURE_YEARS)],
        },
        "assets": assets,
        "teams": summaries,
    }
    (DATA_DIR / "trade.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(assets)} assets ({sum(1 for a in assets if a['owner'])} in the league), values as of {scrape_date}.")


if __name__ == "__main__":
    main()
