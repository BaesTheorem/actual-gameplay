// gameart.js: every painted asset the game uses, drawn with the animation kit (Clawd, props, tiles, UI pieces),
// rendered by render.mjs into ActualGameplay/Art/painted/. Each asset is a pure function of time, like a kit shot.
//
//   ASSETS[name] = { box: [x, y, w, h] (canvas px to crop), frames, len (seconds the frames span), fps (playback),
//                    anchor: [ax, ay] (SpriteKit anchor point, y up), paper: true to keep the paper and grain,
//                    noBleed: true to cut watercolour that bleeds past the flat paint (see the render hook), draw(t) }
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
  character('clawd_foe_idle', 12, BAR, 12 / BAR, t => ({ ...feel('angry', t), tint: '#6F5AA0', tintK: 0.85 }));
  character('clawd_foe_ko', 8, BAR, 8 / BAR, t => ({ ...feel('dizzy', t), tint: '#6F5AA0', tintK: 0.85 }));
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

  // ---------- terrain tiles: 9 parts x 5 skins, 96 px, painted oversize so grids never show a gap ----------
  const SKINS = {
    grass: { top: PAL.sap, topDk: '#4E7A3C', body: DIRT, bodyDk: DIRT_DK },
    dirt: { top: DIRT, topDk: DIRT_DK, body: DIRT, bodyDk: DIRT_DK },
    stone: { top: STONE, topDk: STONE_DK, body: STONE, bodyDk: STONE_DK },
    purple: { top: PURPLE, topDk: PURPLE_DK, body: PURPLE, bodyDk: PURPLE_DK },
    ice: { top: PAL.cream, topDk: PAL.sky, body: mixCol(PAL.sky, PAL.cream, 0.4), bodyDk: mixCol(PAL.sky, PAL.indigo, 0.3) },   // version 2, for Save the Clawd
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
        if (skin === 'ice') paint([[-h - 6, -h - 6], [h + 6, -h - 6], [h + 6, -h + 15], [h, -h + 15], [h - 14, -h + 19], [h - 34, -h + 13], [-h + 36, -h + 18], [-h + 14, -h + 12], [-h, -h + 15], [-h - 6, -h + 15]], { wash: c.top, ink: null, curv: 0.3 });   // frost, at one height on both edges so it joins
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
      if (skin === 'ice') {   // cream glints on the parts a grid repeats, thin ink cracks on the corners and ends, which it does not
        const bar = (x0, y0, x1, y1, w) => { const d = Math.hypot(x1 - x0, y1 - y0), nx = (y0 - y1) / d * w / 2, ny = (x1 - x0) / d * w / 2; return [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]; };
        const GLINT = { block_center: [-14, -8, 1], block_top: [12, 16, -1], block_left: [8, 10, -1], block_right: [-10, -12, 1], horizontal_middle: [2, 8, 1] };   // [x, y, lean]
        const CRACK = {   // [mirror, lines...]. Every cracked part has a frost band, so the lines go 7 px lower than written.
          block_top_left: [1, [[-14, -14], [-5, -4], [-9, 8], [2, 18], [-1, 30]], [[-5, -4], [8, -7], [14, -2]], [[2, 18], [8, 19], [13, 23]]],
          block_top_right: [-1, [[12, -16], [6, -3], [14, 6], [5, 17], [9, 28]], [[14, 6], [20, 3], [25, 5]]],
          horizontal_left: [1, [[-18, 2], [-6, 8], [-1, -2], [11, 4], [22, -4]], [[-1, -2], [-2, -9], [-6, -14]]],
          horizontal_right: [-1, [[-14, -14], [-5, -4], [-9, 8], [2, 18], [-1, 30]], [[-5, -4], [8, -7], [14, -2]]],
        };
        if (GLINT[part]) {
          const [x, y, m] = GLINT[part];
          paint(bar(x - 10 * m, y + 9, x + 4 * m, y - 9, 5), { wash: PAL.cream, ink: null }); paint(bar(x + 2 * m, y + 10, x + 9 * m, y + 1, 3.5), { wash: PAL.cream, ink: null });
        } else {
          const [m, ...lines] = CRACK[part];
          for (const line of lines) inkLine(line.map(([x, y]) => [m * x, y + 7]), 0.6, PAL.ink, 'inkfine', 0.1);
        }
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

  // ---------- version 2, Pull the Pin: the miner walks, a friend to rescue, bombs, a boulder, a floor plate ----------
  // version 2 sprites keep no watercolour outside their flat paint (`noBleed`, see the render hook)
  const clean = spec => ({ ...spec, noBleed: true });
  const CLEAN = clean(CHAR);
  character('clawd_hard_run', 12, 0.5, 24, run(0.5, { hat: 'hard' }), 20, CLEAN);
  // the friend wears a bow, which tells it from the miner's hard hat and from the violet crowd
  character('clawd_friend_idle', 12, BAR, 12 / BAR, t => ({ ...feel('nervous', t), hat: 'bow' }), 20, CLEAN);
  character('clawd_friend_happy', 16, BAR, 16 / BAR, t => ({ ...feel('happy', t), hat: 'bow' }), 20, CLEAN);
  character('clawd_friend_ko', 8, BAR, 8 / BAR, t => ({ ...feel('ko', t), hat: 'bow' }), 20, CLEAN);
  // the bomb again, lit and soaked. The body and neck are painted as `bomb` paints them, from the same seed and in
  // the same box, so the pieces swap in place.
  const bombBody = (wash, neck) => {
    boilSeed('bomb');
    paint(ellPts(0, 6, 32, 32, 22, 0.8), { wash, fill: PAL.ink, fillOp: 90, ink: PAL.ink, sw: 1.2 });
    paint(rectPts(-8, -34, 16, 12, 0.6), { wash: neck, ink: PAL.ink, sw: 0.8 });
  };
  const bombLit = k => t => {   // two frames to flicker between: the spark turns, changes size and throws off bits
    bombBody('#3A3247', STONE_DK);
    inkLine([[0, -34], [6, -41.5], [15, -41.5], [24, -34.5], [28, -30]], 1.4, DIRT_DK, 'ink', 0.5);
    paint(ellPts(-12, -8, 7, 5, 10, 0, -0.7), { wash: PAL.cream, washOp: 120, ink: null });
    const r = k < 0 ? 12 : 10, rot = -Math.PI / 2 + 0.2 + (k < 0 ? 0 : Math.PI / 4);
    paint(starPts(29, -28, r, 0.42, 4, rot), { wash: PAL.ochre, ink: PAL.ink, sw: 0.9, br: 'inkfine' });
    paint(starPts(29, -28, r * 0.5, 0.5, 4, rot + Math.PI / 4), { wash: PAL.cream, ink: null });
    for (const [a, d] of k < 0 ? [[-0.62, 15], [0.98, 13.5]] : [[-1.37, 13.5], [0.2, 13], [-0.585, 15]]) paint(starPts(29 + Math.cos(a) * d, -28 + Math.sin(a) * d, 3, 0.45, 4, a), { wash: PAL.ochre, ink: null });
  };
  still('bomb_lit_a', clean(CENTRE(96, 96)), bombLit(-1));
  still('bomb_lit_b', clean(CENTRE(96, 96)), bombLit(1));
  still('bomb_wet', clean(CENTRE(96, 96)), t => {   // a darker wash, the fuse hanging limp, and water beading on it
    bombBody(mixCol('#3A3247', PAL.ink, 0.5), mixCol(STONE_DK, PAL.ink, 0.3));
    inkLine([[0, -34], [5, -41.5], [13, -40.5], [17, -31], [16, -21]], 1.4, mixCol(DIRT_DK, PAL.ink, 0.35), 'ink', 0.5);
    const drop = (x, y, r) => paint([[x, y - 1.7 * r], [x + 0.9 * r, y + 0.2 * r], [x, y + r], [x - 0.9 * r, y + 0.2 * r]], { wash: PAL.sky, ink: PAL.ink, sw: 0.5, curv: 0.7 });
    drop(16, -12, 4.5); drop(-13, 17, 6);
    paint(ellPts(-12, -8, 7, 5, 10, 0, -0.7), { wash: PAL.sky, washOp: 150, ink: null });
  });
  // a boulder for a body 36 points across: rounder and darker than `rock`, with a ridge and a chipped side
  still('rock_big', clean(CENTRE(128, 128)), t => {
    boilSeed('rock_big');
    const dk = mixCol(STONE_DK, PAL.ink, 0.35);
    const rim = P([[-55, 4], [-50, -24], [-32, -46], [-6, -55], [22, -51], [44, -34], [55, -8], [53, 20], [40, 42], [14, 54], [-16, 53], [-42, 36]], 0.96);
    paint(rim, { wash: mixCol(STONE, STONE_DK, 0.6), fill: dk, fillOp: 80, tex: 0.7, bleed: 0.05, ink: null, curv: 0.3,
      hatch: { d: 9, a: 0.6, o: { rand: 0.3, gradient: 0.6 }, b: 'charcoal', c: dk, w: 0.5 } });
    paint(P([[50, -18], [27, -4], [23, 24], [29, 46], [39, 41], [52, 20], [54, -8]], 0.96), { wash: dk, washOp: 110, ink: null });
    paint(rim, { ink: PAL.ink, sw: 1.4, curv: 0.3 });
    inkLine(P([[51, -19], [27, -4], [23, 24], [29, 48]], 0.96), 0.9, PAL.ink, 'inkfine', 0.2);
    inkLine(P([[-31, -45], [-10, -16], [-21, 14]], 0.96), 0.9, PAL.ink, 'inkfine', 0.3);
  });
  // a floor pressure plate, 40 x 8 points when it is up. The anchor is the floor line.
  const PLATE = clean({ box: [CX - 72, 540 - 40, 144, 48], anchor: [0.5, 8 / 48] });
  const plate = down => t => {
    boilSeed('plate');
    const top = down ? -15 : -25;
    paint(rectPts(-60, -9, 120, 9, 0.5), { wash: PAL.clayDk, ink: null });
    paint([[-50, -9], [-47, top], [47, top], [50, -9]], { wash: down ? mixCol(PAL.clay, PAL.clayDk, 0.4) : PAL.clay, ink: null });
    paint([[-60, 0], [-60, -9], [-50, -9], [-47, top], [47, top], [50, -9], [60, -9], [60, 0]], { ink: PAL.ink, sw: 1 });
    if (!down) inkLine([[-41, -19.5], [0, -19.5], [41, -19.5]], 1.2, PAL.cream, 'inkfine', 0);
  };
  still('plate_up', PLATE, plate(false));
  still('plate_down', PLATE, plate(true));

  // ---------- version 2, Number Tower: the climber, the rival that grows, pickups, the pointing hand ----------
  // the climber is Clawd in a headband, at the plain clips' lengths and frame counts
  character('clawd_band_idle', 16, BAR, 16 / BAR, t => ({ ...feel('neutral', t), hat: 'band' }), 20, CLEAN);
  // In the 3/4 view the kit sets a hat forward of the head. That suits a brim but not a band, so the run paints its
  // own band across the whole head, darker where it rounds the side.
  const BAND = '#D8394E';
  const bandQ = (u, sw) => {
    paint(rectPts(-5.1 * u, -8.2 * u, 10.3 * u, 0.95 * u), { wash: BAND, ink: null });
    paint(rectPts(-5.1 * u, -8.2 * u, 2.8 * u, 0.95 * u), { wash: mixCol(BAND, PAL.ink, 0.3), ink: null });
    paint(rectPts(-5.1 * u, -8.2 * u, 10.3 * u, 0.95 * u), { ink: PAL.ink, sw: sw * 0.5 });
  };
  character('clawd_band_run', 12, 0.5, 24, run(0.5, { draw: bandQ }), 20, CLEAN);
  character('clawd_band_excited', 12, 2 * BEAT, 12 / (2 * BEAT), t => ({ ...feel('excited', t), hat: 'band' }), 20, CLEAN);
  character('clawd_band_ko', 8, BAR, 8 / BAR, t => ({ ...feel('ko', t), hat: 'band' }), 20, CLEAN);
  character('clawd_band_determined', 8, BAR, 8 / BAR, t => ({ ...feel('determined', t), hat: 'band' }), 20, CLEAN);
  // The rival that grows: sap green and smug, where the violet goblin is angry. A tint mixes about half and half
  // with Clawd's clay, and PAL.sap itself comes out khaki, so the tint is a stronger green that lands on sap.
  const GROWER = { tint: '#16C059', tintK: 0.85 };
  character('clawd_grower_idle', 12, BAR, 12 / BAR, t => ({ ...feel('smug', t), ...GROWER }), 20, CLEAN);
  character('clawd_grower_ko', 8, BAR, 8 / BAR, t => ({ ...feel('ko', t), ...GROWER }), 20, CLEAN);

  // pickups and room pieces, each drawn to read at 28 to 36 points
  const arc = (cx, cy, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
  still('item_sword', clean(CENTRE(96, 96)), t => {   // the plus: a short sword, point up
    boilSeed('sword');
    paint(rectPts(-7, 13, 14, 18, 0.5), { wash: DIRT_DK, ink: PAL.ink, sw: 1 });
    paint(ellPts(0, 34, 7.5, 7, 12, 0.4), { wash: PAL.ochre, ink: PAL.ink, sw: 1 });
    paint([[0, -41], [12, -27], [12, 8], [-12, 8], [-12, -27]], { wash: '#D9D4E4', fill: STONE_DK, fillOp: 60, tex: 0.5, bleed: 0.03, ink: PAL.ink, sw: 1.2 });
    inkLine([[0, -33], [0, -14], [0, 4]], 0.7, STONE_DK, 'inkfine', 0);
    paint([[-7.5, -24], [-4.5, -27.5], [-4.5, -6], [-7.5, -6]], { wash: PAL.cream, washOp: 220, ink: null });
    paint(rrPts(-25, 5, 50, 11, 4, 0.5), { wash: PAL.ochre, fill: '#C88A1E', fillOp: 70, tex: 0.5, bleed: 0.03, ink: PAL.ink, sw: 1.1 });
  });
  still('item_potion', clean(CENTRE(96, 96)), t => {   // the times: a round flask, corked
    boilSeed('potion');
    const glass = [[-8, -28], [8, -28], ...arc(0, 14, 27, -1.27, Math.PI + 1.27, 22)];
    const level = [[-23.6, 6], [-12, 4.5], [0, 6.5], [12, 4.5], [23.6, 6]];
    paint([[-7, -31], [-8.5, -42], [8.5, -42], [7, -31]], { wash: DIRT, ink: PAL.ink, sw: 0.9 });
    paint(glass, { wash: PAL.cream, ink: null });
    paint([...level, ...arc(0, 14, 25, -0.326, Math.PI + 0.326, 18)], { wash: PAL.violet, fill: PURPLE_DK, fillOp: 60, tex: 0.5, bleed: 0.02, ink: null });
    inkLine(level, 0.6, PURPLE_DK, 'inkfine', 0.4);
    paint(glass, { ink: PAL.ink, sw: 1.2 });
    paint(rrPts(-11, -33, 22, 6.5, 2.5, 0.4), { wash: PAL.cream, ink: PAL.ink, sw: 0.9 });
    paint(ellPts(-13, 18, 3.5, 8, 10, 0, 0.45), { wash: PAL.cream, washOp: 220, ink: null });
    for (const [x, y, r] of [[9, 22, 3], [15, 13, 2]]) paint(ellPts(x, y, r, r, 8), { wash: PAL.cream, washOp: 220, ink: null });
  });
  still('item_mirror', clean(CENTRE(96, 96)), t => {   // turns a number around: a mirror on a stand
    boilSeed('mirror');
    paint(rectPts(-4.5, 20, 9, 16, 0.5), { wash: '#C88A1E', ink: PAL.ink, sw: 0.9 });
    paint(rrPts(-19, 33, 38, 8, 3.5, 0.5), { wash: PAL.ochre, ink: PAL.ink, sw: 1 });
    paint(ellPts(0, -9, 27, 32, 26, 0.8), { wash: PAL.ochre, fill: '#C88A1E', fillOp: 70, tex: 0.5, bleed: 0.03, ink: PAL.ink, sw: 1.3 });
    paint(ellPts(0, -9, 18.5, 23.5, 22, 0.5), { wash: mixCol(PAL.sky, PAL.cream, 0.45), ink: PAL.ink, sw: 0.8 });
    paint([[-11, -1], [1, -27], [7, -25], [-6, 2]], { wash: PAL.cream, washOp: 235, ink: null });
  });
  still('item_key', clean(CENTRE(96, 96)), t => {
    boilSeed('key');
    push(); translate(1.5, -4.5); rotate(0.72); scale(1.15);
    const bow = arc(-22, 0, 17, 0.36, TAU - 0.36, 22);                       // the ring's outer edge, open where the shaft joins
    const hole = arc(-22, 0, 6.5, Math.PI, -Math.PI, 14);                    // drawn the other way round, so the wash leaves it open
    const bit = [[36, -6], [36, 21], [29, 21], [29, 15], [22, 15], [22, 6]];
    // one wash for the whole key: round the ring to its far side, in and around the hole, back out, then the shaft and bit
    paint([...bow.slice(0, 12), ...hole, ...bow.slice(11), ...bit], { wash: PAL.ochre, ink: null });
    paint([...bow, ...bit], { ink: PAL.ink, sw: 1.1 });
    paint(hole, { ink: PAL.ink, sw: 0.8 });
    paint(ellPts(-30, -9, 4, 2.5, 8, 0, -0.8), { wash: PAL.cream, washOp: 200, ink: null });
    pop();
  });
  still('item_lock', clean(CENTRE(96, 96)), t => {
    boilSeed('lock');
    paint(ribbon([[-15, 2], [-15, -18], [-10, -30], [0, -34], [10, -30], [15, -18], [15, 2]], 9), { wash: '#3A3247', ink: PAL.ink, sw: 1.1 });
    inkLine([[-14.5, -14], [-11, -25], [-3, -31.5]], 0.7, STONE, 'inkfine', 0.5);
    paint(rrPts(-26, -6, 52, 42, 8, 0.8), { wash: PAL.ochre, fill: '#C88A1E', fillOp: 70, tex: 0.5, bleed: 0.03, ink: PAL.ink, sw: 1.3 });
    paint(ellPts(0, 10, 5.5, 5.5, 12), { wash: PAL.ink, ink: null });
    paint([[-2.8, 11], [2.8, 11], [4.5, 25], [-4.5, 25]], { wash: PAL.ink, ink: null });
    paint(ellPts(-16, 2, 5, 3, 10, 0, -0.6), { wash: PAL.cream, washOp: 200, ink: null });
  });
  still('item_weight', clean(CENTRE(96, 96)), t => {   // this floor is weak: a split plank sagging from one nail on two ropes
    boilSeed('weight');
    push(); translate(0, 2); scale(0.9);
    const rope = mixCol(PAL.ochre, DIRT_DK, 0.7), wood = { wash: DIRT, fill: DIRT_DK, fillOp: 55, tex: 0.6, bleed: 0.03, ink: PAL.ink, sw: 1 };
    inkLine([[0, -36], [-17, -22], [-35, -8]], 1.2, rope, 'ink', 0);
    inkLine([[0, -36], [17, -23], [34, -10]], 1.2, rope, 'ink', 0);
    paint(ellPts(0, -36, 4.5, 4.5, 10), { wash: PAL.ink, ink: null });
    paint([[-37.2, -14.7], [-0.8, 3.5], [-7, 7.5], [-2.5, 11], [-9, 14], [-5.5, 17.5], [-9.3, 20.5], [-45.7, 2.3]], wood);
    paint([[33, -16.3], [46.2, -2.7], [15.6, 26.8], [9.5, 24.5], [11.5, 21], [5, 19.5], [8.5, 15], [2.4, 13.2]], wood);
    inkLine([[-36, -3], [-24, 3], [-12, 9]], 0.7, DIRT_DK, 'inkfine', 0.2);
    inkLine([[35, -6], [26, 3], [16, 12.5]], 0.7, DIRT_DK, 'inkfine', 0.2);
    for (const [x, y] of [[-36.5, -7.5], [35.5, -9.5]]) paint(ellPts(x, y, 2.8, 2.8, 8), { wash: PAL.ink, ink: null });
    for (const [x, y, r] of [[1, 30, 2.8], [5, 37, 2.2]]) paint(starPts(x, y, r, 0.6, 2, 0.4), { wash: DIRT_DK, ink: null });
    pop();
  });
  // the tutorial's pointing hand: index finger up and to the left, and the same hand pressing. The anchor is the fingertip.
  const HAND = clean({ box: [CX - 32, 540 - 28, 128, 128], anchor: [32 / 128, 100 / 128] });
  const hand = press => t => {
    boilSeed('hand');
    push(); rotate(-0.5);
    if (press) {   // three short strokes around the tip, then the hand a little smaller, as if it went into the screen
      for (const a of [-2.5, -Math.PI / 2, -0.64]) inkLine([8, 12.5, 17].map(d => [Math.cos(a) * d, Math.sin(a) * d]), 0.8, PAL.ink, 'ink', 0);
      scale(0.9);
    }
    paint([[-9.5, 13], [-8.5, 5], [-4.5, 0.8], [0, 0], [4.5, 0.8], [8.5, 5], [9.5, 13], [10, 28], [10, 40],
      [11.5, 36.5], [17, 35], [22, 36.5], [23.5, 40], [25.5, 39], [30, 38], [35, 39.5], [36.5, 43], [38.5, 42.5], [42.5, 42.5], [46.5, 45.5],
      [48.5, 51], [49, 62], [47.5, 76], [43, 88], [38, 95], [37, 103], [33, 106], [10, 106], [6, 103], [5, 95],
      [-4, 91], [-13, 85], [-21, 76], [-27.5, 65], [-30, 54], [-28, 47], [-23, 45], [-18.5, 49], [-15.5, 56], [-12, 62],
      [-10.3, 52], [-10, 40], [-10, 28]], { wash: PAL.cream, ink: PAL.ink, sw: 1.3, curv: 0.3 });
    for (const [x0, y0, x1, y1] of [[10, 40, 10.5, 56], [23.5, 40, 23, 56], [36.5, 43, 35.5, 57]]) inkLine([[x0, y0], [(x0 + x1) / 2, (y0 + y1) / 2], [x1, y1]], 1, PAL.ink, 'inkfine', 0);
    inkLine([[10.5, 57], [24, 59.5], [36, 60], [47, 58]], 1, PAL.ink, 'inkfine', 0.4);
    inkLine([[5.5, 96], [21, 98], [37.5, 96]], 1, PAL.ink, 'inkfine', 0.3);
    pop();
  };
  still('hand_point', HAND, hand(false));
  still('hand_press', HAND, hand(true));

  // ---------- version 2, Save the Clawd: fire (the ice skin is in the terrain table above) ----------
  // a small flame in three frames to cycle. The base stays put and the tongues change, so it flickers in place.
  const FIRE = [
    { out: [[-17, 0], [-28, -10], [-32, -26], [-30, -42], [-27, -56], [-24, -72], [-12, -94], [-6, -78], [0, -64], [6, -54], [11, -48], [22, -58], [27, -42], [30, -26], [27, -10], [17, 0]],
      mid: [[-11, -2], [-19, -12], [-21, -28], [-18, -44], [-15, -58], [-9, -72], [-3, -56], [4, -42], [12, -38], [18, -26], [19, -12], [11, -2]],
      core: [[-6, -3], [-10, -13], [-10, -26], [-6, -42], [0, -28], [7, -22], [9, -12], [6, -3]] },
    { out: [[-17, 0], [-27, -10], [-31, -26], [-28, -42], [-21, -56], [-15, -70], [-8, -86], [0, -100], [7, -84], [10, -70], [13, -58], [25, -68], [29, -50], [31, -30], [27, -10], [17, 0]],
      mid: [[-11, -2], [-19, -12], [-20, -28], [-14, -44], [-8, -60], [0, -76], [6, -60], [11, -44], [18, -30], [19, -12], [11, -2]],
      core: [[-6, -3], [-10, -13], [-8, -26], [0, -46], [6, -28], [9, -14], [6, -3]] },
    { out: [[-17, 0], [-28, -10], [-32, -26], [-29, -44], [-24, -62], [-12, -50], [-6, -54], [0, -62], [6, -76], [13, -92], [22, -76], [26, -60], [30, -44], [31, -26], [28, -10], [17, 0]],
      mid: [[-11, -2], [-19, -12], [-19, -28], [-12, -40], [-4, -44], [3, -56], [10, -70], [15, -56], [18, -42], [20, -26], [19, -12], [11, -2]],
      core: [[-6, -3], [-9, -12], [-7, -22], [0, -28], [6, -42], [9, -26], [10, -13], [6, -3]] },
  ];
  FIRE.forEach((f, i) => still('fire_' + 'abc'[i], clean(FOOT(96, 128)), t => {
    boilSeed('fire');
    paint(f.out, { wash: PAL.clay, ink: PAL.ink, sw: 1, curv: 0.5 });
    paint(f.mid, { wash: PAL.ochre, ink: null, curv: 0.5 });
    paint(f.core, { wash: PAL.cream, ink: null, curv: 0.5 });
  }));

  // ---------- version 2, menus: two more button pieces, for the new modes' cards ----------
  frame9('ui_button_ochre', 192, 96, PAL.ochre, PAL.ink, '#C88A1E', 60);
  frame9('ui_button_violet', 192, 96, PAL.violet, PAL.ink, PURPLE_DK, 60);
  for (const name of ['ui_button_ochre', 'ui_button_violet']) window.ASSETS[name].noBleed = true;   // no pale specks on the edges a 9-slice stretches

  // ---------- paper (kept in paper mode: these ARE the background) ----------
  add('paper', { box: [0, 0, 1920, 1080], anchor: [0.5, 0.5], frames: 1, len: 1, fps: 1, paper: true, draw: t => {} });
  add('paper_cave', { box: [0, 0, 1920, 1080], anchor: [0.5, 0.5], frames: 1, len: 1, fps: 1, paper: true, draw: t => {
    boilSeed('cave');
    paint(rectPts(-100, -100, W + 200, H + 200), { fill: PAL.indigo, fillOp: 95, bleed: 0.02, tex: 0.5, ink: null });
    paint(rectPts(-100, -100, W + 200, H + 200), { fill: PAL.night, fillOp: 60, bleed: 0.02, tex: 0.6, ink: null });
  } });
  // the app icon: a happy Clawd on paper, washes running off every edge. No frame: iOS masks the
  // square itself, and a painted border inside that mask read as a black box around the icon.
  add('icon', { box: [CX - 540, 0, 1080, 1080], anchor: [0.5, 0.5], frames: 1, len: 1, fps: 1, paper: true, draw: t => {
    boilSeed('icon');
    paint(rectPts(CX - 640, -100, 1280, 1280), { fill: PAL.sky, fillOp: 75, bleed: 0.05, tex: 0.5, ink: null });
    paint(ellPts(CX, 760, 620, 330, 40, 8), { fill: PAL.sap, fillOp: 95, bleed: 0.2, tex: 0.6, ink: null });
    paint(ellPts(CX - 60, 1150, 900, 420, 40, 8), { wash: mixCol(PAL.sap, PAL.sky, 0.35), washOp: 235, ink: null });
    clawd(CX, 950, 66, { ...feel('happy', 0.2), boilKey: 'icon' });
  } });

  // ---------- the render hook ----------
  // A watercolour fill can bleed past its outline. On paper that is the look, but on a transparent sprite the bleed
  // shows as a pale wedge beside the shape, most often under Clawd's body. An asset with `noBleed: true` is rendered
  // twice, the second time with the fills switched off, and the first render is kept only where the second one has
  // paint. The second render is stacked four times, so a thin wash in it still counts as paint.
  const withoutBleed = async (t, x, y, w, h) => {
    const shot = async () => { const im = new Image(); im.src = await window.renderCrop(t, x, y, w, h, w, h, true); await im.decode(); return im; };
    const full = await shot(), fill = brush.fill;
    brush.fill = () => brush.noFill();
    let flat; try { flat = await shot(); } finally { brush.fill = fill; }
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const c = cv.getContext('2d');
    for (let k = 0; k < 4; k++) c.drawImage(flat, 0, 0);
    c.globalCompositeOperation = 'source-in'; c.drawImage(full, 0, 0);
    return cv.toDataURL('image/png');
  };
  window.renderAsset = async (name, i) => {
    const a = window.ASSETS[name], t = a.frames > 1 ? (i / a.frames) * a.len : 0.35;
    window.LOOP = a.draw; window.LOOP.len = a.len;
    const [x, y, w, h] = a.box;
    if (a.noBleed) return withoutBleed(t, x, y, w, h);
    return window.renderCrop(t, x, y, w, h, w, h, !a.paper);
  };
})();
