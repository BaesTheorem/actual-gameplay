// render.mjs: drives tools/painted/studio.html in headless Chrome and writes the game's painted assets.
//   node render.mjs --test                 one transparent Clawd to out/test.png (alpha check)
//   node render.mjs [--only=name,...]      every asset in the manifest the page exposes (window.ASSETS)
import puppeteer from '/Users/alexhedtke/Documents/claude-animation/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = resolve(args.out || '../../ActualGameplay/Art/painted');
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 0,
  args: ['--allow-file-access-from-files', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu-rasterization', '--window-size=1920,1080',
         '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
});
const page = await browser.newPage();
page.on('console', m => { if (['error', 'warn'].includes(m.type()) && !/INVALID_OPERATION/.test(m.text())) console.log('[page]', m.text()); });
page.on('pageerror', e => console.log('[page error]', e.message));
await page.goto(pathToFileURL(resolve('studio.html')).href + '?render', { waitUntil: 'load' });
await page.waitForFunction('window.ready === true', { timeout: 60000 });
const save = (file, url) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')); };

if (args.test) {
  await page.evaluate(() => { window.LOOP = LOOPS.alpha; });
  const url = await page.evaluate(() => window.renderCrop(0.3, 960 - 400, 900 - 640, 800, 800, 800, 800, true));
  save('out/test.png', url); console.log('wrote out/test.png');
  await browser.close(); process.exit(0);
}
const assets = await page.evaluate(() => window.ASSETS ? Object.keys(window.ASSETS) : []);
const only = args.only ? String(args.only).split(',') : null;
if (args.sheet) {   // one JPEG of every asset's first frame (or every frame of --only), over the kit's paper, for review
  const url = await page.evaluate(async (names, allFrames, cell) => {
    const items = [];
    for (const name of names) { const a = window.ASSETS[name]; const n = allFrames ? (a.frames || 1) : 1; for (let i = 0; i < n; i++) items.push([name, i]); }
    const cols = Math.min(items.length, Math.max(4, Math.floor(1920 / cell))), rows = Math.ceil(items.length / cols);
    const sc = document.createElement('canvas'); sc.width = cols * cell; sc.height = rows * (cell + 18); const c = sc.getContext('2d');
    c.fillStyle = '#F3EBDC'; c.fillRect(0, 0, sc.width, sc.height);
    for (let k = 0; k < items.length; k++) {
      const [name, i] = items[k], a = window.ASSETS[name], url = await window.renderAsset(name, i);
      const img = new Image(); img.src = url; await img.decode();
      const [w, h] = [a.box[2], a.box[3]], s = Math.min((cell - 8) / w, (cell - 8) / h, 1);
      const x = (k % cols) * cell, y = Math.floor(k / cols) * (cell + 18);
      if (k % 2) { c.fillStyle = '#7f7f7f'; c.fillRect(x, y, cell, cell); }
      c.drawImage(img, x + (cell - w * s) / 2, y + (cell - h * s) / 2, w * s, h * s);
      c.fillStyle = '#2B2233'; c.font = '13px sans-serif'; c.fillText(name + (a.frames > 1 ? ' #' + i : ''), x + 4, y + cell + 13);
    }
    return sc.toDataURL('image/jpeg', 0.88);
  }, only ? assets.filter(n => only.some(o => n === o || n.startsWith(o))) : assets, !!args.frames, +(args.cell || 160));
  save(args.out || 'out/sheet.jpg', url); console.log('wrote', args.out || 'out/sheet.jpg');
  await browser.close(); process.exit(0);
}
// a partial render (--only) updates the manifest in place instead of replacing it
const manifestFile = `${OUT}/manifest.json`;
const manifest = only && existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {};
let n = 0; const t0 = Date.now();
for (const name of assets) {
  if (only && !only.some(o => name === o || name.startsWith(o))) continue;
  const spec = await page.evaluate(name => { const a = window.ASSETS[name]; return { frames: a.frames || 1, fps: a.fps || 10, w: a.box[2], h: a.box[3], anchor: a.anchor || [0.5, 0.5], paper: !!a.paper }; }, name);
  for (let i = 0; i < spec.frames; i++) {
    const url = await page.evaluate((name, i) => window.renderAsset(name, i), name, i);
    save(`${OUT}/${name}${spec.frames > 1 ? '_' + String(i).padStart(2, '0') : ''}.png`, url); n++;
  }
  manifest[name] = spec;
  process.stdout.write(`${name} (${spec.frames})  `);
}
writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
console.log(`\n${n} files in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${OUT}`);
await browser.close();
