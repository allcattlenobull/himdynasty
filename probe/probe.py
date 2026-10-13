import gzip, json, urllib.request, pathlib
out = pathlib.Path("probe/out7"); out.mkdir(parents=True, exist_ok=True)
B = "https://api.sleeper.app/v1"
def get(path):
    with urllib.request.urlopen(urllib.request.Request(B + path, headers={"User-Agent": "him-dynasty-probe"}), timeout=90) as r:
        return r.read()
def save(path):
    try:
        data = get(path)
    except Exception as e:
        data = json.dumps({"__error__": str(e)}).encode()
    (out / (path.strip("/").replace("/", "__") + ".json")).write_bytes(data)
    try:
        return json.loads(data)
    except Exception:
        return None
save("/state/nfl")
lid = "1312005038838673409"
while lid and lid != "0":
    lg = save(f"/league/{lid}")
    users = save(f"/league/{lid}/users")
    save(f"/league/{lid}/rosters")
    save(f"/league/{lid}/winners_bracket")
    save(f"/league/{lid}/losers_bracket")
    save(f"/league/{lid}/traded_picks")
    for w in range(1, 19):
        save(f"/league/{lid}/matchups/{w}")
    for w in range(0, 19):
        save(f"/league/{lid}/transactions/{w}")
    for d in save(f"/league/{lid}/drafts") or []:
        save(f"/draft/{d['draft_id']}/picks")
        save(f"/draft/{d['draft_id']}")
    if users and lg:
        uid = (users[0] or {}).get("user_id")
        for s in (int(lg["season"]), int(lg["season"]) + 1):
            save(f"/user/{uid}/leagues/nfl/{s}")
    lid = (lg or {}).get("previous_league_id")
(out / "players.json.gz").write_bytes(gzip.compress(get("/players/nfl")))
