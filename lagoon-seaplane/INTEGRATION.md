# Lagoon seaplane: integration guide

A self-contained, flyable, enterable bush seaplane (DHC-2 style on twin floats) for a
Three.js **r169** first-person game. Everything is procedural: geometry, textures
(GPU-baked paint and weathering), instruments (canvas), sound (WebAudio). There are
no asset files and no runtime dependencies besides `three` and `three/addons`.

```
seaplane/Seaplane.js        createSeaplane(): public API (the only file you need to import)
seaplane/physics.js         6-DOF rigid body, aerodynamics, floats/hydro, contacts, damage
seaplane/engine.js          radial engine + constant-speed prop, fuel, temperatures
seaplane/controls.js        KEYMAP, input smoothing, mouse-yoke, commands
seaplane/camera.js          seat camera (head spring), chase camera
seaplane/interaction.js     interactables, walk/block shapes, boarding & exit
seaplane/effects.js         particles, prop blur disc, light glows, landing beam, rain on glass
seaplane/audio.js           createSeaplaneAudio(): procedural sound (AudioWorklet)
seaplane/model/*.js         geometry, atlas, paint bake, materials, cockpit, instruments, base kit
sandbox/*                   test bench only (never imported by seaplane/*)
```

Module syntax follows the contract: only `export function/class/const`, named
imports, `import * as THREE from 'three'`, no default exports, no export lists,
no dynamic `import()`, no `import.meta`, no top-level `await`, no import cycles.

---

## 1. Quick start

```js
import * as THREE from 'three';
import { createSeaplane } from './seaplane/Seaplane.js';

const plane = createSeaplane({
  scene, renderer, camera,             // camera = the player camera (LOD, audio, effects)
  quality: 'high',                     // 'high' | 'low'
  assist: 'normal',                    // 'arcade' | 'normal' | 'realistic'
  useOwnEffects: true,                 // built-in particles (env.emit hooks fire either way)
  realLandingLight: false,             // optional single SpotLight (see 6.)
  seed: 7,
  env: {
    waterHeight: (x, z) => ocean.heightAt(x, z),
    waterFlow: (x, z, out) => out.set(0, 0, 0),          // optional
    groundHeight: (x, z) => terrain.heightAt(x, z),      // -Infinity where there is none
    groundNormal: (x, z, out) => terrain.normalAt(x, z, out), // optional
    contact: (p, r, out) => world.sphereContact(p, r, out),   // see 3.
    wind: windVector,                  // live THREE.Vector3 (m/s), read every step
    sunDirection: sunDir,              // live THREE.Vector3 (unit, toward the sun)
    night: () => nightFactor,          // 0..1
    rain: () => rainFactor,            // 0..1
    wetness: () => wet,                // optional 0..1, overrides the built-in estimate
    worldLimit: (x, y, z, out) => false, // optional: return true + push-back accel in out
    emit: (type, data) => {},          // optional effect / sound / gameplay hooks (see 7.)
  },
  audio: { ctx: audioContext, out: sfxBus }, // optional, or call plane.setAudio() later
});

await plane.ready;                     // geometry, atlas, paint bake, gauges (~1 s)
plane.placeOnBeach(x, z, yaw);         // or placeOnWater / placeInAir / reset
plane.setMooringPoints(pierPosts);     // optional: [{ position: Vector3 }] for "Tie up"
plane.prewarm(renderer, camera);       // compile every program variant up front
plane.attachInput(renderer.domElement); // or drive plane.setControls() yourself

// every frame (host owns the loop):
plane.update(dt);                      // dt in seconds; clamped to 0.1 internally
if (plane.seated) {
  if (plane.cameraMode === 'chase') plane.getChaseCamera(camera.position, camera.quaternion);
  else plane.getSeatCamera(lookYaw, lookPitch, camera.position, camera.quaternion);
  camera.fov = baseFov + plane.fovDelta; camera.updateProjectionMatrix();
}
```

