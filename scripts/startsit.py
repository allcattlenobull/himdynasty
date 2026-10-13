#!/usr/bin/env python3
"""Weekly start/sit for every HIM Dynasty roster, plus the analytics data trove.

Sources (public, no keys):
  * Sleeper: this week's projections (scored here with the league's own
    settings), injuries, rosters, current lineups, and league matchups.
  * nflverse play-by-play: EPA, success rate, CPOE, air yards, red zone,
    end zone, deep passing, run gaps, pass rate over expected.
  * FTN charting (via nflverse): blitzes, play action, screens, box counts,
    catchable/contested balls, drops, out-of-pocket throws.
  * Next Gen Stats (via nflverse): separation, cushion, YAC over expected,
    rush yards over expected, time to throw, aggressiveness.
  * nflverse snap counts (to estimate routes run) and schedules (Vegas
    spread and total, so implied team totals).

How the start/sit call is made
  1. Projection = Sleeper's projection in this league's scoring. A season of
     graded projections in the league's own tracker found that adjusting
     Sleeper by a matchup index did not make it more accurate, so matchups
     explain the call; they do not override the number.
  2. Each team's best lineup is chosen slot by slot from players who are
     playing and not ruled out.
  3. Close calls (within about a point) are broken by the team's weekly
     matchup: a projected underdog takes the higher-ceiling player, a big
     favorite takes the steadier one.
  4. Every player gets reasons for and against from his usage, efficiency,
     the opposing defense, and the Vegas line. A "sit" is only ever given
     when someone better is available for that slot; a starter with a bad
     matchup is told to start anyway when every alternative is worse.

Writes docs/data/startsit.json and docs/data/splits.json.
Set STARTSIT_LOCAL to a folder of downloaded files to run offline.
"""

import csv
import datetime as dt
import gzip
import io
import json
import math
import os
import statistics
import sys
import time
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analytics_data import league_points as nflverse_points  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from league_pointer import current_league_id  # noqa: E402

LEAGUE_ID = current_league_id()
DATA_DIR = Path(__file__).resolve().parent.parent / "docs" / "data"
LOCAL = os.environ.get("STARTSIT_LOCAL")
NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download"
GAMES = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
DP_IDS = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv"
SLEEPER = "https://api.sleeper.app/v1"
SLEEPER_COM = "https://api.sleeper.com"

OFFENSE = ("QB", "RB", "WR", "TE")
ALL_POS = ("QB", "RB", "WR", "TE", "K", "DEF")
TEAM_FIX = {"LA": "LAR"}
UNAVAILABLE = {"Out", "IR", "PUP", "Sus", "NA", "DNR", "COV"}
SLOT_ELIGIBLE = {
    "QB": ("QB",), "RB": ("RB",), "WR": ("WR",), "TE": ("TE",), "K": ("K",), "DEF": ("DEF",),
    "WRRB_FLEX": ("WR", "RB"), "REC_FLEX": ("WR", "TE"), "FLEX": ("RB", "WR", "TE"),
    "SUPER_FLEX": ("QB", "RB", "WR", "TE"),
}
FILL_ORDER = ("QB", "RB", "WR", "TE", "K", "DEF", "WRRB_FLEX", "REC_FLEX", "FLEX", "SUPER_FLEX")
POS_SD = {"QB": 7.5, "RB": 7.0, "WR": 7.0, "TE": 5.5, "K": 4.0, "DEF": 5.0}
ROUTE_RATE = {"WR": 0.97, "TE": 0.78, "RB": 0.62}  # share of on-field pass snaps spent running a route
TEAM_NAMES = {
    "ARI": "Cardinals", "ATL": "Falcons", "BAL": "Ravens", "BUF": "Bills", "CAR": "Panthers", "CHI": "Bears",
    "CIN": "Bengals", "CLE": "Browns", "DAL": "Cowboys", "DEN": "Broncos", "DET": "Lions", "GB": "Packers",
    "HOU": "Texans", "IND": "Colts", "JAX": "Jaguars", "KC": "Chiefs", "LV": "Raiders", "LAC": "Chargers",
    "LAR": "Rams", "MIA": "Dolphins", "MIN": "Vikings", "NE": "Patriots", "NO": "Saints", "NYG": "Giants",
    "NYJ": "Jets", "PHI": "Eagles", "PIT": "Steelers", "SF": "49ers", "SEA": "Seahawks", "TB": "Buccaneers",
    "TEN": "Titans", "WAS": "Commanders",
}


# --------------------------------------------------------------------------- #
# Fetching
# --------------------------------------------------------------------------- #

def log(msg):
    print(f"[startsit] {msg}", flush=True)


def fetch_bytes(url, name=None, retries=3):
    if LOCAL and name and (Path(LOCAL) / name).exists():
        return (Path(LOCAL) / name).read_bytes()
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "him-dynasty-startsit"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (attempt + 1))
    raise last


def text(url, name=None):
    data = fetch_bytes(url, name)
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    return data.decode("utf-8", "replace")


def csv_rows(url, name=None, optional=False):
    try:
        return list(csv.DictReader(io.StringIO(text(url, name))))
    except Exception as e:  # noqa: BLE001
        if optional:
            log(f"skipped {url.rsplit('/', 1)[-1]}: {e}")
            return []
        raise


def jget(url, name=None):
    return json.loads(text(url, name))


def num(x):
    if x in (None, "", "NA", "NaN"):
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if v == v else None


def n0(x):
    v = num(x)
    return 0.0 if v is None else v


def truthy(x):
    return str(x).upper() in ("1", "TRUE", "1.0")


def tm(team):
    return TEAM_FIX.get(team, team) if team else team


def div(a, b, scale=1.0, nd=1):
    if not b:
        return None
    return round(a / b * scale, nd)


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


# --------------------------------------------------------------------------- #
# Play-by-play
# --------------------------------------------------------------------------- #

def load_plays(pbp, ftn):
    """Regular-season scrimmage plays with the FTN charting fields attached."""
    chart = {}
    for r in ftn:
        try:
            chart[(r["nflverse_game_id"], int(float(r["nflverse_play_id"])))] = r
        except (KeyError, ValueError):
            continue
    plays = []
    for r in pbp:
        if r.get("season_type") != "REG" or r.get("play_type") not in ("pass", "run"):
            continue
        if truthy(r.get("play_deleted")) or truthy(r.get("aborted_play")):
            continue
        try:
            pid = int(float(r["play_id"]))
        except (KeyError, ValueError):
            continue
        c = chart.get((r["game_id"], pid))
        dropback = truthy(r.get("qb_dropback"))
        scramble = truthy(r.get("qb_scramble"))
        sack = truthy(r.get("sack"))
        attempt = truthy(r.get("pass_attempt")) and not sack
        p = {
            "g": r["game_id"], "w": int(float(r["week"])), "off": tm(r["posteam"]), "def": tm(r["defteam"]),
            "drive": r.get("fixed_drive") or r.get("drive"), "down": num(r.get("down")),
            "yl": num(r.get("yardline_100")), "wp": num(r.get("wp")), "half_sec": num(r.get("half_seconds_remaining")),
            "qtr": num(r.get("qtr")), "db": dropback, "scr": scramble, "sack": sack, "att": attempt,
            "cmp": truthy(r.get("complete_pass")), "int": truthy(r.get("interception")),
            "fuml": truthy(r.get("fumble_lost")),
            "ptd": truthy(r.get("pass_touchdown")), "rtd": truthy(r.get("rush_touchdown")),
            "air": num(r.get("air_yards")), "yac": num(r.get("yards_after_catch")),
            "yds": n0(r.get("yards_gained")), "pyd": n0(r.get("passing_yards")), "ryd": n0(r.get("rushing_yards")),
            "epa": num(r.get("epa")), "qb_epa": num(r.get("qb_epa")), "succ": truthy(r.get("success")),
            "cpoe": num(r.get("cpoe")), "pass_oe": num(r.get("pass_oe")),
            "hit": truthy(r.get("qb_hit")) or sack,
            "passer": r.get("passer_id") if r.get("passer_id") not in ("", "NA") else None,
            "rusher": r.get("rusher_player_id") if r.get("rusher_player_id") not in ("", "NA") else None,
            "rec": r.get("receiver_player_id") if r.get("receiver_player_id") not in ("", "NA") else None,
            "gap": r.get("run_gap") or "", "loc": r.get("run_location") or "",
            "ftn": c is not None,
        }
        if c is not None:
            p.update({
                "blitz": n0(c.get("n_blitzers")) > 0, "pa": truthy(c.get("is_play_action")),
                "screen": truthy(c.get("is_screen_pass")), "oop": truthy(c.get("is_qb_out_of_pocket")),
                "box": num(c.get("n_defense_box")), "catchable": truthy(c.get("is_catchable_ball")),
                "contested": truthy(c.get("is_contested_ball")), "drop": truthy(c.get("is_drop")),
                "created": truthy(c.get("is_created_reception")), "iw": truthy(c.get("is_interception_worthy")),
                "rushers": num(c.get("n_pass_rushers")),
            })
        if dropback and scramble and not p["passer"]:
            p["passer"] = p["rusher"]
        plays.append(p)
    return plays


