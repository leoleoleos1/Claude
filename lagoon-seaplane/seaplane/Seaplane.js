// Seaplane module entry point: createSeaplane(options) -> plane API.
// See INTEGRATION.md for the contract (frame, env callbacks, keymap, budgets).
import * as THREE from 'three';
import { DIM, CG_MODEL } from './model/dims.js';
import { buildAirframe, layoutAtlas, toLocalFrame, bakeAO } from './model/build.js';
import { bakeAirframe } from './model/textures.js';
import { createSharedUniforms, createPaintMaterial, createHardMaterial, createGlassMaterial, placeholderTextures } from './model/materials.js';
import { assembleLod0, assembleLodN } from './model/assemble.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

export function createSeaplane(options = {}) {
  const opts = Object.assign({
    scene: null, renderer: null, camera: null, quality: 'high', assist: 'normal',
    useOwnEffects: true, realLandingLight: false, seed: 7, env: {}, audio: null,
  }, options);
  const root = new THREE.Group();
  root.name = 'seaplane';
  root.visible = false;
  const worldRoot = new THREE.Group(); // world-space helpers (particles, ropes, chocks)
  worldRoot.name = 'seaplane.world';
  const U = createSharedUniforms();
  const ph = placeholderTextures();
  const mats = {
    paint: createPaintMaterial(U, ph, { detail: true }),
    paintLod: createPaintMaterial(U, ph, { detail: false }),
    hard: createHardMaterial(U, { detail: true }),
    hardLod: createHardMaterial(U, { detail: false, name: 'seaplane.hardLod' }),
    glass: createGlassMaterial(U, { detail: true }),
    glassLod: createGlassMaterial(U, { detail: false }),
  };
  const lods = [];
  let baked = null;
  let atlas = null;
  const parts = { hinges: {}, doors: {}, prop: [] };
  const state = { lod: 0, ready: false };
  const pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };

  async function build() {
    const t0 = performance.now();
    const m0 = buildAirframe(0, opts.seed);
    atlas = layoutAtlas(m0.ctx, 2048);
    m0.atlas = atlas;
    toLocalFrame(m0);
    bakeAO(m0);
    await tick();
    const m1 = buildAirframe(1, opts.seed);
    layoutAtlas(m1.ctx, 2048, atlas);
    toLocalFrame(m1);
    bakeAO(m1);
    const m2 = buildAirframe(2, opts.seed);
    layoutAtlas(m2.ctx, 2048, atlas);
    toLocalFrame(m2);
    await tick();
    const high = opts.quality !== 'low';
    if (opts.renderer) {
      baked = bakeAirframe(opts.renderer, m0, { size: high ? 2048 : 1024, dataSize: high ? 1024 : 512, seed: opts.seed });
      for (const k of ['paint', 'paintLod']) {
        mats[k].map = baked.map; mats[k].roughnessMap = baked.data; mats[k].metalnessMap = baked.data; mats[k].aoMap = baked.data;
      }
    }
    const a0 = assembleLod0(m0, mats);
    const a1 = assembleLodN(m1, mats, 1);
    const a2 = assembleLodN(m2, mats, 2);
    lods.push(a0, a1, a2);
    root.add(a0.group, a1.group, a2.group);
    a1.group.visible = false;
    a2.group.visible = false;
    Object.assign(parts.hinges, a0.hinges);
    Object.assign(parts.doors, a0.doors);
    parts.prop = [a0.propPivot, a1.propPivot, a2.propPivot];
    parts.model = m0;
    state.buildMs = performance.now() - t0;
    state.ready = true;
    root.visible = true;
  }

  const ready = build();
  if (opts.scene) { opts.scene.add(root); opts.scene.add(worldRoot); }

  // ---------------- public API (v1: visual) ----------------
  const _v = new THREE.Vector3();
  const api = {
    root, worldRoot, ready, state, materials: mats, uniforms: U,
    get lods() { return lods; },
    setPose(position, quaternion) {
      pose.position.copy(position); pose.quaternion.copy(quaternion);
      root.position.copy(position); root.quaternion.copy(quaternion);
    },
    setDoor(name, open01) {
      const d = parts.doors[name];
      if (d) d.hinge.set(d.openAngle * open01);
    },
    setSurfaces({ aileron = 0, elevator = 0, rudder = 0, flaps = 0, trim = 0, waterRudder = 0, waterRudderDown = 1 } = {}) {
      const h = parts.hinges;
      if (!state.ready) return;
      h.aileronR && h.aileronR.set(-aileron * 0.35);
      h.aileronL && h.aileronL.set(aileron * 0.35);
      h.flapR && h.flapR.set(flaps);
      h.flapL && h.flapL.set(flaps);
      h.elevator && h.elevator.set(elevator * 0.42);
      h.trimTab && h.trimTab.set(-trim * 0.35);
      h.rudder && h.rudder.set(rudder * 0.45);
      if (h.waterRudderL) h.waterRudderL.set(waterRudder * 0.5, (1 - waterRudderDown) * -1.45);
      if (h.waterRudderR) h.waterRudderR.set(waterRudder * 0.5, (1 - waterRudderDown) * -1.45);
    },
    setPropAngle(a) { for (const p of parts.prop) p.rotation.z = a; },
    setLod(i) {
      state.lod = i;
      lods.forEach((l, k) => { l.group.visible = k === i; });
    },
    updateLod(camera) {
      if (!state.ready) return;
      const d = camera.position.distanceTo(root.position);
      const i = d < 30 ? 0 : d < 150 ? 1 : 2;
      if (i !== state.lod) api.setLod(i);
    },
    update(dt) {
      U.uSpTime.value += dt;
      if (opts.camera) api.updateLod(opts.camera);
    },
    prewarm(renderer, camera) {
      const vis = [];
      root.traverse((o) => { vis.push([o, o.visible]); o.visible = true; });
      renderer.compile(root, camera, opts.scene || undefined);
      for (const [o, v] of vis) o.visible = v;
    },
    dispose() {
      if (baked) baked.dispose();
      for (const k in mats) mats[k].dispose();
      root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      root.removeFromParent();
      worldRoot.removeFromParent();
    },
    toModel(v) { return _v.copy(v).add(CG_MODEL); },
    DIM,
  };
  return api;
}
