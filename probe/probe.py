import json, urllib.request, pathlib, re
L = "1312005038838673409"
URLS = {
 "espn_draft_athletes": "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2027/draft/athletes?limit=50",
 "espn_draft": "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2027/draft",
 "espn_cfb_byathlete": "https://site.web.api.espn.com/apis/common/v3/sports/football/college-football/statistics/byathlete?region=us&lang=en&contentorigin=espn&isqualified=false&page=1&limit=50&category=offense%3Areceiving&sort=receiving.receivingYards%3Adesc&season=2026&seasontype=2",
 "espn_cfb_scoreboard": "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard",
 "fp_dynasty_rookies": "https://www.fantasypros.com/nfl/rankings/dynasty-rookies.php",
 "mddb_consensus": "https://www.nflmockdraftdatabase.com/big-boards/2027/consensus-big-board-2027",
 "drafttek": "https://www.drafttek.com/2027-NFL-Draft-Big-Board/Top-NFL-Draft-Prospects-2027-Page-1.asp",
 "tankathon": "https://www.tankathon.com/nfl/big_board",
 "cfbd_nokey": "https://api.collegefootballdata.com/player/search?searchTerm=smith",
 "sleeper_traded": f"https://api.sleeper.app/v1/league/{L}/traded_picks",
 "sleeper_drafts": f"https://api.sleeper.app/v1/league/{L}/drafts",
 "sleeper_league": f"https://api.sleeper.app/v1/league/{L}",
}
out = pathlib.Path("probe/out"); out.mkdir(parents=True, exist_ok=True)
summary = {}
for name, url in URLS.items():
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36", "Accept": "*/*"})
        with urllib.request.urlopen(req, timeout=40) as r:
            body = r.read().decode("utf-8", "replace"); status = r.status
    except Exception as e:
        body = str(getattr(e, "read", lambda: b"")() or b"", "utf-8", "replace") if hasattr(e, "read") else ""
        status = f"ERR {e}"
    (out / f"{name}.txt").write_text(body[:400000])
    summary[name] = {"status": str(status), "bytes": len(body), "head": body[:300]}
(out / "summary.json").write_text(json.dumps(summary, indent=1))
