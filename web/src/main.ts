// The shell: home, level select, settings, and the game host, as screens on one stage.
import "./style.css";
import * as art from "./app/art";
import * as audio from "./app/audio";
import { button, h, icon, iconButton, stars, swatch } from "./app/dom";
import { Game, setStageScale, warmRenderer } from "./app/game";
import { dateWords, localDate, streakWords } from "./app/daily";
import {
  MODES, chapters, dailyLevel, isLab, levelIDs, levelLabel, levelName, levelStat, mode as findMode, nextLevel, prefetchAll, warm,
  type LevelMode, type ModeInfo,
} from "./app/modes";
import { oddsText } from "./app/odds";
import { showRunnerHub } from "./app/runnerhub";
import { dailyResult, dailyStreak, record, recordDaily, results, store, takeHint } from "./app/store";
import { W } from "./scenes/kit";

const VERSION = "0.1.0";
const stage = document.getElementById("stage")!;
const ui = document.getElementById("ui")!;
let game: Game | null = null;
/// How many screens have been shown. A screen that takes a moment to get ready checks it, so it
/// does not appear after the player has already moved on.
let visits = 0;

// The stage keeps its shape and scales to fit the frame, which is the window minus the phone's
// safe areas. The frame is measured, not the window: a phone browser changes the window's height
// as its bars slide, and reports it wrongly for a moment when a home-screen app starts.
const frame = document.getElementById("frame")!;
const STAGE_H = 780;
const fit = () => {
  const w = frame.clientWidth, hgt = frame.clientHeight;
  if (w === 0 || hgt === 0) return;
  const scale = Math.min(w / W, hgt / STAGE_H);
  stage.style.transform = `translate(${(w - W * scale) / 2}px, ${(hgt - STAGE_H * scale) / 2}px) scale(${scale})`;
  setStageScale(scale);
};
document.body.style.backgroundImage = `url(${art.url("paper")})`;
new ResizeObserver(fit).observe(frame);
addEventListener("resize", fit);
addEventListener("orientationchange", fit);
visualViewport?.addEventListener("resize", fit);
fit();

const applySettings = () => {
  Object.assign(audio.settings, store.progress.settings);
  audio.applySettings();
};

const go = (path: string) => { location.hash = path; };
const back = (path: string) => () => go(path);

/// The paper behind the stage. A window taller than the stage shows it above and below, so it
/// has to be the same sheet the screen itself is on.
const setPaper = (paperName: string) => {
  document.body.style.backgroundImage = `url(${art.url(paperName)})`;
};

const screen = (paperName: string, ...children: (Node | string)[]) => {
  const el = h("div.screen", ...children);
  el.style.backgroundImage = `url(${art.url(paperName)})`;
  setPaper(paperName);
  return el;
};

const summary = (m: ModeInfo): string => {
  if (m.kind === "runner") {
    const r = store.progress.runner;
    return r.bestLevel === 0 && r.coins === 0 ? "Not started" : `Level ${r.level + 1}, ${r.coins} coins`;
  }
  const ids = levelIDs(m.id), saved = results(store.progress, m.id);
  const cleared = ids.filter((id) => saved[id]?.cleared).length;
  return ids.length === 0 ? "Coming soon" : cleared === 0 ? `${ids.length} levels` : `${cleared}/${ids.length} cleared`;
};

/// Every star earned across the modes with levels, and how many there are to earn.
const starCount = (): { earned: number; total: number } => {
  let earned = 0, total = 0;
  for (const m of MODES) {
    if (m.kind !== "levels") continue;
    const ids = levelIDs(m.id), saved = results(store.progress, m.id);
    total += ids.length * 3;
    for (const id of ids) earned += saved[id]?.bestStars ?? 0;
  }
  return { earned, total };
};

