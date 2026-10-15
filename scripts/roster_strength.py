#!/usr/bin/env python3
"""Rest-of-season roster strength: what each roster should score per week from
here, given who is on it today, who is hurt, and who would replace them.

Used by update_league.py so playoff, title and #1-pick odds react to trades,
waiver moves and injuries the next morning instead of waiting for games.

For every remaining week (up to MAX_WEEKS ahead) and every rostered player:
  * Expected points: Sleeper's projection for that week, scored with this
    league's settings, blended with the player's own scoring average this
    season (PROJ_SHARE projection, the rest his average). A bye week is 0.
  * Availability: from his injury status today, recovering over the next weeks
      Out / Suspended   0 next week, 60% the week after, then healthy
      IR / PUP / NFI    0 for four weeks, then 60%, then healthy
      Doubtful          25% next week, then 90%, then healthy
      Questionable      80% next week, then healthy
    plus a small injury risk for everyone that grows the further out the week
    is (1.5% per week), because some healthy players will get hurt.
  * Replacement: each position has a waiver-level stand-in (the 3rd-best
    unrostered projection that week), so a roster with no healthy backup
    loses most, not all, of a hurt starter's points.
The weekly score is the average best lineup over SAMPLES random draws of who
is available, so depth matters: a hurt starter costs a deep team little and a
thin team a lot. The rest-of-season figure is the average over the weeks.

Uses only the Python standard library.
"""

import json
import random
import statistics
import urllib.request

SLEEPER_COM = "https://api.sleeper.com"
POSITIONS = ("QB", "RB", "WR", "TE", "K", "DEF")
MAX_WEEKS = 8
SAMPLES = 160
PROJ_SHARE = 0.6
WEEKLY_RISK = 0.015
REPLACEMENT_RANK = 3  # 3rd-best free agent at the position

SLOT_ELIGIBILITY = {
    "QB": {"QB"}, "RB": {"RB"}, "WR": {"WR"}, "TE": {"TE"}, "K": {"K"}, "DEF": {"DEF"},
    "FLEX": {"RB", "WR", "TE"}, "WRRB_FLEX": {"RB", "WR"}, "REC_FLEX": {"WR", "TE"},
    "SUPER_FLEX": {"QB", "RB", "WR", "TE"},
}

# Availability by weeks ahead (1 = next week) for each injury status.
RECOVERY = {
    "Out": [0.0, 0.6], "Sus": [0.0, 0.6],
    "IR": [0.0, 0.0, 0.0, 0.0, 0.6], "PUP": [0.0, 0.0, 0.0, 0.0, 0.6], "NFI": [0.0, 0.0, 0.0, 0.0, 0.6],
    "Doubtful": [0.25, 0.9], "Questionable": [0.8],
}


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "him-dynasty-updater"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def league_score(stats, sc):
    s = dict(stats or {})
    if "fgmiss" in sc and "fgmiss" not in s:
        s["fgmiss"] = sum(v for k, v in s.items() if k.startswith("fgmiss_"))
    return sum(sc[k] * s[k] for k in sc if k in s and isinstance(s[k], (int, float)))


def load_projections(season, weeks, sc, fetch=None, log=print):
    """{week: {pid: points}} in league scoring. Missing weeks are left out."""
    fetch = fetch or (lambda w, pos: fetch_json(
        f"{SLEEPER_COM}/projections/nfl/{season}/{w}?season_type=regular&position[]={pos}&order_by=pts_ppr"))
    out = {}
    for w in weeks:
        wk = {}
        for pos in POSITIONS:
            try:
                rows = fetch(w, pos) or []
            except Exception as exc:  # noqa: BLE001
                log(f"  projections week {w} {pos} unavailable: {exc}")
                continue
            for r in rows:
                st = r.get("stats") or {}
                pid = r.get("player_id")
                if not pid or not st or st.get("gp", 1) == 0:
                    continue
                wk[pid] = max(0.0, league_score(st, sc))
        if wk:
            out[w] = wk
    return out


def season_averages(schedule, done):
    """Each player's points per game this season, from league matchups (any
    roster). Weeks with 0 are skipped as likely byes or inactive games."""
    seen = {}
    for wk in schedule[:done]:
        for pts in wk.get("player_pts", {}).values():
            for pid, p in pts.items():
                if p and p > 0:
                    seen.setdefault(pid, []).append(p)
    return {pid: statistics.mean(v) for pid, v in seen.items() if v}


def availability(status, ahead):
    """Chance a player is active `ahead` weeks from now (1 = next week)."""
    base = 1.0
    curve = RECOVERY.get(status or "")
    if curve:
        base = curve[ahead - 1] if ahead - 1 < len(curve) else 1.0
    return base * (1 - WEEKLY_RISK) ** (ahead - 1)


