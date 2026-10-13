import json, urllib.request, pathlib
U = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
URLS = {
 "espn_nfl_news": "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50",
 "espn_ffl_player_news": "https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?limit=20&playerId=3916387",
 "espn_athlete_news": "https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes/3916387/news?limit=20",
 "espn_now": "https://now.core.api.espn.com/v1/sports/news?sport=football&league=nfl&limit=20",
 "rotowire_rss": "https://www.rotowire.com/rss/news.php?sport=NFL",
 "rotowire_robots": "https://www.rotowire.com/robots.txt",
 "gnews_rss": "https://news.google.com/rss/search?q=%22Lamar%20Jackson%22&hl=en-US&gl=US&ceid=US:en",
 "gnews_robots": "https://news.google.com/robots.txt",
 "bsky_public": "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=Lamar%20Jackson&limit=10&sort=latest",
 "bsky_api": "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=Lamar%20Jackson&limit=10&sort=latest",
 "cbs_rss": "https://www.cbssports.com/rss/headlines/nfl/",
 "x_oembed": "https://publish.twitter.com/oembed?url=https%3A%2F%2Ftwitter.com%2FAdamSchefter",
 "sleeper_trending": "https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=10",
}
out = pathlib.Path("probe/out3"); out.mkdir(parents=True, exist_ok=True)
summary = {}
for name, url in URLS.items():
    try:
        req = urllib.request.Request(url, headers={"User-Agent": U, "Origin": "https://allcattlenobull.github.io"})
        with urllib.request.urlopen(req, timeout=40) as r:
            body = r.read().decode("utf-8", "replace"); status = r.status
            cors = r.headers.get("Access-Control-Allow-Origin")
    except Exception as e:
        body, status, cors = "", f"ERR {e}", None
    (out / f"{name}.txt").write_text(body[:300000])
    summary[name] = {"status": str(status), "bytes": len(body), "cors": cors, "head": body[:200]}
(out / "summary.json").write_text(json.dumps(summary, indent=1))
