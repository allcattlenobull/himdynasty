#!/usr/bin/env python3
""""Why you are HIM / Why you are Ass" analysis for every team.

Written automatically each morning from the numbers, so it never needs a human
and every line is backed by a stat. Each team is ranked 1-12 on a set of
checks; its best ranks become the HIM case, its worst become the Ass case.

Checks: points scored, lineup efficiency (PF vs max PF), all-play record,
luck (actual vs all-play wins), recent form, each position's weekly output,
dynasty value, roster youth, draft picks, remaining schedule, playoff-odds
trend, injured starters, and close losses.

Reads docs/data/latest.json and docs/data/trade.json; writes
docs/data/analysis.json.
"""

import datetime as dt
import json
import statistics
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "docs" / "data"
POSITIONS = {"QB": 1, "RB": 3, "WR": 3, "TE": 1}  # starters incl. a share of flex
BAD_INJURY = {"IR", "Out", "PUP", "Sus", "Doubtful"}


def ranks(values, higher_is_better=True):
    """{key: rank} with 1 = best."""
    order = sorted(values, key=lambda k: values[k], reverse=higher_is_better)
    return {k: i for i, k in enumerate(order, start=1)}


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def names(players, limit=2):
    n = [p["name"] for p in players[:limit]]
    return n[0] if len(n) == 1 else ", ".join(n[:-1]) + " and " + n[-1] if n else ""


def nth(rank, word):
    """'the toughest' for rank 1, otherwise '3rd toughest'."""
    return f"the {word}" if rank == 1 else f"the {ordinal(rank)} {word}"