def expected_lineup(roster, slots, rng, samples):
    """roster: list of (pid, pos_set, pts, avail). Replacement ghosts included.
    Returns the average best-lineup score over random availability draws."""
    order = sorted(range(len(slots)), key=lambda i: len(SLOT_ELIGIBILITY[slots[i]]))
    ranked = sorted(roster, key=lambda r: -r[2])
    sure = all(r[3] >= 0.999 for r in ranked)
    runs = 1 if sure else samples
    total = 0.0
    for _ in range(runs):
        active = [r for r in ranked if r[3] >= 0.999 or rng.random() < r[3]]
        used = set()
        s = 0.0
        for i in order:
            elig = SLOT_ELIGIBILITY[slots[i]]
            for pid, pos, pts, _a in active:
                if pid not in used and pos & elig:
                    used.add(pid)
                    s += pts
                    break
        total += s
    return total / runs


def roster_strength(rosters, players, positions, slots, schedule, done, weeks, proj, now_week=None, seed="him"):
    """Return {rid: {...}} with the expected weekly score from here.

    rosters: Sleeper rosters. players: Sleeper players (for injury_status, name).
    positions: {pid: set(fantasy positions)}. slots: starting slots.
    weeks: remaining weeks (in order). proj: from load_projections()."""
    slots = [s for s in slots if s in SLOT_ELIGIBILITY]
    avg = season_averages(schedule, done)
    rostered = {pid for r in rosters for pid in (r.get("players") or [])}
    weeks = [w for w in weeks if w in proj][:MAX_WEEKS]
    if not weeks:
        return {}
    first = weeks[0] if now_week is None else now_week

    # Waiver-level stand-ins per position and week.
    replacement = {}
    for w in weeks:
        rep = {}
        for pos in POSITIONS:
            pool = sorted((p for pid, p in proj[w].items()
                           if pid not in rostered and pos in positions.get(pid, set())), reverse=True)
            rep[pos] = pool[REPLACEMENT_RANK - 1] if len(pool) >= REPLACEMENT_RANK else (pool[-1] if pool else 0.0)
        replacement[w] = rep

    def expected(pid, w):
        p = proj[w].get(pid)
        a = avg.get(pid)
        if p is None:
            # Not projected: on bye, released or no role. Only fall back to the
            # season average when there are no projections for him at all.
            if any(pid in proj[x] for x in weeks):
                return 0.0
            return a or 0.0
        return PROJ_SHARE * p + (1 - PROJ_SHARE) * a if a is not None else p

    def typical(pid):
        """A player's normal weekly level: his average non-zero projection
        from here, else his season average."""
        vals = [proj[w][pid] for w in weeks if proj[w].get(pid)]
        if vals:
            v = statistics.mean(vals)
            return PROJ_SHARE * v + (1 - PROJ_SHARE) * avg[pid] if pid in avg else v
        return avg.get(pid, 0.0)

    rng = random.Random(seed)
    out = {}
    for r in rosters:
        rid = r["roster_id"]
        pids = [pid for pid in (r.get("players") or []) if positions.get(pid, set()) & set(POSITIONS)]
        weekly, healthy_weekly = [], []
        for w in weeks:
            ahead = max(1, w - first + 1)
            full = []
            for pid in pids:
                st = (players.get(pid) or {}).get("injury_status")
                full.append((pid, positions.get(pid, set()), expected(pid, w), availability(st, ahead)))
            ghosts = []
            for pos in POSITIONS:
                n = sum(1 for s in slots if pos in SLOT_ELIGIBILITY[s])
                ghosts += [(f"rep-{pos}-{k}", {pos}, replacement[w][pos], 1.0) for k in range(n)]
            weekly.append(expected_lineup(full + ghosts, slots, rng, SAMPLES))
            # Same roster with nobody hurt today (normal injury risk only).
            # Hurt players count at their normal level, since projections
            # already zero them out while they're expected to miss games.
            healthy = [(pid, pos, typical(pid) if (players.get(pid) or {}).get("injury_status") in RECOVERY else pts,
                        availability(None, ahead)) for pid, pos, pts, _ in full] + ghosts
            healthy_weekly.append(expected_lineup(healthy, slots, rng, SAMPLES))
        hurt = []
        for pid in pids:
            p = players.get(pid) or {}
            st = p.get("injury_status")
            if st in RECOVERY:
                pts = typical(pid)
                if pts >= 6:
                    hurt.append({"id": pid, "name": p.get("full_name") or pid, "status": st, "pts": round(pts, 1)})
        hurt.sort(key=lambda h: -h["pts"])
        mean = statistics.mean(weekly)
        healthy_mean = statistics.mean(healthy_weekly)
        out[rid] = {
            "mean": round(mean, 2),
            "healthy": round(healthy_mean, 2),
            "injury_cost": round(max(0.0, healthy_mean - mean), 2),
            "next_week": round(weekly[0], 2),
            "weeks": weeks,
            "hurt": hurt[:4],
        }
    return out
