#!/usr/bin/env python3
"""Link previews for HIM Dynasty: images and small share pages.

When a link is pasted into iMessage, GroupMe, Discord or X, the app reads the
page's Open Graph tags (no JavaScript) to build the preview card. GitHub Pages
is static, so this script writes:

  docs/og/site.png                     default card used by every page
  docs/og/team-{rid}.png               one card per team (record, odds, PF)
  docs/og/recap-{season}-w{n}.png      one card per recap week
  docs/og/mock-{rid}.png               one card per team's mock draft picks
  docs/share/team-{rid}.html           share pages: preview tags, then a
  docs/share/recap-{season}-w{n}.html  redirect to the real page
  docs/share/mock-{rid}.html

Images are only rewritten when their content changes, and each share page
points at its image with ?v=<hash> so apps refresh cached previews.

Needs Pillow (pip install pillow). Fonts are vendored in scripts/fonts (OFL).
"""

import hashlib
import html
import json
import os
import re
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
DATA = DOCS / "data"
OG = DOCS / "og"
SHARE = DOCS / "share"
FONTS = Path(__file__).resolve().parent / "fonts"
SITE = os.environ.get("SITE_URL", "https://allcattlenobull.github.io/himdynasty/").rstrip("/") + "/"

W, H = 1200, 630
BG = (9, 9, 11)
PANEL = (17, 17, 21)
LINE = (42, 42, 51)
TEXT = (242, 239, 233)
MUTED = (154, 154, 166)
RED = (227, 18, 27)
GOLD = (212, 160, 23)
GOOD = (61, 220, 132)


# --------------------------------------------------------------------------- #
# Drawing helpers
# --------------------------------------------------------------------------- #
def anton(size):
    return ImageFont.truetype(str(FONTS / "Anton-Regular.ttf"), size)


def inter(size, weight=700):
    f = ImageFont.truetype(str(FONTS / "Inter.ttf"), size)
    try:
        axes = f.get_variation_axes()
        vals = []
        for a in axes:
            name = a.get("name", b"")
            name = name.decode() if isinstance(name, bytes) else str(name)
            if "eight" in name:
                vals.append(weight)
            elif "ptical" in name:
                vals.append(max(a["minimum"], min(a["maximum"], size if size <= 32 else 32)))
            else:
                vals.append(a.get("default", a["minimum"]))
        f.set_variation_by_axes(vals)
    except Exception:  # noqa: BLE001 - static fallback is fine
        pass
    return f


ALLOWED = re.compile(r"[^ -ɏ‐-‧′-″]")


def clean(text, fallback=""):
    """Drop characters the fonts can't draw (emoji), tidy spaces."""
    t = ALLOWED.sub("", text or "")
    t = re.sub(r"\s+", " ", t).strip()
    return t or fallback


def fit(draw, text, maker, max_w, start, minimum):
    size = start
    while size > minimum:
        f = maker(size)
        if draw.textlength(text, font=f) <= max_w:
            return f
        size -= 2
    f = maker(minimum)
    while text and draw.textlength(text + "…", font=f) > max_w:
        text = text[:-1]
    return f


def ellipsize(draw, text, font, max_w):
    if draw.textlength(text, font=font) <= max_w:
        return text
    while text and draw.textlength(text + "…", font=font) > max_w:
        text = text[:-1]
    return text.rstrip() + "…"


def logo(draw, x, y, s):
    """The shield logo from assets/logo.svg, scaled to s pixels."""
    k = s / 100
    P = lambda pts: [(x + px * k, y + py * k) for px, py in pts]  # noqa: E731
    shield = P([(50, 3), (93, 16), (88, 64), (50, 97), (12, 64), (7, 16)])
    draw.polygon(shield, fill=(10, 10, 12), outline=RED, width=max(2, int(5 * k)))
    draw.polygon(P([(27, 35), (32, 17), (41, 28), (50, 10), (59, 28), (68, 17), (73, 35)]), fill=TEXT)
    draw.polygon(P([(27, 35), (73, 35), (71, 41), (29, 41)]), fill=TEXT)
    for pts in ([(30, 47), (42, 47), (42, 80), (30, 72)], [(58, 47), (70, 47), (70, 72), (58, 80)],
                [(42, 59), (58, 55), (58, 64), (42, 68)]):
        draw.polygon(P(pts), fill=RED)