const home = () => {
  audio.playMusic("menu");
  const count = starCount(), star = h("div");
  art.paint(star, "ui_star_on", 18);
  const header = h("div",
    h("div.row", { style: { alignItems: "flex-start" } },
      h("h1.title.grow", "ACTUAL", h("br"), "GAMEPLAY"),
      iconButton("settings", "Settings", () => go("/settings"))),
    h("div.row", { style: { margin: "12px 0 0", gap: "8px" } },
      h("p.muted.grow", { style: { fontSize: "15px", margin: "0" } }, "The games from the ads. Without the ads."),
      h("div.row", { style: { gap: "4px" }, "aria-label": `${count.earned} of ${count.total} stars` }, star, h("span.marker", { style: { fontSize: "15px" } }, `${count.earned}/${count.total}`))),
    h("div.hairline", { style: { marginTop: "14px" } }));
  // The level that is new today, where a mode has one, sits above the modes.
  const today = MODES.flatMap((m) => (m.kind === "levels" && m.daily ? [dailyTile(m, m.daily)] : []));
  const cards = MODES.map((m) => art.frame(h<"button">("button.mode-card", { onclick: () => { audio.play("tap"); go(`/${m.id}`); } },
    swatch(m.preview[0], m.preview[1], m.swatch, 60),
    h("div.grow", h("h2", m.title), h("p.muted", m.blurb), h("p.mono", { style: { fontSize: "12px" } }, summary(m))),
    icon("chevronRight"))));
  // The ads carry a line in small print: "Not all images represent actual gameplay." Here all of them do.
  const small = h("div.small-print",
    h("div", "All images represent actual gameplay."),
    h("div", "Every \"only X%\" on a level is measured: random play, counted."),
    h("div.mono", `v${VERSION}`));
  ui.replaceChildren(screen("paper", header, ...today, ...cards, h("div.grow"), small));
};

/// One level on the list: its place in the chapter, its stars, and a corner tag when its
/// measured number shows as 10% or less. Every level is open from the start.
const tile = (m: LevelMode, id: string, place: number, bestStars: number) => {
  const stat = levelStat(m.id, id);
  const tag = stat ? oddsText(stat, m.random).tag : null;
  const odds = tag ? `, ${tag} of random ${m.random.tries} ${m.random.win}` : "";
  return art.frame(h<"button">("button.tile", {
    "aria-label": `Level ${levelLabel(m.id, id)}, ${levelName(m.id, id)}, ${bestStars} of 3 stars${odds}`,
    onclick: () => { audio.play("select"); go(`/${m.id}/${id}`); },
  }, h("div.n", String(place)), stars(bestStars, 15), tag && h("div.tag", tag)));
};

/// The level that is new each day, as a wide tile above the chapters: what it is and the date,
/// the stars earned on it today, and the run of days it has been cleared.
const dailyTile = (m: LevelMode, words: { tile: string }) => {
  const date = localDate(new Date()), earned = dailyResult(store.progress, m.id, date)?.stars ?? 0;
  const streak = streakWords(dailyStreak(store.progress, m.id, date));
  return art.frame(h<"button">("button.daily", {
    "aria-label": `${words.tile}, ${dateWords(date)}, ${earned} of 3 stars, ${streak}`,
    onclick: () => { audio.play("select"); go(`/${m.id}/daily`); },
  }, h("div.grow", h("h2", words.tile), h("p.muted", dateWords(date))),
  h("div.side", stars(earned, 20), h("div.mono.streak", streak))));
};

const levelSelect = (m: LevelMode) => {
  audio.playMusic(m.track);
  // The player is about to pick a level: get this mode's code and art ready now.
  void warm(m.id);
  const ids = levelIDs(m.id), saved = results(store.progress, m.id);
  const earned = ids.reduce((sum, id) => sum + (saved[id]?.bestStars ?? 0), 0);
  const star = h("div");
  art.paint(star, "ui_star_on", 24);
  const total = h("div.row", { style: { gap: "6px" }, role: "img", "aria-label": `${earned} of ${ids.length * 3} stars` },
    star, h("span.marker", { style: { fontSize: "20px" } }, `${earned}/${ids.length * 3}`));
  const sections = chapters(m.id).map((chapter) => {
    const grid = h("div.grid");
    chapter.levels.forEach((id, i) => grid.append(tile(m, id, i + 1, saved[id]?.bestStars ?? 0)));
    return h("section.chapter",
      h("h2", h("span.num", chapter.id), chapter.title),
      h("p.muted", chapter.blurb),
      grid);
  });
  ui.replaceChildren(screen(m.paper,
    h("div.row", iconButton("arrowBack", "Back", back("/")),
      h("div.grow.marker", { style: { fontSize: "24px", lineHeight: "1.1" } }, m.title.toUpperCase()),
      total),
    ...(m.daily ? [dailyTile(m, m.daily)] : []),
    ...(sections.length === 0 ? [h("p.muted", "No levels yet.")] : sections)));
};

