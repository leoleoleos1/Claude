// Geometry toolkit for the procedural seaplane: a growable vertex builder per
// material group, parametric primitives (grids, tubes, lathes, boxes), an atlas
// shelf packer for the paint UV islands and voxel-based vertex ambient occlusion.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Attribute layouts per material group. position/normal are always present.
//   paint: uv = atlas (island-local metres until packed), uv1 = panel space (m),
//          aBake = (edge, partId, wearBias, ao) - consumed by the texture bake only.
//   hard:  uv in metres, color = albedo, aMat = (roughness, metalness, kind, grime),
//          aWob = (pivot.xyz, group + weight) for the soft-item spring wobble.
//   glass: uv = pane-local 0..1, aGlass = (paneId, crackable, dust, 0).
export const LAYOUTS = {
  paint: { uv: 2, uv1: 2, aBake: 4 },
  hard: { uv: 2, color: 3, aMat: 4, aWob: 4 },
  rig: { uv: 2, color: 3, aMat: 4, aWob: 4, aRig: 1 },
  glass: { uv: 2, aGlass: 4 },
  plain: { uv: 2, aRig: 1 },
};

// Surface kinds understood by the hardware/interior shader (aMat.z).
export const KIND = {
  PAINTED: 0, METAL: 1, RUST: 2, RUBBER: 3, CANVAS: 4, ROPE: 5, LEATHER: 6,
  WOOD: 7, PLASTIC: 8, LAMP: 9, FABRIC: 10, TREAD: 11, CHROME: 12, STRAP: 13,
};

export class GeoBuilder {
  constructor(layout = 'hard') {
    this.layoutName = layout;
    this.layout = LAYOUTS[layout];
    this.position = [];
    this.normal = [];
    this.index = [];
    this.attrs = {};
    this.cur = {};
    for (const k in this.layout) {
      this.attrs[k] = [];
      this.cur[k] = new Array(this.layout[k]).fill(0);
    }
    if (this.attrs.color) this.cur.color = [1, 1, 1];
    if (this.attrs.aMat) this.cur.aMat = [0.6, 0, KIND.PAINTED, 0];
    if (this.attrs.aRig) this.cur.aRig = [0];
    this.island = []; // per-vertex island id (paint layout)
    this.curIsland = -1;
    this.uv1Offset = [0, 0];
    this.curEdge = 0;
    this.occluder = []; // per-triangle: participates in AO voxelisation
    this.curOccluder = true;
    this.noAO = []; // per-vertex: skip AO (constant 1)
    this.curNoAO = false;
    // distant LODs: helpers use fewer segments and plain boxes (set by createContext)
    this.lodLevel = 0;
    this.segScale = 1;
  }

  get vertexCount() { return this.position.length / 3; }
  get triangleCount() { return this.index.length / 3; }

  set(name, ...values) { this.cur[name] = values; return this; }
  setColor(c) {
    if (typeof c === 'number') { const col = new THREE.Color(c); this.cur.color = [col.r, col.g, col.b]; }
    else if (Array.isArray(c)) this.cur.color = c.slice();
    else this.cur.color = [c.r, c.g, c.b];
    return this;
  }
  // roughness, metalness, kind, grime
  setMat(r, m, kind, grime = 0) { this.cur.aMat = [r, m, kind, grime]; return this; }
  setWobble(pivot, group = 0, weight = 0) {
    this.cur.aWob = pivot && group > 0 ? [pivot.x, pivot.y, pivot.z, group + Math.min(Math.max(weight, 0), 0.999)] : [0, 0, 0, 0];
    return this;
  }
  setPart(partId, wearBias = 0) { this.cur.aBake = [0, partId, wearBias, 0]; return this; }
  setRig(index) { this.cur.aRig = [index]; return this; }