def main():
    latest = json.loads((DATA_DIR / "latest.json").read_text())
    try:
        trade = json.loads((DATA_DIR / "trade.json").read_text())
    except FileNotFoundError:
        trade = None
    pages = {int(k): v for k, v in latest["teams"].items()}
    rids = sorted(pages)
    n = len(rids)
    done = latest["league"]["weeks_completed"]
    standings = {r["roster_id"]: r for r in latest["standings"]}
    series = latest["history"]["series"]
    model = (latest.get("sim") or {}).get("model", {})

    m = {}  # metrics by team
    weekly = {}
    for r in rids:
        finals = [g for g in pages[r]["schedule"] if g["status"] == "final"]
        weekly[r] = {g["week"]: g["points"] for g in finals}
    for r in rids:
        t, s = pages[r], standings[r]
        finals = [g for g in t["schedule"] if g["status"] == "final"]
        games = len(finals) or 1
        # All-play: every week, count the teams you outscored.
        ap_w = ap_l = 0
        for g in finals:
            wk, mine = g["week"], g["points"]
            for o in rids:
                if o != r and wk in weekly[o]:
                    if mine > weekly[o][wk]:
                        ap_w += 1
                    elif mine < weekly[o][wk]:
                        ap_l += 1
        ap_pct = ap_w / max(1, ap_w + ap_l)
        wins = s["wins"] + 0.5 * s["ties"]
        exp_wins = ap_pct * len(finals)
        pts = [g["points"] for g in finals]
        last3 = statistics.mean(pts[-3:]) if pts else 0
        season = statistics.mean(pts) if pts else 0
        close_losses = [g for g in finals if g["result"] == "L" and g["opp_points"] - g["points"] < 10]

        roster = t["roster"]
        everyone = [x["player"] for x in roster["starters"] if x.get("player")] + roster["bench"] + roster["taxi"] + roster["ir"]
        pos_out = {}
        pos_top = {}
        for pos, k in POSITIONS.items():
            group = sorted((p for p in everyone if p["pos"] == pos), key=lambda p: -(p.get("ppg") or 0))
            pos_top[pos] = group[:k]
            pos_out[pos] = sum(p.get("ppg") or 0 for p in group[:k])
        injured = [x["player"] for x in roster["starters"] if x.get("player") and (x["player"].get("injury") in BAD_INJURY)]

        remaining = [g for g in t["schedule"] if g["status"] != "final" and g.get("opponent")]
        opp_strength = statistics.mean(model[str(g["opponent"])][0] for g in remaining) if remaining and model else None

        po = series[str(r)]["playoff_odds"] if str(r) in series else []
        trend = (po[-1] - po[-2]) if len(po) >= 2 else 0.0

        ts = trade["teams"][str(r)] if trade else {}
        m[r] = {
            "pf": s["points_for"], "ppg": season, "eff": s["points_for"] / s["max_pf"] if s["max_pf"] else 0,
            "lost": s["max_pf"] - s["points_for"], "games": games,
            "ap_w": ap_w, "ap_l": ap_l, "ap_pct": ap_pct, "wins": wins, "exp_wins": exp_wins, "luck": wins - exp_wins,
            "last3": last3, "form": last3 - season, "close_losses": close_losses,
            "pos_out": pos_out, "pos_top": pos_top, "injured": injured,
            "opp": opp_strength, "remaining": len(remaining), "trend": trend,
            "playoff": s["playoff_odds"], "title": s["champion_odds"],
            "value": ts.get("total_value"), "value_age": ts.get("value_age"),
            "picks_value": ts.get("picks_value"), "picks_n": len(ts.get("picks", [])),
        }

    R = {
        "pf": ranks({r: m[r]["pf"] for r in rids}),
        "eff": ranks({r: m[r]["eff"] for r in rids}),
        "ap": ranks({r: m[r]["ap_pct"] for r in rids}),
        "form": ranks({r: m[r]["form"] for r in rids}),
        "playoff": ranks({r: m[r]["playoff"] for r in rids}),
    }
    for pos in POSITIONS:
        R[pos] = ranks({r: m[r]["pos_out"][pos] for r in rids})
    if trade:
        R["value"] = ranks({r: m[r]["value"] for r in rids})
        R["youth"] = ranks({r: m[r]["value_age"] or 99 for r in rids}, higher_is_better=False)
        R["picks"] = ranks({r: m[r]["picks_value"] for r in rids})
    if model:
        R["sched"] = ranks({r: m[r]["opp"] if m[r]["opp"] is not None else 0 for r in rids}, higher_is_better=False)

    out = {}
    top, bottom = 4, n - 3  # rank <= 4 is a strength, rank >= 9 is a weakness
    for r in rids:
        x = m[r]
        rk = {k: v[r] for k, v in R.items()}
        good, bad = [], []  # (strength, text)
        used = set()

        def add(rank_key, good_text, bad_text):
            k = rk.get(rank_key)
            if k is None:
                return
            if k <= top and good_text:
                good.append((top + 1 - k, good_text))
                used.add(rank_key)
            elif k >= bottom and bad_text:
                bad.append((k - bottom + 1, bad_text))
                used.add(rank_key)

        g = x["games"]
        add("pf", f"Scoring machine: {x['pf']:.1f} points, {ordinal(rk['pf'])} in the league ({x['ppg']:.1f} a week).",
            f"The offense is a rumor: {x['pf']:.1f} points, {ordinal(rk['pf'])} of {n} ({x['ppg']:.1f} a week).")
        add("eff", f"Lineup genius: started {x['eff'] * 100:.1f}% of your max possible points ({ordinal(rk['eff'])} in efficiency).",
            f"Your bench is your best unit: {x['lost']:.1f} points left on the pine ({x['lost'] / g:.1f} a week), {ordinal(rk['eff'])} in lineup efficiency.")
        add("ap", f"Would be {x['ap_w']}-{x['ap_l']} playing everyone every week ({ordinal(rk['ap'])} in all-play).",
            f"Would be {x['ap_w']}-{x['ap_l']} playing everyone every week ({ordinal(rk['ap'])} in all-play). The record is not lying.")
        add("form", f"Heating up: {x['last3']:.1f} a week over the last 3, {x['form']:+.1f} versus your season pace." if x["form"] > 0 else None,
            f"Ice cold: {x['last3']:.1f} a week over the last 3, {x['form']:+.1f} versus your season pace." if x["form"] < 0 else None)
        for pos in POSITIONS:
            who = names(x["pos_top"][pos], 3 if POSITIONS[pos] > 1 else 1)
            add(pos, f"{pos} room is elite: {who} put up {x['pos_out'][pos]:.1f} a week ({ordinal(rk[pos])} at {pos}).",
                f"{pos} is a black hole: {x['pos_out'][pos]:.1f} a week from {who or 'nobody'} ({ordinal(rk[pos])} of {n} at {pos}).")
        if trade:
            add("value", f"Dynasty bank: roster and picks worth {x['value']:,.0f} in trade value, {ordinal(rk['value'])} in the league.",
                f"Asset-poor: {x['value']:,.0f} in total trade value, {ordinal(rk['value'])} of {n}.")
            add("youth", f"Built to last: value-weighted age {x['value_age']}, {nth(rk['youth'], 'youngest')} core in the league.",
                f"AARP roster: value-weighted age {x['value_age']}, {nth(n + 1 - rk['youth'], 'oldest')} core in the league.")
            add("picks", f"Pick hoarder: {x['picks_n']} picks worth {x['picks_value']:,.0f} ({ordinal(rk['picks'])} in draft capital).",
                f"Mortgaged the future: {x['picks_n']} picks worth {x['picks_value']:,.0f} ({ordinal(rk['picks'])} in draft capital).")
        if model and x["remaining"]:
            add("sched", f"Soft road ahead: remaining opponents average {x['opp']:.1f} a week, {nth(rk['sched'], 'easiest')} schedule left.",
                f"Gauntlet ahead: remaining opponents average {x['opp']:.1f} a week, {nth(n + 1 - rk['sched'], 'toughest')} schedule left.")

        # Luck, trend, injuries, close losses (absolute thresholds, not ranks)
        if x["luck"] <= -1:
            good.append((3, f"Robbed: {x['exp_wins']:.1f} expected wins from all-play, only {x['wins']:g} on the board. The scoreboard owes you {-x['luck']:.1f}."))
        elif x["luck"] >= 1:
            bad.append((3, f"Schedule merchant: {x['wins']:g} wins but only {x['exp_wins']:.1f} expected from all-play. That's {x['luck']:.1f} gift wins."))
        if x["trend"] >= 8:
            good.append((2, f"Momentum: playoff odds up {x['trend']:.1f} points in the last week, now {x['playoff']:.1f}%."))
        elif x["trend"] <= -8:
            bad.append((2, f"Sliding: playoff odds down {-x['trend']:.1f} points in the last week, now {x['playoff']:.1f}%."))
        if x["injured"]:
            bad.append((2, "Walking wounded: " + ", ".join(f"{p['name']} ({p['injury']})" for p in x["injured"][:3]) + " in the starting lineup."))
        if len(x["close_losses"]) >= 2:
            bad.append((1, f"Heartbreak hotel: {len(x['close_losses'])} losses by less than 10 points."))

        # Always give both sides something.
        if len(good) < 2:
            best = sorted((kv for kv in rk.items() if kv[0] not in used), key=lambda kv: kv[1])[: 2 - len(good)]
            for key, k in best:
                good.append((0, f"Silver lining: {ordinal(k)} in {LABELS.get(key, key)}."))
        if len(bad) < 2:
            worst = sorted((kv for kv in rk.items() if kv[0] not in used), key=lambda kv: -kv[1])[: 2 - len(bad)]
            for key, k in worst:
                bad.append((0, f"Nobody's perfect: {ordinal(k)} in {LABELS.get(key, key)}."))

        # HIM score: half this season, half the dynasty.
        season_part = ((n - rk["pf"]) + (n - rk["ap"]) + (n - rk["playoff"])) / (3 * (n - 1))
        dyn_keys = [k for k in ("value", "youth", "picks") if k in rk]
        dyn_part = sum(n - rk[k] for k in dyn_keys) / (len(dyn_keys) * (n - 1)) if dyn_keys else season_part
        score = round(100 * (0.6 * season_part + 0.4 * dyn_part))
        verdict = ("Certified HIM" if score >= 75 else "Mostly HIM" if score >= 58 else
                   "Undecided" if score >= 42 else "Mostly Ass" if score >= 25 else "Certified Ass")

        t = pages[r]
        out[str(r)] = {
            "team": t["team"],
            "score": score,
            "verdict": verdict,
            "summary": (f"{t['team'].strip()} is {verdict}: {x['playoff']:.1f}% to make the playoffs, "
                        f"{x['title']:.1f}% to win it all"
                        + (f", {ordinal(rk['value'])} in dynasty value." if "value" in rk else ".")),
            "him": [t for _, t in sorted(good, key=lambda z: -z[0])][:5],
            "ass": [t for _, t in sorted(bad, key=lambda z: -z[0])][:5],
            "ranks": rk,
            "all_play": [x["ap_w"], x["ap_l"]],
            "luck": round(x["luck"], 2),
        }

    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "weeks_completed": done,
        "author": "The Analyst (written automatically from league data every morning)",
        "teams": out,
    }
    (DATA_DIR / "analysis.json").write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote analysis for {len(out)} teams.")


LABELS = {
    "pf": "points scored", "eff": "lineup efficiency", "ap": "all-play record", "form": "recent form",
    "playoff": "playoff odds", "value": "dynasty value", "youth": "roster youth", "picks": "draft capital",
    "sched": "schedule ease", "QB": "QB output", "RB": "RB output", "WR": "WR output", "TE": "TE output",
}

if __name__ == "__main__":
    main()
