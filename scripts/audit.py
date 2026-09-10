#!/usr/bin/env python3
"""Stress the levels: does anything dumb win, and does the real solution survive a wobble?

The replay harness proves each level is winnable by its stored solution. That says
nothing about whether the level is a puzzle. This drives the app through a plan of
trials per level and reports the ones that look trivial (a naive move wins), fragile
(a slightly imprecise version of the solution loses), or broken (nothing wins).

    scripts/audit.py pinPull            singles, ordered pairs, everything in order and reversed
    scripts/audit.py saveDog           solution jittered eight ways plus five dumb strokes
    scripts/audit.py runner             greedy, straight, always-left, and random steering
    scripts/audit.py <mode> --no-build  reuse the last simulator build
    scripts/audit.py <mode> --only 05,07

Writes build/audit/<mode>.json (raw) and prints the verdicts. The plan is generated
here and read by the app from its own container, so adding a trial kind is a Python
change plus one case in AutoplayRunner.configure.
"""
from __future__ import annotations

import itertools
import json
import pathlib
import shutil
import sys
import time

sys.stdout.reconfigure(line_buffering=True)  # progress shows up in background logs

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import replay  # noqa: E402  (the simulator helpers live there)

ROOT = replay.ROOT
LEVELS = ROOT / "ActualGameplay/Levels"


def load_levels(folder: str) -> list[dict]:
    return [json.loads(p.read_text()) for p in sorted((LEVELS / folder).glob("*.json"))]


# --------------------------------------------------------------------------- plans


def pin_trials(levels: list[dict], only: set[str] | None) -> list[dict]:
    trials = []
    for index, level in enumerate(levels):
        if only and level["id"] not in only:
            continue
        ids = [p["id"] for p in level["pins"]]
        seqs: dict[str, list[str]] = {"solution": level["solution"]}
        for pin in ids:
            seqs[f"single:{pin}"] = [pin]
        for a, b in itertools.permutations(ids, 2):
            seqs[f"pair:{a},{b}"] = [a, b]
        if len(ids) > 2:
            # The two orders a player who is not thinking actually uses.
            by_height = sorted(level["pins"], key=lambda p: (-p["y"], p["x"]))
            seqs["all:top-down"] = [p["id"] for p in by_height]
            seqs["all:bottom-up"] = [p["id"] for p in reversed(by_height)]
        seen: set[tuple] = set()
        for name, seq in seqs.items():
            key = tuple(seq)
            if key in seen and name != "solution":
                continue
            seen.add(key)
            trials.append({"id": f"{level['id']}/{name}", "level": index, "pins": seq})
    return trials


def draw_trials(levels: list[dict], only: set[str] | None) -> list[dict]:
    trials = []
    jitters = [(-10, 0), (-5, 0), (5, 0), (10, 0), (0, -10), (0, 10)]
    for index, level in enumerate(levels):
        if only and level["id"] not in only:
            continue
        lid = level["id"]
        trials.append({"id": f"{lid}/solution", "level": index, "transform": {"dx": 0, "dy": 0, "scale": 1}})
        for dx, dy in jitters:
            trials.append({"id": f"{lid}/jitter:{dx:+d},{dy:+d}", "level": index,
                           "transform": {"dx": dx, "dy": dy, "scale": 1}})
        for scale in (0.85, 1.15):
            trials.append({"id": f"{lid}/scale:{scale}", "level": index,
                           "transform": {"dx": 0, "dy": 0, "scale": scale}})
        dogs = level.get("dogs") or []
        if dogs:
            x, y = dogs[0]["x"], dogs[0]["y"]
            top = min(y + 60, 740)
            dumb = {
                "drop": [[x - 20, top], [x + 20, top]],
                "bar": [[x - 90, top], [x + 90, top]],
                "wall-left": [[x - 40, y - 12], [x - 40, y + 70]],
                "wall-right": [[x + 40, y - 12], [x + 40, y + 70]],
                "roof": [[x - 60, y + 40], [x + 60, y + 40]],
            }
            for name, stroke in dumb.items():
                trials.append({"id": f"{lid}/dumb:{name}", "level": index, "strokes": [stroke]})
    return trials


def runner_trials(only: set[str] | None) -> list[dict]:
    trials = []
    for level in range(8):
        lid = f"{level + 1:02d}"
        if only and lid not in only:
            continue
        for policy in ("greedy", "straight", "left", "random"):
            trials.append({"id": f"{lid}/policy:{policy}", "level": level, "policy": policy})
    return trials


# ------------------------------------------------------------------------- verdicts


def pulls(entry: dict) -> int:
    """Pull count a pin-pull win reported, or a large number if it did not win."""
    detail = entry.get("detail", "")
    if entry.get("outcome") == "won" and detail.startswith("pulls "):
        return int(detail.split()[1])
    return 99


