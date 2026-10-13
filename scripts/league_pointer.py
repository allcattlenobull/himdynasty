"""Which Sleeper league is "current".

Sleeper gives a renewed league a new id every season. scripts/rollover.py
follows the renewal and records it in docs/data/league_ids.json; every other
script asks this module for the id. SLEEPER_LEAGUE_ID overrides both.
"""

import json
import os
from pathlib import Path

POINTER = Path(__file__).resolve().parent.parent / "docs" / "data" / "league_ids.json"
FIRST_LEAGUE = "1312005038838673409"  # 2026, the season the site was built


def current_league_id():
    env = os.environ.get("SLEEPER_LEAGUE_ID")
    if env:
        return env
    try:
        return json.loads(POINTER.read_text())["current"]
    except (FileNotFoundError, KeyError, ValueError):
        return FIRST_LEAGUE
