// The reel on the home screen: a real level, played by a hand that picks its moves at random.
// The ads show a hand that fails on purpose. This one fails honestly, and now and then it wins,
// about as often as the number on the level's sticker says. Nothing here is recorded: the level
// is built, stepped and drawn as it is in a game, and a crop of it is copied into the card.
import { STEP } from "../sim/sk";
import { H, W, reducedMotion, type Scene } from "../scenes/kit";
import * as art from "./art";
import { h } from "./dom";
import { stageApp } from "./game";
import { levelLabel, levelName, levelStat, makeScene, mode as findMode } from "./modes";
import { oddsText } from "./odds";

/// The levels the reel shows: ones whose pieces all sit in the part of the room the card has room for.
const SHOWN: [mode: string, level: string][] = [
  ["pinPull", "the-door"], ["pinPull", "knock-first"], ["pinPull", "rocks-fall"],
  ["pinPull", "short-fuse"], ["pinPull", "one-tap"], ["pinPull", "doorman"],
];
/// The card's picture in CSS pixels, and the strip of the level it shows: all of its width, from
/// just under the floor up.
const VIEW_W = 232, VIEW_H = 196, FROM_Y = 36;
const SCALE = VIEW_W / W, SPAN = VIEW_H / SCALE;
/// Seconds between the hand's moves, and how long a result stays up before the next level.
const MOVE_EVERY = 1.5, FIRST_MOVE = 1.1, RESULT_HOLD = 2.2;

export interface Reel { el: HTMLElement; stop: () => void }

/// Start the reel. `open` is called with the mode and level on show when the card is tapped.
export const startReel = (open: (mode: string, level: string) => void): Reel => {
  const canvas = h<"canvas">("canvas", { width: VIEW_W * 2, height: VIEW_H * 2 });
  const hand = h("div.reel-hand");
  art.paint(hand, "hand_point", 34);
  const stamp = h("div.reel-stamp");
  const big = h("div.big"), small = h("div.small"), name = h("div.reel-name");
  const view = h("div.reel-view", canvas, hand, stamp);
  const el = art.frame(h<"button">("button.reel", { "aria-label": "A level played by a hand that picks at random. Open it." },
    view,
    h("div.reel-copy",
      h("div.reel-live", "LIVE: A RANDOM HAND"),
      h("div.sticker", big, small),
      name,
      h("div.reel-go", "You try"))));
  const ctx = canvas.getContext("2d")!;
  let scene: Scene | null = null, stopped = false, raf = 0, last = 0, acc = 0;
  let at = Math.floor(Math.random() * SHOWN.length), clock = 0, nextMove = FIRST_MOVE, doneAt = -1;
  el.onclick = () => open(...SHOWN[at]);

  const load = async () => {
    const [modeId, levelId] = SHOWN[at], m = findMode(modeId);
    const next = await makeScene(modeId, levelId, () => {});
    if (stopped) { next?.destroy(); return; }
    const app = await stageApp();
    scene?.destroy();
    app.stage.removeChildren();
    scene = next;
    if (!scene) return;
    app.stage.addChild(scene.root);
    clock = 0; nextMove = FIRST_MOVE; doneAt = -1; acc = 0;
    stamp.className = "reel-stamp";
    stamp.textContent = "";
    hand.style.opacity = "0";
    const stat = levelStat(modeId, levelId), words = stat && m?.kind === "levels" ? oddsText(stat, m.random) : null;
    big.textContent = words?.big ?? "";
    small.textContent = words?.small ?? "";
    big.className = `big ${words?.tone ?? ""}`;
    name.textContent = `${levelLabel(modeId, levelId)} ${levelName(modeId, levelId)}`;
  };

  const frame = async (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 0;
    last = now;
    if (!scene || document.hidden) return;
    const app = await stageApp();
    if (stopped || !scene) return;
    acc += dt;
    clock += dt;
    while (acc >= STEP) { scene.step(); acc -= STEP; }
    const outcome = scene.outcome();
    if (!outcome && clock >= nextMove) {
      nextMove = clock + MOVE_EVERY;
      const point = scene.randomPlay?.(Math.random);
      if (point) {
        scene.pointer?.("down", point);
        scene.pointer?.("up", point);
        // The hand comes down where the move was made, and lifts again.
        const x = Math.min(VIEW_W - 8, Math.max(8, point.x * SCALE)), y = VIEW_H - (point.y - FROM_Y) * SCALE;
        hand.style.transform = `translate(${x}px, ${y}px)`;
        hand.style.opacity = "1";
        setTimeout(() => { hand.style.opacity = "0"; }, 600);
      }
    }
    if (outcome && doneAt < 0) {
      doneAt = clock;
      stamp.textContent = outcome.won ? "CLEARED" : "FAIL";
      stamp.className = `reel-stamp on ${outcome.won ? "cleared" : "fail"}`;
    }
    scene.draw(dt);
    app.renderer.render(app.stage);
    // The strip of the stage that holds the level's pieces, copied while this frame's picture is still there.
    const k = app.canvas.height / H;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(app.canvas, 0, (H - FROM_Y - SPAN) * k, W * k, SPAN * k, 0, 0, canvas.width, canvas.height);
    if (doneAt >= 0 && clock - doneAt >= (reducedMotion() ? RESULT_HOLD * 2 : RESULT_HOLD)) {
      at = (at + 1) % SHOWN.length;
      const done = scene;
      scene = null;
      done.destroy();
      void load();
    }
  };

  void load().then(() => { raf = requestAnimationFrame(frame); });
  return {
    el,
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      scene?.destroy();
      scene = null;
      void stageApp().then((app) => { app.stage.removeChildren(); app.renderer.render(app.stage); });
    },
  };
};
