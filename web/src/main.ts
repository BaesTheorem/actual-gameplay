// The shell: home, level select, settings, and the game host, as screens on one stage.
import "./style.css";
import * as art from "./app/art";
import * as audio from "./app/audio";
import { button, h, icon, iconButton, stars, swatch } from "./app/dom";
import { Game, setStageScale } from "./app/game";
import { MODES, levelCount, levelID, mode as findMode, type ModeInfo } from "./app/modes";
import { showRunnerHub } from "./app/runnerhub";
import { record, store, type Mode } from "./app/store";
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

const screen = (paperName: string, ...children: (Node | string)[]) => {
  const el = h("div.screen", ...children);
  el.style.backgroundImage = `url(${art.url(paperName)})`;
  return el;
};

const summary = (m: ModeInfo): string => {
  if (m.id === "runner") {
    const r = store.progress.runner;
    return r.bestLevel === 0 && r.coins === 0 ? "Not started" : `Level ${r.level + 1}, ${r.coins} coins`;
  }
  const total = levelCount(m.id);
  const cleared = Object.values(store.progress[m.id]).filter((r) => r.cleared).length;
  return total === 0 ? "Coming soon" : cleared === 0 ? `${total} levels` : `${cleared}/${total} cleared`;
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

const levelSelect = (m: ModeInfo) => {
  audio.playMusic(m.track);
  const count = levelCount(m.id as Mode);
  const results = store.progress[m.id as "saveDog" | "pinPull"];
  const cleared = Object.values(results).filter((r) => r.cleared).length;
  const grid = h("div.grid");
  for (let i = 0; i < count; i++) {
    const result = results[levelID(m.id, i)];
    grid.append(art.frame(h<"button">("button.tile", {
      "aria-label": `Level ${i + 1}, ${result?.bestStars ?? 0} stars`,
      onclick: () => { audio.play("select"); go(`/${m.id}/${i + 1}`); },
    }, h("div.n", String(i + 1)), stars(result?.bestStars ?? 0, 15))));
  }
  ui.replaceChildren(screen(m.paper,
    h("div.row", iconButton("arrowBack", "Back", back("/")),
      h("div.grow", h("div.marker", { style: { fontSize: "26px", lineHeight: "1.1" } }, m.title.toUpperCase()),
        h("div.mono.muted", { style: { fontSize: "13px" } }, `${cleared}/${count} cleared`)),
      swatch(m.preview[0], m.preview[1], m.swatch, 52)),
    count === 0 ? h("p.muted", "No levels yet.") : grid));
};

const play = (m: ModeInfo, index: number) => {
  const count = levelCount(m.id);
  stage.style.backgroundImage = `url(${art.url(m.paper)})`;
  game = new Game(ui, {
    mode: m, index, hasNext: index + 1 < count, exitLabel: "Back to levels",
    onExit: back(`/${m.id}`),
    onNext: () => go(`/${m.id}/${index + 2}`),
    onResult: (outcome) => {
      if (outcome.won) store.update((p) => record(p, m.id, levelID(m.id, index), outcome.stars, outcome.score));
    },
  });
};

const runnerHub = () => {
  audio.playMusic("runner");
  const el = screen("paper");
  ui.replaceChildren(el);
  showRunnerHub(el, { onBack: back("/"), onRun: () => go("/runner/play") });
};

/// One run of Crowd Run, at the level the store holds now. Retry replays this same run; Next
/// routes again, which starts the run after it.
const playRun = (m: ModeInfo) => {
  stage.style.backgroundImage = `url(${art.url(m.paper)})`;
  // A win is paid once. A retry after it replays the same track, and that must not pay again or skip a run.
  let paid = false;
  game = new Game(ui, {
    mode: m, index: store.progress.runner.level, hasNext: true, exitLabel: "Back",
    onExit: back("/runner"),
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
  const [, first, second] = location.hash.replace(/^#/, "").split("/");
  const m = findMode(first ?? "");
  if (first === "settings") settings();
  else if (m && m.id !== "runner" && second && +second >= 1 && +second <= levelCount(m.id)) play(m, +second - 1);
  else if (m && m.id !== "runner") levelSelect(m);
  else if (m && second === "play") playRun(m);
  else if (m) runnerHub();
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
// The menus are drawn in Permanent Marker; wait for it so the first screen does not reflow.
void Promise.all([document.fonts.load('16px "Permanent Marker"'), document.fonts.load('24px "Material Symbols Sharp"')]).finally(route);

// Offline play, on the deployed site only: a worker in the way of the dev server hides changes.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}
