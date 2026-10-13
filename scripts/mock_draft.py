#!/usr/bin/env python3
"""Fully automatic rookie mock draft for HIM Dynasty.

Runs after update_league.py and needs no manual input or API keys.

Sources
  * NFL Mock Draft Database consensus big board (top 100, averaged from many
    published boards) and ESPN's draft big board: who the experts like.
  * ESPN college stats and game logs: how each prospect is actually playing,
    scored with this league's own Sleeper scoring settings.
  * Sleeper: league format, number of rookie rounds, traded picks, rosters,
    and every past draft in the league.
  * docs/data/latest.json: projected draft order and each roster.

How a prospect is valued
  1. Consensus value: the average of the available board ranks, turned into a
     value that falls off quickly after the top picks (like real draft capital).
  2. Production value: the prospect's college fantasy points per game, as a
     percentile among college players at the same position, nudged by his
     last three games.
  3. Blend: production counts for 20% before the college season and grows to
     40% as games are played. Consensus counts for the rest.
  4. League format: a mild base weight (QBs a bit lower in 1-QB, higher in
     superflex; TEs up with TE premium).

How each pick is made
  The team that owns the pick (after trades) takes the prospect with the best
  value x round prior x manager tendency x roster need:
    * Round prior: how this league has actually spent each round of its past
      rookie drafts (walking Sleeper's previous_league_id chain).
    * Manager tendency: each manager's own position habits from every past
      draft here (rookie drafts fully, startup rounds 1-10 at 40%).
    * Roster need: the whole roster, starters and depth (see team_needs).
  Each pick at a position eases that team's need there.

Output: docs/data/mock_draft.json and docs/data/prospects_history.json.
"""

import datetime as dt
import json
import math
import os
import sys
import re
import statistics
import time
import unicodedata
import urllib.request
from html import unescape
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from league_pointer import current_league_id  # noqa: E402

LEAGUE_ID = current_league_id()
REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "docs" / "data"

SLEEPER = "https://api.sleeper.app/v1"
ESPN_NFL = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl"
ESPN_CFB = "https://site.web.api.espn.com/apis/common/v3/sports/football/college-football"
MDDB = "https://www.nflmockdraftdatabase.com/big-boards/{y}/consensus-big-board-{y}"
UA = "Mozilla/5.0 (compatible; HIM-Dynasty-mock-draft; +https://github.com/allcattlenobull/himdynasty)"

FANTASY_POS = ("QB", "RB", "WR", "TE")
ELIGIBLE_CLASSES = {"Junior", "Senior"}
UNRANKED = 140  # consensus rank given to production-only prospects


# --------------------------------------------------------------------------- #
# Fetching
# --------------------------------------------------------------------------- #

def fetch(url, as_json=True, retries=3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json, text/html;q=0.9"})
            with urllib.request.urlopen(req, timeout=40) as r:
                body = r.read().decode("utf-8", "replace")
            return json.loads(body) if as_json else body
        except Exception as e:  # noqa: BLE001 - retry any network or parse error
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise last


def log(msg):
    print(msg, flush=True)


def norm(name):
    """Normalize a player name for matching across sources."""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z ]", "", s.replace("-", " "))
    words = [w for w in s.split() if w not in ("jr", "sr", "ii", "iii", "iv", "v")]
    return " ".join(words)


def espn_id(ref):
    m = re.search(r"/athletes/(\d+)", ref or "")
    return m.group(1) if m else None


# --------------------------------------------------------------------------- #
# Sources
# --------------------------------------------------------------------------- #

def source_mddb(year):
    """Consensus big board rows: rank, name, position, school."""
    try:
        page = fetch(MDDB.format(y=year), as_json=False)
    except Exception as e:  # noqa: BLE001
        log(f"  consensus board unavailable: {e}")
        return []
    rows = re.findall(
        r'font-black leading-none"[^>]*>(\d+)</span>.*?href="/players/\d+/[^"]+">\s*([^<]+?)\s*</a>'
        r'\s*<div[^>]*>\s*<span[^>]*>([A-Z/]+)</span>\s*(?:<a[^>]*>\s*([^<]+?)\s*</a>)?',
        page, re.S)
    out = [{"rank": int(r), "name": unescape(n), "pos": p, "school": unescape(s) if s else None} for r, n, p, s in rows]
    log(f"  consensus board: {len(out)} prospects")
    return out


