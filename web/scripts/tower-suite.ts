// Number Tower's replay, audit, statistics and terminal drawing with no browser. Nothing runs when
// this file is imported.
//   replay()      play every campaign level's stored solution through the play simulation
//   audit()       measure every level and flag the ones that break their chapter's recipe
//   stats(level)  the difficulty numbers for the shell's table
//   show(level)   an ASCII drawing of a tower
import { folderOf } from "../src/app/modetable";
import {
  TowerSim, checkLevel, piecesOf, playOrder, roomCount, solve, validateLevel,
  type Room, type Thing, type TowerLevel,
} from "../src/sim/tower";
import { LEVELS, loadSet, type Chapter } from "./levels";
import { CHAPTERS, SEEDS, recipeOf } from "./tower-gen";

export const FOLDER = folderOf("tower");

/// The campaign as the level loader reads it: the chapters, and every level in play order with
/// its chapter and its place in that chapter, counted from 0.
export const campaign = (root = LEVELS): { chapters: Chapter[]; levels: { chapter: string; position: number; level: TowerLevel }[] } => {
  const set = loadSet<TowerLevel & { id: string }>(FOLDER, root);
  const byId = new Map(set.levels.map((level) => [level.id, level]));
  const levels = set.chapters.flatMap((chapter) =>
    chapter.levels.map((id, position) => ({ chapter: chapter.id, position, level: byId.get(id) as TowerLevel })));
  return { chapters: set.chapters, levels };
};

