// Play every level's stored solution with no browser and report pass or fail.
// The regression suite: after a change to physics or a level file it must pass in full.
//   npm run replay -- pinPull | saveDog | runner
import { playOut, type PinLevel } from "../src/sim/pinpull";
import { load } from "./levels";

const mode = process.argv[2] ?? "pinPull";
let passed = 0, total = 0;
if (mode === "pinPull") {
  for (const level of load<PinLevel>("pinpull")) {
    total += 1;
    const t0 = performance.now();
    const run = playOut(level, level.solution ?? []);
    const ok = run.outcome?.won === true;
    if (ok) passed += 1;
    const detail = run.outcome === null ? "no result" : run.outcome.won ? `${run.outcome.stars} stars` : run.outcome.reason;
    console.log(`${ok ? "PASS" : "FAIL"}  ${level.id} ${level.name.padEnd(22)} ${detail}  (${run.seconds.toFixed(1)} s game, ${(performance.now() - t0).toFixed(0)} ms)`);
  }
}
if (mode === "runner") ({ passed, total } = (await import("./runner-suite")).replay());
if (mode === "saveDog") ({ passed, total } = (await import("./savedog-suite")).replay());
console.log(`${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
