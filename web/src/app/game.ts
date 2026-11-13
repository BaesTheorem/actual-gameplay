// The host for one game: the canvas, the HUD above it, and the result card.
import { Application } from "pixi.js";
import type { Cue } from "../sim/clock";
import { STEP, type Outcome } from "../sim/sk";
import { H, W, type Scene } from "../scenes/kit";
import * as art from "./art";
import * as audio from "./audio";
import { button, h, iconButton, stars } from "./dom";
import { makeScene, type ModeInfo } from "./modes";

let app: Application | null = null;
let stageScale = 1;

/// The one canvas, made when the first game opens.
const renderer = async () => {
  if (app) return app;
  app = new Application();
  await app.init({
    width: W, height: H, backgroundAlpha: 0, antialias: true, preference: "webgl",
    resolution: Math.min(3, Math.max(1, devicePixelRatio * stageScale)), autoDensity: false,
  });
  document.getElementById("scene")!.append(app.canvas);
  app.ticker.stop();
  return app;
};

/// The stage was resized: keep the canvas sharp at the new scale.
export const setStageScale = (scale: number) => {
  stageScale = scale;
  // The renderer does not exist until init has finished; it reads stageScale when it does.
  if (!app?.renderer) return;
  app.renderer.resolution = Math.min(3, Math.max(1, devicePixelRatio * scale));
  app.renderer.resize(W, H);
};

export interface GameOptions {
  mode: ModeInfo;
  index: number;
  hasNext: boolean;
  exitLabel: string;
  onExit: () => void;
  onNext: () => void;
  onResult: (outcome: Outcome) => void;
}

export class Game {
  private scene: Scene | null = null;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private reported = false;
  private closed = false;
  private readonly hud = h("div.hud");
  private readonly titleEl = h("div.t");
  private readonly readoutEl = h("div.r");
  private readonly progressEl = h("div.progress", { style: { display: "none" } }, h("i"));
  private resultEl: HTMLElement | null = null;
  private lastReadout = "";

  constructor(private ui: HTMLElement, private opts: GameOptions) {
    const info = art.frame(h("div.info", this.titleEl, this.readoutEl));
    this.hud.append(
      h("div.bar", iconButton("arrowBack", "Back", opts.onExit), info, iconButton("refresh", "Restart", () => void this.reset())),
      this.progressEl,
    );
    (this.progressEl.firstChild as HTMLElement).style.background = opts.mode.accent;
    ui.replaceChildren(this.hud, h("div.loading", "…"));
    audio.playMusic(opts.mode.track);
    void this.reset();
  }

  /// Build the level again from nothing.
  async reset() {
    const pixi = await renderer();
    const cue = (c: Cue) => {
      if (c.type === "sound") audio.play(c.name);
      else if (c.type === "haptic") audio.haptic(c.name);
      else if (c.type === "loop") { if (c.on) audio.startLoop(c.name, c.volume); else audio.stopLoop(c.name); }
    };
    const next = await makeScene(this.opts.mode.id, this.opts.index, cue);
    if (this.closed) { next?.destroy(); return; }
    audio.stopAllLoops();
    this.scene?.destroy();
    pixi.stage.removeChildren();
    this.resultEl?.remove();
    this.resultEl = null;
    this.ui.querySelector(".loading")?.remove();
    this.scene = next;
    this.reported = false;
    this.acc = 0;
    this.last = 0;
    if (!next) { this.titleEl.textContent = "Coming soon"; return; }
    pixi.stage.addChild(next.root);
    this.titleEl.textContent = next.title;
    pixi.canvas.onpointerdown = (e) => { audio.unlock(); pixi.canvas.setPointerCapture(e.pointerId); this.pointer("down", e); };
    pixi.canvas.onpointermove = (e) => this.pointer("move", e);
    pixi.canvas.onpointerup = pixi.canvas.onpointercancel = (e) => this.pointer("up", e);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
  }

  private pointer(type: "down" | "move" | "up", e: PointerEvent) {
    if (!this.scene?.pointer || !app) return;
    const r = app.canvas.getBoundingClientRect();
    this.scene.pointer(type, { x: ((e.clientX - r.left) / r.width) * W, y: H - ((e.clientY - r.top) / r.height) * H });
    e.preventDefault();
  }

  private frame = (now: number) => {
    if (this.closed || !this.scene || !app) return;
    this.raf = requestAnimationFrame(this.frame);
    // A hitch or a return from the background never produces a huge step.
    const dt = this.last ? Math.min((now - this.last) / 1000, 1 / 20) : 0;
    this.last = now;
    if (document.hidden) return;
    this.acc += dt;
    while (this.acc >= STEP) {
      this.scene.step();
      this.acc -= STEP;
    }
    this.scene.draw(dt);
    app.renderer.render(app.stage);
    const readout = this.scene.readout();
    if (readout !== this.lastReadout) { this.lastReadout = readout; this.readoutEl.textContent = readout; }
    const progress = this.scene.progress();
    this.progressEl.style.display = progress === null ? "none" : "";
    if (progress !== null) (this.progressEl.firstChild as HTMLElement).style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
    const outcome = this.scene.outcome();
    if (outcome && !this.reported) {
      this.reported = true;
      audio.stopAllLoops();
      this.opts.onResult(outcome);
      this.showResult(outcome);
    }
  };

  private showResult(outcome: Outcome) {
    const { mode, hasNext } = this.opts;
    const hard = mode.id === "pinPull";
    const card = art.frame(h("div.card"));
    // The clip frames keep headroom for emotes; the negative margin lets it overlap the card's edge.
    const figure = art.clip(outcome.won ? (hard ? "clawd_hard_excited" : "clawd_excited") : (hard ? "clawd_hard_ko" : "clawd_ko"), 124);
    figure.style.marginTop = "-18px";
    card.append(figure);
    if (outcome.won) {
      card.append(h("h1", "CLEARED"), stars(outcome.stars, 40),
        h("div.mono.muted", { style: { fontSize: "14px" } }, `${mode.scoreLabel} ${Math.round(outcome.score)}`));
      if (outcome.coins > 0) {
        const coin = h("div");
        art.paint(coin, "coin_gold", 22);
        card.append(h("div.row", { style: { gap: "6px" }, "aria-label": `${outcome.coins} coins` }, coin, h("span.marker", { style: { fontSize: "18px" } }, `+${outcome.coins}`)));
      }
    } else {
      card.append(h("h1", "NOPE"), h("div.muted", { style: { fontSize: "15px" } }, outcome.reason));
    }
    // Clay marks the obvious next step: Next after a win, Retry after a loss, Back after the last level.
    const next = outcome.won && hasNext;
    const row = h("div.row", { style: { gap: "10px" } }, button("Retry", () => void this.reset(), { filled: !outcome.won }));
    if (next) row.append(button("Next", this.opts.onNext, { filled: true }));
    card.append(h("div.buttons", row, button(this.opts.exitLabel, this.opts.onExit, { filled: outcome.won && !hasNext })));
    this.resultEl = h("div.result", card);
    this.ui.append(this.resultEl);
  }

  close() {
    this.closed = true;
    cancelAnimationFrame(this.raf);
    audio.stopAllLoops();
    this.scene?.destroy();
    this.scene = null;
    app?.stage.removeChildren();
    if (app) app.renderer.render(app.stage);
  }
}
