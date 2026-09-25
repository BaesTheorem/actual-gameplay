# Actual Gameplay

The three games that only exist in mobile ads, built for real: save-the-dog drawing puzzles,
pin-pull liquid puzzles, and a crowd runner with gates. No ads, no purchases, no network.
iPhone, SwiftUI shell, SpriteKit scenes.

## The games

**Save the Dog.** A dog, a limited pot of ink, and hives full of bees. Draw a shield; it
falls like anything you draw; a moment later the bees stream in and hunt him for ten
seconds. They path-find: a bee with a way in routes around walls and through any gap it
fits through. Bees with no way in work as a crew: they pick the least secure loose part of
the shield they can reach, line up along it, wind up, and heave on it together, alternating
the middle and the far end, straight and tilted up, and move on to the next weakest part
when one will not budge. Footing and mass decide what survives, so a bar balanced on a
point or a lid resting on him goes, and a shape that stands on its own feet holds. Twelve levels, each a
different problem: a lid over a pit, one open side of a cave, a hole in a roof, bees rising
through the floor, a boulder to route into a gap, saw blades that cut ink, two dogs with
ink for one shield. Three stars for a low-ink clear.

**Pull the Pin.** Chambers of water and lava held up by pins. Tap a pin to slide it out.
Water and lava cancel each other, lava ends the hero and melts the gem, drains swallow
whatever reaches them, and grates take the liquid while anything solid drops through.
Twelve levels of three to six pins, and each has exactly one pull order that wins: every
other order burns the hero, melts the gem, or throws away the water you needed. The wrong
pin is never merely a wasted tap. The pull count stays low on purpose. Water and lava cancel
one for one no matter what order they meet in, so a level that needs two fires put out has
two answers, not one; the difficulty is in which pin, not how many.

**Crowd Run.** Drag to steer a crowd down a road. Green gates grow it, red ones shrink it,
walls and blades and spikes thin it, and whatever is left fights a crowd or a boss at the
end. Endless and procedural (the same run is the same track on every device), with coins
that buy a bigger starting crowd, stronger runners, and a coin bonus between runs.

## Build

