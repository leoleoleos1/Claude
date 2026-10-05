// Sandbox entry: renderer, sky / ocean / islands, pier, seaplane base kit, the
// seaplane module, a first-person walker that uses the plane's public API,
// cameras (walk / seat / chase / orbit), settings, HUD, F1 debug and test hooks.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createSeaplane } from '../seaplane/Seaplane.js';
import { createSeaplaneBase } from '../seaplane/model/basekit.js';
import { Sky } from './sky.js';
import { Ocean } from './ocean.js';
import { World, heightAt, normalAt, BEACH, ISLANDS } from './terrain.js';
import { Pier, PIER_DECK_Y } from './pier.js';
import { Walker } from './walker.js';
import { SandboxUI } from './ui.js';
import { DebugViz } from './debugviz.js';
import { Rain } from './rain.js';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(TEST ? 1 : Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
let BASE_FOV = 70;
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 6000);
scene.add(camera);
const sky = new Sky(renderer, scene);
const world = new World(scene, { quality: 'high' });
const ocean = new Ocean(scene, sky, world.heightTexture);
const rain = new Rain(scene);

// seaplane base kit next to the beach pad
const base = createSeaplaneBase({ seed: 7 });
const baseOrigin = new THREE.Vector3(BEACH.x - 17, 0, BEACH.z - 13);
baseOrigin.y = heightAt(baseOrigin.x, baseOrigin.z) - 0.05;
base.group.position.copy(baseOrigin);
base.group.rotation.y = -Math.PI / 2 - 0.45;
scene.add(base.group);
for (const c of base.colliders) {
  const p = new THREE.Vector3(c.x, c.y, c.z).applyEuler(base.group.rotation).add(baseOrigin);
  world.addBox(p.x, p.y, p.z, c.hx, c.hy, c.hz, c.ry + base.group.rotation.y);
}
// wooden pier into the lagoon, north of the beach pad
const pier = new Pier(scene, world, { x: BEACH.x - 2, z: BEACH.z - 40, length: 44, width: 2.6 });

// ---------------- environment for the plane ----------------
const wind = new THREE.Vector3();
function setWind(dirDeg, speed) {
  // direction the wind blows FROM (meteorological), 0 = north (-z)
  const a = (dirDeg * Math.PI) / 180;
  wind.set(-Math.sin(a) * speed, 0, Math.cos(a) * speed);
}
setWind(70, 3.7);
const env = {
  waterHeight: (x, z) => ocean.heightAt(x, z),
  waterFlow: (x, z, out) => ocean.flowAt(x, z, out),
  groundHeight: (x, z) => heightAt(x, z),
  groundNormal: (x, z, out) => normalAt(x, z, out),
  contact: (p, r, out) => world.contact(p, r, out),
  wind,
  sunDirection: sky.sunDirection,
  night: () => sky.night,
  rain: () => sky.rain,
  worldLimit: (x, y, z, out) => {
    // soft play-area boundary: 1.6 km around the islands
    const cx = 440, cz = -310;
    const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
    if (d < 1600) return false;
    const k = Math.min((d - 1600) / 200, 1) * 3;
    out.set((-dx / d) * k, 0, (-dz / d) * k);
    return true;
  },
};

const plane = createSeaplane({ scene, renderer, camera, env, quality: params.get('quality') || 'high', assist: params.get('assist') || 'normal', seed: 7 });
plane.setMooringPoints(pier.mooringPoints);
const walker = new Walker({ world, groundHeight: heightAt, waterHeight: (x, z) => ocean.heightAt(x, z), pier, plane });
const debugViz = new DebugViz(scene, plane);

// ---------------- cameras & modes ----------------
const orbit = new OrbitControls(camera, canvas);
orbit.enabled = false;
let orbitMode = false;
let lookYaw = 0, lookPitch = 0;
const camPos = new THREE.Vector3(), camQuat = new THREE.Quaternion();

function setOrbit(on) {
  orbitMode = on;
  orbit.enabled = on;
  if (on) {
    if (document.pointerLockElement) document.exitPointerLock();
    orbit.target.copy(plane.root.position);
    orbit.update();
  }
}

