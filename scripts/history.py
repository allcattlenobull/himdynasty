#!/usr/bin/env python3
"""League history for HIM Dynasty: every season since the 2024 startup.

Walks Sleeper's previous_league_id chain from the current league and builds:
  * docs/data/archive/<season>.json for each season: managers, regular-season
    standings, every game, the playoff bracket and final places, drafts, and
    trades. Finished seasons are written once and then reused.
  * docs/data/history.json: champions, the record book, all-time head-to-head,
    manager careers (keyed by Sleeper user id, so renamed teams stay one
    manager), every rookie draft re-graded with today's values, and a trade
    archive scored by what each side has produced and is worth now.

Sources: Sleeper (league, users, rosters, matchups, brackets, drafts,
transactions, players), DynastyProcess values (1-QB), docs/data/trade.json
for future pick values. Set HISTORY_LOCAL to a folder of saved Sleeper
responses to run offline.
"""

import csv
import datetime as dt
import gzip
import io
import json
import os
import statistics
import sys
import time
import unicodedata
import re
import urllib.request
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from league_pointer import current_league_id  # noqa: E402

DATA_DIR = Path(__file__).resolve().parent.parent / "docs" / "data"
ARCHIVE_DIR = DATA_DIR / "archive"
SLEEPER = "https://api.sleeper.app/v1"
DP = "https://raw.githubusercontent.com/dynastyprocess/data/master/files"
LOCAL = os.environ.get("HISTORY_LOCAL")
ARCHIVE_VERSION = 5
PACKAGE_WEIGHTS = [1, 0.78, 0.62, 0.52, 0.45, 0.4, 0.36]


def log(msg):
    print(f"[history] {msg}", flush=True)


def fetch_raw(url, retries=3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "him-dynasty-history"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (attempt + 1))
    raise last


def sleeper(path):
    if LOCAL:
        f = Path(LOCAL) / (path.strip("/").replace("/", "__") + ".json")
        if f.exists():
            data = json.loads(f.read_text())
            if isinstance(data, dict) and "__error__" in data:
                return None
            return data
    return json.loads(fetch_raw(SLEEPER + path))


def players_db():
    if LOCAL and (Path(LOCAL) / "players.json.gz").exists():
        return json.loads(gzip.decompress((Path(LOCAL) / "players.json.gz").read_bytes()))
    return json.loads(fetch_raw(f"{SLEEPER}/players/nfl"))


def norm(name):
    name = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    name = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", name)
    return re.sub(r"[^a-z]", "", name)


def num(x):
    try:
        v = float(x)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------- #
# One season
# --------------------------------------------------------------------------- #

