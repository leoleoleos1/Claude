# Flapling

A retro pixel-art flapping game for the browser, inspired by the classic
one-button "fly between the pipes" genre. All artwork is drawn procedurally and
all sound effects are synthesised with the Web Audio API, so there are no image
or audio files and no copyrighted assets.

Plain HTML5 Canvas, CSS and JavaScript. No build step, no dependencies, no
backend.

## Running locally

Either:

- **Open `index.html` directly** in a modern browser (double-click it). The
  scripts are plain `<script>` files, so `file://` works.
- **Or serve the folder**, which is closer to how it would be deployed:

  ```sh
  python3 -m http.server 8000
  # or: npx serve .
  ```

  Then open <http://localhost:8000>.

To run the headless simulation tests (Node 18+, no packages needed):

```sh
node --test
```

## Controls

| Action  | Keyboard                | Mouse / touch               |
|---------|-------------------------|-----------------------------|
| Flap / start | `Space`, `↑` (or `W`) | Click or tap the game        |
| Pause   | `P` or `Esc`            | Pause button (top left, while playing) |
| Resume  | `Space`, `↑`, `Enter`, `P` | Tap the game              |
| Restart | `Space`, `↑` or `Enter` on the results screen | **Restart** button |
| Mute    | `M`                     | Speaker button (top right)  |
| Customize bird | `C` on the title screen, then `←`/`→` colour, `↑`/`↓` hat, `Esc`/`Enter` done | **Customize** button, arrow buttons, **Done** |

- The first input on the title screen starts the run and flaps.
- Holding a key flaps once; release it to flap again.
- The game pauses automatically when the tab is hidden. When you come back,
  press/tap to resume; a 3-2-1 countdown runs and the bird continues from
  exactly where it was.
- After a crash there is a short cooldown before restarting, so the input that
  caused the crash can't skip the results screen.
- The best score, the mute setting and the chosen bird are stored in `localStorage` (the game
  still works if storage is blocked; the values then last for the session).

## Time of day

Every run starts at midday. Each pipe you pass moves the clock forward a
little (`dayCyclePipes` = 16 pipes for a full cycle), and the sky eases to
the new colours over `dayTransitionTime` seconds: afternoon → golden hour →
sunset → dusk → a starry night with the moon, fireflies and the odd shooting
star → dawn → morning → midday again. The sun and moon move across the sky and
set behind the hills; the scenery, pipes and ground are tinted to match while
the bird stays bright and easy to see. After a run the sky rolls forward to
midday on the title screen.

## Bird customisation

Press **Customize** on the title screen (or `C`) to pick a colour and a hat.
Your choice is equipped and saved immediately. Some items unlock with your
best score:

| Colours | Hats |
|---------|------|
| Sunny, Sky, Berry, Mint, Plum — free | None, Cap, Bow — free |
| Snow — best 10 | Shades — best 5 |
| Gold — best 25 | Party hat — best 10, Crown — best 20 |

Locked items can be previewed but not worn. The catalogue (names, palettes,
pixel art, unlock scores) is in [`js/skins.js`](js/skins.js).

## Tuning the difficulty

All gameplay values are in the `CONFIG` object in [`js/config.js`](js/config.js).
Distances are logical pixels on the fixed 360 × 640 play area; times are seconds.

| Key | Default | Effect |
|-----|---------|--------|
| `gravity` | `1600` | Downward acceleration (px/s²). Higher = heavier, faster falls. |
| `flapVelocity` | `-470` | Upward speed set by each flap (px/s). More negative = bigger hops. |
| `maxFallSpeed` | `640` | Terminal falling speed (px/s). |
| `scrollSpeed` | `150` | How fast pipes approach (px/s). |
| `pipeWidth` | `64` | Width of each pipe (px). |
| `pipeGap` | `150` | Vertical opening between the pipes (px). Smaller = harder. |
| `pipeSpacing` | `210` | Horizontal distance between pipe pairs (px). Smaller = harder. |
| `pipeMaxGapShift` | `170` | Max height difference between neighbouring openings (px). |
| `pipeMarginTop` / `pipeMarginBottom` | `64` | Minimum distance from openings to the top / ground (px). |
| `firstPipeDistance` | `160` | Extra run-up before the first pipe (px). |
| `birdSize` | `34 × 24` | Drawn bird size (px). |
| `birdHitboxRatio` | `0.46` | Collision circle radius as a fraction of the bird height (lower = more forgiving). |
| `groundHeight` | `96` | Height of the ground strip (px). |
| `restartCooldown`, `resumeCountdown` | `0.45`, `1.5` | Timing of the results screen and the resume countdown (s). |
| `dayCyclePipes`, `dayTransitionTime` | `16`, `1.2` | Pipes per full day/night cycle; seconds per sky transition. |

Difficulty is intentionally constant throughout a run.

## Project structure

```
index.html          Page, canvas and accessible overlay buttons
css/style.css       Layout: centred, scaled 9:16 frame; blocks scrolling/gestures
assets/icon.svg     Favicon
js/config.js        CONFIG (tuning) and LAYOUT (menu positions)
js/util.js          Math helpers, seeded RNG, circle-vs-rectangle collision
js/storage.js       Safe localStorage wrapper (best score, mute)
js/audio.js         Web Audio sound effects (flap, score, hit, fall, game over)
js/font.js          Original 5×7 bitmap font with outline rendering
js/daycycle.js      Time-of-day keyframes: sky colours, scenery tint, stars, sun/moon paths
js/skins.js         Bird colours and hats (pixel art + unlock scores)
js/sprites.js       Procedural pixel art: bird, pipes, ground, parallax layers, medals
js/world.js         Simulation: physics, pipes, collisions, scoring, particles
js/game.js          State machine: ready (⇄ customize) → playing ⇄ paused → dying → game over
js/renderer.js      Draws the world, HUD and menus
js/input.js         Keyboard + Pointer Events → game actions
js/ui.js            DOM buttons (mute, pause, restart) and screen-reader announcements
js/main.js          Boot, responsive/high-DPI sizing, fixed-timestep loop, visibility
tests/              Node tests for the simulation, day cycle and state machine
```

### Technical notes

- **Fixed timestep.** The simulation always advances in 1/120 s steps from a
  time accumulator; rendering interpolates between steps. Physics is identical
  at 30, 60 or 144 Hz (covered by a test). Frame gaps are clamped to 0.1 s, and
  the clock is reset when the tab becomes visible again.
- **Resolution independence.** Gameplay runs in a logical 360 × 640 space. The
  canvas backing store is sized to the physical pixels of the scaled frame
  (`devicePixelRatio`-aware) and drawn with smoothing disabled, so pixel art
  stays crisp and resizing never changes physics or collisions.
- **Collisions.** The bird uses a circle slightly smaller than its sprite;
  pipes are tested as four rectangles (two bodies, two wider caps).
- **Fair obstacles.** Openings stay within the margins and never move more
  than `pipeMaxGapShift` between neighbours. A simple autopilot clears every
  generated course in the tests.
- **Scoring.** A pair scores when the bird's hitbox has fully cleared it; each
  pair has a `scored` flag so it can only count once.
- **Reduced motion.** With `prefers-reduced-motion`, screen shake, particles,
  title bobbing, score pop and panel slide-in are disabled and the collision
  flash is softened.
