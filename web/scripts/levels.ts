// Level files, read from web/levels/<folder>: one JSON file per level, named by the level's id,
// and chapters.json, which puts them in play order. The asset build, the replays, the audits, the
// statistics and the tests all read levels through here, so they cannot disagree about the order
// or about which files count.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Chapter } from "../src/app/chapters";

export type { Chapter } from "../src/app/chapters";

export const LEVELS = join(dirname(fileURLToPath(import.meta.url)), "../levels");

/// One mode's levels: its chapters as written, and every level in play order.
export interface LevelSet<T> { chapters: Chapter[]; levels: T[] }

/// A level id: lower-case words and numbers joined by single dashes.
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/// Read a folder of levels. Anything that does not add up is an error that names the culprit:
/// a chapter entry with no file, a file no chapter lists, a level listed twice, an id that is
/// not a slug, or a file whose id is not its own name.
export const loadSet = <T extends { id: string }>(folder: string, root = LEVELS): LevelSet<T> => {
  const dir = join(root, folder);
  const fail = (problem: string): never => { throw new Error(`levels/${folder}: ${problem}`); };
  const chapters = JSON.parse(readFileSync(join(dir, "chapters.json"), "utf8")) as Chapter[];
  if (!Array.isArray(chapters)) fail("chapters.json must be an array of chapters");
  const files = new Set(readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "chapters.json").map((f) => f.slice(0, -5)));
  const chapterIds = new Set<string>(), listed = new Set<string>();
  const levels: T[] = [];
  for (const chapter of chapters) {
    if (!isText(chapter.id)) fail("a chapter has no id");
    if (chapterIds.has(chapter.id)) fail(`chapter "${chapter.id}" appears twice`);
    chapterIds.add(chapter.id);
    if (!isText(chapter.title)) fail(`chapter "${chapter.id}" has no title`);
    if (typeof chapter.blurb !== "string") fail(`chapter "${chapter.id}" has no blurb`);
    if (!Array.isArray(chapter.levels)) fail(`chapter "${chapter.id}" has no list of levels`);
    for (const id of chapter.levels) {
      if (!isText(id) || !SLUG.test(id)) fail(`chapter "${chapter.id}" lists "${id}", which is not a kebab-case id`);
      if (listed.has(id)) fail(`level "${id}" is listed twice`);
      if (!files.has(id)) fail(`chapter "${chapter.id}" lists "${id}", which has no file`);
      listed.add(id);
      const level = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")) as T;
      if (level.id !== id) fail(`${id}.json says its id is "${level.id}"`);
      levels.push(level);
    }
  }
  for (const stem of files) {
    if (!listed.has(stem)) fail(`${stem}.json is in no chapter`);
  }
  return { chapters, levels };
};

/// A mode's levels in play order.
export const load = <T extends { id: string }>(folder: string, root = LEVELS): T[] => loadSet<T>(folder, root).levels;

/// One level by id.
export const loadLevel = <T extends { id: string }>(folder: string, id: string, root = LEVELS): T => {
  const level = load<T>(folder, root).find((l) => l.id === id);
  if (!level) throw new Error(`levels/${folder}: no level "${id}"`);
  return level;
};

/// The SHA-256 of a level file's bytes. A statistic measured on a level is stamped with it, so a
/// level that changed afterwards can be told from one that did not.
export const levelHash = (folder: string, id: string, root = LEVELS): string =>
  createHash("sha256").update(readFileSync(join(root, folder, `${id}.json`))).digest("hex");

/// A number that belongs to a level id and never changes: the 32-bit FNV-1a hash of the slug.
/// Random play measured on a level is seeded from it, so a level that moves to another place in
/// a chapter list keeps the number that was measured for it.
export const idNumber = (id: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return hash;
};