def source_espn_board(year):
    """ESPN draft big board: name, position, overall rank, college athlete id."""
    try:
        listing = fetch(f"{ESPN_NFL}/seasons/{year}/draft/athletes?limit=200")
    except Exception as e:  # noqa: BLE001
        log(f"  ESPN board unavailable: {e}")
        return []
    out = []
    for item in listing.get("items", []):
        try:
            a = fetch(item["$ref"].replace("http://", "https://"))
        except Exception:  # noqa: BLE001
            continue
        attrs = {x.get("name"): x.get("value") for x in a.get("attributes", [])}
        rank = attrs.get("overall")
        out.append({
            "rank": int(rank) if rank else None,
            "name": a.get("displayName") or a.get("fullName"),
            "pos": (a.get("position") or {}).get("abbreviation"),
            "espn_id": espn_id((a.get("athlete") or {}).get("$ref")),
        })
    log(f"  ESPN board: {len(out)} prospects")
    return out


def college_leaders(season):
    """Season stats for college QBs, RBs, WRs, and TEs, keyed by ESPN id."""
    lists = [
        ("passing", "passing.passingYards", 150),
        ("rushing", "rushing.rushingYards", 250),
        ("receiving", "receiving.receivingYards", 350),
    ]
    players = {}
    for category, sort, limit in lists:
        url = (f"{ESPN_CFB}/statistics/byathlete?region=us&lang=en&contentorigin=espn&isqualified=false"
               f"&page=1&limit={limit}&category=offense%3A{category}&sort={sort}%3Adesc&season={season}&seasontype=2")
        try:
            data = fetch(url)
        except Exception as e:  # noqa: BLE001
            log(f"  college {category} leaders unavailable: {e}")
            continue
        names = {c["name"]: c.get("names", []) for c in data.get("categories", [])}
        for entry in data.get("athletes", []):
            a = entry["athlete"]
            pid = a["id"]
            p = players.setdefault(pid, {
                "espn_id": pid,
                "name": a.get("displayName"),
                "pos": (a.get("position") or {}).get("abbreviation"),
                "school": a.get("teamShortName") or a.get("teamName"),
                "school_name": (a.get("teams") or [{}])[0].get("displayName") if a.get("teams") else a.get("teamName"),
                "headshot": (a.get("headshot") or {}).get("href"),
                "stats": {},
            })
            for cat in entry.get("categories", []):
                for key, value in zip(names.get(cat["name"], []), cat.get("values", [])):
                    if value is not None:
                        p["stats"][key] = value
    log(f"  college stat lines: {len(players)} players")
    return players


def athlete_class(pid):
    try:
        a = fetch(f"{ESPN_CFB}/athletes/{pid}")
        return (a.get("athlete") or {}).get("displayExperience")
    except Exception:  # noqa: BLE001
        return None


def game_log(pid, season, scoring):
    """Per-game college fantasy points and stat lines, oldest first."""
    try:
        g = fetch(f"{ESPN_CFB}/athletes/{pid}/gamelog?season={season}")
    except Exception:  # noqa: BLE001
        return []
    names = g.get("names") or []
    events = g.get("events") or {}
    games = {}
    for st in g.get("seasonTypes") or []:
        for cat in st.get("categories") or []:
            for ev in cat.get("events") or []:
                stats = {}
                for key, raw in zip(names, ev.get("stats") or []):
                    try:
                        stats[key] = float(str(raw).replace(",", ""))
                    except ValueError:
                        pass
                info = events.get(ev["eventId"], {})
                games[ev["eventId"]] = {
                    "week": info.get("week"),
                    "date": info.get("gameDate"),
                    "opp": (info.get("opponent") or {}).get("abbreviation"),
                    "at": info.get("atVs"),
                    "result": info.get("gameResult"),
                    "pts": round(fantasy_points(stats, scoring), 1),
                    "stats": stats,
                }
    return sorted(games.values(), key=lambda x: x["date"] or "")


# --------------------------------------------------------------------------- #
# Scoring
# --------------------------------------------------------------------------- #

def fantasy_points(stats, sc):
    """College stats scored with the league's Sleeper settings."""
    def v(k):
        return stats.get(k) or 0.0
    return (
        v("passingYards") * sc.get("pass_yd", 0.04)
        + v("passingTouchdowns") * sc.get("pass_td", 4)
        + v("interceptions") * sc.get("pass_int", -1)
        + v("rushingYards") * sc.get("rush_yd", 0.1)
        + v("rushingTouchdowns") * sc.get("rush_td", 6)
        + v("receptions") * sc.get("rec", 1)
        + v("receivingYards") * sc.get("rec_yd", 0.1)
        + v("receivingTouchdowns") * sc.get("rec_td", 6)
    )


def stat_line(pos, s):
    def i(k):
        return int(round(s.get(k) or 0))
    if pos == "QB":
        line = f"{i('completions')}/{i('passingAttempts')}, {i('passingYards')} yds, {i('passingTouchdowns')} TD, {i('interceptions')} INT"
        if s.get("rushingYards"):
            line += f"; {i('rushingYards')} rush yds"
        if s.get("rushingTouchdowns"):
            line += f", {i('rushingTouchdowns')} rush TD"
        return line
    if pos == "RB":
        line = f"{i('rushingAttempts')}-{i('rushingYards')}-{i('rushingTouchdowns')} rushing"
        if s.get("receptions"):
            line += f"; {i('receptions')}-{i('receivingYards')}-{i('receivingTouchdowns')} receiving"
        return line
    line = f"{i('receptions')} rec, {i('receivingYards')} yds, {i('receivingTouchdowns')} TD"
    if s.get("rushingYards"):
        line += f"; {i('rushingYards')} rush yds"
    return line


