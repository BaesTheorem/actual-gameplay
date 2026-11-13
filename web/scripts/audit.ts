// Stress the levels with no browser.
//   npm run audit -- pinPull     every pull sequence up to par, pruned at wins and deaths;
//                                each level is UNIQUE or the other winning orders are listed
//   npm run audit -- runner      greedy steering against never steering, always left, and random
//   npm run audit -- saveDog [--random N]   the solution shifted and scaled, naive strokes, N random strokes
// The two level modes run their simulations in a pool of processes and print in play order.
// "--jobs N" sets how many processes, 2 at most and by default.
import { folderOf } from "../src/app/modetable";
import type { PinLevel } from "../src/sim/pinpull";
import { load } from "./levels";
import { Pool, inOrder, moduleURL } from "./parallel";
import { auditLevel as auditPins, type End } from "./pin-suite";

interface Verdict { line: string; flagged: boolean }

/// Print each level's line as it comes in, in play order, and count the flagged ones.
const report = async (verdicts: Promise<Verdict>[]): Promise<number> =>
  (await inOrder(verdicts, (verdict) => console.log(verdict.line))).filter((verdict) => verdict.flagged).length;

const mode = process.argv[2] ?? "pinPull";
let flagged = 0;
if (mode === "pinPull") {
  const pool = new Pool(), suite = moduleURL("./pin-suite.ts", import.meta.url);
  const play = (level: PinLevel, pins: string[]) => pool.run<End>({ module: suite, name: "play", args: [level.id, pins] });
  flagged = await report(load<PinLevel>(folderOf("pinPull")).map((level) => auditPins(level, play)));
  pool.close();
}
if (mode === "runner") flagged = (await import("./runner-suite")).audit();
if (mode === "saveDog") {
  const at = process.argv.indexOf("--random"), random = at > 0 ? Number(process.argv[at + 1]) : 0;
  const pool = new Pool(), suite = moduleURL("./savedog-suite.ts", import.meta.url);
  flagged = await report(load<{ id: string }>(folderOf("saveDog"))
    .map((level) => pool.run<Verdict>({ module: suite, name: "auditLevel", args: [level.id, random] })));
  pool.close();
}
console.log(`\n${flagged} level(s) flagged`);
process.exit(flagged === 0 ? 0 : 1);
