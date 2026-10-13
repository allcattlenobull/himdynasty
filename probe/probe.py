import json, urllib.request, pathlib
U = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
B = "https://site.web.api.espn.com/apis/common/v3/sports/football/college-football"
URLS = {
 "mddb_p2": "https://www.nflmockdraftdatabase.com/big-boards/2027/consensus-big-board-2027?page=2",
 "mddb_wr": "https://www.nflmockdraftdatabase.com/big-boards/2027/consensus-big-board-2027?position=WR",
 "mddb_pos_wr": "https://www.nflmockdraftdatabase.com/big-boards/2027/consensus-big-board-2027/wr",
 "espn_draft_ath1": "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2027/draft/athletes/4582818",
 "espn_draft_ath_p2": "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2027/draft/athletes?limit=200&page=1",
 "espn_rec3": f"{B}/statistics/byathlete?region=us&lang=en&contentorigin=espn&isqualified=false&page=1&limit=3&category=offense%3Areceiving&sort=receiving.receivingYards%3Adesc&season=2026&seasontype=2",
 "espn_gamelog": f"{B}/athletes/5289510/gamelog?season=2026",
 "espn_ath": f"{B}/athletes/5289510",
}
out = pathlib.Path("probe/out2"); out.mkdir(parents=True, exist_ok=True)
summary = {}
for name, url in URLS.items():
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": U}), timeout=40) as r:
            body = r.read().decode("utf-8", "replace"); status = r.status
    except Exception as e:
        body, status = "", f"ERR {e}"
    (out / f"{name}.txt").write_text(body)
    summary[name] = {"status": str(status), "bytes": len(body)}
(out / "summary.json").write_text(json.dumps(summary, indent=1))
