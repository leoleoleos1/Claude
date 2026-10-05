// Sandbox islands: analytic height field (main island with beach, lagoon, reef
// and a jungle mountain; a smaller island ~1 km away), terrain meshes, palms,
// jungle clumps, rocks, colliders and a heightmap texture for the water shader.
import * as THREE from 'three';

// --- small deterministic noise (CPU) --------------------------------------
function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, z, seed = 1) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
export function fbm(x, z, oct = 4, seed = 1) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, z * f, seed + i * 13); a *= 0.5; f *= 2.03; }
  return s;
}
const smooth = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };

export const ISLANDS = [
  { x: 0, z: 0, r: 205, peak: { x: -45, z: -55, h: 150, w: 95 }, seed: 3 },
  { x: 880, z: -620, r: 95, peak: { x: 870, z: -640, h: 70, w: 50 }, seed: 11 },
];
// The beach cove on the east side of the main island (plane spawn, hangar, pier).
export const BEACH = { x: 214, z: 30, heading: Math.PI / 2 };

function islandHeight(I, x, z) {
  const dx = x - I.x, dz = z - I.z;
  const r = Math.hypot(dx, dz);
  const ang = Math.atan2(dz, dx);
  // irregular coastline (wrap-safe angular noise)
  const cn = fbm(Math.cos(ang) * 2.2 + 10, Math.sin(ang) * 2.2 + 10, 3, I.seed) - 0.5;
  // the east beach cove is smooth and wide on the main island
  const cove = I.seed === 3 ? Math.exp(-((ang - 0.1) ** 2) / 0.08) : 0;
  const R = I.r * (1 + cn * 0.35 * (1 - cove)) * (1 + 0.04 * cove);
  const d = r / R;
  let h;
  if (d < 0.78) {
    const inland = 3.2 + (0.78 - d) * 30 * (0.6 + fbm(x * 0.012, z * 0.012, 4, I.seed + 5));
    h = inland;
  } else if (d < 1.0) {
    const t = (d - 0.78) / 0.22;
    h = THREE.MathUtils.lerp(3.2, 0.0, smooth(0, 1, t) * 0.65 + t * 0.35);
  } else if (d < 1.17) {
    h = -2.6 * smooth(1.0, 1.17, d) - 0.25 * (d - 1.0) / 0.17;
  } else if (d < 1.58) {
    h = -2.85 - 0.6 * (fbm(x * 0.03, z * 0.03, 2, I.seed + 2) - 0.5);
  } else if (d < 1.68) {
    h = THREE.MathUtils.lerp(-2.85, -0.9, smooth(1.58, 1.64, d)) - 0.4 * fbm(x * 0.08, z * 0.08, 2, I.seed);
  } else {
    h = THREE.MathUtils.lerp(-0.9, -32, smooth(1.68, 2.0, d));
  }
  // mountain
  const p = I.peak;
  const pd = Math.hypot(x - p.x, z - p.z);
  const ridge = 1 - Math.abs(fbm(x * 0.02 + 3, z * 0.02 + 7, 3, I.seed + 9) * 2 - 1);
  const m = p.h * Math.exp(-(pd * pd) / (p.w * p.w)) * (0.75 + 0.35 * ridge);
  h += m * smooth(0.95, 0.6, d);
  // small dunes / bumps on land
  if (d < 1.0) h += (fbm(x * 0.06, z * 0.06, 3, I.seed + 1) - 0.5) * 1.2 * smooth(0.98, 0.85, d);
  return h;
}

// Flattened beach pad where the plane and hangar sit.
function beachPad(x, z, h) {
  const dx = x - BEACH.x, dz = z - BEACH.z;
  const k = Math.exp(-(dx * dx) / (2 * 26 * 26) - (dz * dz) / (2 * 45 * 45));
  const target = 0.9 - (dx / 30) * 0.9; // gentle slope toward the water (east)
  return THREE.MathUtils.lerp(h, Math.min(Math.max(target, -1.5), 2.6), k * 0.85);
}

