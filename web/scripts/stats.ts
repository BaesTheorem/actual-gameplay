// Measure how hard every level is: the share of random play that wins it. The fake ads say
// "only 1% can solve this"; this is where the real number comes from.
//   npm run stats               measure the levels whose file changed since they were measured
//   npm run stats -- --force    measure every level again
//   npm run stats -- --check    measure nothing; exit 1 if a level has no entry or a stale one
//   npm run stats -- --jobs 2   run the simulations in one or two processes; 2 is the most and the default
//
// The numbers go to web/levels/stats.json, one entry per level under "<mode>/<level id>", each
// stamped with the SHA-256 of the level file it was measured on. The asset build hands the
// current entries to the app. What "random play" means is each mode's own model:
//   pinPull   every pull order, played out: the chance that pulling pins at random wins (pin-suite.ts)
//   saveDog   48 plausible random strokes, each as the only stroke: the share that survive (savedog-suite.ts)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LEVEL_MODES } from "../src/app/modetable";
import type { PinLevel } from "../src/sim/pinpull";
import { LEVELS, levelHash, load } from "./levels";
import { Pool, inOrder, moduleURL } from "./parallel";
import { odds as pinOdds, type End, type Odds } from "./pin-suite";

interface Entry extends Odds { hash: string }

const FILE = join(LEVELS, "stats.json");

/// How each mode measures one level. A mode with levels and no model here stops the run,
/// because every level ships with its number.
const MODELS: Record<string, (pool: Pool) => (level: { id: string }) => Promise<Odds>> = {
  pinPull: (pool) => {
    const suite = moduleURL("./pin-suite.ts", import.meta.url);
    return (level) => pinOdds(level as PinLevel, (l, pins) => pool.run<End>({ module: suite, name: "play", args: [l.id, pins] }));
  },
  saveDog: (pool) => {
    const suite = moduleURL("./savedog-suite.ts", import.meta.url);
    return (level) => pool.run<Odds>({ module: suite, name: "odds", args: [level.id] });
  },
};

const force = process.argv.includes("--force"), check = process.argv.includes("--check");
const read = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {}) as Record<string, Entry>;
const stored = read();

// Every level of every mode with levels, in play order.
const levels = LEVEL_MODES.flatMap((mode) => {
  if (!MODELS[mode.id]) throw new Error(`no model for "${mode.id}": add one to scripts/stats.ts`);
  return load<{ id: string }>(mode.folder).map((level) => ({ mode, level, key: `${mode.id}/${level.id}`, hash: levelHash(mode.folder, level.id) }));
});
const fresh = (key: string, hash: string) => stored[key]?.hash === hash;

if (check) {
  const stale = levels.filter((l) => !fresh(l.key, l.hash));
  for (const l of stale) console.log(`${l.key}  ${stored[l.key] ? "changed since it was measured" : "never measured"}`);
  console.log(stale.length === 0 ? `${levels.length} levels, every one measured` : `\n${stale.length} of ${levels.length} levels need "npm run stats"`);
  process.exit(stale.length === 0 ? 0 : 1);
}

/// Write the file: one line per level, in play order. An entry for a level that is gone is
/// dropped. An entry for a mode this table does not know is someone else's, and is kept as the
/// file has it now.
const current: Record<string, Entry> = { ...stored };
const known = new Set(LEVEL_MODES.map((mode) => mode.id));
const save = () => {
  const lines = levels.filter((l) => current[l.key]).map((l) => [l.key, current[l.key]] as const);
  for (const [key, entry] of Object.entries(read())) {
    if (!known.has(key.split("/")[0])) lines.push([key, entry]);
  }
  const text = `{\n${lines.map(([key, entry]) => `  ${JSON.stringify(key)}: ${JSON.stringify(entry)}`).join(",\n")}\n}\n`;
  if (!existsSync(FILE) || readFileSync(FILE, "utf8") !== text) writeFileSync(FILE, text);
};

const started = performance.now();
const pool = new Pool();
const measure = new Map(LEVEL_MODES.map((mode) => [mode.id, MODELS[mode.id](pool)]));
const percent = (share: number) => `${(share * 100).toFixed(1)}%`.padStart(6);
console.log(`${"level".padEnd(34)} ${"share".padStart(6)} ${"sample".padStart(6)}  exact  detail`);
let measured = 0;
await inOrder(levels.map(async (l): Promise<Entry> => {
  if (!force && fresh(l.key, l.hash)) return stored[l.key];
  measured += 1;
  const found = await measure.get(l.mode.id)!(l.level);
  // Six places are plenty for a share, and keep a third from filling the file with threes.
  current[l.key] = { hash: l.hash, randomWin: Math.round(found.randomWin * 1e6) / 1e6, sample: found.sample, exact: found.exact, detail: found.detail };
  // Each measurement is written as it comes in, so a run that is stopped keeps what it finished.
  save();
  return current[l.key];
}), (entry, i) => {
  console.log(`${levels[i].key.padEnd(34)} ${percent(entry.randomWin)} ${String(entry.sample).padStart(6)}  ${entry.exact ? "yes  " : "no   "}  ${entry.detail}`);
});
pool.close();
save();
console.log(`\n${measured} measured, ${levels.length - measured} unchanged  (${((performance.now() - started) / 1000).toFixed(0)} s)`);
process.exit(0);