def capital_value(rank):
    return 100.0 * math.exp(-((rank or UNRANKED) - 1) / 40.0)


def percentile(value, population):
    if not population:
        return 0.5
    below = sum(1 for p in population if p < value)
    equal = sum(1 for p in population if p == value)
    return (below + 0.5 * equal) / len(population)


def format_multipliers(league):
    """Base position weights for the league format.

    These are deliberately mild. How this league actually drafts each position
    by round (league_history) does most of the format calibration, so a QB in
    this 1-QB league is not penalized twice.
    """
    positions = league.get("roster_positions") or []
    superflex = "SUPER_FLEX" in positions or positions.count("QB") > 1
    te_premium = (league.get("scoring_settings") or {}).get("bonus_rec_te") or 0
    return {
        "QB": 1.15 if superflex else 0.7,
        "RB": 1.0,
        "WR": 1.0,
        "TE": 0.9 + min(0.2, te_premium * 0.3),
    }, superflex, te_premium


# --------------------------------------------------------------------------- #
# Team needs and draft order
# --------------------------------------------------------------------------- #

def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


# Weights per roster slot: (starter slots, depth slots). Starters are measured
# against the league median at that slot; depth against a replacement-level bar.
NEED_SLOTS_1QB = {
    "QB": ([1.0], [0.25]),
    "RB": ([0.35, 0.30], [0.20, 0.15]),
    "WR": ([0.26, 0.24, 0.20], [0.17, 0.13]),
    "TE": ([0.85], [0.15]),
}
NEED_SLOTS_SF = dict(NEED_SLOTS_1QB, QB=([0.5, 0.4], [0.1]))


def team_needs(latest, superflex):
    """How badly each team needs each position, from its whole roster.

    Every slot counts, not just the starters. For each position:
      * Starter slots (QB1; RB1-2; WR1-3; TE1) compare a team's best players
        with the league median at the same slot. Being better than the median
        earns at most a small credit, so one star cannot hide an empty bench.
      * Depth slots (QB2; RB3-4; WR4-5; TE2) compare the next players with a
        replacement-level bar: the value of the league's Nth-best rostered
        player at that position, where N = teams x (starters + 1/2). Depth
        earns no credit for being good, only a penalty for being missing.
    Values are dynasty values from trade.json (or points scored as a fallback).
    Need runs from -0.6 (loaded) to +0.45 (empty; +0.2 for QB in 1-QB). In a 1-QB league a team
    with a starter-level QB and a real backup is "set at QB" (-0.6).

    Returns (needs, position ranks, thin) keyed by roster id; thin lists the
    positions where the depth slots are mostly empty.
    """
    slots = NEED_SLOTS_SF if superflex else NEED_SLOTS_1QB
    rids = [int(r) for r in (latest.get("teams") or {})]
    by_team = {r: {pos: [] for pos in slots} for r in rids}
    try:
        trade = json.loads((DATA_DIR / "trade.json").read_text())
        for a in trade["assets"]:
            if a.get("owner") in by_team and a["kind"] == "player" and a["pos"] in slots:
                by_team[a["owner"]][a["pos"]].append(a["value"])
    except (FileNotFoundError, KeyError, ValueError):
        for rid, t in latest["teams"].items():
            r = t["roster"]
            for p in [x["player"] for x in r["starters"] if x.get("player")] + r["bench"] + r["taxi"] + r["ir"]:
                if p["pos"] in slots:
                    by_team[int(rid)][p["pos"]].append(p.get("pts") or 0.0)

    needs = {r: {} for r in rids}
    ranks = {r: {} for r in rids}
    thin = {r: [] for r in rids}
    n = len(rids) or 1
    for pos, (starter_w, depth_w) in slots.items():
        depth = len(starter_w) + len(depth_w)
        vals = {r: (sorted(by_team[r][pos], reverse=True) + [0.0] * depth)[:depth] for r in rids}
        everyone = sorted((v for r in rids for v in by_team[r][pos]), reverse=True)
        bar_index = int(n * (len(starter_w) + 0.5)) - 1
        bar = everyone[min(bar_index, len(everyone) - 1)] if everyone else 0.0
        medians = [statistics.median(vals[r][i] for r in rids) for i in range(len(starter_w))]
        strength = {r: sum(vals[r][:len(starter_w)]) for r in rids}
        for i, r in enumerate(sorted(rids, key=lambda x: -strength[x]), start=1):
            ranks[r][pos] = i
        for r in rids:
            v = vals[r]
            starter = sum(w * max(-0.3, min(1.0, (m - v[i]) / m)) if m else 0.0
                          for i, (w, m) in enumerate(zip(starter_w, medians)))
            gaps = [max(0.0, min(1.0, (bar - v[len(starter_w) + j]) / bar)) if bar else 0.0
                    for j in range(len(depth_w))]
            depth_need = sum(w * g for w, g in zip(depth_w, gaps))
            # One starting QB is easy to find in a 1-QB league, so a QB hole
            # pulls much less than a hole anywhere else.
            cap = 0.2 if pos == "QB" and not superflex else 0.45
            need = max(-0.6, min(cap, starter + depth_need))
            if pos == "QB" and not superflex:
                qbs = v
                if qbs[0] >= medians[0] and qbs[1] >= 0.4 * medians[0]:
                    need, depth_need = -0.6, 0.0
            needs[r][pos] = need
            if depth_need >= 0.1 and (pos != "QB" or superflex):
                thin[r].append(pos)
    return needs, ranks, thin


