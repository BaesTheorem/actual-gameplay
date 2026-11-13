// Play every level's stored solution with no browser and report pass or fail.
// The regression suite: after a change to physics or a level file it must pass in full.
//   npm run replay -- pinPull | saveDog | runner | tower
import { replay as pinPull } from "./pin-suite";
import { replay as runner } from "./runner-suite";
import { replay as saveDog } from "./savedog-suite";
import { replay as tower } from "./tower-suite";

const SUITES: Record<string, () => { passed: number; total: number }> = { pinPull, saveDog, runner, tower };

const mode = process.argv[2] ?? "pinPull";
const suite = SUITES[mode];
if (!suite) {
  console.error(`no replay for "${mode}": one of ${Object.keys(SUITES).join(", ")}`);
  process.exit(1);
}
const { passed, total } = suite();
console.log(`${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
