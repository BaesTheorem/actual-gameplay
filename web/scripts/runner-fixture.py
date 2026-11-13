#!/usr/bin/env python3
"""Write web/tests/fixtures/runner-tracks.json: Crowd Run tracks for runs 0 to 60, built by the
generator in scripts/economy.py. The web build's generator is tested against this file.

    python3 web/scripts/runner-fixture.py
"""
import json
import pathlib
import sys

WEB = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(WEB.parent / "scripts"))

import economy  # noqa: E402

LEVELS = range(0, 61)
UPGRADED = 45   # the largest starting crowd the shop sells


def row(level: int) -> dict:
    track = economy.make_track(level, economy.BASE_CROWD)
    return {
        "level": track.level,
        "seed": str(economy.seed_for(level)),
        "segments": track.segments,
        "boss": track.boss,
        "strength": track.strength,
        "finaleZ": track.finale_z,
        "speed": track.speed,
        "best": track.best,
        "bestUpgraded": economy.make_track(level, UPGRADED).best,
    }


def rng_row(seed: int) -> dict:
    rng = economy.SplitMix64(seed)
    raw = [str(rng.next()) for _ in range(4)]
    return {"seed": str(seed), "next": raw, "unit": [rng.unit() for _ in range(4)],
            "int": [rng.int_in(3, 30) for _ in range(8)]}


out = {
    "baseCrowd": economy.BASE_CROWD,
    "upgradedCrowd": UPGRADED,
    "rng": [rng_row(seed) for seed in (0, 7, 1_000_003, (1 << 64) - 1)],
    "tracks": [row(level) for level in LEVELS],
}
path = WEB / "tests/fixtures/runner-tracks.json"
path.write_text(json.dumps(out, separators=(",", ":")) + "\n")
print(f"{path.relative_to(WEB.parent)}: {len(out['tracks'])} tracks")