def needs_summary(need, rank, thin=()):
    top = [p for p, v in sorted(need.items(), key=lambda kv: -kv[1]) if v >= 0.15][:2]
    return {
        "needs": top,
        "set": [p for p, v in need.items() if v <= -0.15 and p not in thin],
        "thin": [p for p in thin if p not in top],
        "ranks": rank,
    }


def roster_plans(latest, league, picks, board):
    """Each team's roster now and after its mock picks, with suggested cuts.

    Roster limits come from Sleeper: active spots (every lineup and bench
    slot), taxi spots, and IR spots. Assumptions, kept simple and stated on
    the page: players on IR stay there; next season's taxi can hold the new
    rookies plus this year's rookies (years_exp 0), up to the taxi limit; the
    mock picks are kept. If the team is still over, the lowest dynasty values
    are released first (never a team's only kicker or defense).
    """
    settings = league.get("settings") or {}
    active_slots = len([s for s in league.get("roster_positions") or [] if s != "IR"])
    taxi_slots = settings.get("taxi_slots") or 0
    reserve_slots = settings.get("reserve_slots") or 0
    values = {}
    try:
        for a in json.loads((DATA_DIR / "trade.json").read_text())["assets"]:
            if a["kind"] == "player":
                values[str(a["id"]).lstrip("p")] = a["value"]
    except (FileNotFoundError, KeyError, ValueError):
        pass
    by_key = {e["key"]: e for e in board}
    plans = {}
    for rid, t in (latest.get("teams") or {}).items():
        r = t["roster"]
        current = []
        for group, players in (("starter", [x["player"] for x in r["starters"] if x.get("player")]),
                               ("bench", r["bench"]), ("taxi", r["taxi"]), ("ir", r["ir"])):
            for pl in players:
                current.append({"id": pl["id"], "name": pl["name"], "pos": pl["pos"], "nfl": pl.get("nfl"),
                                "age": pl.get("age"), "exp": pl.get("exp"), "ppg": pl.get("ppg"),
                                "value": round(values.get(str(pl["id"]), 0.0)), "group": group})
        draftees = [{"label": pk["label"], "key": pk["prospect"], "name": by_key[pk["prospect"]]["name"],
                     "pos": by_key[pk["prospect"]]["pos"]}
                    for pk in picks if str(pk["owner"]) == str(rid)]
        pool = [p for p in current if p["group"] != "ir"]
        protected = set()
        for pos in ("K", "DEF"):
            only = [p for p in pool if p["pos"] == pos]
            if only:
                protected.add(max(only, key=lambda p: (p["ppg"] or 0))["id"])
        cuts = []
        while True:
            alive = [p for p in pool if p["id"] not in cuts]
            eligible = len(draftees) + sum(1 for p in alive if p.get("exp") == 0)
            over = len(alive) + len(draftees) - active_slots - min(taxi_slots, eligible)
            if over <= 0:
                break
            options = [p for p in alive if p["id"] not in protected]
            if not options:
                break
            cuts.append(min(options, key=lambda p: (p["value"], p["ppg"] or 0))["id"])
        plans[str(rid)] = {
            "current": current,
            "draftees": draftees,
            "cuts": cuts,
            "counts": {"active": sum(1 for p in current if p["group"] in ("starter", "bench")),
                       "taxi": sum(1 for p in current if p["group"] == "taxi"),
                       "ir": sum(1 for p in current if p["group"] == "ir")},
        }
    return {"limits": {"active": active_slots, "taxi": taxi_slots, "ir": reserve_slots}, "teams": plans}


# --------------------------------------------------------------------------- #
# League draft history: position priors by round and manager tendencies
# --------------------------------------------------------------------------- #

