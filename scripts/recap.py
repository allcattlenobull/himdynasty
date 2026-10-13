#!/usr/bin/env python3
"""Weekly recap data: scores, bench regret, all-play records, luck, and awards.

build_recap() is called by update_league.py with the weekly lineups it already
fetched from Sleeper. It returns a dict that is written to
docs/data/recaps/{season}.json; docs/data/recap.json lists the seasons on file.

Definitions (shown on the site too):
  * Optimal lineup: the best lineup that could have been set from the players
    on the roster that week, filling the narrowest slots first (QB, RB, WR, TE,
    K, DEF), then FLEX. Same method as Sleeper's max PF.
  * Bench regret: optimal points minus points actually scored.
  * Missed moves: bench players who belonged in the optimal lineup, each paired
    with the lowest-scoring starter they could have replaced.
  * All-play: a team's record if it played every other team every week.
  * Luck: actual wins minus all-play expected wins (all-play win share × games).

Uses only the Python standard library. Run on its own for a local test:
  RECAP_LOCAL=folder python scripts/recap.py
where folder holds league.json, users.json, rosters.json, matchups_{week}.json
and positions.json (player id -> fantasy positions).
"""

import json
import os
import statistics
from pathlib import Path

SLOT_ELIGIBILITY = {
    "QB": {"QB"}, "RB": {"RB"}, "WR": {"WR"}, "TE": {"TE"}, "K": {"K"}, "DEF": {"DEF"},
    "FLEX": {"RB", "WR", "TE"}, "WRRB_FLEX": {"RB", "WR"}, "REC_FLEX": {"WR", "TE"},
    "SUPER_FLEX": {"QB", "RB", "WR", "TE"},
    "DL": {"DL", "DE", "DT"}, "LB": {"LB"}, "DB": {"DB", "CB", "S"},
    "IDP_FLEX": {"DL", "DE", "DT", "LB", "DB", "CB", "S"},
}


def optimal_lineup(roster, pts, slots, positions):
    """Return {pid: slot} for the best lineup. Narrow slots are filled first."""
    order = sorted(range(len(slots)), key=lambda i: len(SLOT_ELIGIBILITY.get(slots[i], ())))
    pool = sorted(((pts.get(pid) or 0.0, pid) for pid in roster), reverse=True)
    used = {}
    for i in order:
        elig = SLOT_ELIGIBILITY.get(slots[i], set())
        for p, pid in pool:
            if pid not in used and positions.get(pid, set()) & elig:
                used[pid] = slots[i]
                break
    return used


def missed_moves(starters, roster, pts, slots, positions):
    """Bench players who should have started, paired with who they'd replace."""
    best = optimal_lineup(roster, pts, slots, positions)
    started = [s for s in starters if s and s != "0"]
    should = sorted((pid for pid in best if pid not in started), key=lambda x: -(pts.get(x) or 0))
    # Starters who weren't in the best lineup (and empty slots), with their slot.
    out = []
    for i, pid in enumerate(starters):
        slot = slots[i] if i < len(slots) else None
        if not pid or pid == "0":
            out.append({"pid": None, "slot": slot, "pts": 0.0})
        elif pid not in best:
            out.append({"pid": pid, "slot": slot, "pts": pts.get(pid) or 0.0})
    moves = []
    for pid in should:
        p_in = pts.get(pid) or 0.0
        cands = [o for o in out if slot_ok(o["slot"], pid, positions)]
        if not cands:
            continue
        worst = min(cands, key=lambda o: o["pts"])
        gain = p_in - worst["pts"]
        if gain <= 0.05:
            continue
        out.remove(worst)
        moves.append({"bench": pid, "bench_pts": round(p_in, 2), "start": worst["pid"],
                      "start_pts": round(worst["pts"], 2), "slot": worst["slot"], "gain": round(gain, 2)})
    return best, moves


def slot_ok(slot, pid, positions):
    return bool(positions.get(pid, set()) & SLOT_ELIGIBILITY.get(slot, set()))


