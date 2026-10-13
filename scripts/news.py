#!/usr/bin/env python3
"""Player news for every rostered player in HIM Dynasty, for the Buzz page.

Source: ESPN's public fantasy football player news feed, which carries ESPN
stories and RotoWire player notes. One request per rostered player (kickers
and team defenses included), matched through the ESPN id Sleeper provides.

The Buzz page adds live items in the browser (ESPN for a single player,
Bluesky posts, and embedded X timelines); this file is the nightly backbone.

Reads docs/data/latest.json; writes docs/data/news.json (last 21 days).
"""

import csv
import datetime as dt
import io
import json
import time
import urllib.request
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "docs" / "data"
IDS = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv"
FEED = "https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?limit=12&playerId={}"
KEEP_DAYS = 21


def fetch(url):
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "him-dynasty-buzz"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception:  # noqa: BLE001
            time.sleep(1.5 * (attempt + 1))
    return None


def sleeper_to_espn():
    """Fallback id map from DynastyProcess, for players Sleeper has no ESPN id for."""
    try:
        req = urllib.request.Request(IDS, headers={"User-Agent": "him-dynasty-buzz"})
        with urllib.request.urlopen(req, timeout=60) as r:
            rows = csv.DictReader(io.StringIO(r.read().decode("utf-8", "replace")))
            return {x["sleeper_id"]: x["espn_id"] for x in rows
                    if x.get("sleeper_id") not in (None, "", "NA") and x.get("espn_id") not in (None, "", "NA")}
    except Exception:  # noqa: BLE001
        return {}


def clip(text, n):
    text = " ".join((text or "").split())
    return text if len(text) <= n else text[: n - 1].rsplit(" ", 1)[0] + "…"


def main():
    latest = json.loads((DATA_DIR / "latest.json").read_text())
    players = {}
    fallback = sleeper_to_espn()
    for rid, t in latest["teams"].items():
        r = t["roster"]
        for p in [x["player"] for x in r["starters"] if x.get("player")] + r["bench"] + r["taxi"] + r["ir"]:
            espn = p.get("espn_id") or fallback.get(p["id"])
            if espn:
                p["espn_id"] = espn
                players[str(espn)] = {"sleeper_id": p["id"], "name": p["name"], "pos": p["pos"],
                                              "nfl": p["nfl"], "owner": int(rid)}

    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=KEEP_DAYS)
    items = {}
    for espn_id, info in players.items():
        data = fetch(FEED.format(espn_id))
        time.sleep(0.15)
        for f in (data or {}).get("feed", []):
            published = f.get("published") or f.get("lastModified")
            try:
                when = dt.datetime.fromisoformat(published.replace("Z", "+00:00"))
            except Exception:  # noqa: BLE001
                continue
            if when < cutoff:
                continue
            key = str(f.get("id"))
            web = (((f.get("links") or {}).get("web") or {}).get("href"))
            item = items.setdefault(key, {
                "id": key,
                "published": when.isoformat(timespec="seconds"),
                "source": "RotoWire via ESPN" if f.get("type") == "Rotowire" else "ESPN",
                "headline": clip(f.get("headline"), 220),
                "body": clip(f.get("story") or f.get("description"), 700),
                "link": web if web and web.startswith("https://") else None,
                "image": next((i.get("url") for i in f.get("images") or [] if (i.get("url") or "").startswith("https://")), None),
                "players": [],
            })
            if info["sleeper_id"] not in item["players"]:
                item["players"].append(info["sleeper_id"])

    out = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "players": {v["sleeper_id"]: dict(v, espn_id=k) for k, v in players.items()},
        "items": sorted(items.values(), key=lambda x: x["published"], reverse=True),
    }
    (DATA_DIR / "news.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(out['items'])} news items for {len(players)} players.")


if __name__ == "__main__":
    main()