def neutral(p):
    return (p["wp"] is not None and 0.2 <= p["wp"] <= 0.8 and (p["down"] or 0) in (1, 2, 3)
            and (p["half_sec"] or 0) > 120 and (p["qtr"] or 0) <= 4)


def accumulate(plays):
    """Raw counts per player-week, team-week (offense) and defense-week."""
    pw = defaultdict(Counter)   # (gsis, week) -> counts
    tw = defaultdict(Counter)   # (team, week) -> offense counts
    dw = defaultdict(Counter)   # (team, week) -> defense counts
    team_games = defaultdict(set)
    rz_drives = defaultdict(set)
    for p in plays:
        w, off, de = p["w"], p["off"], p["def"]
        team_games[off].add((p["g"], w))
        T, D = tw[(off, w)], dw[(de, w)]
        T["plays"] += 1
        D["plays"] += 1
        epa = p["epa"] or 0.0
        if neutral(p) and p["pass_oe"] is not None:
            T["neu_n"] += 1
            T["neu_poe"] += p["pass_oe"]
            D["neu_n"] += 1
            D["neu_poe"] += p["pass_oe"]
        if p["yl"] is not None and p["yl"] <= 20:
            rz_drives[off].add((p["g"], p["drive"]))
            T["rz_plays"] += 1
            D["rz_plays"] += 1
            if p["ptd"] or p["rtd"]:
                D["rz_td"] += 1
                T["rz_td"] += 1
        # Dropbacks
        if p["db"]:
            T["db"] += 1
            D["db"] += 1
            D["db_epa"] += epa
            D["db_succ"] += p["succ"]
            D["sack"] += p["sack"]
            D["hit"] += p["hit"]
            T["sack"] += p["sack"]
            if p["ftn"]:
                D["ftn_db"] += 1
                D["bz"] += p.get("blitz", False)
                T["ftn_db"] += 1
                T["bz_db"] += p.get("blitz", False)
            q = p["passer"]
            if q:
                P = pw[(q, w)]
                P["db"] += 1
                P["db_epa"] += p["qb_epa"] if p["qb_epa"] is not None else epa
                P["db_succ"] += p["succ"]
                P["sack"] += p["sack"]
                P["hit"] += p["hit"]
                if p["scr"]:
                    P["scr"] += 1
                    P["scr_yd"] += p["ryd"]
                if p["ftn"]:
                    P["ftn_db"] += 1
                    key = "bz" if p.get("blitz") else "nbz"
                    P[f"{key}_db"] += 1
                    P[f"{key}_epa"] += epa
                    P[f"{key}_sack"] += p["sack"]
                    if p["att"]:
                        P[f"{key}_att"] += 1
                        P[f"{key}_cmp"] += p["cmp"]
                        P[f"{key}_yd"] += p["pyd"]
                    if p.get("pa"):
                        P["pa_db"] += 1
                        P["pa_epa"] += epa
                    if p.get("oop"):
                        P["oop_db"] += 1
                        P["oop_epa"] += epa
                    if p.get("screen"):
                        P["screen_att"] += 1
                    P["iw"] += p.get("iw", False)
            if p["att"]:
                D["att"] += 1
                T["att"] += 1
                big = p["pyd"] >= 20
                D["exp_pass"] += big
                deep = p["air"] is not None and p["air"] >= 20
                if deep:
                    D["deep_att"] += 1
                    D["deep_epa"] += epa
                    D["deep_cmp"] += p["cmp"]
                elif p["air"] is not None:
                    D["short_att"] += 1
                    D["short_epa"] += epa
                if q:
                    P = pw[(q, w)]
                    P["att"] += 1
                    P["cmp"] += p["cmp"]
                    P["pyd"] += p["pyd"]
                    P["ptd"] += p["ptd"]
                    P["int"] += p["int"]
                    if p["air"] is not None:
                        P["air_att"] += p["air"]
                        P["air_n"] += 1
                    if p["cpoe"] is not None:
                        P["cpoe_sum"] += p["cpoe"]
                        P["cpoe_n"] += 1
                    if deep:
                        P["deep_att"] += 1
                        P["deep_cmp"] += p["cmp"]
                        P["deep_epa"] += epa
                    if p["yl"] is not None and p["yl"] <= 20:
                        P["rz_att"] += 1
                        P["rz_ptd"] += p["ptd"]
                r = p["rec"]
                if r:
                    T["tgt"] += 1
                    if p["air"] is not None:
                        T["air"] += p["air"]
                    R = pw[(r, w)]
                    R["tgt"] += 1
                    R["rec"] += p["cmp"]
                    R["recyd"] += p["pyd"] if p["cmp"] else 0
                    R["rectd"] += p["ptd"]
                    R["rec_epa"] += epa
                    R["rec_succ"] += p["succ"]
                    if p["air"] is not None:
                        R["air"] += p["air"]
                        R["air_n"] += 1
                    if p["cmp"] and p["yac"] is not None:
                        R["yac"] += p["yac"]
                    if deep:
                        R["deep_tgt"] += 1
                        T["deep_tgt"] += 1
                    if p["yl"] is not None and p["yl"] <= 20:
                        R["rz_tgt"] += 1
                        T["rz_tgt"] += 1
                    if p["air"] is not None and p["yl"] is not None and p["air"] >= p["yl"]:
                        R["ez_tgt"] += 1
                        T["ez_tgt"] += 1
                    if p["down"] == 3:
                        R["third_tgt"] += 1
                        T["third_tgt"] += 1
                    if p["ftn"]:
                        R["ftn_tgt"] += 1
                        T["ftn_tgt"] += 1
                        R["catchable"] += p.get("catchable", False)
                        R["contested"] += p.get("contested", False)
                        R["drop"] += p.get("drop", False)
                        R["created"] += p.get("created", False)
                        if p.get("blitz"):
                            R["bz_tgt"] += 1
                            T["bz_tgt"] += 1
                        if p.get("pa"):
                            R["pa_tgt"] += 1
                            T["pa_tgt"] += 1
                        if p.get("screen"):
                            R["screen_tgt"] += 1
                    p["_target_of"] = r
        # Runs
        elif p["rusher"]:
            D["car"] += 1
            D["run_epa"] += epa
            D["run_succ"] += p["succ"]
            D["exp_run"] += p["ryd"] >= 10
            T["car"] += 1
            if p["ftn"] and p.get("box") is not None:
                D["box_n"] += 1
                D["box8"] += p["box"] >= 8
            R = pw[(p["rusher"], w)]
            R["car"] += 1
            R["ryd"] += p["ryd"]
            R["rtd"] += p["rtd"]
            R["run_epa"] += epa
            R["run_succ"] += p["succ"]
            R["exp_run"] += p["ryd"] >= 10
            R["stuff"] += p["ryd"] <= 0
            if p["yl"] is not None:
                if p["yl"] <= 20:
                    R["rz_car"] += 1
                    T["rz_car"] += 1
                if p["yl"] <= 10:
                    R["i10_car"] += 1
                    T["i10_car"] += 1
                if p["yl"] <= 5:
                    R["i5_car"] += 1
                    T["i5_car"] += 1
                    R["gl_td"] += p["rtd"]
            if p["gap"] in ("guard",) or p["loc"] == "middle":
                R["in_car"] += 1
                R["in_yd"] += p["ryd"]
            elif p["gap"] in ("tackle", "end"):
                R["out_car"] += 1
                R["out_yd"] += p["ryd"]
            if p["ftn"] and p.get("box") is not None:
                R["box_n"] += 1
                if p["box"] >= 8:
                    R["stack_car"] += 1
                    R["stack_yd"] += p["ryd"]
                elif p["box"] <= 6:
                    R["light_car"] += 1
                    R["light_yd"] += p["ryd"]
                else:
                    R["mid_car"] += 1
                    R["mid_yd"] += p["ryd"]
        # Turnovers for offense profile
        if p["int"] or p["fuml"]:
            T["give"] += 1
    for team, drives in rz_drives.items():
        T_games = len(team_games[team]) or 1
        tw[(team, 0)]["rz_trips"] = len(drives)
        tw[(team, 0)]["games"] = T_games
    return pw, tw, dw, team_games


