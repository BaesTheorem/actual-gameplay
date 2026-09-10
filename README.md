# Actual Gameplay

The three games that only exist in mobile ads, built for real: draw-a-line physics puzzles,
pin-pull liquid puzzles, and a crowd runner with gates. No ads, no purchases, no network.
iPhone, SwiftUI shell, SpriteKit scenes.

## The games

**Draw a Line.** Sketch a stroke and it becomes a rigid body: it falls, wedges, bridges, tips
levers. Get the ball to the gold. Ink is limited, the world is frozen until your first stroke
lands, and running out of ink with nothing moving is a loss. Twelve levels, three stars for a
low-ink clear.

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

    scripts/replay.py drawLine|pinPull|runner   play every stored solution, report pass/fail
    scripts/audit.py  drawLine|pinPull|runner   stress the levels

The replay is the regression suite: after touching physics or a level file, it must be 12/12.
The audit asks the questions a replay cannot. For Pull the Pin it tries every single pin,
every ordered pair, and everything in order and reversed, and flags a level where a naive
sequence wins. For Draw a Line it replays the solution shifted and scaled eight ways and
tries five dumb strokes, and flags levels that are fragile (the wobbled solution loses) or
trivial (a dumb stroke wins). For Crowd Run it compares greedy steering against never
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

Drop a JSON file into `ActualGameplay/Levels/<drawline|pinpull>/NN.json`. The folder is
copied into the bundle as a folder reference, so no project change is needed. Coordinates
are a fixed 402 x 874 point canvas, origin bottom-left, and the scene letterboxes on other
screens so a stored solution behaves the same everywhere. Solve the level once with
"Copy solving strokes to clipboard" on in Settings (Draw a Line) or note the pull order
(Pull the Pin), paste that in as `solution`, then run the replay and the audit.

## Music

Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 4.0
(http://creativecommons.org/licenses/by/4.0/). Tracks: "Wallpaper", "Pixelland",
"Investigations", "Digital Lemonade". Per-track credits are in `ActualGameplay/Audio/CREDITS.txt`
and in the app's settings screen. Launch with `--silent` to keep automation quiet.

## Layout

- `ActualGameplay/Sources/App`: SwiftUI shell (home, level select, the game container and HUD, settings, autoplay).
- `ActualGameplay/Sources/Shared`: scene base class, session contract, progress store, replay protocol.
- `ActualGameplay/Sources/{DrawLine,PinPull,Runner}`: one folder per mode.
- `ActualGameplay/Levels/<mode>/NN.json`: hand-authored levels, copied into the bundle as a folder.
- `ActualGameplay/Audio/`: the soundtrack and its credits, also copied as a folder.
- `ActualGameplayTests/`: geometry, stroke bodies, level invariants, generator determinism and survivability, progress round trips.
- `scripts/gen-icons.py`: regenerates the Material Symbols glyph enum.
- `scripts/make-icon.py`: draws the app icon.