// ---------------- spawning ----------------
function spawn(mode) {
  if (plane.seated) plane.unseat(true);
  plane.reset();
  if (mode === 'pier') {
    const px = pier.x0 + 38, pz = pier.z + pier.width / 2 + 1.78 + 0.32;
    plane.placeOnWater(px, pz, -Math.PI / 2);
    plane.moorTo(pier.mooringPoints.map((m) => m.position));
    walker.setPose(new THREE.Vector3(pier.x0 + 27, PIER_DECK_Y, pier.z), -Math.PI / 2 - 0.35);
  } else if (mode === 'air') {
    plane.placeInAir(BEACH.x + 420, 300, BEACH.z - 60, Math.PI / 2, 40);
    plane.seat('pilot', null, null, true);
    lookYaw = 0; lookPitch = -0.12;
  } else {
    plane.placeOnBeach(BEACH.x, BEACH.z, -Math.PI / 2);
    const wp = new THREE.Vector3(BEACH.x + 7.5, 0, BEACH.z + 8.5);
    wp.y = heightAt(wp.x, wp.z);
    walker.setPose(wp, Math.atan2(-(BEACH.x - wp.x), -(BEACH.z - wp.z)) + 0.15);
  }
}

plane.onEvent = (type, data) => {
  if (type === 'seated') { walker.keys.clear(); lookYaw = 0; lookPitch = -0.08; }
  if (type === 'unseated') {
    const pose = data.pose;
    if (pose && !data.forced) {
      walker.setPose(pose.position, camYaw());
      walker.vel.copy(pose.velocity);
      walker.pitch = 0;
    }
  }
  if (type !== 'engine' || data !== 'misfire') lastEvents.unshift(`${(performance.now() / 1000).toFixed(1)} ${type}${typeof data === 'string' ? ' ' + data : data && data.quality ? ' ' + data.quality : ''}`);
  if (lastEvents.length > 8) lastEvents.length = 8;
};
const lastEvents = [];
const _e = new THREE.Euler();
function camYaw() { _e.setFromQuaternion(camera.quaternion, 'YXZ'); return _e.y; }

// ---------------- input ----------------
const input = { eDown: false };
let audioCtx = null, audioMaster = null, volume = 0.8;
function ensureAudio() {
  if (audioCtx || TEST) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audioCtx = new AC();
  audioMaster = audioCtx.createGain();
  audioMaster.gain.value = volume;
  audioMaster.connect(audioCtx.destination);
  plane.setAudio(audioCtx, audioMaster);
}
canvas.addEventListener('click', () => {
  ensureAudio();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  if (!orbitMode && !TEST && document.pointerLockElement !== canvas) canvas.requestPointerLock();
  canvas.focus();
});
window.addEventListener('keydown', (e) => {
  ensureAudio();
  if (e.code === 'F1') { e.preventDefault(); ui.toggleDebug(); return; }
  if (e.code === 'KeyO') { setOrbit(!orbitMode); return; }
  if (e.code === 'KeyE') input.eDown = true;
  if (!plane.seated) walker.keys.add(e.code);
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyE') input.eDown = false;
  walker.keys.delete(e.code);
});
window.addEventListener('blur', () => { walker.keys.clear(); input.eDown = false; });
window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  if (plane.seated) {
    if (plane.controls.mouseYoke) return;
    if (plane.cameraMode === 'chase') {
      chaseYaw -= e.movementX * 0.003; chasePitch = Math.max(-0.4, Math.min(0.9, chasePitch + e.movementY * 0.003));
      plane.setChaseOrbit(chaseYaw, chasePitch);
    } else {
      lookYaw -= e.movementX * 0.0022;
      lookPitch -= e.movementY * 0.0022;
      lookYaw = Math.max(-2.6, Math.min(2.6, lookYaw));
      lookPitch = Math.max(-1.2, Math.min(1.05, lookPitch));
    }
  } else walker.look(e.movementX, e.movementY);
});
let chaseYaw = 0, chasePitch = 0;
plane.attachInput(canvas);

