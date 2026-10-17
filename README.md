# HIM Dynasty

**Are you HIM?**

Site for the HIM Dynasty Sleeper league (ID `1312005038838673409`), live at
https://allcattlenobull.github.io/himdynasty/

## Pages

| Page | What it is |
| --- | --- |
| `docs/index.html` | The gate: "Are you HIM?" Yes goes to the league, No goes to the butts. Keys Y and N work too. |
| `docs/league.html` | Standings (click a column header to sort), playoff picture, and draft order, each with a week-by-week chart. Click any team to follow it everywhere. |
| `docs/recap.html#2026-w5` | Weekly recap: an auto-written summary, awards (HIM and Ass of the week, blowout, nail-biter, worst start/sit, luckiest and unluckiest), every game with lineup efficiency and missed moves, the bench-regret leaderboard (week and season), and all-play records with luck. |
| `docs/no.html` | 100 cartoon animal butts for anyone who is not HIM. |
| `docs/draft.html` | Automatic rookie mock draft and big board (expert boards + college game logs + traded picks + whole-roster needs + this league's past drafts and each manager's habits). |
| `docs/trade.html` | Trade center: calculator, team-to-team builder, acceptance estimates, trade ideas, and a manager-by-manager trading guide. Recommendations account for this league's lineup, team windows, and each manager's trade and draft tendencies. |
| `docs/buzz.html` | News and live social for the league, a team (`?team=N`), or a player (`?player=ID`): nightly ESPN/RotoWire news, live ESPN news for one player, live Bluesky posts, embedded X insider timelines, live-on-X search, Sleeper trending. |
| `docs/analytics.html` | Analytics HQ: weekly start/sit for every team (best lineup, reasons for and against each player, waiver upgrades), a two-player compare, a stat explorer (EPA, CPOE, estimated YPRR, blitz and play-action splits, box counts, red zone, Next Gen Stats), a defense table, a team view, and player profiles. |
| `docs/history.html` | League history since the 2024 startup: champions, every season's standings and playoffs, the record book, all-time head-to-head, manager careers (by Sleeper account, so renamed teams stay one manager), every draft re-graded with today's values, and a trade archive that keeps re-scoring who won. |
| `docs/team.html?id=N` | One team: stats, roster (starters, bench, taxi, IR), full schedule with results and win odds, season trend. |