def league_history(rosters):
    """Every completed draft in this league's history (previous_league_id chain).

    Returns a list of {season, kind ("rookie"/"startup"), rounds, picks}, each
    pick {round, pos, user, name}. Rookie drafts are drafts of 5 rounds or less.
    """
    drafts, league_id, seen = [], LEAGUE_ID, set()
    while league_id and league_id not in seen and len(seen) < 10:
        seen.add(league_id)
        try:
            lg = fetch(f"{SLEEPER}/league/{league_id}")
            listing = fetch(f"{SLEEPER}/league/{league_id}/drafts") or []
        except Exception as exc:  # noqa: BLE001
            log(f"History: could not read league {league_id}: {exc}")
            break
        for d in listing:
            if d.get("status") != "complete":
                continue
            try:
                raw = fetch(f"{SLEEPER}/draft/{d['draft_id']}/picks") or []
            except Exception as exc:  # noqa: BLE001
                log(f"History: could not read draft {d.get('draft_id')}: {exc}")
                continue
            rounds = (d.get("settings") or {}).get("rounds") or max((p.get("round") or 0 for p in raw), default=0)
            picks = [{
                "round": p.get("round"),
                "pos": (p.get("metadata") or {}).get("position"),
                "user": p.get("picked_by"),
                "name": " ".join(x for x in ((p.get("metadata") or {}).get("first_name"),
                                             (p.get("metadata") or {}).get("last_name")) if x),
            } for p in raw]
            drafts.append({"season": str(d.get("season") or lg.get("season")),
                           "kind": "rookie" if rounds <= 5 else "startup",
                           "rounds": rounds, "picks": picks})
        league_id = lg.get("previous_league_id")
    drafts.sort(key=lambda d: d["season"])
    log(f"History: {len(drafts)} completed drafts "
        f"({', '.join(d['season'] + ' ' + d['kind'] for d in drafts)})")
    return drafts


def round_priors(drafts, rounds):
    """How this league actually spends rookie picks by round.

    For each round, each position's share of picks vs an even 25% split,
    smoothed (+1 per position) and square-root damped, clamped 0.55-1.35, then
    used as the round weight. Rounds past the history reuse the last one.
    """
    counts = {}
    for d in drafts:
        if d["kind"] != "rookie":
            continue
        for p in d["picks"]:
            if p["pos"] in FANTASY_POS and p["round"]:
                counts.setdefault(p["round"], {pos: 0 for pos in FANTASY_POS})[p["pos"]] += 1
    if not counts:
        return {}, {}
    priors = {}
    for rnd in range(1, rounds + 1):
        c = counts.get(rnd) or counts[max(counts)]
        total = sum(c.values())
        priors[rnd] = {}
        for pos in FANTASY_POS:
            share = (c[pos] + 1) / (total + 4)
            hist = max(0.55, min(1.35, (share / 0.25) ** 0.5))
            priors[rnd][pos] = round(hist, 3)
    return priors, {str(r): c for r, c in sorted(counts.items())}


def manager_tendencies(drafts, rosters, teams):
    """Each current manager's draft habits, from every draft they made here.

    Rookie picks count fully; startup picks in rounds 1-10 count 0.4 (startup
    boards are mostly about veterans). Preference for a position = the
    manager's share there vs the league's, shrunk toward the league with six
    phantom league-average picks, square-root damped, clamped 0.85-1.2.
    """
    user_to_roster = {r.get("owner_id"): r["roster_id"] for r in rosters or [] if r.get("owner_id")}
    for r in rosters or []:
        for co in r.get("co_owners") or []:
            user_to_roster.setdefault(co, r["roster_id"])
    own = {}
    league = {pos: 0.0 for pos in FANTASY_POS}
    rookie_log = {}
    for d in drafts:
        for p in d["picks"]:
            if p["pos"] not in FANTASY_POS:
                continue
            if d["kind"] == "rookie":
                weight = 1.0
            elif (p["round"] or 99) <= 10:
                weight = 0.4
            else:
                continue
            league[p["pos"]] += weight
            rid = user_to_roster.get(p["user"])
            if rid is None:
                continue
            own.setdefault(rid, {pos: 0.0 for pos in FANTASY_POS})[p["pos"]] += weight
            if d["kind"] == "rookie":
                rookie_log.setdefault(rid, []).append(
                    {"season": d["season"], "round": p["round"], "pos": p["pos"], "name": p["name"]})
    league_total = sum(league.values())
    if not league_total:
        return {}
    shares = {pos: league[pos] / league_total for pos in FANTASY_POS}
    out = {}
    k = 6.0
    for rid in teams:
        mine = own.get(rid, {pos: 0.0 for pos in FANTASY_POS})
        total = sum(mine.values())
        pref, labels = {}, []
        for pos in FANTASY_POS:
            if not shares[pos]:
                pref[pos] = 1.0
                continue
            raw = ((mine[pos] + k * shares[pos]) / (total + k)) / shares[pos]
            pref[pos] = round(max(0.85, min(1.2, raw ** 0.5)), 3)
        for pos in sorted(FANTASY_POS, key=lambda x: -pref[x]):
            if pref[pos] >= 1.06:
                labels.append(f"Leans {pos}")
        for pos in sorted(FANTASY_POS, key=lambda x: pref[x]):
            if pref[pos] <= 0.92:
                labels.append(f"Avoids {pos}")
        rookie = rookie_log.get(rid, [])
        out[rid] = {
            "pref": pref,
            "labels": labels[:2],
            "rookie_picks": sorted(rookie, key=lambda x: (x["season"], x["round"])),
            "rookie_counts": {pos: sum(1 for x in rookie if x["pos"] == pos) for pos in FANTASY_POS},
            "weighted_picks": round(total, 1),
        }
    return out


