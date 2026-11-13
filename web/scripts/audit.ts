// Stress the levels with no browser.
//   npm run audit -- pinPull     every pull sequence up to par, pruned at wins and deaths;
//                                each level is UNIQUE or the other winning orders are listed
import { playOut, type PinLevel } from "../src/sim/pinpull";
import { load } from "./levels";

const STALL = "Settled short of the goal.";

/// Search pull sequences up to par, extending only the ones that neither won nor died.
/// A sequence that stalled (everything settled, nothing won) can still be extended; one that
/// ended in a death, a melt or a drain cannot, and one that won needs no more pulls.
const exhaustivePins = (level: PinLevel) => {
  const ids = level.pins.map((p) => p.id);
  let frontier: string[][] = [[]];
  const winners: string[][] = [];
  let tried = 0;
  for (let k = 1; k <= level.parPins; k++) {
    const next: string[][] = [];
    for (const prefix of frontier) {
      for (const pin of ids) {
        if (prefix.includes(pin)) continue;
        const seq = [...prefix, pin];
        tried += 1;
        const { outcome } = playOut(level, seq);
        if (outcome?.won) winners.push(seq);
        else if (outcome === null || outcome.reason === STALL) next.push(seq);
      }
    }
    frontier = next;
  }
  return { winners, tried };
};

const mode = process.argv[2] ?? "pinPull";
let flagged = 0;
if (mode === "pinPull") {
  for (const level of load<PinLevel>("pinpull")) {
    const { winners, tried } = exhaustivePins(level);
    const solution = (level.solution ?? []).join("+");
    const won = winners.map((w) => w.join("+"));
    let verdict: string;
    if (won.length === 0) verdict = "UNWINNABLE within par";
    else if (won.length === 1 && won[0] === solution) verdict = "UNIQUE";
    else if (won.includes(solution)) verdict = `NOT UNIQUE: also ${won.filter((w) => w !== solution).join(", ")}`;
    else verdict = `BROKEN: solution does not win; winners ${won.join(", ")}`;
    if (verdict !== "UNIQUE") flagged += 1;
    console.log(`${level.id}  ${level.name.padEnd(22)} par ${level.parPins}  ${String(tried).padStart(3)} sequences  ${verdict}`);
  }
}
console.log(`\n${flagged} level(s) flagged`);
process.exit(flagged === 0 ? 0 : 1);
