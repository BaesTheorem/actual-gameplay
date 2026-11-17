// Crowd Run's replay and audit with no browser. Nothing runs when this file is imported.
import {
  LAZY, RunnerEconomy, RunnerGenerator, RunnerSim, Skilled, isFair, lazyPilot, playTrack, type LazyName,
} from "../src/sim/runner";

/// Play the first runs with the skilled bot at the upgrades the fairness check assumes, one
/// PASS or FAIL line each.
export const replay = (): { passed: number; total: number } => {
  let passed = 0, total = 0;
  for (let level = 0; level < RunnerGenerator.replayLevels; level++) {
    total += 1;
    const t0 = performance.now();
    const track = RunnerGenerator.makeTrack(level);
    const run = playTrack(track, RunnerEconomy.reference(level), new Skilled(track));
    const ok = run.outcome?.won === true;
    if (ok) passed += 1;
    const detail = run.outcome === null ? "no result"
      : run.outcome.won ? `${run.outcome.stars} stars, ${RunnerSim.describe(run.outcome.score)}`
      : run.outcome.reason;
    console.log(`${ok ? "PASS" : "FAIL"}  ${run.levelID} ${run.levelName.padEnd(22)} ${detail}  (${run.elapsed.toFixed(1)} s game, ${(performance.now() - t0).toFixed(0)} ms)`);
  }
  return { passed, total };
};

const AUDIT_LEVELS = 20;

/// Play the three lazy bots and the skilled one on the first twenty runs, at the upgrades the
/// fairness check assumes. A run is flagged when a lazy bot wins it or the skilled bot loses
/// it. Returns the number of flagged runs.
export const audit = (): number => {
  let flagged = 0;
  for (let level = 0; level < AUDIT_LEVELS; level++) {
    const track = RunnerGenerator.makeTrack(level), reference = RunnerEconomy.reference(level);
    const skilled = playTrack(track, reference, new Skilled(track)).outcome?.won === true;
    const won = new Set<LazyName>(LAZY.filter((name) => playTrack(track, reference, lazyPilot(name, track)).outcome?.won === true));
    const flags: string[] = [];
    if (!skilled) flags.push("BROKEN: the skilled bot loses");
    if (won.size > 0) flags.push(`TRIVIAL: lazy steering wins (${[...won].join(", ")})`);
    if (flags.length > 0) flagged += 1;
    const status = flags.length === 0 ? "ok" : flags.join("; ");
    const detail = `skilled=${skilled ? "W" : "x"} ${LAZY.map((name) => `${name}=${won.has(name) ? "W" : "x"}`).join(" ")}`;
    console.log(`${String(level + 1).padStart(2, "0")}  ${status}${isFair(track) ? "" : "  (the generator's fallback)"}  seed ${track.attempt}\n      ${detail}`);
  }
  return flagged;
};
