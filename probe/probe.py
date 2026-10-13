import json, urllib.request, pathlib
out = pathlib.Path("probe/out6"); out.mkdir(parents=True, exist_ok=True)
res = {}
for name, url in {
    "scoreboard": "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
    "scoreboard_wk": "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=5&seasontype=2&dates=2026",
    "news": "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=20",
    "fnews": "https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?limit=5&playerId=4361307",
}.items():
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Origin": "https://allcattlenobull.github.io"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            body = r.read().decode()
            res[name] = {"status": r.status, "acao": r.headers.get("Access-Control-Allow-Origin"), "cache": r.headers.get("Cache-Control"), "len": len(body)}
            (out / f"{name}.json").write_text(body)
    except Exception as e:
        res[name] = {"error": str(e)}
(out / "summary.json").write_text(json.dumps(res, indent=1))
