// The shell: home, level select, settings, and the game host, as screens on one stage.
import "./style.css";
import * as art from "./app/art";
import * as audio from "./app/audio";
import { button, h, icon, iconButton, stars, swatch } from "./app/dom";
import { Game, setStageScale, warmRenderer } from "./app/game";
import {
  MODES, chapters, levelIDs, levelLabel, levelName, levelStat, mode as findMode, nextLevel, prefetchAll, warm,
  type LevelMode, type ModeInfo,
} from "./app/modes";
import { oddsText } from "./app/odds";
import { showRunnerHub } from "./app/runnerhub";
import { record, results, store, takeHint } from "./app/store";
import { W } from "./scenes/kit";

const VERSION = "0.1.0";
const stage = document.getElementById("stage")!;
const ui = document.getElementById("ui")!;
let game: Game | null = null;

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

const home = () => {
  audio.playMusic("menu");
  const header = h("div",
    h("div.row", { style: { alignItems: "flex-start" } },
      h("h1.title.grow", "ACTUAL", h("br"), "GAMEPLAY"),
      iconButton("settings", "Settings", () => go("/settings"))),
    h("p.muted", { style: { fontSize: "15px", margin: "14px 0 0" } }, "The games from the ads. Without the ads."),
    h("div.hairline", { style: { marginTop: "16px" } }));
  const cards = MODES.map((m) => art.frame(h<"button">("button.mode-card", { onclick: () => { audio.play("tap"); go(`/${m.id}`); } },
    swatch(m.preview[0], m.preview[1], m.swatch, 68),
    h("div.grow", h("h2", m.title), h("p.muted", m.blurb), h("p.mono", { style: { fontSize: "12px" } }, summary(m))),
    icon("chevronRight"))));
  ui.replaceChildren(screen("paper", header, ...cards, h("div.grow"), h("div.mono.muted", { style: { fontSize: "12px" } }, `v${VERSION}`)));
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
      if (outcome.won) store.update((p) => record(p, m.id, level, outcome.stars, outcome.score));
    },
    onHint: () => {
      let step = 1;
      store.update((p) => { step = takeHint(p, m.id, level); });
      return step;
    },
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
  game?.close();
  game = null;
  stage.style.backgroundImage = "";
  // #/<mode> is a mode's level list (or the runner's hub) and #/<mode>/<level id> is one level.
  const [, first, second] = location.hash.replace(/^#/, "").split("/");
  const m = findMode(first ?? "");
  if (first === "settings") settings();
  else if (m?.kind === "levels" && second && levelIDs(m.id).includes(second)) play(m, second);
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