`root` (the plane, moved by the module) and `worldRoot` (world-space helpers:
particles, ropes, chocks, light pool, wreck debris) are added to `scene` when `scene` is passed;
otherwise add them yourself. `dispose()` removes both and frees GPU resources.
The module never touches `window`, pointer lock, `requestAnimationFrame`,
`setAnimationLoop`, renderer settings or `THREE.ShaderChunk`.

---

## 2. Units and frames

- Metres, kilograms, seconds, radians. **+Y up**, sea level **y = 0**.
- Plane-local frame: **nose toward -Z**, **right wing toward +X**, **up +Y**, origin at
  the centre of gravity at rest (the CG shifts slightly with fuel / pilot / cargo; the
  frame origin does not).
- `plane.root.matrixWorld` is the plane frame (render-interpolated pose).
- Heading in `state.heading`: 0 = north (-Z), clockwise positive, radians.
  `state.pitch` nose up positive, `state.roll` right wing down positive.

---

## 3. Environment callbacks

| callback | called | contract |
|---|---|---|
| `waterHeight(x, z)` | ~60x per physics step on the water, a few per frame for effects | rendered sea surface **including waves** at the current time. Must match what the player sees, or the floats float above / sink into the drawn water. |
| `waterFlow(x, z, out)` | 2x per step on the water | optional current (m/s) written into `out`. |
| `groundHeight(x, z)` | ~3-10x per step near land, 1x elsewhere | terrain / seabed height or `-Infinity`. Used for beaching, scraping, chocks and the turbulence model (thermals over land). |
| `groundNormal(x, z, out)` | rarely | optional; finite differences are used otherwise. |
| `contact(p, r, out)` | 1x per step + per contact point when near something | static world: return `true` and set `out.normal` (unit, pointing out of the obstacle) and `out.depth` (penetration, m) if the sphere `(p, r)` overlaps. Rocks, trees, the pier, buildings. Keep it fast (spatial hash) - the radius-9 query around the CG decides whether the per-point queries run. |
| `wind` | every step | `THREE.Vector3`, m/s, world space. Gusts and thermals are added inside. |
| `sunDirection` | every frame | unit vector toward the sun (spray backlighting, prop-disc flicker). |
| `night()` | every frame | 0 day .. 1 night: instrument backlight, glows, beam. Nothing glows unless switched on. |
| `rain()` | every frame | 0..1: windscreen droplets, wetness, turbulence. |
| `wetness()` | every frame | optional; otherwise wetness follows rain, spray and dunking, and dries slowly. `plane.setWetness(v)` overrides both (`null` to release). |
| `worldLimit(x, y, z, out)` | every step | optional soft boundary: return `true` and write a push-back **acceleration** (m/s²) into `out`. |
| `emit(type, data)` | on events | see 7. |

Performance note: on the water the physics spends most of its time inside
`waterHeight`. In the sandbox (6 Gerstner waves, fixed-point inverse) the whole
`plane.update` costs ~0.23 ms/frame taxiing and ~0.11 ms/frame flying.

---

## 4. Public API