def verdicts(mode: str, entries: list[dict], levels: list[dict] | None = None) -> list[str]:
    by_level: dict[str, dict[str, dict]] = {}
    for e in entries:
        lid, name = e["id"].split("/", 1)
        by_level.setdefault(lid, {})[name] = e
    pars = {lvl["id"]: lvl.get("parPins", 1) for lvl in (levels or [])}
    lines = []
    for lid, trials in sorted(by_level.items()):
        won = {n for n, e in trials.items() if e["outcome"] == "won"}
        flags = []
        if mode == "pinPull":
            par = pars.get(lid, 1)
            naive = {n for n in trials if n.startswith(("single:", "all:"))}
            pairs = {n for n in trials if n.startswith("pair:")}
            if "solution" not in won:
                flags.append("BROKEN: stored solution does not win")
            # A naive sequence that wins at par means there was nothing to work out. One that wins
            # over par is caught by the star count, which is the game doing its job.
            at_par = sorted(n for n in naive & won if pulls(trials[n]) <= par)
            over_par = sorted(n for n in naive & won if pulls(trials[n]) > par)
            if at_par:
                flags.append(f"TRIVIAL: naive play wins at par ({', '.join(at_par)})")
            if over_par:
                flags.append(f"loose: naive play wins over par ({', '.join(over_par)})")
            # A pair whose win resolved after its first pull is just the solution with a pull
            # that never happened; only count pairs where both pulls landed.
            pair_at_par = sorted(n for n in pairs & won if pulls(trials[n]) == 2 and 2 <= par)
            if pairs and len(pair_at_par) >= 2 and par <= 2:
                flags.append(f"LOOSE: {len(pair_at_par)}/{len(pairs)} ordered pairs win at par")
            if not won:
                flags.append("UNWINNABLE: nothing tested wins")
        elif mode == "saveDog":
            jit = {n for n in trials if n.startswith(("jitter:", "scale:"))}
            dumb = {n for n in trials if n.startswith("dumb:")}
            if "solution" not in won:
                flags.append("BROKEN: stored solution does not win")
            if jit:
                share = len(jit & won) / len(jit)
                if share < 0.5:
                    flags.append(f"FRAGILE: only {len(jit & won)}/{len(jit)} perturbed solutions win")
            if dumb & won:
                flags.append(f"TRIVIAL: dumb stroke wins ({', '.join(sorted(n[5:] for n in dumb & won))})")
        elif mode == "runner":
            if "policy:greedy" not in won:
                flags.append("BROKEN: greedy autopilot loses")
            lazy = {n for n in ("policy:straight", "policy:left", "policy:random") if n in won}
            if len(lazy) >= 2:
                flags.append(f"TRIVIAL: lazy steering wins ({', '.join(sorted(lazy))})")
        status = "ok" if not flags else "; ".join(flags)
        detail = " ".join(f"{n}={'W' if e['outcome'] == 'won' else 'x'}" for n, e in sorted(trials.items()))
        lines.append(f"{lid}  {status}\n      {detail}")
    return lines


# ----------------------------------------------------------------------------- main


def main() -> None:
    args = sys.argv[1:]
    positional = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] != "--only")]
    mode = positional[0] if positional else "pinPull"
    only = set(args[args.index("--only") + 1].split(",")) if "--only" in args else None
    if mode == "pinPull":
        trials = pin_trials(load_levels("pinpull"), only)
    elif mode == "saveDog":
        trials = draw_trials(load_levels("savedog"), only)
    elif mode == "runner":
        trials = runner_trials(only)
    else:
        raise SystemExit(f"unknown mode {mode}")

    udid = replay.sim_udid()
    replay.run(["xcrun", "simctl", "boot", udid])
    if "--no-build" not in args:
        replay.build(udid)
    container = replay.install(udid)
    replay.wait_for_boot(udid)
    support = container / "Library/Application Support/ActualGameplay"
    support.mkdir(parents=True, exist_ok=True)
    (support / "audit-plan.json").write_text(json.dumps({"mode": mode, "trials": trials}))
    results_dir = support / "replay"
    results_file = results_dir / f"audit-{mode}.json"
    if results_file.exists():
        results_file.unlink()
    replay.run(["xcrun", "simctl", "terminate", udid, replay.BUNDLE])
    result = replay.run(["xcrun", "simctl", "launch", udid, replay.BUNDLE, "--audit", mode, "--silent"])
    if result.returncode:
        raise SystemExit(result.stderr)

    print(f"{len(trials)} trials queued for {mode}")
    deadline = time.time() + 60 * 60
    while time.time() < deadline and not results_file.exists():
        time.sleep(2)
    replay.run(["xcrun", "simctl", "terminate", udid, replay.BUNDLE])
    if not results_file.exists():
        raise SystemExit("no results file: the audit did not finish in time")

    entries = json.loads(results_file.read_text())
    out_dir = ROOT / "build/audit"
    out_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(results_file, out_dir / f"{mode}.json")
    for png in results_dir.glob(f"{mode}-*.png"):
        shutil.copy(png, out_dir / png.name)
    levels = load_levels("pinpull") if mode == "pinPull" else None
    lines = verdicts(mode, entries, levels)
    print()
    for line in lines:
        print(line)
    flagged = sum(1 for line in lines if not line.split("  ", 1)[1].startswith(("ok", "loose")))
    print(f"\n{flagged} level(s) flagged; raw results in build/audit/{mode}.json")


if __name__ == "__main__":
    main()