Requires Xcode 26 and [XcodeGen](https://github.com/yonaskolb/XcodeGen). The
`.xcodeproj` is generated and never committed.

Two gitignored files hold machine-local values; copy the examples:

- `Config/Signing.xcconfig` from `Signing.example.xcconfig`: your Apple developer team id.
- `Config/device.env` from `device.env.example`: the UDID of the iPhone to install to
  (`xcrun devicectl list devices`).

Then:

    scripts/build-install.sh              signed Release build, installs over WiFi
    scripts/build-install.sh --build-only sign and stop (for tools that install themselves)
    scripts/test.sh                       unit tests on the simulator

## Levels are tested, not trusted

Every hand-authored level stores its own solution (strokes for Draw a Line, a pull order for
Pull the Pin), and two scripts drive the app on the simulator through them:

    scripts/replay.py saveDog|pinPull|runner   play every stored solution, report pass/fail
    scripts/audit.py  saveDog|pinPull|runner   stress the levels

The replay is the regression suite: after touching physics or a level file, it must be 12/12.
The audit asks the questions a replay cannot. For Pull the Pin it tries every single pin,
every ordered pair, and everything in order and reversed, and flags a level where a naive
sequence wins. `scripts/audit.py pinPull --exhaustive` goes further and proves the harder
claim: it plays every ordered pull sequence up to par, pruning any that already won or
already died, and reports each level as UNIQUE or lists the other orders that win. For Save the Dog it replays the solution shifted and scaled eight ways and tries five
naive strokes (a bar over the dog, walls beside him, a roof), and flags levels that are
fragile (the wobbled solution loses) or trivial (a naive stroke wins). For Crowd Run it compares greedy steering against never
steering, always-left, and random. Both write per-trial snapshots under `build/`.

Both scripts show the simulator window and wait for it to finish booting, then warm it up
with a throwaway launch. A simulator with no visible window has its display link throttled
partway through a long run: the first few scenes play at speed and a later one stalls for
minutes. A cold simulator answers `simctl launch` while it is still settling, and the
first scene presented into that gets a starved run loop: timers land tens of seconds late and
the display link barely ticks, which once cost a measured run.

The app itself takes launch arguments for all of this (`--mode`, `--level`, `--replay`,
`--autoplay`, `--only`, `--audit`, `--silent`); see `LaunchArguments` in
`Sources/App/DeveloperFlags.swift`. Debug builds also expose the auto-play runs and
physics overlays in Settings.

## Adding a level

Drop a JSON file into `ActualGameplay/Levels/<savedog|pinpull>/NN.json`. The folder is
copied into the bundle as a folder reference, so no project change is needed. Coordinates
are a fixed 402 x 874 point canvas, origin bottom-left, and the scene letterboxes on other
screens so a stored solution behaves the same everywhere. A Pull the Pin level can carry `walls` and `slabs` (thick static geometry), `pins`,
`pools` of water or lava, `drains` (they end a gem that touches them), `grates` (liquid
only), `decor`, and the actors it needs for its `winWhen`. Two rules matter when placing
liquid: a pool spreads until something stops it, so give every pool a wall at each end, and
keep lava out of the gem's compartment, since they are meant to meet on the floor after the
pin goes, not on the shelf beforehand. A Save the Dog level can carry
`statics` (rect, circle, chain, with a terrain `skin`), `killers` (spike strips), `saws`
(they cut strokes), `props` (a ball or box the physics can move), `decor` (sprites with no
body), `forbidden` (no-ink zones), one or more `dogs`, and `hives` with a count, an
interval, and a delay. Store the solving strokes (Save the Dog) or the pull order (Pull the Pin) as `solution`,
then run the replay and the audit. The retired ball-physics levels the draw mode started
with are kept under `attic/` for reference.

## Art

The art is painted: flat watercolour washes and ink outlines on paper, drawn with the
[Claude Animation Base](https://github.com/JohnHeibel/ClaudeAnimationBase) kit (p5.js and
p5.brush, MIT) through the fork at `~/Documents/claude-animation`. Clawd, the Claude Code
mascot, plays the lead in all three games: the dog in Save the Dog, a miner in a hard hat in
Pull the Pin, and every runner in Crowd Run, against a violet rival crowd and a boss with its
lid blown open.

The set lives in `ActualGameplay/Art/painted/`: PNGs at 3x, animated clips as
`name_00.png ... name_NN.png`, and a `manifest.json` with each asset's frame count, playback
rate and ground anchor. `Sources/Shared/Painted.swift` reads it: `PaintedSprite` plays clips in
the scenes, and `PaintedImage`, `PaintedClip` and `PaintedFrame` draw them in SwiftUI, cards and
buttons as 9-slices. The drawings themselves are code, in `tools/painted/gameart.js`, and
`tools/painted/render.mjs` renders them against the kit; change the drawing and re-render
rather than editing a PNG (`tools/painted/README.md` has the commands). A painted prop that
kept its old name wins over the Kenney file of the same name (CC0, still in `Art/`), so the
levels needed no changes.

Strokes, liquids, pins and the road are still drawn in code, on purpose: they are the parts the
player makes or that behave like fluids, and a texture would only get in the way. Their colours
come from the kit's palette. Titles, HUD numbers and button labels are set in Permanent Marker
(Font Diner, Apache 2.0), body text in the rounded system font, and icons in Material Symbols
Sharp. Credits for all of it are in `Art/CREDITS.txt`.

## Music

Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 4.0
(http://creativecommons.org/licenses/by/4.0/). Tracks: "Wallpaper", "Pixelland",
"Investigations", "Digital Lemonade". Per-track credits are in `ActualGameplay/Audio/CREDITS.txt`
and in the app's settings screen. Launch with `--silent` to keep automation quiet.

## Layout

- `ActualGameplay/Sources/App`: SwiftUI shell (home, level select, the game container and HUD, settings, autoplay).
- `ActualGameplay/Sources/Shared`: scene base class, session contract, progress store, replay protocol.
- `ActualGameplay/Sources/{SaveDog,PinPull,Runner}`: one folder per mode.
- `ActualGameplay/Levels/<mode>/NN.json`: hand-authored levels, copied into the bundle as a folder.
- `ActualGameplay/Audio/`: the soundtrack and its credits, also copied as a folder.
- `ActualGameplay/Art/`: Kenney sprites and their credits, also copied as a folder.
- `ActualGameplayTests/`: geometry, stroke bodies, level invariants, generator determinism and survivability, progress round trips.
- `scripts/gen-icons.py`: regenerates the Material Symbols glyph enum.
- `scripts/make-icon.py`: draws the app icon.