def sum_weeks(acc, key, weeks):
    out = Counter()
    for w in weeks:
        c = acc.get((key, w))
        if c:
            out.update(c)
    return out


# --------------------------------------------------------------------------- #
# Player metrics
# --------------------------------------------------------------------------- #

def player_metrics(pos, c, team, routes, snaps_pct, ngs):
    """All derived numbers for one player over a set of weeks.

    c: summed player counts; team: summed team counts over the same weeks.
    """
    m = {}
    g = c.get("_games", 0)
    m["g"] = g
    if snaps_pct:
        m["snap"] = round(statistics.mean(snaps_pct), 1)
    if pos == "QB":
        db, att = c["db"], c["att"]
        m.update({
            "db": db, "db_pg": div(db, g), "epa_db": div(c["db_epa"], db, nd=3), "succ": div(c["db_succ"], db, 100),
            "cmp_pct": div(c["cmp"], att, 100), "ypa": div(c["pyd"], att, nd=2), "adot": div(c["air_att"], c["air_n"]),
            "cpoe": div(c["cpoe_sum"], c["cpoe_n"]), "deep_rate": div(c["deep_att"], att, 100),
            "deep_epa": div(c["deep_epa"], c["deep_att"], nd=3), "sack_rate": div(c["sack"], db, 100),
            "hit_rate": div(c["hit"], db, 100), "int_rate": div(c["int"], att, 100), "td_rate": div(c["ptd"], att, 100),
            "iw_rate": div(c["iw"], c["ftn_db"], 100), "scr_rate": div(c["scr"], db, 100),
            "scr_ypg": div(c["scr_yd"], g), "rz_att_pg": div(c["rz_att"], g), "rz_td": c["rz_ptd"],
            "bz_rate": div(c["bz_db"], c["ftn_db"], 100), "bz_epa": div(c["bz_epa"], c["bz_db"], nd=3),
            "nbz_epa": div(c["nbz_epa"], c["nbz_db"], nd=3), "bz_ypa": div(c["bz_yd"], c["bz_att"], nd=2),
            "nbz_ypa": div(c["nbz_yd"], c["nbz_att"], nd=2), "bz_cmp": div(c["bz_cmp"], c["bz_att"], 100),
            "bz_sack": div(c["bz_sack"], c["bz_db"], 100), "bz_db": c["bz_db"],
            "pa_rate": div(c["pa_db"], c["ftn_db"], 100), "pa_epa": div(c["pa_epa"], c["pa_db"], nd=3),
            "oop_rate": div(c["oop_db"], c["ftn_db"], 100), "oop_epa": div(c["oop_epa"], c["oop_db"], nd=3),
            "car": c["car"], "car_pg": div(c["car"], g), "ryd_pg": div(c["ryd"], g),
            "i10_car": c["i10_car"], "rtd": c["rtd"],
        })
        if ngs:
            m.update({k: ngs.get(k) for k in ("ttt", "aggr", "ngs_cpoe", "air_diff") if ngs.get(k) is not None})
    if pos in ("RB", "WR", "TE"):
        tgt, car = c["tgt"], c["car"]
        m.update({
            "tgt": tgt, "tgt_pg": div(tgt, g), "tgt_share": div(tgt, team["tgt"], 100),
            "air_share": div(c["air"], team["air"], 100) if team["air"] > 0 else None,
            "rec": c["rec"], "rec_pg": div(c["rec"], g), "recyd_pg": div(c["recyd"], g), "rectd": c["rectd"],
            "catch": div(c["rec"], tgt, 100), "ypt": div(c["recyd"], tgt, nd=2), "adot": div(c["air"], c["air_n"]),
            "yac_rec": div(c["yac"], c["rec"]), "epa_tgt": div(c["rec_epa"], tgt, nd=3),
            "rec_succ": div(c["rec_succ"], tgt, 100),
            "rz_tgt": c["rz_tgt"], "rz_tgt_share": div(c["rz_tgt"], team["rz_tgt"], 100),
            "ez_tgt": c["ez_tgt"], "deep_tgt": c["deep_tgt"], "deep_share": div(c["deep_tgt"], team["deep_tgt"], 100),
            "third_share": div(c["third_tgt"], team["third_tgt"], 100),
            "catchable": div(c["catchable"], c["ftn_tgt"], 100), "contested": div(c["contested"], c["ftn_tgt"], 100),
            "drops": c["drop"], "drop_rate": div(c["drop"], c["catchable"], 100), "created": c["created"],
            "bz_share": div(c["bz_tgt"], team["bz_tgt"], 100), "pa_share": div(c["pa_tgt"], team["pa_tgt"], 100),
            "screen_rate": div(c["screen_tgt"], c["ftn_tgt"], 100),
        })
        if m.get("tgt_share") is not None and m.get("air_share") is not None:
            m["wopr"] = round(1.5 * m["tgt_share"] / 100 + 0.7 * m["air_share"] / 100, 3)
        if routes:
            m["routes"] = round(routes)
            m["yprr"] = div(c["recyd"], routes, nd=2)
            m["tprr"] = div(tgt, routes, 100)
            m["route_rate"] = div(routes, team["db"], 100)
        if car:
            m.update({
                "car": car, "car_pg": div(car, g), "rush_share": div(car, team["car"], 100),
                "ypc": div(c["ryd"], car, nd=2), "ryd_pg": div(c["ryd"], g), "rtd": c["rtd"],
                "epa_car": div(c["run_epa"], car, nd=3), "run_succ": div(c["run_succ"], car, 100),
                "exp_run": div(c["exp_run"], car, 100), "stuff": div(c["stuff"], car, 100),
                "rz_car": c["rz_car"], "rz_car_share": div(c["rz_car"], team["rz_car"], 100),
                "i10_car": c["i10_car"], "i10_share": div(c["i10_car"], team["i10_car"], 100),
                "i5_car": c["i5_car"], "gl_td": c["gl_td"],
                "in_ypc": div(c["in_yd"], c["in_car"], nd=2), "out_ypc": div(c["out_yd"], c["out_car"], nd=2),
                "stack_rate": div(c["stack_car"], c["box_n"], 100),
                "stack_ypc": div(c["stack_yd"], c["stack_car"], nd=2), "light_ypc": div(c["light_yd"], c["light_car"], nd=2),
            })
        opp = (c["tgt"] + c["car"])
        m["opp_pg"] = div(opp, g)
        m["rz_opp_pg"] = div(c["rz_tgt"] + c["rz_car"], g)
        if ngs:
            m.update({k: ngs.get(k) for k in ("sep", "cushion", "yac_oe", "ryoe", "ryoe_pct", "box8_ngs", "ttl")
                      if ngs.get(k) is not None})
    return {k: v for k, v in m.items() if v is not None}


# --------------------------------------------------------------------------- #
# Defense and offense profiles
# --------------------------------------------------------------------------- #

