#!/usr/bin/env python3
"""YouTube highlight clips for the mock draft's prospects.

Uses the official YouTube Data API (search.list), which needs a free API key
stored as the repository secret YOUTUBE_API_KEY. Without the key this script
just records that clips are off and keeps whatever was saved before.

Each search costs 100 of the 10,000 free daily quota units, so a run does at
most MAX_SEARCHES searches: mocked players first, then the rest of the board,
refreshing entries older than a few days. Only embeddable videos from the
current college season whose title names the player are kept.

Output: docs/data/highlights.json
  {"enabled": bool, "updated": iso, "players": {prospect_key: {"fetched": date,
   "query": str, "videos": [{"id", "title", "channel", "date"}]}}}
"""

import datetime as dt
import json
import os
import re
import unicodedata
import urllib.parse
import urllib.request
from html import unescape
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "docs" / "data"
OUT = DATA_DIR / "highlights.json"
API = "https://www.googleapis.com/youtube/v3/search"
MAX_SEARCHES = int(os.environ.get("HIGHLIGHT_SEARCHES", "60"))
FRESH_DAYS_MOCKED = 4
FRESH_DAYS_OTHER = 10


def log(msg):
    print(f"[highlights] {msg}", flush=True)


def fold(text):
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9 ]+", " ", text.lower())


def search(key, query, after):
    params = {
        "part": "snippet", "type": "video", "videoEmbeddable": "true", "maxResults": "8",
        "order": "relevance", "q": query, "publishedAfter": after, "key": key,
        "safeSearch": "moderate", "relevanceLanguage": "en",
    }
    req = urllib.request.Request(f"{API}?{urllib.parse.urlencode(params)}",
                                 headers={"User-Agent": "HIM-Dynasty-highlights"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r).get("items") or []


def main():
    try:
        saved = json.loads(OUT.read_text())
    except (FileNotFoundError, ValueError):
        saved = {}
    players = saved.get("players") or {}
    key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    mock = json.loads((DATA_DIR / "mock_draft.json").read_text())
    season = int(mock.get("college_season") or dt.date.today().year)
    after = f"{season}-08-01T00:00:00Z"

    if not key:
        log("No YOUTUBE_API_KEY secret; clips stay off.")
        OUT.write_text(json.dumps({"enabled": False, "updated": saved.get("updated"), "players": players},
                                  indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        return

    today = dt.date.today()
    mocked = {p["prospect"] for p in mock.get("picks") or []}
    board = mock.get("board") or []
    order = [e for e in board if e["key"] in mocked] + [e for e in board if e["key"] not in mocked]
    done = 0
    for e in order:
        if done >= MAX_SEARCHES:
            break
        old = players.get(e["key"]) or {}
        fresh = FRESH_DAYS_MOCKED if e["key"] in mocked else FRESH_DAYS_OTHER
        try:
            age = (today - dt.date.fromisoformat(old.get("fetched", "2000-01-01"))).days
        except ValueError:
            age = 999
        if age < fresh:
            continue
        query = f"{e['name']} {e.get('school') or ''} {season} highlights".replace("  ", " ").strip()
        try:
            items = search(key, query, after)
        except Exception as exc:  # noqa: BLE001  (quota or network: keep what we have)
            log(f"Search failed ({exc}); stopping for today.")
            break
        done += 1
        last = fold(e["name"]).split()[-1] if e.get("name") else ""
        videos = []
        for it in items:
            vid = (it.get("id") or {}).get("videoId")
            sn = it.get("snippet") or {}
            title = unescape(sn.get("title") or "")
            if not vid or (last and last not in fold(title)):
                continue
            videos.append({"id": vid, "title": title, "channel": unescape(sn.get("channelTitle") or ""),
                           "date": (sn.get("publishedAt") or "")[:10]})
        # Prefer clips about this season over recaps of last season.
        videos.sort(key=lambda v: (str(season - 1) in v["title"] and str(season) not in v["title"]))
        videos = videos[:5]
        players[e["key"]] = {"fetched": today.isoformat(), "query": query, "videos": videos}

    keep = {e["key"] for e in board}
    players = {k: v for k, v in players.items() if k in keep}
    OUT.write_text(json.dumps({"enabled": True, "updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                               "players": players}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    with_clips = sum(1 for v in players.values() if v["videos"])
    log(f"{done} searches; {with_clips}/{len(board)} prospects have clips.")


if __name__ == "__main__":
    main()
