// Sandbox ocean: sum of Gerstner waves on a camera-following polar grid, with an
// exact CPU twin (heightAt) used as env.waterHeight. Calm lagoons inside the
// reefs, rough open sea outside; depth-tinted, transparent in the shallows.
import * as THREE from 'three';
import { ISLANDS } from './terrain.js';
import { SKY_GLSL } from './sky.js';

const G = 9.81;
// fixed wave set: direction (rad), wavelength (m), amplitude (m), steepness
const WAVES = [
  [0.25, 41, 0.42, 0.55], [0.62, 23, 0.25, 0.6], [-0.35, 13.5, 0.15, 0.6],
  [1.05, 7.6, 0.075, 0.55], [-0.95, 4.9, 0.045, 0.5], [2.35, 58, 0.22, 0.35],
];
const NW = WAVES.length;

// zone amplitude: calm inside reefs, damped near shore (analytic, mirrored in GLSL)
function zoneAmp(x, z) {
  let k = 1;
  for (const I of ISLANDS) {
    const d = Math.hypot(x - I.x, z - I.z) / I.r;
    const lagoon = 0.26 + 0.74 * THREE.MathUtils.smoothstep(d, 1.55, 1.85);
    const shore = 0.25 + 0.75 * THREE.MathUtils.smoothstep(d, 0.95, 1.25);
    k = Math.min(k, lagoon * shore);
  }
  return k;
}
const ZONE_GLSL = /* glsl */ `
uniform vec4 uIsl[2];
float zoneAmp(vec2 p) {
  float k = 1.0;
  for (int i = 0; i < 2; i++) {
    float d = length(p - uIsl[i].xy) / uIsl[i].z;
    float lagoon = 0.26 + 0.74 * smoothstep(1.55, 1.85, d);
    float shore = 0.25 + 0.75 * smoothstep(0.95, 1.25, d);
    k = min(k, lagoon * shore);
  }
  return k;
}`;

