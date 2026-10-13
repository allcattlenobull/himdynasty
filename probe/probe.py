import json, urllib.request, pathlib
U = "him-dynasty-probe"
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": U}), timeout=60) as r:
        return json.load(r)
out = pathlib.Path("probe/out5"); out.mkdir(parents=True, exist_ok=True)
state = get("https://api.sleeper.app/v1/state/nfl")
(out / "state.json").write_text(json.dumps(state))
wk = state.get("week") or 6
proj = {}
for pos in ["QB", "RB", "WR", "TE", "K", "DEF"]:
    proj[pos] = get(f"https://api.sleeper.com/projections/nfl/2026/{wk}?season_type=regular&position[]={pos}&order_by=pts_ppr")
(out / "proj.json").write_text(json.dumps(proj))
st = {}
for pos in ["QB", "WR", "DEF", "K"]:
    st[pos] = get(f"https://api.sleeper.com/stats/nfl/2026/5?season_type=regular&position[]={pos}&order_by=pts_ppr")[:40]
(out / "stats5.json").write_text(json.dumps(st))
(out / "schedule.json").write_text(json.dumps(get("https://api.sleeper.com/schedule/nfl/regular/2026")))
lg = get("https://api.sleeper.app/v1/league/1312005038838673409")
(out / "league.json").write_text(json.dumps({k: lg.get(k) for k in ("scoring_settings", "roster_positions", "settings")}))
(out / "matchups.json").write_text(json.dumps(get(f"https://api.sleeper.app/v1/league/1312005038838673409/matchups/{wk}")))
(out / "rosters.json").write_text(json.dumps(get("https://api.sleeper.app/v1/league/1312005038838673409/rosters")))
