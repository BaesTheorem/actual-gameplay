#!/usr/bin/env python3
"""Replay every level's stored solution on the simulator and report pass/fail.

Builds the Debug app for the simulator, installs it, launches it with
`--autoplay <mode>`, waits for the results file the app writes into its own
container, prints a table, and copies the per-level snapshots to build/replay/.
Exits nonzero if any level did not end in a win.

    scripts/replay.py drawLine             build, install, run
    scripts/replay.py drawLine --no-build  reuse the last simulator build
    scripts/replay.py drawLine --only 04,07   just those level ids
"""
from __future__ import annotations

import json
import os
import pathlib
import shutil
import subprocess
import sys
import time

sys.stdout.reconfigure(line_buffering=True)  # progress shows up in background logs

ROOT = pathlib.Path(__file__).resolve().parent.parent
BUNDLE = "com.baestheorem.actualgameplay"
SIM_NAME = os.environ.get("SIM_NAME", "iPhone 17 Pro")
ENV = {**os.environ, "DEVELOPER_DIR": os.environ.get("DEVELOPER_DIR", "/Applications/Xcode.app/Contents/Developer")}


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, env=ENV, text=True, capture_output=True)


def sim_udid() -> str:
    data = json.loads(run(["xcrun", "simctl", "list", "devices", "available", "-j"]).stdout)
    for devices in data["devices"].values():
        for device in devices:
            if device["name"] == SIM_NAME:
                return device["udid"]
    raise SystemExit(f"no simulator named {SIM_NAME!r}")


def build(udid: str) -> None:
    run(["xcodegen", "generate"])
    result = run([
        "xcodebuild", "-project", "ActualGameplay.xcodeproj", "-scheme", "ActualGameplay",
        "-destination", f"platform=iOS Simulator,id={udid}", "-derivedDataPath", "build/dd",
        "-configuration", "Debug", "CODE_SIGNING_ALLOWED=NO", "build",
    ])
    log = result.stdout + result.stderr
    (ROOT / "build/last-sim-build.log").write_text(log)
    if result.returncode != 0:
        print("\n".join(line for line in log.splitlines() if "error:" in line)[:4000])
        raise SystemExit("simulator build failed")


def wait_for_boot(udid: str) -> None:
    """Block until the device has finished booting, then warm it up with one launch.

    A cold simulator answers `simctl launch` while SpringBoard is still settling, and
    the first scene presented into that gets a starved run loop: timers fire tens of
    seconds late and the display link barely ticks. One measured run was lost to it.
    """
    run(["xcrun", "simctl", "bootstatus", udid, "-b"])
    run(["xcrun", "simctl", "launch", udid, BUNDLE, "--silent"])
    time.sleep(3)
    run(["xcrun", "simctl", "terminate", udid, BUNDLE])


def install(udid: str) -> pathlib.Path:
    """Install the last simulator build and return the app's data container."""
    app = ROOT / "build/dd/Build/Products/Debug-iphonesimulator/ActualGameplay.app"
    result = run(["xcrun", "simctl", "install", udid, str(app)])
    if result.returncode:
        raise SystemExit(result.stderr)
    return pathlib.Path(run(["xcrun", "simctl", "get_app_container", udid, BUNDLE, "data"]).stdout.strip())


def main() -> None:
    args = sys.argv[1:]
    positional = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] != "--only")]
    mode = positional[0] if positional else "drawLine"
    os.chdir(ROOT)
    (ROOT / "build").mkdir(exist_ok=True)
    udid = sim_udid()
    run(["xcrun", "simctl", "boot", udid])
    if "--no-build" not in args:
        build(udid)
    container = install(udid)
    wait_for_boot(udid)
    results_dir = container / "Library/Application Support/ActualGameplay/replay"
    results_file = results_dir / f"{mode}.json"
    if results_dir.exists():
        shutil.rmtree(results_dir)
    run(["xcrun", "simctl", "terminate", udid, BUNDLE])
    launch = ["xcrun", "simctl", "launch", udid, BUNDLE, "--autoplay", mode, "--silent"]
    if "--only" in args:
        launch += ["--only", args[args.index("--only") + 1]]
    result = run(launch)
    if result.returncode:
        raise SystemExit(result.stderr)

    deadline = time.time() + 300
    while time.time() < deadline and not results_file.exists():
        time.sleep(1)
    run(["xcrun", "simctl", "terminate", udid, BUNDLE])
    if not results_file.exists():
        raise SystemExit("no results file: the app did not finish autoplay in time")

    entries = json.loads(results_file.read_text())
    out_dir = ROOT / "build/replay"
    out_dir.mkdir(parents=True, exist_ok=True)
    for png in results_dir.glob("*.png"):
        shutil.copy(png, out_dir / png.name)
    failed = 0
    print(f"{'id':>3}  {'name':<16} {'outcome':<8} {'time':>6}  stars  detail")
    for entry in entries:
        ok = entry["outcome"] == "won"
        failed += 0 if ok else 1
        print(f"{entry['id']:>3}  {entry['name']:<16} {entry['outcome']:<8} {entry['seconds']:>5.1f}s  {entry['stars']:^5}  {entry['detail']}")
    print(f"\n{len(entries) - failed}/{len(entries)} passed; snapshots in build/replay/")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