  vert(px, py, pz, nx, ny, nz, u = 0, v = 0, uv1) {
    this.position.push(px, py, pz);
    this.normal.push(nx, ny, nz);
    const A = this.attrs;
    if (A.uv) A.uv.push(u, v);
    if (A.uv1) {
      if (uv1) A.uv1.push(uv1[0], uv1[1]);
      else A.uv1.push(u + this.uv1Offset[0], v + this.uv1Offset[1]);
    }
    for (const k in A) {
      if (k === 'uv' || k === 'uv1') continue;
      const src = this.cur[k], arr = A[k], n = this.layout[k];
      for (let i = 0; i < n; i++) arr.push(src[i]);
      if (k === 'aBake') arr[arr.length - 4] = this.curEdge;
    }
    this.island.push(this.curIsland);
    this.noAO.push(this.curNoAO);
    return this.position.length / 3 - 1;
  }

  tri(a, b, c) { this.index.push(a, b, c); this.occluder.push(this.curOccluder); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }

  // Apply a matrix to vertices [start, end).
  transform(start, m, end = this.vertexCount) {
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3();
    const P = this.position, N = this.normal;
    for (let i = start; i < end; i++) {
      v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(m);
      P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
      v.set(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]).applyMatrix3(nm).normalize();
      N[i * 3] = v.x; N[i * 3 + 1] = v.y; N[i * 3 + 2] = v.z;
      if (this.attrs.aWob) {
        const W = this.attrs.aWob;
        if (W[i * 4 + 3] > 0) {
          v.set(W[i * 4], W[i * 4 + 1], W[i * 4 + 2]).applyMatrix4(m);
          W[i * 4] = v.x; W[i * 4 + 1] = v.y; W[i * 4 + 2] = v.z;
        }
      }
    }
    if (m.determinant() < 0) this._flipFrom(start);
    return this;
  }

  translateAll(x, y, z) {
    const P = this.position;
    for (let i = 0; i < P.length; i += 3) { P[i] += x; P[i + 1] += y; P[i + 2] += z; }
    if (this.attrs.aWob) {
      const W = this.attrs.aWob;
      for (let i = 0; i < W.length; i += 4) if (W[i + 3] > 0) { W[i] += x; W[i + 1] += y; W[i + 2] += z; }
    }
  }

  _flipFrom(start) {
    const I = this.index;
    for (let t = 0; t < I.length; t += 3) {
      if (I[t] >= start && I[t + 1] >= start && I[t + 2] >= start) {
        const tmp = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = tmp;
      }
    }
  }

  // Mirror vertices [start,end) across x = 0 into new vertices with fixed winding.
  mirrorX(start, end = this.vertexCount, uv1Shift = null) {
    const base = this.vertexCount;
    const P = this.position, N = this.normal;
    for (let i = start; i < end; i++) {
      P.push(-P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      N.push(-N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
      for (const k in this.attrs) {
        const s = this.layout[k], arr = this.attrs[k];
        for (let j = 0; j < s; j++) {
          let val = arr[i * s + j];
          if (k === 'uv1' && uv1Shift) val += uv1Shift[j];
          if (k === 'aWob' && j === 0) val = -val;
          arr.push(val);
        }
      }
      this.island.push(this.island[i]);
      this.noAO.push(this.noAO[i]);
    }
    const I = this.index;
    const triCount = I.length;
    for (let t = 0; t < triCount; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      if (a >= start && a < end && b >= start && b < end && c >= start && c < end) {
        I.push(a - start + base, c - start + base, b - start + base);
        this.occluder.push(this.occluder[t / 3]);
      }
    }
    return base;
  }

  // Append a three.js BufferGeometry (position/normal/uv) transformed by matrix.
  append(geo, matrix = null, uvScale = [1, 1]) {
    const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
    const start = this.vertexCount;
    for (let i = 0; i < pos.count; i++) {
      this.vert(pos.getX(i), pos.getY(i), pos.getZ(i),
        nrm ? nrm.getX(i) : 0, nrm ? nrm.getY(i) : 1, nrm ? nrm.getZ(i) : 0,
        uv ? uv.getX(i) * uvScale[0] : 0, uv ? uv.getY(i) * uvScale[1] : 0);
    }
    if (geo.index) {
      const ix = geo.index.array;
      for (let t = 0; t < ix.length; t += 3) this.tri(start + ix[t], start + ix[t + 1], start + ix[t + 2]);
    } else {
      for (let t = 0; t < pos.count; t += 3) this.tri(start + t, start + t + 1, start + t + 2);
    }
    if (matrix) this.transform(start, matrix);
    geo.dispose();
    return start;
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.position), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.normal), 3));
    for (const k in this.attrs) {
      if (k === 'aBake') continue; // bake-only, see bakeAttribute()
      g.setAttribute(k === 'uv1' ? 'aPanel' : k, new THREE.BufferAttribute(new Float32Array(this.attrs[k]), this.layout[k]));
    }
    const n = this.vertexCount;
    g.setIndex(new THREE.BufferAttribute(n > 65535 ? new Uint32Array(this.index) : new Uint16Array(this.index), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  bakeAttribute() {
    return this.attrs.aBake ? new THREE.BufferAttribute(new Float32Array(this.attrs.aBake), 4) : null;
  }
}

// Reorder a builder's triangles into runs: [rest][tests[0]][tests[1]]... where a
// triangle joins the first test that accepts its centroid. Vertices are not
// touched, so the runs can be hidden by trimming the index range or drawn on
// their own by another geometry sharing the vertex buffers. Returns
// { rest, runs: [{ start, count, box }] } in index units (box = vertex bounds).
const _pv = new THREE.Vector3();
export function partitionTriangles(b, tests) {
  const I = b.index, O = b.occluder, P = b.position;
  const bins = [[]];
  for (let k = 0; k < tests.length; k++) bins.push([]);
  for (let t = 0; t < I.length / 3; t++) {
    const a = I[t * 3] * 3, c = I[t * 3 + 1] * 3, d = I[t * 3 + 2] * 3;
    const x = (P[a] + P[c] + P[d]) / 3, y = (P[a + 1] + P[c + 1] + P[d + 1]) / 3, z = (P[a + 2] + P[c + 2] + P[d + 2]) / 3;
    let k = 0;
    for (let j = 0; j < tests.length; j++) if (tests[j](x, y, z)) { k = j + 1; break; }
    bins[k].push(t);
  }
  const NI = [], NO = [], runs = [];
  for (let k = 0; k < bins.length; k++) {
    const start = NI.length, box = new THREE.Box3();
    for (const t of bins[k]) {
      for (let v = 0; v < 3; v++) {
        const vi = I[t * 3 + v];
        NI.push(vi);
        if (k) box.expandByPoint(_pv.fromArray(P, vi * 3));
      }
      NO.push(O[t]);
    }
    if (k) runs.push({ start, count: NI.length - start, box });
  }
  b.index = NI;
  b.occluder = NO;
  return { rest: bins[0].length * 3, runs };
}

// ---------------------------------------------------------------------------
// Parametric grid surface. fn(s, t, out, i, j) fills out.p and optionally
// out.u/out.v (uv in metres), out.uv1 ([u,v]) and out.edge (wear edge factor).
// Normals come from central differences of the grid.
// opts: { closedT, closedS, flip, skip(i,j), sValues, tValues }
const _gp = { p: new THREE.Vector3(), u: 0, v: 0, uv1: null, edge: 0 };
export function grid(b, ns, nt, fn, opts = {}) {
  const sArr = opts.sValues || null, tArr = opts.tValues || null;
  if (sArr) ns = sArr.length - 1;
  if (tArr) nt = tArr.length - 1;
  const cols = ns + 1, rows = nt + 1;
  const P = new Float32Array(cols * rows * 3);
  const N = new Float32Array(cols * rows * 3);
  const UV = new Float32Array(cols * rows * 2);
  const UV1 = new Float32Array(cols * rows * 2);
  const E = new Float32Array(cols * rows);
  let hasUV1 = false;
  for (let i = 0; i < cols; i++) {
    const s = sArr ? sArr[i] : i / ns;
    for (let j = 0; j < rows; j++) {
      const t = tArr ? tArr[j] : j / nt;
      _gp.u = s; _gp.v = t; _gp.uv1 = null; _gp.edge = 0;
      fn(s, t, _gp, i, j);
      const k = i * rows + j;
      P[k * 3] = _gp.p.x; P[k * 3 + 1] = _gp.p.y; P[k * 3 + 2] = _gp.p.z;
      UV[k * 2] = _gp.u; UV[k * 2 + 1] = _gp.v;
      if (_gp.uv1) { hasUV1 = true; UV1[k * 2] = _gp.uv1[0]; UV1[k * 2 + 1] = _gp.uv1[1]; }
      E[k] = _gp.edge;
    }
  }
  gridNormals(P, N, cols, rows, opts);
  const start = b.vertexCount;
  const tmp = [0, 0];
  for (let k = 0; k < cols * rows; k++) {
    b.curEdge = E[k];
    if (hasUV1) { tmp[0] = UV1[k * 2]; tmp[1] = UV1[k * 2 + 1]; }
    b.vert(P[k * 3], P[k * 3 + 1], P[k * 3 + 2], N[k * 3], N[k * 3 + 1], N[k * 3 + 2], UV[k * 2], UV[k * 2 + 1], hasUV1 ? tmp : undefined);
  }
  b.curEdge = 0;
  for (let i = 0; i < ns; i++) {
    for (let j = 0; j < nt; j++) {
      if (opts.skip && opts.skip(i, j)) continue;
      const a = start + i * rows + j, bb = start + (i + 1) * rows + j;
      const c = start + (i + 1) * rows + j + 1, d = start + i * rows + j + 1;
      if (opts.flip) b.quad(a, d, c, bb); else b.quad(a, bb, c, d);
    }
  }
  return { start, cols, rows };
}

function gridNormals(P, N, cols, rows, opts) {
  const du = new THREE.Vector3(), dv = new THREE.Vector3(), n = new THREE.Vector3();
  const pa = new THREE.Vector3(), pb = new THREE.Vector3();
  const get = (i, j, out) => { const k = i * rows + j; return out.set(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]); };
  const idx = (i, d, count, closed) => {
    let r = i + d;
    if (closed) { if (r < 0) r += count - 1; if (r >= count) r -= count - 1; } else r = Math.max(0, Math.min(count - 1, r));
    return r;
  };
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      for (let reach = 1; reach <= 3; reach++) {
        get(idx(i, reach, cols, opts.closedS), j, pb); get(idx(i, -reach, cols, opts.closedS), j, pa); du.subVectors(pb, pa);
        if (du.lengthSq() > 1e-14) break;
      }
      for (let reach = 1; reach <= 3; reach++) {
        get(i, idx(j, reach, rows, opts.closedT), pb); get(i, idx(j, -reach, rows, opts.closedT), pa); dv.subVectors(pb, pa);
        if (dv.lengthSq() > 1e-14) break;
      }
      n.crossVectors(du, dv);
      if (opts.flip) n.negate();
      if (n.lengthSq() < 1e-18) n.set(0, 1, 0); else n.normalize();
      const k = i * rows + j;
      N[k * 3] = n.x; N[k * 3 + 1] = n.y; N[k * 3 + 2] = n.z;
    }
  }
}

