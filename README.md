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

Branding lives in `docs/assets/` (`logo.svg`, `brand.css`). Charts use Chart.js 4.4.1, included in `docs/assets/vendor/`.

## Daily update

`.github/workflows/daily-update.yml` runs every day at **4:00 AM Central**. GitHub cron only runs in UTC, so the workflow is scheduled at both 09:00 and 10:00 UTC and only the one that is 4 AM in Chicago (based on daylight saving) does the work.

`scripts/update_league.py` (Python standard library only) pulls the league from Sleeper and writes `docs/data/latest.json` plus a dated copy in `docs/data/history/`. It records:

- **Standings:** record, PF, PA, max PF, projected wins, playoff and title odds
- **Playoff bracket:** current seeds with projected game odds; real results replace projections as games finish
- **Draft order:** non-playoff teams first by lowest max PF, then playoff teams by elimination round (lowest max PF first within a round), champion last
- **History:** for every completed week, the standings as of that week and the playoff odds and projected draft pick from re-simulating the rest of the season from that point

Weekly max PF is computed from each team's best possible lineup and scaled to match Sleeper's season total. `diagnostics.max_pf_check` in `latest.json` shows the raw comparison.

## Running locally

```bash
python3 scripts/update_league.py
python3 -m http.server --directory docs 8000
```

Then open http://localhost:8000.

Environment overrides: `SLEEPER_LEAGUE_ID`, `SIMULATIONS` (current week, default 10000), `HISTORY_SIMULATIONS` (past weeks, default 4000).