def build_recap(schedule, done, teams, positions, slots, season, name_of):
    """schedule: list of week dicts from update_league.read_schedule (with starters).
    teams: {rid: {"team", "owner", "players"?}}. name_of(pid) -> [name, pos, nfl].
    slots: starting slots in Sleeper order (no BN/IR/TAXI)."""
    rids = sorted(teams)
    weeks_out = []
    tot = {r: {"pf": 0.0, "max": 0.0, "regret": 0.0, "w": 0, "l": 0, "t": 0,
               "ap_w": 0, "ap_l": 0, "ap_t": 0, "xw": 0.0, "perfect": 0, "high": 0, "low": 0,
               "weekly_regret": []} for r in rids}
    pids_seen = set()

    for wk in schedule[:done]:
        w = wk["week"]
        scores = {r: round(wk["scores"].get(r, 0.0), 2) for r in rids if r in wk["scores"]}
        if not scores:
            continue
        teams_wk = {}
        for r in scores:
            pts = wk["player_pts"].get(r) or {}
            starters = (wk.get("starters") or {}).get(r) or []
            roster = list(pts.keys())
            best, moves = missed_moves(starters, roster, pts, slots, positions)
            opt = round(sum(pts.get(pid) or 0.0 for pid in best), 2)
            mx = max(scores[r], opt)
            # Starter lines in Sleeper's slot order.
            lineup = []
            for i, pid in enumerate(starters):
                slot = slots[i] if i < len(slots) else "?"
                if pid and pid != "0":
                    pids_seen.add(pid)
                lineup.append([slot, pid if pid and pid != "0" else None,
                               round(pts.get(pid) or 0.0, 2) if pid and pid != "0" else 0.0])
            bench_best = sorted(((pts.get(pid) or 0.0, pid) for pid in roster
                                 if pid not in starters), reverse=True)[:3]
            for _, pid in bench_best:
                pids_seen.add(pid)
            for m in moves:
                pids_seen.add(m["bench"])
                if m["start"]:
                    pids_seen.add(m["start"])
            others = [scores[o] for o in scores if o != r]
            ap_w = sum(1 for x in others if scores[r] > x)
            ap_t = sum(1 for x in others if scores[r] == x)
            ap_l = len(others) - ap_w - ap_t
            teams_wk[r] = {
                "pts": scores[r], "max": round(mx, 2), "regret": round(mx - scores[r], 2),
                "eff": round(100 * scores[r] / mx, 1) if mx > 0 else 100.0,
                "ap": [ap_w, ap_l, ap_t], "lineup": lineup, "moves": moves,
                "bench": [[pid, round(p, 2)] for p, pid in bench_best],
            }

        games = []
        for a, b in wk["games"]:
            if a not in scores or b not in scores:
                continue
            pa, pb = scores[a], scores[b]
            winner = a if pa > pb else b if pb > pa else None
            games.append({"a": a, "b": b, "pa": pa, "pb": pb, "winner": winner,
                          "margin": round(abs(pa - pb), 2)})
            for x, y, px, py in ((a, b, pa, pb), (b, a, pb, pa)):
                t = tot[x]
                if px > py:
                    t["w"] += 1
                elif px < py:
                    t["l"] += 1
                else:
                    t["t"] += 1
                teams_wk[x]["result"] = "W" if px > py else "L" if px < py else "T"
                teams_wk[x]["opp"] = y

        median = statistics.median(scores.values())
        for r, t in teams_wk.items():
            T = tot[r]
            T["pf"] += t["pts"]
            T["max"] += t["max"]
            T["regret"] += t["regret"]
            T["weekly_regret"].append(t["regret"])
            T["ap_w"] += t["ap"][0]
            T["ap_l"] += t["ap"][1]
            T["ap_t"] += t["ap"][2]
            n_opp = max(1, sum(t["ap"]))
            T["xw"] += (t["ap"][0] + 0.5 * t["ap"][2]) / n_opp
            if t["regret"] < 0.01:
                T["perfect"] += 1
            t["above_median"] = t["pts"] > median

        hi = max(scores, key=scores.get)
        lo = min(scores, key=scores.get)
        tot[hi]["high"] += 1
        tot[lo]["low"] += 1

        awards = {"him": hi, "ass": lo}
        if games:
            g_big = max(games, key=lambda g: g["margin"])
            g_close = min(games, key=lambda g: g["margin"])
            awards["blowout"] = [g_big["a"], g_big["b"]]
            awards["nailbiter"] = [g_close["a"], g_close["b"]]
            losers = [r for r, t in teams_wk.items() if t.get("result") == "L"]
            winners = [r for r, t in teams_wk.items() if t.get("result") == "W"]
            if losers:
                awards["unlucky"] = max(losers, key=lambda r: scores[r])
            if winners:
                awards["lucky"] = min(winners, key=lambda r: scores[r])
        awards["benchwarmer"] = max(teams_wk, key=lambda r: teams_wk[r]["regret"])
        perfect = [r for r, t in teams_wk.items() if t["regret"] < 0.01]
        if perfect:
            awards["perfect"] = perfect
        # Best single starter and the biggest single missed move.
        top = None
        for r, t in teams_wk.items():
            for slot, pid, p in t["lineup"]:
                if pid and (top is None or p > top[2]):
                    top = [r, pid, p]
        if top:
            awards["mvp"] = top
        worst_move = None
        for r, t in teams_wk.items():
            for m in t["moves"]:
                if worst_move is None or m["gain"] > worst_move[1]["gain"]:
                    worst_move = [r, m]
        if worst_move:
            awards["blunder"] = worst_move

        weeks_out.append({"week": w, "games": games, "teams": {str(r): t for r, t in teams_wk.items()},
                          "awards": awards, "median": round(median, 2),
                          "high": scores[hi], "low": scores[lo],
                          "avg": round(sum(scores.values()) / len(scores), 2)})

    season_rows = []
    for r in rids:
        T = tot[r]
        n = len(T["weekly_regret"])
        if not n:
            continue
        games_played = T["w"] + T["l"] + T["t"]
        actual_w = T["w"] + 0.5 * T["t"]
        season_rows.append({
            "rid": r, "pf": round(T["pf"], 2), "max": round(T["max"], 2),
            "regret": round(T["regret"], 2), "regret_avg": round(T["regret"] / n, 2),
            "eff": round(100 * T["pf"] / T["max"], 1) if T["max"] else 100.0,
            "perfect": T["perfect"], "high": T["high"], "low": T["low"],
            "record": [T["w"], T["l"], T["t"]],
            "allplay": [T["ap_w"], T["ap_l"], T["ap_t"]],
            "allplay_pct": round(100 * (T["ap_w"] + 0.5 * T["ap_t"]) / max(1, T["ap_w"] + T["ap_l"] + T["ap_t"]), 1),
            "xw": round(T["xw"], 2), "luck": round(actual_w - T["xw"], 2), "games": games_played,
            "weekly_regret": T["weekly_regret"],
        })

    names = {pid: name_of(pid) for pid in sorted(pids_seen)}
    return {
        "season": season,
        "weeks_completed": done,
        "slots": slots,
        "teams": {str(r): {"team": teams[r]["team"], "owner": teams[r]["owner"]} for r in rids},
        "weeks": weeks_out,
        "season_totals": season_rows,
        "players": names,
        "method": {
            "regret": "Bench regret = best possible lineup from that week's roster minus points scored (Sleeper's max PF method).",
            "moves": "Missed moves pair each bench player who belonged in the best lineup with the lowest-scoring starter he could have replaced.",
            "allplay": "All-play = record if a team played every other team every week.",
            "luck": "Luck = actual wins minus expected wins from all-play (win share each week, summed).",
        },
    }