// ---------------------------------------------------------------------------
// Tube along a polyline with parallel-transport frames.
// radius: number | fn(f, i) with f = 0..1 along the path.
// opts: { sides, caps, up (profile orientation hint), rx, ry (profile scale), phase }
export function tube(b, pts, radius, opts = {}) {
  const sides = Math.max(3, Math.round((opts.sides || 8) * (b.segScale || 1)));
  const n = pts.length;
  const T = [];
  for (let i = 0; i < n; i++) {
    const t = new THREE.Vector3();
    if (i === 0) t.subVectors(pts[1], pts[0]);
    else if (i === n - 1) t.subVectors(pts[n - 1], pts[n - 2]);
    else t.subVectors(pts[i + 1], pts[i - 1]);
    T.push(t.normalize());
  }
  const up = opts.up ? opts.up.clone().normalize() : new THREE.Vector3(0, 1, 0);
  let side = new THREE.Vector3().crossVectors(T[0], up);
  if (side.lengthSq() < 1e-6) side.crossVectors(T[0], new THREE.Vector3(1, 0, 0));
  side.normalize();
  const S = [], B = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const axis = new THREE.Vector3().crossVectors(T[i - 1], T[i]);
      const len = axis.length();
      side = side.clone();
      if (len > 1e-7) side.applyAxisAngle(axis.divideScalar(len), Math.acos(THREE.MathUtils.clamp(T[i - 1].dot(T[i]), -1, 1)));
    }
    S.push(side);
    B.push(new THREE.Vector3().crossVectors(T[i], side).normalize());
  }
  const rx = opts.rx || 1, ry = opts.ry || 1;
  const start = b.vertexCount;
  const lens = [0];
  for (let i = 1; i < n; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = Math.max(lens[n - 1], 1e-9);
  const p = new THREE.Vector3(), nn = new THREE.Vector3();
  const rad = (i) => (typeof radius === 'function' ? radius(lens[i] / total, i) : radius);
  for (let i = 0; i < n; i++) {
    const r = rad(i);
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2 + (opts.phase || 0);
      const ca = Math.cos(a), sa = Math.sin(a);
      p.copy(pts[i]).addScaledVector(S[i], ca * r * rx).addScaledVector(B[i], sa * r * ry);
      nn.copy(S[i]).multiplyScalar(ca / rx).addScaledVector(B[i], sa / ry).normalize();
      b.vert(p.x, p.y, p.z, nn.x, nn.y, nn.z, lens[i] + (opts.u0 || 0), (k / sides) * (opts.vLen !== undefined ? opts.vLen : 2 * Math.PI * r));
    }
  }
  const ring = sides + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < sides; k++) {
      const a = start + i * ring + k, bb = start + (i + 1) * ring + k;
      b.quad(a, a + 1, bb + 1, bb);
    }
  }
  if (opts.caps) {
    for (const end of [0, n - 1]) {
      const r = rad(end);
      const dir = end === 0 ? T[0].clone().negate() : T[n - 1].clone();
      const c = b.vert(pts[end].x, pts[end].y, pts[end].z, dir.x, dir.y, dir.z, 0, 0);
      const first = b.vertexCount;
      for (let k = 0; k <= sides; k++) {
        const a = (k / sides) * Math.PI * 2 + (opts.phase || 0);
        p.copy(pts[end]).addScaledVector(S[end], Math.cos(a) * r * rx).addScaledVector(B[end], Math.sin(a) * r * ry);
        b.vert(p.x, p.y, p.z, dir.x, dir.y, dir.z, Math.cos(a) * r, Math.sin(a) * r);
      }
      for (let k = 0; k < sides; k++) {
        if (end === 0) b.tri(c, first + k + 1, first + k);
        else b.tri(c, first + k, first + k + 1);
      }
    }
  }
  return start;
}