def canvas(kicker):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    # Subtle diagonal texture and red edge.
    for i in range(-H, W, 28):
        d.line([(i, H), (i + H, 0)], fill=(14, 14, 17), width=10)
    d.rectangle([0, 0, 14, H], fill=RED)
    logo(d, 56, 44, 86)
    d.text((156, 52), "HIM", font=anton(44), fill=TEXT)
    d.text((158, 104), "D Y N A S T Y", font=inter(18, 800), fill=RED)
    if kicker:
        f = anton(30)
        tw = d.textlength(kicker, font=f)
        d.rectangle([W - 60 - tw - 28, 56, W - 60, 106], fill=RED)
        d.text((W - 60 - tw - 14, 60), kicker, font=f, fill=BG)
    return img, d


def stat_row(d, items, y, x0=56, gap=18):
    n = len(items)
    w = (W - x0 - 56 - gap * (n - 1)) / n
    for i, (label, value, color) in enumerate(items):
        x = x0 + i * (w + gap)
        d.rectangle([x, y, x + w, y + 118], fill=PANEL, outline=LINE, width=2)
        d.text((x + 18, y + 14), label.upper(), font=inter(18, 700), fill=MUTED)
        f = fit(d, value, anton, w - 36, 58, 30)
        d.text((x + 18, y + 40), value, font=f, fill=color or TEXT)


def save(img, path):
    """Write only when the bytes change. Returns a short content hash."""
    buf = BytesIO()
    img.save(buf, "PNG", optimize=True)
    data = buf.getvalue()
    digest = hashlib.sha1(data).hexdigest()[:10]
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or path.read_bytes() != data:
        path.write_bytes(data)
    return digest


def share_page(name, title, description, image, version, target):
    """A tiny page with preview tags that sends people on to the real page."""
    t, dsc = html.escape(title, quote=True), html.escape(description, quote=True)
    img = f"{SITE}og/{image}?v={version}"
    url = f"{SITE}share/{name}.html"
    dest = html.escape(target, quote=True)
    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{t}</title>
