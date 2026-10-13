import json, urllib.request, pathlib
out = pathlib.Path("probe/out8"); out.mkdir(parents=True, exist_ok=True)
API = "https://api.sleeper.app/v1"
LID = "1312005038838673409"
def get(p):
    req = urllib.request.Request(API + p, headers={"User-Agent": "him-probe"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)
(out / "league.json").write_text(json.dumps(get(f"/league/{LID}")))
(out / "users.json").write_text(json.dumps(get(f"/league/{LID}/users")))
(out / "rosters.json").write_text(json.dumps(get(f"/league/{LID}/rosters")))
for w in range(1, 7):
    (out / f"matchups_{w}.json").write_text(json.dumps(get(f"/league/{LID}/matchups/{w}")))
players = get("/players/nfl")
pos = {pid: (p.get("fantasy_positions") or ([p["position"]] if p.get("position") else [])) for pid, p in players.items()}
(out / "positions.json").write_text(json.dumps(pos))
