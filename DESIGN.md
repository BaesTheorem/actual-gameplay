# Design

The look is locked. It was set in the iPhone app (`ActualGameplay/Sources/App/Theme.swift`,
`Shared/Painted.swift`) and the web build (`web/`) copies it value for value. Change it here
first, then in both builds.

**Mood.** Watercolour and ink on paper: flat washes, a hand-drawn ink outline, nothing glossy.

**Reference.** The Claude Animation Base kit's painted cartoons, which is also where the art is
drawn (`tools/painted/`).

## Type

| Use | Font |
| --- | --- |
| Titles, HUD numbers, button labels, level numbers | Permanent Marker (Font Diner, Apache 2.0) |
| Body text | the rounded system font (`ui-rounded`), 13 to 15 pt |
| Icons | Material Symbols Sharp, drawn by codepoint, 24 pt |

## Palette

Five tokens carry the interface. The names are the kit's pigment names.

| Token | Hex | Use |
| --- | --- | --- |
| `paper` | `#F3EBDC` | every background, under the paper texture |
| `ink` | `#2B2233` | text, outlines, icons. Never pure black |
| `cream` | `#FFF5E2` | cards, plates, pins. Stands in for white |
| `clay` | `#D97757` | the primary action, Clawd, lava, Pull the Pin's accent |
| `sap` | `#6E9F58` | switches that are on, Crowd Run's accent |

Scene colours come from the same kit and are used only for things in the games: `sky #8EC3E6`
(Save the Clawd's accent, water rim), `teal #3A9C98` (water), `ochre #E8AA38` (gold, lava rim),
`rose #E27A92` (danger, the destructive button), `violet #7B5CA8` (rivals), `night #1F2550`
(drains). Muted text is `ink` at 65%.

## Layout

- One canvas of 402 x 874 points (iPhone 16 Pro). Every screen is laid out on it and the whole
  stage scales to fit the window, so a level and its chrome are the same on every screen.
- Spacing is in 4 pt steps: 20 for screen padding, 16 between sections, 12 in grids, 10 between
  buttons. This is the iPhone app's layout and it is not on an 8 pt scale.
- Touch targets are 44 pt or larger.

## Shape

- Cards and buttons are painted 9-slice pieces (`ui_card`, `ui_button_*`), so their corners are
  the brush's. Do not add CSS borders or radii to them.
- A shape drawn in code (a hint plate, a pin, a progress bar) uses a 2 pt ink outline and one
  corner radius: 6 pt for plates, 3 pt for pins.
- No gradients and no shadows, anywhere. Depth comes from the ink outline and from overlap.

## Motion

Decorative motion (bounces, shakes, fades) shortens to 0.1 s or stops when the system asks for
reduced motion. Clawd's clips still play: they are the character acting in place.
