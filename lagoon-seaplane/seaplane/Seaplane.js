// Seaplane module entry point: createSeaplane(options) -> plane API.
// See INTEGRATION.md for the contract (frame, env callbacks, keymap, budgets).
import * as THREE from 'three';
import { DIM, CG_MODEL } from './model/dims.js';
import { GeoBuilder, tube, rng, KIND } from './model/geom.js';
import { buildAirframe, layoutAtlas, toLocalFrame, bakeAO } from './model/build.js';
import { bakeAirframe } from './model/textures.js';
import {
  createSharedUniforms, createPaintMaterial, createHardMaterial, createGlassMaterial, placeholderTextures,
  createRigTexture, setRigMatrix, createGaugeMaterial,
} from './model/materials.js';
import { assembleLod0, assembleLodN, assembleInterior } from './model/assemble.js';
import { createGaugeAtlas, createHorizonTexture, NEEDLE } from './model/instruments.js';
import { chockGeo } from './model/basekit.js';
import { PROP_BEND_GROUP } from './model/prop.js';
import { SeaplanePhysics } from './physics.js';
import { EngineModel } from './engine.js';
import { Controls, KEYMAP, FLAP_NOTCHES } from './controls.js';
import { SeatCamera, ChaseCamera } from './camera.js';
import { Interaction } from './interaction.js';
import { Effects } from './effects.js';
import { createSeaplaneAudio } from './audio.js';
import { Debris } from './debris.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (cur, target, tau, dt) => cur + (target - cur) * (1 - Math.exp(-dt / Math.max(tau, 1e-4)));
const tick = () => new Promise((r) => setTimeout(r, 0));
const RHO_GAME = 1.225 * 1.6; // sea-level game air density (see physics.js)

const ENV_DEFAULTS = {
  waterHeight: () => 0,
  waterFlow: null,
  groundHeight: () => -Infinity,
  groundNormal: null,
  contact: null,
  night: () => 0,
  rain: () => 0,
  wetness: null,
  worldLimit: null,
  emit: null,
};

// hints (constant objects: the HUD reads hint.key / hint.text)
const HINTS = {
  none: null,
  start: { key: 'seaplane.hint.start', text: 'Hold Q to start the engine' },
  cranking: { key: 'seaplane.hint.cranking', text: 'Cranking... keep holding Q' },
  flooded: { key: 'seaplane.hint.flooded', text: 'Engine flooded: wait, or crank at full throttle' },
  noFuel: { key: 'seaplane.hint.nofuel', text: 'Out of fuel' },
  waterRudders: { key: 'seaplane.hint.waterrudders', text: 'Press U to raise the water rudders for take-off' },
  beached: { key: 'seaplane.hint.beached', text: 'Beached: push off from a float bow (hold E outside)' },
  moored: { key: 'seaplane.hint.moored', text: 'Moored: cast off from the bow cleat' },
  stall: { key: 'seaplane.hint.stall', text: 'STALL - nose down' },
  flying: { key: 'seaplane.hint.flying', text: "Can't get out while flying" },
  moving: { key: 'seaplane.hint.moving', text: 'Slow down before getting out' },
  wreck: { key: 'seaplane.hint.wreck', text: 'Wrecked - hold E to get out' },
};