Every inner page has a score ticker on top (live NFL scores and upcoming games from ESPN, this league's matchups from Sleeper, and NFL headlines), refreshed every minute while games are live.

Branding lives in `docs/assets/` (`logo.svg`, `brand.css`). Every page has an Auto / Light / Dark theme switch (`theme.js`); Auto follows the device setting. Charts use Chart.js 4.4.1, included in `docs/assets/vendor/`. `motion.js` adds scroll reveals, count-ups, card tilt, page transitions, and a scroll progress bar; it turns itself off when the device asks for reduced motion.

## Daily update

`.github/workflows/daily-update.yml` runs every day at **4:00 AM Central**. GitHub can delay or drop scheduled runs (especially on the hour), so the workflow tries at :07, :27, and :47 past each hour from 09:00 to 12:59 UTC; the first attempt at or after 4:00 AM Central does the update and the rest skip. You can also run it any time from the Actions tab.

`scripts/update_league.py` (Python standard library only) pulls the league from Sleeper and writes `docs/data/latest.json` plus a dated copy in `docs/data/history/`. It records:

- **Standings:** record, PF, PA, max PF, projected wins, playoff and title odds
- **Playoff bracket:** current seeds with projected game odds; real results replace projections as games finish
- **Draft order (if the season ended today):** picks 1–6 are current non-playoff teams by lowest max PF; picks 7–12 are current playoff teams in the order the projected bracket eliminates them, lowest max PF first within a round, champion last
- **History:** for every completed week, the standings as of that week and the playoff odds and projected draft pick from re-simulating the rest of the season from that point

**Odds and rosters:** each team's expected weekly score blends its results so far with a roster outlook (`scripts/roster_strength.py`): Sleeper projections for the rest of the season for the players on the roster today, scored with league settings and blended with each player's own average, with injured players' chances of playing (Out, IR, Doubtful, Questionable, recovering over the following weeks), a small injury risk for everyone, and waiver-level replacements filling holes, averaged over many draws of who is available so depth counts. Results count one share per week played and the outlook six, so trades, pickups and injuries move the odds the next morning while results matter more as the season goes on. The trade calculator scales a trade's lineup change by the same share. The outlook appears as Roster/wk in the standings and on team pages.

Weekly max PF is computed from each team's best possible lineup and scaled to match Sleeper's season total. `diagnostics.max_pf_check` in `latest.json` shows the raw comparison.

## Sharing

- Team pages, recap weeks, mock drafts (with a team picked) and trades have a **Share** button: the phone share sheet, or copy link on a computer.
- Trade links carry both teams and every asset (`trade.html#calc&a=3&b=8&ga=…&gb=…`). If a player has moved rosters since the link was sent, he's left out and the page says so.
- Link previews: every page has Open Graph tags with `docs/og/site.png`. `scripts/share_cards.py` (Pillow, fonts in `scripts/fonts`, OFL) draws a card per team, recap week and team mock draft into `docs/og/`, and writes small pages in `docs/share/` that carry that card's preview tags and then forward to the real page. Share buttons use those links so group chats show the right card.

## Data checks

`scripts/check_data.py` runs after every update. It checks each file in `docs/data` for the fields the site reads (and that it was rebuilt recently). A file that fails goes back to its last committed version, so the site keeps yesterday's data for that part; the problem is saved in `status.json`, the run is flagged, and the footer names the part. `python scripts/check_data.py --dry-run` checks without restoring.

## A site that runs every season

- **Rollover:** Sleeper gives a renewed league a new id each year. `scripts/rollover.py` runs first every morning, finds the renewal (the next-season league whose previous league is the current one) and records it in `docs/data/league_ids.json`; every script reads the id from there (`scripts/league_pointer.py`). `SLEEPER_LEAGUE_ID` still overrides it.
- **Archive:** `scripts/history.py` walks the league chain and writes `docs/data/archive/<season>.json` for each season (finished seasons, including their end-of-season rosters, are written once and then reused) and `docs/data/history.json` for the History page. Completed trades and rookie drafts also produce sample-weighted manager profiles for the Trade Center: age and production preference, position targets, pick behavior, deal structure, activity, timing, favorite partners, and draft habits. Current-value outcomes are labeled as hindsight, and injury-risk preference is left unavailable because Sleeper does not preserve reliable point-in-time injury status.
- **Offseason:** start/sit pauses outside the regular season; analytics fall back to last season's stats until the new season has games.
- **Recaps:** each season's recap is kept in `docs/data/recaps/<season>.json` (built by `scripts/recap.py` inside the league update); `docs/data/recap.json` lists the seasons.
- **Storage:** daily snapshots in `docs/data/history/` are kept for 3 weeks, then one per week.
- **Alerts:** every step's result is written to `docs/data/status.json`. If any step fails, the run is marked failed (GitHub emails the repo owner) and the site footer says which part didn't refresh.

## Running locally

```bash
python3 scripts/update_league.py
python3 -m http.server --directory docs 8000
```

Then open http://localhost:8000.

Environment overrides: `SLEEPER_LEAGUE_ID`, `SIMULATIONS` (current week, default 10000), `HISTORY_SIMULATIONS` (past weeks, default 4000).

## Other scripts

- `scripts/trade_values.py` writes `docs/data/trade.json`: [DynastyProcess](https://github.com/dynastyprocess/data) values (1-QB or superflex to match the league), every league pick with its current owner and projected slot, and team summaries (average age, value-weighted age, picks).
- `scripts/analysis.py` writes `docs/data/analysis.json`: each team's HIM score, verdict, and data-backed 'Why you are HIM' / 'Why you are Ass' lines.
- `scripts/analytics_data.py` writes `docs/data/analytics.json` from nflverse (weekly stats, snap counts, PFR advanced) and ffopportunity (expected points), plus `values_history.json`.
- `scripts/startsit.py` writes `docs/data/startsit.json` (Sleeper projections in league scoring, Vegas lines, defense profiles, each team's best lineup with reasons) and `docs/data/splits.json` (play-by-play splits from nflverse pbp, FTN charting and Next Gen Stats).
- `scripts/news.py` writes `docs/data/news.json`: 21 days of ESPN/RotoWire player news for every rostered player.
- `scripts/mock_draft.py` writes `docs/data/mock_draft.json` (picks, board, draft habits, and each team's roster before/after the mock with suggested cuts) and `prospects_history.json`.
- `scripts/highlights.py` writes `docs/data/highlights.json`: YouTube highlight clips for the mock draft's prospects, via the official YouTube Data API. It only runs searches when the repository secret `YOUTUBE_API_KEY` is set (a free key from Google Cloud; about 60 searches a day, well inside the free quota).

All of these run in the daily workflow after the league update and never block it if a source is down.