def pick_owners(traded, year, rounds, original_order):
    owner = {(r, rid): rid for r in range(1, rounds + 1) for rid in original_order}
    for p in traded or []:
        if str(p.get("season")) == str(year) and (p.get("round"), p.get("roster_id")) in owner:
            owner[(p["round"], p["roster_id"])] = p["owner_id"]
    return owner


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def build_pool(year, season, scoring, mult, target):
    mddb = source_mddb(year)
    espn = source_espn_board(year)
    leaders = college_leaders(season)

    by_name = {}
    for p in leaders.values():
        if p["pos"] in FANTASY_POS:
            by_name.setdefault(norm(p["name"]), []).append(p)

    pool = {}

    def add(name, pos, school=None):
        key = norm(name)
        entry = pool.setdefault(key, {"key": key, "name": name, "pos": pos, "school": school,
                                      "mddb_rank": None, "espn_rank": None, "espn_id": None})
        if school and not entry["school"]:
            entry["school"] = school
        return entry

    for r in mddb:
        if r["pos"] in FANTASY_POS:
            add(r["name"], r["pos"], r["school"])["mddb_rank"] = r["rank"]
    for r in espn:
        if r["pos"] in FANTASY_POS:
            e = add(r["name"], r["pos"])
            e["espn_rank"] = r["rank"]
            e["espn_id"] = e["espn_id"] or r["espn_id"]

    # Link consensus prospects to their college stats.
    for e in pool.values():
        if not e["espn_id"]:
            matches = [p for p in by_name.get(e["key"], []) if p["pos"] == e["pos"]] or by_name.get(e["key"], [])
            if matches:
                e["espn_id"] = matches[0]["espn_id"]
        e["consensus"] = True

    # Fill out the pool with productive, draft-eligible players the boards don't rank yet.
    have_ids = {e["espn_id"] for e in pool.values() if e["espn_id"]}
    candidates = []
    for p in leaders.values():
        if p["pos"] not in FANTASY_POS or p["espn_id"] in have_ids:
            continue
        games = p["stats"].get("gamesPlayed") or 0
        if games < 2:
            continue
        ppg = fantasy_points(p["stats"], scoring) / games
        candidates.append((ppg * mult[p["pos"]], p))
    candidates.sort(key=lambda x: -x[0])
    checked = 0
    for _, p in candidates:
        if len(pool) >= target or checked >= 3 * target:
            break
        checked += 1
        cls = athlete_class(p["espn_id"])
        if cls not in ELIGIBLE_CLASSES:
            continue
        e = add(p["name"], p["pos"], p.get("school_name") or p["school"])
        e.update(espn_id=p["espn_id"], consensus=False, cls=cls)
    log(f"  prospect pool: {len(pool)} ({sum(1 for e in pool.values() if e['consensus'])} from the boards)")
    return pool, leaders, {"consensus_board": len(mddb), "espn_board": len(espn), "college_players": len(leaders)}