export const replay = (root = LEVELS): { passed: number; total: number } => {
  let passed = 0, total = 0;
  for (const { level } of campaign(root).levels) {
    total += 1;
    const t0 = performance.now();
    let detail: string, ok = false;
    try {
      validateLevel(level, true);
      const sim = new TowerSim(level);
      sim.replay(level.solution ?? []);
      let seconds = 0;
      while (!sim.outcome && seconds < 300) { sim.frame(1 / 30); seconds += 1 / 30; }
      const outcome = sim.outcome;
      ok = outcome?.won === true && outcome.score === level.best && outcome.stars === 3;
      detail = outcome === null ? "no result" : outcome.won
        ? `${outcome.stars} stars, final ${outcome.score}${ok ? "" : ` (file says best ${level.best})`}`
        : outcome.reason;
    } catch (error) {
      detail = (error as Error).message;
    }
    if (ok) passed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${String(level.id).padEnd(24)} ${String(level.name).padEnd(24)} ${detail}  (${(performance.now() - t0).toFixed(0)} ms)`);
  }
  return { passed, total };
};

const pad = (text: string, n: number) => text.padEnd(n);

/// Measure every level. A level is flagged when it fails its chapter's recipe or the rules every
/// level meets, when its stored best or solution disagrees with the solver, when random-win does
/// not fall through its chapter (ties go to the lower tier, then the smaller tower), or when it
/// has the same grid and the same pieces as its neighbour. Returns the number of flagged levels.
export const audit = (root = LEVELS): number => {
  const { levels } = campaign(root);
  let flagged = 0;
  const seen: { rw: number; tier: number; size: number; level: TowerLevel }[] = [];
  levels.forEach(({ chapter, position, level }) => {
    const spec = CHAPTERS.find((c) => c.id === chapter);
    const s = solve(level);
    const flags: string[] = [];
    const specIndex = spec?.specs.findIndex((_, p) => SEEDS[`${chapter}.${p}`] === level.seed) ?? -1;
    const sp = spec?.specs[specIndex];
    if (spec && sp) flags.push(...checkLevel(level, recipeOf(spec, sp), s));
    else flags.push(...checkLevel(level, undefined, s), "the seed matches no recipe");
    if (s.best !== level.best) flags.push(`stored best ${level.best} but the solver finds ${s.best}`);
    const played = playOrder(level, level.solution ?? []);
    if (!played.won || played.final !== level.best) flags.push("the stored solution does not reach best");
    const size = roomCount(level);
    const before = seen[seen.length - 1];
    if (position > 0 && before) {
      const rises = s.randomWin > before.rw + 1e-12
        || (Math.abs(s.randomWin - before.rw) < 1e-12 && (s.tier < before.tier || (s.tier === before.tier && size < before.size)));
      if (rises) flags.push("randomWin does not fall from the level before");
      if (before.level.w === level.w && before.level.h === level.h && piecesOf(before.level).join() === piecesOf(level).join()) {
        flags.push("same grid and pieces as the level before");
      }
    }
    seen.push({ rw: s.randomWin, tier: s.tier, size, level });
    if (position === 7) seen.length = 0;
    if (flags.length > 0) flagged += 1;
    const bots = `smallest:${s.bots.smallest ? "W" : "x"} wise:${s.bots.wise ? "W" : "x"}`;
    console.log(
      `${chapter}.${position + 1}  ${pad(`${level.w}x${level.h}`, 4)} ${pad(piecesOf(level).join(","), 40)} `
      + `rw ${(s.randomWin * 100).toFixed(2).padStart(6)}%  orders ${pad(`${s.winningOrders}${s.capped ? "+" : ""}`, 5)} tier ${s.tier}  ${bots}  best ${pad(String(s.best), 5)} `
      + `${flags.length === 0 ? "ok" : `FLAG: ${flags.join("; ")}`}`,
    );
  });
  return flagged;
};

export const stats = (level: TowerLevel): { randomWin: number; sample: number; exact: true; detail: string } => {
  const s = solve(level);
  const orders = `${s.winningOrders}${s.capped ? "+" : ""}`;
  return {
    randomWin: s.randomWin,
    sample: s.states,
    exact: true,
    detail: `${orders} winning order${s.winningOrders === 1 ? "" : "s"}, tier ${s.tier}, best ${s.best}`,
  };
};

// MARK: drawing

const CELL = 13;

const thingText = (t: Thing): string => {
  switch (t.kind) {
    case "enemy": return `enemy ${t.n}`;
    case "boss": return `BOSS ${t.n}`;
    case "grower": return `grower ${t.n}+${t.grow}`;
    case "plus": return `plus ${t.n}`;
    case "times": return `times ${t.k}`;
    case "minus": return `minus ${t.n}`;
    case "halve": return `halve ${t.k}`;
    case "mirror": return "mirror";
    case "key": return "key";
  }
};

const cellLines = (level: TowerLevel, index: number, everyEntry: boolean): string[] => {
  const room: Room | null = level.rooms[index] ?? null;
  if (!room) return new Array<string>(4).fill(":".repeat(CELL));
  const head = `#${index}${!everyEntry && level.entries.includes(index) && index >= level.w ? " IN" : ""}`;
  const flags = [room.max !== undefined ? `max ${room.max}` : "", room.locked ? "LOCK" : ""].filter(Boolean).join(" ");
  const lines = [head, flags, thingText(room.things[0] as Thing), room.things[1] ? thingText(room.things[1]) : ""];
  return lines.map((l) => ` ${l}`.slice(0, CELL).padEnd(CELL));
};

/// An ASCII drawing of a tower, top floor first. A gap in a border is a doorway, a solid border is
/// a wall. Entries on the ground floor are marked under the tower.
export const show = (level: TowerLevel): string => {
  const { w, h } = level;
  const live = level.rooms.flatMap((r, i) => (r ? [i] : []));
  const everyEntry = live.every((i) => level.entries.includes(i));
  const walled = new Set<string>();
  for (const [a, b] of level.walls) { walled.add(`${a}-${b}`); walled.add(`${b}-${a}`); }
  const open = (a: number, b: number) => !!level.rooms[a] && !!level.rooms[b] && !walled.has(`${a}-${b}`);
  const out: string[] = [];
  out.push(`${level.name ?? level.id ?? "Tower"}: start ${level.start}. ${everyEntry ? "Every room is an entry." : "Enter on the ground floor."}`);
  for (let f = h - 1; f >= 0; f--) {
    let border = "";
    for (let c = 0; c < w; c++) {
      const here = f * w + c;
      const doorway = f < h - 1 && open(here, here + w);
      border += `+${doorway ? "-----   -----" : "-".repeat(CELL)}`;
    }
    out.push(`${border}+`);
    const cells = Array.from({ length: w }, (_, c) => cellLines(level, f * w + c, everyEntry));
    for (let line = 0; line < 4; line++) {
      let row = "|";
      for (let c = 0; c < w; c++) {
        row += cells[c]?.[line] ?? "";
        const here = f * w + c;
        const door = c < w - 1 && open(here, here + 1) && (line === 1 || line === 2);
        row += c === w - 1 ? "|" : door ? " " : "|";
      }
      out.push(row);
    }
  }
  let bottom = "", marks = "";
  for (let c = 0; c < w; c++) {
    const entry = !everyEntry && level.entries.includes(c);
    bottom += `+${entry ? "-----   -----" : "-".repeat(CELL)}`;
    marks += ` ${entry ? "     ^ in    " : " ".repeat(CELL)}`;
  }
  out.push(`${bottom}+`);
  if (!everyEntry) out.push(marks.trimEnd());
  if (level.solution) out.push(`Best ${level.best}, in the order ${level.solution.join(", ")}.`);
  return out.join("\n");
};

