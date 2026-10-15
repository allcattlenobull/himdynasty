import json, urllib.request, pathlib
out = pathlib.Path("probe/out9"); out.mkdir(parents=True, exist_ok=True)
LID = "1312005038838673409"
def get(u):
    req = urllib.request.Request(u, headers={"User-Agent": "him-probe"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)
A = "https://api.sleeper.app/v1"
(out / "league.json").write_text(json.dumps(get(f"{A}/league/{LID}")))
(out / "rosters.json").write_text(json.dumps(get(f"{A}/league/{LID}/rosters")))
(out / "users.json").write_text(json.dumps(get(f"{A}/league/{LID}/users")))
(out / "state.json").write_text(json.dumps(get(f"{A}/state/nfl")))
for w in range(1, 7):
    (out / f"matchups_{w}.json").write_text(json.dumps(get(f"{A}/league/{LID}/matchups/{w}")))
players = get(f"{A}/players/nfl")
slim = {pid: {k: p.get(k) for k in ("full_name", "position", "fantasy_positions", "team", "injury_status", "injury_body_part", "injury_start_date", "status", "age", "years_exp")} for pid, p in players.items() if p.get("position") in ("QB","RB","WR","TE","K","DEF")}
(out / "players.json").write_text(json.dumps(slim))
for w in range(6, 18):
    for pos in ("QB","RB","WR","TE","K","DEF"):
        try:
            d = get(f"https://api.sleeper.com/projections/nfl/2026/{w}?season_type=regular&position[]={pos}&order_by=pts_ppr")
            d = [{"player_id": x.get("player_id"), "stats": x.get("stats"), "week": x.get("week")} for x in d]
        except Exception as e:
            d = {"error": str(e)}
        (out / f"proj_{w}_{pos}.json").write_text(json.dumps(d))
