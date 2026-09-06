# Actual Gameplay

The three games that only exist in mobile ads, built for real: draw-a-line physics puzzles,
pin-pull liquid puzzles, and a crowd runner with gates. No ads, no purchases, no network.
iPhone, SwiftUI shell, SpriteKit scenes.

## Build

Requires Xcode 26 and [XcodeGen](https://github.com/yonaskolb/XcodeGen). The
`.xcodeproj` is generated and never committed.

Two gitignored files hold machine-local values; copy the examples:

- `Config/Signing.xcconfig` from `Signing.example.xcconfig`: your Apple developer team id.
- `Config/device.env` from `device.env.example`: the UDID of the iPhone to install to
  (`xcrun devicectl list devices`).

Then:

    scripts/build-install.sh    # signed Release build, installs over WiFi
    scripts/test.sh             # unit tests on the simulator
    REPLAY=1 scripts/test.sh    # replays every level's stored solution

## Music

Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 4.0
(http://creativecommons.org/licenses/by/4.0/). Tracks: "Wallpaper", "Pixelland",
"Investigations", "Digital Lemonade". Per-track credits are in `ActualGameplay/Audio/CREDITS.txt`
and in the app's settings screen. Launch with `--silent` to keep automation quiet.

## Layout

- `ActualGameplay/Sources/App`: SwiftUI shell (home, settings, the game container and HUD).
- `ActualGameplay/Sources/Shared`: scene base class, session contract, progress store.
- `ActualGameplay/Sources/{DrawLine,PinPull,Runner}`: one folder per mode.
- `ActualGameplay/Levels/<mode>/NN.json`: hand-authored levels, copied into the bundle as a folder.
- `ActualGameplay/Audio/`: the soundtrack and its credits, also copied as a folder.
- `scripts/gen-icons.py`: regenerates the Material Symbols glyph enum.
- `scripts/make-icon.py`: draws the app icon.

Levels are authored in a fixed 402 x 874 point canvas (origin bottom-left) and the scene
letterboxes on other screens, so a stored solution behaves the same on every device.
