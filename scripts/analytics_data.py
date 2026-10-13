#!/usr/bin/env python3
"""Player analytics for HIM Dynasty, built from nflverse data.

Sources (all public, open data on GitHub):
  * nflverse stats_player_week: weekly box scores, target share, air-yards
    share, WOPR, EPA, CPOE
  * nflverse snap_counts: offensive snap share
  * nflverse pfr_advstats (receiving): broken tackles and drops
  * ffverse ffopportunity ep_weekly: expected fantasy points (xFP) from each
    player's usage, and points over expected (FPOE)
  * nflverse players: birth date, draft capital, experience, headshots
  * DynastyProcess player ids: nflverse id -> Sleeper id
  * docs/data/trade.json and latest.json: dynasty value and who owns whom

What it answers for a dynasty manager:
  production (league-scoring PPG, weekly starter rate, boom/bust),
  opportunity (snaps, target share, air-yards share, WOPR, rush share),
  expected vs actual (xFP and FPOE: who is running hot or cold),
  efficiency (catch rate, yards per target/carry, aDOT, YAC, EPA, CPOE,
  broken tackles, drops), trend (last two weeks vs season), and dynasty
  context (age vs position decline age, draft capital, value rank vs
  production rank). Each player gets plain-language signals such as
  "Buy low" or "Sell high".

Writes docs/data/analytics.json and appends to docs/data/values_history.json.
"""

import csv
import datetime as dt
import io
import json
import os
import statistics
import time
import urllib.request
from pathlib import Path

LEAGUE_ID = os.environ.get("SLEEPER_LEAGUE_ID", "1312005038838673409")
DATA_DIR = Path(__file__).resolve().parent.parent / "docs" / "data"
NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download"
FFOPP = "https://github.com/ffverse/ffopportunity/releases/download/latest-data"
DP_IDS = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv"
POSITIONS = ("QB", "RB", "WR", "TE")
STARTER_RANK = {"QB": 12, "RB": 24, "WR": 24, "TE": 12}
BOOM = {"QB": 25, "RB": 20, "WR": 20, "TE": 15}
BUST = {"QB": 12, "RB": 8, "WR": 8, "TE": 6}
DECLINE_AGE = {"QB": 35, "RB": 27, "WR": 30, "TE": 31}


def fetch_text(url, retries=3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "him-dynasty-analytics"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (attempt + 1))
    raise last


def rows(url, optional=False):
    try:
        return list(csv.DictReader(io.StringIO(fetch_text(url))))
    except Exception as e:  # noqa: BLE001
        if optional:
            print(f"  skipped {url.rsplit('/', 1)[-1]}: {e}")
            return []
        raise


def f(x):
    try:
        v = float(x)
        return v if v == v else 0.0
    except (TypeError, ValueError):
        return 0.0


def mean(values):
    values = [v for v in values if v is not None]
    return sum(values) / len(values) if values else None


def r1(x, n=1):
    return None if x is None else round(x, n)


def league_points(s, sc):
    """One weekly stat line scored with this league's Sleeper settings."""
    pts = (
        f(s["passing_yards"]) * sc.get("pass_yd", 0.04) + f(s["passing_tds"]) * sc.get("pass_td", 4)
        + f(s["passing_interceptions"]) * sc.get("pass_int", -1)
        + f(s["rushing_yards"]) * sc.get("rush_yd", 0.1) + f(s["rushing_tds"]) * sc.get("rush_td", 6)
        + f(s["receptions"]) * sc.get("rec", 1) + f(s["receiving_yards"]) * sc.get("rec_yd", 0.1)
        + f(s["receiving_tds"]) * sc.get("rec_td", 6)
        + f(s.get("fumbles_lost_total")) * sc.get("fum_lost", -2)
        + f(s["passing_2pt_conversions"]) * sc.get("pass_2pt", 2) + f(s["rushing_2pt_conversions"]) * sc.get("rush_2pt", 2)
        + f(s["receiving_2pt_conversions"]) * sc.get("rec_2pt", 2)
    )
    if s["position"] == "TE":
        pts += f(s["receptions"]) * (sc.get("bonus_rec_te") or 0)
    return pts


