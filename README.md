# Actual Gameplay

The three games that only exist in mobile ads, built for real: save-the-character drawing puzzles,
pin-pull liquid puzzles, and a crowd runner with gates. No ads, no purchases, no network.
iPhone, SwiftUI shell, SpriteKit scenes.

## The games

**Save the Clawd.** Clawd, a limited pot of ink, and hives full of bees. Draw a shield; it
falls like anything you draw; a moment later the bees stream in and hunt him for ten
seconds. They path-find: a bee with a way in routes around walls and through any gap it
fits through. Bees with no way in work as a crew: they pick the least secure loose part of
the shield they can reach, line up along it, wind up, and heave on it together, alternating
the middle and the far end, straight and tilted up, and move on to the next weakest part
when one will not budge. Footing and mass decide what survives, so a bar balanced on a
point or a lid resting on him goes, and a shape that stands on its own feet holds. Sixteen levels,
each a different problem: a lid over a pit, a plinth in the water with a socket to fit, a hole in a
roof and only enough ink to plug it, one open side of a low cave, two of them on facing cliffs
over lava, a step beside a moat with the far bank as the only other footing, blades at his feet
with posts beyond them, saws either side of a slope, a no-ink zone right over his head, bees
rising through the floor, a boulder to route into a gap, a plinth in the moat. Water and lava
are real hazards: ink that lands in them sinks, and so does he. Three stars for a low-ink clear.

**Pull the Pin.** Chambers of water and lava held up by pins. Tap a pin to slide it out.
Water and lava cancel each other, lava ends the hero and melts the gem, drains swallow
whatever reaches them, and grates take the liquid while anything solid drops through.
Seven of the twelve levels are towers: the hero starts on an upper floor and comes down as
pins go, goblins wait in the chambers and have to be flooded, burned or dropped into a pit
before he passes, slabs and tilted pins pour a chamber sideways through a side door, and a
gem sometimes rides the water. Each level has exactly one pull order that wins: every other
order burns the hero, melts the gem, hands him to a goblin, or throws away the water you
needed. The pull count stays low on purpose. Water and lava cancel one for one no matter
what order they meet in, so a level that needs two fires put out has two answers, not one;
the forcing always comes from a victim in the way, and the difficulty is in which pin, not
how many.

**Crowd Run.** Drag to steer a crowd down a road. Green gates grow it, red ones shrink it,
walls and blades and spikes thin it, and whatever is left fights a crowd or a boss at the
end. Endless and procedural (the same run is the same track on every device), with coins
that buy a bigger starting crowd, stronger runners, and a coin bonus between runs. Prices
follow what each level buys: `scripts/economy.py` plays every run as a probability tree for an
imperfect player and prices each upgrade level at the same number of wins per point of win
odds, so the shop can say "+5% odds at run 16" next to the cost. Rivals are sized to the
base crowd of five, so extra starting runners are a real edge rather than a bigger fight.

## Play in a browser

The same three games run as a web app at https://baestheorem.github.io/actual-gameplay/, on a
phone or a desktop. It installs to a home screen, and progress stays in that browser. The web
build is the game now: new levels and new modes are made there, and the iPhone app keeps the
levels it shipped with.