// Lathe around local +Z (profile: [[r, z], ...]) then transformed by matrix.
// Normals point away from the axis for profiles going +z with r >= 0.
export function lathe(b, profile, segments, matrix, opts = {}) {
  segments = Math.max(3, Math.round(segments * (b.segScale || 1)));
  const start = b.vertexCount;
  const n = profile.length;
  const a0 = opts.a0 || 0, a1 = opts.a1 !== undefined ? opts.a1 : Math.PI * 2;
  const pn = [];
  for (let i = 0; i < n; i++) {
    const p0 = profile[Math.max(0, i - 1)], p1 = profile[Math.min(n - 1, i + 1)];
    const dr = p1[0] - p0[0], dz = p1[1] - p0[1];
    const l = Math.hypot(dr, dz) || 1;
    const sgn = opts.flip ? -1 : 1;
    pn.push([(sgn * dz) / l, (-sgn * dr) / l]);
  }
  const lens = [0];
  for (let i = 1; i < n; i++) lens.push(lens[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
  let maxR = 0;
  for (const q of profile) maxR = Math.max(maxR, q[0]);
  for (let i = 0; i < n; i++) {
    const r = profile[i][0], z = profile[i][1];
    for (let k = 0; k <= segments; k++) {
      const a = a0 + (a1 - a0) * (k / segments);
      const ca = Math.cos(a), sa = Math.sin(a);
      b.vert(r * ca, r * sa, z, pn[i][0] * ca, pn[i][0] * sa, pn[i][1], lens[i], (k / segments) * (a1 - a0) * maxR);
    }
  }
  const ring = segments + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < segments; k++) {
      const a = start + i * ring + k, c = start + (i + 1) * ring + k;
      if (opts.flip) b.quad(a, c, c + 1, a + 1); else b.quad(a, a + 1, c + 1, c);
    }
  }
  if (matrix) b.transform(start, matrix);
  return start;
}

