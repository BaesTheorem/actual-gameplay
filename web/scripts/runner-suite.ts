// Crowd Run's replay and audit with no browser. Nothing runs when this file is imported.
import { RunnerGenerator, RunnerSim, playRun, type SteerPolicy } from "../src/sim/runner";

/// Play the first runs at base upgrades with the greedy autopilot, one PASS or FAIL line each.
export const replay = (): { passed: number; total: number } => {
  let passed = 0, total = 0;
  for (let level = 0; level < RunnerGenerator.replayLevels; level++) {
    total += 1;
    const t0 = performance.now();
    const run = playRun(level, "greedy");
    const ok = run.outcome?.won === true;
    if (ok) passed += 1;
    const detail = run.outcome === null ? "no result"
      : run.outcome.won ? `${run.outcome.stars} stars, ${RunnerSim.describe(run.outcome.score)}`
      : run.outcome.reason;
    console.log(`${ok ? "PASS" : "FAIL"}  ${run.sim.levelID} ${run.sim.levelName.padEnd(22)} ${detail}  (${run.seconds.toFixed(1)} s game, ${(performance.now() - t0).toFixed(0)} ms)`);
  }
  return { passed, total };
};

const AUDIT_LEVELS = 8;
const POLICIES: SteerPolicy[] = ["greedy", "straight", "left", "random"];
const LAZY: SteerPolicy[] = ["straight", "left", "random"];

/// Compare greedy steering against never steering, always-left, and random on the first eight
/// runs. A run is flagged when greedy loses or when two of the lazy policies win. Returns the
/// number of flagged runs.
export const audit = (): number => {
  let flagged = 0;
  for (let level = 0; level < AUDIT_LEVELS; level++) {
    const won = new Set<SteerPolicy>();
    for (const policy of POLICIES) {
      if (playRun(level, policy).outcome?.won === true) won.add(policy);
    }
    const flags: string[] = [];
    if (!won.has("greedy")) flags.push("BROKEN: greedy autopilot loses");
    const lazy = LAZY.filter((p) => won.has(p)).map((p) => `policy:${p}`).sort();
    if (lazy.length >= 2) flags.push(`TRIVIAL: lazy steering wins (${lazy.join(", ")})`);
    if (flags.length > 0) flagged += 1;
    const status = flags.length === 0 ? "ok" : flags.join("; ");
    const detail = [...POLICIES].sort().map((p) => `policy:${p}=${won.has(p) ? "W" : "x"}`).join(" ");
    console.log(`${String(level + 1).padStart(2, "0")}  ${status}\n      ${detail}`);
  }
  return flagged;
};
