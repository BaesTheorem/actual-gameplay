# Painted art

Every file in `ActualGameplay/Art/painted/` is rendered from `gameart.js` by `render.mjs`, using the
Claude Animation Base kit checked out at `~/Documents/claude-animation` (p5.js + p5.brush, Clawd's rig).
Nothing in that folder is hand-edited. To change a sprite, change the drawing and re-render.

    node render.mjs                       every asset, and manifest.json
    node render.mjs --only=clawd_run,bee  a subset (the manifest is updated in place)
    node render.mjs --sheet [--frames] [--only=...] --out=out/sheet.jpg   a contact sheet to look at
    node render.mjs --test                one transparent Clawd, for checking the alpha path

`sprite-mode.js` swaps the kit's paper for a transparent canvas and drops the grain, so PNGs keep their
alpha. Characters share one 400 x 360 frame (ground 40 px above the bottom edge) so every clip of a
character lands on the same anchor; the manifest carries frames, fps, size and anchor for each asset,
and `Painted.swift` reads it. Files are 3x pixel density.