// Axis-aligned box centred at the origin, uvs in metres, transformed by matrix.
const BOX_FACES = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];
export function box(b, sx, sy, sz, matrix, skip = 0) {
  const start = b.vertexCount;
  const h = [sx / 2, sy / 2, sz / 2];
  const ax = (v) => (v[0] !== 0 ? 0 : v[1] !== 0 ? 1 : 2);
  for (let f = 0; f < 6; f++) {
    if (skip & (1 << f)) continue;
    const [n, u, v] = BOX_FACES[f];
    const hn = h[ax(n)], hu = h[ax(u)], hv = h[ax(v)];
    const base = b.vertexCount;
    const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [su, sv] of cs) {
      b.vert(n[0] * hn + u[0] * su * hu + v[0] * sv * hv,
        n[1] * hn + u[1] * su * hu + v[1] * sv * hv,
        n[2] * hn + u[2] * su * hu + v[2] * sv * hv,
        n[0], n[1], n[2], (su + 1) * hu, (sv + 1) * hv);
    }
    b.quad(base, base + 1, base + 2, base + 3);
  }
  if (matrix) b.transform(start, matrix);
  return start;
}

export function roundedBox(b, sx, sy, sz, r, matrix, seg = 2) {
  if (b.lodLevel >= 1) return box(b, sx, sy, sz, matrix);
  const g = new RoundedBoxGeometry(sx, sy, sz, seg, Math.min(r, sx / 2 - 1e-4, sy / 2 - 1e-4, sz / 2 - 1e-4));
  return b.append(g, matrix, [Math.max(sx, sz), sy]);
}

