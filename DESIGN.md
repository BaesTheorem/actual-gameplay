# Design

The look is locked. It was set in the iPhone app (`ActualGameplay/Sources/App/Theme.swift`,
`Shared/Painted.swift`) and the web build (`web/`) copies it value for value. The web build is
where the game grows now, so what was added there (chapters, the sticker, the stamp, the effects)
is written down here too. Change it here first.

**Mood.** Watercolour and ink on paper: flat washes, a hand-drawn ink outline, nothing glossy.

**Reference.** The Claude Animation Base kit's painted cartoons, which is also where the art is
drawn (`tools/painted/`).

## Type

| Use | Font |
| --- | --- |
| Titles, HUD numbers, button labels, level numbers, and anything that shouts (the stamp, the sticker's big line, a number that floats off a gate) | Permanent Marker (Font Diner, Apache 2.0) |
| Body text | the rounded system font (`ui-rounded`), 13 to 15 pt |
| Small print (the sticker's second line, a tile's tag) | 10 to 11 pt, bold where it is body text |
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

## Level list

One screen per mode with levels. The header is the back button, the mode's title, and the stars
earned out of the stars there are ("14/36") beside a painted star. Under it, each chapter: its
id on a small plate and its title in Permanent Marker, its blurb in muted body text, and a grid
of tiles, four to a row. A tile shows the level's place in the chapter and its stars. Every tile
is open. Nothing is locked.

A level whose number shows as 10% or less carries it as a corner tag ("3%", or "<2%" when no
random try won): rose, 2 pt ink outline, 6 pt radius, Permanent Marker at 11 pt, turned 6
degrees, hung on the tile's top right corner.

## The sticker

A level's measured difficulty is a paper sticker, in the voice of the ads and with the number
that was measured. It sits at the top right just under the HUD, in the band above the hint. It
laps the hint plate's edge and stops short of the plate's words.

- Cream, 2 pt ink outline, 6 pt radius, 36 pt tall, turned 2 degrees.
- A big line in Permanent Marker at 18 pt: rose for "ONLY 8%" and "UNDER 2%", sap for "WARM-UP".
- A small line in bold body text at 10 pt: "of random pulls win".
- It takes no touches. After three seconds it fades to 45% so it stops competing with the level.
- The bar under the HUD stops 8 pt short of it.

The words say what was measured and nothing else: random pulls, random doodles. Never "players".

## The result card

The title is a rubber stamp: Permanent Marker at 34 pt inside a 3 pt border of its own colour,
6 pt radius, turned 6 degrees counterclockwise. Sap "CLEARED" or rose "FAIL". It lands by scaling
from 2 to 1 in 120 ms. Under it: the reason for a loss, then one muted line with the level's
number. Clay marks the obvious next step (Next after a win, Retry after a loss), and from the
second loss on a level a paper button offers "Hint (no ad)".

A hint is drawn in the level, lasts four seconds and fades: an ochre ring with an ink edge and a
numbered cream plate on each pin to pull, pulsing, or the strokes to draw as a row of ink dots.

## Effects

Small effects mark the moments that matter: a splash, steam, a gem picked up, ink landing, a gate
taken, a win. They come from one kit (`Fx` in `web/src/scenes/kit.ts`) and follow four rules.

- Flat. A piece is one wash of a palette colour: a dot, a drop, a shard, a paper bit or a
  four-point star. No gradients and no glow.
- Outlined. A piece carries a thin ink line, as everything painted does. Ink flecks and sawdust
  are ink already and need none.
- Short. A burst is 5 to 10 pieces and is over in half a second. A ring opens and fades in
  0.35 s, a floating number in 0.9 s. Confetti, for a win only, is 40 paper bits and two seconds.
  A shake is 3 to 5 pt and dies away in 0.3 s. The level has to stay readable through all of it.
- Off under reduced motion. No shake and no confetti, and a burst has a third of its pieces.
  Rings and floating numbers stay, because a number is information.

Colour follows meaning. A liquid throws drops the colour of its own rim (sky for water, ochre for
lava), the gem throws ochre sparks, steam is cream, ink is ink, a gain is sap and a loss is rose.

## Motion

Decorative motion (bounces, shakes, fades) shortens to 0.1 s or stops when the system asks for
reduced motion. Clawd's clips still play: they are the character acting in place. The stamp
lands without its scale, and the sticker's fade takes 0.1 s.