def write_recap(data_dir, recap, generated_at):
    """Write recaps/{season}.json and the recap.json index."""
    folder = Path(data_dir) / "recaps"
    folder.mkdir(parents=True, exist_ok=True)
    recap = dict(recap, generated_at=generated_at)
    (folder / f"{recap['season']}.json").write_text(
        json.dumps(recap, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    seasons = sorted((f.stem for f in folder.glob("*.json") if f.stem.isdigit()), reverse=True)
    index = {"generated_at": generated_at, "current": recap["season"], "seasons": seasons,
             "weeks_completed": recap["weeks_completed"],
             "latest_week": recap["weeks"][-1]["week"] if recap["weeks"] else None}
    (Path(data_dir) / "recap.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")


# --------------------------------------------------------------------------- #
# Local test harness
# --------------------------------------------------------------------------- #
def _local(folder):
    folder = Path(folder)
    rd = lambda n: json.loads((folder / n).read_text())  # noqa: E731
    league = rd("league.json")
    users = {u["user_id"]: u for u in rd("users.json")}
    rosters = rd("rosters.json")
    pos = {k: set(v) for k, v in rd("positions.json").items()}
    teams = {}
    for r in rosters:
        u = users.get(r.get("owner_id")) or {}
        teams[r["roster_id"]] = {"team": (u.get("metadata") or {}).get("team_name") or u.get("display_name") or f"Team {r['roster_id']}",
                                 "owner": u.get("display_name") or "?"}
    slots = [s for s in league["roster_positions"] if s not in ("BN", "IR", "TAXI")]
    schedule = []
    w = 1
    while (folder / f"matchups_{w}.json").exists():
        ms = rd(f"matchups_{w}.json")
        grouped = {}
        for m in ms:
            if m.get("matchup_id") is not None:
                grouped.setdefault(m["matchup_id"], []).append(m)
        games, scores, maxes, pp, st = [], {}, {}, {}, {}
        for pair in grouped.values():
            if len(pair) != 2:
                continue
            games.append((pair[0]["roster_id"], pair[1]["roster_id"]))
            for s in pair:
                scores[s["roster_id"]] = float(s.get("points") or 0)
                pp[s["roster_id"]] = s.get("players_points") or {}
                st[s["roster_id"]] = s.get("starters") or []
        schedule.append({"week": w, "games": games, "scores": scores, "max": maxes, "player_pts": pp, "starters": st})
        w += 1
    done = sum(1 for wk in schedule if any(v > 0 for v in wk["scores"].values()))
    lite = {}
    lp = Path(__file__).resolve().parent.parent / "docs" / "data" / "players_lite.json"
    if lp.exists():
        lite = json.loads(lp.read_text())
    name_of = lambda pid: lite.get(pid) or [pid, "DEF" if not pid.isdigit() else "?", pid if not pid.isdigit() else "FA"]  # noqa: E731
    return build_recap(schedule, done, teams, pos, slots, str(league["season"]), name_of)


if __name__ == "__main__":
    folder = os.environ.get("RECAP_LOCAL")
    if not folder:
        raise SystemExit("Set RECAP_LOCAL to a folder of saved Sleeper responses.")
    out = _local(folder)
    target = Path(os.environ.get("RECAP_OUT", Path(__file__).resolve().parent.parent / "docs" / "data"))
    import datetime as dt
    write_recap(target, out, dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"))
    for row in sorted(out["season_totals"], key=lambda x: -x["regret"]):
        print(row["rid"], out["teams"][str(row["rid"])]["team"], row["pf"], row["max"], row["regret"], row["allplay"], row["luck"])