### Properties
| name | description |
|---|---|
| `root`, `worldRoot` | `THREE.Group`s (see 1.). |
| `ready` | `Promise` resolving to the API when generation is done. Most calls are safe before, but interactables/walk shapes are empty until then. |
| `state` | read-only snapshot updated every frame: `airspeed, groundSpeed, altitude, agl, vs, heading, pitch, roll, rpm, throttle, flaps (deg), flapIndex, trim, engine ('off'|'cranking'|'running'|'stalled'|'dead'), fuel[L,R] (litres), onWater, planing, beached, moored, seated, seatId, stall (0..1), stallWarning, gLoad, damage {wingL, wingR, floatL, floatR, prop, engine, tail, windscreen, hull} (1 = intact), detached {wingTipL, wingTipR, floatL, floatR, prop}, wreck, lod, interiorVisible, cameraMode, waterRudderDown, lights, doors {doorL, doorR, cargo}, assist, quality, physicsMs, buildMs, exitProgress (0..1 while holding E), hint ({key, text} or null)`. |
| `hudData` | small HUD-ready subset (`throttlePct, airspeedKt, altitudeFt, vsFpm, flapsDeg, engine, stallWarning, hint, rpm, trim, fuelL, fuelR, waterRudders`). The module renders no HUD. |
| `interactables`, `walkShapes`, `blockShapes` | see 5. |
| `handTargets` | `{ left, right }` `Object3D`s (children of `root`) on the yoke horns / throttle knob. The right hand moves to the throttle while the throttle changes and returns to the yoke ~1.5 s later. |
| `handPose` | `{ left: 'grip', right: 'grip'|'lever' }`. |
| `seated`, `cameraMode` | `cameraMode` is `'cockpit'`, `'chase'` (toggled with V or settable) or `'external'` when not seated. |
| `fovDelta` | degrees to add to the host FOV in the cockpit (grows with airspeed). |
| `KEYMAP` | this plane's (mutable) copy of the key map. |
| `lights` | `{ nav, landing }` (also cycled with L). |
| `onEvent` | optional host callback `(type, data)`, same stream as `env.emit`. |
| `debris` | world-space `Object3D`s (children of `worldRoot`) of the pieces that broke off in a wreck, e.g. to tag them for the game's own collision or cleanup. Reused array; empty while intact. |
| `physics`, `engine`, `controls`, `effects`, `audio`, `lods`, `interior`, `materials`, `uniforms`, `DIM` | internals, for tools and debugging. |