def value_pool(pool, leaders, season, scoring, mult):
    # Production percentile population: college players at each position with 3+ games.
    population = {pos: [] for pos in FANTASY_POS}
    for p in leaders.values():
        games = p["stats"].get("gamesPlayed") or 0
        if p["pos"] in FANTASY_POS and games >= 3:
            population[p["pos"]].append(fantasy_points(p["stats"], scoring) / games)
    for pos in FANTASY_POS:
        population[pos].sort(reverse=True)
        population[pos] = population[pos][:80]  # compare against the top of the position

    games_played = []
    for e in pool.values():
        stats_row = leaders.get(e["espn_id"]) if e.get("espn_id") else None
        log_rows = game_log(e["espn_id"], season, scoring) if e.get("espn_id") else []
        e["weekly"] = [{"week": g["week"], "pts": g["pts"], "opp": g["opp"], "at": g["at"]} for g in log_rows]
        if stats_row:
            e["headshot"] = stats_row.get("headshot")
            e["school"] = e["school"] or stats_row.get("school_name") or stats_row.get("school")
        if log_rows:
            last = log_rows[-1]
            e["last"] = {"week": last["week"], "opp": last["opp"], "at": last["at"], "result": last["result"],
                         "pts": last["pts"], "line": stat_line(e["pos"], last["stats"])}
            pts = [g["pts"] for g in log_rows]
            e["games"] = len(pts)
            e["ppg"] = round(sum(pts) / len(pts), 1)
            e["last3"] = round(sum(pts[-3:]) / len(pts[-3:]), 1)
        elif stats_row and (stats_row["stats"].get("gamesPlayed") or 0) > 0:
            g = stats_row["stats"]["gamesPlayed"]
            e["games"] = int(g)
            e["ppg"] = round(fantasy_points(stats_row["stats"], scoring) / g, 1)
            e["last3"] = None
        else:
            e["games"], e["ppg"], e["last3"] = 0, None, None
        if e["games"]:
            games_played.append(e["games"])

    progress = min(1.0, (statistics.median(games_played) if games_played else 0) / 12.0)
    w = round(0.20 + 0.20 * progress, 3)

    for e in pool.values():
        ranks = [r for r in (e["mddb_rank"], e["espn_rank"]) if r]
        e["cons_rank"] = round(sum(ranks) / len(ranks), 1) if ranks else None
        cap = capital_value(e["cons_rank"])
        if e["ppg"] is not None and e["games"]:
            pct = percentile(e["ppg"], population[e["pos"]])
            if e.get("last3") is not None and e["ppg"]:
                pct = max(0.0, min(1.0, pct + 0.1 * max(-1, min(1, (e["last3"] - e["ppg"]) / max(e["ppg"], 1)))))
            prod = 100.0 * pct
        else:
            pct, prod = None, 35.0  # no college stats yet: neutral-low
        e["prod_pct"] = round(pct * 100, 1) if pct is not None else None
        e["value"] = round(((1 - w) * cap + w * prod) * mult[e["pos"]], 2)
    return w


def update_history(board, today):
    path = DATA_DIR / "prospects_history.json"
    try:
        hist = json.loads(path.read_text())
    except Exception:  # noqa: BLE001
        hist = {"dates": [], "ranks": {}}
    if hist["dates"] and hist["dates"][-1] == today:
        idx = len(hist["dates"]) - 1
    else:
        hist["dates"].append(today)
        idx = len(hist["dates"]) - 1
        for k in hist["ranks"]:
            hist["ranks"][k].append(None)
    for e in board:
        series = hist["ranks"].setdefault(e["key"], [None] * len(hist["dates"]))
        series += [None] * (len(hist["dates"]) - len(series))
        series[idx] = e["rank"]
    # Keep about four months.
    keep = 120
    if len(hist["dates"]) > keep:
        cut = len(hist["dates"]) - keep
        hist["dates"] = hist["dates"][cut:]
        hist["ranks"] = {k: v[cut:] for k, v in hist["ranks"].items() if any(x is not None for x in v[cut:])}
    path.write_text(json.dumps(hist, ensure_ascii=False) + "\n", encoding="utf-8")

    # Movement versus about a week ago.
    dates = [dt.date.fromisoformat(d) for d in hist["dates"]]
    target = dt.date.fromisoformat(today) - dt.timedelta(days=7)
    past = max((i for i, d in enumerate(dates) if d <= target), default=0)
    for e in board:
        old = hist["ranks"].get(e["key"], [None])[past] if past < len(hist["dates"]) - 1 else None
        e["move7"] = (old - e["rank"]) if old else None


