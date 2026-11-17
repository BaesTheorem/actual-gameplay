// A steering plan for one Crowd Run, for the screenshot tool to follow with a real drag.
//   npx tsx scripts/runner-plan.ts <run> [skilled | straight | left | random]
// It plays the run with a bot at the upgrades the fairness check assumes and writes
// build/webtest/plan-<run>.json: where the crowd heads at each point of the run's progress,
// the moments worth a picture, and the save that puts the game at that run with those
// upgrades. "shots.py follow=plan-<run>.json" then holds a finger down and steers by the
// progress bar, so the run it plays in the browser is the bot's run, at whatever speed the
// browser manages.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GateOp, RunnerEconomy, RunnerGenerator, RunnerSim, Skilled, lazyPilot, type LazyName } from "../src/sim/runner";

const run = Number(process.argv[2] ?? 1), who = process.argv[3] ?? "skilled", level = run - 1;
const track = RunnerGenerator.makeTrack(level), economy = RunnerEconomy.reference(level);
const marks: [number, string][] = [], seen = new Set<string>();
const mark = (name: string, later = 0) => {
  if (seen.has(name)) return;
  seen.add(name);
  marks.push([sim.travel / track.finaleZ + later, name]);
};
/// The picture each cue is worth, and how much further on to take it, as a share of the run.
const CUES: Record<string, [string, number]> = {
  crateCrack: ["crate-shot", 0], crateAllies: ["crate-break", 0.002], crateTimes: ["crate-break", 0.002], crateRate: ["crate-break", 0.002],
  crateCoins: ["crate-coins", 0.002], blast: ["blast", 0.002], squadTrade: ["squad-trade", 0.002], hammer: ["hammer-lands", 0.001],
  bridgeFall: ["bridge-fall", 0.002], slamWarn: ["slam-warned", 0.004], slam: ["slam-lands", 0.001], finale: ["fight", 0.001], gateRate: ["rate-taken", 0.002],
};
const sim: RunnerSim = new RunnerSim(track, economy, (cue) => {
  if (cue.type === "fx" && CUES[cue.name]) mark(CUES[cue.name]![0], CUES[cue.name]![1]);
});
sim.fly(who === "skilled" ? new Skilled(track) : lazyPilot(who as LazyName, track));
const points: [number, number][] = [];
let last = NaN;
mark("start", 0.004);
for (let i = 0; i < 60 * 60 && !sim.finished; i++) {
  sim.frame();
  if (sim.targetX !== last) { points.push([sim.travel / track.finaleZ, sim.targetX]); last = sim.targetX; }
  for (const item of sim.items) {
    if (item.passed || !item.live) continue;
    const piece = item.piece, near = (z: number) => item.ahead - 2 < z;
    if (piece.kind === "gates" && near(7)) {
      if (GateOp.caption(piece.left) || GateOp.caption(piece.right)) mark("rate-gate");
      if (piece.slide) mark("sliding-gate");
    }
    if (piece.kind === "squad" && near(8)) mark("squad");
    if (piece.kind === "barrel" && near(9)) mark("barrel");
    if (piece.kind === "hammer" && near(7)) mark("hammer");
    if (piece.kind === "bridge" && near(5)) mark("bridge");
    if (piece.kind === "blade" && near(7)) mark("blade");
  }
  if (sim.shootingFinale) mark("finale-shot", 0.001);
}
marks.sort((a, b) => a[0] - b[0]);
const save = { schemaVersion: 2, levels: {}, runner: { level, bestLevel: level, coins: 0, upgrades: economy.levels }, settings: { haptics: false, music: false, sound: false }, daily: {} };
const out = fileURLToPath(new URL("../../build/webtest/", import.meta.url));
mkdirSync(out, { recursive: true });
writeFileSync(`${out}plan-${run}.json`, JSON.stringify({ run, who, won: sim.outcome?.won === true, points, marks, save }));
console.log(`run ${run}, ${who}: ${sim.outcome?.won ? "win" : "loss"}; ${points.length} steering points; pictures: ${marks.map(([, name]) => name).join(", ")}`);