def age_on(birth, today):
    try:
        b = dt.date.fromisoformat(birth[:10])
    except (TypeError, ValueError):
        return None
    return round((today - b).days / 365.25, 1)


def main():
    latest = json.loads((DATA_DIR / "latest.json").read_text())
    try:
        trade = json.loads((DATA_DIR / "trade.json").read_text())
    except FileNotFoundError:
        trade = {"assets": []}
    season = int(latest["league"]["season"])
    league = json.loads(fetch_text(f"https://api.sleeper.app/v1/league/{LEAGUE_ID}"))
    sc = league.get("scoring_settings") or {}
    today = dt.date.today()

    print("Downloading nflverse data…")
    stats = [r for r in rows(f"{NFLVERSE}/stats_player/stats_player_week_{season}.csv")
             if r["season_type"] == "REG" and r["position"] in POSITIONS]
    snaps = rows(f"{NFLVERSE}/snap_counts/snap_counts_{season}.csv", optional=True)
    adv = rows(f"{NFLVERSE}/pfr_advstats/advstats_week_rec_{season}.csv", optional=True)
    ep = rows(f"{FFOPP}/ep_weekly_{season}.csv", optional=True)
    people = {r["gsis_id"]: r for r in rows(f"{NFLVERSE}/players/players.csv")}
    ids = rows(DP_IDS)
    gsis_to_sleeper = {r["gsis_id"]: r["sleeper_id"] for r in ids if r.get("gsis_id") not in ("", "NA") and r.get("sleeper_id") not in ("", "NA")}
    pfr_to_gsis = {p["pfr_id"]: g for g, p in people.items() if p.get("pfr_id")}

    # Ownership and dynasty value
    owner = {}
    roster_ids = set()
    for rid, t in latest["teams"].items():
        r = t["roster"]
        for p in [x["player"] for x in r["starters"] if x.get("player")] + r["bench"] + r["taxi"] + r["ir"]:
            owner[p["id"]] = int(rid)
            if p["pos"] in POSITIONS:
                roster_ids.add(p["id"])
    value = {a["id"][1:]: a["value"] for a in trade.get("assets", []) if a["kind"] == "player"}

    # Team totals per game (for rush share)
    team_carries = {}
    for s in stats:
        key = (s["team"], s["week"])
        team_carries[key] = team_carries.get(key, 0) + f(s["carries"])

    snap_by = {}
    for s in snaps:
        g = pfr_to_gsis.get(s["pfr_player_id"])
        if g:
            pct = f(s["offense_pct"])
            snap_by[(g, s["week"])] = pct * 100 if pct <= 1 else pct
    adv_by = {}
    for a in adv:
        g = pfr_to_gsis.get(a["pfr_player_id"])
        if g:
            adv_by[(g, a["week"])] = a
    ep_by = {(e["player_id"], e["week"]): e for e in ep}

    # Weekly lines
    players = {}
    for s in stats:
        g = s["player_id"]
        wk = int(s["week"])
        p = players.setdefault(g, {"gsis": g, "name": s["player_display_name"], "pos": s["position"],
                                   "nfl": s["team"], "headshot": s.get("headshot_url"), "weeks": []})
        p["nfl"] = s["team"]
        e = ep_by.get((g, s["week"]))
        a = adv_by.get((g, s["week"]))
        carries = f(s["carries"])
        tc = team_carries.get((s["team"], s["week"])) or 0
        p["weeks"].append({
            "w": wk,
            "opp": s["opponent_team"],
            "pts": round(league_points(s, sc), 2),
            "xfp": r1(f(e["total_fantasy_points_exp"]), 2) if e else None,
            "ffp": r1(f(e["total_fantasy_points"]), 2) if e else None,
            "snap": r1(snap_by.get((g, s["week"]))),
            "tgt": f(s["targets"]), "rec": f(s["receptions"]), "car": carries,
            "rec_yd": f(s["receiving_yards"]), "rush_yd": f(s["rushing_yards"]),
            "air": f(s["receiving_air_yards"]), "yac": f(s["receiving_yards_after_catch"]),
            "tds": f(s["passing_tds"]) + f(s["rushing_tds"]) + f(s["receiving_tds"]),
            "tgt_share": f(s["target_share"]) * 100, "air_share": f(s["air_yards_share"]) * 100,
            "wopr": f(s["wopr"]), "rush_share": (carries / tc * 100) if tc else 0.0,
            "rec_epa": f(s["receiving_epa"]), "rush_epa": f(s["rushing_epa"]), "pass_epa": f(s["passing_epa"]),
            "att": f(s["attempts"]), "cmp": f(s["completions"]), "pass_yd": f(s["passing_yards"]),
            "int": f(s["passing_interceptions"]), "cpoe": f(s["passing_cpoe"]) if s["passing_cpoe"] not in ("", "NA") else None,
            "sacks": f(s["sacks_suffered"]),
            "btk": (f(a["rushing_broken_tackles"]) + f(a["receiving_broken_tackles"])) if a else None,
            "drops": f(a["receiving_drop"]) if a else None,
        })

    # Weekly positional ranks (league scoring)
    by_week = {}
    for g, p in players.items():
        for w in p["weeks"]:
            by_week.setdefault((p["pos"], w["w"]), []).append((w["pts"], g, w))
    for lst in by_week.values():
        for i, (_, _, w) in enumerate(sorted(lst, key=lambda x: -x[0]), start=1):
            w["rank"] = i

    # Add rostered players with no snaps this season (injured, rookies on taxi)
    sleeper_to_gsis = {v: k for k, v in gsis_to_sleeper.items()}
    for sid in roster_ids:
        g = sleeper_to_gsis.get(sid)
        if g and g not in players and g in people:
            pp = people[g]
            players[g] = {"gsis": g, "name": pp["display_name"], "pos": pp["position"], "nfl": pp.get("latest_team"),
                          "headshot": pp.get("headshot"), "weeks": []}

    # Summaries
    out = []
    max_games = max((len(p["weeks"]) for p in players.values()), default=1)
    for g, p in players.items():
        wk = sorted(p["weeks"], key=lambda w: w["w"])
        n = len(wk)
        info = people.get(g, {})
        sid = gsis_to_sleeper.get(g)
        pts = [w["pts"] for w in wk]
        xfp = [w["xfp"] for w in wk if w["xfp"] is not None]
        ffp = [w["ffp"] for w in wk if w["ffp"] is not None]
        tgt = sum(w["tgt"] for w in wk)
        rec = sum(w["rec"] for w in wk)
        car = sum(w["car"] for w in wk)
        air = sum(w["air"] for w in wk)
        att = sum(w["att"] for w in wk)
        pos = p["pos"]
        opp_share = [w["tgt_share"] + (w["rush_share"] if pos == "RB" else 0) for w in wk]
        snaps_list = [w["snap"] for w in wk if w["snap"] is not None]
        last2_opp = mean(opp_share[-2:]) if n >= 3 else None
        season_opp = mean(opp_share)
        last2_snap = mean(snaps_list[-2:]) if len(snaps_list) >= 3 else None
        season_snap = mean(snaps_list)
        age = age_on(info.get("birth_date"), today)
        btk = [w["btk"] for w in wk if w["btk"] is not None]
        drops = [w["drops"] for w in wk if w["drops"] is not None]
        cpoe = [w["cpoe"] for w in wk if w["cpoe"] is not None]
        row = {
            "id": sid or f"g{g}",
            "gsis": g,
            "name": p["name"],
            "pos": pos,
            "nfl": p["nfl"],
            "headshot": p["headshot"] if (p.get("headshot") or "").startswith("https://") else None,
            "owner": owner.get(sid),
            "value": value.get(sid),
            "age": age,
            "exp": int(f(info.get("years_of_experience"))) if info.get("years_of_experience") not in (None, "", "NA") else None,
            "draft": (f"{info['draft_year']} R{info['draft_round']}.{info['draft_pick']}"
                      if info.get("draft_round") not in (None, "", "NA") else "Undrafted"),
            "games": n,
            "ppg": r1(mean(pts)),
            "total": r1(sum(pts)),
            "xfp_pg": r1(mean(xfp)),
            "fpoe_pg": r1((sum(ffp) - sum(xfp)) / len(xfp)) if xfp and len(ffp) == len(xfp) else None,
            "snap": r1(season_snap),
            "tgt_share": r1(mean([w["tgt_share"] for w in wk])),
            "air_share": r1(mean([w["air_share"] for w in wk])),
            "wopr": r1(mean([w["wopr"] for w in wk]), 2),
            "rush_share": r1(mean([w["rush_share"] for w in wk])) if pos in ("RB", "QB") else None,
            "tgt_pg": r1(tgt / n) if n else None,
            "car_pg": r1(car / n) if n else None,
            "catch": r1(rec / tgt * 100) if tgt else None,
            "ypt": r1(sum(w["rec_yd"] for w in wk) / tgt) if tgt else None,
            "ypc": r1(sum(w["rush_yd"] for w in wk) / car) if car else None,
            "adot": r1(air / tgt) if tgt else None,
            "yac_rec": r1(sum(w["yac"] for w in wk) / rec) if rec else None,
            "epa_tgt": r1(sum(w["rec_epa"] for w in wk) / tgt, 2) if tgt else None,
            "epa_car": r1(sum(w["rush_epa"] for w in wk) / car, 2) if car else None,
            "epa_db": r1(sum(w["pass_epa"] for w in wk) / (att + sum(w["sacks"] for w in wk)), 2) if att else None,
            "cpoe": r1(mean(cpoe)) if cpoe else None,
            "ypa": r1(sum(w["pass_yd"] for w in wk) / att) if att else None,
            "btk": int(sum(btk)) if btk else None,
            "drops": int(sum(drops)) if drops else None,
            "starter_rate": r1(100 * sum(1 for w in wk if w["rank"] <= STARTER_RANK[pos]) / n) if n else None,
            "boom_rate": r1(100 * sum(1 for w in wk if w["pts"] >= BOOM[pos]) / n) if n else None,
            "bust_rate": r1(100 * sum(1 for w in wk if w["pts"] < BUST[pos]) / n) if n else None,
            "usage_trend": r1(last2_opp - season_opp) if last2_opp is not None and season_opp is not None else None,
            "snap_trend": r1(last2_snap - season_snap) if last2_snap is not None and season_snap is not None else None,
            "decline_age": DECLINE_AGE[pos],
            "weekly": [{"w": w["w"], "opp": w["opp"], "pts": w["pts"], "xfp": w["xfp"], "snap": w["snap"],
                        "share": r1(w["tgt_share"] + (w["rush_share"] if pos == "RB" else 0)), "rank": w["rank"]} for w in wk],
        }
        out.append(row)

    # Positional ranks among regular contributors
    def rank_by(key, reverse=True):
        for pos in POSITIONS:
            pool = [r for r in out if r["pos"] == pos and r[key] is not None and r["games"] >= max(1, round(0.4 * max_games))]
            for i, r in enumerate(sorted(pool, key=lambda r: r[key], reverse=reverse), start=1):
                r[f"{key}_rank"] = i
    rank_by("ppg")
    rank_by("xfp_pg")
    for pos in POSITIONS:
        pool = [r for r in out if r["pos"] == pos and r["value"]]
        for i, r in enumerate(sorted(pool, key=lambda r: -r["value"]), start=1):
            r["value_rank"] = i

    # Signals
    for r in out:
        sig = []
        pos = r["pos"]
        lim = STARTER_RANK[pos]
        if r.get("xfp_pg_rank") and r["xfp_pg_rank"] <= lim and (r["fpoe_pg"] or 0) <= -2:
            sig.append(["Buy low", f"Usage of a top-{lim} {pos} ({r['xfp_pg']} expected points a game) but scoring {abs(r['fpoe_pg'])} below that. Production should catch up."])
        if (r["fpoe_pg"] or 0) >= 3 and (r.get("xfp_pg_rank") or 99) > (r.get("ppg_rank") or 99) + 6:
            sig.append(["Sell high", f"Scoring {r['fpoe_pg']} a game above what his usage predicts. Expect regression."])
        if (r["fpoe_pg"] or 0) >= 4 and not any(x[0] == "Sell high" for x in sig):
            sig.append(["Running hot", f"Scoring {r['fpoe_pg']} a game above expected. Great while it lasts; usage says {r['xfp_pg']} a game."])
        if (r["fpoe_pg"] or 0) <= -3 and not any(x[0] == "Buy low" for x in sig):
            sig.append(["Running cold", f"Scoring {abs(r['fpoe_pg'])} a game below what his usage predicts."])
        if r["usage_trend"] is not None and r["usage_trend"] >= 6:
            sig.append(["Rising usage", f"Opportunity share up {r['usage_trend']} points over the last two games."])
        if r["usage_trend"] is not None and r["usage_trend"] <= -6:
            sig.append(["Falling usage", f"Opportunity share down {abs(r['usage_trend'])} points over the last two games."])
        if r["age"] and r["age"] >= DECLINE_AGE[pos] - 1 and (r["value"] or r["owner"]):
            sig.append(["Age cliff", f"{r['age']} years old; {pos}s usually decline around {DECLINE_AGE[pos]}."])
        if r["age"] and r["age"] <= 23.5 and (r["starter_rate"] or 0) >= 50:
            sig.append(["Ascending", f"Only {r['age']} and already a weekly starter {r['starter_rate']:.0f}% of the time."])
        if r.get("value_rank") and r.get("ppg_rank") and r["value_rank"] - r["ppg_rank"] >= 15:
            sig.append(["Market undervalues", f"{pos}{r['ppg_rank']} in production but only {pos}{r['value_rank']} in dynasty value."])
        if r.get("value_rank") and r.get("ppg_rank") and r["ppg_rank"] - r["value_rank"] >= 20 and r["games"] >= 3:
            sig.append(["Living on name value", f"{pos}{r['value_rank']} in dynasty value but {pos}{r['ppg_rank']} in production."])
        r["signals"] = sig

    weeks = sorted({w["w"] for p in out for w in p["weekly"]})
    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "season": season,
        "weeks": weeks,
        "scoring": {k: sc.get(k) for k in ("rec", "pass_td", "bonus_rec_te")},
        "sources": ["nflverse stats_player", "nflverse snap_counts", "nflverse pfr_advstats", "ffverse ffopportunity", "nflverse players", "DynastyProcess ids"],
        "thresholds": {"starter": STARTER_RANK, "boom": BOOM, "bust": BUST, "decline_age": DECLINE_AGE},
        "players": sorted(out, key=lambda r: -(r["ppg"] or 0)),
    }
    (DATA_DIR / "analytics.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    # Daily dynasty value snapshot, for value trends over time.
    hist_path = DATA_DIR / "values_history.json"
    try:
        hist = json.loads(hist_path.read_text())
    except FileNotFoundError:
        hist = {}
    hist[today.isoformat()] = {sid: v for sid, v in value.items() if v}
    for old in sorted(hist)[:-120]:
        del hist[old]
    hist_path.write_text(json.dumps(hist, separators=(",", ":")) + "\n", encoding="utf-8")
    mapped = sum(1 for r in out if not r["id"].startswith("g"))
    print(f"Wrote analytics for {len(out)} players ({mapped} matched to Sleeper), weeks {weeks}.")


if __name__ == "__main__":
    main()
