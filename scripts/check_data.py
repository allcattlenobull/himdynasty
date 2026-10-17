#!/usr/bin/env python3
"""Check every data file before the daily update commits it.

Each file in docs/data is parsed and checked for the fields the site reads.
A file that fails is put back to its last committed version (git), so one bad
API response can't break a page; the site keeps showing yesterday's data for
that part. Problems are written to $CHECK_OUT (JSON) for status.json, and the
script exits 1 so the run is flagged.

Run locally:  python scripts/check_data.py            (check and restore)
              python scripts/check_data.py --dry-run  (check only)
"""

import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"


class Bad(Exception):
    pass


def need(cond, msg):
    if not cond:
        raise Bad(msg)


def keys(d, *names):
    need(isinstance(d, dict), "not an object")
    missing = [k for k in names if k not in d]
    need(not missing, f"missing {', '.join(missing)}")


def is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and x == x


def fresh(d, field="generated_at", days=8):
    """generated_at must parse and not be in the future or very old."""
    try:
        t = dt.datetime.fromisoformat(str(d[field]).replace("Z", "+00:00"))
    except Exception as exc:  # noqa: BLE001
        raise Bad(f"bad {field}") from exc
    now = dt.datetime.now(dt.timezone.utc)
    if t.tzinfo is None:
        t = t.replace(tzinfo=dt.timezone.utc)
    need(t <= now + dt.timedelta(hours=1), f"{field} is in the future")
    need(now - t <= dt.timedelta(days=days), f"{field} is {(now - t).days} days old")


# --------------------------------------------------------------------------- #
# One check per file. Each raises Bad with a short reason.
# --------------------------------------------------------------------------- #
def latest(d):
    keys(d, "generated_at", "league", "standings", "playoffs", "draft", "history", "teams", "sim")
    fresh(d, days=3)
    keys(d["league"], "id", "season", "playoff_teams", "weeks_completed", "slots")
    st = d["standings"]
    need(isinstance(st, list) and len(st) >= 4, "standings missing or too short")
    for r in st:
        keys(r, "rank", "roster_id", "team", "wins", "losses", "points_for", "max_pf", "playoff_odds", "champion_odds")
        need(all(is_num(r[k]) for k in ("wins", "losses", "points_for", "max_pf", "playoff_odds")), f"bad numbers for {r.get('team')}")
        need(0 <= r["playoff_odds"] <= 100, "playoff odds out of range")
    need(sorted(r["rank"] for r in st) == list(range(1, len(st) + 1)), "ranks are not 1..N")
    need(len(d["teams"]) == len(st), "team pages don't match standings")
    need(len(d["draft"].get("projected_order", [])) == len(st), "draft order doesn't match standings")
    need(isinstance(d["playoffs"].get("seeds"), list), "no playoff seeds")
    for rid, t in d["teams"].items():
        keys(t, "team", "record", "roster", "schedule")
    odds = sum(r["champion_odds"] for r in st)
    need(odds == 0 or 90 <= odds <= 110, f"title odds add up to {odds:.0f}%")


def recap_index(d):
    keys(d, "generated_at", "current", "seasons", "weeks_completed")
    fresh(d, days=3)
    need(d["current"] in d["seasons"], "current season has no recap file")
    season = load(DATA / "recaps" / f"{d['current']}.json")
    keys(season, "season", "teams", "weeks", "season_totals", "players")
    need(len(season["weeks"]) == d["weeks_completed"] or not season["weeks"], "week count mismatch")
    for w in season["weeks"]:
        keys(w, "week", "games", "teams", "awards")
        need(all(is_num(t["pts"]) and is_num(t["max"]) and t["max"] + 0.01 >= t["pts"] for t in w["teams"].values()),
             f"week {w['week']}: best lineup below actual score")
    if season["weeks"]:
        need(len(season["season_totals"]) == len(season["teams"]), "season totals missing teams")


def trade(d):
    keys(d, "generated_at", "format", "assets", "teams", "source")
    fresh(d)
    need(len(d["assets"]) >= 100, f"only {len(d['assets'])} assets")
    need(all(is_num(a.get("value")) for a in d["assets"]), "asset without a value")
    need(len(d["teams"]) >= 4, "teams missing")


