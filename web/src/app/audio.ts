// Sound effects through Web Audio and one looping music track. A browser stays silent until
// the first tap, so everything asked for before then waits for it.
const base = import.meta.env.BASE_URL;

interface SoundSpec { files: string[]; volume: number; minGap?: number }
/// Each event's files and volume. The files are matched for loudness, so these volumes are the mix.
const EVENTS: Record<string, SoundSpec> = {
  tap: { files: ["ui_press.mp3"], volume: 0.35 },
  select: { files: ["ui_select.mp3"], volume: 0.25 },
  toggleOn: { files: ["ui_toggle_on.mp3"], volume: 0.2 },
  toggleOff: { files: ["ui_toggle_off.mp3"], volume: 0.3 },
  purchase: { files: ["ui_purchase.mp3"], volume: 0.25 },
  strokeLand: { files: ["ink_land_1.wav", "ink_land_2.wav", "ink_land_3.wav"], volume: 0.5 },
  strokeRejected: { files: ["ui_invalid_drop.mp3"], volume: 0.65 },
  strokeCut: { files: ["saw_cut.wav"], volume: 0.3 },
  heave: { files: ["heave.wav"], volume: 0.18 },
  caught: { files: ["caught.wav"], volume: 0.35 },
  pinPull: { files: ["pin_slide.wav"], volume: 0.25 },
  splash: { files: ["splash.wav"], volume: 0.25 },
  sizzle: { files: ["sizzle.wav"], volume: 0.25 },
  melt: { files: ["sizzle.wav"], volume: 0.3 },
  gemLand: { files: ["gem_clink.wav"], volume: 0.25 },
  // Mostly below what a phone speaker plays; on headphones it is a heavy thump.
  cooked: { files: ["cooked.wav"], volume: 0.6 },
  gateGood: { files: ["gate_good.wav"], volume: 0.2 },
  gateBad: { files: ["gate_bad.wav"], volume: 0.2 },
  pop: { files: ["pop_1.wav", "pop_2.wav"], volume: 0.18 },
  coin: { files: ["coins.wav"], volume: 0.55, minGap: 0.25 },
  hit: { files: ["hit_1.wav", "hit_2.wav", "hit_3.wav"], volume: 0.4, minGap: 0.1 },
  bossRoar: { files: ["boss.wav"], volume: 0.45, minGap: 0.25 },
  win: { files: ["win.wav"], volume: 0.3, minGap: 0.25 },
  lose: { files: ["lose.wav"], volume: 0.25, minGap: 0.25 },
  // Number Tower's moments, on sounds the other games already use: a footfall on wood, the gate
  // chimes for a number that goes up or down, a clink for a key, a slide for a lock, a chop for a floor.
  step: { files: ["ink_land_1.wav", "ink_land_2.wav", "ink_land_3.wav"], volume: 0.3 },
  gain: { files: ["gate_good.wav"], volume: 0.2 },
  drain: { files: ["gate_bad.wav"], volume: 0.2 },
  key: { files: ["gem_clink.wav"], volume: 0.25 },
  unlock: { files: ["pin_slide.wav"], volume: 0.25 },
  crack: { files: ["saw_cut.wav"], volume: 0.3 },
  // Pull the Pin's newer pieces. A blast is the loudest thing in a level, and a fuse and gas are
  // hisses under everything else. Gas that reaches three goblins at once is heard once.
  blast: { files: ["blast.wav"], volume: 0.4, minGap: 0.1 },
  fuse: { files: ["fuse.wav"], volume: 0.2 },
  boulderLand: { files: ["boulder_land.wav"], volume: 0.35, minGap: 0.1 },
  wallBreak: { files: ["wall_break.wav"], volume: 0.3, minGap: 0.1 },
  plate: { files: ["plate_click.wav"], volume: 0.3 },
  door: { files: ["door_slide.wav"], volume: 0.22 },
  gas: { files: ["gas_hiss.wav"], volume: 0.22, minGap: 0.25 },
  // Save the Clawd's hazards. Ink that keeps falling into a flame catches once. A boulder let
  // go is a latch clicking open. Its landing, the fuse, the blast and the sizzle are the sounds above.
  burn: { files: ["burn.wav"], volume: 0.3, minGap: 0.15 },
  rockLoose: { files: ["plate_click.wav"], volume: 0.35 },
};
const LOOPS: Record<string, { file: string; volume: number }> = {
  buzz: { file: "loop_buzz.wav", volume: 0.14 },
  scratch: { file: "loop_scratch.wav", volume: 0.12 },
  saw: { file: "loop_saw.wav", volume: 0.08 },
  fire: { file: "loop_fire.wav", volume: 0.16 },
};
export const TRACKS = {
  menu: "Wallpaper", saveDog: "Pixelland", pinPull: "Investigations", runner: "Digital Lemonade", tower: "Marty Gots a Plan",
} as const;
export type Track = keyof typeof TRACKS;
const MUSIC_VOLUME = 0.35;