export function heightAt(x, z) {
  let h = -32;
  for (const I of ISLANDS) {
    const dx = x - I.x, dz = z - I.z;
    if (dx * dx + dz * dz > (I.r * 2.2) ** 2) continue;
    h = Math.max(h, islandHeight(I, x, z));
  }
  return beachPad(x, z, h);
}

export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 0.6;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  return out.set(-hx, 2 * e, -hz).normalize();
}

// --- terrain meshes --------------------------------------------------------
function terrainMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vTW;
float th(vec2 p){ p = fract(p * vec2(0.1031, 0.1137)); p += dot(p, p.yx + 19.19); return fract(p.x * p.y * 1.7313 + p.x * 0.513); }
float tn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f); return mix(mix(th(i), th(i+vec2(1,0)), u.x), mix(th(i+vec2(0,1)), th(i+vec2(1,1)), u.x), u.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  float tdet = tn(vTW.xz * 1.7) * 0.5 + tn(vTW.xz * 7.0) * 0.3 + tn(vTW.xz * 0.3) * 0.4;
  diffuseColor.rgb *= 0.78 + 0.3 * tdet;
  float wetSand = 1.0 - smoothstep(0.05, 0.9, vTW.y);
  diffuseColor.rgb *= mix(1.0, 0.62, wetSand * step(-1.5, vTW.y));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.35, (1.0 - smoothstep(0.05, 0.6, vTW.y)) * step(-0.5, vTW.y));`);
  };
  m.customProgramCacheKey = () => 'sandbox-terrain';
  return m;
}

function colorFor(h, ny, x, z, out) {
  const sandDry = [0.5, 0.42, 0.3], sandWet = [0.3, 0.25, 0.18], seabed = [0.55, 0.52, 0.4];
  const grass = [0.2, 0.27, 0.1], jungle = [0.07, 0.13, 0.05], rock = [0.24, 0.22, 0.19];
  const n = fbm(x * 0.05, z * 0.05, 2, 77);
  let c;
  if (h < -0.3) c = seabed;
  else if (h < 0.5) c = sandWet.map((v, i) => THREE.MathUtils.lerp(v, sandDry[i], smooth(-0.3, 0.5, h)));
  else if (h < 3.4) c = sandDry;
  else if (h < 6) c = sandDry.map((v, i) => THREE.MathUtils.lerp(v, grass[i], smooth(3.4, 6, h + (n - 0.5) * 3)));
  else c = grass.map((v, i) => THREE.MathUtils.lerp(v, jungle[i], smooth(6, 14, h)));
  const steep = smooth(0.82, 0.6, ny) * smooth(4, 10, h);
  for (let i = 0; i < 3; i++) out[i] = THREE.MathUtils.lerp(c[i], rock[i], steep) * (0.85 + 0.3 * n);
  return out;
}

function buildTerrainPatch(cx, cz, size, cells) {
  const g = new THREE.PlaneGeometry(size, size, cells, cells);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const nrm = new THREE.Vector3();
  const c = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx, z = pos.getZ(i) + cz;
    const h = heightAt(x, z);
    pos.setXYZ(i, x, h, z);
  }
  g.computeVertexNormals();
  for (let i = 0; i < pos.count; i++) {
    nrm.fromBufferAttribute(g.attributes.normal, i);
    colorFor(pos.getY(i), nrm.y, pos.getX(i), pos.getZ(i), c);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

// --- vegetation & rocks ----------------------------------------------------
function palmGeometries() {
  // trunk: slightly curved tapered tube along +Y (height 1), fronds: drooping leaves
  const trunkPts = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; trunkPts.push(new THREE.Vector3(Math.sin(t * 1.2) * 0.12, t, 0)); }
  const trunk = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(trunkPts), 8, 0.022, 6, false);
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i);
    const k = 1.25 - y * 0.45;
    const cx = Math.sin(y * 1.2) * 0.12;
    tp.setX(i, cx + (tp.getX(i) - cx) * k);
    tp.setZ(i, tp.getZ(i) * k);
  }
  trunk.computeVertexNormals();
  // fronds: 9 leaves, each a bent strip with notched width
  const pos = [], idx = [], nrm = [];
  for (let l = 0; l < 9; l++) {
    const a = (l / 9) * Math.PI * 2 + (l % 2) * 0.2;
    const droop = 0.55 + (l % 3) * 0.12;
    const base = pos.length / 3;
    const segs = 8;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const len = 0.62;
      const r = t * len;
      const y = 1.02 + Math.sin(t * Math.PI * 0.45) * 0.12 - t * t * droop * 0.5;
      const w = Math.sin(t * Math.PI) * 0.09 + 0.01;
      const cx = 0.12 * Math.sin(1.2) + Math.cos(a) * r, cz = Math.sin(a) * r;
      const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      pos.push(cx + px, y - w * 0.3, cz + pz, cx - px, y - w * 0.3, cz - pz, cx, y + 0.01, cz);
      nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
      if (s > 0) {
        const p0 = base + (s - 1) * 3, p1 = base + s * 3;
        idx.push(p0, p1, p0 + 2, p1, p1 + 2, p0 + 2, p0 + 1, p0 + 2, p1 + 1, p1 + 1, p0 + 2, p1 + 2);
      }
    }
  }
  const fr = new THREE.BufferGeometry();
  fr.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fr.setIndex(idx);
  fr.computeVertexNormals();
  return { trunk, fronds: fr };
}

export class World {
  constructor(scene, { quality = 'high' } = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'world';
    scene.add(this.group);
    this.colliders = { spheres: [], boxes: [], cylinders: [] }; // static world shapes
    const tmat = terrainMaterial();
    // main island patch (fine) + second island patch
    const main = new THREE.Mesh(buildTerrainPatch(0, 0, 640, quality === 'high' ? 256 : 160), tmat);
    main.receiveShadow = true;
    main.castShadow = false;
    this.group.add(main);
    const second = new THREE.Mesh(buildTerrainPatch(ISLANDS[1].x, ISLANDS[1].z, 300, 100), tmat);
    second.receiveShadow = true;
    this.group.add(second);
    // deep seabed far plane (dark)
    const deep = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2c3a32, roughness: 1 }));
    deep.position.y = -33;
    this.group.add(deep);
    this.terrainMeshes = [main, second];
    this._vegetation(quality);
    this._rocks();
    this.heightTexture = this._heightTexture();
  }

  _vegetation(quality) {
    const { trunk, fronds } = palmGeometries();
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 0.95 });
    const frondMat = new THREE.MeshStandardMaterial({ color: 0x3f6b23, roughness: 0.8, side: THREE.DoubleSide });
    const palms = [];
    const rnd = (i, k) => hash2(i, k, 99);
    // beach line palms around the main island + a few on the second
    for (let i = 0; palms.length < (quality === 'high' ? 260 : 150) && i < 4000; i++) {
      const I = ISLANDS[i % 7 === 0 ? 1 : 0];
      const a = rnd(i, 1) * Math.PI * 2;
      const rr = I.r * (0.55 + rnd(i, 2) * 0.42);
      const x = I.x + Math.cos(a) * rr, z = I.z + Math.sin(a) * rr;
      const h = heightAt(x, z);
      if (h < 1.6 || h > 30) continue;
      // keep the beach pad clear
      if (Math.hypot(x - BEACH.x, z - BEACH.z) < 38) continue;
      if (Math.hypot(x - (BEACH.x - 10), z - (BEACH.z - 55)) < 30) continue;
      palms.push({ x, z, h, s: 8 + rnd(i, 3) * 7, rot: rnd(i, 4) * Math.PI * 2, lean: (rnd(i, 5) - 0.5) * 0.35 });
    }
    // a few palms framing the beach scene (like the reference)
    for (const [dx, dz, s] of [[-38, -12, 13], [-44, 8, 15], [-30, 46, 12], [-52, 30, 14], [-26, -40, 12]]) {
      const x = BEACH.x + dx, z = BEACH.z + dz;
      palms.push({ x, z, h: heightAt(x, z), s, rot: dx * 0.3, lean: 0.12 });
    }
    const tI = new THREE.InstancedMesh(trunk, trunkMat, palms.length);
    const fI = new THREE.InstancedMesh(fronds, frondMat, palms.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    palms.forEach((p, i) => {
      e.set(p.lean, p.rot, p.lean * 0.5);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(p.x, p.h - 0.2, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
      tI.setMatrixAt(i, m);
      fI.setMatrixAt(i, m);
      this.colliders.cylinders.push({ x: p.x, z: p.z, r: 0.28, y0: p.h - 1, y1: p.h + p.s });
    });
    tI.castShadow = true; fI.castShadow = true; fI.receiveShadow = true;
    this.group.add(tI, fI);
    // jungle canopy clumps inland
    const clumpGeo = new THREE.IcosahedronGeometry(1, 2);
    const cp = clumpGeo.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(cp, i);
      v.multiplyScalar(0.8 + vnoise(v.x * 3 + 5, v.z * 3 + v.y * 2, 4) * 0.45);
      cp.setXYZ(i, v.x, v.y * 0.75, v.z);
    }
    clumpGeo.computeVertexNormals();
    const clumpMat = new THREE.MeshStandardMaterial({ color: 0x2d4a1a, roughness: 0.9, flatShading: false });
    const clumps = [];
    for (let i = 0; clumps.length < (quality === 'high' ? 2600 : 1200) && i < 30000; i++) {
      const I = ISLANDS[i % 9 === 0 ? 1 : 0];
      const a = rnd(i, 11) * Math.PI * 2, rr = I.r * Math.sqrt(rnd(i, 12)) * 0.82;
      const x = I.x + Math.cos(a) * rr, z = I.z + Math.sin(a) * rr;
      const h = heightAt(x, z);
      if (h < 4.5) continue;
      const nrm = normalAt(x, z);
      if (nrm.y < 0.62 && rnd(i, 13) > 0.3) continue;
      clumps.push({ x, z, h, s: 3 + rnd(i, 14) * 4.5 });
    }
    const cI = new THREE.InstancedMesh(clumpGeo, clumpMat, clumps.length);
    const col = new THREE.Color();
    clumps.forEach((c, i) => {
      m.compose(new THREE.Vector3(c.x, c.h + c.s * 0.35, c.z), q.identity(), new THREE.Vector3(c.s, c.s * 0.9, c.s));
      cI.setMatrixAt(i, m);
      col.setHSL(0.24 + rnd(i, 15) * 0.06, 0.45, 0.13 + rnd(i, 16) * 0.08);
      cI.setColorAt(i, col);
    });
    cI.castShadow = false; cI.receiveShadow = true;
    this.group.add(cI);
  }

  _rocks() {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      const k = 0.75 + fbm(v.x * 2 + 3, v.z * 2 + v.y * 1.7, 3, 21) * 0.55;
      p.setXYZ(i, v.x * k, v.y * k * 0.7, v.z * k);
    }
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x5d5850, roughness: 0.92 });
    const rocks = [];
    const add = (x, z, s) => { rocks.push({ x, z, s, h: heightAt(x, z) }); };
    // rocks along the shoreline and a reef head
    for (let i = 0; i < 70; i++) {
      const I = ISLANDS[i % 4 === 0 ? 1 : 0];
      const a = hash2(i, 31, 5) * Math.PI * 2;
      const rr = I.r * (0.93 + hash2(i, 32, 5) * 0.2);
      const x = I.x + Math.cos(a) * rr, z = I.z + Math.sin(a) * rr;
      if (Math.hypot(x - BEACH.x, z - BEACH.z) < 70) continue;
      add(x, z, 1.2 + hash2(i, 33, 5) * 3.2);
    }
    add(BEACH.x + 48, BEACH.z + 70, 2.4);
    add(BEACH.x + 20, BEACH.z + 62, 1.6);
    const im = new THREE.InstancedMesh(g, mat, rocks.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    rocks.forEach((r, i) => {
      q.setFromEuler(new THREE.Euler(0, hash2(i, 40, 5) * 6.28, 0));
      m.compose(new THREE.Vector3(r.x, r.h + r.s * 0.15, r.z), q, new THREE.Vector3(r.s, r.s, r.s));
      im.setMatrixAt(i, m);
      this.colliders.spheres.push({ x: r.x, y: r.h + r.s * 0.15, z: r.z, r: r.s * 0.8 });
    });
    im.castShadow = true; im.receiveShadow = true;
    this.group.add(im);
  }

  _heightTexture() {
    // 1024^2 half-float height map over 2400 m centred between both islands
    const N = 512, span = 2400, cx = 440, cz = -310;
    const data = new Uint16Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = cx + (i / (N - 1) - 0.5) * span, z = cz + (j / (N - 1) - 0.5) * span;
      data[j * N + i] = THREE.DataUtils.toHalfFloat(heightAt(x, z));
    }
    const t = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.HalfFloatType);
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    t.userData = { center: new THREE.Vector2(cx, cz), span };
    return t;
  }

  // env.contact against static shapes (spheres, boxes, vertical cylinders)
  contact(p, radius, out) {
    let hit = false, best = 0;
    const n = out.normal || (out.normal = new THREE.Vector3());
    for (const s of this.colliders.spheres) {
      const dx = p.x - s.x, dy = p.y - s.y, dz = p.z - s.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const pen = s.r + radius - d;
      if (pen > best) { best = pen; hit = true; if (d > 1e-6) n.set(dx / d, dy / d, dz / d); else n.set(0, 1, 0); }
    }
    for (const c of this.colliders.cylinders) {
      if (p.y < c.y0 - radius || p.y > c.y1 + radius) continue;
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      const pen = c.r + radius - d;
      if (pen > best) { best = pen; hit = true; n.set(dx / (d || 1), 0, dz / (d || 1)); }
    }
    for (const b of this.colliders.boxes) {
      // oriented box: centre, half extents, rotation about y (world = R(ry) * local)
      const cr = Math.cos(b.ry), sr = Math.sin(b.ry);
      const lx0 = p.x - b.x, lz0 = p.z - b.z;
      const lx = cr * lx0 - sr * lz0, lz = sr * lx0 + cr * lz0, ly = p.y - b.y;
      const qx = Math.max(-b.hx, Math.min(b.hx, lx)), qy = Math.max(-b.hy, Math.min(b.hy, ly)), qz = Math.max(-b.hz, Math.min(b.hz, lz));
      let dx = lx - qx, dy = ly - qy, dz = lz - qz;
      let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let pen;
      if (d > 1e-6) { pen = radius - d; dx /= d; dy /= d; dz /= d; }
      else {
        // inside: push out along the shallowest axis
        const ex = b.hx - Math.abs(lx), ey = b.hy - Math.abs(ly), ez = b.hz - Math.abs(lz);
        if (ex < ey && ex < ez) { pen = ex + radius; dx = Math.sign(lx); dy = 0; dz = 0; }
        else if (ey < ez) { pen = ey + radius; dx = 0; dy = Math.sign(ly); dz = 0; }
        else { pen = ez + radius; dx = 0; dy = 0; dz = Math.sign(lz); }
      }
      if (pen > best) {
        best = pen; hit = true;
        n.set(cr * dx + sr * dz, dy, -sr * dx + cr * dz);
      }
    }
    out.depth = best;
    return hit;
  }

  addBox(x, y, z, hx, hy, hz, ry = 0) { this.colliders.boxes.push({ x, y, z, hx, hy, hz, ry }); }
}