// ---------------- UI ----------------
const ui = new SandboxUI({
  time: (h) => sky.setTime(h),
  rain: (on) => { sky.rain = on ? 1 : 0; },
  wind: (d, s) => setWind(d, s),
  quality: (q) => plane.setQuality(q),
  assist: (a) => plane.setAssist(a),
  volume: (v) => { volume = v; if (audioMaster) audioMaster.gain.value = v; },
  spawn,
  repair: () => plane.repair(),
  orbit: () => setOrbit(!orbitMode),
  debug: (v) => { debugViz.group.visible = v; },
});
for (const part of ['wingL', 'floatL', 'floatR', 'engine', 'prop', 'windscreen', 'tail']) ui.addDebugButton(`Damage ${part}`, () => plane.damage(part, 0.5));
ui.addDebugButton('Wreck', () => plane.damage('wreck'));
ui.addDebugButton('Repair', () => plane.repair());
ui.addDebugButton('Reset (beach)', () => spawn('beach'));
ui.addDebugButton('Night', () => sky.setTime(22));
ui.addDebugButton('Lights', () => plane.command('cycleLights'));

// ---------------- frame ----------------
const _v = new THREE.Vector3();
let fps = 60;
function frame(dt) {
  sky.dome.position.copy(camera.position);
  sky.update(dt, camera.position.distanceTo(plane.root.position) < 60 ? plane.root.position : camera.position);
  ocean.update(dt, camera, sky.sun);
  base.windsock.update(wind, dt);
  plane.update(dt);
  // camera
  if (orbitMode) {
    orbit.update();
  } else if (plane.seated || plane.getSeatCamera(lookYaw, lookPitch, camPos, camQuat)) {
    if (plane.cameraMode === 'chase') plane.getChaseCamera(camPos, camQuat);
    else plane.getSeatCamera(lookYaw, lookPitch, camPos, camQuat);
    camera.position.copy(camPos);
    camera.quaternion.copy(camQuat);
    const f = BASE_FOV + plane.fovDelta;
    if (Math.abs(camera.fov - f) > 0.01) { camera.fov = f; camera.updateProjectionMatrix(); }
  } else {
    walker.update(dt, input);
    walker.eye(camera.position);
    walker.quaternion(camera.quaternion);
    if (camera.fov !== BASE_FOV) { camera.fov = BASE_FOV; camera.updateProjectionMatrix(); }
  }
  camera.updateMatrixWorld();
  rain.update(dt, camera.position, wind, sky.rain);
  debugViz.update(env);
  // UI
  const s = plane.state;
  if (!plane.seated && !orbitMode && walker.focus) {
    const it = walker.focus;
    ui.setPrompt(`${it.hold ? 'Hold ' : ''}<b>E</b>: ${it.label.replace(/^Hold E: /, '')}`, it.hold && !it.continuous ? it.progress : 0);
  } else if (plane.seated && s.exitProgress > 0) ui.setPrompt('Getting out…', s.exitProgress);
  else ui.setPrompt('');
  ui.setHint(s.hint ? s.hint.text : '');
  ui.setHud(plane.hudData, plane.seated);
  if (ui.debugVisible) {
    const info = renderer.info;
    const o = plane.physics.out;
    const d = plane.physics.damage;
    ui.setDebug(
      `fps ${fps.toFixed(0)}  calls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(1)}k  programs ${info.programs.length}\n`
      + `lod ${s.lod}  interior ${s.interiorVisible}  physics ${s.physicsMs.toFixed(3)} ms  assist ${s.assist}  quality ${s.quality}\n`
      + `engine ${s.engine}  rpm ${s.rpm.toFixed(0)}  thr ${s.throttle.toFixed(2)}  fuel ${s.fuel[0].toFixed(0)}/${s.fuel[1].toFixed(0)} L\n`
      + `IAS ${(o.airspeed * 1.944).toFixed(1)} kt  GS ${o.groundSpeed.toFixed(1)} m/s  alt ${s.altitude.toFixed(1)}  agl ${o.agl.toFixed(1)}  vs ${s.vs.toFixed(2)}\n`
      + `pitch ${(s.pitch * 57.3).toFixed(1)}  roll ${(s.roll * 57.3).toFixed(1)}  hdg ${(s.heading * 57.3).toFixed(0)}  aoa ${(o.aoa * 57.3).toFixed(1)}  beta ${(o.beta * 57.3).toFixed(1)}  g ${o.gLoad.toFixed(2)}\n`
      + `stall ${o.stall.toFixed(2)}  onWater ${o.onWater}  planing ${o.planing}  buoy ${o.buoyancyFrac.toFixed(2)}  wspd ${o.waterSpeed.toFixed(1)}  beached ${o.beached}  contacts ${o.contactsN}\n`
      + `flaps ${s.flaps.toFixed(0)}  trim ${s.trim.toFixed(2)}  wrud ${s.waterRudderDown ? 'down' : 'up'}  moored ${s.moored}  seated ${s.seated} ${s.seatId || ''}  cam ${s.cameraMode}\n`
      + `damage wingL ${d.wingL.toFixed(2)} wingR ${d.wingR.toFixed(2)} floatL ${d.floatL.toFixed(2)} floatR ${d.floatR.toFixed(2)} tail ${d.tail.toFixed(2)} hull ${d.hull.toFixed(2)} ws ${d.windscreen.toFixed(2)}\n`
      + `flood L ${plane.physics.flood.L.toFixed(2)} R ${plane.physics.flood.R.toFixed(2)}  wreck ${s.wreck}  engine hp ${plane.engine.health.toFixed(2)} prop ${plane.engine.propHealth.toFixed(2)}\n`
      + `walker ${walker.onGround ? 'ground' : walker.swimming ? 'swim' : 'air'} ${walker.platform ? 'on ' + walker.platform.id : ''}\n`
      + `events:\n  ${lastEvents.join('\n  ')}`);
  }
}