let ctx: AudioContext | null = null;
let unlocked = false;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
const lastPlayed = new Map<string, number>();
const turn = new Map<string, number>();
const loops = new Map<string, { source: AudioBufferSourceNode; gain: GainNode }>();
const wantedLoops = new Map<string, number>();
let music: HTMLAudioElement | null = null;
let track: Track | null = null;

export const settings = { sound: true, music: true, haptics: true };

const buffer = (file: string) => {
  let found = buffers.get(file);
  if (!found) {
    found = fetch(`${base}audio/sfx/${file}`).then((r) => r.arrayBuffer()).then((data) => ctx!.decodeAudioData(data)).catch(() => null);
    buffers.set(file, found);
  }
  return found;
};

/// Call from the first tap or key press: starts the audio context and whatever music was asked for.
export const unlock = () => {
  if (unlocked) return;
  unlocked = true;
  ctx = new AudioContext();
  void ctx.resume();
  if (track) startMusic();
  for (const [name, level] of wantedLoops) startLoop(name, level);
};

export const play = (name: string) => {
  const spec = EVENTS[name];
  if (!spec || !settings.sound || !unlocked || !ctx) return;
  const now = ctx.currentTime;
  if (now - (lastPlayed.get(name) ?? -1) < (spec.minGap ?? 0.04)) return;
  lastPlayed.set(name, now);
  const index = ((turn.get(name) ?? -1) + 1) % spec.files.length;
  turn.set(name, index);
  void buffer(spec.files[index]).then((data) => {
    if (!data || !ctx) return;
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = data;
    gain.gain.value = spec.volume;
    source.connect(gain).connect(ctx.destination);
    source.start();
  });
};

export const startLoop = (name: string, level = 1) => {
  const spec = LOOPS[name];
  if (!spec) return;
  wantedLoops.set(name, level);
  if (!settings.sound || !unlocked || !ctx || loops.has(name)) { setLoopVolume(name, level); return; }
  const gain = ctx.createGain(), source = ctx.createBufferSource();
  gain.gain.value = spec.volume * level;
  source.loop = true;
  loops.set(name, { source, gain });
  void buffer(spec.file).then((data) => {
    if (!data || !ctx || loops.get(name)?.source !== source) return;
    source.buffer = data;
    source.connect(gain).connect(ctx.destination);
    source.start();
  });
};

export const setLoopVolume = (name: string, level: number) => {
  if (wantedLoops.has(name)) wantedLoops.set(name, level);
  const loop = loops.get(name);
  if (loop && ctx) loop.gain.gain.setTargetAtTime(LOOPS[name].volume * level, ctx.currentTime, 0.05);
};

export const stopLoop = (name: string) => {
  wantedLoops.delete(name);
  const loop = loops.get(name);
  if (!loop) return;
  loops.delete(name);
  try { loop.source.stop(); } catch { /* it never started */ }
};

export const stopAllLoops = () => { for (const name of [...new Set([...loops.keys(), ...wantedLoops.keys()])]) stopLoop(name); };

const players = new Map<Track, HTMLAudioElement>();
/// The element for a track. It is made once and kept, so a track that was heard before starts at once.
const player = (name: Track) => {
  let el = players.get(name);
  if (!el) {
    el = new Audio(`${base}audio/${TRACKS[name].replaceAll(" ", "-")}.mp3`);
    el.preload = "auto";
    el.loop = true;
    el.volume = MUSIC_VOLUME;
    players.set(name, el);
  }
  return el;
};

/// Start fetching a track before it is asked for, so it plays without a wait.
export const preloadMusic = (name: Track) => {
  if (settings.music) player(name).load();
};

const startMusic = () => {
  if (!track || !settings.music || !unlocked) return;
  const next = player(track);
  if (music !== next) {
    music?.pause();
    music = next;
    music.currentTime = 0;
  }
  if (music.paused) void music.play().catch(() => {});
};

/// One looping track at a time.
export const playMusic = (next: Track) => {
  track = next;
  startMusic();
};

export const applySettings = () => {
  if (!settings.music) music?.pause(); else startMusic();
  if (!settings.sound) for (const name of [...loops.keys()]) { const l = loops.get(name)!; loops.delete(name); try { l.source.stop(); } catch { /* not started */ } }
};

/// The page went to the background or came back.
export const setSuspended = (hidden: boolean) => {
  if (hidden) { music?.pause(); void ctx?.suspend(); } else { void ctx?.resume(); startMusic(); }
};

const PATTERNS: Record<string, number | number[]> = { tap: 8, thud: 14, slam: 28, success: [12, 60, 18], failure: [24, 50, 24] };
/// A phone that can vibrate gets a short buzz; everything else ignores it.
export const haptic = (name: string) => {
  if (settings.haptics && "vibrate" in navigator) navigator.vibrate(PATTERNS[name] ?? 10);
};
