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
    scripts/audit.py saveDog --random 20     add twenty plausible random strokes per level; prints the share that win
    scripts/audit.py pinPull --exhaustive   every pull sequence up to par, pruned at deaths; UNIQUE or the other winners

Writes build/audit/<mode>.json (raw) and prints the verdicts. The plan is generated
here and read by the app from its own container, so adding a trial kind is a Python
change plus one case in AutoplayRunner.configure.
"""
from __future__ import annotations

import itertools
import json
import math
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
        for k, stroke in enumerate(random_strokes(level, RANDOM_N)):
            trials.append({"id": f"{lid}/random:{k:02d}", "level": index, "strokes": [stroke]})
    return trials


RANDOM_N = 0   # set by --random N: that many plausible random strokes per level, for a difficulty number


def random_strokes(level: dict, n: int, seed: int = 7) -> list[list[list[float]]]:
    """Plausible strokes a player might try: lines and arcs near him, within the ink budget.

    The point is a difficulty number, not a solver. A level where a quarter of these win is easy;
    one where none do is a puzzle that needs the idea, not a lucky scribble.
    """
    import random
    rng = random.Random(seed * 1000 + int(level["id"]))
    dogs = level.get("dogs") or []
    if not dogs:
        return []
    x, y = dogs[0]["x"], dogs[0]["y"]
    budget = level.get("inkBudget", 200)
    out = []
    for _ in range(n):
        kind = rng.choice(("bar", "bar", "arc", "arc", "arc", "wall", "l", "tent"))
        length = rng.uniform(0.45, 0.95) * budget
        cx = x + rng.uniform(-40, 40)
        top = min(y + rng.uniform(25, 90), 760)
        if kind == "bar":
            pts = [[cx - length / 2, top], [cx + length / 2, top]]
        elif kind == "arc":
            r = min(length / math.pi, 140)
            lift = rng.uniform(0, 30)
            pts = [[cx + r * math.cos(a), y - 10 + lift + r * math.sin(a)] for a in [math.pi * i / 10 for i in range(11)]]
        elif kind == "wall":
            side = rng.choice((-1, 1))
            pts = [[cx + side * rng.uniform(28, 60), y - 14], [cx + side * rng.uniform(28, 60), y - 14 + min(length, 140)]]
        elif kind == "l":
            side = rng.choice((-1, 1))
            h = min(length * 0.45, 120)
            pts = [[cx - side * length * 0.35, top], [cx + side * 30, top], [cx + side * 30, top - h]]
        else:
            half = min(length / 2.3, 120)
            pts = [[cx - half, y - 12], [cx, y - 12 + half * 0.9], [cx + half, y - 12]]
        pts = [[round(min(max(px, 8), 394), 1), round(min(max(py, 40), 800), 1)] for px, py in pts]
        out.append(pts)
    return out


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
            rnd = {n for n in trials if n.startswith("random:")}
            if rnd:
                share = len(rnd & won) / len(rnd)
                flags.append(f"random strokes win {len(rnd & won)}/{len(rnd)}" + (" EASY" if share >= 0.25 else ""))
        elif mode == "runner":
            if "policy:greedy" not in won:
                flags.append("BROKEN: greedy autopilot loses")
            lazy = {n for n in ("policy:straight", "policy:left", "policy:random") if n in won}
            if len(lazy) >= 2:
                flags.append(f"TRIVIAL: lazy steering wins ({', '.join(sorted(lazy))})")
        status = "ok" if not [f for f in flags if not f.startswith("random strokes")] else "; ".join(flags)
        if flags and status == "ok": status = "ok; " + "; ".join(flags)
        detail = " ".join(f"{n}={'W' if e['outcome'] == 'won' else 'x'}" for n, e in sorted(trials.items()))
        lines.append(f"{lid}  {status}\n      {detail}")
    return lines



_SIM_READY = {"udid": None}


def run_plan(mode: str, trials: list[dict], build: bool = True) -> list[dict]:
    """Install (and optionally build) the app, hand it a plan, and wait for its results."""
    udid = _SIM_READY["udid"] or replay.sim_udid()
    if _SIM_READY["udid"] is None:
        replay.run(["xcrun", "simctl", "boot", udid])
        if build:
            replay.build(udid)
        _SIM_READY["container"] = replay.install(udid)
        replay.wait_for_boot(udid)
        _SIM_READY["udid"] = udid
    container = _SIM_READY["container"]
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
    deadline = time.time() + 4 * 60 * 60
    while time.time() < deadline and not results_file.exists():
        time.sleep(2)
    replay.run(["xcrun", "simctl", "terminate", udid, replay.BUNDLE])
    if not results_file.exists():
        raise SystemExit("no results file: the audit did not finish in time")
    out_dir = ROOT / "build/audit"
    out_dir.mkdir(parents=True, exist_ok=True)
    for png in results_dir.glob(f"{mode}-*.png"):
        shutil.copy(png, out_dir / png.name)
    return json.loads(results_file.read_text())


STALL = "Settled short of the goal."


def exhaustive_pins(levels: list[dict], only: set[str] | None) -> tuple[list[dict], list[str]]:
    """Search pull sequences up to par, extending only sequences that neither won nor died.

    A sequence that stalled (everything settled, nothing won) can still be extended; one that
    ended in a death, a melt, or a drain cannot, and one that won needs no more pulls. Each
    round is one launch of the app. Returns every entry seen plus the verdict lines.
    """
    chosen = [l for l in levels if not only or l["id"] in only]
    frontier: dict[str, list[list[str]]] = {l["id"]: [[]] for l in chosen}
    seen: list[dict] = []
    winners: dict[str, list[list[str]]] = {l["id"]: [] for l in chosen}
    max_par = max(l.get("parPins", 1) for l in chosen)
    for k in range(1, max_par + 1):
        trials = []
        for level in chosen:
            if k > level.get("parPins", 1):
                continue
            ids = [p["id"] for p in level["pins"]]
            for prefix in frontier[level["id"]]:
                for pin in ids:
                    if pin in prefix:
                        continue
                    seq = prefix + [pin]
                    trials.append({"id": f"{level['id']}/seq:{','.join(seq)}", "level": levels.index(level), "pins": seq})
        if not trials:
            break
        print(f"round {k}: {len(trials)} sequences")
        entries = run_plan("pinPull", trials, build=False)
        seen.extend(entries)
        by_level: dict[str, list[list[str]]] = {l["id"]: [] for l in chosen}
        for e in entries:
            lid, name = e["id"].split("/", 1)
            seq = name.split(":", 1)[1].split(",")
            if e["outcome"] == "won":
                winners[lid].append(seq)
            elif e["outcome"] in ("lost", "timeout") and e.get("detail") == STALL:
                by_level[lid].append(seq)
            elif e["outcome"] == "timeout":
                by_level[lid].append(seq)   # never settled; treat as still open
        frontier = by_level
    lines = []
    for level in chosen:
        lid = level["id"]
        sol = level.get("solution") or []
        wins = winners[lid]
        if not wins:
            verdict = "UNWINNABLE within par"
        elif len(wins) == 1 and wins[0] == sol:
            verdict = "UNIQUE"
        elif sol in wins:
            others = ["+".join(w) for w in wins if w != sol]
            verdict = f"NOT UNIQUE: also {', '.join(others)}"
        else:
            verdict = f"BROKEN: solution does not win; winners {['+'.join(w) for w in wins]}"
        lines.append(f"{lid}  {level['name']:<16} par {level.get('parPins', 1)}  {verdict}")
    return seen, lines


# ----------------------------------------------------------------------------- main


def main() -> None:
    args = sys.argv[1:]
    positional = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] not in ("--only", "--random"))]
    mode = positional[0] if positional else "pinPull"
    only = set(args[args.index("--only") + 1].split(",")) if "--only" in args else None
    global RANDOM_N
    if "--random" in args:
        RANDOM_N = int(args[args.index("--random") + 1])
    if mode == "pinPull" and "--exhaustive" in args:
        levels = load_levels("pinpull")
        _SIM_READY["udid"] = None
        if "--no-build" not in args:
            udid = replay.sim_udid()
            replay.run(["xcrun", "simctl", "boot", udid])
            replay.build(udid)
        entries, lines = exhaustive_pins(levels, only)
        (ROOT / "build/audit").mkdir(parents=True, exist_ok=True)
        (ROOT / "build/audit/pinPull-exhaustive.json").write_text(json.dumps(entries, indent=2))
        print()
        for line in lines:
            print(line)
        flagged = sum(1 for line in lines if not line.rstrip().endswith("  UNIQUE"))
        print(f"\n{flagged} level(s) flagged; raw results in build/audit/pinPull-exhaustive.json")
        return
    if mode == "pinPull":
        trials = pin_trials(load_levels("pinpull"), only)
    elif mode == "saveDog":
        trials = draw_trials(load_levels("savedog"), only)
    elif mode == "runner":
        trials = runner_trials(only)
    else:
        raise SystemExit(f"unknown mode {mode}")

    entries = run_plan(mode, trials, build="--no-build" not in args)
    out_dir = ROOT / "build/audit"
    (out_dir / f"{mode}.json").write_text(json.dumps(entries, indent=2))
    levels = load_levels("pinpull") if mode == "pinPull" else None
    lines = verdicts(mode, entries, levels)
    print()
    for line in lines:
        print(line)
    flagged = sum(1 for line in lines if not line.split("  ", 1)[1].startswith(("ok", "loose")))
    print(f"\n{flagged} level(s) flagged; raw results in build/audit/{mode}.json")


if __name__ == "__main__":
    main()