const OCEAN_VERT = /* glsl */ `
uniform vec4 uWA[${NW}];
uniform vec4 uWB[${NW}];
uniform float uTime;
uniform float uSea;
uniform vec3 uCam;
${ZONE_GLSL}
varying vec3 vW;
varying vec3 vN;
varying float vCrest;
#include <fog_pars_vertex>
void main() {
  vec2 p = position.xz + uCam.xz;
  float dist = length(position.xz);
  float za = zoneAmp(p) * uSea;
  vec3 d = vec3(0.0);
  vec3 dPx = vec3(1.0, 0.0, 0.0), dPz = vec3(0.0, 0.0, 1.0);
  float crest = 0.0;
  for (int i = 0; i < ${NW}; i++) {
    vec2 dir = uWA[i].xy;
    float k = uWA[i].z;
    float a = uWA[i].w * za;
    float fade = 1.0 - smoothstep(6.2831 / k * 5.0, 6.2831 / k * 12.0, dist);
    a *= fade;
    float th = k * dot(dir, p) - uWB[i].x * uTime + uWB[i].y;
    float q = uWB[i].z;
    float c = cos(th), s = sin(th);
    d.x += q * a * dir.x * c;
    d.z += q * a * dir.y * c;
    d.y += a * s;
    // partial derivatives for the normal
    dPx += vec3(-q * a * dir.x * dir.x * k * s, a * dir.x * k * c, -q * a * dir.y * dir.x * k * s);
    dPz += vec3(-q * a * dir.x * dir.y * k * s, a * dir.y * k * c, -q * a * dir.y * dir.y * k * s);
    crest += q * a * k * s;
  }
  vec3 w = vec3(p.x + d.x, d.y, p.y + d.z);
  vW = w;
  vN = normalize(cross(dPz, dPx));
  vCrest = crest;
  vec4 mvPosition = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const OCEAN_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uCam;
uniform sampler2D uHeight;
uniform vec4 uHeightXf; // centre.xy, span, 0
uniform vec3 uLightCol;
uniform float uRain;
varying vec3 vW;
varying vec3 vN;
varying float vCrest;
${SKY_GLSL}
#include <fog_pars_fragment>
float o_h(vec2 p) { p = fract(p * vec2(0.1031, 0.1137)); p += dot(p, p.yx + 19.19); return fract(p.x * p.y * 1.7313 + p.x * 0.513); }
float o_n(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(o_h(i), o_h(i + vec2(1, 0)), u.x), mix(o_h(i + vec2(0, 1)), o_h(i + vec2(1, 1)), u.x), u.y); }
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float dist = length(cameraPosition - vW);
  // ripples
  vec2 rp = vW.xz;
  float e = 0.08;
  float r0 = o_n(rp * 1.3 + uTime * 0.6) + 0.5 * o_n(rp * 3.1 - uTime * 0.9) + 0.25 * o_n(rp * 7.3 + uTime * 1.3);
  float rx = o_n((rp + vec2(e, 0.0)) * 1.3 + uTime * 0.6) + 0.5 * o_n((rp + vec2(e, 0.0)) * 3.1 - uTime * 0.9) + 0.25 * o_n((rp + vec2(e, 0.0)) * 7.3 + uTime * 1.3);
  float rz = o_n((rp + vec2(0.0, e)) * 1.3 + uTime * 0.6) + 0.5 * o_n((rp + vec2(0.0, e)) * 3.1 - uTime * 0.9) + 0.25 * o_n((rp + vec2(0.0, e)) * 7.3 + uTime * 1.3);
  float rk = (0.07 + uRain * 0.08) * (1.0 - smoothstep(30.0, 250.0, dist));
  vec3 N = normalize(vN + vec3(-(rx - r0) / e, 0.0, -(rz - r0) / e) * rk);
  if (dot(N, V) < 0.0) N = normalize(N + V * (0.05 - dot(N, V)));
  // depth below the surface from the terrain height map
  vec2 huv = (vW.xz - uHeightXf.xy) / uHeightXf.z + 0.5;
  float ground = texture2D(uHeight, huv).r;
  if (huv.x < 0.0 || huv.y < 0.0 || huv.x > 1.0 || huv.y > 1.0) ground = -40.0;
  float depth = max(vW.y - ground, 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyColor(R, false);
  float spec = pow(max(dot(R, uSunDir), 0.0), 900.0) * 60.0 + pow(max(dot(R, uSunDir), 0.0), 120.0) * 1.5;
  vec3 deep = vec3(0.0, 0.035, 0.06);
  vec3 shallow = vec3(0.04, 0.33, 0.32);
  float dk = exp(-depth * 0.16);
  vec3 body = mix(deep, shallow, dk);
  float sunL = max(uSunDir.y, 0.0) * (1.0 - uNight);
  body *= (0.25 + 0.9 * sunL) * (0.35 + 0.65 * uLightCol);
  // light scattered through wave crests
  body += vec3(0.02, 0.12, 0.1) * max(vCrest, 0.0) * 0.6 * sunL;
  vec3 col = mix(body, refl, fres) + uSunColor * spec * (1.0 - uNight);
  // foam: shoreline and steep crests
  float fn = o_n(vW.xz * 0.9 + uTime * 0.2) * 0.6 + o_n(vW.xz * 3.3 - uTime * 0.3) * 0.4;
  float foam = smoothstep(0.45, 0.0, depth) * smoothstep(0.35, 0.65, fn);
  foam += smoothstep(0.55, 0.9, vCrest) * smoothstep(0.5, 0.75, fn);
  col = mix(col, vec3(0.85, 0.88, 0.86) * (0.3 + 0.8 * sunL), clamp(foam, 0.0, 1.0) * 0.8);
  float alpha = clamp(1.0 - exp(-depth * 1.4), 0.0, 1.0);
  alpha = max(alpha, fres * 0.7);
  alpha = max(alpha, clamp(foam, 0.0, 1.0) * 0.9);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class Ocean {
  constructor(scene, sky, heightTexture) {
    this.time = 0;
    this.sea = 1;
    this.seaTarget = 1;
    const waves = WAVES.map(([ang, L, A, Q]) => {
      const k = (2 * Math.PI) / L;
      return { dx: Math.cos(ang), dz: Math.sin(ang), k, A, w: Math.sqrt(G * k), phase: ang * 3.7, Q: Math.min(Q / (k * A * NW), 1) };
    });
    this.waves = waves;
    const uWA = waves.map((w) => new THREE.Vector4(w.dx, w.dz, w.k, w.A));
    const uWB = waves.map((w) => new THREE.Vector4(w.w, w.phase, w.Q, 0));
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    Object.assign(this.uniforms, sky.uniforms, {
      uWA: { value: uWA }, uWB: { value: uWB }, uTime: { value: 0 }, uSea: { value: 1 },
      uCam: { value: new THREE.Vector3() }, uHeight: { value: heightTexture },
      uHeightXf: { value: new THREE.Vector4(heightTexture.userData.center.x, heightTexture.userData.center.y, heightTexture.userData.span, 0) },
      uIsl: { value: ISLANDS.map((I) => new THREE.Vector4(I.x, I.z, I.r, 0)) },
      uLightCol: { value: new THREE.Color(1, 1, 1) }, uRain: { value: 0 },
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: OCEAN_VERT, fragmentShader: OCEAN_FRAG,
      transparent: true, depthWrite: true, fog: true, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this._grid(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }

  _grid() {
    const rings = 100, segs = 160;
    const b = 0.0646, A = 12.0;
    const pos = [0, 0, 0];
    for (let i = 1; i <= rings; i++) {
      const r = A * (Math.exp(b * i) - 1);
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      }
    }
    const idx = [];
    for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
    for (let i = 1; i < rings; i++) {
      const r0 = 1 + (i - 1) * segs, r1 = 1 + i * segs;
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % segs;
        idx.push(r0 + j, r0 + j1, r1 + j, r0 + j1, r1 + j1, r1 + j);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  update(dt, camera, light) {
    this.time += dt;
    this.sea += (this.seaTarget - this.sea) * Math.min(1, dt * 0.2);
    this.uniforms.uTime.value = this.time;
    this.uniforms.uSea.value = this.sea;
    // snap the grid centre to 2 m so the inner rings do not swim
    this.uniforms.uCam.value.set(Math.round(camera.position.x / 2) * 2, 0, Math.round(camera.position.z / 2) * 2);
    if (light) this.uniforms.uLightCol.value.copy(light.color);
  }

  // Gerstner displacement at an undisplaced point (x, z)
  _disp(x, z, out) {
    const za = zoneAmp(x, z) * this.sea;
    let dx = 0, dy = 0, dz = 0;
    for (const w of this.waves) {
      const a = w.A * za;
      const th = w.k * (w.dx * x + w.dz * z) - w.w * this.time + w.phase;
      const c = Math.cos(th);
      dx += w.Q * a * w.dx * c;
      dz += w.Q * a * w.dz * c;
      dy += a * Math.sin(th);
    }
    out[0] = dx; out[1] = dy; out[2] = dz;
    return out;
  }

  // exact twin of the rendered surface height at world (x, z)
  heightAt(x, z) {
    const d = this._tmp || (this._tmp = [0, 0, 0]);
    let px = x, pz = z;
    for (let i = 0; i < 4; i++) {
      this._disp(px, pz, d);
      px = x - d[0];
      pz = z - d[2];
    }
    this._disp(px, pz, d);
    return d[1];
  }

  // horizontal orbital velocity of the surface (small current, m/s)
  flowAt(x, z, out) {
    const za = zoneAmp(x, z) * this.sea;
    let vx = 0, vz = 0;
    for (const w of this.waves) {
      const a = w.A * za;
      const th = w.k * (w.dx * x + w.dz * z) - w.w * this.time + w.phase;
      const s = Math.sin(th) * w.w * w.Q * a;
      vx += w.dx * s;
      vz += w.dz * s;
    }
    return out.set(vx + 0.05, 0, vz + 0.03);
  }
}
