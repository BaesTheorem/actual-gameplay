// The games, one row each. This file is plain data with nothing to load, so the shell, the asset
// build and the level tools all read the same table. A new mode starts as a row here.
import type { Track } from "./audio";

interface ModeBase {
  /// The mode's name in a route (#/pinPull), in a save, and in the level statistics.
  id: string;
  title: string;
  blurb: string;
  accent: string;
  /// The painted Clawd on the home card: a clip and the frame of it to show (frame 0 is often mid-blink).
  preview: [string, number];
  /// The clips on the result card: Clawd after a win, and after a loss.
  figure: { won: string; lost: string };
  swatch: string;
  track: Track;
  paper: string;
  scoreLabel: string;
}

/// A mode played level by level. Its levels and chapters are in web/levels/<folder>.
export interface LevelMode extends ModeBase {
  kind: "levels";
  folder: string;
  /// How the measured share of random play is worded: "random pulls win", "random doodles survive".
  random: { tries: string; win: string };
  /// Set where a bigger score is the better one. The other modes count ink and pulls, where less is better.
  higherIsBetter?: boolean;
  /// A level made new each day, for a mode that has one: the words on its tile in the level
  /// list, and the start of its title in the level ("Daily tower, 13 November").
  daily?: { tile: string; title: string };
}

/// The endless mode: its runs are generated, so it has no level files.
export interface RunnerMode extends ModeBase {
  kind: "runner";
}

export type ModeInfo = LevelMode | RunnerMode;

export const MODES: ModeInfo[] = [
  { id: "saveDog", kind: "levels", folder: "savedog", title: "Save the Clawd", blurb: "Draw a shield. Then the bees come.", accent: "var(--sky)",
    preview: ["clawd_nervous", 3], figure: { won: "clawd_excited", lost: "clawd_ko" },
    swatch: "ui_button_sky", track: "saveDog", paper: "paper", scoreLabel: "ink used",
    random: { tries: "doodles", win: "survive" } },
  { id: "pinPull", kind: "levels", folder: "pinpull", title: "Pull the Pin", blurb: "Lava up top, hero down below. Mind the order.", accent: "var(--clay)",
    preview: ["clawd_hard_idle", 4], figure: { won: "clawd_hard_excited", lost: "clawd_hard_ko" },
    swatch: "ui_button_ink", track: "pinPull", paper: "paper_cave", scoreLabel: "pins pulled",
    random: { tries: "pulls", win: "win" } },
  { id: "runner", kind: "runner", title: "Crowd Run", blurb: "Pick gates, grow the crowd, storm the finish.", accent: "var(--sap)",
    preview: ["clawd_run", 3], figure: { won: "clawd_excited", lost: "clawd_ko" },
    swatch: "ui_button_sap", track: "runner", paper: "paper", scoreLabel: "survivors" },
  { id: "tower", kind: "levels", folder: "tower", title: "Number Tower", blurb: "The bigger number wins. The stairs are the hard part.", accent: "var(--ochre)",
    preview: ["clawd_band_idle", 4], figure: { won: "clawd_band_excited", lost: "clawd_band_ko" },
    swatch: "ui_button_ochre", track: "tower", paper: "paper", scoreLabel: "final number",
    random: { tries: "climbs", win: "win" }, higherIsBetter: true,
    daily: { tile: "Today's tower", title: "Daily tower" } },
];

export const mode = (id: string): ModeInfo | undefined => MODES.find((m) => m.id === id);
export const LEVEL_MODES: LevelMode[] = MODES.filter((m): m is LevelMode => m.kind === "levels");

/// The level folder of a mode, by the mode's id. Asking for a mode that has none is a mistake.
export const folderOf = (id: string): string => {
  const found = LEVEL_MODES.find((m) => m.id === id);
  if (!found) throw new Error(`"${id}" is not a mode with levels`);
  return found.folder;
};