def defense_profiles(dw, tw, weeks, fpa_index, pos_of, plays):
    teams = sorted({t for (t, w) in dw if w})
    prof = {}
    rb_tgt = Counter()
    te_tgt = Counter()
    wr_tgt = Counter()
    for p in plays:
        r = p.get("_target_of")
        if r:
            ps = pos_of.get(r)
            if ps == "RB":
                rb_tgt[p["def"]] += 1
            elif ps == "TE":
                te_tgt[p["def"]] += 1
            elif ps == "WR":
                wr_tgt[p["def"]] += 1
    for t in teams:
        D = sum_weeks(dw, t, weeks)
        games = sum(1 for w in weeks if (t, w) in dw)
        prof[t] = {
            "games": games,
            "pass_epa": div(D["db_epa"], D["db"], nd=3), "pass_succ": div(D["db_succ"], D["db"], 100),
            "run_epa": div(D["run_epa"], D["car"], nd=3), "run_succ": div(D["run_succ"], D["car"], 100),
            "sack_rate": div(D["sack"], D["db"], 100), "hit_rate": div(D["hit"], D["db"], 100),
            "blitz_rate": div(D["bz"], D["ftn_db"], 100), "box8_rate": div(D["box8"], D["box_n"], 100),
            "exp_pass": div(D["exp_pass"], D["att"], 100), "exp_run": div(D["exp_run"], D["car"], 100),
            "deep_epa": div(D["deep_epa"], D["deep_att"], nd=3), "short_epa": div(D["short_epa"], D["short_att"], nd=3),
            "deep_rate": div(D["deep_att"], D["att"], 100),
            "rz_td_rate": div(D["rz_td"], D["rz_plays"], 100),
            "poe_faced": div(D["neu_poe"], D["neu_n"], nd=1),
            "rb_tgt_pg": div(rb_tgt[t], games), "te_tgt_pg": div(te_tgt[t], games), "wr_tgt_pg": div(wr_tgt[t], games),
        }
        for pos in OFFENSE:
            fi = fpa_index.get(t, {}).get(pos)
            if fi:
                prof[t][f"fpa_{pos}"] = fi["avg"]
                prof[t][f"idx_{pos}"] = fi["idx"]
    # Ranks: 1 = best for the offense (most generous)
    generous_high = ["pass_epa", "pass_succ", "run_epa", "run_succ", "exp_pass", "exp_run", "deep_epa",
                     "short_epa", "rz_td_rate", "rb_tgt_pg", "te_tgt_pg", "wr_tgt_pg"] + \
                    [f"idx_{p}" for p in OFFENSE] + [f"fpa_{p}" for p in OFFENSE]
    generous_low = ["sack_rate", "hit_rate", "blitz_rate", "box8_rate"]
    for key in generous_high + generous_low:
        vals = [(t, prof[t][key]) for t in teams if prof[t].get(key) is not None]
        rev = key in generous_high
        for i, (t, _) in enumerate(sorted(vals, key=lambda kv: kv[1], reverse=rev), start=1):
            prof[t].setdefault("rk", {})[key] = i
    return prof


def offense_profiles(tw, weeks, team_games):
    prof = {}
    for t in sorted({t for (t, w) in tw if w}):
        T = sum_weeks(tw, t, weeks)
        games = len({g for g, w in team_games[t] if w in weeks}) or 1
        meta = tw.get((t, 0), {})
        prof[t] = {
            "proe": div(T["neu_poe"], T["neu_n"]), "plays_pg": div(T["plays"], games),
            "db_pg": div(T["db"], games), "sack_rate": div(T["sack"], T["db"], 100),
            "give_pg": div(T["give"], games, nd=2), "rz_trips_pg": div(meta.get("rz_trips", 0), meta.get("games", 1)),
            "rz_td_rate": div(T["rz_td"], T["rz_plays"], 100), "bz_faced": div(T["bz_db"], T["ftn_db"], 100),
        }
    return prof


def fpa_indexes(stat_rows, sc):
    """Fantasy points allowed per defense and position, opponent-adjusted.

    Same method as the league's Fantasy Points Allowed Tracker:
    raw index = 100 x allowed / expected, expected = each opponent's average
    at that position in its other games; stable = shrunk toward 100 by
    games / (games + 4).
    """
    allowed = defaultdict(lambda: defaultdict(float))  # (def, week) -> pos -> pts
    scored = defaultdict(lambda: defaultdict(float))   # (off, week) -> pos -> pts
    opp = {}
    for s in stat_rows:
        if s.get("season_type") != "REG" or s.get("position") not in OFFENSE:
            continue
        w = int(s["week"])
        off, de = tm(s["team"]), tm(s["opponent_team"])
        pts = nflverse_points(s, sc)
        allowed[(de, w)][s["position"]] += pts
        scored[(off, w)][s["position"]] += pts
        opp[(off, w)] = de
        opp[(de, w)] = off
    weeks_of = defaultdict(list)
    for (t, w) in opp:
        weeks_of[t].append(w)
    out = {}
    for d in TEAM_NAMES:
        out[d] = {}
        for pos in OFFENSE:
            al, ex = [], []
            for w in weeks_of.get(d, []):
                o = opp[(d, w)]
                al.append(allowed[(d, w)][pos])
                others = [scored[(o, v)][pos] for v in weeks_of.get(o, []) if v != w]
                if others:
                    ex.append(statistics.mean(others))
            if not al or not ex or not sum(ex):
                continue
            n = len(al)
            raw = 100 * statistics.mean(al) / statistics.mean(ex)
            out[d][pos] = {"avg": round(statistics.mean(al), 2), "idx": round(100 + n / (n + 4) * (raw - 100), 1)}
    return out


# --------------------------------------------------------------------------- #
# Projections and lineups
# --------------------------------------------------------------------------- #

def league_score(stats, sc):
    s = dict(stats or {})
    if "fgmiss" in sc and "fgmiss" not in s:
        s["fgmiss"] = sum(v for k, v in s.items() if k.startswith("fgmiss_"))
    return sum(sc[k] * s[k] for k in sc if k in s and isinstance(s[k], (int, float)))


def best_lineup(slots, pool, key):
    """pool: list of dicts with pos and the sort key. Returns {slot_index: player}."""
    chosen = {}
    taken = set()
    order = sorted(range(len(slots)), key=lambda i: FILL_ORDER.index(slots[i]) if slots[i] in FILL_ORDER else 99)
    ranked = sorted(pool, key=lambda p: -p[key])
    for i in order:
        elig = SLOT_ELIGIBLE.get(slots[i])
        if not elig:
            continue
        pick = next((p for p in ranked if p["id"] not in taken and p["pos"] in elig), None)
        if pick:
            taken.add(pick["id"])
            chosen[i] = pick
    return chosen


def norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


# --------------------------------------------------------------------------- #
# Reasons
# --------------------------------------------------------------------------- #