def build_season(league_id, weeks_done_hint=None):
    lg = sleeper(f"/league/{league_id}")
    users = sleeper(f"/league/{league_id}/users") or []
    rosters = sleeper(f"/league/{league_id}/rosters") or []
    settings = lg.get("settings") or {}
    season = str(lg.get("season"))
    status = lg.get("status")
    pws = settings.get("playoff_week_start") or 15
    complete = status == "complete"
    last = settings.get("last_scored_leg") or 0
    if weeks_done_hint is not None and not complete:
        last = min(last, weeks_done_hint) if last else weeks_done_hint
    user_by = {u["user_id"]: u for u in users}
    managers = {}
    for r in rosters:
        uid = r.get("owner_id")
        u = user_by.get(uid) or {}
        managers[str(r["roster_id"])] = {
            "user": uid, "name": u.get("display_name") or f"Team {r['roster_id']}",
            "team": ((u.get("metadata") or {}).get("team_name") or u.get("display_name") or f"Team {r['roster_id']}").strip(),
            "avatar": u.get("avatar"), "max_pf": round((r.get("settings") or {}).get("ppts", 0) + (r.get("settings") or {}).get("ppts_decimal", 0) / 100, 2),
            "co": [c for c in (r.get("co_owners") or []) if c],
            # Sleeper keeps the final membership of a completed league. Preserve
            # it in the immutable season archive so History can show the actual
            # roster that ended that season, even after the live league rolls on.
            "roster": {
                "players": [str(p) for p in (r.get("players") or []) if p and str(p) != "0"],
                "starters": [str(p) for p in (r.get("starters") or []) if p and str(p) != "0"],
                "taxi": [str(p) for p in (r.get("taxi") or []) if p and str(p) != "0"],
                "reserve": [str(p) for p in (r.get("reserve") or []) if p and str(p) != "0"],
            },
        }

    # Every week's scores
    weeks = {}
    started = []  # (rid, week, pid, pts) for players in the starting lineup
    for w in range(1, (last or 0) + 1):
        rows = sleeper(f"/league/{league_id}/matchups/{w}") or []
        weeks[w] = rows
        for m in rows:
            for pid, pts in zip(m.get("starters") or [], m.get("starters_points") or []):
                if pid and pid != "0":
                    started.append([m["roster_id"], w, pid, round(pts or 0, 2)])

    games = []
    for w, rows in weeks.items():
        if w >= pws:
            continue
        by = defaultdict(list)
        for m in rows:
            if m.get("matchup_id"):
                by[m["matchup_id"]].append(m)
        for pair in by.values():
            if len(pair) != 2:
                continue
            a, b = pair
            games.append({"w": w, "a": a["roster_id"], "b": b["roster_id"], "pa": round(a.get("points") or 0, 2),
                          "pb": round(b.get("points") or 0, 2), "kind": "regular"})

    # Bracket
    bracket = sleeper(f"/league/{league_id}/winners_bracket") or []
    points_of = {(w, m["roster_id"]): round(m.get("points") or 0, 2) for w, rows in weeks.items() for m in rows}
    places = {}
    playoff_teams = set()
    champion = runner_up = None
    for g in bracket:
        for k in ("t1", "t2"):
            if g.get(k):
                playoff_teams.add(g[k])
        w = pws + (g.get("r") or 1) - 1
        if g.get("t1") and g.get("t2") and (w, g["t1"]) in points_of:
            games.append({"w": w, "a": g["t1"], "b": g["t2"], "pa": points_of[(w, g["t1"])], "pb": points_of.get((w, g["t2"]), 0),
                          "kind": "final" if g.get("p") == 1 else "playoff", "round": g.get("r"), "winner": g.get("w")})
        if g.get("p") and g.get("w") and g.get("l"):
            places[g["w"]] = g["p"]
            places[g["l"]] = g["p"] + 1
            if g["p"] == 1:
                champion, runner_up = g["w"], g["l"]
    # Seeds from bracket round 1 (top seeds have byes) are not explicit, so
    # rank the regular season: wins, then points.
    rec = {int(r): {"w": 0, "l": 0, "t": 0, "pf": 0.0, "pa": 0.0} for r in managers}
    for g in games:
        if g["kind"] != "regular":
            continue
        A, B = rec[g["a"]], rec[g["b"]]
        A["pf"] += g["pa"]; A["pa"] += g["pb"]; B["pf"] += g["pb"]; B["pa"] += g["pa"]
        if g["pa"] > g["pb"]:
            A["w"] += 1; B["l"] += 1
        elif g["pb"] > g["pa"]:
            B["w"] += 1; A["l"] += 1
        else:
            A["t"] += 1; B["t"] += 1
    order = sorted(rec, key=lambda r: (-(rec[r]["w"] + 0.5 * rec[r]["t"]), -rec[r]["pf"]))
    standings = []
    for i, r in enumerate(order, start=1):
        x = rec[r]
        standings.append({"rid": r, "user": managers[str(r)]["user"], "rank": i, "w": x["w"], "l": x["l"], "t": x["t"],
                          "pf": round(x["pf"], 2), "pa": round(x["pa"], 2), "max_pf": managers[str(r)]["max_pf"],
                          "playoffs": r in playoff_teams if playoff_teams else None})
    if complete:
        non = [s for s in standings if s["rid"] not in places]
        nxt = max(places.values(), default=0) + 1
        for s in non:
            places[s["rid"]] = nxt
            nxt += 1
    for s in standings:
        s["finish"] = places.get(s["rid"]) if complete else None

    # Drafts
    drafts = []
    for d in sleeper(f"/league/{league_id}/drafts") or []:
        if d.get("status") != "complete":
            continue
        meta = sleeper(f"/draft/{d['draft_id']}") or d
        slot_to_rid = {int(k): v for k, v in ((meta.get("slot_to_roster_id") or {}).items())}
        picks = []
        for p in sleeper(f"/draft/{d['draft_id']}/picks") or []:
            md = p.get("metadata") or {}
            picks.append({"no": p.get("pick_no"), "r": p.get("round"), "slot": p.get("draft_slot"), "rid": p.get("roster_id"),
                          "user": p.get("picked_by"), "orig": slot_to_rid.get(p.get("draft_slot")),
                          "pid": p.get("player_id"), "name": f"{md.get('first_name', '')} {md.get('last_name', '')}".strip(),
                          "pos": md.get("position"), "nfl": md.get("team")})
        rounds = (d.get("settings") or {}).get("rounds") or max((p["r"] or 0 for p in picks), default=0)
        drafts.append({"id": d["draft_id"], "season": str(d.get("season") or season), "type": d.get("type"),
                       "kind": "rookie" if rounds <= 5 else "startup", "rounds": rounds, "picks": sorted(picks, key=lambda x: x["no"] or 0)})

    # Trades
    trades = []
    for w in range(0, 19):
        for t in sleeper(f"/league/{league_id}/transactions/{w}") or []:
            if t.get("type") != "trade" or t.get("status") != "complete":
                continue
            sides = {str(r): {"players": [], "picks": []} for r in t.get("roster_ids") or []}
            for pid, rid in (t.get("adds") or {}).items():
                sides.setdefault(str(rid), {"players": [], "picks": []})["players"].append(pid)
            for wb in t.get("waiver_budget") or []:
                sides.setdefault(str(wb["receiver"]), {"players": [], "picks": []}).setdefault("faab", 0)
                sides[str(wb["receiver"])]["faab"] += wb.get("amount") or 0
            for pk in t.get("draft_picks") or []:
                sides.setdefault(str(pk["owner_id"]), {"players": [], "picks": []})["picks"].append(
                    {"season": str(pk["season"]), "round": pk["round"], "orig": pk["roster_id"]})
            trades.append({"id": t["transaction_id"], "time": t.get("status_updated") or t.get("created"),
                           "week": t.get("leg") or w, "sides": sides})
    trades.sort(key=lambda t: t["time"] or 0)

    return {
        "version": ARCHIVE_VERSION, "season": season, "league_id": league_id, "name": lg.get("name"), "status": status,
        "complete": complete, "previous": lg.get("previous_league_id"),
        "settings": {"playoff_week_start": pws, "playoff_teams": settings.get("playoff_teams"), "teams": settings.get("num_teams"),
                     "weeks_scored": last},
        "managers": managers, "standings": standings, "games": games,
        "champion": champion, "runner_up": runner_up, "places": {str(k): v for k, v in places.items()},
        "drafts": drafts, "trades": trades, "started": started,
    }


