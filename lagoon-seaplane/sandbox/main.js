// Sandbox entry: renderer, sky/ocean/islands, seaplane base, the seaplane module
// and the test hooks used by the screenshot harness.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createSeaplane } from '../seaplane/Seaplane.js';
import { createSeaplaneBase } from '../seaplane/model/basekit.js';
import { Sky } from './sky.js';
import { Ocean } from './ocean.js';
import { World, heightAt, BEACH } from './terrain.js';

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
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 6000);
const sky = new Sky(renderer, scene);
const world = new World(scene, { quality: 'high' });
const ocean = new Ocean(scene, sky, world.heightTexture);

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

const wind = new THREE.Vector3(3.5, 0, 1.2);
const env = {
  waterHeight: (x, z) => ocean.heightAt(x, z),
  waterFlow: (x, z, out) => ocean.flowAt(x, z, out),
  groundHeight: (x, z) => heightAt(x, z),
  contact: (p, r, out) => world.contact(p, r, out),
  wind,
  sunDirection: sky.sunDirection,
  night: () => sky.night,
  rain: () => sky.rain,
  wetness: () => sky.rain,
};

const plane = createSeaplane({ scene, renderer, camera, env, quality: params.get('quality') || 'high', seed: 7 });

// static placement on the beach on chocks (physics placement comes later)
const yaw = -Math.PI / 2;
const groundY = heightAt(BEACH.x, BEACH.z);
plane.setPose(new THREE.Vector3(BEACH.x, groundY + 0.31 + 2.25, BEACH.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)));

const controls = new OrbitControls(camera, canvas);
controls.target.set(BEACH.x, 2.6, BEACH.z);
camera.position.set(BEACH.x + 9, 2.0, BEACH.z + 8);
controls.update();

const clock = new THREE.Clock();
function frame(dt) {
  sky.dome.position.copy(camera.position);
  sky.update(dt, controls.target);
  ocean.update(dt, camera, sky.sun);
  base.windsock.update(wind, dt);
  plane.update(dt);
}
function loop() {
  const dt = Math.min(clock.getDelta(), 0.1);
  controls.update();
  frame(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

plane.ready.then(() => {
  document.getElementById('loading').style.opacity = 0;
  plane.prewarm(renderer, camera);
  if (!TEST) loop();
  window.__sandbox.ready = true;
});

window.__sandbox = {
  ready: false,
  get info() { return { buildMs: plane.state.buildMs, programs: renderer.info.programs.length, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; },
  plane, sky, ocean, world, camera, renderer, scene,
  // test camera: pos/target relative to the beach spawn point
  view(pos, target, fov = 37.8) {
    const o = new THREE.Vector3(BEACH.x, 0, BEACH.z);
    camera.position.set(pos[0], pos[1], pos[2]).add(o);
    controls.target.set(target[0], target[1], target[2]).add(o);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    for (let i = 0; i < 3; i++) frame(1 / 60);
    renderer.render(scene, camera);
  },
  setTime(h) { sky.setTime(h); },
  step(seconds, dt = 1 / 60) { for (let t = 0; t < seconds; t += dt) frame(dt); },
};