const play = (m: LevelMode, level: string) => {
  const next = nextLevel(m.id, level);
  stage.style.backgroundImage = `url(${art.url(m.paper)})`;
  setPaper(m.paper);
  game = new Game(ui, {
    mode: m, level, hasNext: next !== null, exitLabel: "Back to levels",
    onExit: back(`/${m.id}`),
    onNext: () => { if (next) go(`/${m.id}/${next}`); },
    onResult: (outcome) => {
      if (outcome.won) store.update((p) => record(p, m.id, level, outcome.stars, outcome.score, m.higherIsBetter));
    },
    onHint: () => {
      let step = 1;
      store.update((p) => { step = takeHint(p, m.id, level); });
      return step;
    },
  });
};

/// A level from the lab, #/<mode>/~<name>: a level file that is in no chapter, played as it is.
/// It has no sticker and no level after it, and nothing about it is saved. Its hints count from
/// one on every visit, because nothing is kept.
const playLab = (m: LevelMode, level: string) => {
  stage.style.backgroundImage = `url(${art.url(m.paper)})`;
  setPaper(m.paper);
  let hints = 0;
  game = new Game(ui, {
    mode: m, level, hasNext: false, exitLabel: "Back to levels",
    onExit: back(`/${m.id}`),
    onNext: () => {},
    onResult: () => {},
    onHint: () => ++hints,
  });
};

/// The level a mode makes new each day. It is made and solved when it is opened, and what the
/// player does with it is kept under the date.
const playDaily = async (m: LevelMode) => {
  const date = localDate(new Date()), visit = visits;
  stage.style.backgroundImage = `url(${art.url(m.paper)})`;
  setPaper(m.paper);
  ui.replaceChildren(h("div.loading", "Loading"));
  const level = await dailyLevel(m.id, date).catch(() => null);
  // The player may have left while it was being made.
  if (visit !== visits) return;
  if (level === null) { go(`/${m.id}`); return; }
  // Hints on a daily level are counted for the visit and not saved: tomorrow has another level.
  let hints = 0;
  game = new Game(ui, {
    mode: m, level, hasNext: false, exitLabel: "Back to levels",
    onExit: back(`/${m.id}`),
    onNext: () => {},
    onResult: (outcome) => {
      if (outcome.won) store.update((p) => recordDaily(p, m.id, date, outcome.stars, outcome.score));
    },
    onHint: () => (hints += 1),
  });
};

const runnerHub = (m: ModeInfo) => {
  audio.playMusic(m.track);
  void warm(m.id);
  const el = screen(m.paper);
  ui.replaceChildren(el);
  showRunnerHub(el, { onBack: back("/"), onRun: () => go(`/${m.id}/play`) });
};

/// One run of Crowd Run, at the level the store holds now. Retry replays this same run; Next
/// routes again, which starts the run after it.
const playRun = (m: ModeInfo) => {
  stage.style.backgroundImage = `url(${art.url(m.paper)})`;
  setPaper(m.paper);
  // A win is paid once. A retry after it replays the same track, and that must not pay again or skip a run.
  let paid = false;
  game = new Game(ui, {
    mode: m, level: String(store.progress.runner.level), hasNext: true, exitLabel: "Back",
    onExit: back(`/${m.id}`),
    onNext: route,
    onResult: (outcome) => {
      if (!outcome.won || paid) return;
      paid = true;
      store.update((p) => {
        p.runner.coins += outcome.coins;
        p.runner.level += 1;
        p.runner.bestLevel = Math.max(p.runner.bestLevel, p.runner.level);
      });
    },
  });
};

