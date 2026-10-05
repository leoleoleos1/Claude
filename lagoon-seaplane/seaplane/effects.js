// Built-in effects: fallback particle system (spray, mist, wake foam, splashes,
// exhaust smoke, fire, sparks, drips), the motion-blurred propeller disc, light
// glows (nav / strobe / landing / exhaust), the landing-light cone and its pool
// on the surface, the windscreen-rain drive and the env.emit hooks.
// Every material exists from construction; at runtime only uniforms, instance
// attributes and visibility change. Per-frame code is allocation free.
import * as THREE from 'three';
import { DIM, CG_MODEL } from './model/dims.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TWO_PI = Math.PI * 2;

// particle kinds (shader switch)
export const PK = { SMOKE: 0, SPRAY: 1, STREAK: 2, FIRE: 3, FOAM: 4, GLOW: 5 };

const NOISE = /* glsl */ `
float fx_h(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float fx_n(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fx_h(i), fx_h(i + vec2(1.0, 0.0)), f.x), mix(fx_h(i + vec2(0.0, 1.0)), fx_h(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

// ---------------------------------------------------------------------------
// Particle material: camera-facing (optionally velocity-stretched) quads, or
// flat quads on the water (foam). Alpha pool is lit by a tint uniform and fogged;
// the additive pool (fire, sparks, flashes) is emissive and fades with distance
// on the CPU instead of using fog (fogging additive quads would brighten them).
function particleMaterial(FU, additive) {
  const m = new THREE.MeshBasicMaterial({
    name: additive ? 'seaplane.fx.add' : 'seaplane.fx.alpha',
    transparent: true, depthWrite: false, fog: !additive, side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  m.forceSinglePass = true;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFxLight = FU.uFxLight;
    shader.uniforms.uFxSun = FU.uFxSun;
    shader.uniforms.uFxNear = FU.uFxNear;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aPos;
attribute vec4 aVel;
attribute vec4 aCol;
attribute vec4 aMisc;
uniform vec3 uFxSun;
uniform float uFxNear;
varying vec4 vFxCol;
varying vec4 vFxMisc;
varying vec2 vFxUv;
varying float vFxScatter;`)
      .replace('#include <project_vertex>', /* glsl */ `
  vFxCol = aCol;
  vFxMisc = aMisc;
  vFxUv = position.xy + 0.5;
  vec4 mvPosition;
  if (abs(aMisc.y - 4.0) < 0.5) {
    float fc = cos(aMisc.x), fs = sin(aMisc.x);
    vec2 fq = vec2(fc * position.x - fs * position.y, fs * position.x + fc * position.y) * aPos.w;
    mvPosition = modelViewMatrix * vec4(aPos.x + fq.x, aPos.y, aPos.z + fq.y, 1.0);
  } else {
    mvPosition = modelViewMatrix * vec4(aPos.xyz, 1.0);
    vec2 fq;
    if (aVel.w > 0.0) {
      vec3 fvv = (modelViewMatrix * vec4(aVel.xyz, 0.0)).xyz;
      float fl = length(fvv.xy);
      vec2 fd = fl > 1e-4 ? fvv.xy / fl : vec2(0.0, 1.0);
      float flen = max(aPos.w, fl * aVel.w);
      fq = fd * position.y * flen + vec2(-fd.y, fd.x) * position.x * aPos.w;
    } else {
      float fc = cos(aMisc.x), fs = sin(aMisc.x);
      fq = vec2(fc * position.x - fs * position.y, fs * position.x + fc * position.y) * aPos.w;
    }
    mvPosition.xy += fq;
  }
  // forward scattering when looking toward the sun through spray / smoke
  vec3 fxView = normalize(aPos.xyz - cameraPosition);
  vFxScatter = pow(max(dot(fxView, uFxSun), 0.0), 6.0);
  // fade particles right in front of the lens
  vFxCol.a *= smoothstep(uFxNear, uFxNear * 3.0 + 0.4, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uFxLight;
varying vec4 vFxCol;
varying vec4 vFxMisc;
varying vec2 vFxUv;
varying float vFxScatter;
${NOISE}`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', /* glsl */ `vec4 diffuseColor = vec4( diffuse, opacity );
  {
    vec2 c = vFxUv - 0.5;
    float r = length(c) * 2.0;
    float kind = vFxMisc.y, age = vFxMisc.z, seed = vFxMisc.w * 97.0;
    float a;
    vec3 col = vFxCol.rgb;
    if (kind < 0.5) { // smoke / mist puff
      float n = fx_n(vFxUv * 3.0 + seed + age * 0.7) * 0.62 + fx_n(vFxUv * 7.0 - seed * 1.3) * 0.38;
      a = 1.0 - smoothstep(0.15, 1.0, r + (n - 0.5) * 0.75);
    } else if (kind < 1.5) { // spray: clumps of droplets
      float n = fx_n(vFxUv * 8.0 + seed) * 0.6 + fx_n(vFxUv * 21.0 - seed) * 0.4;
      float core = 1.0 - smoothstep(0.0, 1.0, r);
      a = core * smoothstep(0.38 + age * 0.25, 0.72, n * 0.7 + core * 0.4);
      a = max(a, core * core * 0.3 * (1.0 - age));
    } else if (kind < 2.5) { // streak: spark / drip / droplet
      a = 1.0 - smoothstep(0.0, 1.0, length(c * vec2(2.0, 2.0)));
    } else if (kind < 3.5) { // fire
      float n = fx_n(vFxUv * 4.0 + vec2(0.0, -age * 4.0) + seed);
      a = 1.0 - smoothstep(0.1, 1.0, r + (n - 0.5) * 0.9);
      col *= mix(vec3(1.0, 0.78, 0.36), vec3(0.85, 0.22, 0.05), smoothstep(0.1, 0.8, age));
    } else if (kind < 4.5) { // foam on the water
      float n = fx_n(vFxUv * 6.0 + seed) * 0.6 + fx_n(vFxUv * 17.0 + seed * 0.7) * 0.4;
      float ring = 1.0 - smoothstep(0.55, 1.0, r);
      ring *= mix(1.0, smoothstep(0.2, 0.7, r), 0.5 + 0.5 * age);
      a = ring * smoothstep(0.42 + age * 0.3, 0.75, n);
    } else { // glow / flash
      a = exp(-r * r * 5.0) + exp(-r * 2.2) * 0.2;
    }
    ${additive ? '' : 'col *= uFxLight * (1.0 + vFxScatter * 2.5 * step(kind, 1.5));'}
    diffuseColor = vec4(col, clamp(a, 0.0, 1.0) * vFxCol.a);
    if (diffuseColor.a < 0.003) discard;
  }`);
  };
  m.customProgramCacheKey = () => (additive ? 'seaplane-fx-add-v1' : 'seaplane-fx-alpha-v1');
  return m;
}

// Structure-of-arrays particle pool rendered as one instanced draw.
class ParticlePool {
  constructor(capacity, material, rand) {
    this.cap = capacity;
    this.limit = capacity;
    this.n = 0;
    this._rr = 0;
    this.rand = rand;
    const f = () => new Float32Array(capacity);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.size = f(); this.grow = f(); this.age = f(); this.life = f();
    this.r = f(); this.g = f(); this.b = f(); this.a = f();
    this.kind = f(); this.rot = f(); this.spin = f(); this.drag = f(); this.grav = f();
    this.stretch = f(); this.seed = f(); this.floor = f(); this.fade = f();
    this._fields = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'size', 'grow', 'age', 'life', 'r', 'g', 'b', 'a', 'kind', 'rot', 'spin', 'drag', 'grav', 'stretch', 'seed', 'floor', 'fade'].map((k) => this[k]);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const inst = () => new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aPos = inst(); this.aVel = inst(); this.aCol = inst(); this.aMisc = inst();
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aVel', this.aVel);
    geo.setAttribute('aCol', this.aCol);
    geo.setAttribute('aMisc', this.aMisc);
    geo.instanceCount = 0;
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 3;
  }

  // returns the slot or -1 when full; size grows by `grow` m/s
  spawn(kind, x, y, z, vx, vy, vz, size, grow, life, r, g, b, a, drag, grav, floor) {
    if (this.n >= this.limit) return -1;
    const i = this.n++;
    const R = this.rand;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.size[i] = size; this.grow[i] = grow; this.age[i] = 0; this.life[i] = life;
    this.r[i] = r; this.g[i] = g; this.b[i] = b; this.a[i] = a;
    this.kind[i] = kind; this.rot[i] = R() * TWO_PI; this.spin[i] = (R() - 0.5) * 1.2;
    this.drag[i] = drag; this.grav[i] = grav; this.stretch[i] = 0; this.seed[i] = R();
    this.floor[i] = floor; this.fade[i] = 0.08;
    return i;
  }

  _move(dst, src) { for (const f of this._fields) f[dst] = f[src]; }

  update(dt, wind, env, camPos, fogK) {
    let n = this.n;
    const wx = wind.x, wz = wind.z;
    for (let i = 0; i < n;) {
      const age = this.age[i] + dt;
      if (age >= this.life[i] || this.py[i] < this.floor[i]) { n--; if (i !== n) this._move(i, n); continue; }
      this.age[i] = age;
      const k = Math.min(1, this.drag[i] * dt);
      this.vx[i] += (wx - this.vx[i]) * k;
      this.vy[i] += -this.vy[i] * k - this.grav[i] * dt;
      this.vz[i] += (wz - this.vz[i]) * k;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.spin[i] * dt;
      i++;
    }
    this.n = n;
    // foam rides the waves: refresh a few heights per frame (round robin)
    if (env && env.waterHeight && n > 0) {
      const m = Math.min(n, 40);
      for (let j = 0; j < m; j++) {
        this._rr = (this._rr + 1) % n;
        const i = this._rr;
        if (this.kind[i] === PK.FOAM) this.py[i] = env.waterHeight(this.px[i], this.pz[i]) + 0.04;
      }
    }
    const P = this.aPos.array, V = this.aVel.array, C = this.aCol.array, M = this.aMisc.array;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const t = this.age[i] / this.life[i];
      const kind = this.kind[i];
      let al = this.a[i] * Math.min(1, t / this.fade[i]) * (1 - t);
      if (kind === PK.SMOKE) al *= 1 - t * 0.5;
      if (fogK > 0) {
        const dx = this.px[i] - camPos.x, dy = this.py[i] - camPos.y, dz = this.pz[i] - camPos.z;
        al *= Math.exp(-fogK * Math.sqrt(dx * dx + dy * dy + dz * dz));
      }
      P[o] = this.px[i]; P[o + 1] = this.py[i]; P[o + 2] = this.pz[i]; P[o + 3] = this.size[i] + this.grow[i] * this.age[i];
      V[o] = this.vx[i]; V[o + 1] = this.vy[i]; V[o + 2] = this.vz[i]; V[o + 3] = this.stretch[i];
      C[o] = this.r[i]; C[o + 1] = this.g[i]; C[o + 2] = this.b[i]; C[o + 3] = al;
      M[o] = this.rot[i]; M[o + 1] = kind; M[o + 2] = t; M[o + 3] = this.seed[i];
    }
    for (const at of [this.aPos, this.aVel, this.aCol, this.aMisc]) {
      at.clearUpdateRanges();
      if (n > 0) { at.addUpdateRange(0, n * 4); at.needsUpdate = true; }
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
  }

  clear() { this.n = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }
}

// ---------------------------------------------------------------------------
// Motion-blurred propeller disc (exists from the start; opacity by uniform).
function propDiscMaterial(FU) {
  const m = new THREE.MeshBasicMaterial({ name: 'seaplane.propDisc', transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
  m.forceSinglePass = true;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uPropAng: FU.uPropAng, uPropBlur: FU.uPropBlur, uPropAlpha: FU.uPropAlpha, uPropFlick: FU.uPropFlick, uFxLight: FU.uFxLight });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPropP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPropP = position.xy;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vPropP;
uniform float uPropAng;
uniform float uPropBlur;
uniform float uPropAlpha;
uniform float uPropFlick;
uniform vec3 uFxLight;`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', /* glsl */ `vec4 diffuseColor = vec4( diffuse, opacity );
  {
    float r = length(vPropP);
    float th = atan(vPropP.y, vPropP.x);
    float chord = mix(0.24, 0.16, r);
    float wb = chord * 0.5 / max(r * ${DIM.propRadius.toFixed(3)}, 0.06);
    float wm = max(wb, uPropBlur);
    float d = mod(th - uPropAng + 1.0471976, 2.0943951) - 1.0471976;
    float cov = min(1.0, (wb / wm) * 1.9) * (1.0 - smoothstep(wm * 0.55, wm, abs(d)));
    cov *= 0.8 + 0.2 * sin(r * 57.0 + sin(r * 13.0) * 2.0);
    float tip = smoothstep(0.85, 0.89, r);
    cov += tip * 0.16 * smoothstep(0.3, 1.0, uPropBlur);
    cov *= smoothstep(0.14, 0.22, r) * (1.0 - smoothstep(0.975, 1.0, r));
    vec3 col = mix(vec3(0.03), vec3(0.85, 0.63, 0.07), tip) * uFxLight;
    col += uPropFlick * vec3(1.0, 0.95, 0.85) * (0.6 + 0.4 * sin(th * 3.0 + uPropAng * 7.0));
    diffuseColor = vec4(col, clamp(cov, 0.0, 1.0) * uPropAlpha);
    if (diffuseColor.a < 0.004) discard;
  }`);
  };
  m.customProgramCacheKey = () => 'seaplane-propdisc-v1';
  return m;
}

// ---------------------------------------------------------------------------
// Light glows: additive camera-facing sprites in plane-local space with a
// minimum on-screen size so lights stay visible far away at night.
function glowMaterial(FU) {
  const m = new THREE.MeshBasicMaterial({ name: 'seaplane.glow', transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGlowPix = FU.uGlowPix;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aPos;
attribute vec4 aCol;
uniform float uGlowPix;
varying vec4 vGlowCol;
varying vec2 vGlowUv;`)
      .replace('#include <project_vertex>', /* glsl */ `
  vec4 mvPosition = modelViewMatrix * vec4(aPos.xyz, 1.0);
  float gd = max(-mvPosition.z, 0.01);
  float gs = max(aPos.w, uGlowPix * 5.0 * gd);
  vGlowCol = aCol;
  vGlowCol.a *= aPos.w / gs * 0.6 + 0.4;
  vGlowUv = position.xy + 0.5;
  mvPosition.xy += position.xy * gs;
  mvPosition.z += min(0.25, gd * 0.5);
  gl_Position = projectionMatrix * mvPosition;
`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vGlowCol;\nvarying vec2 vGlowUv;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', /* glsl */ `vec4 diffuseColor = vec4( diffuse, opacity );
  {
    vec2 c = vGlowUv - 0.5;
    float r = length(c) * 2.0;
    float a = exp(-r * r * 9.0) * 0.85 + exp(-r * 3.0) * 0.2;
    a += exp(-abs(c.y) * 90.0) * (1.0 - smoothstep(0.0, 1.0, abs(c.x) * 2.0)) * 0.12;
    a *= 1.0 - smoothstep(0.85, 1.0, r);
    diffuseColor = vec4(vGlowCol.rgb, a * vGlowCol.a);
    if (diffuseColor.a < 0.002) discard;
  }`);
  };
  m.customProgramCacheKey = () => 'seaplane-glow-v1';
  return m;
}

// Landing-light beam (open cone, additive, brightest where the view crosses the axis).
function coneMaterial(FU) {
  const m = new THREE.MeshBasicMaterial({ name: 'seaplane.beam', transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  m.forceSinglePass = true;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBeam = FU.uBeam;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vBeamT;\nvarying float vBeamF;')
      .replace('#include <project_vertex>', /* glsl */ `#include <project_vertex>
  vBeamT = clamp(-position.y, 0.0, 1.0);
  vec3 bn = normalize(normalMatrix * normal);
  vBeamF = abs(dot(bn, normalize(-mvPosition.xyz)));`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBeamT;\nvarying float vBeamF;\nuniform float uBeam;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', /* glsl */ `vec4 diffuseColor = vec4( diffuse, opacity );
  float ba = pow(1.0 - vBeamT, 2.2) * pow(vBeamF, 2.0) * uBeam * smoothstep(0.0, 0.04, vBeamT);
  diffuseColor = vec4(vec3(1.0, 0.93, 0.8), ba);`);
  };
  m.customProgramCacheKey = () => 'seaplane-beam-v1';
  return m;
}

// Light pool where the beam meets the water / ground.
function poolMaterial(FU) {
  const m = new THREE.MeshBasicMaterial({ name: 'seaplane.pool', transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPool = FU.uPool;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPoolUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPoolUv = position.xy * 2.0;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vPoolUv;\nuniform float uPool;\n${NOISE}`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', /* glsl */ `vec4 diffuseColor = vec4( diffuse, opacity );
  float pr = length(vPoolUv);
  float pa = pow(1.0 - smoothstep(0.0, 1.0, pr), 1.6) * (0.85 + 0.15 * fx_n(vPoolUv * 5.0));
  diffuseColor = vec4(vec3(1.0, 0.92, 0.78), pa * uPool);`);
  };
  m.customProgramCacheKey = () => 'seaplane-pool-v1';
  return m;
}

// ---------------------------------------------------------------------------
// Glow slots
export const GLOW = { NAV_L: 0, NAV_R: 1, TAIL: 2, STROBE: 3, LANDING: 4, EXH_R: 5, EXH_L: 6 };

export class Effects {
  // opts: { U, quality, useOwnEffects, realLandingLight, model (LOD0, plane-local), root, worldRoot, env, rand }
  constructor(opts) {
    const { model, root, worldRoot } = opts;
    this.env = opts.env || {};
    this.root = root;
    this.worldRoot = worldRoot;
    this.useOwn = opts.useOwnEffects !== false;
    this.rand = opts.rand || Math.random;
    this.quality = opts.quality || 'high';
    const FU = this.uniforms = {
      uFxLight: { value: new THREE.Vector3(1, 1, 1) },
      uFxSun: { value: new THREE.Vector3(0, 1, 0) },
      uFxNear: { value: 0.5 },
      uPropAng: { value: 0 }, uPropBlur: { value: 0 }, uPropAlpha: { value: 0 }, uPropFlick: { value: 0 },
      uGlowPix: { value: 0.001 },
      uBeam: { value: 0 }, uPool: { value: 0 },
    };
    this.U = opts.U; // shared plane uniforms (windscreen rain)
    this.materials = {
      alpha: particleMaterial(FU, false),
      add: particleMaterial(FU, true),
      disc: propDiscMaterial(FU),
      glow: glowMaterial(FU),
      beam: coneMaterial(FU),
      pool: poolMaterial(FU),
    };
    // particles (allocated once at full size; Low quality lowers the live limit)
    this.alpha = new ParticlePool(1400, this.materials.alpha, this.rand);
    this.add = new ParticlePool(320, this.materials.add, this.rand);
    this.alpha.mesh.name = 'seaplane.fx.alpha';
    this.add.mesh.name = 'seaplane.fx.add';
    worldRoot.add(this.alpha.mesh, this.add.mesh);
    this.setQuality(this.quality);

    // anchors (plane-local)
    const a = model.anchors, L = model.lights;
    const v = (x, y, z) => new THREE.Vector3(x - CG_MODEL.x, y - CG_MODEL.y, z - CG_MODEL.z);
    const F = DIM.float;
    this.pts = {
      bow: [v(-F.x, 0.32, F.bowZ + 1.1), v(F.x, 0.32, F.bowZ + 1.1)],
      step: [v(-F.x, 0.05, F.stepZ + 0.35), v(F.x, 0.05, F.stepZ + 0.35)],
      stern: [v(-F.x, 0.2, F.sternZ - 0.2), v(F.x, 0.2, F.sternZ - 0.2)],
      stacks: (a.exhaustAll || [a.exhaustR, a.exhaustL]).filter(Boolean).map((p) => p.clone()),
      engine: a.engine ? a.engine.clone() : v(0, 2.25, -1),
      cowl: a.cowlFront ? a.cowlFront.clone() : v(0, 2.25, -1.6),
      hub: model.prop.hub.clone(),
      wingTE: v(0, DIM.wing.chordY - 0.02, DIM.wing.leZ + DIM.wing.chord),
      flood: L.flood ? L.flood.clone() : v(2.18, 3.2, 0.8),
      floodDir: L.floodDir ? L.floodDir.clone() : new THREE.Vector3(0, -0.2, -1).normalize(),
    };
    // exhaust direction per stack: outward and slightly down
    this.stackDir = this.pts.stacks.map((p) => new THREE.Vector3(Math.sign(p.x) || 1, -0.35, 0.25).normalize());

    // prop disc (one draw, all LODs)
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 64), this.materials.disc);
    disc.name = 'seaplane.propDisc';
    disc.scale.setScalar(DIM.propRadius * 1.01);
    disc.position.copy(this.pts.hub);
    disc.renderOrder = 1;
    disc.castShadow = false;
    disc.visible = false;
    root.add(disc);
    this.disc = disc;
    this._discAng = 0;

    // glows
    const defs = [];
    defs[GLOW.NAV_L] = [L.navL, 1.0, 0.1, 0.06, 0.32];
    defs[GLOW.NAV_R] = [L.navR, 0.12, 1.0, 0.25, 0.32];
    defs[GLOW.TAIL] = [L.tail, 1.0, 0.95, 0.85, 0.28];
    defs[GLOW.STROBE] = [L.strobe, 1.0, 1.0, 1.0, 1.1];
    defs[GLOW.LANDING] = [this.pts.flood, 1.0, 0.93, 0.78, 1.3];
    defs[GLOW.EXH_R] = [a.exhaustR, 1.0, 0.42, 0.1, 0.32];
    defs[GLOW.EXH_L] = [a.exhaustL, 1.0, 0.42, 0.1, 0.32];
    const gn = defs.length;
    const gg = new THREE.InstancedBufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    gg.setIndex([0, 1, 2, 0, 2, 3]);
    this.gPos = new THREE.InstancedBufferAttribute(new Float32Array(gn * 4), 4);
    this.gCol = new THREE.InstancedBufferAttribute(new Float32Array(gn * 4), 4).setUsage(THREE.DynamicDrawUsage);
    defs.forEach((d, i) => {
      const p = d[0] || this.pts.hub;
      this.gPos.array.set([p.x, p.y, p.z, d[4]], i * 4);
      this.gCol.array.set([d[1], d[2], d[3], 0], i * 4);
    });
    gg.setAttribute('aPos', this.gPos);
    gg.setAttribute('aCol', this.gCol);
    gg.instanceCount = gn;
    this.glowCount = gn;
    this.glows = new THREE.Mesh(gg, this.materials.glow);
    this.glows.name = 'seaplane.glows';
    this.glows.frustumCulled = false;
    this.glows.renderOrder = 4;
    root.add(this.glows);
    this.glowLevel = new Float32Array(gn);

    // landing-light beam and pool
    const beamLen = 26, beamR = Math.tan(0.2) * beamLen;
    const cg = new THREE.CylinderGeometry(0.09, beamR, 1, 24, 1, true);
    cg.translate(0, -0.5, 0); // apex at the origin, beam toward -y (unit length; scaled)
    const beam = new THREE.Mesh(cg, this.materials.beam);
    beam.name = 'seaplane.beam';
    beam.scale.set(1, beamLen, 1);
    beam.position.copy(this.pts.flood);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), this.pts.floodDir);
    beam.renderOrder = 4;
    beam.frustumCulled = false;
    beam.visible = false;
    root.add(beam);
    this.beam = beam;
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.materials.pool);
    pool.name = 'seaplane.pool';
    pool.rotation.x = -Math.PI / 2;
    pool.visible = false;
    pool.frustumCulled = false;
    pool.renderOrder = 4;
    worldRoot.add(pool);
    this.pool = pool;
    // optional real spot light (created once, never shadow casting)
    this.spot = null;
    if (opts.realLandingLight) {
      const s = new THREE.SpotLight(0xfff0d8, 0, 90, 0.32, 0.45, 1.6);
      s.name = 'seaplane.landingSpot';
      s.castShadow = false;
      s.position.copy(this.pts.flood);
      s.target.position.copy(this.pts.flood).addScaledVector(this.pts.floodDir, 10);
      root.add(s, s.target);
      this.spot = s;
    }

    // emitter state
    this.acc = { bow: [0, 0], step: [0, 0], mist: 0, smoke: 0, wash: 0, drip: 0, fire: 0, firesmoke: 0, spark: 0, wakeDist: 0, emitSpray: 0, emitWake: 0, emitFire: 0 };
    this.slamCool = 0;
    this.rainAcc = 0;
    this.flow = 0;
    this.time = 0;
    this.strobeT = 0;
    this.flashes = new Float32Array(2); // backfire flash per side
    this.wetDrip = 0;
    // scratch
    this._p = new THREE.Vector3(); this._q = new THREE.Vector3(); this._w = new THREE.Vector3();
    this._fwd = new THREE.Vector3(); this._right = new THREE.Vector3(); this._up = new THREE.Vector3();
    this._d = new THREE.Vector3(); this._camFwd = new THREE.Vector3(); this._m3 = new THREE.Matrix3();
    this._wind = new THREE.Vector3();
    this._ed = {};
    for (const t of ['spray', 'splash', 'wake', 'smoke', 'fire', 'sparks']) this._ed[t] = { x: 0, y: 0, z: 0, strength: 0, dir: new THREE.Vector3() };
  }

  setQuality(q) {
    this.quality = q;
    this.alpha.limit = q === 'low' ? 500 : this.alpha.cap;
    this.add.limit = q === 'low' ? 120 : this.add.cap;
    this.rateK = q === 'low' ? 0.45 : 1;
  }

  get meshes() { return [this.alpha.mesh, this.add.mesh, this.disc, this.glows, this.beam, this.pool]; }

  clear() { this.alpha.clear(); this.add.clear(); }

  // host hook (allocation free: the data object is reused per type)
  _emit(type, x, y, z, strength, dx, dy, dz) {
    const e = this.env.emit;
    if (!e) return;
    const d = this._ed[type];
    d.x = x; d.y = y; d.z = z; d.strength = strength; d.dir.set(dx, dy, dz);
    e(type, d);
  }

  // ------------------------------------------------------------------ spawning helpers
  _local(p, M, out) { return out.copy(p).applyMatrix4(M); }

  _spray(x, y, z, vx, vy, vz, size, grow, life, alpha, floor) {
    if (!this.useOwn) return;
    const i = this.alpha.spawn(PK.SPRAY, x, y, z, vx, vy, vz, size, grow, life, 0.93, 0.96, 1.0, alpha, 0.9, 9.81 * 0.85, floor);
    if (i >= 0) this.alpha.fade[i] = 0.04;
  }

  _mist(x, y, z, vx, vy, vz, size, grow, life, alpha) {
    if (!this.useOwn) return;
    this.alpha.spawn(PK.SMOKE, x, y, z, vx, vy, vz, size, grow, life, 0.95, 0.97, 1.0, alpha, 2.2, -0.15, -1e9);
  }

  _foam(x, y, z, size, grow, life, alpha) {
    if (!this.useOwn) return;
    const i = this.alpha.spawn(PK.FOAM, x, y + 0.04, z, 0, 0, 0, size, grow, life, 0.96, 0.98, 1.0, alpha, 0, 0, -1e9);
    if (i >= 0) { this.alpha.fade[i] = 0.02; this.alpha.spin[i] *= 0.1; }
  }

  _smoke(x, y, z, vx, vy, vz, size, grow, life, shade, alpha, rise = 0.6) {
    if (!this.useOwn) return;
    this.alpha.spawn(PK.SMOKE, x, y, z, vx, vy, vz, size, grow, life, shade, shade * 0.97, shade * 0.95, alpha, 1.4, -rise, -1e9);
  }

  _fire(x, y, z, vx, vy, vz, size, life, k) {
    if (!this.useOwn) return;
    const i = this.add.spawn(PK.FIRE, x, y, z, vx, vy, vz, size, -size * 0.6 / life, life, k, k, k, 0.9, 2.0, -2.5, -1e9);
    if (i >= 0) this.add.fade[i] = 0.15;
  }

  _spark(x, y, z, vx, vy, vz) {
    if (!this.useOwn) return;
    const i = this.add.spawn(PK.STREAK, x, y, z, vx, vy, vz, 0.025, 0, 0.25 + this.rand() * 0.35, 1.0, 0.62, 0.25, 1.0, 0.3, 9.81, -1e9);
    if (i >= 0) { this.add.stretch[i] = 0.035; this.add.fade[i] = 0.01; }
  }

  _flash(x, y, z, size, life, r, g, b) {
    if (!this.useOwn) return;
    const i = this.add.spawn(PK.GLOW, x, y, z, 0, 0, 0, size, size * 2, life, r, g, b, 1.0, 0, 0, -1e9);
    if (i >= 0) this.add.fade[i] = 0.01;
  }

  _drip(x, y, z, vx, vy, vz, floor) {
    if (!this.useOwn) return;
    const i = this.alpha.spawn(PK.STREAK, x, y, z, vx, vy, vz, 0.012, 0, 1.4, 0.8, 0.86, 0.92, 0.55, 0.05, 9.81, floor);
    if (i >= 0) { this.alpha.stretch[i] = 0.03; this.alpha.fade[i] = 0.02; }
  }

  // exhaust puffs at every stack (start coughs, catch, misfires, shutdown)
  puffs(s, count, shade, alpha, size, speed) {
    const M = s.M, P = this._p, R = this.rand;
    for (let k = 0; k < this.pts.stacks.length; k++) {
      this._local(this.pts.stacks[k], M, P);
      const d = this._d.copy(this.stackDir[k]).applyMatrix3(this._m3);
      for (let j = 0; j < count; j++) {
        const sp = speed * (0.6 + R() * 0.8);
        this._smoke(P.x, P.y, P.z, d.x * sp + s.vel.x * 0.8 + (R() - 0.5), d.y * sp + s.vel.y * 0.8 + R() * 0.5, d.z * sp + s.vel.z * 0.8 + (R() - 0.5),
          size * (0.7 + R() * 0.6), size * 1.6, 1.6 + R() * 1.4, shade, alpha, 0.5);
      }
    }
    this._emit('smoke', P.x, P.y, P.z, alpha * count, this._d.x, this._d.y, this._d.z);
  }

  // ------------------------------------------------------------------ discrete events
  onEngineEvent(type, s) {
    if (!s || !s.M) return;
    switch (type) {
      case 'cough': this.puffs(s, 2, 0.05, 0.55, 0.28, 2.5); break;
      case 'catch': this.puffs(s, 5, 0.04, 0.7, 0.35, 3.5); this._backfire(s, 0.6); break;
      case 'backfire': this._backfire(s, 1); this.puffs(s, 2, 0.05, 0.6, 0.3, 4); break;
      case 'misfire': this.puffs(s, 1, 0.12, 0.35, 0.22, 3); break;
      case 'runDown': case 'shutdown': this.puffs(s, 1, 0.1, 0.4, 0.25, 1.5); break;
      default: break;
    }
  }

  _backfire(s, k) {
    const M = s.M, P = this._p;
    for (let side = 0; side < 2; side++) {
      const src = side === 0 ? this.pts.stacks[0] : this.pts.stacks[this.pts.stacks.length - 1];
      if (!src) continue;
      this._local(src, M, P);
      this._flash(P.x, P.y, P.z, 0.35 * k, 0.07, 1.0, 0.55, 0.15);
      this.flashes[side] = Math.max(this.flashes[side], k);
      for (let j = 0; j < 3; j++) this._spark(P.x, P.y, P.z, s.vel.x + (this.rand() - 0.5) * 4, s.vel.y + this.rand() * 2, s.vel.z + (this.rand() - 0.5) * 4);
    }
  }

  // splash burst at a world point
  splash(x, y, z, strength, vel) {
    const R = this.rand;
    const n = Math.round(clamp(strength * 9, 8, 70) * this.rateK);
    for (let i = 0; i < n; i++) {
      const a = R() * TWO_PI, sp = (1.5 + R() * 3.5) * Math.min(strength, 3);
      this._spray(x + Math.cos(a) * 0.6, y, z + Math.sin(a) * 0.6, Math.cos(a) * sp + vel.x * 0.3, 2.5 + R() * 4 * Math.min(strength, 2.5), Math.sin(a) * sp + vel.z * 0.3,
        0.25 + R() * 0.4, 0.9, 0.7 + R() * 0.7, 0.75, y - 0.3);
    }
    for (let i = 0; i < Math.round(4 * this.rateK); i++) this._mist(x + (R() - 0.5) * 2, y + 0.6, z + (R() - 0.5) * 2, vel.x * 0.2, 1, vel.z * 0.2, 1.2, 2.2, 2.2, 0.16);
    for (let i = 0; i < 3; i++) this._foam(x + (R() - 0.5) * 2.5, y, z + (R() - 0.5) * 2.5, 1.6, 0.9, 5, 0.55);
    this._emit('splash', x, y, z, strength, vel.x, vel.y, vel.z);
  }

  onPhysicsEvent(ev, s) {
    if (!s || !s.M) return;
    if (ev.type === 'touchdown' && !ev.ground) {
      const k = ev.quality === 'smooth' ? 0.8 : ev.quality === 'firm' ? 1.6 : 2.8;
      for (let side = 0; side < 2; side++) {
        this._local(this.pts.step[side], s.M, this._p);
        const wy = this.env.waterHeight ? this.env.waterHeight(this._p.x, this._p.z) : this._p.y;
        this.splash(this._p.x, wy, this._p.z, k, s.vel);
      }
    } else if (ev.type === 'impact') {
      if (ev.speed > 4) {
        let c = null;
        if (s.physics) for (const cc of s.physics.contacts) if (cc.part === ev.part && cc.kind === ev.kind) { c = cc; break; }
        if (c) {
          this._local(c.local, s.M, this._p);
          for (let i = 0; i < 10; i++) this._spark(this._p.x, this._p.y, this._p.z, (this.rand() - 0.5) * 6, this.rand() * 4, (this.rand() - 0.5) * 6);
          this._emit('sparks', this._p.x, this._p.y, this._p.z, ev.speed / 10, 0, 1, 0);
        }
      }
    } else if (ev.type === 'wreck') {
      this._local(this.pts.engine, s.M, this._p);
      this._flash(this._p.x, this._p.y, this._p.z, 3.5, 0.25, 1.0, 0.6, 0.25);
      this.puffs(s, 6, 0.05, 0.8, 0.6, 3);
    }
  }

  // ------------------------------------------------------------------ per frame
  // s: frame context from the plane (see Seaplane.js)
  update(dt, s) {
    this.time += dt;
    const env = this.env, R = this.rand, o = s.out, M = s.M;
    const P = this._p, Q = this._q;
    this._m3.setFromMatrix4(M);
    const fwd = this._fwd.set(0, 0, -1).applyMatrix3(this._m3);
    const right = this._right.set(1, 0, 0).applyMatrix3(this._m3);
    const up = this._up.set(0, 1, 0).applyMatrix3(this._m3);
    const vel = s.vel;
    const wind = this._wind.copy(env.wind || this._wind.set(0, 0, 0));
    const night = s.night, day = 1 - night;
    const rk = this.rateK;
    // lighting tint for the particles
    const sunY = env.sunDirection ? env.sunDirection.y : 1;
    const sunset = smooth(-0.05, 0.1, sunY) * (1 - smooth(0.15, 0.45, sunY));
    this.uniforms.uFxLight.value.set(0.06 + 0.98 * day + 0.06 * sunset, 0.07 + 0.92 * day - 0.05 * sunset, 0.1 + 0.88 * day - 0.15 * sunset);
    if (env.sunDirection) this.uniforms.uFxSun.value.copy(env.sunDirection);
    // fog-like fade for additive particles
    const fog = s.fogDensity || 0;

    // ---------------- water: bow spray, rooster tail, mist, wake foam, prop wash ----------------
    if (o.onWater) {
      const ws = o.waterSpeed;
      const chop = s.chop || 0;
      for (let side = 0; side < 2; side++) {
        // bow spray sheets
        const bow = o.sprayBow[side];
        if (bow > 2.5 && ws > 3) {
          this.acc.bow[side] += dt * rk * clamp((bow - 2.5) * 9 + chop * 20, 0, 90);
          while (this.acc.bow[side] >= 1) {
            this.acc.bow[side] -= 1;
            const out = R() < 0.5 ? -1 : 1; // spray leaves both sides of each float
            Q.copy(this.pts.bow[side]);
            Q.x += out * 0.42; Q.z += (R() - 0.5) * 0.8;
            this._local(Q, M, P);
            const wy = env.waterHeight ? env.waterHeight(P.x, P.z) : P.y;
            const sp = ws * (0.18 + R() * 0.12);
            const lat = out * (0.6 + R() * 0.6);
            this._spray(P.x, wy + 0.1, P.z,
              right.x * lat * sp + up.x * 0 + fwd.x * ws * 0.25, sp * (0.55 + R() * 0.5) + 0.8, right.z * lat * sp + fwd.z * ws * 0.25,
              0.12 + R() * 0.15, 0.9 + ws * 0.03, 0.45 + R() * 0.45, 0.62, wy - 0.25);
          }
        }
        // rooster tail behind the steps while planing / accelerating through the hump
        const st = o.sprayStep[side];
        if (st > 6 && ws > 7) {
          this.acc.step[side] += dt * rk * clamp((ws - 7) * 4, 0, 60);
          while (this.acc.step[side] >= 1) {
            this.acc.step[side] -= 1;
            Q.copy(this.pts.step[side]);
            Q.z += 0.4 + R() * 0.5; Q.x += (R() - 0.5) * 0.5;
            this._local(Q, M, P);
            const wy = env.waterHeight ? env.waterHeight(P.x, P.z) : P.y;
            const h = 1.2 + ws * 0.09 + R() * 1.4;
            this._spray(P.x, wy, P.z, fwd.x * ws * 0.15 + (R() - 0.5) * 1.5, h, fwd.z * ws * 0.15 + (R() - 0.5) * 1.5,
              0.2 + R() * 0.2, 1.4, 0.8 + R() * 0.6, 0.55, wy - 0.25);
          }
        }
        // wake / foam along the floats
        if (ws > 0.7) {
          if (R() < dt * rk * (2 + ws * 0.9)) {
            Q.copy(this.pts.stern[side]); Q.x += (R() - 0.5) * 0.5; Q.z += (R() - 0.5) * 1.2;
            this._local(Q, M, P);
            const wy = env.waterHeight ? env.waterHeight(P.x, P.z) : P.y;
            this._foam(P.x, wy, P.z, 0.7 + ws * 0.05, 0.35 + ws * 0.04, 5 + R() * 3, clamp(0.25 + ws * 0.03, 0, 0.7));
          }
          if (ws > 2 && R() < dt * rk * ws * 0.6) {
            Q.copy(this.pts.bow[side]); Q.x += (R() < 0.5 ? -0.5 : 0.5);
            this._local(Q, M, P);
            const wy = env.waterHeight ? env.waterHeight(P.x, P.z) : P.y;
            this._foam(P.x, wy, P.z, 0.5, 0.5 + ws * 0.03, 4 + R() * 2, 0.45);
          }
        }
      }
      // mist trail at speed (takeoff run)
      if (ws > 10) {
        this.acc.mist += dt * rk * (ws - 10) * 0.9;
        while (this.acc.mist >= 1) {
          this.acc.mist -= 1;
          const side = R() < 0.5 ? 0 : 1;
          Q.copy(this.pts.step[side]); Q.z += 1 + R() * 2;
          this._local(Q, M, P);
          this._mist(P.x, P.y + 0.6, P.z, vel.x * 0.25, 0.5, vel.z * 0.25, 1.0, 1.8, 2.4, 0.11);
        }
      }
      // slams
      this.slamCool -= dt;
      if (o.slam > 3.2 && this.slamCool <= 0) {
        this.slamCool = 0.35;
        for (let side = 0; side < 2; side++) {
          this._local(this.pts.bow[side], M, P);
          const wy = env.waterHeight ? env.waterHeight(P.x, P.z) : P.y;
          this.splash(P.x, wy, P.z, clamp(o.slam / 3, 0.5, 2.2), vel);
        }
      }
      // host hooks (rate limited)
      this.acc.emitSpray -= dt;
      if (this.acc.emitSpray <= 0 && (o.sprayBow[0] > 2.5 || o.sprayBow[1] > 2.5)) {
        this.acc.emitSpray = 1 / 12;
        for (let side = 0; side < 2; side++) {
          if (o.sprayBow[side] <= 2.5) continue;
          this._local(this.pts.bow[side], M, P);
          this._emit('spray', P.x, P.y, P.z, clamp(o.sprayBow[side] / 15, 0, 1.5), fwd.x, 0, fwd.z);
        }
      }
      this.acc.emitWake -= dt;
      if (this.acc.emitWake <= 0 && ws > 0.6) {
        this.acc.emitWake = 1 / 8;
        for (let side = 0; side < 2; side++) {
          this._local(this.pts.stern[side], M, P);
          this._emit('wake', P.x, P.y, P.z, clamp(ws / 20, 0, 1.5), fwd.x, 0, fwd.z);
        }
      }
    } else {
      this.acc.bow[0] = this.acc.bow[1] = this.acc.step[0] = this.acc.step[1] = this.acc.mist = 0;
    }
    // wing / tip dipping into the water
    if (o.wingDrag > 3 && R() < dt * 30) {
      const side = s.rollSign >= 0 ? 1 : -1;
      Q.set(side * 6.8, DIM.wing.chordY - CG_MODEL.y, DIM.wing.leZ + 0.8 - CG_MODEL.z);
      this._local(Q, M, P);
      const wy = env.waterHeight ? env.waterHeight(P.x, P.z) : P.y;
      this.splash(P.x, wy, P.z, clamp(o.wingDrag / 8, 0.4, 2), vel);
    }
    // prop wash over the water
    const rpm = s.rpm;
    if (s.running && rpm > 1400 && o.propTipWater !== undefined && o.propTipWater > -1.8 && (o.onWater || o.agl < 3)) {
      const k = smooth(1400, 2300, rpm) * smooth(-1.8, -0.4, o.propTipWater);
      this.acc.wash += dt * rk * k * 45;
      while (this.acc.wash >= 1) {
        this.acc.wash -= 1;
        Q.copy(this.pts.hub); Q.z += 1.5 + R() * 2.5; Q.x += (R() - 0.5) * 2.2; Q.y -= DIM.propRadius;
        this._local(Q, M, P);
        const wy = env.waterHeight ? env.waterHeight(P.x, P.z) : P.y;
        const sp = 6 + R() * 10;
        if (R() < 0.6) this._spray(P.x, wy + 0.05, P.z, -fwd.x * sp + vel.x * 0.4, 0.8 + R() * 1.6, -fwd.z * sp + vel.z * 0.4, 0.18 + R() * 0.2, 1.2, 0.5 + R() * 0.4, 0.4, wy - 0.25);
        else this._foam(P.x, wy, P.z, 0.6, 1.2, 2.5 + R(), 0.35);
      }
    }

    // ---------------- exhaust & damage ----------------
    if (s.running) {
      const pw = s.power; // 0..1
      this.acc.smoke += dt * rk * (1.5 + pw * 9 + s.misfire * 10);
      while (this.acc.smoke >= 1) {
        this.acc.smoke -= 1;
        const k = (R() * this.pts.stacks.length) | 0;
        this._local(this.pts.stacks[k], M, P);
        const d = this._d.copy(this.stackDir[k]).applyMatrix3(this._m3);
        const wash = 4 + (rpm / 2300) * 22;
        const shade = 0.32 - pw * 0.12 + s.misfire * -0.15;
        this._smoke(P.x, P.y, P.z, d.x * 2 - fwd.x * wash + vel.x * 0.35, d.y * 2 - fwd.y * wash + vel.y * 0.35, d.z * 2 - fwd.z * wash + vel.z * 0.35,
          0.1, 0.9 + pw * 0.6, 0.8 + R() * 0.7, clamp(shade, 0.08, 0.4), 0.05 + pw * 0.05 + s.misfire * 0.3, 0.3);
      }
    }
    // damaged engine smoke / fire (also on the wreck)
    const dmg = s.engineDamage; // 0 intact .. 1 destroyed
    if (dmg > 0.4 || s.fire) {
      const k = s.fire ? 1 : (dmg - 0.4) / 0.6;
      this.acc.firesmoke += dt * rk * (3 + k * 16);
      while (this.acc.firesmoke >= 1) {
        this.acc.firesmoke -= 1;
        Q.copy(this.pts.engine); Q.x += (R() - 0.5) * 0.6; Q.y += 0.2 + R() * 0.3; Q.z += (R() - 0.5) * 0.8;
        this._local(Q, M, P);
        const wash = s.running ? 6 + (rpm / 2300) * 18 : 0;
        this._smoke(P.x, P.y, P.z, -fwd.x * wash + vel.x * 0.5, 0.8 - fwd.y * wash, -fwd.z * wash + vel.z * 0.5, 0.3, 1.1 + k * 0.6, 2.5 + R() * 2.5, 0.05, 0.25 + 0.35 * k, 1.2);
      }
      if (s.fire) {
        this.acc.fire += dt * rk * 40;
        while (this.acc.fire >= 1) {
          this.acc.fire -= 1;
          Q.copy(this.pts.engine); Q.x += (R() - 0.5) * 0.7; Q.y += R() * 0.4; Q.z += (R() - 0.5) * 0.9;
          this._local(Q, M, P);
          this._fire(P.x, P.y, P.z, vel.x * 0.6 + (R() - 0.5), 1.2 + R() * 1.5, vel.z * 0.6 + (R() - 0.5), 0.35 + R() * 0.35, 0.45 + R() * 0.4, 1.2);
        }
        this.acc.emitFire -= dt;
        if (this.acc.emitFire <= 0) {
          this.acc.emitFire = 0.25;
          this._local(this.pts.engine, M, P);
          this._emit('fire', P.x, P.y, P.z, 1, 0, 1, 0);
        }
      }
    }
    // sparks from scraping on rocks / hard ground (non-hull contacts)
    if (o.scrape > 2.5 && s.physics) {
      for (const c of s.physics.contacts) {
        if (!c.on || c.kind === 'keel' || c.kind === 'chine' || c.kind === 'bow') continue;
        if (R() > dt * 40) continue;
        this._local(c.local, M, P);
        for (let j = 0; j < 3; j++) this._spark(P.x, P.y, P.z, vel.x * 0.4 + (R() - 0.5) * 5, R() * 3, vel.z * 0.4 + (R() - 0.5) * 5);
        this._emit('sparks', P.x, P.y, P.z, o.scrape / 10, 0, 1, 0);
      }
    }
    // drips: wet wings after rain / landing, floats after leaving the water
    const wet = s.wetness;
    if (wet > 0.2 && o.airspeed < 6) {
      this.acc.drip += dt * rk * (wet - 0.2) * 30;
      while (this.acc.drip >= 1) {
        this.acc.drip -= 1;
        const span = (R() < 0.5 ? -1 : 1) * (0.9 + R() * 6.1);
        Q.set(span, this.pts.wingTE.y, this.pts.wingTE.z + (R() - 0.5) * 0.1);
        this._local(Q, M, P);
        const gy = env.groundHeight ? env.groundHeight(P.x, P.z) : -1e9;
        const wy = env.waterHeight ? env.waterHeight(P.x, P.z) : -1e9;
        this._drip(P.x, P.y, P.z, vel.x, vel.y - 0.3, vel.z, Math.max(gy, wy));
      }
    }

    // particle simulation + upload
    if (this.useOwn) {
      this.alpha.update(dt, wind, env, s.camPos, 0);
      this.add.update(dt, wind, null, s.camPos, fog);
    }

    // ---------------- prop disc ----------------
    const omega = Math.abs(s.omega);
    const discA = smooth(300, 650, rpm) * (s.propAttached ? 1 : 0);
    this.disc.visible = discA > 0.01;
    // apparent (filmic) rotation: slow drift instead of strobing
    this._discAng -= dt * (0.8 + omega * 0.006);
    this.uniforms.uPropAng.value = this._discAng % TWO_PI;
    this.uniforms.uPropBlur.value = clamp(omega / 55, 0, 1.0472) * (s.propBent ? 0.8 : 1);
    this.uniforms.uPropAlpha.value = discA;
    // flicker when looking into the sun through the disc
    let flick = 0;
    if (env.sunDirection && discA > 0.1) {
      const cf = this._camFwd.set(0, 0, -1).applyQuaternion(s.camQuat);
      flick = smooth(0.82, 0.97, cf.dot(env.sunDirection)) * day * (0.5 + 0.5 * Math.sin(this.time * 47.0)) * 0.35;
    }
    this.uniforms.uPropFlick.value = flick;

    // ---------------- glows ----------------
    const C = this.gCol.array;
    const navK = s.lights.nav ? 0.12 + 0.88 * night : 0;
    this.strobeT += dt;
    if (this.strobeT > 1.2) this.strobeT -= 1.2;
    const strobe = s.lights.nav && (this.strobeT < 0.06 || (this.strobeT > 0.16 && this.strobeT < 0.2)) ? 0.55 + 0.45 * night : 0;
    const land = s.lights.landing ? 0.25 + 0.75 * night : 0;
    for (let side = 0; side < 2; side++) this.flashes[side] = Math.max(0, this.flashes[side] - dt * 12);
    const exh = s.running ? (0.02 + 0.15 * s.power) * (0.25 + 0.75 * night) : 0;
    const lv = this.glowLevel;
    lv[GLOW.NAV_L] = navK * 1.6; lv[GLOW.NAV_R] = navK * 1.6; lv[GLOW.TAIL] = navK * 1.2;
    lv[GLOW.STROBE] = strobe * 3;
    lv[GLOW.LANDING] = land * 2.2;
    lv[GLOW.EXH_R] = exh + this.flashes[0] * 1.5; lv[GLOW.EXH_L] = exh + this.flashes[1] * 1.5;
    for (let i = 0; i < this.glowCount; i++) C[i * 4 + 3] = lv[i];
    this.gCol.needsUpdate = true;
    // pixel size for the minimum glow size
    if (s.camFov) this.uniforms.uGlowPix.value = (2 * Math.tan((s.camFov * Math.PI) / 360)) / Math.max(s.viewH || 1080, 1);
    // lamp emission (exterior lamp lenses): 0 nav, 1 strobe, 2 landing
    const lamp = this.U.uSpLamp.value;
    lamp[0] = navK * 1.2; lamp[1] = strobe * 2.5 + (s.lights.nav ? 0.05 : 0); lamp[2] = land * 2.5;

    // ---------------- landing beam & pool ----------------
    const beamK = land * (0.04 + 0.55 * night + 0.35 * s.rain);
    this.beam.visible = beamK > 0.005;
    this.uniforms.uBeam.value = beamK * 0.35;
    this.pool.visible = false;
    if (land > 0 && night > 0.05) {
      // march the beam axis to the surface
      this._local(this.pts.flood, M, P);
      const dir = this._d.copy(this.pts.floodDir).applyMatrix3(this._m3).normalize();
      let hit = -1;
      for (let t = 2; t <= 44; t += 2) {
        const x = P.x + dir.x * t, y = P.y + dir.y * t, z = P.z + dir.z * t;
        const sy = Math.max(env.waterHeight ? env.waterHeight(x, z) : -1e9, env.groundHeight ? env.groundHeight(x, z) : -1e9);
        if (y <= sy) { hit = t; break; }
      }
      if (hit > 0) {
        // refine between hit-2 and hit
        let t0 = hit - 2, t1 = hit;
        for (let it = 0; it < 4; it++) {
          const tm = (t0 + t1) / 2;
          const x = P.x + dir.x * tm, y = P.y + dir.y * tm, z = P.z + dir.z * tm;
          const sy = Math.max(env.waterHeight ? env.waterHeight(x, z) : -1e9, env.groundHeight ? env.groundHeight(x, z) : -1e9);
          if (y <= sy) t1 = tm; else t0 = tm;
        }
        const t = (t0 + t1) / 2;
        const hx = P.x + dir.x * t, hz = P.z + dir.z * t;
        const sy = Math.max(env.waterHeight ? env.waterHeight(hx, hz) : -1e9, env.groundHeight ? env.groundHeight(hx, hz) : -1e9);
        const inc = Math.max(Math.abs(dir.y), 0.12);
        const rad = t * Math.tan(0.24);
        this.pool.position.set(hx, sy + 0.06, hz);
        this.pool.rotation.set(-Math.PI / 2, Math.atan2(dir.x, dir.z), 0, 'YXZ');
        this.pool.scale.set(rad * 2, (rad * 2) / inc, 1);
        this.uniforms.uPool.value = land * night * clamp(90 / (t * t), 0.05, 1.2) * Math.min(1, inc * 3);
        this.pool.visible = true;
      }
    }
    if (this.spot) this.spot.intensity = s.lights.landing ? 60 : 0;

    // ---------------- windscreen rain ----------------
    const rain = s.rain;
    const air = o.airspeed;
    if (rain > 0.02) this.rainAcc += (rain - this.rainAcc) * Math.min(1, dt * 0.35);
    else this.rainAcc -= dt * (0.01 + air * 0.003 + (env.sunDirection && env.sunDirection.y > 0 ? 0.02 * day : 0));
    this.rainAcc = clamp(this.rainAcc, 0, 1);
    this.flow += dt * (0.04 + air * 0.014);
    if (this.flow > 1000) this.flow -= 1000;
    this.U.uSpRain.value = this.rainAcc;
    this.U.uSpFlow.value = this.flow;
    this.U.uSpStreak.value = smooth(4, 28, air);
  }

  dispose() {
    for (const k in this.materials) this.materials[k].dispose();
    for (const m of this.meshes) { m.geometry.dispose(); m.removeFromParent(); }
    if (this.spot) { this.spot.removeFromParent(); this.spot.target.removeFromParent(); }
  }
}