### Methods
| method | description |
|---|---|
| `update(dt)` | advance everything. Host calls once per frame with real dt; works at dt = 0.1 (background tabs). 120 Hz fixed physics steps with render interpolation. |
| `prewarm(renderer?, camera?)` | compiles every program the plane can use (all LODs, interior, doors, wreck debris, particles, prop disc, glows, beam, pool) via `renderer.compile`, plus one render into a 16x16 target with culling off so the shadow-depth variants exist too. After this `renderer.info.programs.length` does not grow (verified: boarding, night lights, rain, engine, chase cam, damage, wreck, respawns, far LODs). |
| `pointVelocity(worldPoint, out)` | world velocity of a point rigidly attached to the plane (ride along on the floats). |
| `seat(id = 'pilot', fromPos?, fromQuat?, instant = false)` | board: opens the door if needed and plays a 0.85 s eased camera path from the given eye pose through the door into the seat (`'pilot'` or `'copilot'`). `instant` skips the transition (spawning in the air). The door closes behind the pilot. |
| `unseat(force = false)` | hold-E exit: refuses with a hint when flying (agl > 1.5 m) or moving (> 4 m/s); finds a safe spot (float deck on water, ground beside the door when beached, the water when sinking or wrecked); 0.7 s camera path out. Returns the exit pose `{ position, velocity, inWater, surface }` (also `exitPose`, and `'unseated'` event). `force` drops the player out immediately (respawn). |
| `canExit()` | `{ ok }` or `{ ok: false, reason: 'flying'|'moving'|..., hintKey, hint }`. |
| `getSeatCamera(lookYaw, lookPitch, outPos, outQuat)` | eye pose on the head spring (g-load, engine vibration, chop, buffet, turbulence), with look limits (+-150 deg yaw, -70..+60 deg pitch) and the boarding/exit transitions. Returns `false` when the plane doesn't own the camera. |
| `getChaseCamera(outPos, outQuat)`, `setChaseOrbit(yaw, pitch)` | spring-arm chase camera (water/terrain clearance, looks into turns). |
| `attachInput(dom)` / `detachInput()` | key / mouse listeners **on the given element only** (focusable canvas). |
| `setControls(obj)` | programmatic input: `pitch, roll, yaw` (-1..1, `null` = release to keys), `throttle` (0..1 or `null`), `trim` (-1..1), `flaps` (notch index 0..3), `starter` (bool, hold to crank), `mouseYoke {x, y}`, `waterRudder` (bool, down), `lights {nav, landing}`, `mixture`, `propLever`, `fuelSelector` ('both'|'left'|'right'|'off'). |
| `command(name)` | `'flapsUp'`, `'flapsDown'`, `'toggleWaterRudder'`, `'cycleLights'`, `'toggleCamera'`, `'engineStop'` (plus the key-edge commands `engineDown/engineUp/engineTap/interactDown/interactUp`). |
| `toggleDoor(name, open?)`, `setDoor(name, open)`, `doorOpen(name)` | `'doorL'`, `'doorR'`, `'cargo'` (the cargo door is top-hinged, swings up under the wing and starts open, as in the reference). |
| `placeOnWater(x, z, yaw)` | floats at the correct waterline (pre-settled). Removes chocks and ropes. |
| `placeOnBeach(x, z, yaw)` | rests the floats on four timber chocks (visible props in `worldRoot`, physical boxes), water rudders up. |
| `placeInAir(x, y, z, yaw, speed = 38)` | flying, engine running at ~68 % power, trimmed. |
| `setMooringPoints(points)` | candidates for the "Tie up" interaction (`Vector3` or `{ position }`). |
| `moorTo(points)` / `castOff()` | ropes (spring constraints with slack, drawn as sagging tubes) from the nearest cleats (bow, mid, stern on both floats); up to 4. |
| `pushOff(strength = 1)` | push the beached plane back toward the water (decays in ~0.25 s; call every frame while E is held - the push-off interactable does that). |
| `setAssist(mode)`, `setQuality(q)` | `setQuality` re-bakes the paint atlas at the new size and changes particle budgets (no shader recompiles). |
| `setWetness(v)`, `setLoading({ fuelL, fuelR, pilot, copilot, cargo, cargoZ })` | |
| `damage(part, amount)` | testing: `'wingL'`, `'wingR'`, `'floatL'`, `'floatR'`, `'tail'`, `'windscreen'`, `'hull'`, `'engine'`, `'prop'`, `'wreck'` (the lower wing's side breaks; left when level), `'wreckL'`, `'wreckR'`. |
| `repair()`, `reset(pose?)` | `repair()` restores health and puts broken-off pieces back (lifting the airframe out of the ground if the restored floats would start buried). `reset` = `repair()` + engine off + optional `pose = { position, quaternion | yaw, velocity }`. |
| `setAudio(ctx, out, options?)` | attach sound later (e.g. after the AudioContext was created on a user gesture). |
| `dispose()` | removes everything, frees geometry, materials, textures, audio nodes. |

---

## 5. First-person interaction

### Interactables
Each entry of `plane.interactables`:

```
{ id, labelKey, label, local (plane-local Vector3), radius, viewCone (min cos), priority,
  hold (bool), holdTime (s), continuous (bool), progress (0..1, host-written),
  enabled(), use(from), getWorldPosition(out) }
```

- Host picking: candidates with `enabled()`, within `radius` of the eye and with
  `dot(lookDir, toTarget) >= viewCone`; score = `cos - 0.12 * distance + 0.4 * priority`.
  `priority` makes "Get in" win over "Close door" once a door is open.
- `hold: false` - call `use()` on press. `hold: true` - accumulate `progress` for
  `holdTime` seconds while E is held, then call `use()`. `continuous: true` - call
  `use()` every frame while E is held (push off).
- `use(from)` takes `{ position, quaternion }` = the player's eye pose (the boarding
  camera path starts there).