def main():
    latest = json.loads((DATA_DIR / "latest.json").read_text())
    league = fetch(f"{SLEEPER}/league/{LEAGUE_ID}")
    traded = fetch(f"{SLEEPER}/league/{LEAGUE_ID}/traded_picks")

    season = int(league.get("season"))
    draft_year = season + 1 if league.get("status") in ("in_season", "post_season", "complete") else season
    college_season = draft_year - 1
    rounds = (league.get("settings") or {}).get("draft_rounds") or 3
    scoring = league.get("scoring_settings") or {}
    mult, superflex, te_premium = format_multipliers(league)

    order = [row["roster_id"] for row in latest["draft"]["projected_order"]]
    teams = {int(k): v for k, v in (latest.get("teams") or {}).items()}
    target = rounds * len(order) + 24

    log(f"Mock draft {draft_year}: {rounds} rounds, {len(order)} teams, college season {college_season}")
    pool, leaders, counts = build_pool(draft_year, college_season, scoring, mult, target)
    if not pool:
        raise SystemExit("No prospects found; keeping the previous mock draft.")
    w = value_pool(pool, leaders, college_season, scoring, mult)

    board = sorted(pool.values(), key=lambda e: -e["value"])
    for i, e in enumerate(board, start=1):
        e["rank"] = i

    today = dt.datetime.now(dt.timezone.utc).astimezone(dt.timezone(dt.timedelta(hours=-6))).date().isoformat()
    update_history(board, today)

    # Run the draft.
    needs, pos_ranks, thin = team_needs(latest, superflex)
    start_needs = {r: dict(n) for r, n in needs.items()}

    # This league's own draft history: how each round is spent, and each
    # manager's habits.
    try:
        rosters = fetch(f"{SLEEPER}/league/{LEAGUE_ID}/rosters")
        drafts = league_history(rosters)
    except Exception as exc:  # noqa: BLE001
        log(f"History unavailable: {exc}")
        rosters, drafts = [], []
    priors, round_counts = round_priors(drafts, rounds)
    tendencies = manager_tendencies(drafts, rosters, teams)

    owners = pick_owners(traded, draft_year, rounds, order)
    taken = set()
    picks = []
    for rnd in range(1, rounds + 1):
        for slot, original in enumerate(order, start=1):
            owner = owners[(rnd, original)]
            team_need = needs.get(owner, {})
            best, best_score = None, -1e9
            for e in board:
                if e["key"] in taken:
                    continue
                score = (e["value"]
                         * priors.get(rnd, {}).get(e["pos"], 1.0)
                         * tendencies.get(owner, {}).get("pref", {}).get(e["pos"], 1.0)
                         * (1 + 0.8 * team_need.get(e["pos"], 0.0)))
                if e["pos"] == "QB" and not superflex and start_needs.get(owner, {}).get("QB", 0.0) <= -0.6:
                    score *= 0.6  # set at QB in a 1-QB league: a third QB rarely plays
                if score > best_score:
                    best, best_score = e, score
            if best is None:
                break
            context = needs_summary(team_need, pos_ranks.get(owner, {}), thin.get(owner, ()))
            context["tendency"] = tendencies.get(owner, {}).get("labels", [])
            taken.add(best["key"])
            top_available = next(e for e in board if e["key"] not in taken or e is best)
            need_here = team_need.get(best["pos"], 0.0)
            pos_rank = pos_ranks.get(owner, {}).get(best["pos"])
            leans = f"Leans {best['pos']}" in context["tendency"]
            if need_here >= 0.15:
                reason = f"Fills a {best['pos']} need ({ordinal(pos_rank)} at {best['pos']})" if pos_rank else f"Fills a {best['pos']} need"
            elif best["pos"] in context["thin"]:
                reason = f"Adds {best['pos']} depth"
            elif leans and best is not top_available:
                reason = f"Manager leans {best['pos']}"
            elif best is top_available:
                reason = "Best available"
            else:
                reason = "Value pick"
            if owner in needs:
                needs[owner][best["pos"]] = max(-0.6, needs[owner].get(best["pos"], 0.0) - 0.2)
            picks.append({
                "round": rnd,
                "pick": slot,
                "label": f"{rnd}.{slot:02d}",
                "overall": (rnd - 1) * len(order) + slot,
                "owner": owner,
                "owner_team": teams.get(owner, {}).get("team", f"Team {owner}"),
                "original": original,
                "original_team": teams.get(original, {}).get("team", f"Team {original}"),
                "traded": owner != original,
                "prospect": best["key"],
                "reason": reason,
                "context": context,
            })

    def public(e):
        keys = ("key", "name", "pos", "school", "cls", "espn_id", "headshot", "rank", "value", "cons_rank",
                "mddb_rank", "espn_rank", "prod_pct", "ppg", "last3", "games", "last", "weekly", "move7", "consensus")
        return {k: e.get(k) for k in keys}

    out = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "draft_year": draft_year,
        "college_season": college_season,
        "rounds": rounds,
        "teams": len(order),
        "format": {"superflex": superflex, "ppr": scoring.get("rec", 0), "te_premium": te_premium,
                   "position_multipliers": mult},
        "weights": {"production": w, "consensus": round(1 - w, 3)},
        "sources": counts,
        "picks": picks,
        "board": [public(e) for e in board],
        "needs": {str(k): {p: round(v, 3) for p, v in n.items()} for k, n in start_needs.items()},
        "needs_ranks": {str(k): v for k, v in pos_ranks.items()},
        "thin": {str(k): v for k, v in thin.items()},
        "history": {
            "drafts": [{"season": d["season"], "kind": d["kind"], "rounds": d["rounds"], "picks": len(d["picks"])}
                       for d in drafts],
            "round_counts": round_counts,
            "round_priors": {str(r): v for r, v in priors.items()},
        },
        "tendencies": {str(k): v for k, v in tendencies.items()},
        "rosters": roster_plans(latest, league, picks, board),
    }
    (DATA_DIR / "mock_draft.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    log(f"Wrote {len(picks)} picks and a {len(board)}-player board (production weight {w}).")


if __name__ == "__main__":
    main()
