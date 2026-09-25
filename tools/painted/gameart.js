// gameart.js: every painted asset the game uses, drawn with the animation kit (Clawd, props, tiles, UI pieces),
// rendered by render.mjs into ActualGameplay/Art/painted/. Each asset is a pure function of time, like a kit shot.
//
//   ASSETS[name] = { box: [x, y, w, h] (canvas px to crop), frames, len (seconds the frames span), fps (playback),
//                    anchor: [ax, ay] (SpriteKit anchor point, y up), paper: true to keep the paper and grain,
//                    draw(t) }
//
// Characters share one frame size (400 x 360 px at u = 20, ground 40 px above the bottom edge), so every
// animation of a character lines up on the same anchor. The boss is bigger and gets its own box.
(() => {
  const CX = 960, GY = 900;                    // where characters stand on the canvas
  const CHAR = { box: [CX - 200, GY - 320, 400, 360], anchor: [0.5, 40 / 360] };
  const BOSS = { box: [CX - 300, GY - 480, 600, 540], anchor: [0.5, 60 / 540] };
  const BAR = 4 * BEAT;                        // one bar at the sprite tempo; every beat-locked idle repeats on it
  window.ASSETS = {};
  const add = (name, spec) => { window.ASSETS[name] = spec; };
  const character = (name, frames, len, fps, pose, u = 20, box = CHAR) =>
    add(name, { ...box, frames, len, fps, draw: t => clawd(CX, GY, u, { noShadow: true, boilKey: name, ...pose(t) }) });

  // A run that loops in exactly `P` seconds: one stride per loop, two footfalls, arms opposite the legs, a lean.
  const run = (P, extra = {}) => t => ({
    view: 'q', walk: t / P, dy: -1.0 * Math.abs(Math.sin(TAU * t / P)), sq: 0.04 * Math.max(0, Math.cos(TAU * 2 * t / P)),
    aL: 0.8 * Math.sin(TAU * t / P), aR: -0.8 * Math.sin(TAU * t / P), rot: -0.08, eyes: 'determined', ...extra,
  });

  // ---------- Clawd, the lead in all three modes ----------
  character('clawd_idle', 16, BAR, 16 / BAR, t => feel('neutral', t));
  character('clawd_happy', 16, BAR, 16 / BAR, t => feel('happy', t));
  character('clawd_excited', 12, 2 * BEAT, 12 / (2 * BEAT), t => feel('excited', t));
  character('clawd_nervous', 12, BAR, 12 / BAR, t => feel('nervous', t));
  character('clawd_scared', 12, 2 * BEAT, 12 / (2 * BEAT), t => feel('scared', t));
  character('clawd_sad', 8, BAR, 8 / BAR, t => feel('sad', t));
  character('clawd_ko', 8, BAR, 8 / BAR, t => feel('ko', t));
  character('clawd_determined', 8, BAR, 8 / BAR, t => feel('determined', t));
  character('clawd_run', 12, 0.5, 24, run(0.5));
  // the miner: the Pull the Pin hero wears a hard hat
  character('clawd_hard_idle', 16, BAR, 16 / BAR, t => ({ ...feel('neutral', t), hat: 'hard' }));
  character('clawd_hard_excited', 12, 2 * BEAT, 12 / (2 * BEAT), t => ({ ...feel('excited', t), hat: 'hard' }));
  character('clawd_hard_ko', 8, BAR, 8 / BAR, t => ({ ...feel('ko', t), hat: 'hard' }));
  // the other crowd, and the boss
  character('clawd_foe_run', 12, 0.5, 24, run(0.5, { tint: '#6F5AA0', tintK: 0.85, eyes: 'angry', mouth: 'teeth' }));
  character('clawd_boss_idle', 12, 2 * BEAT, 12 / (2 * BEAT), t => ({ ...feel('furious', t), tint: '#6F5AA0', tintK: 0.5 }), 30, BOSS);
  character('clawd_boss_hit', 8, BAR, 8 / BAR, t => ({ ...feel('dizzy', t), tint: '#6F5AA0', tintK: 0.5 }), 30, BOSS);

  // ---------- painting helpers for props ----------
  const at = (x, y, f) => { push(); translate(x, y); f(); pop(); };
  const P = (pts, s = 1) => pts.map(([a, b]) => [a * s, b * s]);
  const CENTRE = (w, h) => ({ box: [CX - w / 2, 540 - h / 2, w, h], anchor: [0.5, 0.5] });
  const FOOT = (w, h) => ({ box: [CX - w / 2, 540 - h + 20, w, h], anchor: [0.5, 20 / h] });   // ground at y = 540
  // stills paint around the crop's centre: (0, 0) is canvas (CX, 540), so a FOOT box has its ground line at y = 0
  const still = (name, spec, draw) => add(name, { ...spec, frames: 1, len: 1, fps: 1, draw: t => at(CX, 540, () => draw(t)) });
  const STONE = '#8D8AA3', STONE_DK = '#5E5B78', DIRT = '#A86F4C', DIRT_DK = '#7A4B31', PURPLE = '#7B5CA8', PURPLE_DK = '#4E3A73';

  // ---------- bees ----------
  const bee = (t, wing) => {
    boilSeed('bee');
    const s = 22;   // body half-length in px
    // wings first (behind the body): two cream petals, up or down
    const flap = wing < 0 ? 0 : (wing === 0 ? 0.45 : -0.55);
    for (const k of [-1, 1]) at(-4 + k * 6, -14, () => { rotate(flap * (k < 0 ? 1.1 : 0.8)); paint(ellPts(0, -14, 10, 16, 16, 1), { wash: PAL.cream, washOp: 200, fill: PAL.sky, fillOp: 40, bleed: 0.1, ink: PAL.ink, sw: 0.7, curv: 0.3 }); });
    paint(ellPts(0, 0, s, 15, 22, 1.2), { wash: PAL.ochre, fill: '#C88A1E', fillOp: 70, tex: 0.6, ink: PAL.ink, sw: 1.1 });
    for (const sx of [-9, 1, 10]) paint(P([[sx - 3, -13], [sx + 3, -13], [sx + 4, 13], [sx - 2, 13]]), { wash: PAL.ink, washOp: 235, ink: null });
    paint(ellPts(19, -1, 8, 8, 14, 0.8), { wash: PAL.ink, ink: null });                        // head
    paint(ellPts(21, -3, 2, 2.4, 8), { wash: PAL.cream, ink: null });                              // eye glint
    paint(P([[-21, -3], [-31, 0], [-21, 3]]), { wash: PAL.ink, ink: null });                      // stinger
    for (const k of [-1, 1]) inkLine([[20, -8], [24 + k * 4, -17]], 0.8, PAL.ink, 'inkfine', 0.3);   // antennae
  };
  still('bee_a', CENTRE(96, 96), t => bee(t, 0));
  still('bee_b', CENTRE(96, 96), t => bee(t, 1));
  still('bee_rest', CENTRE(96, 96), t => bee(t, -1));

  // ---------- props ----------
  still('saw_a', CENTRE(160, 160), t => saw(0));
  still('saw_b', CENTRE(160, 160), t => saw(Math.PI / 12));
  function saw(rot) {
    boilSeed('saw'); const n = 12, pts = [];
    for (let i = 0; i < n; i++) { const a = rot + i / n * TAU, b = a + TAU / n * 0.32; pts.push([Math.cos(a) * 50, Math.sin(a) * 50], [Math.cos(b) * 76, Math.sin(b) * 76]); }
    paint(pts, { wash: '#B9B4C9', fill: STONE_DK, fillOp: 80, tex: 0.6, ink: PAL.ink, sw: 1.3 });
    paint(ellPts(0, 0, 18, 18, 18, 0.6), { wash: STONE_DK, ink: PAL.ink, sw: 1 });
    paint(ellPts(0, 0, 6, 6, 10), { wash: PAL.ink, ink: null });
  }
  still('spikes', { box: [CX - 48, 540 - 96, 96, 96], anchor: [0.5, 0] }, t => {
    boilSeed('spikes');
    for (let i = 0; i < 3; i++) { const x = -32 + i * 32; paint([[x - 15, 0], [x + 15, 0], [x + jit(1.5), -46 - 8 * hash(i)]], { wash: '#D9D4E4', fill: STONE_DK, fillOp: 90, ink: PAL.ink, sw: 1.1 }); }
  });
  const gem = col => t => {
    boilSeed('gem');
    paint(P([[-38, -8], [-18, -30], [18, -30], [38, -8], [0, 34]]), { wash: col, fill: mixCol(col, PAL.ink, 0.35), fillOp: 90, tex: 0.5, ink: PAL.ink, sw: 1.4 });
    inkLine([[-38, -8], [38, -8]], 0.8, PAL.ink, 'inkfine', 0); inkLine([[-18, -30], [-8, -8], [0, 34]], 0.7, PAL.ink, 'inkfine', 0); inkLine([[18, -30], [8, -8]], 0.7, PAL.ink, 'inkfine', 0);
    paint(P([[-26, -24], [-16, -27], [-12, -14]]), { wash: PAL.cream, washOp: 220, ink: null });
  };
  still('gem_yellow', CENTRE(96, 96), gem(PAL.ochre));
  still('gem_blue', CENTRE(96, 96), gem(PAL.sky));
  still('coin_gold', CENTRE(96, 96), t => {
    boilSeed('coin');
    paint(ellPts(0, 0, 36, 36, 24, 0.8), { wash: PAL.ochre, fill: '#C88A1E', fillOp: 70, ink: PAL.ink, sw: 1.4 });
    paint(ellPts(0, 0, 24, 24, 20, 0.6), { fill: '#C88A1E', fillOp: 90, bleed: 0.05, ink: PAL.ink, sw: 0.7 });
    paint(ellPts(-10, -12, 6, 4, 10, 0, -0.6), { wash: PAL.cream, washOp: 200, ink: null });
  });
  still('sign_exit', FOOT(128, 128), t => {
    boilSeed('sign');
    paint(rectPts(-5, -60, 10, 62, 1), { wash: DIRT_DK, ink: PAL.ink, sw: 1 });
    paint(P([[-50, -100], [30, -100], [50, -78], [30, -56], [-50, -56]]), { wash: DIRT, fill: DIRT_DK, fillOp: 60, tex: 0.6, ink: PAL.ink, sw: 1.3 });
    for (const y of [-89, -67]) inkLine([[-46, y], [26, y]], 0.5, DIRT_DK, 'inkfine', 0);
    inkLine([[-36, -78], [22, -78]], 3, PAL.cream, 'ink', 0); inkLine([[8, -90], [26, -78], [8, -66]], 3, PAL.cream, 'ink', 0.2);   // an arrow, not a word
  });
  const flag = k => t => {
    boilSeed('flag');
    paint(rectPts(-3, -110, 6, 112, 0.8), { wash: DIRT_DK, ink: PAL.ink, sw: 0.9 });
    const w = 6 * k, pts = [[3, -110], [56, -92 + w], [3, -74]];
    paint(pts, { wash: PAL.sap, fill: '#4E7A3C', fillOp: 70, tex: 0.6, ink: PAL.ink, sw: 1.2, curv: 0.2 });
    paint(ellPts(0, -112, 6, 6, 10), { wash: PAL.ochre, ink: PAL.ink, sw: 0.8 });
  };
  still('flag_green_a', FOOT(128, 128), flag(-1));
  still('flag_green_b', FOOT(128, 128), flag(1));
  const torch = k => t => {
    boilSeed('torch');
    paint(rectPts(-5, -70, 10, 72, 0.8), { wash: DIRT_DK, ink: PAL.ink, sw: 0.9 });
    paint(rectPts(-9, -84, 18, 16, 1), { wash: DIRT, ink: PAL.ink, sw: 0.9 });
    const f = [[-14, -84], [-6, -104 - 6 * k], [0, -96], [6, -112 + 6 * k], [14, -84]];
    paint(f, { wash: PAL.ochre, fill: PAL.clay, fillOp: 90, bleed: 0.15, ink: PAL.ink, sw: 0.9, curv: 0.5 });
    paint([[-6, -84], [-2, -96 - 3 * k], [3, -90], [6, -84]], { wash: PAL.cream, ink: null, curv: 0.5 });
  };
  still('torch_on_a', FOOT(96, 128), torch(-1));
  still('torch_on_b', FOOT(96, 128), torch(1));
  still('rock', CENTRE(128, 128), t => {
    boilSeed('rock');
    paint(P([[-52, 20], [-46, -20], [-18, -46], [26, -48], [50, -14], [46, 30], [10, 48], [-34, 44]]), { wash: STONE, fill: STONE_DK, fillOp: 80, tex: 0.7, bleed: 0.05, ink: PAL.ink, sw: 1.4, curv: 0.35,
      hatch: { d: 9, a: 0.6, o: { rand: 0.3, gradient: 0.6 }, b: 'charcoal', c: STONE_DK, w: 0.5 } });
    inkLine([[-20, -30], [-6, -6], [-14, 18]], 0.7, STONE_DK, 'inkfine', 0.4);
  });
  still('bush', { box: [CX - 64, 540 - 88, 128, 96], anchor: [0.5, 8 / 96] }, t => {
    boilSeed('bush'); const pts = [];
    for (let i = 0; i < 30; i++) { const a = i / 30 * TAU, r = 1 + 0.16 * Math.abs(Math.sin(a * 4)); pts.push([Math.cos(a) * 58 * r, -30 + Math.sin(a) * (Math.sin(a) < 0 ? 34 : 24) * r]); }
    paint(pts, { wash: PAL.sap, fill: '#4E7A3C', fillOp: 80, tex: 0.7, bleed: 0.08, ink: PAL.ink, sw: 1.2, curv: 0.6 });
    for (let i = 0; i < 4; i++) paint(ellPts(-30 + i * 20 + jit(4), -40 + 10 * hash(i), 4, 4, 8), { wash: PAL.rose, ink: null });
  });
  still('mushroom_red', FOOT(96, 96), t => {
    boilSeed('mush');
    paint(rectPts(-11, -34, 22, 36, 1), { wash: PAL.cream, fill: DIRT, fillOp: 40, ink: PAL.ink, sw: 1 });
    paint(ellPts(0, -36, 40, 20, 22, 1, 0), { wash: '#D8394E', fill: '#9E2436', fillOp: 70, tex: 0.6, ink: PAL.ink, sw: 1.2 });
    for (const [x, y, r] of [[-18, -40, 5], [4, -46, 6], [22, -36, 4]]) paint(ellPts(x, y, r, r * 0.8, 10), { wash: PAL.cream, ink: null });
  });
  still('bomb', CENTRE(96, 96), t => {
    boilSeed('bomb');
    paint(ellPts(0, 6, 32, 32, 22, 0.8), { wash: '#3A3247', fill: PAL.ink, fillOp: 90, ink: PAL.ink, sw: 1.2 });
    paint(rectPts(-8, -34, 16, 12, 0.6), { wash: STONE_DK, ink: PAL.ink, sw: 0.8 });
    inkLine([[0, -34], [6, -44], [16, -46]], 1.4, DIRT_DK, 'ink', 0.5);
    paint(starPts(18, -47, 8, 0.45, 6), { wash: PAL.ochre, ink: null });
    paint(ellPts(-12, -8, 7, 5, 10, 0, -0.7), { wash: PAL.cream, washOp: 120, ink: null });
  });
  still('block_planks', CENTRE(96, 96), t => {
    boilSeed('planks');
    paint(rectPts(-50, -50, 100, 100, 1), { wash: DIRT, fill: DIRT_DK, fillOp: 55, tex: 0.6, ink: PAL.ink, sw: 1.3 });
    for (const y of [-17, 17]) inkLine([[-48, y + jit(1)], [48, y + jit(1)]], 0.8, DIRT_DK, 'inkfine', 0);
    for (const [x, y] of [[-36, -34], [36, -34], [-36, 0], [36, 0], [-36, 34], [36, 34]]) paint(ellPts(x, y, 2.5, 2.5, 8), { wash: PAL.ink, ink: null });
  });
  still('block_danger', CENTRE(96, 96), t => {
    boilSeed('danger');
    paint(rectPts(-50, -50, 100, 100, 1), { wash: PAL.ochre, fill: '#C88A1E', fillOp: 50, tex: 0.5, ink: PAL.ink, sw: 1.3 });
    for (let i = -2; i <= 2; i++) paint(P([[-50 + i * 34, 50], [-50 + i * 34 + 16, 50], [-50 + i * 34 + 116, -50], [-50 + i * 34 + 100, -50]]), { wash: PAL.ink, washOp: 230, ink: null });
  });

  // ---------- backdrop pieces (they sit on the paper, so they carry no paper themselves) ----------
  const cloud = (seed, w) => t => {
    boilSeed('cloud' + seed); const pts = [];
    for (let i = 0; i < 44; i++) { const a = i / 44 * TAU, up = Math.sin(a) < 0, r = up ? 1 + 0.3 * Math.pow(Math.abs(Math.sin(a * (2.5 + seed * 0.5) + seed)), 0.7) : 1; pts.push([Math.cos(a) * w * 0.46 * (up ? r * 0.95 : 1), Math.sin(a) * (up ? 40 : 18) * r]); }
    paint(pts, { wash: PAL.cream, washOp: 245, fill: PAL.sky, fillOp: 35, bleed: 0.12, ink: mixCol(PAL.ink, PAL.paper, 0.35), sw: 0.9, curv: 0.5 });
  };
  still('cloud_1', CENTRE(320, 160), cloud(1, 230));
  still('cloud_2', CENTRE(320, 160), cloud(2, 200));
  still('cloud_3', CENTRE(320, 160), cloud(3, 250));
  // rolling hills for the bottom of a portrait scene: 1206 x 780 px (402 x 260 pt at 3x), anchored bottom-centre
  still('background_color_hills', { box: [CX - 603, 1080 - 780, 1206, 780], anchor: [0.5, 0] }, t => {
    boilSeed('hills');
    const hill = (cx, cy, rx, ry, col, op) => paint(ellPts(cx, cy, rx, ry, 40, 6), { wash: col, washOp: op, ink: null });
    hill(-380, 580, 620, 330, mixCol(PAL.sap, PAL.sky, 0.55), 200);
    hill(420, 600, 700, 300, mixCol(PAL.sap, PAL.sky, 0.45), 210);
    hill(40, 630, 760, 250, mixCol(PAL.sap, PAL.teal, 0.25), 235);
    for (let i = 0; i < 9; i++) { const x = -560 + i * 140 + 30 * hash(i), y = 420 - 60 * hash(i + 3); inkLine([[x, y], [x + 24, y - 6 + jit(2)]], 0.7, mixCol(PAL.sap, PAL.ink, 0.5), 'inkfine', 0.4); }
  });

  // ---------- terrain tiles: 9 parts x 4 skins, 96 px, painted oversize so grids never show a gap ----------
  const SKINS = {
    grass: { top: PAL.sap, topDk: '#4E7A3C', body: DIRT, bodyDk: DIRT_DK },
    dirt: { top: DIRT, topDk: DIRT_DK, body: DIRT, bodyDk: DIRT_DK },
    stone: { top: STONE, topDk: STONE_DK, body: STONE, bodyDk: STONE_DK },
    purple: { top: PURPLE, topDk: PURPLE_DK, body: PURPLE, bodyDk: PURPLE_DK },
  };
  const PARTS = {   // which edges are outside edges: [top, left, right, bottom]
    block_center: [0, 0, 0, 0], block_top: [1, 0, 0, 0], block_top_left: [1, 1, 0, 0], block_top_right: [1, 0, 1, 0],
    block_left: [0, 1, 0, 0], block_right: [0, 0, 1, 0],
    horizontal_left: [1, 1, 0, 1], horizontal_middle: [1, 0, 0, 1], horizontal_right: [1, 0, 1, 1],
  };
  for (const [skin, c] of Object.entries(SKINS)) for (const [part, [top, left, right, bottom]] of Object.entries(PARTS)) {
    still(`terrain_${skin}_${part}`, CENTRE(96, 96), t => {
      boilSeed(skin + part); const h = 48;
      paint(rectPts(-h - 6, -h - 6, 2 * h + 12, 2 * h + 12), { wash: c.body, ink: null });
      if (skin === 'stone' || skin === 'purple') paint(rectPts(-h - 6, -h - 6, 2 * h + 12, 2 * h + 12), { fill: c.bodyDk, fillOp: 45, tex: 0.8, bleed: 0.02, ink: null, hatch: { d: 12, a: 0.55, o: { rand: 0.5, gradient: 0.2 }, b: 'charcoal', c: c.bodyDk, w: 0.45 } });
      else paint(rectPts(-h - 6, -h - 6, 2 * h + 12, 2 * h + 12), { fill: c.bodyDk, fillOp: 40, tex: 0.7, bleed: 0.02, ink: null });
      if (top) {   // a band of the top colour with a cream lip and the ink line
        if (skin === 'grass') paint([[-h - 6, -h - 6], [h + 6, -h - 6], [h + 6, -h + 22], [h - 10, -h + 30], [h - 30, -h + 24], [-h + 20, -h + 32], [-h - 6, -h + 24]], { wash: c.top, fill: c.topDk, fillOp: 60, tex: 0.6, ink: null, curv: 0.3 });
        inkLine([[-h - 6, -h + 1 + jit(0.8)], [0, -h + jit(1)], [h + 6, -h + 1 + jit(0.8)]], 2.2, PAL.ink, 'ink', 0.2);
        inkLine([[-h - 6, -h + 5], [h + 6, -h + 5]], 1.2, PAL.cream, 'inkfine', 0);
      }
      // three points per edge line: a two-point 'ink' stroke this short comes out empty
      if (bottom) inkLine([[-h - 6, h - 2 + jit(0.8)], [0, h - 2 + jit(1)], [h + 6, h - 2 + jit(0.8)]], 2.2, PAL.ink, 'ink', 0.2);
      if (left) inkLine([[-h + 2 + jit(0.8), -h - 6], [-h + 2 + jit(1), 0], [-h + 2 + jit(0.8), h + 6]], 2.2, PAL.ink, 'ink', 0.2);
      if (right) inkLine([[h - 2 + jit(0.8), -h - 6], [h - 2 + jit(1), 0], [h - 2 + jit(0.8), h + 6]], 2.2, PAL.ink, 'ink', 0.2);
      if (!top && !bottom && !left && !right && (skin === 'stone' || skin === 'purple')) {   // mortar lines inside a wall
        inkLine([[-h - 6, 0 + jit(1)], [h + 6, 0 + jit(1)]], 0.7, c.bodyDk, 'inkfine', 0.2);
        inkLine([[-14 + jit(1), -h - 6], [-14 + jit(1), 0]], 0.7, c.bodyDk, 'inkfine', 0); inkLine([[18 + jit(1), 0], [18 + jit(1), h + 6]], 0.7, c.bodyDk, 'inkfine', 0);
      }
    });
  }

  // ---------- UI pieces (9-slice frames, stars, the pin knob) ----------
  const frame9 = (name, w, h, wash, ink, fill, fillOp) => still(name, CENTRE(w, h), t => {
    boilSeed(name);
    paint(rrPts(-w / 2 + 6, -h / 2 + 6, w - 12, h - 12, 16, 1.2), { wash, washOp: 255, ink, sw: 1.8 });
    paint(rrPts(-w / 2 + 14, -h / 2 + 14, w - 28, h - 28, 12, 1), { fill, fillOp, tex: 0.5, bleed: 0.0, ink: null });
  });
  frame9('ui_card', 192, 192, '#FBF4E6', PAL.ink, PAL.ochre, 14);
  frame9('ui_card_dark', 192, 192, '#2F2A44', mixCol(PAL.ink, PAL.paper, 0.2), PAL.indigo, 60);
  frame9('ui_button_clay', 192, 96, PAL.clay, PAL.ink, PAL.clayDk, 60);
  frame9('ui_button_sap', 192, 96, PAL.sap, PAL.ink, '#4E7A3C', 60);
  frame9('ui_button_sky', 192, 96, PAL.sky, PAL.ink, PAL.indigo, 40);
  frame9('ui_button_rose', 192, 96, PAL.rose, PAL.ink, '#E2476E', 50);
  frame9('ui_button_ink', 192, 96, PAL.ink, PAL.ink, PAL.night, 40);
  frame9('ui_button_paper', 192, 96, '#FBF4E6', PAL.ink, PAL.ochre, 10);
  still('ui_star_on', CENTRE(128, 128), t => { boilSeed('star'); paint(starPts(0, 4, 52, 0.46, 5), { wash: PAL.ochre, fill: '#C88A1E', fillOp: 70, ink: PAL.ink, sw: 1.6 }); paint(ellPts(-14, -14, 7, 5, 10, 0, -0.6), { wash: PAL.cream, washOp: 200, ink: null }); });
  still('ui_star_off', CENTRE(128, 128), t => { boilSeed('star'); paint(starPts(0, 4, 52, 0.46, 5), { wash: mixCol(PAL.paper, PAL.ink, 0.12), fill: PAL.ink, fillOp: 20, ink: mixCol(PAL.ink, PAL.paper, 0.4), sw: 1.4 }); });
  still('pin_knob', CENTRE(96, 96), t => { boilSeed('knob'); paint(ellPts(0, 0, 34, 34, 22, 0.8), { wash: PAL.cream, fill: PAL.ochre, fillOp: 30, ink: PAL.ink, sw: 1.6 }); paint(ellPts(0, 0, 11, 11, 14), { wash: PAL.clay, ink: PAL.ink, sw: 0.8 }); });
  still('ui_hive', CENTRE(128, 128), t => {   // where the bees come from
    boilSeed('hive');
    for (let i = 0; i < 4; i++) paint(ellPts(0, -26 + i * 16, 40 - Math.abs(i - 1.5) * 9, 12, 20, 1), { wash: PAL.ochre, fill: '#C88A1E', fillOp: 70, tex: 0.6, ink: PAL.ink, sw: 1.2 });
    paint(ellPts(0, 14, 9, 9, 12), { wash: PAL.ink, ink: null });
  });

  // ---------- paper (kept in paper mode: these ARE the background) ----------
  add('paper', { box: [0, 0, 1920, 1080], anchor: [0.5, 0.5], frames: 1, len: 1, fps: 1, paper: true, draw: t => {} });
  add('paper_cave', { box: [0, 0, 1920, 1080], anchor: [0.5, 0.5], frames: 1, len: 1, fps: 1, paper: true, draw: t => {
    boilSeed('cave');
    paint(rectPts(-100, -100, W + 200, H + 200), { fill: PAL.indigo, fillOp: 95, bleed: 0.02, tex: 0.5, ink: null });
    paint(rectPts(-100, -100, W + 200, H + 200), { fill: PAL.night, fillOp: 60, bleed: 0.02, tex: 0.6, ink: null });
  } });
  // the app icon: a happy Clawd on paper with an ink frame, 1080 square (resized to 1024 by the script)
  add('icon', { box: [CX - 540, 0, 1080, 1080], anchor: [0.5, 0.5], frames: 1, len: 1, fps: 1, paper: true, draw: t => {
    boilSeed('icon');
    paint(rectPts(CX - 540, 0, 1080, 1080), { fill: PAL.sky, fillOp: 70, bleed: 0.05, tex: 0.5, ink: null });
    paint(ellPts(CX, 640, 430, 300, 40, 8), { fill: PAL.sap, fillOp: 90, bleed: 0.2, tex: 0.6, ink: null });
    clawd(CX, 930, 58, { ...feel('happy', 0.2), boilKey: 'icon' });
    paint(rrPts(CX - 540 + 28, 28, 1080 - 56, 1080 - 56, 90, 3), { ink: PAL.ink, sw: 4 });
  } });

  // ---------- the render hook ----------
  window.renderAsset = async (name, i) => {
    const a = window.ASSETS[name], t = a.frames > 1 ? (i / a.frames) * a.len : 0.35;
    window.LOOP = a.draw; window.LOOP.len = a.len;
    const [x, y, w, h] = a.box;
    return window.renderCrop(t, x, y, w, h, w, h, !a.paper);
  };
})();
