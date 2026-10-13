# HIM Dynasty

**Are you HIM?**

A small site for the HIM Dynasty Sleeper league (ID `1312005038838673409`). Every morning a GitHub Action pulls the league from Sleeper and records:

- **Standings** (record, points for and against)
- **Draft order** (official order when set, plus a projected order for the next draft)
- **Playoff odds** (10,000 Monte Carlo simulations of the rest of the regular season)

## How it works

| Piece | Path |
| --- | --- |
| Data pull and calculations | `scripts/update_league.py` (standard library only) |
| Daily schedule (3:00 AM Eastern) | `.github/workflows/daily-update.yml` |
| Website | `docs/index.html` |
| Latest snapshot | `docs/data/latest.json` |
| Daily history | `docs/data/history/YYYY-MM-DD.json` |

The schedule is set in UTC. `08:00 UTC` is 3:00 AM Eastern standard time, or 4:00 AM during daylight saving time. Change the `cron` line to adjust it.

## Setup

1. **Enable GitHub Pages:** Settings → Pages → Build and deployment → Source: *Deploy from a branch*, Branch: `main`, Folder: `/docs`.
2. **Run it once:** Actions → *Daily HIM Dynasty update* → *Run workflow*. This creates the first snapshot.
3. The site will be at `https://allcattlenobull.github.io/himdynasty/`.

## Running locally

```bash
python3 scripts/update_league.py
python3 -m http.server --directory docs 8000
```

Then open http://localhost:8000.

## Notes

- Playoff odds model each team's remaining weekly scores as a normal distribution based on its own scoring history. Treat the numbers as estimates.
- Override the league with the `SLEEPER_LEAGUE_ID` environment variable, or change the number of simulations with `SIMULATIONS`.
