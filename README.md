# Actual Gameplay

The three games that only exist in mobile ads, built for real: save-the-dog drawing puzzles,
pin-pull liquid puzzles, and a crowd runner with gates. No ads, no purchases, no network.
iPhone, SwiftUI shell, SpriteKit scenes.

## The games

**Save the Dog.** A dog, a limited pot of ink, and hives full of bees. Draw a shield; it
falls like anything you draw; a moment later the bees stream in and hunt him for ten
seconds. They path-find: a bee with a way in routes around walls and through any gap it
fits through, and a bee with no way in leans on the shield, crawls along it probing, and
joins a shove every few seconds, so footing and mass matter. Twelve levels, each a
different problem: a lid over a pit, one open side of a cave, a hole in a roof, bees rising
through the floor, a boulder to route into a gap, saw blades that cut ink, two dogs with
ink for one shield. Three stars for a low-ink clear.

**Pull the Pin.** Chambers of water and lava held up by pins. Tap a pin to slide it out.
Water and lava cancel each other, lava ends the hero, drains swallow whatever reaches them.
Twelve levels, three stars for clearing at par.

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
sequence wins. For Save the Dog it replays the solution shifted and scaled eight ways and tries five
naive strokes (a bar over the dog, walls beside him, a roof), and flags levels that are
fragile (the wobbled solution loses) or trivial (a naive stroke wins). For Crowd Run it compares greedy steering against never
steering, always-left, and random. Both write per-trial snapshots under `build/`.

Both scripts wait for the simulator to finish booting and warm it up with a throwaway
launch first. A cold simulator answers `simctl launch` while it is still settling, and the
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
screens so a stored solution behaves the same everywhere. A Save the Dog level can carry
`statics` (rect, circle, chain, with a terrain `skin`), `killers` (spike strips), `saws`
(they cut strokes), `props` (a ball or box the physics can move), `decor` (sprites with no
body), `forbidden` (no-ink zones), one or more `dogs`, and `hives` with a count, an
interval, and a delay. Store the solving strokes (Save the Dog) or the pull order (Pull the Pin) as `solution`,
then run the replay and the audit. The retired ball-physics levels the draw mode started
with are kept under `attic/` for reference.

## Art

Sprites, tiles, and backgrounds are from [Kenney](https://kenney.nl) (New Platformer Pack,
Animal Pack Remastered, Background Elements), all CC0. They live in `ActualGameplay/Art/`
next to a `CREDITS.txt`, renamed to what they are used as. Strokes, liquids, and the road
are still drawn in code on purpose: they are the parts the player makes or that behave like
fluids, and a texture would only get in the way.

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
