import json, urllib.request, pathlib
U = "him-dynasty-probe"
def get(path):
    with urllib.request.urlopen(urllib.request.Request("https://api.sleeper.app/v1" + path, headers={"User-Agent": U}), timeout=40) as r:
        return json.load(r)
out = pathlib.Path("probe/out4"); out.mkdir(parents=True, exist_ok=True)
lid = "1312005038838673409"; seen = []
while lid and lid != "0" and lid not in seen:
    seen.append(lid)
    lg = get(f"/league/{lid}")
    users = get(f"/league/{lid}/users"); rosters = get(f"/league/{lid}/rosters")
    drafts = get(f"/league/{lid}/drafts")
    blob = {"league": {k: lg.get(k) for k in ("league_id", "season", "name", "status", "previous_league_id", "roster_positions", "scoring_settings", "settings")},
            "users": [{k: u.get(k) for k in ("user_id", "display_name", "metadata")} for u in users],
            "rosters": [{k: r.get(k) for k in ("roster_id", "owner_id")} for r in rosters], "drafts": []}
    for d in drafts:
        picks = get(f"/draft/{d['draft_id']}/picks")
        blob["drafts"].append({"draft": {k: d.get(k) for k in ("draft_id", "season", "type", "status", "settings", "metadata", "draft_order", "start_time")},
                               "picks": [{k: p.get(k) for k in ("round", "pick_no", "draft_slot", "roster_id", "picked_by", "player_id", "metadata", "is_keeper")} for p in picks]})
    (out / f"league_{lg.get('season')}_{lid}.json").write_text(json.dumps(blob))
    lid = lg.get("previous_league_id")
(out / "chain.json").write_text(json.dumps(seen))
