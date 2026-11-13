// Turn the iPhone app's art and audio into what the browser loads.
//   node scripts/build-assets.mjs
// Reads ../ActualGameplay (the one copy of every asset) and writes public/art, public/audio
// and public/levels, which are generated and not committed. Still images become WebP, each
// animated clip becomes one WebP sheet, and src/generated/art.json records where every frame is.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import sharp from "sharp";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(web, "../ActualGameplay");
const painted = join(app, "Art/painted");
const out = join(web, "public");
// A sheet no wider than this loads on every phone GPU.
const MAX_SHEET = 4096;

for (const dir of ["art", "audio", "levels"]) rmSync(join(out, dir), { recursive: true, force: true });
mkdirSync(join(out, "art"), { recursive: true });
mkdirSync(join(out, "audio/sfx"), { recursive: true });
mkdirSync(join(web, "src/generated"), { recursive: true });

const manifest = JSON.parse(readFileSync(join(painted, "manifest.json"), "utf8"));
const art = {};
const webp = (name) => ({ quality: name.startsWith("paper") ? 80 : 90, alphaQuality: 100, effort: 5 });

// The painted set first: it wins over a Kenney file of the same name.
for (const [name, entry] of Object.entries(manifest)) {
  if (name === "icon") continue;
  const file = `${name}.webp`;
  if (entry.frames > 1) {
    const first = await sharp(join(painted, `${name}_00.png`)).metadata();
    const w = first.width, h = first.height;
    const cols = Math.min(entry.frames, Math.floor(MAX_SHEET / w));
    const rows = Math.ceil(entry.frames / cols);
    const tiles = [];
    for (let i = 0; i < entry.frames; i++) {
      tiles.push({
        input: join(painted, `${name}_${String(i).padStart(2, "0")}.png`),
        left: (i % cols) * w, top: Math.floor(i / cols) * h,
      });
    }
    await sharp({ create: { width: cols * w, height: rows * h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(tiles).webp(webp(name)).toFile(join(out, "art", file));
    art[name] = { file, frames: entry.frames, fps: entry.fps, w, h, cols, anchor: entry.anchor };
  } else {
    const image = sharp(join(painted, `${name}.png`));
    const meta = await image.metadata();
    await image.webp(webp(name)).toFile(join(out, "art", file));
    art[name] = { file, frames: 1, fps: 1, w: meta.width, h: meta.height, cols: 1, anchor: entry.anchor };
  }
}
// Loose painted files the manifest does not list, then the Kenney set for names still missing.
for (const dir of [painted, join(app, "Art")]) {
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".png")) continue;
    const name = f.slice(0, -4);
    if (art[name] || name === "icon" || /_\d\d$/.test(name) && manifest[name.slice(0, -3)]) continue;
    const image = sharp(join(dir, f));
    const meta = await image.metadata();
    await image.webp(webp(name)).toFile(join(out, "art", `${name}.webp`));
    art[name] = { file: `${name}.webp`, frames: 1, fps: 1, w: meta.width, h: meta.height, cols: 1, anchor: [0.5, 0.5], kenney: dir !== painted };
  }
}
writeFileSync(join(web, "src/generated/art.json"), JSON.stringify(art));

// App icons from the painted icon.
for (const [file, px] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  await sharp(join(painted, "icon.png")).resize(px, px).flatten({ background: "#F3EBDC" }).png().toFile(join(out, file));
}

// The music ships at 256 to 320 kbps, which is 4 to 8 MB a track and slow to start on a phone
// connection. It plays quietly under the game, so 96 kbps is enough and a third of the size.
// Without ffmpeg the files are copied as they are. The effects are 1 MB in total and stay as they are.
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
if (!hasFfmpeg) console.warn("ffmpeg not found: music copied at full size");
for (const f of readdirSync(join(app, "Audio"))) {
  if (!f.endsWith(".mp3")) continue;
  const from = join(app, "Audio", f), to = join(out, "audio", f.replaceAll(" ", "-"));
  const done = hasFfmpeg && spawnSync("ffmpeg", ["-v", "error", "-y", "-i", from, "-map", "0:a", "-map_metadata", "-1", "-c:a", "libmp3lame", "-b:a", "96k", "-ac", "2", to]).status === 0;
  if (!done) copyFileSync(from, to);
}
for (const f of readdirSync(join(app, "Audio/sfx"))) {
  if (/\.(wav|mp3)$/.test(f)) copyFileSync(join(app, "Audio/sfx", f), join(out, "audio/sfx", f));
}
copyFileSync(join(app, "Audio/CREDITS.txt"), join(out, "audio/CREDITS.txt"));
if (existsSync(join(app, "Art/CREDITS.txt"))) copyFileSync(join(app, "Art/CREDITS.txt"), join(out, "art/CREDITS.txt"));

// Levels, one file per mode, in play order.
const levels = {};
for (const mode of ["savedog", "pinpull"]) {
  levels[mode] = readdirSync(join(app, "Levels", mode)).filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(readFileSync(join(app, "Levels", mode, f), "utf8")));
}
writeFileSync(join(web, "src/generated/levels.json"), JSON.stringify(levels));

const size = (dir) => readdirSync(dir, { recursive: true }).reduce((n, f) => {
  const s = statSync(join(dir, f)); return n + (s.isFile() ? s.size : 0);
}, 0);
console.log(`art ${Object.keys(art).length} assets, ${(size(join(out, "art")) / 1e6).toFixed(1)} MB; audio ${(size(join(out, "audio")) / 1e6).toFixed(1)} MB`);