def reasons_for(pl, sp, d, o_prof, game, dprof_all, pos_avgs):
    """Reasons for (+) and against (-) starting a player this week."""
    pros, cons = [], []
    pos = pl["pos"]
    s = (sp or {}).get("s", {})
    l3 = (sp or {}).get("l3", {})
    opp = pl.get("opp")

    def add(sign, weight, msg):
        (pros if sign > 0 else cons).append((weight, msg))

    # Vegas
    if game and game.get("implied") is not None:
        it = game["implied"]
        if pos in OFFENSE + ("K",):
            if it >= 26:
                add(1, 2 + (it - 26) / 2, f"{pl['nfl']} is expected to score {it:.1f} points (Vegas), a top offense spot this week")
            elif it <= 19:
                add(-1, 2 + (19 - it) / 2, f"{pl['nfl']} is expected to score only {it:.1f} points (Vegas)")
        if pos == "DEF" and game.get("opp_implied") is not None:
            oi = game["opp_implied"]
            if oi <= 19.5:
                add(1, 3 + (19.5 - oi), f"{opp} is expected to score just {oi:.1f} points")
            elif oi >= 25:
                add(-1, 2 + (oi - 25) / 2, f"{opp} is expected to score {oi:.1f} points")
        sp_line = game.get("spread")  # positive = this team favored
        if sp_line is not None:
            if pos == "RB" and sp_line >= 6:
                add(1, 1.5, f"{pl['nfl']} is a {sp_line:g}-point favorite: leads mean more running late")
            if pos == "RB" and sp_line <= -7 and (s.get("tgt_share") or 0) < 10:
                add(-1, 1.5, f"{pl['nfl']} is a {abs(sp_line):g}-point underdog and he isn't a big part of the passing game")
            if pos in ("WR", "TE", "QB") and sp_line <= -6:
                add(1, 1.0, f"{pl['nfl']} is a {abs(sp_line):g}-point underdog: trailing teams throw more")
        if pos == "K" and game.get("dome"):
            add(1, 1.0, "Indoor game: no wind or weather")

    # Opposing defense
    if d:
        rk = d.get("rk", {})
        n = len(dprof_all) or 32
        idx = d.get(f"idx_{pos}")
        if idx is not None and pos in OFFENSE:
            r = rk.get(f"idx_{pos}")
            if idx >= 106:
                add(1, (idx - 100) / 4, f"{opp} gives up {idx - 100:.0f}% more fantasy points to {pos}s than expected ({ordinal(r)} easiest)")
            elif idx <= 94:
                add(-1, (100 - idx) / 4, f"{opp} holds {pos}s to {100 - idx:.0f}% fewer fantasy points than expected ({ordinal(n + 1 - r)} toughest)")
        if pos in ("QB", "WR", "TE") and d.get("pass_epa") is not None:
            r = rk.get("pass_epa")
            if r <= 6:
                add(1, 2, f"{opp}'s pass defense is {ordinal(r)} worst by EPA per dropback")
            elif r >= n - 5:
                add(-1, 2, f"{opp}'s pass defense is {ordinal(n + 1 - r)} best by EPA per dropback")
        if pos == "RB" and d.get("run_epa") is not None:
            r = rk.get("run_epa")
            if r <= 6:
                add(1, 2, f"{opp}'s run defense is {ordinal(r)} worst by EPA per carry")
            elif r >= n - 5:
                add(-1, 2, f"{opp}'s run defense is {ordinal(n + 1 - r)} best by EPA per carry")
        poe = d.get("poe_faced")
        if poe is not None:
            if pos == "RB" and poe <= -4:
                add(1, 1.2, f"Teams run on {opp} ({abs(poe):.0f}% below their usual pass rate): a run funnel")
            if pos in ("WR", "TE", "QB") and poe >= 4:
                add(1, 1.2, f"Teams throw on {opp} ({poe:.0f}% above their usual pass rate): a pass funnel")
        # QB vs blitz
        if pos == "QB" and d.get("blitz_rate") is not None and s.get("bz_db", 0) >= 15:
            r = rk.get("blitz_rate")
            heavy = r is not None and r >= n - 7  # rank 1 = blitzes least (generous_low)
            if heavy and s.get("bz_epa") is not None:
                avg = pos_avgs.get("qb_bz_epa", 0)
                if s["bz_epa"] - avg >= 0.08:
                    add(1, 2.5, f"{opp} blitzes {d['blitz_rate']:.0f}% of dropbacks ({ordinal(n + 1 - r)} most) and he's {s['bz_epa']:+.2f} EPA per dropback against the blitz")
                elif s["bz_epa"] - avg <= -0.08:
                    add(-1, 2.5, f"{opp} blitzes {d['blitz_rate']:.0f}% of dropbacks ({ordinal(n + 1 - r)} most); he's {s['bz_epa']:+.2f} EPA per dropback against the blitz")
        if pos == "QB" and d.get("hit_rate") is not None:
            r = rk.get("hit_rate")
            if r is not None and r >= n - 5 and (s.get("sack_rate") or 0) >= 7:
                add(-1, 1.8, f"{opp} hits or sacks the QB on {d['hit_rate']:.0f}% of dropbacks and he's sacked {s['sack_rate']:.0f}% of the time")
        # Deep threat vs deep defense
        if pos in ("WR", "TE") and (s.get("adot") or 0) >= 12 and d.get("deep_epa") is not None:
            r = rk.get("deep_epa")
            if r <= 8:
                add(1, 1.8, f"Deep threat ({s['adot']:.1f}-yard aDOT) vs a defense that's {ordinal(r)} worst on deep passes")
            elif r >= n - 7:
                add(-1, 1.5, f"Deep threat ({s['adot']:.1f}-yard aDOT) vs a defense that's {ordinal(n + 1 - r)} best on deep passes")
        # RB receiving vs defenses that feed backs
        if pos == "RB" and (s.get("tgt_share") or 0) >= 10 and d.get("rb_tgt_pg") is not None:
            r = rk.get("rb_tgt_pg")
            if r <= 8:
                add(1, 1.5, f"{opp} allows {d['rb_tgt_pg']:.1f} RB targets a game ({ordinal(r)} most) and he earns {s['tgt_share']:.0f}% of targets")
        if pos == "TE" and d.get("te_tgt_pg") is not None:
            r = rk.get("te_tgt_pg")
            if r <= 6:
                add(1, 1.2, f"{opp} allows {d['te_tgt_pg']:.1f} TE targets a game ({ordinal(r)} most)")
        # Stacked boxes
        if pos == "RB" and d.get("box8_rate") is not None and s.get("stack_ypc") is not None and s.get("ypc") is not None:
            r = rk.get("box8_rate")
            if r is not None and r >= n - 7 and s["stack_ypc"] <= s["ypc"] - 1:
                add(-1, 1.2, f"{opp} stacks 8+ in the box {d['box8_rate']:.0f}% of runs; he averages {s['stack_ypc']:.1f} YPC into stacked boxes")
        # Red zone
        if d.get("rz_td_rate") is not None:
            r = rk.get("rz_td_rate")
            if pos == "RB" and (s.get("rz_car_share") or 0) >= 40 and r <= 10:
                add(1, 1.8, f"Gets {s['rz_car_share']:.0f}% of his team's red-zone carries; {opp} allows TDs on {d['rz_td_rate']:.0f}% of red-zone plays")
        # DEF vs offense
        if pos == "DEF" and o_prof:
            if (o_prof.get("sack_rate") or 0) >= 8:
                add(1, 1.8, f"{opp} allows a sack on {o_prof['sack_rate']:.0f}% of dropbacks")
            if (o_prof.get("give_pg") or 0) >= 1.2:
                add(1, 1.5, f"{opp} turns it over {o_prof['give_pg']:.1f} times a game")

    # Usage
    if pos in ("WR", "TE", "RB"):
        if s.get("tgt_share") and l3.get("tgt_share") is not None and l3.get("g", 0) >= 2 and s.get("g", 0) >= 4:
            dlt = l3["tgt_share"] - s["tgt_share"]
            if dlt >= 5:
                add(1, 1.5 + dlt / 5, f"Target share up to {l3['tgt_share']:.0f}% over his last {l3['g']} games ({s['tgt_share']:.0f}% for the season)")
            elif dlt <= -5:
                add(-1, 1.5 + abs(dlt) / 5, f"Target share down to {l3['tgt_share']:.0f}% over his last {l3['g']} games ({s['tgt_share']:.0f}% for the season)")
        if pos == "RB" and s.get("rush_share") and l3.get("rush_share") is not None and l3.get("g", 0) >= 2 and s.get("g", 0) >= 4:
            dlt = l3["rush_share"] - s["rush_share"]
            if dlt >= 10:
                add(1, 1.5 + dlt / 10, f"Carry share up to {l3['rush_share']:.0f}% over his last {l3['g']} games")
            elif dlt <= -10:
                add(-1, 1.5 + abs(dlt) / 10, f"Carry share down to {l3['rush_share']:.0f}% over his last {l3['g']} games")
        if s.get("snap") and l3.get("snap") and s.get("g", 0) >= 4:
            dlt = l3["snap"] - s["snap"]
            if dlt >= 8:
                add(1, 1.2, f"Playing more: {l3['snap']:.0f}% of snaps lately vs {s['snap']:.0f}% for the season")
            elif dlt <= -8:
                add(-1, 1.2, f"Playing less: {l3['snap']:.0f}% of snaps lately vs {s['snap']:.0f}% for the season")
        yprr = s.get("yprr")
        if yprr is not None and pos in ("WR", "TE") and s.get("routes", 0) >= 60:
            avg = pos_avgs.get(f"{pos}_yprr")
            if avg and yprr >= avg * 1.35:
                add(1, 1.2, f"{yprr:.2f} yards per route run (est.), well above the {pos} average of {avg:.2f}")
            elif avg and yprr <= avg * 0.65:
                add(-1, 1.0, f"Only {yprr:.2f} yards per route run (est.); {pos} average is {avg:.2f}")
        if pos in ("WR", "TE") and (s.get("rz_tgt_share") or 0) >= 25 and s.get("rz_tgt", 0) >= 4:
            add(1, 1.3, f"Earns {s['rz_tgt_share']:.0f}% of his team's red-zone targets")
    if pos == "QB" and s.get("epa_db") is not None and s.get("db", 0) >= 60:
        avg = pos_avgs.get("qb_epa_db", 0)
        if s["epa_db"] - avg >= 0.1:
            add(1, 1.3, f"{s['epa_db']:+.2f} EPA per dropback, one of the more efficient QBs")
        elif s["epa_db"] - avg <= -0.1:
            add(-1, 1.3, f"{s['epa_db']:+.2f} EPA per dropback, among the least efficient QBs")
    if pos == "QB" and (s.get("scr_ypg") or 0) + (s.get("ryd_pg") or 0) >= 30:
        add(1, 1.3, f"Rushing floor: {((s.get('scr_ypg') or 0) + (s.get('ryd_pg') or 0)):.0f} rushing yards a game")

    # Running hot or cold (from analytics.json)
    fpoe = pl.get("fpoe_pg")
    if fpoe is not None and pl.get("games", 0) >= 3:
        if fpoe >= 4:
            add(-1, 0.8, f"Scoring {fpoe:.1f} a game above what his usage predicts: some regression is likely")
        elif fpoe <= -3 and (pl.get("xfp_pg") or 0) >= 12:
            add(1, 0.8, f"Usage worth {pl['xfp_pg']:.1f} points a game but scoring {abs(fpoe):.1f} less: due for more")

    # Projected volume
    ps = pl.get("ps") or {}
    if pos in ("WR", "TE", "RB") and (ps.get("tgt") or 0) >= 8:
        add(1, 1.0, f"Projected for {ps['tgt']:.1f} targets")
    if pos == "RB" and (ps.get("car") or 0) >= 16:
        add(1, 1.0, f"Projected for {ps['car']:.0f} carries")

    if pl.get("inj") == "Questionable":
        add(-1, 1.5, "Questionable: check his status before kickoff")
    if pl.get("inj") == "Doubtful":
        add(-1, 4, "Doubtful: unlikely to play")

    pros.sort(key=lambda x: -x[0])
    cons.sort(key=lambda x: -x[0])
    return [m for _, m in pros[:4]], [m for _, m in cons[:3]]


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main():
    latest = json.loads((DATA_DIR / "latest.json").read_text())
    try:
        analytics = json.loads((DATA_DIR / "analytics.json").read_text())
    except FileNotFoundError:
        analytics = {"players": []}
    season = int(latest["league"]["season"])

    state = jget(f"{SLEEPER}/state/nfl", "state.json")
    week = int(state.get("week") or 1)
    offseason = str(state.get("season")) != str(season) or state.get("season_type") not in ("regular", "pre")
    if offseason:
        log(f"Not in the regular season (state {state.get('season_type')}); no start/sit this week, splits only.")
    league = jget(f"{SLEEPER}/league/{LEAGUE_ID}", "league.json")
    sc = league.get("scoring_settings") or {}
    slots = [s for s in (league.get("roster_positions") or []) if s in SLOT_ELIGIBLE]
    rosters = jget(f"{SLEEPER}/league/{LEAGUE_ID}/rosters", "rosters.json")
    try:
        if offseason:
            raise ValueError("offseason")
        matchups = jget(f"{SLEEPER}/league/{LEAGUE_ID}/matchups/{week}", "matchups.json")
    except Exception as exc:  # noqa: BLE001
        log(f"No league matchups for week {week}: {exc}")
        matchups = []
    proj_raw = {}
    for pos in ([] if offseason or (LOCAL and (Path(LOCAL) / "proj.json").exists()) else ALL_POS):
        try:
            proj_raw[pos] = jget(f"{SLEEPER_COM}/projections/nfl/{season}/{week}?season_type=regular&position[]={pos}&order_by=pts_ppr",
                                 f"proj_{pos}.json")
        except Exception as exc:  # noqa: BLE001
            log(f"Projections for {pos} unavailable: {exc}")
            proj_raw[pos] = []
    if LOCAL and (Path(LOCAL) / "proj.json").exists():
        proj_raw = json.loads((Path(LOCAL) / "proj.json").read_text())

    log("Downloading nflverse data…")
    stats_season = season
    try:
        pbp = csv_rows(f"{NFLVERSE}/pbp/play_by_play_{season}.csv.gz", "pbp.csv.gz")
        if not any(r.get("season_type") == "REG" for r in pbp):
            raise ValueError("no regular-season plays yet")
    except Exception as exc:  # noqa: BLE001
        stats_season = season - 1
        log(f"No {season} play-by-play yet ({exc}); using {stats_season}.")
        pbp = csv_rows(f"{NFLVERSE}/pbp/play_by_play_{stats_season}.csv.gz")
    ftn = csv_rows(f"{NFLVERSE}/ftn_charting/ftn_charting_{stats_season}.csv", "ftn.csv", optional=True)
    ngs_pass = csv_rows(f"{NFLVERSE}/nextgen_stats/ngs_passing.csv.gz", "ngs_pass.csv.gz", optional=True)
    ngs_rec = csv_rows(f"{NFLVERSE}/nextgen_stats/ngs_receiving.csv.gz", "ngs_rec.csv.gz", optional=True)
    ngs_rush = csv_rows(f"{NFLVERSE}/nextgen_stats/ngs_rushing.csv.gz", "ngs_rush.csv.gz", optional=True)
    snaps = csv_rows(f"{NFLVERSE}/snap_counts/snap_counts_{stats_season}.csv", "snaps.csv", optional=True)
    stat_rows = csv_rows(f"{NFLVERSE}/stats_player/stats_player_week_{stats_season}.csv", f"stats_player_week_{stats_season}.csv")
    people = csv_rows(f"{NFLVERSE}/players/players.csv", "players.csv")
    games_rows = [g for g in csv_rows(GAMES, "games.csv") if g.get("season") == str(season)]
    ids = csv_rows(DP_IDS, "db_playerids.csv", optional=True)

    gsis_to_sleeper = {r["gsis_id"]: r["sleeper_id"] for r in ids
                       if r.get("gsis_id") not in ("", "NA", None) and r.get("sleeper_id") not in ("", "NA", None)}
    for a in analytics.get("players", []):
        if a.get("gsis") and a.get("id") and not str(a["id"]).startswith("g"):
            gsis_to_sleeper[a["gsis"]] = str(a["id"])
    sleeper_to_gsis = {v: k for k, v in gsis_to_sleeper.items()}
    pos_of = {p["gsis_id"]: p.get("position") for p in people if p.get("gsis_id")}
    name_of = {p["gsis_id"]: p.get("display_name") for p in people if p.get("gsis_id")}
    pfr_to_gsis = {p["pfr_id"]: p["gsis_id"] for p in people if p.get("pfr_id") and p.get("gsis_id")}

    plays = load_plays(pbp, ftn)
    weeks = sorted({p["w"] for p in plays})
    log(f"{len(plays)} plays, weeks {weeks}, {sum(1 for p in plays if p['ftn'])} with FTN charting")
    pw, tw, dw, team_games = accumulate(plays)

    # Team of each player in each week (from plays) and snaps
    team_of = {}
    for p in plays:
        for key in ("passer", "rusher", "rec"):
            if p.get(key):
                team_of[(p[key], p["w"])] = p["off"]
    snap_pct = {}
    for s in snaps:
        if s.get("game_type") not in (None, "", "REG"):
            continue
        gid = pfr_to_gsis.get(s.get("pfr_player_id"))
        if not gid:
            continue
        pct = n0(s.get("offense_pct"))
        pct = pct * 100 if pct <= 1 else pct
        if n0(s.get("offense_snaps")) > 0:
            snap_pct[(gid, int(s["week"]))] = pct
            team_of.setdefault((gid, int(s["week"])), tm(s.get("team")))

    # NGS season lines
    ngs = defaultdict(dict)
    for r in ngs_pass:
        if r.get("season") == str(stats_season) and r.get("week") == "0" and r.get("season_type") == "REG":
            ngs[r["player_gsis_id"]].update({"ttt": num(r["avg_time_to_throw"]), "aggr": num(r["aggressiveness"]),
                                             "ngs_cpoe": num(r["completion_percentage_above_expectation"]),
                                             "air_diff": num(r["avg_air_yards_differential"])})
    for r in ngs_rec:
        if r.get("season") == str(stats_season) and r.get("week") == "0" and r.get("season_type") == "REG":
            ngs[r["player_gsis_id"]].update({"sep": num(r["avg_separation"]), "cushion": num(r["avg_cushion"]),
                                             "yac_oe": num(r["avg_yac_above_expectation"])})
    for r in ngs_rush:
        if r.get("season") == str(stats_season) and r.get("week") == "0" and r.get("season_type") == "REG":
            ryoe = num(r["rush_yards_over_expected_per_att"])
            pct = num(r["rush_pct_over_expected"])
            ngs[r["player_gsis_id"]].update({"ryoe": ryoe, "ryoe_pct": round(pct * 100, 1) if pct is not None and pct <= 1 else pct,
                                             "box8_ngs": num(r["percent_attempts_gte_eight_defenders"]),
                                             "ttl": num(r["avg_time_to_los"])})
    for g, d in ngs.items():
        for k, v in list(d.items()):
            if isinstance(v, float):
                d[k] = round(v, 2)

    # Player splits
    owner = {}
    for r in rosters:
        for pid in r.get("players") or []:
            owner[str(pid)] = r["roster_id"]
    analytics_by = {str(a["id"]): a for a in analytics.get("players", [])}
    involved = defaultdict(set)
    for (g, w), c in pw.items():
        involved[g].add(w)
    for (g, w) in snap_pct:
        involved[g].add(w)
    splits = {}
    pos_pool = defaultdict(list)
    for g, wks in involved.items():
        pos = pos_of.get(g)
        if pos == "FB":
            pos = "RB"
        if pos not in OFFENSE:
            continue
        wks = sorted(w for w in wks if w in weeks)
        if not wks:
            continue
        sid = gsis_to_sleeper.get(g)
        out = {"name": name_of.get(g) or g, "pos": pos, "nfl": team_of.get((g, wks[-1])), "gsis": g}

        def scope(wset):
            c = Counter()
            team = Counter()
            routes = 0.0
            have_routes = False
            snaps_list = []
            for w in wset:
                pc = pw.get((g, w), Counter())
                c.update(pc)
                t = team_of.get((g, w))
                if t:
                    team.update(tw.get((t, w), Counter()))
                    sp = snap_pct.get((g, w))
                    if sp is not None:
                        snaps_list.append(sp)
                        if pos in ROUTE_RATE:
                            routes += tw.get((t, w), Counter())["db"] * sp / 100 * ROUTE_RATE[pos]
                            have_routes = True
            c["_games"] = len(wset)
            return player_metrics(pos, c, team, routes if have_routes else None, snaps_list, ngs.get(g) if wset == wks else None)

        out["s"] = scope(wks)
        out["l3"] = scope(wks[-3:])
        wk_rows = []
        for w in wks:
            pc = pw.get((g, w), Counter())
            t = team_of.get((g, w))
            T = tw.get((t, w), Counter()) if t else Counter()
            row = {"w": w, "snap": round(snap_pct[(g, w)], 1) if (g, w) in snap_pct else None}
            if pos == "QB":
                row.update({"db": pc["db"], "epa": round(pc["db_epa"] / pc["db"], 2) if pc["db"] else None, "bz": pc["bz_db"]})
            else:
                row.update({"tgt": pc["tgt"], "car": pc["car"], "rz": pc["rz_tgt"] + pc["rz_car"], "air": pc["air"],
                            "ts": round(pc["tgt"] / T["tgt"] * 100, 1) if T["tgt"] else None})
            wk_rows.append({k: v for k, v in row.items() if v is not None})
        out["wk"] = wk_rows
        s = out["s"]
        busy = (pos == "QB" and s.get("db", 0) >= 15) or (pos != "QB" and (s.get("tgt", 0) + s.get("car", 0)) >= 6)
        if not busy and not (sid and sid in owner):
            continue
        if sid and sid in owner:
            out["owner"] = owner[sid]
        a = analytics_by.get(sid or "")
        if a:
            out["ppg"] = a.get("ppg")
            out["xfp_pg"] = a.get("xfp_pg")
            out["value"] = a.get("value")
            out["age"] = a.get("age")
        splits[sid or f"g{g}"] = out
        if busy:
            pos_pool[pos].append(s)

    # League averages for context
    def avg_of(pos, key, min_key, min_val):
        vals = [s[key] for s in pos_pool[pos] if s.get(key) is not None and s.get(min_key, 0) >= min_val]
        return round(statistics.mean(vals), 3) if vals else None
    pos_avgs = {
        "qb_epa_db": avg_of("QB", "epa_db", "db", 60),
        "qb_bz_epa": avg_of("QB", "bz_epa", "bz_db", 15),
        "WR_yprr": avg_of("WR", "yprr", "routes", 60),
        "TE_yprr": avg_of("TE", "yprr", "routes", 60),
        "RB_yprr": avg_of("RB", "yprr", "routes", 30),
    }

    # Defense and offense profiles
    fpa = fpa_indexes(stat_rows, sc)
    dprof = defense_profiles(dw, tw, weeks, fpa, pos_of, plays)
    oprof = offense_profiles(tw, weeks, team_games)

    # This week's games and Vegas lines
    games = {}
    for gm in games_rows:
        if gm.get("game_type") not in ("REG", None, "") or int(gm["week"]) != week:
            continue
        home, away = tm(gm["home_team"]), tm(gm["away_team"])
        spread, total = num(gm.get("spread_line")), num(gm.get("total_line"))
        kick = f"{gm.get('gameday')} {gm.get('gametime')}"
        dome = (gm.get("roof") or "") in ("dome", "closed")
        for team, other, home_flag in ((home, away, True), (away, home, False)):
            implied = opp_implied = None
            sp = None
            if spread is not None and total is not None:
                implied = total / 2 + (spread / 2 if home_flag else -spread / 2)
                opp_implied = total - implied
                sp = spread if home_flag else -spread
            games[team] = {"opp": other, "home": home_flag, "kick": kick, "total": total, "spread": sp,
                           "implied": round(implied, 1) if implied is not None else None,
                           "opp_implied": round(opp_implied, 1) if opp_implied is not None else None, "dome": dome}

    # Projections in league scoring
    players = {}
    rostered = set(owner)
    for pos, lst in proj_raw.items():
        for r in lst or []:
            pid = str(r.get("player_id"))
            st = r.get("stats") or {}
            pl = r.get("player") or {}
            ppos = pl.get("position") or pos
            if ppos not in ALL_POS:
                continue
            pts = league_score(st, sc)
            if pid not in rostered and (pts < (4 if ppos in OFFENSE else 6) or not r.get("opponent")):
                continue
            team = tm(r.get("team") or pl.get("team"))
            name = " ".join(x for x in (pl.get("first_name"), pl.get("last_name")) if x) or pid
            players[pid] = {
                "id": pid, "name": name, "pos": ppos, "nfl": team, "opp": tm(r.get("opponent")),
                "inj": pl.get("injury_status") or None, "proj": round(pts, 2),
                "ps": {k: round(v, 1) for k, v in (("tgt", st.get("rec_tgt")), ("rec", st.get("rec")), ("car", st.get("rush_att")),
                                                     ("ryd", st.get("rush_yd")), ("recyd", st.get("rec_yd")), ("pyd", st.get("pass_yd")),
                                                     ("ptd", st.get("pass_td")), ("td", (st.get("rush_td") or 0) + (st.get("rec_td") or 0)))
                       if v},
                "owner": owner.get(pid),
            }
    # Rostered players with no projection (bye, injured, no team)
    for t in latest.get("teams", {}).values():
        r = t["roster"]
        for p in [x["player"] for x in r["starters"] if x.get("player")] + r["bench"] + r["taxi"] + r["ir"]:
            pid = str(p["id"])
            if pid in players:
                continue
            players[pid] = {"id": pid, "name": p["name"], "pos": p["pos"], "nfl": p.get("nfl"), "opp": None,
                            "inj": p.get("injury"), "proj": 0.0, "ps": {}, "owner": owner.get(pid), "bye": True}
    # Positional ranks, ranges, reasons
    by_pos = defaultdict(list)
    for p in players.values():
        if not p.get("bye"):
            by_pos[p["pos"]].append(p)
    for pos, lst in by_pos.items():
        for i, p in enumerate(sorted(lst, key=lambda x: -x["proj"]), start=1):
            p["rank"] = i
    for pid, p in players.items():
        a = analytics_by.get(pid)
        pts = [w["pts"] for w in (a or {}).get("weekly", [])]
        n = len(pts)
        base = POS_SD.get(p["pos"], 6.0)
        if n >= 2:
            s2 = statistics.pvariance(pts)
            sd = math.sqrt((n * s2 + 4 * base * base) / (n + 4))
        else:
            sd = base
        sd = max(2.0, min(sd, 12.0)) * (0.6 + 0.4 * min(1.0, p["proj"] / max(1.0, statistics.mean([q["proj"] for q in by_pos.get(p["pos"], [p])[:24]] or [1]))))
        p["sd"] = round(sd, 2)
        p["floor"] = round(max(0.0, p["proj"] - 0.9 * sd), 1)
        p["ceil"] = round(p["proj"] + 1.1 * sd, 1)
        if a:
            p["fpoe_pg"] = a.get("fpoe_pg")
            p["xfp_pg"] = a.get("xfp_pg")
            p["games"] = a.get("games")
            p["ppg"] = a.get("ppg")
            p["headshot"] = a.get("headshot")
        g = games.get(p["nfl"]) if p.get("nfl") else None
        if not g and not p.get("bye"):
            p["bye"] = p.get("opp") is None
        sp = splits.get(pid)
        d = dprof.get(p["opp"]) if p.get("opp") else None
        o = oprof.get(p["opp"]) if p.get("opp") else None
        pros, cons = reasons_for(p, sp, d, o, g, dprof, pos_avgs) if not p.get("bye") else ([], [])
        p["pros"], p["cons"] = pros, cons
        p["out"] = bool(p.get("inj") in UNAVAILABLE)

    # Weekly league matchups
    m_by_id = defaultdict(list)
    for m in matchups or []:
        if m.get("matchup_id"):
            m_by_id[m["matchup_id"]].append(m["roster_id"])
    opp_of = {}
    for ids_ in m_by_id.values():
        if len(ids_) == 2:
            opp_of[ids_[0]], opp_of[ids_[1]] = ids_[1], ids_[0]
    current_starters = {r["roster_id"]: [str(x) for x in (r.get("starters") or [])] for r in rosters}

    def lineup_for(rid, mode=0.0):
        roster = next((r for r in rosters if r["roster_id"] == rid), None)
        pool = []
        for pid in (roster or {}).get("players") or []:
            p = players.get(str(pid))
            if not p or p.get("bye") or p.get("out"):
                continue
            weight = 0.3 if p.get("inj") == "Doubtful" else 1.0
            pool.append({"id": p["id"], "pos": p["pos"], "proj": p["proj"] * weight,
                         "score": p["proj"] * weight + mode * (p["sd"] - POS_SD.get(p["pos"], 6) * 0.8)})
        return best_lineup(slots, pool, "score"), pool

    teams_out = {}
    base = {}
    for r in rosters:
        rid = r["roster_id"]
        lu, _ = lineup_for(rid)
        total = sum(p["proj"] for p in lu.values())
        var = sum(players[p["id"]]["sd"] ** 2 for p in lu.values())
        base[rid] = (total, var)
    for r in rosters:
        rid = r["roster_id"]
        my_total, my_var = base[rid]
        opp = opp_of.get(rid)
        win = None
        mode = 0.0
        if opp in base:
            o_total, o_var = base[opp]
            spread = my_total - o_total
            win = norm_cdf(spread / math.sqrt(max(1.0, my_var + o_var)))
            if win < 0.4:
                mode = 0.35
            elif win > 0.65:
                mode = -0.25
        lu, pool = lineup_for(rid, mode)
        chosen_ids = {p["id"] for p in lu.values()}
        lineup = [{"slot": slots[i], "id": lu[i]["id"]} for i in sorted(lu)]
        starters_now = set(current_starters.get(rid, []))
        recs = {}
        # Best alternatives for context
        bench = sorted([p for p in pool if p["id"] not in chosen_ids], key=lambda p: -p["proj"])
        for i in sorted(lu):
            p = players[lu[i]["id"]]
            slot = slots[i]
            elig = SLOT_ELIGIBLE[slot]
            alt = next((b for b in bench if b["pos"] in elig), None)
            action = "Start" if p["id"] in starters_now else "Start (move in)"
            why = []
            if alt:
                ap = players[alt["id"]]
                gap = p["proj"] - ap["proj"]
                if gap >= 0:
                    if p["cons"] and gap < 5:
                        why.append(f"Start anyway: the best option on your bench for {slot}, {ap['name']}, projects {ap['proj']:.1f} ({gap:.1f} less).")
                    else:
                        why.append(f"Projects {gap:.1f} more than your best bench option for {slot} ({ap['name']}, {ap['proj']:.1f}).")
                else:
                    why.append(f"{ap['name']} projects {abs(gap):.1f} more, but {p['name']} has the {'higher ceiling' if mode > 0 else 'steadier floor'} "
                               f"({p['floor']:.0f}–{p['ceil']:.0f} vs {ap['floor']:.0f}–{ap['ceil']:.0f}) and you're "
                               f"{'an underdog' if mode > 0 else 'a big favorite'} this week.")
            else:
                why.append(f"No one else on the roster can fill {slot} this week.")
            recs[p["id"]] = {"action": action, "slot": slot, "why": why}
        for pid in (r.get("players") or []):
            pid = str(pid)
            if pid in recs:
                continue
            p = players.get(pid)
            if not p:
                continue
            if p.get("bye"):
                act, why = ("Sit" if pid in starters_now else "Bench"), [f"{p['nfl'] or 'No team'} has no game this week." if p.get("nfl") else "Not on an NFL team."]
            elif p.get("out"):
                act, why = ("Sit" if pid in starters_now else "Bench"), [f"Listed {p['inj']}. Status updates every morning; re-check before kickoff."]
            else:
                # who takes his spot
                better = [players[lu[i]["id"]] for i in lu if p["pos"] in SLOT_ELIGIBLE[slots[i]]]
                weakest = min(better, key=lambda x: x["proj"]) if better else None
                if pid in starters_now:
                    act = "Sit"
                    why = [f"{weakest['name']} projects {weakest['proj'] - p['proj']:.1f} more for that spot ({weakest['proj']:.1f} vs {p['proj']:.1f})."] if weakest else ["No lineup spot for him this week."]
                elif p["proj"] < 0.5:
                    act, why = "Bench", ["Not projected for a role this week."]
                else:
                    act = "Bench"
                    why = [f"Behind {weakest['name']} ({weakest['proj']:.1f} vs {p['proj']:.1f})."] if weakest else []
            recs[pid] = {"action": act, "why": why}
        # Waiver upgrades
        upgrades = []
        fa = [p for p in players.values() if p["owner"] is None and not p.get("bye") and not p.get("out") and p["pos"] in ALL_POS]
        for i in sorted(lu):
            st = players[lu[i]["id"]]
            elig = SLOT_ELIGIBLE[slots[i]]
            best_fa = max((p for p in fa if p["pos"] in elig and p["pos"] == st["pos"]), key=lambda p: p["proj"], default=None)
            if best_fa and best_fa["proj"] >= st["proj"] + 2.0:
                upgrades.append({"add": best_fa["id"], "over": st["id"], "gain": round(best_fa["proj"] - st["proj"], 1)})
        upgrades.sort(key=lambda u: -u["gain"])
        teams_out[str(rid)] = {
            "opp": opp_of.get(rid), "proj": round(sum(players[p["id"]]["proj"] for p in lu.values()), 1),
            "opp_proj": round(base[opp][0], 1) if opp in base else None,
            "win": round(win * 100, 1) if win is not None else None,
            "mode": "ceiling" if mode > 0 else "floor" if mode < 0 else "projection",
            "lineup": lineup, "recs": recs, "waivers": upgrades[:3],
            "changes": sum(1 for v in recs.values() if v["action"] == "Start (move in)"),
        }

    # Keep the payload lean
    for p in players.values():
        p.pop("sd", None)
    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "season": season, "week": None if offseason else week, "offseason": offseason, "stats_season": stats_season,
        "data_through": max(weeks) if weeks else None,
        "scoring": {"rec": sc.get("rec"), "pass_td": sc.get("pass_td"), "te_premium": sc.get("bonus_rec_te") or 0},
        "games": games, "defenses": dprof, "offenses": oprof, "players": players, "teams": teams_out,
        "averages": pos_avgs,
        "method": "Sleeper projections in league scoring; matchups and usage explain the call. Close calls use the weekly matchup: underdogs take ceiling, favorites take floor.",
    }
    (DATA_DIR / "startsit.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    (DATA_DIR / "splits.json").write_text(json.dumps({
        "generated_at": payload["generated_at"], "season": season, "weeks": weeks, "averages": pos_avgs,
        "players": splits,
    }, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    log(f"Week {week}: {len(players)} players projected, {len(teams_out)} lineups; splits for {len(splits)} players; "
        f"{len(dprof)} defenses.")


if __name__ == "__main__":
    main()