- ids: `door.doorL`, `door.doorR`, `door.cargo`, `seat.pilot`, `seat.copilot`,
  `seat.exit` (hold, when seated - also handled by the plane's own input), `moor.L/R`
  (tie up / cast off at the bow cleats), `pushoff.L/R` (beached, continuous),
  `refuel` (hold 4 s, two jerrycans), `floodlight` (toggle the landing light from outside).
- `labelKey` is a stable localisation key (`seaplane.door.open`, ...); `label` is English.

### Walk and block shapes
`plane.walkShapes` and `plane.blockShapes` are arrays of
`{ id, type: 'box', kind, min, max, matrixWorld, inverseMatrixWorld }` - axis-aligned
boxes in plane-local space whose shared matrices are updated every `update()`.
Walkable: float decks, ladder steps, the strut footsteps, the cabin floor at the
doors. Blocking: fuselage, cabin roof, tail cone, cabin walls, belly, float hulls.
When a float breaks off in a wreck, its deck, ladder and hull boxes become empty
(`min` > `max` on every axis) until `repair()`; a host that tests point-in-box needs no
special case.

The sandbox walker (`sandbox/walker.js`) is a complete reference: it stands on the
highest walk-shape top under the feet (step 0.45 m), stores its plane-local foot
position each frame and re-maps it with the new matrix next frame (exact ride-along,
including the plane's yaw), inherits `pointVelocity()` when jumping off, and pushes
its capsule out of the block boxes in plane-local XZ.

### Seats
`seat()` / `unseat()` emit `seatStart`, `seated`, `exitStart`, `unseated` (with the
exit pose). While seated the plane owns the camera through `getSeatCamera()` /
`getChaseCamera()`; with `attachInput()` holding E for 0.6 s gets out.

---

## 6. Rendering notes

- Materials are stock `MeshStandardMaterial` / `MeshBasicMaterial` extended with
  `onBeforeCompile` and unique `customProgramCacheKey`s (`seaplane-*`). All `#include`
  lines stay in place (code is injected next to them), so global chunk patches such
  as cascaded shadows or custom fog keep working. If your engine chains its own
  `onBeforeCompile` per material, wrap ours rather than replacing it.
- Opaque materials and alpha particles use the scene fog. Additive effects (fire,
  sparks, flashes, glows, landing beam, light pool) have `fog: false` and fade with
  distance on the CPU instead (fogging an additive quad brightens it).
- No real lights are created at runtime. Nav/strobe/landing/exhaust/instrument light
  is emissive + additive sprites, a beam cone and a projected pool on the water.
  `realLandingLight: true` creates **one** `SpotLight` at construction (no shadows,
  intensity 0 when off) - adding it changes your light count once, before `prewarm`.
- Shadows: the big exterior meshes cast (LOD0 statics, control surfaces, doors,
  LOD1 hard parts); interior and tiny parts only receive.
- PBR looks best with a `scene.environment`; the module does not set one.
- Transparent parts (glass, prop disc, particles) use `renderOrder` 1-4 and
  `depthWrite: false`.

### Measured budgets (sandbox, `quality: 'high'`)
| | triangles | draw calls |
|---|---|---|
| LOD0 exterior (camera < ~30 m) | 92.5k | 23 |
| interior (inside or < 12 m from the cabin, LOD0 only) | 18.9k | 5 |
| LOD1 (30-150 m, hysteresis) | 17.6k | 5 |
| LOD2 (> 150 m) | 2.1k | 3 (prop blades swap for the disc at speed) |
| effects | 2 instanced particle draws, glows 1, prop disc 1, beam + pool when lit | |

- Textures: paint atlas 2048² (sRGB) + data atlas 1024² (AO / roughness / metalness /
  wear) + gauge atlas 2048² + horizon 256x512: ~49 MB with mipmaps on High, ~13 MB on Low.
- Generation: ~1.3 s total in a software renderer (SwiftShader), geometry + AO on the
  CPU in chunks (`await` between LODs), paint bake on the GPU in a few draws.
- CPU per frame (`plane.update`, incl. physics at 120 Hz, controls, animation,
  cockpit rig, effects): ~0.11 ms flying, ~0.23 ms taxiing on the water (most of it
  inside `env.waterHeight`).
- Steady state is allocation free (vectors, matrices, event payloads for effect
  hooks are reused).

---

## 7. Events (`env.emit(type, data)` and `plane.onEvent`)

Effect hooks (rate-limited; **the `data` object is reused - copy what you keep**):
`spray`, `splash`, `wake`, `smoke`, `fire`, `sparks` with `{ x, y, z, strength, dir }`
(`dir` is a `Vector3`). With `useOwnEffects: false` the built-in particles are skipped
and only these hooks fire.

Gameplay events: `engine` (`'starterOn'`, `'cough'`, `'catch'`, `'backfire'`,
`'misfire'`, `'runDown'`, `'shutdown'`, `'stall:water|fuel|strike|lowrpm|fire|dead'`,
`'fire'`, `'fail'`, `'splash'`), `touchdown` `{ quality: 'smooth'|'firm'|'hard'|'crash', vs, speed, ground? }`,
`impact` `{ part, kind, speed }`, `damage` `{ part, amount }`, `wreck` `{ speed, side }`,
`detached` `{ part: 'wingTipL'|'wingTipR'|'floatL'|'floatR'|'prop' }`, `door`
`{ name, open }`, `lights`, `moored`, `castOff`, `refuel`, `switch`, `hint`,
`seatStart`, `seated`, `exitStart`, `unseated` `{ pose }`, `repaired`.

---

## 8. Input

Default `KEYMAP` (`KeyboardEvent.code`, all remappable via `plane.KEYMAP`, no Ctrl):

| action | keys |
|---|---|
| pitch nose down / up | W / S |
| roll left / right (on water: also rudder + water rudders) | A / D |
| rudder left / right | Z / X |
| throttle up / down | R / F, mouse wheel |
| flaps retract / extend one notch (0-10-20-30 deg) | G / B |
| engine: hold to crank, tap to stop | Q |
| water rudders up / down | U |
| lights: off -> nav (+ panel backlight) -> nav + landing -> off | L |
| mouse-yoke while held | right mouse button |
| cockpit / chase camera | V |
| trim nose up / down | PageUp / PageDown, [ / ] |
| interact / hold to get out | E |

Keyboard input is rate-limited (yokes and pedals move smoothly); tap-vs-hold on Q
is measured in simulation time. Hosts with their own input system can skip
`attachInput()` and call `setControls()` / `command()` every frame.

Assists: `normal` (default) = auto-coordinated rudder. `arcade` adds auto-trim,
stall protection and wings-levelling when hands-off. `realistic` = none. The
airframe itself is stable hands-off in every mode (dihedral / spiral stability,
pitch and phugoid damping).

---

## 9. Flight model numbers

Air density is 1.6x standard (small game world: lower speeds for the same feel).

| | |
|---|---|
| stall, clean / full flaps (power off, 1 g) | 20.7 m/s / 17.9 m/s; the horn sounds ~3 deg of AoA before the break |
| cruise / max level | 42 m/s at ~66 % throttle; ~48 m/s at full power; Vne ~62 m/s |
| climb (full power, below the soft ceiling) | 4.2-5.1 m/s at 24-33 m/s (best ~30 m/s); fades above ~600 m |
| water take-off, standing start, calm, flaps 10 | 150 m (no cargo) / 168 m (120 kg) / 200 m (300 kg); ~110 m into a 4 m/s wind; lift-off ~21 m/s |
| idle glide | ~8 deg clean at 30 m/s, ~9 deg with full flaps at 23-25 m/s (the throttled-back prop windmills) |
| neutral-stick trim speed | ~31 m/s |
| engine | idle ~700 rpm, max 2300 rpm (governed), ~140 l per tank |

Verified end to end in the sandbox with player inputs (walker + E prompts, Q, U, flap
keys) and a scripted pilot on `setControls`: walk onto the float, cast off, open the
door, get in, start, taxi, take off, climb, stall and recover, land on the water, taxi
back, dock, shut down, get out onto the float, tie up and walk ashore - without a
single shader compile or console message.

Water: per-station buoyancy from section-area tables (10 stations x 2 chines x 2
floats), planing/slamming pressure on the V bottoms, keel side force, hump drag,
water rudders, flooding of holed floats, beaching on keels and chocks, ropes.

---

## 10. Audio

`createSeaplaneAudio(audioCtx, outputNode, options)` is exported from
`seaplane/audio.js`; `createSeaplane({ audio: { ctx, out } })` or
`plane.setAudio(ctx, out)` wires it up and drives it from `update()`.

- The synthesis core (9-cylinder radial firing pulses with bark, crackle, pops and
  coughs; propeller blade-pass buzz and whoosh; valvetrain, starter, knocking, flap
  motor; water slaps / splashes / slams / draining / grinding; doors, creaks, rope,
  scrape, crash, fire; switch clicks, lever detents, rattles) runs in an
  **AudioWorklet** loaded from a Blob URL. Where worklets are unavailable (insecure
  context, CSP blocking `blob:`), the same code runs in a ScriptProcessor fallback.
- Wind, whistle, water rush, spray hiss and the stall horn are node graphs. All nodes
  are created once; `update()` only moves AudioParams.
- Interior / exterior mix: inside (cockpit camera or camera in the cabin) the engine
  goes through a hull low-pass with cabin boom; outside it goes through a propagation
  delay (distance / 343 m/s: Doppler and the fly-by lag come out of it naturally),
  air absorption and an HRTF `PannerNode`.
- Spatialisation: by default (`listener: 'camera'`) the panner gets the source position
  **relative to the camera** and `ctx.listener` is never touched. If your engine moves
  `ctx.listener` itself (e.g. `THREE.AudioListener`), pass `{ listener: 'world' }`.
  `audio.worldPosition` exposes the source position for hosts that spatialise themselves.
- Master: compressor -> tanh soft clip -> x0.5, so peaks never exceed **-6 dBFS**
  (measured -6.1 dBFS worst case); fades in/out on create/dispose.

---

## 11. Known limitations

- Damage is functional (lift loss, flooding, misfires, fire, wreck) and visible as
  dents and punctures on the damaged wing / float / tail / fuselage (paint shader,
  driven by `state.damage` through shared uniforms - more holes as health drops),
  burn/soot, shattered windscreen cracks and a bent blade. Punctures are shading
  (dark core, torn rim), not cut through the mesh, and the distant LODs don't show them.
- Wreck debris: the outer wing panel (with its aileron), the float (with its water
  rudder) on the side that hit, and the propeller break off as pre-split pieces. Every
  LOD hides them by trimming its index range (no extra draw calls while intact) and
  world-space copies (sharing the LOD0 vertex buffers) tumble, float or sink and settle
  on `groundHeight` / `waterHeight`. They do not collide with `contact()` shapes, the
  plane or each other, and the torn edges are open (no rib caps).
- Spray and foam are camera-facing / flat particles without depth-buffer soft
  particles; they fade softly where they meet the sea (approximate sea level near the
  plane), not against arbitrary geometry.
- LOD1 shows the doors in their default pose (cargo door open).
- The interior is not lit by the panel glow at night (no real lights by design);
  the map light lens glows but does not illuminate.
- The physics assumes `waterHeight` is the true rendered surface; if the game's GPU
  water fades small waves with distance, the plane will look correct only near the
  camera (the sandbox ocean has the same trade-off far away).
- Touch, gamepad and mobile input are out of scope (desktop only).
- `three@0.169.0` exactly (uses `addUpdateRange`, `texelFetch`, WebGL2).

---

## 12. Sandbox

`index.html` (serve the folder over http and open it). Click to capture the mouse;
WASD walk, Shift run, Space jump / climb out of the water, E interact, O orbit
camera, F1 debug panel (forces, CG, contacts, buoyancy samples, walk/block shapes,
LOD, `renderer.info`, physics ms, damage buttons, repair / reset). Settings panel:
time of day, rain, wind, quality, assist, volume, spawn on the beach (chocks), moored
at the pier, or airborne at 300 m.