const clock = new THREE.Clock();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.1);
  fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  frame(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

spawn(params.get('spawn') || 'beach');
plane.ready.then(() => {
  spawn(params.get('spawn') || 'beach');
  document.getElementById('loading').style.opacity = 0;
  frame(1 / 60);
  // compile everything up front: plane variants (prewarm) and the sandbox's own debug helpers
  plane.prewarm(renderer, camera);
  // the sandbox warms its own objects the same way: everything visible, no culling, one render
  const saved = [];
  scene.traverse((o) => { saved.push(o, o.visible, o.frustumCulled); o.visible = true; o.frustumCulled = false; });
  renderer.compile(scene, camera);
  const rt = new THREE.WebGLRenderTarget(16, 16);
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  rt.dispose();
  for (let i = 0; i < saved.length; i += 3) { saved[i].visible = saved[i + 1]; saved[i].frustumCulled = saved[i + 2]; }
  if (!TEST) loop();
  window.__sandbox.ready = true;
});

// ---------------- test hooks (headless screenshots / automated checks) ----------------
window.__sandbox = {
  ready: false,
  get info() { return { buildMs: plane.state.buildMs, programs: renderer.info.programs.length, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; },
  plane, sky, ocean, world, camera, renderer, scene, walker, pier, BEACH, ISLANDS,
  // fixed camera: pos/target relative to the beach spawn point (orbit mode)
  view(pos, target, fov = 37.8) {
    setOrbit(true);
    const o = new THREE.Vector3(BEACH.x, 0, BEACH.z);
    camera.position.set(pos[0], pos[1], pos[2]).add(o);
    orbit.target.set(target[0], target[1], target[2]).add(o);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.lookAt(orbit.target);
    for (let i = 0; i < 3; i++) frame(1 / 60);
    renderer.render(scene, camera);
  },
  // look from wherever the current mode puts the camera
  render() { renderer.render(scene, camera); },
  look(yaw, pitch) { lookYaw = yaw; lookPitch = pitch; },
  setOrbit,
  spawn,
  setTime(h) { sky.setTime(h); },
  step(seconds, dt = 1 / 60) { for (let t = 0; t < seconds; t += dt) frame(dt); renderer.render(scene, camera); },
  key(code, down) { canvas.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true })); },
  input,
  setFov(f) { BASE_FOV = f; },
};
