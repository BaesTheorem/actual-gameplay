// Level files are read from the iPhone app's folder, so the two builds can never disagree.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const LEVELS = join(dirname(fileURLToPath(import.meta.url)), "../../ActualGameplay/Levels");

export const load = <T>(mode: "pinpull" | "savedog"): T[] =>
  readdirSync(join(LEVELS, mode)).filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(readFileSync(join(LEVELS, mode, f), "utf8")) as T);