export function createSeaplane(options = {}) {
  const opts = Object.assign({
    scene: null, renderer: null, camera: null, quality: 'high', assist: 'normal',
    useOwnEffects: true, realLandingLight: false, seed: 7, env: null, audio: null,
  }, options);
  const env = Object.assign({}, ENV_DEFAULTS, opts.env || {});
  if (!env.wind) env.wind = new THREE.Vector3();
  if (!env.sunDirection) env.sunDirection = new THREE.Vector3(0.35, 0.85, 0.4).normalize();
  const rand = rng(opts.seed * 7919 + 3);

  // ---------------- scene graph ----------------
  const root = new THREE.Group(); // plane frame (origin at the CG at rest), moved by the module
  root.name = 'seaplane';
  root.visible = false;
  const worldRoot = new THREE.Group(); // world-space helpers: particles, ropes, chocks, light pool
  worldRoot.name = 'seaplane.world';
  if (opts.scene) { opts.scene.add(root); opts.scene.add(worldRoot); }

  // ---------------- materials (all variants exist from the start) ----------------
  const U = createSharedUniforms();
  const ph = placeholderTextures();
  const gaugePh = new THREE.DataTexture(new Uint8Array([20, 20, 22, 255]), 1, 1);
  gaugePh.colorSpace = THREE.SRGBColorSpace;
  gaugePh.needsUpdate = true;
  const mats = {
    paint: createPaintMaterial(U, ph, { detail: true }),
    paintLod: createPaintMaterial(U, ph, { detail: false }),
    hard: createHardMaterial(U, { detail: true }),
    hardLod: createHardMaterial(U, { detail: false, name: 'seaplane.hardLod' }),
    glass: createGlassMaterial(U, { detail: true }),
    glassLod: createGlassMaterial(U, { detail: false }),
    gauges: createGaugeMaterial(U, gaugePh, { name: 'seaplane.gauges', rig: true }),
    horizon: new THREE.MeshStandardMaterial({ name: 'seaplane.horizon', map: gaugePh, emissiveMap: gaugePh, emissive: new THREE.Color(1, 0.75, 0.55), emissiveIntensity: 0, roughness: 0.5, metalness: 0 }),
  };
  // the rig texture is created before the first compile so the sampler exists
  U.uSpRig.value = createRigTexture(1);

  // ---------------- simulation ----------------
  const physics = new SeaplanePhysics(env, { assist: opts.assist });
  const engine = new EngineModel(rand);
  engine.fuel[0] = engine.fuel[1] = 100;
  const controls = new Controls(JSON.parse(JSON.stringify(KEYMAP)));
  const seatCam = new SeatCamera();
  const chase = new ChaseCamera();
  let assist = opts.assist;
  let quality = opts.quality;

  // ---------------- runtime state ----------------
  const st = {
    ready: false, built: false, buildMs: 0, lod: 0, interiorVisible: false,
    flapDeg: 0, wrDown: 1, wrTarget: 1, autoTrim: 0,
    propAngle: 0, clock: 10 * 3600 + 10 * 60, wet: 0, wetOverride: null,
    exitHold: 0, cameraMode: 'cockpit', physicsMs: 0, pushOff: 0,
    lastThrottle: 0, pops: 0, throttleHandT: 0, burn: 0, flapMoving: false,
    slamCool: 0, prevFlapIndex: 0, ropeTension: 0, ropeJerk: 0, hint: null,
    yawRate: 0, prevHeading: 0, turnRate: 0, chop: 0, prevVy: 0,
  };
  const lights = { nav: false, landing: false };
  const doors = {
    doorL: { open: false, t: 0 },
    doorR: { open: false, t: 0 },
    cargo: { open: true, t: 1 },
  };
  const cmd = { pitch: 0, roll: 0, yaw: 0, throttle: 0, trim: 0 }; // pilot inputs used by the fixed step
  const eul = { heading: 0, pitch: 0, roll: 0 };
  let seated = false;
  let interaction = null;
  let effects = null;
  let audio = null;
  let debris = null;
  const debrisList = [];
  let model0 = null;
  let baked = null;
  const lods = [];
  const parts = { hinges: {}, doors: {}, props: [], propMeshes: [] };
  let interior = null;
  let rig = null; // { tex, parts: [], byName: {} }
  const handTargets = { left: new THREE.Object3D(), right: new THREE.Object3D() };
  handTargets.left.name = 'seaplane.hand.left';
  handTargets.right.name = 'seaplane.hand.right';
  root.add(handTargets.left, handTargets.right);
  const handPose = { left: 'grip', right: 'grip' };

  // scratch
  const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
  const _camPos = new THREE.Vector3(), _camQuat = new THREE.Quaternion(), _camScale = new THREE.Vector3();
  const _local = new THREE.Vector3(), _src = new THREE.Vector3();

  // ---------------- events ----------------
  function emit(type, data) {
    if (env.emit) env.emit(type, data);
    if (api.onEvent) api.onEvent(type, data);
  }

  // ---------------- doors ----------------
  function doorOpen(name) { const d = doors[name]; return !!d && d.open; }
  function toggleDoor(name, open) {
    const d = doors[name];
    if (!d) return;
    const target = open === undefined ? !d.open : !!open;
    if (target === d.open) return;
    d.open = target;
    if (audio) audio.trigger(target ? 'doorOpen' : 'doorClose', 0.9);
    emit('door', { name, open: target });
  }

  // ---------------- mooring ropes (visual) ----------------
  const ROPE_SEG = 16, ROPE_SIDES = 6, ROPE_MAX = 4;
  const ropeMeshes = [];
  {
    for (let i = 0; i < ROPE_MAX; i++) {
      const b = new GeoBuilder('hard');
      b.setColor(0x8a7650).setMat(0.85, 0, KIND.ROPE, 0.6);
      const pts = [];
      for (let k = 0; k <= ROPE_SEG; k++) pts.push(new THREE.Vector3(0, 0, -k * 0.1));
      tube(b, pts, 0.014, { sides: ROPE_SIDES });
      const g = b.toGeometry();
      g.attributes.position.setUsage(THREE.DynamicDrawUsage);
      g.attributes.normal.setUsage(THREE.DynamicDrawUsage);
      const m = new THREE.Mesh(g, mats.hardLod);
      m.name = 'seaplane.rope' + i;
      m.frustumCulled = false;
      m.castShadow = true;
      m.visible = false;
      m.userData.ring0 = 0;
      worldRoot.add(m);
      ropeMeshes.push(m);
    }
  }
  const _rp = Array.from({ length: ROPE_SEG + 1 }, () => new THREE.Vector3());
  const _rt = new THREE.Vector3(), _rn = new THREE.Vector3(), _rb = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function updateRope(mesh, a, b, length) {
    // sagging curve between the cleat (a) and the anchor (b)
    const d = a.distanceTo(b);
    const slack = Math.max(length - d, 0);
    const sag = Math.min(Math.sqrt(Math.max(0, slack * length)) * 0.55 + 0.04, 1.6);
    for (let k = 0; k <= ROPE_SEG; k++) {
      const t = k / ROPE_SEG;
      _rp[k].lerpVectors(a, b, t);
      _rp[k].y -= 4 * sag * t * (1 - t);
    }
    const pos = mesh.geometry.attributes.position, nor = mesh.geometry.attributes.normal;
    const P = pos.array, N = nor.array;
    // tube() lays out rings of (sides + 1) vertices
    const ring = ROPE_SIDES + 1;
    for (let k = 0; k <= ROPE_SEG; k++) {
      const k0 = Math.max(k - 1, 0), k1 = Math.min(k + 1, ROPE_SEG);
      _rt.subVectors(_rp[k1], _rp[k0]).normalize();
      _rn.crossVectors(_rt, _up);
      if (_rn.lengthSq() < 1e-6) _rn.set(1, 0, 0);
      _rn.normalize();
      _rb.crossVectors(_rn, _rt).normalize();
      for (let j = 0; j < ring; j++) {
        const ang = (j / ROPE_SIDES) * TAU;
        const cx = Math.cos(ang), sy = Math.sin(ang);
        const nx = _rn.x * cx + _rb.x * sy, ny = _rn.y * cx + _rb.y * sy, nz = _rn.z * cx + _rb.z * sy;
        const o = (k * ring + j) * 3;
        if (o + 2 >= P.length) continue;
        P[o] = _rp[k].x + nx * 0.014; P[o + 1] = _rp[k].y + ny * 0.014; P[o + 2] = _rp[k].z + nz * 0.014;
        N[o] = nx; N[o + 1] = ny; N[o + 2] = nz;
      }
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
  }

  // ---------------- chocks (world props, physics boxes) ----------------
  const chockGroup = new THREE.Group();
  chockGroup.name = 'seaplane.chocks';
  chockGroup.visible = false;
  worldRoot.add(chockGroup);
  const CHOCK_Z = [-0.5, 1.45]; // model z under the flat keel
  const CHOCK_H = 0.31;
  {
    const b = new GeoBuilder('hard');
    const r = rng(opts.seed * 3 + 11);
    for (const fx of [-DIM.float.x, DIM.float.x]) for (const z of CHOCK_Z) chockGeo(b, new THREE.Matrix4().makeTranslation(fx, 0, z - CG_MODEL.z), r);
    const m = new THREE.Mesh(b.toGeometry(), mats.hardLod);
    m.name = 'seaplane.chocks';
    m.castShadow = true;
    m.receiveShadow = true;
    chockGroup.add(m);
  }

  // ---------------- placement ----------------
  const _pq = new THREE.Quaternion(), _pp = new THREE.Vector3(), _yAxis = new THREE.Vector3(0, 1, 0);
  function settle(seconds) {
    // pre-simulate so the plane appears at rest (engine off, no input)
    const n = Math.round(seconds / (1 / 120));
    for (let i = 0; i < n; i++) physics.update(1 / 120);
    physics.vel.multiplyScalar(0.2);
    physics.w.multiplyScalar(0.2);
  }
  function clearWorldProps() {
    physics.chocks.length = 0;
    chockGroup.visible = false;
    api.castOff(true);
  }
  function placeOnWater(x, z, yaw = 0) {
    clearWorldProps();
    const wh = env.waterHeight(x, z);
    _pq.setFromAxisAngle(_yAxis, yaw);
    _pp.set(x, wh + CG_MODEL.y - 0.33, z);
    physics.place(_pp, _pq);
    st.wrTarget = 1; st.wrDown = 1;
    settle(2.5);
    chase.reset();
    syncPose(0);
  }
  function placeOnBeach(x, z, yaw = 0) {
    clearWorldProps();
    _pq.setFromAxisAngle(_yAxis, yaw);
    // chocks: 2 under each float keel, following the ground
    let top = -Infinity;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (const fx of [-DIM.float.x, DIM.float.x]) {
      for (const zm of CHOCK_Z) {
        const lz = zm - CG_MODEL.z;
        const wx = x + cy * fx + sy * lz, wz = z - sy * fx + cy * lz;
        const g = env.groundHeight(wx, wz);
        const gh = Number.isFinite(g) ? g : env.waterHeight(wx, wz) - 0.3;
        physics.chocks.push({ c: new THREE.Vector3(wx, gh + CHOCK_H / 2, wz), h: new THREE.Vector3(0.45, CHOCK_H / 2, 0.11), ry: yaw });
        top = Math.max(top, gh + CHOCK_H);
      }
    }
    // the chock mesh is one rigid group: put it at the average ground height
    let avg = 0;
    for (const c of physics.chocks) avg += c.c.y - CHOCK_H / 2;
    avg /= physics.chocks.length;
    chockGroup.position.set(x, avg, z);
    chockGroup.quaternion.copy(_pq);
    for (const c of physics.chocks) c.c.y = avg + CHOCK_H / 2;
    chockGroup.visible = true;
    _pp.set(x, avg + CHOCK_H + CG_MODEL.y + 0.04, z);
    physics.place(_pp, _pq);
    st.wrTarget = 0; st.wrDown = 0;
    settle(3);
    chase.reset();
    syncPose(0);
  }

  // ---------------- pose sync ----------------
  function syncPose(alpha) {
    physics.renderPose(alpha, root.position, root.quaternion);
    root.updateMatrixWorld(true);
  }

  // ---------------- build (async: geometry, atlas, bake, assembly) ----------------
  async function build() {
    const t0 = performance.now();
    const m0 = buildAirframe(0, opts.seed);
    const atlas = layoutAtlas(m0.ctx, 2048);
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
    model0 = m0;
    if (opts.renderer) rebake();
    // instruments
    const gaugeAtlas = createGaugeAtlas(quality === 'low' ? 1024 : 2048);
    mats.gauges.map = gaugeAtlas.texture;
    mats.gauges.emissiveMap = gaugeAtlas.texture;
    const horizonTex = createHorizonTexture(256);
    mats.horizon.map = horizonTex;
    mats.horizon.emissiveMap = horizonTex;
    gaugePh.dispose();
    // assembly
    const a0 = assembleLod0(m0, mats);
    const a1 = assembleLodN(m1, mats, 1);
    const a2 = assembleLodN(m2, mats, 2);
    lods.push(a0, a1, a2);
    root.add(a0.group, a1.group, a2.group);
    a1.group.visible = false;
    a2.group.visible = false;
    Object.assign(parts.hinges, a0.hinges);
    Object.assign(parts.doors, a0.doors);
    parts.props = [a0.propPivot, a1.propPivot, a2.propPivot];
    parts.propMeshes = [a0.propMesh, a1.propMesh, a2.propMesh];
    parts.spinners = [a0.spinner, a1.spinner].filter(Boolean);
    for (const k in doors) {
      const pd = parts.doors[k];
      if (pd) { const e = doors[k].t * doors[k].t * (3 - 2 * doors[k].t); pd.hinge.set(pd.openAngle * e); }
    }
    interior = assembleInterior(m0, mats);
    root.add(interior.group);
    interior.group.visible = false;
    // rig texture for the moving cockpit parts
    const rigTex = createRigTexture(m0.interior.parts.length);
    U.uSpRig.value.dispose();
    U.uSpRig.value = rigTex;
    rig = { tex: rigTex, parts: m0.interior.parts, byName: {} };
    for (const p of rig.parts) rig.byName[p.name] = p;
    // anchors for interaction & effects
    const anchors = Object.assign({}, m0.anchors, m0.interior.anchors);
    for (const k of ['cleatBow', 'cleatStern', 'cleatMid']) {
      const r = anchors[k + 'R'];
      if (r && !anchors[k + 'L']) anchors[k + 'L'] = new THREE.Vector3(-r.x, r.y, r.z);
    }
    planeCtx.anchors = anchors;
    interaction = new Interaction(planeCtx);
    api.interactables = interaction.interactables;
    api.walkShapes = interaction.walkShapes;
    api.blockShapes = interaction.blockShapes;
    effects = new Effects({ U, quality, useOwnEffects: opts.useOwnEffects, realLandingLight: opts.realLandingLight, model: m0, root, worldRoot, env, rand });
    // crash debris: pre-split floats / outer wing panels / propeller
    debris = new Debris({
      root, worldRoot, lods, hinges: parts.hinges, physics, env, rand: rng(opts.seed * 31 + 5),
      prop: { pivot: a0.propPivot, hub: m0.prop.hub, radius: DIM.propRadius },
      onSplash: (x, y, z, k, vel) => { if (effects) effects.splash(x, y, z, k, vel); if (audio) audio.trigger('splash', k * 0.7); },
      onImpact: (k) => { if (audio) audio.trigger('impact', k); },
      onDetach: (id) => emit('detached', { part: id }),
    });
    if (opts.audio && opts.audio.ctx) audio = createSeaplaneAudio(opts.audio.ctx, opts.audio.out || opts.audio.ctx.destination, { seed: opts.seed, listener: opts.audio.listener || 'camera' });
    // shadows: big exterior parts cast, interior and tiny parts do not
    root.traverse((o) => { if (o.isMesh && o.parent && o.parent.name === 'seaplane.interior') { o.castShadow = false; o.receiveShadow = true; } });
    st.buildMs = performance.now() - t0;
    st.built = true;
    st.ready = true;
    syncPose(0);
    root.visible = true;
  }

  function rebake() {
    if (!opts.renderer || !model0) return;
    const high = quality !== 'low';
    const nb = bakeAirframe(opts.renderer, model0, { size: high ? 2048 : 1024, dataSize: high ? 1024 : 512, seed: opts.seed });
    for (const k of ['paint', 'paintLod']) {
      mats[k].map = nb.map; mats[k].roughnessMap = nb.data; mats[k].metalnessMap = nb.data; mats[k].aoMap = nb.data;
    }
    if (baked) baked.dispose();
    baked = nb;
  }

  // internal context handed to Interaction
  const planeCtx = {
    anchors: null, physics, engine, lights, env, emit,
    doorOpen, toggleDoor,
    get api() { return api; },
  };

  // ---------------- per fixed step: engine, controls, assists ----------------
  const _tb = new THREE.Vector3();
  physics.onPreStep = (h) => {
    const o = physics.out;
    const pin = physics.input;
    // engine
    const axial = Math.max(0, -physics.toBodyDir(physics.vel, _tb).z);
    const rhoK = o.rho ? o.rho / RHO_GAME : 1;
    engine.throttleCmd = cmd.throttle;
    engine.step(h, axial, rhoK, Math.max(0, o.engineWater || 0), o.propStrike || 0);
    const propOn = !physics.detached.prop;
    pin.thrust = propOn ? engine.thrust : 0;
    pin.torque = engine.torque;
    pin.rpm = engine.rpm;
    // pilot inputs + assists
    const airborne = !o.onWater && !o.groundContact;
    const V = o.airspeed;
    let el = cmd.pitch, ai = cmd.roll, ru = cmd.yaw;
    // on water / ground: A/D also steer (air rudder + water rudders), fading out with speed
    const steerK = !airborne ? 1 - smooth(12, 22, V) : 0;
    ru = clamp(ru + ai * steerK, -1, 1);
    if (assist !== 'realistic' && airborne && V > 12) {
      // auto-coordination: rudder removes sideslip unless the pilot is on the pedals
      ru = clamp(ru + clamp(-5 * o.beta - 0.6 * physics.w.y * 0, -1, 1) * (1 - Math.abs(cmd.yaw)), -1, 1);
    }
    let trim = cmd.trim;
    if (assist === 'arcade' && airborne && V > 14) {
      physics.euler(eul);
      if (Math.abs(cmd.roll) < 0.05) ai = clamp(ai - 1.5 * eul.roll + 0.45 * physics.w.z, -0.6, 0.6);
      if (Math.abs(cmd.pitch) < 0.05) st.autoTrim = clamp(st.autoTrim + clamp(-physics.vel.y * 0.05 - physics.w.x * 0.6, -0.5, 0.5) * h, -1, 1);
      trim = clamp(trim + st.autoTrim, -1, 1);
      if (o.stall > 0.15 && el > -0.2) el = el * (1 - smooth(0.15, 0.7, o.stall)) - 0.35 * smooth(0.3, 0.9, o.stall);
    }
    pin.elevator = el;
    pin.aileron = ai;
    pin.rudder = ru;
    pin.trim = trim;
    pin.flaps = st.flapDeg * DEG;
    pin.waterRudder = ru;
    pin.waterRudderDown = st.wrDown;
    pin.pushOff = st.pushOff;
  };

  // ---------------- commands ----------------
  const _cmds = [];
  function command(name) {
    switch (name) {
      case 'flapsUp':
        if (controls.flapIndex > 0) { controls.flapIndex--; if (audio) audio.trigger('detent', 0.8); }
        break;
      case 'flapsDown':
        if (controls.flapIndex < FLAP_NOTCHES.length - 1) { controls.flapIndex++; if (audio) audio.trigger('detent', 0.8); }
        break;
      case 'toggleWaterRudder':
        st.wrTarget = st.wrTarget > 0.5 ? 0 : 1;
        if (audio) audio.trigger('clunk', 0.6);
        break;
      case 'cycleLights':
        if (!lights.nav) lights.nav = true;
        else if (!lights.landing) lights.landing = true;
        else { lights.nav = false; lights.landing = false; }
        if (audio) audio.trigger('click', 1);
        emit('lights', lights);
        break;
      case 'toggleCamera':
        st.cameraMode = st.cameraMode === 'cockpit' ? 'chase' : 'cockpit';
        chase.reset();
        break;
      case 'engineDown':
        if (engine.state !== 'running' && audio) audio.trigger('detent', 0.7);
        break;
      case 'engineUp':
        engine.setStarter(false);
        break;
      case 'engineTap':
        if (engine.state === 'running') engine.shutdown();
        engine.setStarter(false);
        break;
      case 'engineStop':
        engine.setStarter(false);
        engine.shutdown();
        break;
      case 'interactDown':
        st.exitHold = 0;
        break;
      case 'interactUp':
        st.exitHold = 0;
        break;
      default:
        break;
    }
  }

  // ---------------- animation helpers ----------------
  const wob = Array.from({ length: 16 }, () => ({ th: new THREE.Vector3(), vel: new THREE.Vector3() }));
  // per wobble group: lever direction (plane-local), natural frequency, damping ratio, gain
  const WOB_DEF = [
    null,
    { r: new THREE.Vector3(0, 1, 0), f: 2.6, z: 0.18, g: 0.006, wind: 0.002 }, // roof rack load
    { r: new THREE.Vector3(0, -1, 0), f: 1.7, z: 0.12, g: 0.012, wind: 0.004 }, // right strut bags
    { r: new THREE.Vector3(0, -1, 0), f: 1.8, z: 0.12, g: 0.012, wind: 0.004 }, // left strut bags
    { r: new THREE.Vector3(0, -1, 0), f: 1.5, z: 0.1, g: 0.014, wind: 0.005 }, // under-wing bag
    { r: new THREE.Vector3(0, 1, 0), f: 3.5, z: 0.25, g: 0.004, wind: 0.0015 }, // side bags
    { r: new THREE.Vector3(0, 1, 0), f: 2.2, z: 0.05, g: 0.008, wind: 0.01 }, // antennas
    { r: new THREE.Vector3(0, -1, 0), f: 1.3, z: 0.1, g: 0.01, wind: 0.003 }, // ropes
    null,
    { r: new THREE.Vector3(0, -1, 0), f: 1.4, z: 0.12, g: 0.02, wind: 0 }, // harness straps
    { r: new THREE.Vector3(0, -1, 0), f: 1.1, z: 0.08, g: 0.025, wind: 0 }, // headset
    { r: new THREE.Vector3(0, -1, 0), f: 0.9, z: 0.04, g: 0.04, wind: 0 }, // talisman
  ];
  const _acc = new THREE.Vector3(), _drive = new THREE.Vector3();
  let wobT = 0;
  function updateWobble(dt) {
    wobT += dt;
    const o = physics.out;
    const acc = o.accBody ? _acc.copy(o.accBody) : _acc.set(0, 9.81, 0);
    acc.y -= 9.81; // dynamic part only
    const eng = engine.state === 'running' ? 1 : engine.state === 'cranking' ? 0.6 : 0;
    const vib = eng * (0.25 + engine.rough * 0.8 + (1 - engine.propHealth) * 2) + st.chop * 1.5;
    const windS = env.wind.length() + o.airspeed * 0.4;
    const W = U.uSpWob.value;
    for (let g = 1; g < WOB_DEF.length; g++) {
      const d = WOB_DEF[g];
      if (!d) continue;
      const s = wob[g];
      // inertial drive: rotation that makes the item lag behind the acceleration
      _drive.crossVectors(d.r, acc).multiplyScalar(-d.g * 0.1);
      const n = Math.sin(wobT * (7.1 + g) + g) * 0.6 + Math.sin(wobT * (13.7 + g * 1.3)) * 0.4;
      _drive.x += n * (vib * 0.002 + d.wind * windS * 0.05);
      _drive.z += Math.sin(wobT * (5.3 + g * 0.7) + 2 * g) * (vib * 0.0015 + d.wind * windS * 0.04);
      const w0 = TAU * d.f;
      const k = w0 * w0, c = 2 * d.z * w0;
      const h = Math.min(dt, 1 / 30);
      s.vel.x += (k * (_drive.x - s.th.x) - c * s.vel.x) * h;
      s.vel.y += (k * (_drive.y - s.th.y) - c * s.vel.y) * h;
      s.vel.z += (k * (_drive.z - s.th.z) - c * s.vel.z) * h;
      s.th.addScaledVector(s.vel, h);
      s.th.clampScalar(-0.25, 0.25);
      W[g].copy(s.th);
    }
    // bent propeller: static deformation in prop space
    const bend = 1 - engine.propHealth;
    W[PROP_BEND_GROUP].set(bend * 0.35, 0, bend * 0.1);
  }

  // cockpit rig (moving controls, needles, cards)
  const needles = {
    asi: 0, alt100: 0, alt1000: 0, vsi: 0, tach: 0, mp: 29.9, cht: 26, oilT: 26, oilP: 0, fuelL: 0, fuelR: 0, amps: 0, flaps: 0,
    hdg: 0, pitch: 0, roll: 0, turn: 0, ball: 0, ballV: 0,
  };
  const _rm = new THREE.Matrix4(), _rv = new THREE.Vector3();
  function rigRotate(name, angle, slide = 0) {
    const p = rig.byName[name];
    if (!p) return;
    if (p.axis) _rm.makeRotationAxis(p.axis, angle); else _rm.identity();
    // keep the pivot fixed: t = pivot - R * pivot
    _rv.copy(p.pivot).applyMatrix4(_rm);
    const e = _rm.elements;
    e[12] = p.pivot.x - _rv.x; e[13] = p.pivot.y - _rv.y; e[14] = p.pivot.z - _rv.z;
    if (slide && p.slide) { e[12] += p.slide.x * slide; e[13] += p.slide.y * slide; e[14] += p.slide.z * slide; }
    setRigMatrix(rig.tex, p.index, _rm);
  }
  function rigSlide2(name, a, b, axisB) {
    const p = rig.byName[name];
    if (!p) return;
    _rm.identity();
    const e = _rm.elements;
    e[12] = p.slide.x * a + axisB.x * b; e[13] = p.slide.y * a + axisB.y * b; e[14] = p.slide.z * a + axisB.z * b;
    setRigMatrix(rig.tex, p.index, _rm);
  }
  const PANEL_UP = new THREE.Vector3(0, Math.cos(10 * DEG), -Math.sin(10 * DEG));
  function updateCockpit(dt) {
    const o = physics.out;
    const e = engine;
    const jitter = (e.state === 'running' ? 0.004 + e.rough * 0.01 : 0) * Math.sin(st.clock * 97.3);
    const rhoK = o.rho ? o.rho / RHO_GAME : 1;
    const ias = o.airspeed * Math.sqrt(rhoK) * 1.944;
    const altFt = Math.max(0, physics.cg.y) * 3.281;
    needles.asi = damp(needles.asi, ias, 0.25, dt);
    needles.alt100 = damp(needles.alt100, altFt, 0.3, dt);
    needles.vsi = damp(needles.vsi, physics.vel.y * 196.85, 1.4, dt);
    needles.tach = damp(needles.tach, e.rpm, 0.15, dt);
    needles.mp = damp(needles.mp, e.manifold, 0.25, dt);
    needles.cht = damp(needles.cht, e.cht, 3, dt);
    needles.oilT = damp(needles.oilT, e.oilTemp, 2, dt);
    needles.oilP = damp(needles.oilP, e.oilPress, 0.5, dt);
    const elec = e.master ? 1 : 0;
    needles.fuelL = damp(needles.fuelL, elec * e.fuel[0] / 140, 1.5, dt);
    needles.fuelR = damp(needles.fuelR, elec * e.fuel[1] / 140, 1.5, dt);
    needles.amps = damp(needles.amps, e.amps, 0.3, dt);
    needles.flaps = damp(needles.flaps, elec * st.flapDeg, 0.2, dt);
    physics.euler(eul);
    // gyros: heading & attitude lag a little; turn rate from the heading change
    let dh = eul.heading - needles.hdg;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    needles.hdg += dh * (1 - Math.exp(-dt / 0.35));
    needles.pitch = damp(needles.pitch, eul.pitch, 0.15, dt);
    let dr = eul.roll - needles.roll;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    needles.roll += dr * (1 - Math.exp(-dt / 0.15));
    let dHdg = eul.heading - st.prevHeading;
    dHdg = Math.atan2(Math.sin(dHdg), Math.cos(dHdg));
    st.prevHeading = eul.heading;
    // ignore teleports (placement) and keep the gyro in its mechanical range
    const hdgRate = Math.abs(dHdg) > 0.3 ? 0 : clamp(dHdg / Math.max(dt, 1e-4), -0.5, 0.5);
    needles.turn = damp(needles.turn, hdgRate / DEG, 0.5, dt);
    // slip ball: damped mass in a curved tube, driven by the lateral specific force
    const fx = o.accBody ? o.accBody.x : 0;
    const target = clamp(-fx / 9.81 * 0.09, -0.022, 0.022);
    needles.ballV += ((target - needles.ball) * 120 - needles.ballV * 14) * Math.min(dt, 1 / 30);
    needles.ball = clamp(needles.ball + needles.ballV * Math.min(dt, 1 / 30), -0.024, 0.024);
    // ---- write needles (angle clockwise from 12 o'clock -> rotation about the panel normal)
    rigRotate('needle.asi', -(NEEDLE.airspeed(needles.asi) + jitter));
    rigRotate('needle.alt100', -NEEDLE.altimeter100(needles.alt100));
    rigRotate('needle.alt1000', -NEEDLE.altimeter1000(needles.alt100));
    rigRotate('needle.vsi', -NEEDLE.vsi(needles.vsi));
    rigRotate('needle.tach', -(NEEDLE.tach(needles.tach) + jitter));
    rigRotate('needle.mp', -NEEDLE.manifold(needles.mp));
    rigRotate('needle.cht', -NEEDLE.cht(needles.cht));
    rigRotate('needle.oilT', -NEEDLE.oilT(needles.oilT));
    rigRotate('needle.oilP', -(NEEDLE.oilP(needles.oilP) + jitter * 0.5));
    rigRotate('needle.fuelL', -NEEDLE.fuelL(needles.fuelL));
    rigRotate('needle.fuelR', -NEEDLE.fuelR(needles.fuelR));
    rigRotate('needle.amps', -NEEDLE.amps(needles.amps));
    rigRotate('needle.flaps', -NEEDLE.flaps(needles.flaps));
    const hrs = (st.clock / 3600) % 12, mins = (st.clock / 60) % 60;
    rigRotate('needle.clockH', -(hrs / 12) * TAU);
    rigRotate('needle.clockM', -(mins / 60) * TAU);
    rigRotate('headingCard', needles.hdg);
    rigRotate('compassCard', needles.hdg + Math.sin(st.clock * 0.7) * 0.02 * (1 + st.chop * 4));
    rigRotate('turnPlane', -clamp((needles.turn / 3) * 20, -35, 35) * DEG);
    rigSlide2('slipBall', needles.ball, (needles.ball * needles.ball) / (2 * 0.04), PANEL_UP);
    // ---- controls
    rigRotate('yokeL', -cmd.roll * 0.6, cmd.pitch * 0.075);
    rigRotate('yokeR', -cmd.roll * 0.6, cmd.pitch * 0.075);
    const yw = cmd.yaw + (physics.out.onWater ? physics.input.rudder - cmd.yaw : 0) * 0.5;
    rigRotate('pedalLl', yw * 0.22); rigRotate('pedalRl', yw * 0.22);
    rigRotate('pedalLr', -yw * 0.22); rigRotate('pedalRr', -yw * 0.22);
    rigRotate('lever.throttle', (0.5 - engine.throttle) * 0.9);
    rigRotate('lever.prop', (0.5 - engine.propLever) * 0.9);
    rigRotate('lever.mixture', (0.5 - engine.mixture) * 0.9);
    rigRotate('trimWheel', -(physics.input.trim) * 3.2);
    rigRotate('flapLever', (st.flapDeg / 30) * 0.85);
    rigRotate('waterRudderHandle', 0, (1 - st.wrDown) * 0.06);
    const fs = engine.fuelSelector;
    rigRotate('fuelSelector', fs === 'left' ? 0.8 : fs === 'right' ? -0.8 : fs === 'off' ? 1.57 : 0);
    rigRotate('switch.master', engine.master ? -0.5 : 0.45);
    rigRotate('switch.nav', lights.nav ? -0.5 : 0.45);
    rigRotate('switch.landing', lights.landing ? -0.5 : 0.45);
    rigRotate('switch.panel', lights.nav ? -0.5 : 0.45);
    rigRotate('switch.pump', engine.state === 'cranking' || engine.state === 'running' ? -0.5 : 0.45);
    rigRotate('switch.avionics', engine.master ? -0.5 : 0.45);
    rigRotate('magKey', -(engine.magnetos * 0.5) - (engine.state === 'cranking' ? 0.45 : 0));
    rig.tex.needsUpdate = true;
    // ---- attitude indicator card (texture transform)
    const ht = mats.horizon.map;
    if (ht && ht.matrix) {
      const c = Math.cos(needles.roll), s = Math.sin(needles.roll);
      const sv = 0.5; // the disc shows 60 deg of pitch
      const pv = (needles.pitch / DEG) / (ht.userData.degPerUv || 120);
      // uv' = C + R * S * (uv - C) + (0, pitch)
      // uv' = C + S * R * (uv - C) + (0, pitch); S = diag(1, sv) maps the round disc onto the tall card
      const a = c, b = -s, d = s * sv, e2 = c * sv;
      ht.matrix.set(a, b, 0.5 - 0.5 * a - 0.5 * b, d, e2, 0.5 - 0.5 * d - 0.5 * e2 + pv, 0, 0, 1);
    }
    // ---- lamps
    const night = env.night();
    const panel = engine.master && lights.nav;
    const lamp = U.uSpLamp.value;
    lamp[3] = engine.master && st.stallWarn ? 1.4 : 0;
    lamp[4] = engine.master && engine.fuel[0] + engine.fuel[1] < 30 ? 0.8 : 0;
    lamp[5] = panel ? 0.05 + 0.3 * night : 0;
    lamp[6] = 0;
    lamp[7] = panel && night > 0.5 ? 0.5 : 0;
    const back = panel ? 0.04 + 0.5 * night : engine.master ? 0.015 : 0;
    mats.gauges.emissiveIntensity = back;
    mats.horizon.emissiveIntensity = back * 0.6;
  }

  function updateHands(dt) {
    if (!rig) return;
    const yoke = interaction && interaction.seatId === 'copilot' ? 'yokeR' : 'yokeL';
    const grips = planeCtx.anchors['yokeGrip' + (yoke === 'yokeL' ? 'L' : 'R')];
    const yp = rig.byName[yoke];
    if (!grips || !yp) return;
    // yoke transform (same as the rig write)
    _rm.makeRotationAxis(yp.axis, -cmd.roll * 0.6);
    _rv.copy(yp.pivot).applyMatrix4(_rm);
    const e = _rm.elements;
    e[12] = yp.pivot.x - _rv.x + yp.slide.x * cmd.pitch * 0.075;
    e[13] = yp.pivot.y - _rv.y + yp.slide.y * cmd.pitch * 0.075;
    e[14] = yp.pivot.z - _rv.z + yp.slide.z * cmd.pitch * 0.075;
    handTargets.left.position.copy(grips[0]).applyMatrix4(_rm);
    handTargets.left.quaternion.setFromRotationMatrix(_rm);
    // right hand: on the throttle while the throttle moves, back on the yoke after a while
    if (Math.abs(cmd.throttle - st.lastThrottle) > 1e-4) st.throttleHandT = 1.5;
    st.lastThrottle = cmd.throttle;
    st.throttleHandT = Math.max(0, st.throttleHandT - dt);
    const onLever = st.throttleHandT > 0;
    _v.copy(grips[1]).applyMatrix4(_rm);
    const knob = planeCtx.anchors.throttleKnob;
    if (knob && onLever) {
      const lp = rig.byName['lever.throttle'];
      _m.makeRotationAxis(lp.axis, (0.5 - engine.throttle) * 0.9);
      _w.copy(lp.pivot).applyMatrix4(_m);
      const me = _m.elements;
      me[12] = lp.pivot.x - _w.x; me[13] = lp.pivot.y - _w.y; me[14] = lp.pivot.z - _w.z;
      _w.copy(knob).applyMatrix4(_m);
      handTargets.right.position.lerp(_w, Math.min(1, dt * 10));
    } else handTargets.right.position.lerp(_v, Math.min(1, dt * 6));
    handTargets.right.quaternion.copy(handTargets.left.quaternion);
    handPose.left = 'grip';
    handPose.right = onLever ? 'lever' : 'grip';
  }

  // ---------------- LOD & interior visibility ----------------
  const CABIN_MIN = new THREE.Vector3(-0.75, -0.6, -1.0), CABIN_MAX = new THREE.Vector3(0.75, 1.3, 2.2);
  function updateLod(camPos) {
    const d = camPos.distanceTo(root.position);
    let lod = st.lod;
    if (lod === 0 && d > 33) lod = 1;
    else if (lod === 1 && d < 27) lod = 0;
    else if (lod === 1 && d > 160) lod = 2;
    else if (lod === 2 && d < 140) lod = 1;
    if (d < 27) lod = 0;
    if (lod !== st.lod) {
      st.lod = lod;
      for (let i = 0; i < lods.length; i++) lods[i].group.visible = i === lod;
    }
    // interior: camera inside the cabin, or within ~12 m of the cabin (doors / windows)
    _local.copy(camPos).applyMatrix4(_m.copy(root.matrixWorld).invert());
    const inside = _local.x > CABIN_MIN.x && _local.x < CABIN_MAX.x && _local.y > CABIN_MIN.y && _local.y < CABIN_MAX.y && _local.z > CABIN_MIN.z && _local.z < CABIN_MAX.z;
    st.camInside = inside;
    const vis = lod === 0 && (inside || _local.length() < 12);
    if (vis !== st.interiorVisible) { st.interiorVisible = vis; interior.group.visible = vis; }
  }

  // ---------------- frame contexts for effects / audio ----------------
  const fx = {
    M: root.matrixWorld, vel: physics.vel, out: physics.out, physics,
    night: 0, rain: 0, wetness: 0, rpm: 0, omega: 0, running: false, power: 0, misfire: 0, engineDamage: 0, fire: false,
    propAttached: true, navOk: true, propBent: false, lights, camPos: _camPos, camQuat: _camQuat, camFov: 60, viewH: 1080, chop: 0, rollSign: 0, fogDensity: 0,
  };
  const af = {
    rpm: 0, combust: false, load: 0, misfire: 0, rough: 0, starter: false, knock: 0, bend: 0, airspeed: 0, pops: 0, grind: 0, scrape: 0,
    rattle: 0, fire: 0, flap: 0, onWater: false, waterSpeed: 0, spray: 0, inside: false, doorOpen: 0, srcPos: _src, camPos: _camPos,
    camQuat: _camQuat, turbulence: 0, stallWarn: false, chop: 0, ropeJerk: 0, gLoad: 1,
  };

  // ---------------- per-frame update ----------------
  const _evs = [];
  function update(dtIn) {
    if (!st.built) return;
    const dt = clamp(dtIn || 0, 0, 0.1);
    st.clock += dt;
    U.uSpTime.value += dt;
    const o = physics.out;
    // ---- input
    const pilot = seated && interaction && !interaction.transition;
    controls.enabled = pilot;
    controls.update(dt);
    controls.drainCommands(_cmds);
    if (pilot) for (let i = 0; i < _cmds.length; i++) command(_cmds[i]);
    if (pilot) {
      cmd.pitch = controls.pitch; cmd.roll = controls.roll; cmd.yaw = controls.yaw;
      cmd.throttle = controls.throttle; cmd.trim = controls.trim;
      // hold E to get out (when the host uses attachInput)
      if (controls.held.interact) {
        st.exitHold += dt;
        if (st.exitHold > 0.6) { st.exitHold = 0; controls.held.interact = false; api.unseat(); }
      } else st.exitHold = 0;
      // Q held: crank (also via setControls({ starter: true })); released: starter off
      const held = controls.held.engine;
      if (held && !st.engHeld && engine.state !== 'running') engine.setStarter(true);
      if (!held && engine.starter) engine.setStarter(false);
      st.engHeld = held;
    } else {
      cmd.pitch = 0; cmd.roll = 0; cmd.yaw = 0;
      if (engine.starter) engine.setStarter(false);
    }
    // flaps (electric motor, ~5 deg/s), water rudders
    const flapT = FLAP_NOTCHES[controls.flapIndex] * (physics.wreck ? 0 : 1);
    const df = flapT - st.flapDeg;
    st.flapMoving = Math.abs(df) > 0.05 && engine.master;
    if (st.flapMoving) st.flapDeg += clamp(df, -5 * dt, 5 * dt);
    st.wrDown = clamp(st.wrDown + clamp(st.wrTarget - st.wrDown, -dt, dt), 0, 1);
    // push-off (interaction hold) decays unless refreshed every frame
    st.pushOff = Math.max(0, st.pushOff - dt * 4);
    // ---- physics
    const t0 = performance.now();
    const alpha = physics.update(dt);
    st.physicsMs = st.physicsMs * 0.9 + (performance.now() - t0) * 0.1;
    syncPose(alpha);
    // ---- events
    _evs.length = 0;
    for (const ev of physics.events) _evs.push(ev);
    physics.events.length = 0;
    for (const ev of _evs) onPhysicsEvent(ev);
    for (const e of engine.events) onEngineEvent(e);
    engine.events.length = 0;
    syncDetached();
    // ---- payload follows the seats
    // ---- camera (host's main camera)
    const cam = opts.camera;
    if (cam) {
      cam.matrixWorld.decompose(_camPos, _camQuat, _camScale);
      fx.camFov = cam.fov || 60;
    }
    // ---- animation
    animate(dt);
    debris.update(dt);
    if (cam) updateLod(_camPos);
    // ---- seat camera springs & chase camera
    const shake = _shake;
    shake.engine = engine.state === 'running' ? 0.6 + engine.rough + (1 - engine.propHealth) * 3 : engine.state === 'cranking' ? 0.8 : 0;
    shake.rpm = engine.rpm;
    shake.chop = st.chop;
    shake.buffet = o.stall * (o.onWater ? 0 : 1) * smooth(8, 20, o.airspeed);
    shake.turbulence = Math.min(1, physics.gust.length() / 3);
    seatCam.update(dt, o.accBody || _zero, shake, o.airspeed);
    if (seated && st.cameraMode === 'chase') {
      st.yawRate = damp(st.yawRate, -physics.w.y, 0.3, dt);
      chase.update(dt, root.position, root.quaternion, physics.vel, st.yawRate, env);
    }
    // ---- interaction, effects, audio
    const wasSeatedInside = interaction.seated;
    interaction.update(dt, root.matrixWorld);
    if (seated && !interaction.seated && !interaction.transition) seated = false;
    if (!wasSeatedInside && interaction.seated) {
      // pilot pulls the door shut after climbing in
      const dn = interaction.seatId === 'copilot' ? 'doorR' : 'doorL';
      if (doors[dn].open) toggleDoor(dn, false);
    }
    updateHands(dt);
    frameEffects(dt);
    frameAudio(dt);
    updateState(dt);
  }
  const _shake = { engine: 0, rpm: 0, chop: 0, buffet: 0, turbulence: 0 };
  const _zero = new THREE.Vector3(0, 9.81, 0);

  function onEngineEvent(e) {
    if (effects) effects.onEngineEvent(e, fx);
    if (audio) {
      if (e === 'starterOn') audio.trigger('clunk', 0.9);
      else if (e === 'cough') audio.trigger('cough', 1);
      else if (e === 'catch') audio.trigger('cough', 4);
      else if (e === 'backfire') audio.trigger('backfire', 1);
      else if (e === 'runDown') audio.trigger('backfire', 0.45);
      else if (e === 'splash') audio.trigger('splash', 0.5);
      else if (e.startsWith('stall:')) audio.trigger('backfire', 0.7);
    }
    emit('engine', e);
  }

  // pieces that broke off (or were repaired): statics, debris bodies, walk shapes, ropes
  function syncDetached() {
    if (!debris || !debris.sync()) return;
    const det = physics.detached;
    interaction.setFloatAttached('L', !det.floatL);
    interaction.setFloatAttached('R', !det.floatR);
    if ((det.floatL || det.floatR) && physics.moor.length) api.castOff();
  }

  function onPhysicsEvent(ev) {
    if (effects) effects.onPhysicsEvent(ev, fx);
    if (audio) {
      if (ev.type === 'touchdown') {
        if (!ev.ground) {
          const k = ev.quality === 'smooth' ? 0.6 : ev.quality === 'firm' ? 1.2 : 2.2;
          audio.trigger('splash', k);
          if (ev.quality !== 'smooth') audio.trigger('slam', k * 0.7);
        } else audio.trigger('impact', clamp(ev.vs / 3, 0.4, 2));
      } else if (ev.type === 'impact') audio.trigger('impact', clamp(ev.speed / 6, 0.3, 2.5));
      else if (ev.type === 'wreck') audio.trigger('crash', 2);
    }
    if (ev.type === 'wreck') {
      engine.health = 0;
      engine.propHealth = physics.detached.prop ? 0 : engine.propHealth;
      if (!engine.fire) { engine.fire = true; engine.events.push('fire'); }
    }
    emit(ev.type, ev);
  }

  // ---------------- animation of parts, doors, wobble, cockpit ----------------
  function animate(dt) {
    const o = physics.out;
    const h = parts.hinges;
    // flutter when parked with nobody at the controls
    const fl = seated ? 0 : Math.min(env.wind.length(), 15) * 0.0035;
    const t = st.clock;
    const n1 = fl * Math.sin(t * 3.1) * Math.sin(t * 0.73), n2 = fl * Math.sin(t * 2.3 + 1) * Math.sin(t * 0.51), n3 = fl * Math.sin(t * 1.9 + 2);
    const pin = physics.input;
    const det = physics.detached;
    const droop = st.flapDeg * 0.5 * DEG;
    if (h.aileronR && !det.wingTipR) h.aileronR.set(-pin.aileron * 0.35 + droop + n1);
    if (h.aileronL && !det.wingTipL) h.aileronL.set(pin.aileron * 0.35 + droop - n1);
    if (h.flapR) h.flapR.set(st.flapDeg * DEG);
    if (h.flapL) h.flapL.set(st.flapDeg * DEG);
    if (h.elevator) h.elevator.set(-pin.elevator * 0.42 + n2);
    if (h.trimTab) h.trimTab.set(pin.trim * 0.3);
    if (h.rudder) h.rudder.set(pin.rudder * 0.45 + n3);
    const steer = pin.rudder * 0.5;
    const retract = (1 - st.wrDown) * -1.45;
    if (h.waterRudderL && !det.floatL) h.waterRudderL.set(steer, retract);
    if (h.waterRudderR && !det.floatR) h.waterRudderR.set(steer, retract);
    // doors (eased swing)
    for (const k in doors) {
      const d = doors[k];
      const tgt = d.open ? 1 : 0;
      if (d.t !== tgt) {
        d.t = clamp(d.t + Math.sign(tgt - d.t) * dt / 0.6, 0, 1);
        const pd = parts.doors[k];
        if (pd) { const e = d.t * d.t * (3 - 2 * d.t); pd.hinge.set(pd.openAngle * e); }
      }
    }
    // propeller: rotates clockwise seen from the cockpit (negative about +Z)
    st.propAngle -= engine.omega * dt;
    if (st.propAngle < -TAU * 1000) st.propAngle += TAU * 1000;
    const propGone = det.prop;
    const bladesVisible = !propGone && engine.rpm < 520;
    for (let i = 0; i < parts.props.length; i++) {
      // a broken-off LOD0 propeller is flying around as debris (blades shown, no disc)
      if (propGone && i === 0) { parts.propMeshes[0].visible = true; continue; }
      parts.props[i].rotation.z = st.propAngle % TAU;
      parts.propMeshes[i].visible = bladesVisible;
    }
    for (let i = 0; i < parts.spinners.length; i++) parts.spinners[i].visible = !propGone || i === 0;
    updateWobble(dt);
    updateCockpit(dt);
    // wetness, burn, cracks
    const rain = env.rain();
    let wet;
    if (st.wetOverride !== null) wet = st.wetOverride;
    else if (env.wetness) wet = env.wetness();
    else {
      const sprayWet = o.onWater ? clamp((o.sprayBow[0] + o.sprayBow[1] + o.sprayStep[0] + o.sprayStep[1]) / 12, 0, 0.3) : 0;
      const dunked = (o.engineWater || 0) > 0.05 || (physics.wreck && o.onWater) ? 1 : 0;
      const target = Math.max(rain, sprayWet, dunked);
      st.wet = target > st.wet ? damp(st.wet, target, 3, dt) : Math.max(target, st.wet - dt * (0.004 + 0.01 * (1 - env.night())));
      wet = st.wet;
    }
    U.uSpWet.value = wet;
    st.wetNow = wet;
    st.burn = damp(st.burn, physics.wreck ? 1 : engine.fire ? 0.45 : 0, 4, dt);
    U.uSpBurn.value = st.burn;
    U.uSpShatter.value = clamp(1 - physics.damage.windscreen, 0, 1);
    // ropes
    let tension = 0;
    for (let i = 0; i < ropeMeshes.length; i++) {
      const r = physics.moor[i];
      const m = ropeMeshes[i];
      if (!r) { m.visible = false; continue; }
      physics.pointWorld(r.local, _v);
      updateRope(m, _v, r.anchor, r.length);
      m.visible = true;
      tension = Math.max(tension, r.tension || 0);
    }
    st.ropeJerk = Math.max(0, Math.abs(tension - st.ropeTension) / 4000);
    st.ropeTension = tension;
    // water chop felt in the cabin
    const dvy = Math.abs(physics.vel.y - st.prevVy) / Math.max(dt, 1e-3);
    st.prevVy = physics.vel.y;
    st.chop = damp(st.chop, o.onWater ? clamp(dvy / 25 + o.slam / 8, 0, 1) : 0, 0.15, dt);
    // stall warning (vane on the wing: airborne only)
    st.stallWarn = !o.onWater && !o.groundContact && o.airspeed > 6 && o.stall > 0.15; // ~3 deg of AoA before the break
  }

  function frameEffects(dt) {
    if (!effects) return;
    fx.night = env.night();
    fx.rain = env.rain();
    fx.wetness = st.wetNow || 0;
    fx.rpm = engine.rpm;
    fx.omega = engine.omega;
    fx.running = engine.state === 'running';
    fx.power = clamp(engine.load, 0, 1);
    fx.misfire = engine.misfire;
    fx.engineDamage = 1 - engine.health;
    fx.fire = engine.fire;
    fx.propAttached = !physics.detached.prop;
    fx.navOk = !physics.detached.wingTipL && !physics.detached.wingTipR; // the nav circuit dies with a wing tip
    fx.propBent = engine.propHealth < 0.8;
    fx.chop = st.chop;
    physics.euler(eul);
    fx.rollSign = eul.roll;
    fx.viewH = opts.renderer ? opts.renderer.domElement.height || 1080 : 1080;
    const fog = opts.scene && opts.scene.fog;
    fx.fogDensity = fog ? (fog.isFogExp2 ? fog.density : 1.5 / Math.max(fog.far || 1000, 1)) : 0;
    effects.update(dt, fx);
  }

  function frameAudio(dt) {
    if (!audio) return;
    const o = physics.out;
    const e = engine;
    af.rpm = e.rpm;
    af.combust = e.state === 'running';
    af.load = clamp(Math.max(e.load, e.throttle * 0.5), 0, 1);
    af.misfire = clamp(e.misfire * 0.7 + (1 - e.health) * 0.25 + (e.starve > 0 ? 0.4 : 0), 0, 0.9);
    af.rough = e.rough;
    af.starter = e.state === 'cranking' && e.starter;
    af.knock = e.health < 0.7 ? (0.7 - e.health) / 0.7 : 0;
    af.bend = 1 - e.propHealth;
    af.airspeed = o.airspeed;
    // afterfire pops when the throttle is chopped at high rpm
    const dThr = st.popPrevThr !== undefined ? st.popPrevThr - e.throttle : 0;
    st.popPrevThr = e.throttle;
    st.pops = Math.max(0, st.pops - dt * 0.8) + (dThr > 0 && e.rpm > 1400 ? dThr * 6 : 0);
    af.pops = clamp(st.pops, 0, 0.35);
    af.grind = clamp(o.grind / 3, 0, 1.5);
    af.scrape = clamp((o.scrape - 0.3) / 5, 0, 1.5);
    af.rattle = clamp((af.combust ? 0.15 + e.rough * 0.5 : 0) + st.chop * 0.8 + Math.min(physics.gust.length() / 4, 0.6) + Math.abs(o.gLoad - 1) * 0.3, 0, 1.5);
    af.fire = e.fire ? 1 : 0;
    af.flap = st.flapMoving ? 1 : 0;
    af.onWater = o.onWater;
    af.waterSpeed = o.waterSpeed;
    af.spray = Math.max(o.sprayBow[0], o.sprayBow[1], o.sprayStep[0] * 0.5, o.sprayStep[1] * 0.5);
    af.inside = (seated && st.cameraMode === 'cockpit') || !!st.camInside;
    af.doorOpen = Math.max(doors.doorL.t, doors.doorR.t, doors.cargo.t * 0.6);
    _src.set(0, 0, DIM.noseZ - CG_MODEL.z + 0.6).applyMatrix4(root.matrixWorld);
    af.turbulence = Math.min(1, physics.gust.length() / 3);
    af.stallWarn = st.stallWarn && e.master;
    af.chop = st.chop;
    af.ropeJerk = st.ropeJerk;
    af.gLoad = o.gLoad;
    audio.update(dt, af);
    if (o.slam > 3.2 && st.slamCool <= 0) { audio.trigger('slam', clamp(o.slam / 5, 0.4, 2)); st.slamCool = 0.4; }
    st.slamCool -= dt;
  }

  // ---------------- state & HUD data ----------------
  const state = {
    ready: false, airspeed: 0, groundSpeed: 0, altitude: 0, agl: 0, vs: 0, heading: 0, pitch: 0, roll: 0,
    rpm: 0, throttle: 0, flaps: 0, flapIndex: 0, trim: 0, engine: 'off', fuel: [0, 0], onWater: false, planing: false,
    beached: false, moored: false, seated: false, seatId: null, stall: 0, stallWarning: false, gLoad: 1,
    damage: physics.damage, detached: physics.detached, wreck: false, lod: 0, interiorVisible: false, cameraMode: 'external', waterRudderDown: true,
    lights, doors: { doorL: false, doorR: false, cargo: true }, assist, quality, physicsMs: 0, buildMs: 0, exitProgress: 0,
    hint: null,
  };
  const hudData = { throttlePct: 0, airspeedKt: 0, altitudeFt: 0, vsFpm: 0, flapsDeg: 0, engine: 'off', stallWarning: false, hint: null, rpm: 0, trim: 0, fuelL: 0, fuelR: 0, waterRudders: 'down' };
  function updateState(dt) {
    const o = physics.out;
    physics.euler(eul);
    state.ready = st.ready;
    state.airspeed = o.airspeed; state.groundSpeed = o.groundSpeed; state.altitude = physics.cg.y; state.agl = o.agl; state.vs = physics.vel.y;
    state.heading = eul.heading; state.pitch = eul.pitch; state.roll = eul.roll;
    state.rpm = engine.rpm; state.throttle = engine.throttle; state.flaps = st.flapDeg; state.flapIndex = controls.flapIndex; state.trim = physics.input.trim;
    state.engine = engine.state; state.fuel[0] = engine.fuel[0]; state.fuel[1] = engine.fuel[1];
    state.onWater = o.onWater; state.planing = o.planing; state.beached = o.beached; state.moored = physics.moor.length > 0;
    state.seated = seated; state.seatId = interaction ? interaction.seatId : null; state.stall = o.stall; state.stallWarning = !!st.stallWarn; state.gLoad = o.gLoad;
    state.wreck = physics.wreck; state.lod = st.lod; state.interiorVisible = st.interiorVisible;
    state.cameraMode = seated ? st.cameraMode : 'external';
    state.waterRudderDown = st.wrTarget > 0.5;
    state.doors.doorL = doors.doorL.open; state.doors.doorR = doors.doorR.open; state.doors.cargo = doors.cargo.open;
    state.assist = assist; state.quality = quality; state.physicsMs = st.physicsMs; state.buildMs = st.buildMs;
    state.exitProgress = clamp(st.exitHold / 0.6, 0, 1);
    // context hint
    let hint = HINTS.none;
    if (seated) {
      if (physics.wreck) hint = HINTS.wreck;
      else if (engine.state === 'cranking') hint = engine.flood > 0.6 ? HINTS.flooded : HINTS.cranking;
      else if (engine.state !== 'running') hint = !engine.fuelAvailable() ? HINTS.noFuel : HINTS.start;
      else if (st.stallWarn) hint = HINTS.stall;
      else if (o.beached) hint = HINTS.beached;
      else if (physics.moor.length) hint = HINTS.moored;
      else if (o.onWater && st.wrTarget > 0.5 && o.waterSpeed > 6) hint = HINTS.waterRudders;
    }
    if (st.hintTimer > 0) { st.hintTimer -= dt; hint = st.hintOverride; }
    state.hint = hint;
    hudData.throttlePct = Math.round(engine.throttle * 100);
    hudData.airspeedKt = Math.round(o.airspeed * 1.944);
    hudData.altitudeFt = Math.round(Math.max(0, physics.cg.y) * 3.281);
    hudData.vsFpm = Math.round(physics.vel.y * 196.85 / 10) * 10;
    hudData.flapsDeg = Math.round(st.flapDeg);
    hudData.engine = engine.state;
    hudData.stallWarning = !!st.stallWarn;
    hudData.hint = hint;
    hudData.rpm = Math.round(engine.rpm / 10) * 10;
    hudData.trim = physics.input.trim;
    hudData.fuelL = engine.fuel[0]; hudData.fuelR = engine.fuel[1];
    hudData.waterRudders = st.wrTarget > 0.5 ? 'down' : 'up';
  }

  // ---------------- public API ----------------
  const _gs = new THREE.Vector3();
  const api = {
    root, worldRoot, ready: null, state, hudData, handTargets, handPose, materials: mats, uniforms: U,
    interactables: [], walkShapes: [], blockShapes: [],
    onEvent: null,
    get KEYMAP() { return controls.keymap; },
    get fovDelta() { return seated && st.cameraMode === 'cockpit' ? seatCam.fovDelta : 0; },
    get cameraMode() { return seated ? st.cameraMode : 'external'; },
    set cameraMode(m) { st.cameraMode = m === 'chase' ? 'chase' : 'cockpit'; chase.reset(); },
    get physics() { return physics; },
    get engine() { return engine; },
    get controls() { return controls; },
    get lods() { return lods; },
    // world-space Object3Ds of the pieces that broke off (reused array)
    get debris() { return debris ? debris.list(debrisList) : debrisList; },
    get interior() { return interior; },
    get effects() { return effects; },
    get audio() { return audio; },
    DIM,

    update,
    pointVelocity(p, out) { return physics.pointVelocityWorld(p, out); },
    // seats
    // seat(id, fromPos?, fromQuat?, instant?): animated boarding from the given eye pose,
    // or instant (spawning in the air, cut-scenes)
    seat(id = 'pilot', fromPos, fromQuat, instant = false) {
      if (!interaction || seated) return false;
      let ok = true;
      if (instant) interaction.seatInstant(id);
      else {
        if (id === 'pilot' && !doors.doorL.open) toggleDoor('doorL', true);
        if (id === 'copilot' && !doors.doorR.open && !doors.cargo.open) toggleDoor('doorR', true);
        ok = interaction.seat(id, fromPos, fromQuat);
      }
      if (ok) { seated = true; st.cameraMode = 'cockpit'; physics.setLoading({ pilot: id === 'pilot' ? 85 : 0, copilot: id === 'copilot' ? 85 : 0 }); controls.keys.clear(); }
      return ok;
    },
    unseat(force = false) {
      if (!interaction || !seated) return null;
      if (force) {
        interaction.transition = null; interaction.seated = false; interaction.seatId = null;
        seated = false; physics.setLoading({ pilot: 0, copilot: 0 });
        emit('unseated', { pose: interaction.exitPose, forced: true });
        return interaction.exitPose;
      }
      const chk = interaction.canExit();
      if (!chk.ok) { st.hintOverride = chk.reason === 'flying' ? HINTS.flying : HINTS.moving; st.hintTimer = 2; emit('hint', chk); return null; }
      const dn = interaction.seatId === 'copilot' ? 'doorR' : 'doorL';
      const pose = interaction.unseat();
      if (pose) { physics.setLoading({ pilot: 0, copilot: 0 }); if (!doors[dn].open && !(dn === 'doorR' && doors.cargo.open)) toggleDoor(dn, true); }
      return pose;
    },
    canExit() { return interaction ? interaction.canExit() : { ok: false, reason: 'notReady' }; },
    get seated() { return seated; },
    get exitPose() { return interaction ? interaction.exitPose : null; },
    // returns false when the plane does not own the camera (not seated / not cockpit)
    getSeatCamera(lookYaw, lookPitch, outPos, outQuat) {
      if (!interaction) return false;
      return interaction.cameraPose(seatCam, lookYaw, lookPitch, root.position, root.quaternion, outPos, outQuat);
    },
    getChaseCamera(outPos, outQuat) {
      if (!chase.initialised) chase.update(1 / 60, root.position, root.quaternion, physics.vel, 0, env);
      outPos.copy(chase.pos); outQuat.copy(chase.quat);
      return true;
    },
    setChaseOrbit(yaw, pitch) { chase.orbitYaw = yaw; chase.orbitPitch = pitch; },
    // input
    attachInput(dom) { controls.attach(dom); },
    // audio can be attached later (after a user gesture created the AudioContext)
    setAudio(ctx, out, audioOptions = {}) {
      if (!audio && ctx) audio = createSeaplaneAudio(ctx, out || ctx.destination, Object.assign({ seed: opts.seed }, audioOptions));
      return audio;
    },
    detachInput() { controls.detach(); },
    setControls(obj) {
      controls.set(obj);
      if (obj.waterRudder !== undefined) st.wrTarget = obj.waterRudder ? 1 : 0;
      if (obj.lights !== undefined) { lights.nav = !!(obj.lights.nav ?? lights.nav); lights.landing = !!(obj.lights.landing ?? lights.landing); }
      if (obj.mixture !== undefined) engine.mixture = clamp(obj.mixture, 0, 1);
      if (obj.propLever !== undefined) engine.propLever = clamp(obj.propLever, 0, 1);
      if (obj.fuelSelector !== undefined) engine.fuelSelector = obj.fuelSelector;
    },
    command,
    // doors / lights
    toggleDoor, setDoor(name, open) { toggleDoor(name, open); }, doorOpen,
    lights,
    // placement & mooring
    placeOnWater, placeOnBeach,
    placeInAir(x, y, z, yaw = 0, speed = 38) {
      clearWorldProps();
      _pq.setFromAxisAngle(_yAxis, yaw);
      _pp.set(x, y, z);
      physics.place(_pp, _pq);
      physics.vel.set(-Math.sin(yaw) * speed, 0, -Math.cos(yaw) * speed);
      engine.state = 'running'; engine.omega = 2050 / 9.549; engine.master = true; engine.magnetos = 3; engine.rough = 0;
      controls.throttle = 0.68; cmd.throttle = 0.68; engine.throttle = engine.throttleCmd = 0.68;
      controls.trim = 0.35; controls.flapIndex = 0; st.flapDeg = 0;
      st.wrTarget = 0; st.wrDown = 0;
      chase.reset();
      syncPose(0);
    },
    setMooringPoints(points) { if (interaction) interaction.mooringPoints = points; else planeCtx.pendingMooring = points; },
    moorTo(points) {
      api.castOff(true);
      const a = planeCtx.anchors;
      if (!a) return 0;
      const cleats = ['cleatBowL', 'cleatBowR', 'cleatMidL', 'cleatMidR', 'cleatSternL', 'cleatSternR'].filter((k) => a[k]);
      let n = 0;
      for (const pt of points) {
        if (n >= ROPE_MAX) break;
        const p = pt.isVector3 ? pt : pt.position;
        let best = null, bd = 1e9;
        for (const k of cleats) {
          physics.pointWorld(a[k], _v);
          const d = _v.distanceTo(p);
          if (d < bd) { bd = d; best = k; }
        }
        if (!best || bd > 14) continue;
        physics.moor.push({ anchor: p.clone(), local: a[best].clone(), length: Math.max(bd * 1.02 + 0.4, 1.2), k: 9000, tension: 0 });
        n++;
      }
      if (n && audio) audio.trigger('rope', 0.8);
      if (n) emit('moored', { ropes: n });
      return n;
    },
    castOff(silent) {
      if (!physics.moor.length) return;
      physics.moor.length = 0;
      for (const m of ropeMeshes) m.visible = false;
      if (!silent) emit('castOff', {});
    },
    pushOff(strength = 1) { st.pushOff = clamp(strength, 0, 1); },
    // misc
    setWetness(v) { st.wetOverride = v === null || v === undefined ? null : clamp(v, 0, 1); },
    setAssist(a) { assist = a === 'arcade' || a === 'realistic' ? a : 'normal'; st.autoTrim = 0; },
    setQuality(q) {
      quality = q === 'low' ? 'low' : 'high';
      if (effects) effects.setQuality(quality);
      rebake();
    },
    setLoading(p) { physics.setLoading(p); },
    damage(part, amount = 0.5) {
      if (part === 'engine') engine.health = Math.max(0, engine.health - amount);
      else if (part === 'prop') engine.propHealth = Math.max(0, engine.propHealth - amount);
      if (part in physics.damage) physics._damagePart(part, amount);
      if (part === 'wreck' || part === 'wreckL' || part === 'wreckR') physics._crash(20, part.length > 5 ? part[5] : null);
    },
    repair() {
      for (const k in physics.damage) physics.damage[k] = 1;
      physics.flood.L = 0; physics.flood.R = 0;
      physics.wreck = false;
      for (const k in physics.detached) physics.detached[k] = false;
      engine.repair();
      st.burn = 0;
      U.uSpBurn.value = 0;
      if (effects) effects.clear();
      const hadPieces = debris && debris.mask !== 0;
      syncDetached();
      if (hadPieces) { physics.depenetrate(); syncPose(0); }
      emit('repaired', {});
    },
    reset(pose = {}) {
      api.repair();
      engine.state = 'off'; engine.omega = 0; engine.setStarter(false);
      controls.throttle = 0; cmd.throttle = 0; engine.throttle = engine.throttleCmd = 0;
      controls.flapIndex = 0; st.flapDeg = 0; controls.trim = 0;
      if (pose.position) {
        clearWorldProps();
        _pp.copy(pose.position);
        if (pose.quaternion) _pq.copy(pose.quaternion); else _pq.setFromAxisAngle(_yAxis, pose.yaw || 0);
        physics.place(_pp, _pq);
        if (pose.velocity) physics.vel.copy(pose.velocity);
        syncPose(0);
      }
      chase.reset();
    },
    prewarm(renderer, camera) {
      renderer = renderer || opts.renderer;
      camera = camera || opts.camera;
      if (!renderer || !camera) return;
      const vis = [], cull = [];
      const showAll = (o) => {
        vis.push(o, o.visible); o.visible = true;
        if (o.isMesh || o.isLine || o.isPoints) { cull.push(o, o.frustumCulled); o.frustumCulled = false; }
      };
      root.traverse(showAll);
      worldRoot.traverse(showAll);
      const scene = opts.scene || null;
      renderer.compile(root, camera, scene);
      renderer.compile(worldRoot, camera, scene);
      // one real render into a tiny target also builds the shadow-depth programs
      // (culling is off so every caster reaches the shadow pass)
      if (scene) {
        const prev = renderer.getRenderTarget();
        const rt = new THREE.WebGLRenderTarget(16, 16);
        renderer.setRenderTarget(rt);
        renderer.render(scene, camera);
        renderer.setRenderTarget(prev);
        rt.dispose();
      }
      for (let i = 0; i < vis.length; i += 2) vis[i].visible = vis[i + 1];
      for (let i = 0; i < cull.length; i += 2) cull[i].frustumCulled = cull[i + 1];
    },
    dispose() {
      controls.detach();
      if (debris) debris.dispose();
      if (audio) audio.dispose();
      if (effects) effects.dispose();
      if (baked) baked.dispose();
      for (const k in mats) {
        const m = mats[k];
        if (m.map && m.map !== ph.map && k.startsWith('gauge')) m.map.dispose();
        m.dispose();
      }
      if (mats.horizon.map) mats.horizon.map.dispose();
      if (U.uSpRig.value) U.uSpRig.value.dispose();
      ph.map.dispose(); ph.data.dispose();
      root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      worldRoot.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      root.removeFromParent();
      worldRoot.removeFromParent();
    },
    // debugging helpers (sandbox)
    toModel(v) { return _gs.copy(v).add(CG_MODEL); },
  };

  // default placement: on the water at the origin until the host places it; nobody aboard
  physics.setLoading({ pilot: 0, copilot: 0 });
  physics.place(new THREE.Vector3(0, CG_MODEL.y - 0.33, 0), new THREE.Quaternion());
  api.ready = build().then(() => {
    if (planeCtx.pendingMooring) interaction.mooringPoints = planeCtx.pendingMooring;
    return api;
  });
  return api;
}