const settings = () => {
  const toggle = (label: string, key: "haptics" | "music" | "sound") => {
    const knob = h("span.switch" + (store.progress.settings[key] ? ".on" : ""));
    return h<"button">("button.toggle", {
      role: "switch", "aria-checked": String(store.progress.settings[key]),
      onclick: (e: Event) => {
        const value = !store.progress.settings[key];
        store.update((p) => { p.settings[key] = value; });
        applySettings();
        // Effects switch before the toggle sound plays, so switching them on is heard and off is not.
        audio.play(value ? "toggleOn" : "toggleOff");
        knob.classList.toggle("on", value);
        (e.currentTarget as HTMLElement).setAttribute("aria-checked", String(value));
      },
    }, label, knob);
  };
  const toggles = art.frame(h("div.panel", toggle("Music", "music"), h("div.hairline"), toggle("Sound effects", "sound")));
  if ("vibrate" in navigator) toggles.prepend(toggle("Haptics", "haptics"), h("div.hairline"));
  const credits = art.frame(h("div.panel", { style: { gap: "4px" } },
    h("div.marker", { style: { fontSize: "14px" } }, "Music by Kevin MacLeod (incompetech.com)"),
    h("div.muted", { style: { fontSize: "12px" } }, "Licensed under Creative Commons: By Attribution 4.0 License. http://creativecommons.org/licenses/by/4.0/"),
    h("div.mono.muted", { style: { fontSize: "11px" } }, Object.values(audio.TRACKS).map((t) => `"${t}"`).join(", ")),
    h("div.muted", { style: { fontSize: "12px", marginTop: "6px" } }, "Clawd and the painted art are drawn with the Claude Animation Base kit (MIT). Sound effects: Kenney (CC0) and UI SFX by Romain Simon (CC0). Fonts: Permanent Marker (Apache 2.0), Material Symbols (Apache 2.0)."),
    h<"a">("a.muted", { href: `${import.meta.env.BASE_URL}audio/CREDITS.txt`, target: "_blank", style: { fontSize: "12px" } }, "Full credits")));
  let armed = false;
  const reset = button("Reset all progress", () => {
    if (!armed) { armed = true; reset.textContent = "Tap again to reset everything"; return; }
    store.resetAll();
    applySettings();
    go("/");
  }, { art: "ui_button_rose" });
  ui.replaceChildren(screen("paper",
    h("div.row", h("div.marker.grow", { style: { fontSize: "28px" } }, "SETTINGS"), iconButton("close", "Close", back("/"))),
    toggles, credits,
    h("div.muted", { style: { fontSize: "13px" } }, matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "Reduce Motion is on. Shakes and bounces stay off." : "Reduce Motion is off."),
    reset,
    h("div.mono.muted", { style: { fontSize: "12px", marginTop: "8px" } }, "No ads. No purchases. Your progress stays in this browser.")));
};

const route = () => {
  visits += 1;
  game?.close();
  game = null;
  stage.style.backgroundImage = "";
  // #/<mode> is a mode's level list (or the runner's hub), #/<mode>/<level id> is one level, and
  // #/<mode>/daily is today's level in a mode that makes one each day.
  const [, first, second] = location.hash.replace(/^#/, "").split("/");
  const m = findMode(first ?? "");
  if (first === "settings") settings();
  else if (m?.kind === "levels" && second && levelIDs(m.id).includes(second)) play(m, second);
  else if (m?.kind === "levels" && second && isLab(second)) playLab(m, second);
  else if (m?.kind === "levels" && m.daily && second === "daily") void playDaily(m);
  else if (m?.kind === "levels") levelSelect(m);
  else if (m && second === "play") playRun(m);
  else if (m) runnerHub(m);
  else home();
};

addEventListener("pointerdown", () => audio.unlock(), { capture: true });
addEventListener("keydown", () => audio.unlock(), { capture: true });
addEventListener("hashchange", route);
document.addEventListener("visibilitychange", () => audio.setSuspended(document.hidden));
// Nothing here should pop a menu or select text on a long press.
addEventListener("contextmenu", (e) => e.preventDefault());

store.load();
applySettings();
audio.preloadMusic("menu");
// Once the first screen is up and the page is idle: make the canvas, then bring the games' files
// into the cache, so the first level of each mode does not wait on the network.
const idle = (run: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(run, { timeout: 3000 }) : setTimeout(run, 800));
addEventListener("load", () => idle(() => { warmRenderer(); void prefetchAll(); }));
// The menus are drawn in Permanent Marker; wait for it so the first screen does not reflow.
void Promise.all([document.fonts.load('16px "Permanent Marker"'), document.fonts.load('24px "Material Symbols Sharp"')]).finally(route);

// Offline play, on the deployed site only: a worker in the way of the dev server hides changes.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}