The web build is in `web/`: TypeScript, [planck.js](https://github.com/piqnt/planck.js) for
physics and [PixiJS](https://github.com/pixijs/pixijs) for drawing. It reads the art and the
audio from `ActualGameplay/`, so there is one copy of each. Each game's rules live in
`web/src/sim/` as a simulation with no drawing in it, which is what lets the level checks run in
Node with no simulator:

    cd web && npm install
    npm run dev                      build the art sheets and the level bundle, then serve with reload
    npm test                         unit tests
    npm run replay -- pinPull        play every stored solution: pinPull, saveDog or runner
    npm run audit -- pinPull         every pull order up to par; each level must report UNIQUE
    npm run stats                    measure the levels that changed: the share of random play that wins
    npm run stats -- --check         exit 1 if a level has no number, or a stale one
    npm run build                    type-check and write web/dist

### Levels and chapters

A level is one file, `web/levels/<folder>/<id>.json`. The folder is `pinpull` or `savedog`, and
the id is a kebab-case slug made from the level's name, such as `two-ways-down`. The id is the
file's name, it is what a save and a route use (`#/pinPull/two-ways-down`), and it never changes.
`chapters.json` in the same folder puts the levels in play order: a list of chapters, each with
an `id`, a `title`, a one-line `blurb` and its `levels` by id. The label a player sees, "1-3", is
the chapter's id and the level's place in that chapter. It is worked out from the chapter list
each time, so a level can move to another chapter without anyone losing its stars.

To add a level, write the file with its solution in it and list its id in a chapter. Then run
the replay, the audit and `npm run stats`. The loader (`web/scripts/levels.ts`) stops on a level
file that no chapter lists and on a chapter entry with no file, and names the culprit. The format
of a level is the one under "Adding a level" below.

A mode is one row of the table in `web/src/app/modetable.ts`: its name and look, and either its
level folder or `kind: "runner"` for the endless one. The level list, the routes, the save and
the statistics all follow that table. A new mode with levels needs a row there, a scene branch
in `web/src/app/modes.ts`, and a way to measure it in `web/scripts/stats.ts`.

### The real number

The ads say "only 1% can solve this". `npm run stats` works out the real number for every level:
the share of random play that wins it.

For Pull the Pin the number is exact. A random player pulls any pin still in place, each as
likely as the next, every time the world has settled, and keeps going past par until the level
is won or lost. Every pull order is played out and the chances of the winning ones are added up.
A level with more than 400 orders to play is sampled with 300 random ones and marked as an
estimate.

For Save the Clawd the number is a sample: 48 plausible random strokes, each tried as the only
stroke, and the share of them that survive.

The numbers live in `web/levels/stats.json`, each stamped with the SHA-256 of the level file it
was measured on. A level whose file has not changed is skipped, `--force` measures everything
again, and the build gives the app a number only when it matches the level as it is now. The
statistics and the two level audits run their simulations in two processes at once
(`web/scripts/parallel.ts`) and print in play order.

The game shows the number in the ads' own voice and says what was measured. In a level it is a
paper sticker under the HUD: "ONLY 8%" over "of random pulls win", "UNDER 2%" when no random try
won (one win in 48 would have been 2%), "WARM-UP" when random play wins half the time or more.
The level list tags every level at 10% or less, and the result card says it once more in a line.
The wording is about random pulls and random doodles. Players were not measured, so it never
mentions them.

### Fails and hints

The ads show a hand that fails, and then an ad. Here a fail says why. From the second loss on a
level the card also offers "Hint (no ad)": Pull the Pin rings the pins of the stored solution in
the order to pull them, one pin more with each hint taken, and Save the Clawd shows the stored
strokes as a dotted ghost. Both last four seconds. A level with no stored solution offers nothing.

### Pull the Pin's walking rules

A Pull the Pin level that says `"rules": 2` plays by the walking rules. A level without it plays
exactly as it always did, and every newer field in it is ignored. Under the walking rules:

- **Characters walk.** The hero goes for the gem, the exit, the gem and then the exit, or the
  friend, by the level's `winWhen` (`heroReachesFriend` is new). A goblin goes for the hero or the
  friend, the nearer one if it can reach both. The friend (`actors.friend`) never walks. A walker
  needs a route: a probe steps along the floor six points at a time, sixty steps at most, and
  stops at anything solid at body height, at a ceiling less than 34 points up, and at a floor
  that rises or falls more than 8 points in one step. So a slope of up to 53 degrees is a road
  and a ledge is not. The hero walks at 70 points a second and a goblin at 55. The hero will not
  set out on a route with lava, gas, a lit bomb or a living goblin on it. Water does not stop
  him, and nothing stops a goblin.
- **Boulders** (`boulders: [{x, y, r?}]`) roll. One that meets a character at 120 points a second
  or more, measured between the two of them, flattens him.
- **Bombs and cracked walls** (`bombs: [{x, y}]`, `cracked: [rect]`). Lava lights a dry bomb and
  it goes off 0.7 s later. Water on a bomb that is not lit makes it a dud for good. A blast
  reaches 64 points: it takes out every cracked wall that near, and whatever it can see inside
  that reach is knocked out, killed, lit or thrown.
- **Linked pins** (`"group": "a"` on a pin) are pulled by one tap and count as one pull.
- **Plates and doors** (`plates: [{id, x, y, w, opens}]`, `doors: [{id, x, y, w, h, slide, latch?}]`).
  A door slides open while something solid rests on one of its plates.
- **Gas and vents** (a pool with `"liquid": "gas"`, `vents: [rect]`). Gas rises, goes through
  liquids and characters, and ends whoever breathes it. A vent takes it, and so does the top
  edge of the playfield.

Every number is a named constant in `web/src/sim/pinpull/level.ts` or `route.ts`, with the rule
it belongs to written beside it. Three tools go with the rules:

    npx tsx scripts/film.ts pinPull <level id | file.json> [--pins p1,p2]         a run as one picture, a frame every half second
    npx tsx scripts/pin-suite.ts play|audit|odds <level id | file.json> [p1,p2]   one level: a pull order, the audit, the odds
    #/pinPull/~<name>                                                             web/public/lab/pinpull/<name>.json, in the game

The film needs no browser and writes `build/film/<level>-<pins>.png`. The lab route plays a level
file that is in no chapter, with no sticker and nothing saved, under the title "Lab: <name>". It
reads `public/lab/<mode folder>/`, so any mode with levels can be looked at the same way. Seven
small levels are in the lab, one for each of the newer pieces.

### Checks and deploys

A push to `main` runs the tests, the replays and the stats check, then deploys `web/dist` to
GitHub Pages (`.github/workflows/pages.yml`). A stored solution that stops winning stops the
deploy, and so does a level whose number is missing or out of date.

`web/scripts/shots.py` drives the built site in headless Chromium, with the sound muted, and
saves screenshots to `build/webtest/`. Run it through `web/scripts/browser-lock.sh`, which lets
one headless browser run at a time.

Two things differ from SpriteKit on purpose. The physics world never sleeps a body, because a
liquid here is a pile of slow circles and a sleeping pile stops spreading (Mind the hole depends
on the last few points of that spread). And the step is a fixed 1/60 s whatever the display rate.
`DESIGN.md` holds the look both builds share.

## Build the iPhone app

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
already died, and reports each level as UNIQUE or lists the other orders that win. For Save the Clawd it replays the solution shifted and scaled eight ways and tries five
naive strokes (a bar over him, walls beside him, a roof), and flags levels that are
fragile (the wobbled solution loses) or trivial (a naive stroke wins). For Crowd Run it compares greedy steering against never
steering, always-left, and random. Both write per-trial snapshots under `build/`.

Three more tools sit beside them, for designing rather than checking:

    scripts/preview.py pinPull|saveDog [NN ...]   draw a level file as an annotated picture, no simulator
    scripts/replay.py saveDog --film              save a frame every half second and tile each run into a strip
    scripts/audit.py saveDog --random 16          add sixteen plausible random strokes per level; report the share that win
    scripts/economy.py                            Crowd Run's economy as arithmetic: win odds, prices, and a check of the Swift tables

The preview draws the geometry with the things that decide whether a level works: where each
pool falls once its pin goes and onto what, how far the gem sits from lava on the same shelf and
whether a divider stands between them, where a stored stroke rests on something solid, how much
ink it spends against the star lines, and which openings at his height a bee could fit through.
The film turns a replay into a contact sheet of the run so a failure can be read as a sequence
instead of guessed from its last frame. The random strokes give a level a difficulty number: a
level a quarter of them beat is easy, whatever its stored solution looks like.

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
pin goes, not on the shelf beforehand. A Save the Clawd level can carry
`statics` (rect, circle, chain, with a terrain `skin`), `killers` (spike strips), `saws`
(they cut strokes), `props` (a ball or box the physics can move), `decor` (sprites with no
body), `forbidden` (no-ink zones), one or more `dogs`, and `hives` with a count, an
interval, and a delay. Store the solving strokes (Save the Clawd) or the pull order (Pull the Pin) as `solution`,
then run the replay and the audit. The retired ball-physics levels the draw mode started
with are kept under `attic/` for reference.

## Art

The art is painted: flat watercolour washes and ink outlines on paper, drawn with the
[Claude Animation Base](https://github.com/JohnHeibel/ClaudeAnimationBase) kit (p5.js and
p5.brush, MIT) through the fork at `~/Documents/claude-animation`. Clawd, the Claude Code
mascot, plays the lead in all three games: the one to protect in Save the Clawd, a miner in a hard hat in
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

## Music and sound

Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 4.0
(http://creativecommons.org/licenses/by/4.0/). Tracks: "Wallpaper", "Pixelland",
"Investigations", "Digital Lemonade". Per-track credits are in `ActualGameplay/Audio/CREDITS.txt`
and in the app's settings screen. Launch with `--silent` to keep automation quiet.

The effects in `ActualGameplay/Audio/sfx/` are Kenney's Impact, Interface, Digital and RPG audio
packs (CC0), the organic pack of Romain Simon's [UI SFX](https://github.com/romainsimon/uisfx) for
the menus (CC0), and thirteen sounds generated for the game: the bee buzz, the pen scratch and the saw
whir (loops), the splash, the sizzle and the bees' heave, and Pull the Pin's blast, fuse, boulder,
breaking wall, plate, door and gas. `tools/sfx/make_synth.py` rebuilds them: on
its own it regenerates the generated ones, and with `--fetch` it downloads the packs and redoes the
picks. `Sources/Shared/Audio.swift` maps each `SoundEvent` to its files and volume; the files are
matched for loudness, so those volumes are the mix. Effects have their own switch in Settings, and
`--silent` mutes them along with the music. Everything in `Audio/` ships in the app, the script
included, so keep scratch files (a `__pycache__`, say) out of it. `CREDITS.txt` lists every file and
where it came from.

## Layout

- `ActualGameplay/Sources/App`: SwiftUI shell (home, level select, the game container and HUD, settings, autoplay).
- `ActualGameplay/Sources/Shared`: scene base class, session contract, progress store, replay protocol.
- `ActualGameplay/Sources/{SaveDog,PinPull,Runner}`: one folder per mode.
- `ActualGameplay/Levels/<mode>/NN.json`: hand-authored levels, copied into the bundle as a folder.
- `ActualGameplay/Audio/`: the soundtrack, the effects in `sfx/` and the script that makes them, and their credits, also copied as a folder.
- `ActualGameplay/Art/`: Kenney sprites and their credits, also copied as a folder.
- `ActualGameplayTests/`: geometry, stroke bodies, level invariants, generator determinism and survivability, progress round trips.
- `scripts/gen-icons.py`: regenerates the Material Symbols glyph enum.
- `scripts/make-icon.py`: draws the app icon.