// Flat polygon (with optional holes) in the XY plane, facing +Z.
export function polygon(b, pts2, matrix, holes = []) {
  const start = b.vertexCount;
  const contour = pts2.map((p) => new THREE.Vector2(p[0], p[1]));
  const hs = holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
  if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
  for (const h of hs) if (!THREE.ShapeUtils.isClockWise(h)) h.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
  const all = contour.concat(...hs);
  for (const v of all) b.vert(v.x, v.y, 0, 0, 0, 1, v.x, v.y);
  for (const t of tris) {
    const A = all[t[0]], B = all[t[1]], C = all[t[2]];
    const area = (B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y);
    if (area >= 0) b.tri(start + t[0], start + t[1], start + t[2]);
    else b.tri(start + t[0], start + t[2], start + t[1]);
  }
  if (matrix) b.transform(start, matrix);
  return start;
}

// Extruded polygon (side walls + caps), depth along +Z from 0 to depth.
export function extrude(b, pts2, depth, matrix) {
  const start = b.vertexCount;
  const shape = new THREE.Shape(pts2.map((p) => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
  b.append(g.toNonIndexed(), matrix);
  g.dispose();
  return start;
}

// Matrix helpers -------------------------------------------------------------
const _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
export function mat(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, order = 'XYZ') {
  _e.set(rx, ry, rz, order);
  _q.setFromEuler(_e);
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, _s);
}

// Matrix that maps local +Z onto the segment a->b (origin at a); length in .len.
export function matAlong(a, bPt, roll = 0, upHint = null) {
  const dir = new THREE.Vector3().subVectors(bPt, a);
  const len = dir.length();
  dir.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  if (upHint) {
    // rotate about dir so local +Y points as close as possible to upHint
    const y = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const target = upHint.clone().addScaledVector(dir, -upHint.dot(dir)).normalize();
    let ang = Math.acos(THREE.MathUtils.clamp(y.dot(target), -1, 1));
    if (new THREE.Vector3().crossVectors(y, target).dot(dir) < 0) ang = -ang;
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(dir, ang));
  }
  if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
  const m = new THREE.Matrix4().compose(a.clone(), q, new THREE.Vector3(1, 1, 1));
  m.len = len;
  return m;
}

