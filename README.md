# HIM Dynasty

**Are you HIM?**

Site for the HIM Dynasty Sleeper league (ID `1312005038838673409`), live at
https://allcattlenobull.github.io/himdynasty/

## Pages

| Page | What it is |
| --- | --- |
| `docs/index.html` | The gate: "Are you HIM?" Yes goes to the league, No goes to the butts. Keys Y and N work too. |
| `docs/league.html` | Standings, playoff picture, and draft order, each with a week-by-week chart. Click any team to follow it everywhere. |
| `docs/no.html` | 100 cartoon animal butts for anyone who is not HIM. |
| `docs/draft.html` | Automatic rookie mock draft and big board (expert boards + college game logs + traded picks + roster needs). |
| `docs/trade.html` | Trade center: calculator, team-to-team builder, and trade idea generator, all adjusted for this league's lineup and each team's window. |
| `docs/buzz.html` | News and live social for the league, a team (`?team=N`), or a player (`?player=ID`): nightly ESPN/RotoWire news, live ESPN news for one player, live Bluesky posts, embedded X insider timelines, live-on-X search, Sleeper trending. |
| `docs/team.html?id=N` | One team: stats, roster (starters, bench, taxi, IR), full schedule with results and win odds, season trend. |

Branding lives in `docs/assets/` (`logo.svg`, `brand.css`). Every page has an Auto / Light / Dark theme switch (`theme.js`); Auto follows the device setting. Charts use Chart.js 4.4.1, included in `docs/assets/vendor/`.

## Daily update

`.github/workflows/daily-update.yml` runs every day at **4:00 AM Central**. GitHub cron only runs in UTC, so the workflow is scheduled at both 09:00 and 10:00 UTC and only the one that is 4 AM in Chicago (based on daylight saving) does the work.

`scripts/update_league.py` (Python standard library only) pulls the league from Sleeper and writes `docs/data/latest.json` plus a dated copy in `docs/data/history/`. It records:

- **Standings:** record, PF, PA, max PF, projected wins, playoff and title odds
- **Playoff bracket:** current seeds with projected game odds; real results replace projections as games finish
- **Draft order (if the season ended today):** picks 1–6 are current non-playoff teams by lowest max PF; picks 7–12 are current playoff teams in the order the projected bracket eliminates them, lowest max PF first within a round, champion last
- **History:** for every completed week, the standings as of that week and the playoff odds and projected draft pick from re-simulating the rest of the season from that point

Weekly max PF is computed from each team's best possible lineup and scaled to match Sleeper's season total. `diagnostics.max_pf_check` in `latest.json` shows the raw comparison.

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
- `scripts/news.py` writes `docs/data/news.json`: 21 days of ESPN/RotoWire player news for every rostered player.
- `scripts/mock_draft.py` writes `docs/data/mock_draft.json` and `prospects_history.json`.

All of these run in the daily workflow after the league update and never block it if a source is down.
