#!/usr/bin/env python3
"""Follow the league into its next season.

Each morning: look at the current league's managers' Sleeper leagues for the
next season and find the one whose previous_league_id is the current league.
When the commissioner renews the league, that new id becomes current and the
whole site moves to the new season on its own. The old season stays in
docs/data/archive (see history.py).
"""

import datetime as dt
import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from league_pointer import POINTER, current_league_id  # noqa: E402

SLEEPER = "https://api.sleeper.app/v1"


def get(path):
    req = urllib.request.Request(SLEEPER + path, headers={"User-Agent": "him-dynasty-rollover"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def main():
    try:
        data = json.loads(POINTER.read_text())
    except (FileNotFoundError, ValueError):
        data = {}
    cur = current_league_id()
    league = get(f"/league/{cur}")
    season = int(league["season"])
    seasons = data.get("seasons") or {}
    seasons[str(season)] = cur
    # Fill in earlier seasons from the chain once.
    prev, guard = league.get("previous_league_id"), 0
    while prev and prev != "0" and prev not in seasons.values() and guard < 20:
        p = get(f"/league/{prev}")
        seasons[str(p["season"])] = prev
        prev, guard = p.get("previous_league_id"), guard + 1
    renewed = None
    users = get(f"/league/{cur}/users") or []
    users.sort(key=lambda u: not (u.get("is_owner")))  # commissioner first
    for u in users[:4]:
        try:
            leagues = get(f"/user/{u['user_id']}/leagues/nfl/{season + 1}") or []
        except Exception:  # noqa: BLE001
            continue
        renewed = next((l for l in leagues if str(l.get("previous_league_id")) == str(cur)), None)
        if renewed:
            break
    if renewed:
        new = renewed["league_id"]
        seasons[str(season + 1)] = new
        print(f"[rollover] League renewed for {season + 1}: {cur} -> {new}")
        cur = new
    else:
        print(f"[rollover] {season} league {cur} is still current.")
    out = {"current": cur, "seasons": dict(sorted(seasons.items())),
           "checked": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
    POINTER.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