# --------------------------------------------------------------------------- #
# Across seasons
# --------------------------------------------------------------------------- #

def dp_values():
    try:
        vals = list(csv.DictReader(io.StringIO(fetch_raw(f"{DP}/values.csv").decode())))
        ids = list(csv.DictReader(io.StringIO(fetch_raw(f"{DP}/db_playerids.csv").decode())))
    except Exception as e:  # noqa: BLE001
        log(f"DynastyProcess unavailable: {e}")
        return {}, {}
    fp_to_sleeper = {r["fantasypros_id"]: r["sleeper_id"] for r in ids
                     if r.get("sleeper_id") not in (None, "", "NA") and r.get("fantasypros_id") not in (None, "", "NA")}
    out, picks = {}, {}
    for r in vals:
        v = num(r.get("value_1qb")) or 0.0
        if r["pos"] == "PICK":
            picks[r["player"]] = v
            continue
        sid = fp_to_sleeper.get(r.get("fp_id"))
        if sid:
            out[sid] = v
    return out, picks


def main():
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        latest = json.loads((DATA_DIR / "latest.json").read_text())
    except FileNotFoundError:
        latest = {}
    weeks_done = (latest.get("league") or {}).get("weeks_completed")

    # Walk the chain, newest first.
    seasons = []
    lid = current_league_id()
    seen = set()
    while lid and lid not in seen and lid != "0" and len(seen) < 25:
        seen.add(lid)
        cached = None
        for f in ARCHIVE_DIR.glob("*.json"):
            try:
                d = json.loads(f.read_text())
            except ValueError:
                continue
            if d.get("league_id") == lid and d.get("complete") and d.get("version") == ARCHIVE_VERSION:
                cached = d
                break
        if cached:
            seasons.append(cached)
            log(f"{cached['season']}: using saved archive")
        else:
            s = build_season(lid, weeks_done if lid == current_league_id() else None)
            (ARCHIVE_DIR / f"{s['season']}.json").write_text(json.dumps(s, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
            seasons.append(s)
            log(f"{s['season']}: built ({len(s['games'])} games, {len(s['trades'])} trades, {len(s['drafts'])} drafts)")
        lid = seasons[-1].get("previous")
    seasons.sort(key=lambda s: s["season"])

    players = players_db()
    values, pick_market = dp_values()
    try:
        trade = json.loads((DATA_DIR / "trade.json").read_text())
    except FileNotFoundError:
        trade = {"assets": []}
    future_pick_value = {a["id"]: a["value"] for a in trade.get("assets", []) if a["kind"] == "pick"}

    def pinfo(pid):
        p = players.get(str(pid)) or {}
        name = p.get("full_name") or " ".join(x for x in (p.get("first_name"), p.get("last_name")) if x) or str(pid)
        age = num(p.get("age"))
        if age is None and p.get("birth_date"):
            try:
                born = dt.date.fromisoformat(p["birth_date"][:10])
                today = dt.date.today()
                age = round((today - born).days / 365.2425, 1)
            except (TypeError, ValueError):
                age = None
        return {"id": str(pid), "name": name, "pos": p.get("position") or ("DEF" if str(pid).isalpha() else ""),
                "nfl": p.get("team"), "age": age, "value": round(values.get(str(pid), 0))}

    # Managers by user id
    managers = {}
    current = seasons[-1]
    for s in seasons:
        for rid, m in s["managers"].items():
            uid = m["user"] or f"r{rid}"
            M = managers.setdefault(uid, {"user": uid, "seasons": {}, "name": m["name"], "avatar": m["avatar"]})
            M["seasons"][s["season"]] = {"rid": int(rid), "team": m["team"]}
            M["name"], M["avatar"] = m["name"], m["avatar"] or M["avatar"]
    uid_of = {(s["season"], int(rid)): (m["user"] or f"r{rid}") for s in seasons for rid, m in s["managers"].items()}
    for M in managers.values():
        cur = M["seasons"].get(current["season"])
        M["current_rid"] = cur["rid"] if cur else None
        M["team"] = cur["team"] if cur else list(M["seasons"].values())[-1]["team"]
        M.update({"w": 0, "l": 0, "t": 0, "pf": 0.0, "pa": 0.0, "games": 0, "titles": [], "runner_up": [], "playoffs": 0,
                  "finishes": {}, "high": 0.0, "po_w": 0, "po_l": 0})

    # Games, records, head-to-head
    all_games = []
    for s in seasons:
        for g in s["games"]:
            ua, ub = uid_of[(s["season"], g["a"])], uid_of[(s["season"], g["b"])]
            all_games.append(dict(g, season=s["season"], ua=ua, ub=ub, done=s["complete"] or g["w"] <= (weeks_done or 99)))
    all_games = [g for g in all_games if g["done"] and (g["pa"] or g["pb"])]
    h2h = {}
    for g in all_games:
        for (u, o, pf, pa) in ((g["ua"], g["ub"], g["pa"], g["pb"]), (g["ub"], g["ua"], g["pb"], g["pa"])):
            M = managers[u]
            M["high"] = max(M["high"], pf)
            if g["kind"] == "regular":
                M["games"] += 1
                M["pf"] += pf
                M["pa"] += pa
                if pf > pa: M["w"] += 1
                elif pf < pa: M["l"] += 1
                else: M["t"] += 1
            else:
                if pf > pa: M["po_w"] += 1
                elif pf < pa: M["po_l"] += 1
            key = f"{u}|{o}"
            H = h2h.setdefault(key, {"g": 0, "w": 0, "l": 0, "t": 0, "pf": 0.0, "pa": 0.0, "po": 0, "games": []})
            H["g"] += 1
            H["pf"] += pf
            H["pa"] += pa
            H["po"] += g["kind"] != "regular"
            if pf > pa: H["w"] += 1
            elif pf < pa: H["l"] += 1
            else: H["t"] += 1
            H["games"].append([g["season"], g["w"], round(pf, 2), round(pa, 2), g["kind"]])
    for H in h2h.values():
        H["pf"], H["pa"] = round(H["pf"], 2), round(H["pa"], 2)

    season_rows = []
    for s in seasons:
        for st in s["standings"]:
            u = uid_of[(s["season"], st["rid"])]
            M = managers[u]
            if s["complete"]:
                M["finishes"][s["season"]] = st["finish"]
                if st.get("playoffs"):
                    M["playoffs"] += 1
        if s["complete"] and s["champion"]:
            managers[uid_of[(s["season"], s["champion"])]]["titles"].append(s["season"])
        if s["complete"] and s["runner_up"]:
            managers[uid_of[(s["season"], s["runner_up"])]]["runner_up"].append(s["season"])
        best = s["standings"][0] if s["standings"] else None
        pts_leader = max(s["standings"], key=lambda x: x["pf"]) if s["standings"] else None
        rookie = next((d for d in s["drafts"] if d["kind"] == "rookie"), None)
        first_pick = rookie["picks"][0] if rookie and rookie["picks"] else None
        roster_snapshots = {}
        if s["complete"]:
            for rid, m in s["managers"].items():
                snap = m.get("roster") or {}
                starters = set(snap.get("starters") or [])
                taxi = set(snap.get("taxi") or [])
                reserve = set(snap.get("reserve") or [])
                ids = list(dict.fromkeys((snap.get("players") or []) + list(taxi) + list(reserve)))
                rows = []
                for pid in ids:
                    info = pinfo(pid)
                    info["section"] = "taxi" if pid in taxi else "ir" if pid in reserve else "starter" if pid in starters else "bench"
                    rows.append(info)
                order = {"starter": 0, "bench": 1, "taxi": 2, "ir": 3}
                rows.sort(key=lambda x: (order[x["section"]], x["pos"] or "ZZ", x["name"]))
                roster_snapshots[uid_of[(s["season"], int(rid))]] = rows
        season_rows.append({
            "season": s["season"], "complete": s["complete"], "name": s["name"],
            "champion": uid_of.get((s["season"], s["champion"])) if s["champion"] else None,
            "runner_up": uid_of.get((s["season"], s["runner_up"])) if s["runner_up"] else None,
            "third": next((uid_of[(s["season"], int(r))] for r, p in s["places"].items() if p == 3), None),
            "best_record": best and {"user": best["user"], "w": best["w"], "l": best["l"]},
            "points_leader": pts_leader and {"user": pts_leader["user"], "pf": pts_leader["pf"]},
            "first_pick": first_pick and dict(pinfo(first_pick["pid"]), user=first_pick["user"], season=rookie["season"]),
            "standings": [dict(x, user=uid_of[(s["season"], x["rid"])], team=s["managers"][str(x["rid"])]["team"]) for x in s["standings"]],
            "bracket": [g for g in s["games"] if g["kind"] != "regular"],
            "teams": {r: {"user": m["user"], "team": m["team"]} for r, m in s["managers"].items()},
            "rosters": roster_snapshots,
            "weeks_scored": s["settings"]["weeks_scored"], "playoff_week_start": s["settings"]["playoff_week_start"],
        })

    # Record book
    def entry(g, side):
        u, o = (g["ua"], g["ub"]) if side == "a" else (g["ub"], g["ua"])
        pf, pa = (g["pa"], g["pb"]) if side == "a" else (g["pb"], g["pa"])
        return {"user": u, "opp": o, "season": g["season"], "week": g["w"], "pf": pf, "pa": pa, "kind": g["kind"]}
    sides = [entry(g, "a") for g in all_games] + [entry(g, "b") for g in all_games]
    top = lambda lst, key, rev=True, n=5: sorted(lst, key=key, reverse=rev)[:n]  # noqa: E731
    records = [
        {"id": "high", "title": "Highest score", "unit": "pts", "rows": [dict(x, value=x["pf"]) for x in top(sides, lambda x: x["pf"])]},
        {"id": "low", "title": "Lowest score", "unit": "pts", "rows": [dict(x, value=x["pf"]) for x in top([x for x in sides if x["pf"] > 0], lambda x: x["pf"], False)]},
        {"id": "blowout", "title": "Biggest blowout", "unit": "pt margin", "rows": [dict(x, value=round(x["pf"] - x["pa"], 2)) for x in top([x for x in sides if x["pf"] > x["pa"]], lambda x: x["pf"] - x["pa"])]},
        {"id": "close", "title": "Closest game", "unit": "pt margin", "rows": [dict(x, value=round(x["pf"] - x["pa"], 2)) for x in top([x for x in sides if x["pf"] > x["pa"]], lambda x: x["pf"] - x["pa"], False)]},
        {"id": "loss", "title": "Most points in a loss", "unit": "pts", "rows": [dict(x, value=x["pf"]) for x in top([x for x in sides if x["pf"] < x["pa"]], lambda x: x["pf"])]},
        {"id": "win", "title": "Fewest points in a win", "unit": "pts", "rows": [dict(x, value=x["pf"]) for x in top([x for x in sides if x["pf"] > x["pa"]], lambda x: x["pf"], False)]},
    ]
    seasonal = [dict(st, season=r["season"]) for r in season_rows if r["complete"] for st in r["standings"]]
    if seasonal:
        records += [
            {"id": "most_pf", "title": "Most points in a season", "unit": "pts", "season_level": True,
             "rows": [dict(x, value=x["pf"]) for x in top(seasonal, lambda x: x["pf"])]},
            {"id": "fewest_pf", "title": "Fewest points in a season", "unit": "pts", "season_level": True,
             "rows": [dict(x, value=x["pf"]) for x in top(seasonal, lambda x: x["pf"], False)]},
            {"id": "best_rec", "title": "Best regular season", "unit": "wins", "season_level": True,
             "rows": [dict(x, value=x["w"]) for x in top(seasonal, lambda x: (x["w"], x["pf"]))]},
            {"id": "max_pf", "title": "Highest max PF in a season", "unit": "pts", "season_level": True,
             "rows": [dict(x, value=x["max_pf"]) for x in top(seasonal, lambda x: x["max_pf"] or 0)]},
            {"id": "snub", "title": "Best record that missed the playoffs", "unit": "wins", "season_level": True,
             "rows": [dict(x, value=x["w"]) for x in top([x for x in seasonal if x.get("playoffs") is False], lambda x: (x["w"], x["pf"]))]},
            {"id": "unlucky", "title": "Most points against in a season", "unit": "pts", "season_level": True,
             "rows": [dict(x, value=x["pa"]) for x in top(seasonal, lambda x: x["pa"])]},
        ]
    # Streaks (regular season, across seasons)
    seq = defaultdict(list)
    for g in sorted([g for g in all_games if g["kind"] == "regular"], key=lambda g: (g["season"], g["w"])):
        seq[g["ua"]].append((g["pa"] > g["pb"]) - (g["pa"] < g["pb"]))
        seq[g["ub"]].append((g["pb"] > g["pa"]) - (g["pb"] < g["pa"]))
    streaks = []
    for u, results in seq.items():
        best_w = best_l = cur_w = cur_l = 0
        for r in results:
            cur_w = cur_w + 1 if r > 0 else 0
            cur_l = cur_l + 1 if r < 0 else 0
            best_w, best_l = max(best_w, cur_w), max(best_l, cur_l)
        managers[u]["streak_w"], managers[u]["streak_l"] = best_w, best_l
        managers[u]["streak_now"] = cur_w if cur_w else -cur_l
        streaks.append((u, best_w, best_l))
    records.append({"id": "streak_w", "title": "Longest winning streak", "unit": "games",
                    "rows": [{"user": u, "value": w} for u, w, _ in sorted(streaks, key=lambda x: -x[1])[:5]]})
    records.append({"id": "streak_l", "title": "Longest losing streak", "unit": "games",
                    "rows": [{"user": u, "value": l} for u, _, l in sorted(streaks, key=lambda x: -x[2])[:5]]})

    # Started points by user, player, season, week (for trades and drafts)
    started_by = defaultdict(list)       # (user, pid) -> [(season, week, pts)]
    league_pts = defaultdict(float)      # pid -> started points anywhere in the league
    for s in seasons:
        for rid, w, pid, pts in s["started"]:
            if not s["complete"] and w > (weeks_done or 99):
                continue
            started_by[(uid_of[(s["season"], rid)], pid)].append((s["season"], w, pts))
            league_pts[pid] += pts

    # Draft re-grades (rookie drafts)
    drafts_out = []
    draft_by_season = {}
    for s in seasons:
        for d in s["drafts"]:
            draft_by_season.setdefault(d["season"], {})[d["kind"]] = d
            ranked = sorted(d["picks"], key=lambda p: -values.get(str(p["pid"]), 0))
            vrank = {p["no"]: i for i, p in enumerate(ranked, start=1)}
            picks = []
            for p in d["picks"]:
                info = pinfo(p["pid"])
                picks.append({"no": p["no"], "r": p["r"], "slot": p["slot"], "label": f"{p['r']}.{p['slot']:02d}" if d["kind"] == "rookie" else f"{p['r']}.{p['slot']:02d}",
                              "user": uid_of.get((s["season"], p["rid"])) or p["user"], "orig_user": uid_of.get((s["season"], p["orig"])) if p.get("orig") else None,
                              "pid": str(p["pid"]), "name": info["name"] if info["name"] != str(p["pid"]) else p["name"], "pos": info["pos"] or p["pos"],
                              "nfl": info["nfl"], "value": info["value"], "vrank": vrank[p["no"]], "delta": p["no"] - vrank[p["no"]],
                              "league_pts": round(league_pts.get(str(p["pid"]), 0), 1)})
            drafts_out.append({"season": d["season"], "kind": d["kind"], "rounds": d["rounds"], "picks": picks})
            if d["kind"] == "rookie":
                for p in picks:
                    M = managers.get(p["user"])
                    if M is not None:
                        M.setdefault("rookie_picks", 0)
                        M["rookie_picks"] += 1
                        M.setdefault("draft_delta", 0)
                        M["draft_delta"] += p["delta"]
                        M.setdefault("draft_value", 0)
                        M["draft_value"] += p["value"]

    # Trade archive
    def pick_asset(pk, trade_season):
        """A traded pick: the player taken with it if its draft is done, else its current value."""
        d = draft_by_season.get(pk["season"], {}).get("rookie")
        if d:
            hit = next((p for p in d["picks"] if p["r"] == pk["round"] and p.get("orig") == pk["orig"]), None)
            if hit:
                info = pinfo(hit["pid"])
                return {"kind": "pick", "label": f"{pk['season']} {pk['round']}.{hit['slot']:02d}", "became": info["name"], "pos": info["pos"],
                        "pid": str(hit["pid"]), "value": info["value"]}
        v = future_pick_value.get(f"k{pk['season']}-{pk['round']}-{pk['orig']}")
        if v is None:
            v = pick_market.get(f"{pk['season']} Mid {['1st', '2nd', '3rd', '4th', '5th'][min(pk['round'], 5) - 1]}", 0) or 0
        return {"kind": "pick", "label": f"{pk['season']} Round {pk['round']}", "became": None, "pos": "PICK", "pid": None, "value": round(v)}

    trades_out = []
    for s in seasons:
        for t in s["trades"]:
            sides_out = []
            for rid, got in t["sides"].items():
                u = uid_of.get((s["season"], int(rid)))
                items = []
                for pid in got["players"]:
                    info = pinfo(pid)
                    age = info["age"]
                    if age is not None:
                        age = round(max(18, age - (int(current["season"]) - int(s["season"]))), 1)
                    items.append({"kind": "player", "label": info["name"], "pos": info["pos"], "pid": str(pid),
                                  "age_at_trade": age, "value": info["value"]})
                for pk in got["picks"]:
                    items.append(pick_asset(pk, s["season"]))
                if got.get("faab"):
                    items.append({"kind": "faab", "label": f"${got['faab']} FAAB", "pos": "", "pid": None, "value": 0})
                # Production: points these players scored in this manager's lineup after the trade
                t_season, t_week = s["season"], t["week"] or 0
                prod = 0.0
                for it in items:
                    if it["pid"]:
                        for (ss, w, pts) in started_by.get((u, it["pid"]), []):
                            if (ss, w) >= (t_season, t_week) if ss == t_season else ss > t_season:
                                prod += pts
                items.sort(key=lambda x: -x["value"])
                val = sum(x["value"] * PACKAGE_WEIGHTS[min(i, len(PACKAGE_WEIGHTS) - 1)] for i, x in enumerate(items))
                sides_out.append({"user": u, "items": items, "value_now": round(val), "points": round(prod, 1)})
            if len(sides_out) != 2:
                continue
            a, b = sides_out
            # Score: dynasty value now, plus started points (1 pt ~ 25 value)
            sa, sb = a["value_now"] + 25 * a["points"], b["value_now"] + 25 * b["points"]
            margin = (sa - sb) / max(sa, sb, 1)
            winner = a["user"] if margin > 0.1 else b["user"] if margin < -0.1 else None
            trades_out.append({"id": t["id"], "season": s["season"], "week": t["week"], "time": t["time"], "sides": sides_out,
                               "winner": winner, "margin": round(abs(margin), 3)})
            for side, other, sc, so in ((a, b, sa, sb), (b, a, sb, sa)):
                M = managers.get(side["user"])
                if M is None:
                    continue
                M.setdefault("trades", 0)
                M["trades"] += 1
                M.setdefault("trade_net", 0)
                M["trade_net"] += round(sc - so)
                M.setdefault("trade_wins", 0)
                M.setdefault("trade_losses", 0)
                if winner == side["user"]:
                    M["trade_wins"] += 1
                elif winner == other["user"]:
                    M["trade_losses"] += 1
    trades_out.sort(key=lambda t: -(t["time"] or 0))

    # Acceptance tendencies from completed trades. Leans are measured against
    # the whole league and shrunk toward neutral for small samples; this keeps a
    # single deal from branding a manager as youth-only or pick-stingy.
    tendency_rows = defaultdict(lambda: {"deals": 0, "ages": [], "young": 0, "players": 0,
                                          "picks_sent": 0, "picks_received": 0,
                                          "pick_send_deals": 0, "pick_receive_deals": 0})
    for t in trades_out:
        for side in t["sides"]:
            other = next((x for x in t["sides"] if x is not side), None)
            if not side["user"] or other is None:
                continue
            row = tendency_rows[side["user"]]
            row["deals"] += 1
            received_players = [x for x in side["items"] if x["kind"] == "player" and x.get("age_at_trade") is not None]
            received_picks = [x for x in side["items"] if x["kind"] == "pick"]
            sent_picks = [x for x in other["items"] if x["kind"] == "pick"]
            row["ages"].extend(x["age_at_trade"] for x in received_players)
            row["players"] += len(received_players)
            row["young"] += sum(x["age_at_trade"] <= 25 for x in received_players)
            row["picks_received"] += len(received_picks)
            row["picks_sent"] += len(sent_picks)
            row["pick_receive_deals"] += bool(received_picks)
            row["pick_send_deals"] += bool(sent_picks)

    total_players = sum(x["players"] for x in tendency_rows.values())
    league_young = sum(x["young"] for x in tendency_rows.values()) / max(total_players, 1)
    total_deals = sum(x["deals"] for x in tendency_rows.values())
    league_send = sum(x["pick_send_deals"] for x in tendency_rows.values()) / max(total_deals, 1)
    league_receive = sum(x["pick_receive_deals"] for x in tendency_rows.values()) / max(total_deals, 1)
    clamp = lambda x: max(-1, min(1, x))  # noqa: E731
    for u, row in tendency_rows.items():
        confidence = min(1.0, row["deals"] / 6)
        young_share = row["young"] / row["players"] if row["players"] else league_young
        send_rate = row["pick_send_deals"] / row["deals"] if row["deals"] else league_send
        receive_rate = row["pick_receive_deals"] / row["deals"] if row["deals"] else league_receive
        youth_lean = clamp((young_share - league_young) / 0.35) * confidence
        pick_send_lean = clamp((send_rate - league_send) / 0.45) * confidence
        pick_receive_lean = clamp((receive_rate - league_receive) / 0.45) * confidence
        youth_label = "Targets young players" if youth_lean >= 0.2 else "Veteran-friendly" if youth_lean <= -0.2 else "Age-balanced"
        pick_label = "Loose with picks" if pick_send_lean >= 0.2 else "Stingy with picks" if pick_send_lean <= -0.2 else "Average pick activity"
        if u in managers:
            managers[u]["tendencies"] = {
                "deals": row["deals"], "players_acquired": row["players"],
                "avg_acquired_age": round(statistics.mean(row["ages"]), 1) if row["ages"] else None,
                "young_share": round(young_share, 3), "picks_sent": row["picks_sent"], "picks_received": row["picks_received"],
                "pick_send_rate": round(send_rate, 3), "pick_receive_rate": round(receive_rate, 3),
                "youth_lean": round(youth_lean, 3), "pick_send_lean": round(pick_send_lean, 3),
                "pick_receive_lean": round(pick_receive_lean, 3), "youth_label": youth_label, "pick_label": pick_label,
            }

    for M in managers.values():
        M["pf"], M["pa"] = round(M["pf"], 2), round(M["pa"], 2)
        M["ppg"] = round(M["pf"] / M["games"], 2) if M["games"] else None
        M["win_pct"] = round((M["w"] + 0.5 * M["t"]) / M["games"] * 100, 1) if M["games"] else None
        fins = [f for f in M["finishes"].values() if f]
        M["avg_finish"] = round(statistics.mean(fins), 1) if fins else None
        M["best_finish"] = min(fins) if fins else None
        M["high"] = round(M["high"], 2)

    out = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "current_season": current["season"], "seasons": season_rows, "managers": managers,
        "records": records, "h2h": h2h, "drafts": drafts_out, "trades": trades_out,
        "trade_scoring": "Value now (DynastyProcess 1-QB; picks become the player drafted) plus started points since the trade × 25. A side wins when it's 10%+ ahead.",
    }
    (DATA_DIR / "history.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    log(f"{len(seasons)} seasons, {len(all_games)} games, {len(managers)} managers, {len(trades_out)} trades, {len(drafts_out)} drafts")


if __name__ == "__main__":
    main()