def mock(d):
    keys(d, "generated_at", "picks", "board", "draft_year")
    fresh(d)
    need(len(d["board"]) >= 20, "big board too short")
    need(len(d["picks"]) >= 12, "too few mock picks")
    for p in d["picks"]:
        keys(p, "label", "owner", "prospect")


def startsit(d):
    keys(d, "generated_at", "season", "week", "players", "teams", "defenses")
    fresh(d)
    need(isinstance(d["teams"], dict) and len(d["teams"]) >= 4, "teams missing")


def splits(d):
    keys(d, "generated_at", "players")
    fresh(d)


def analytics(d):
    keys(d, "generated_at", "season", "players")
    fresh(d)
    need(isinstance(d["players"], list) and len(d["players"]) >= 50, "too few players")


def analysis(d):
    keys(d, "generated_at", "teams")
    fresh(d)
    need(len(d["teams"]) >= 4, "teams missing")


def news(d):
    keys(d, "generated_at", "items")
    fresh(d)
    need(isinstance(d["items"], list), "items is not a list")


def highlights(d):
    keys(d, "players")
    need(isinstance(d["players"], dict), "players is not an object")


def history(d):
    keys(d, "generated_at", "seasons", "managers", "records", "trades")
    fresh(d)
    need(len(d["seasons"]) >= 1 and len(d["managers"]) >= 4, "seasons or managers missing")
    finished = [s for s in d["seasons"] if s.get("complete")]
    for s in finished:
        need(len(s.get("rosters") or {}) >= 4, f"{s.get('season')} roster snapshots missing")
    active = [m for m in d["managers"].values() if m.get("current_rid") is not None]
    need(any((m.get("tendencies") or {}).get("deals", 0) >= 1 for m in active), "manager trade tendencies missing")


def league_ids(d):
    keys(d, "current", "seasons")
    need(str(d["current"]).isdigit(), "current league id is not a number")


def players_lite(d):
    need(isinstance(d, dict) and len(d) >= 100, "too few players")


CHECKS = {
    "latest.json": latest,
    "recap.json": recap_index,
    "trade.json": trade,
    "mock_draft.json": mock,
    "startsit.json": startsit,
    "splits.json": splits,
    "analytics.json": analytics,
    "analysis.json": analysis,
    "news.json": news,
    "highlights.json": highlights,
    "history.json": history,
    "league_ids.json": league_ids,
    "players_lite.json": players_lite,
}
# Files that travel with a checked file and are restored together with it.
COMPANIONS = {
    "latest.json": ["players_lite.json"],
    "recap.json": ["recaps"],
}


def load(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise Bad("file missing") from exc
    except json.JSONDecodeError as exc:
        raise Bad(f"not valid JSON ({exc.msg}, line {exc.lineno})") from exc


def restore(rel):
    """Put a path back to its last committed version. True if it worked."""
    path = f"docs/data/{rel}"
    tracked = subprocess.run(["git", "ls-files", "--error-unmatch", path], cwd=ROOT,
                             capture_output=True).returncode == 0
    if not tracked:
        return False
    return subprocess.run(["git", "checkout", "HEAD", "--", path], cwd=ROOT,
                          capture_output=True).returncode == 0


def main():
    dry = "--dry-run" in sys.argv
    problems = []
    for name, check in CHECKS.items():
        path = DATA / name
        if not path.exists() and name not in ("latest.json", "league_ids.json"):
            continue  # optional parts that haven't been built yet
        try:
            check(load(path))
            print(f"ok    {name}")
        except Bad as exc:
            reason = str(exc)
            restored = False
            if not dry:
                restored = restore(name)
                for extra in COMPANIONS.get(name, []):
                    restore(extra)
            problems.append({"file": name, "reason": reason, "restored": restored})
            print(f"FAIL  {name}: {reason}" + (" (restored last good copy)" if restored else ""))
    out = os.environ.get("CHECK_OUT")
    if out:
        Path(out).write_text(json.dumps(problems) + "\n")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
