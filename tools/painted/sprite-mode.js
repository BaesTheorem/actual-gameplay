// sprite-mode.js: renders the kit's drawings onto a TRANSPARENT canvas instead of paper, for game sprites.
// Loaded after core.js. It replaces draw() and composite(): no paper under the drawing, no grain multiplied over it,
// and the output canvas is cleared first so the PNG keeps its alpha. The originals are kept for paper swatches.
const _paperDraw = window.draw, _paperComposite = window.composite;
window.SPRITE = true;

function draw() {
  if (!window.ready) return;
  LETTERS = []; CAM = null;
  if (window.SPRITE) clear(); else image(paperG, 0, 0);
  push(); translate(-W / 2, -H / 2);
  BOILN = Math.floor(T * BOIL); CLAWD_N = 0; boilSeed('frame'); noiseSeed(77);
  if (!window.SPRITE) image(paperG, 0, 0);
  drawWorld(T);
  pop();
}
function composite(t) {
  const c = outX;
  c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
  if (window.SPRITE) c.clearRect(0, 0, W, H);
  c.drawImage(drawingContext.canvas, 0, 0, W, H);
  drawLetters(c);
  if (!window.SPRITE) { c.globalCompositeOperation = 'multiply'; c.drawImage(grainC, 0, 0); }
  c.globalCompositeOperation = 'source-over';
}
// Render one frame and return a PNG of the crop [x, y, w, h] (frame pixels), scaled to outW x outH.
window.renderCrop = async (t, x, y, w, h, outW, outH, sprite = true) => {
  window.SPRITE = sprite; T = t; await redraw(); composite(t);
  const cv = document.createElement('canvas'); cv.width = outW; cv.height = outH;
  const c = cv.getContext('2d'); c.imageSmoothingQuality = 'high';
  c.drawImage(outC, x, y, w, h, 0, 0, outW, outH);
  return cv.toDataURL('image/png');
};