<meta name="description" content="{dsc}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="HIM Dynasty">
<meta property="og:title" content="{t}">
<meta property="og:description" content="{dsc}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{t}">
<meta name="twitter:description" content="{dsc}">
<meta name="twitter:image" content="{img}">
<meta name="theme-color" content="#09090b">
<link rel="icon" href="../assets/logo.svg" type="image/svg+xml">
<meta http-equiv="refresh" content="0; url=../{dest}">
<script>location.replace("../{dest}");</script>
<style>body{{background:#09090b;color:#f2efe9;font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0}}a{{color:#e3121b}}</style>
</head>
<body><p>Opening <a href="../{dest}">{t}</a>…</p></body>
</html>
"""
    SHARE.mkdir(parents=True, exist_ok=True)
    path = SHARE / f"{name}.html"
    if not path.exists() or path.read_text(encoding="utf-8") != page:
        path.write_text(page, encoding="utf-8")


def load(name):
    p = DATA / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


# --------------------------------------------------------------------------- #
# Cards
# --------------------------------------------------------------------------- #
def site_card(latest):
    img, d = canvas(None)
    d.text((56, 190), "ARE YOU", font=anton(150), fill=TEXT)
    d.text((56, 350), "HIM?", font=anton(150), fill=RED)
    name = clean((latest or {}).get("league", {}).get("name"), "The HIM Dynasty")
    d.text((560, 300), name.upper(), font=anton(46), fill=TEXT)
    d.text((562, 365), "Standings · playoff odds · weekly recaps", font=inter(26, 600), fill=MUTED)
    d.text((562, 402), "Mock drafts · trade center · analytics", font=inter(26, 600), fill=MUTED)
    d.text((562, 439), "History back to 2024", font=inter(26, 600), fill=MUTED)
    return save(img, OG / "site.png")


def team_card(t, league):
    rid = t["roster_id"]
    img, d = canvas(f"#{t['rank']} OF {len(league['standings'])}")
    name = clean(t["team"], f"Team {rid}")
    f = fit(d, name.upper(), anton, W - 112, 110, 54)
    d.text((56, 175), name.upper(), font=f, fill=TEXT)
    r = t["record"]
    rec = f"{r['wins']}-{r['losses']}" + (f"-{r['ties']}" if r.get("ties") else "")
    d.text((58, 315), f"{clean(t['owner'])}  ·  {league['league'].get('season')} season", font=inter(30, 600), fill=MUTED)
    po = t["playoff_odds"]
    stat_row(d, [("Record", rec, None), ("Points for", f"{t['points_for']:.1f}", None),
                 ("Playoff odds", f"{po:.0f}%", GOOD if po >= 50 else RED if po < 20 else None),
                 ("Title odds", f"{t['champion_odds']:.1f}%", None)], 410)
    return save(img, OG / f"team-{rid}.png")


def recap_card(recap, wk):
    img, d = canvas(f"{recap['season']} RECAP")
    T = recap["teams"]
    team = lambda r: clean(T[str(r)]["team"], f"Team {r}")  # noqa: E731
    pts = lambda r: wk["teams"][str(r)]["pts"]  # noqa: E731
    d.text((56, 160), f"WEEK {wk['week']}", font=anton(130), fill=TEXT)
    A = wk["awards"]
    rows = [("HIM of the week", f"{team(A['him'])}", f"{pts(A['him']):.1f}", GOLD),
            ("Ass of the week", f"{team(A['ass'])}", f"{pts(A['ass']):.1f}", RED)]
    if A.get("blowout"):
        g = next((g for g in wk["games"] if [g["a"], g["b"]] == A["blowout"]), None)
        if g and g.get("winner"):
            loser = g["b"] if g["winner"] == g["a"] else g["a"]
            rows.append(("Blowout", f"{team(g['winner'])} over {team(loser)}", f"+{g['margin']:.1f}", TEXT))
    if A.get("benchwarmer") is not None:
        b = A["benchwarmer"]
        rows.append(("Most left on bench", team(b), f"{wk['teams'][str(b)]['regret']:.1f}", RED))
    y = 335
    for label, who, val, color in rows[:4]:
        d.rectangle([56, y, W - 56, y + 60], fill=PANEL, outline=LINE, width=2)
        d.rectangle([56, y, 62, y + 60], fill=color)
        d.text((80, y + 17), label.upper(), font=inter(20, 800), fill=MUTED)
        vf = anton(40)
        vw = d.textlength(val, font=vf)
        d.text((W - 76 - vw, y + 6), val, font=vf, fill=color if color != TEXT else TEXT)
        wf = inter(28, 700)
        d.text((330, y + 13), ellipsize(d, who, wf, W - 76 - vw - 30 - 330), font=wf, fill=TEXT)
        y += 70
    return save(img, OG / f"recap-{recap['season']}-w{wk['week']}.png")


def mock_card(mock, rid, team_name, picks, board):
    img, d = canvas(f"{mock.get('draft_year', '')} MOCK DRAFT")
    name = clean(team_name, f"Team {rid}")
    f = fit(d, name.upper(), anton, W - 112, 96, 50)
    d.text((56, 165), name.upper(), font=f, fill=TEXT)
    by_key = {p["key"]: p for p in board}
    y = 300
    if not picks:
        d.text((58, y), "No picks in this year's rookie draft.", font=inter(32, 600), fill=MUTED)
    for p in picks[:4]:
        pr = by_key.get(p.get("prospect")) or {}
        d.rectangle([56, y, W - 56, y + 64], fill=PANEL, outline=LINE, width=2)
        d.text((76, y + 8), p["label"], font=anton(40), fill=RED)
        nm = clean(pr.get("name") or p.get("prospect", "").title())
        d.text((200, y + 14), ellipsize(d, nm, inter(32, 800), 560), font=inter(32, 800), fill=TEXT)
        meta = " · ".join(x for x in (pr.get("pos"), clean(pr.get("school") or "")) if x)
        mf = inter(24, 600)
        mw = d.textlength(meta, font=mf)
        d.text((W - 80 - mw, y + 20), meta, font=mf, fill=MUTED)
        y += 74
    if len(picks) > 4:
        d.text((58, y + 2), f"+ {len(picks) - 4} more", font=inter(24, 700), fill=MUTED)
    return save(img, OG / f"mock-{rid}.png")


# --------------------------------------------------------------------------- #
def main():
    latest = load("latest.json")
    v = site_card(latest)
    print(f"site card {v}")
    if latest:
        for rid, t in latest.get("teams", {}).items():
            v = team_card(t, latest)
            r = t["record"]
            rec = f"{r['wins']}-{r['losses']}" + (f"-{r['ties']}" if r.get("ties") else "")
            share_page(f"team-{rid}", f"{clean(t['team'], 'Team')} · HIM Dynasty",
                       f"{rec}, #{t['rank']} in the league. {t['playoff_odds']:.0f}% playoff odds, "
                       f"{t['champion_odds']:.1f}% title odds, {t['points_for']:.1f} points for.",
                       f"team-{rid}.png", v, f"team.html?id={rid}")
        print(f"{len(latest.get('teams', {}))} team cards")

    index = load("recap.json")
    if index:
        recap = load(f"recaps/{index['current']}.json")
        for wk in (recap or {}).get("weeks", []):
            v = recap_card(recap, wk)
            A = wk["awards"]
            T = recap["teams"]
            desc = (f"HIM of the week: {clean(T[str(A['him'])]['team'])} ({wk['teams'][str(A['him'])]['pts']:.1f}). "
                    f"Ass of the week: {clean(T[str(A['ass'])]['team'])} ({wk['teams'][str(A['ass'])]['pts']:.1f}). "
                    "Awards, bench regret and all-play records.")
            share_page(f"recap-{recap['season']}-w{wk['week']}", f"Week {wk['week']} Recap · HIM Dynasty", desc,
                       f"recap-{recap['season']}-w{wk['week']}.png", v, f"recap.html#{recap['season']}-w{wk['week']}")
        print(f"{len((recap or {}).get('weeks', []))} recap cards")

    mock = load("mock_draft.json")
    if mock and latest:
        board = mock.get("board") or []
        names = {str(r): t["team"] for r, t in latest.get("teams", {}).items()}
        by_owner = {}
        for p in mock.get("picks", []):
            by_owner.setdefault(str(p["owner"]), []).append(p)
        for rid, name in names.items():
            picks = by_owner.get(rid, [])
            v = mock_card(mock, rid, name, picks, board)
            by_key = {b["key"]: b for b in board}
            listing = ", ".join(f"{p['label']} {(by_key.get(p.get('prospect')) or {}).get('name', '')}".strip() for p in picks[:5])
            share_page(f"mock-{rid}", f"{clean(name, 'Team')} mock draft · HIM Dynasty",
                       f"{mock.get('draft_year', '')} rookie mock: {listing or 'no picks this year'}.",
                       f"mock-{rid}.png", v, f"draft.html?team={rid}")
        print(f"{len(names)} mock cards")


if __name__ == "__main__":
    main()