export function v3(x, y, z) { return new THREE.Vector3(x, y, z); }

// Deterministic RNG (mulberry32).
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth monotone interpolation through [[x, y], ...] (Fritsch-Carlson).
export function curve(table) {
  const n = table.length;
  const xs = table.map((p) => p[0]), ys = table.map((p) => p[1]);
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], bb = m[i + 1] / d[i], h = a * a + bb * bb;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * bb * d[i]; }
  }
  return function (x) {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// ---------------------------------------------------------------------------
// Atlas shelf packer. islands: [{ w, h, density }] in metres. Returns per island
// { x, y, sx, sy } so that atlasUV = (x + (u-u0)*sx, y + (v-v0)*sy).
export function packAtlas(islands, atlasPx = 2048, gutterPx = 8) {
  const tryScale = (scale) => {
    const items = islands.map((is, i) => ({
      i, w: Math.ceil(is.w * scale * (is.density || 1)) + gutterPx * 2,
      h: Math.ceil(is.h * scale * (is.density || 1)) + gutterPx * 2,
    }));
    items.sort((a, c) => c.h - a.h || c.w - a.w);
    let x = 0, y = 0, rowH = 0;
    const out = [];
    for (const it of items) {
      if (it.w > atlasPx) return null;
      if (x + it.w > atlasPx) { x = 0; y += rowH; rowH = 0; }
      if (y + it.h > atlasPx) return null;
      out[it.i] = { px: x + gutterPx, py: y + gutterPx, pw: it.w - gutterPx * 2, ph: it.h - gutterPx * 2 };
      x += it.w; rowH = Math.max(rowH, it.h);
    }
    return out;
  };
  let lo = 1, hi = 4000, best = null, bestScale = 1;
  for (let k = 0; k < 32; k++) {
    const mid = (lo + hi) / 2;
    const r = tryScale(mid);
    if (r) { best = r; bestScale = mid; lo = mid; } else hi = mid;
  }
  return {
    scale: bestScale,
    rects: best.map((r, i) => ({
      x: r.px / atlasPx, y: r.py / atlasPx,
      sx: r.pw / atlasPx / islands[i].w, sy: r.ph / atlasPx / islands[i].h,
    })),
  };
}

export function applyAtlas(b, islands, rects) {
  const uv = b.attrs.uv;
  for (let v = 0; v < b.island.length; v++) {
    const id = b.island[v];
    if (id < 0) continue;
    const is = islands[id], r = rects[id];
    const u = THREE.MathUtils.clamp(uv[v * 2] - is.u0, 0, is.w);
    const w = THREE.MathUtils.clamp(uv[v * 2 + 1] - is.v0, 0, is.h);
    uv[v * 2] = r.x + u * r.sx;
    uv[v * 2 + 1] = r.y + w * r.sy;
  }
}

// ---------------------------------------------------------------------------
// Voxel ambient occlusion over several builders.
// entries: [{ b, occlude, receive, apply(b, vertexIndex, ao) }]
export function computeVoxelAO(entries, opts = {}) {
  const cell = opts.cell || 0.09;
  const bounds = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const e of entries) {
    const P = e.b.position;
    for (let i = 0; i < P.length; i += 3) bounds.expandByPoint(v.set(P[i], P[i + 1], P[i + 2]));
  }
  bounds.expandByScalar(cell * 3);
  const size = bounds.getSize(new THREE.Vector3());
  const nx = Math.ceil(size.x / cell), ny = Math.ceil(size.y / cell), nz = Math.ceil(size.z / cell);
  const vox = new Uint8Array(nx * ny * nz);
  const ox = bounds.min.x, oy = bounds.min.y, oz = bounds.min.z;
  const inv = 1 / cell;
  for (const e of entries) {
    if (!e.occlude) continue;
    const P = e.b.position, I = e.b.index, occ = e.b.occluder;
    for (let t = 0; t < I.length; t += 3) {
      if (occ[t / 3] === false) continue;
      const a = I[t] * 3, bb = I[t + 1] * 3, c = I[t + 2] * 3;
      const ax = P[a], ay = P[a + 1], az = P[a + 2];
      const bx = P[bb], by = P[bb + 1], bz = P[bb + 2];
      const cx = P[c], cy = P[c + 1], cz = P[c + 2];
      const lmax = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - ax, cy - ay, cz - az), Math.hypot(cx - bx, cy - by, cz - bz));
      const steps = Math.max(1, Math.ceil(lmax / (cell * 0.7)));
      for (let i = 0; i <= steps; i++) {
        for (let j = 0; j <= steps - i; j++) {
          const u = i / steps, w = j / steps, s = 1 - u - w;
          const ix = ((ax * s + bx * u + cx * w - ox) * inv) | 0;
          const iy = ((ay * s + by * u + cy * w - oy) * inv) | 0;
          const iz = ((az * s + bz * u + cz * w - oz) * inv) | 0;
          if (ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz) vox[(iz * ny + iy) * nx + ix] = 1;
        }
      }
    }
  }
  const nd = opts.dirs || 14;
  const dirs = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < nd; i++) {
    const y = 1 - (i + 0.5) / nd;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    const d = [Math.cos(th) * r, y * 0.8 + 0.2, Math.sin(th) * r];
    const l = Math.hypot(d[0], d[1], d[2]);
    dirs.push([d[0] / l, d[1] / l, d[2] / l]);
  }
  const maxDist = opts.maxDist || 1.4;
  const steps = Math.ceil(maxDist / cell);
  const tx = new THREE.Vector3(), tz = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (const e of entries) {
    if (!e.receive) continue;
    const P = e.b.position, N = e.b.normal;
    const nv = P.length / 3;
    for (let vi = 0; vi < nv; vi++) {
      if (e.b.noAO[vi]) { e.apply(e.b, vi, 1); continue; }
      nrm.set(N[vi * 3], N[vi * 3 + 1], N[vi * 3 + 2]);
      if (Math.abs(nrm.y) < 0.9) tx.set(0, 1, 0).cross(nrm).normalize(); else tx.set(1, 0, 0).cross(nrm).normalize();
      tz.crossVectors(nrm, tx);
      const off = cell * 1.6;
      const px = P[vi * 3] + nrm.x * off, py = P[vi * 3 + 1] + nrm.y * off, pz = P[vi * 3 + 2] + nrm.z * off;
      let occl = 0, wsum = 0;
      for (let di = 0; di < nd; di++) {
        const d = dirs[di];
        const dx = tx.x * d[0] + nrm.x * d[1] + tz.x * d[2];
        const dy = tx.y * d[0] + nrm.y * d[1] + tz.y * d[2];
        const dz = tx.z * d[0] + nrm.z * d[1] + tz.z * d[2];
        const w = d[1];
        wsum += w;
        for (let s = 1; s <= steps; s++) {
          const dist = s * cell;
          const ix = ((px + dx * dist - ox) * inv) | 0, iy = ((py + dy * dist - oy) * inv) | 0, iz = ((pz + dz * dist - oz) * inv) | 0;
          if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) break;
          if (vox[(iz * ny + iy) * nx + ix]) { occl += w * (1 - (dist / maxDist) * 0.7); break; }
        }
      }
      e.apply(e.b, vi, 1 - occl / wsum);
    }
  }
}
