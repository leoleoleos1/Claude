// External cargo: roof rack with duffels, jerrycan and radio case, bags strapped
// to the wing struts / under the wing / along the rear fuselage, antennas and
// lashings. Soft items carry spring-wobble attributes (pivot, group, weight).
import * as THREE from 'three';
import { DIM, fuselageSection } from './dims.js';
import { grid, tube, lathe, box, roundedBox, mat, matAlong, rng, v3, KIND } from './geom.js';
import { wingPoint, sForC } from './wing.js';

// Wobble groups (shared with the runtime springs in the materials module).
export const WOB = { RACK: 1, STRUT_R: 2, STRUT_L: 3, UNDERWING: 4, SIDEBAGS: 5, ANTENNA: 6, ROPES: 7 };

const OLIVES = [0x4d5232, 0x575a36, 0x44482c, 0x5d5a3a, 0x4a4f35];
const KHAKI = [0x6b6c4a, 0x75744f, 0x63664a, 0x6e6a48];

// Assign wobble attributes to vertices [start, end) relative to a pivot.
function wobble(b, start, pivot, group, reach) {
  const W = b.attrs.aWob, P = b.position;
  for (let v = start; v < b.vertexCount; v++) {
    const d = Math.hypot(P[v * 3] - pivot.x, P[v * 3 + 1] - pivot.y, P[v * 3 + 2] - pivot.z);
    const w = Math.min(d / reach, 0.999);
    W[v * 4] = pivot.x; W[v * 4 + 1] = pivot.y; W[v * 4 + 2] = pivot.z; W[v * 4 + 3] = group + w;
  }
}

// Canvas duffel along local Z (length L, radius r) with wrinkles and two straps.
function duffel(b, m, L, r, color, rand, lod, strapColor = 0x2e2f22) {
  const start = b.vertexCount;
  const prof = [];
  const n = lod === 0 ? 14 : 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n; // 0..1 along length
    const z = -L / 2 + t * L;
    const endK = Math.min(t, 1 - t) / 0.16;
    const rr = r * (endK >= 1 ? 1 : Math.sqrt(Math.max(1 - (1 - endK) ** 2, 0)) * 0.92 + 0.08 * endK) * (1 + 0.04 * Math.sin(t * 9.1 + rand() * 3));
    prof.push([Math.max(rr, 0.004), z]);
  }
  b.setColor(color).setMat(0.92, 0, KIND.CANVAS, 0.45 + rand() * 0.3);
  lathe(b, prof, lod === 0 ? 14 : 7, null);
  // wrinkles + gravity sag (flatten the underside)
  const P = b.position, N = b.normal;
  const ph = rand() * 10;
  for (let v = start; v < b.vertexCount; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const a = Math.atan2(y, x);
    const w = 0.012 * Math.sin(a * 5 + z * 23 + ph) * Math.sin(z * 7.3 + ph) + 0.006 * Math.sin(a * 11 + z * 41);
    P[v * 3] += N[v * 3] * w; P[v * 3 + 1] += N[v * 3 + 1] * w; P[v * 3 + 2] += N[v * 3 + 2] * w;
    if (y < 0) P[v * 3 + 1] *= 0.72;
  }
  // straps (flat bands)
  b.setColor(strapColor).setMat(0.85, 0, KIND.STRAP, 0.5);
  for (const zf of [-0.28, 0.28]) {
    const z = zf * L;
    const pts = [];
    for (let k = 0; k <= 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      pts.push(v3(Math.cos(a) * r * 1.03, Math.sin(a) * r * (Math.sin(a) < 0 ? 0.74 : 1.03), z));
    }
    tube(b, pts, 0.02, { sides: 4, rx: 0.15, ry: 1, up: v3(0, 0, 1) });
  }
  // drawstring knot at one end
  b.setColor(0x2a281c).setMat(0.9, 0, KIND.ROPE, 0.5);
  tube(b, [v3(0, 0, L / 2 - 0.01), v3(0.02, -0.03, L / 2 + 0.03), v3(0.03, -0.09, L / 2 + 0.04)], 0.007, { sides: 4 });
  b.transform(start, m);
  return start;
}

// Soft canvas pouch (rounded superellipsoid with folds, sag and a bulging face),
// lid flap and buckle straps; centred, local axes (x width, y height, z depth).
const sgnPow = (a, e) => Math.sign(a) * Math.abs(a) ** e;
function pouch(b, m, sx, sy, sz, color, rand, lod) {
  const start = b.vertexCount;
  b.setColor(color).setMat(0.93, 0, KIND.CANVAS, 0.5 + rand() * 0.3);
  const ns = lod === 0 ? 18 : 8, nt = lod === 0 ? 10 : 5;
  const ph = rand() * 10, ph2 = rand() * 10;
  const per = 2 * (sx + sz);
  const g = grid(b, ns, nt, (s, t, out) => {
    const u = s * Math.PI * 2, v = (t - 0.5) * Math.PI;
    const cv = Math.cos(v), sv = Math.sin(v);
    let x = (sx / 2) * sgnPow(cv, 0.42) * sgnPow(Math.cos(u), 0.32);
    let y = (sy / 2) * sgnPow(sv, 0.42);
    let z = (sz / 2) * sgnPow(cv, 0.42) * sgnPow(Math.sin(u), 0.32);
    const ux = (2 * x) / sx, uy = (2 * y) / sy;
    z *= 1 + 0.16 * (1 - ux * ux) * (1 - uy * uy * 0.5); // stuffed: faces bulge
    y -= 0.05 * sy * (1 - ux * ux) * Math.max(-uy, 0); // contents sag to the bottom
    // folds and creases across the faces
    const w = (0.008 * Math.sin(u * 6 + v * 3 + ph) * Math.sin(v * 5 + ph2) + 0.004 * Math.sin(u * 13 + v * 9 + ph2)) * cv;
    const l = Math.hypot(x, y, z) || 1;
    out.p.set(x + (x / l) * w, y + (y / l) * w, z + (z / l) * w);
    out.u = s * per; out.v = t * sy * 1.6;
  }, { closedS: true, flip: true }); // (s, t) runs clockwise seen from outside
  // poles: the latitude rows collapse to a point
  const N = b.normal;
  for (let i = 0; i < g.cols; i++) {
    const bot = g.start + i * g.rows, top = bot + g.rows - 1;
    N[bot * 3] = 0; N[bot * 3 + 1] = -1; N[bot * 3 + 2] = 0;
    N[top * 3] = 0; N[top * 3 + 1] = 1; N[top * 3 + 2] = 0;
  }
  // lid flap over the top front
  const seg = lod === 0 ? 2 : 1;
  b.setColor(new THREE.Color(color).multiplyScalar(0.9)).setMat(0.93, 0, KIND.CANVAS, 0.6);
  roundedBox(b, sx * 0.98, sy * 0.3, sz * 0.5, 0.025, mat(0, sy * 0.33, sz * 0.3, -0.12, 0, 0), seg);
  // straps + buckles
  b.setColor(0x2b2c20).setMat(0.85, 0, KIND.STRAP, 0.5);
  for (const fx of [-0.25, 0.25]) box(b, 0.035, sy * 0.66, 0.006, mat(fx * sx, sy * 0.1, sz * 0.6));
  b.setColor(0x6e6a60).setMat(0.4, 1, KIND.METAL, 0.4);
  for (const fx of [-0.25, 0.25]) box(b, 0.045, 0.03, 0.01, mat(fx * sx, -sy * 0.14, sz * 0.61));
  b.transform(start, m);
  return start;
}

// Jerrycan (local: x width 0.17, y height 0.47, z length 0.34).
function jerrycan(b, m, color, lod) {
  const start = b.vertexCount;
  b.setColor(color).setMat(0.55, 0.3, KIND.PAINTED, 0.6);
  roundedBox(b, 0.17, 0.44, 0.34, 0.02, mat(0, 0, 0), lod === 0 ? 2 : 1);
  // X pressing on both sides
  const c2 = new THREE.Color(color).multiplyScalar(0.85);
  b.setColor(c2).setMat(0.6, 0.3, KIND.PAINTED, 0.7);
  for (const sx of [-1, 1]) for (const a of [0.9, -0.9]) box(b, 0.008, 0.04, 0.42, mat(sx * 0.087, -0.02, 0, a, 0, 0));
  // handles
  b.setColor(color).setMat(0.55, 0.3, KIND.PAINTED, 0.6);
  for (const z of [-0.09, 0, 0.09]) tube(b, [v3(0, 0.22, z - 0.03), v3(0, 0.27, z - 0.025), v3(0, 0.27, z + 0.025), v3(0, 0.22, z + 0.03)], 0.009, { sides: 5 });
  // spout
  b.setColor(0x5a5650).setMat(0.4, 0.9, KIND.METAL, 0.5);
  lathe(b, [[0.001, 0.06], [0.026, 0.06], [0.028, 0.0], [0.02, -0.01]], 10, mat(0, 0.25, 0.12, -Math.PI / 2 - 0.4, 0, 0));
  b.transform(start, m);
  return start;
}

export function buildCargo(ctx) {
  const { hard, lod } = ctx;
  const anchors = {};
  const rand = rng(ctx.seed * 101 + 7);
  if (lod >= 2) {
    // single lump on the roof for the far silhouette
    hard.setColor(0x4a4e31).setMat(0.9, 0, KIND.CANVAS, 0.5);
    roundedBox(hard, 1.1, 0.45, 1.55, 0.14, mat(0, 3.9, 1.6), 1);
    return { anchors };
  }
  // -------- roof rack --------
  const rackY = 3.7;
  const z0 = 0.84, z1 = 2.42, xr = 0.56;
  hard.setColor(0x2b2b27).setMat(0.55, 0.7, KIND.PAINTED, 0.7);
  const rails = [];
  for (const sx of [-1, 1]) rails.push([v3(sx * xr, rackY, z0), v3(sx * xr, rackY, z1)]);
  for (const z of [z0, 1.36, 1.86, z1]) rails.push([v3(-xr, rackY, z), v3(xr, rackY, z)]);
  for (const sx of [-1, 1]) rails.push([v3(sx * xr, rackY, z0), v3(sx * xr, rackY + 0.09, z0 + 0.1), v3(sx * xr, rackY + 0.09, z1 - 0.1), v3(sx * xr, rackY, z1)]);
  rails.push([v3(-xr, rackY, z0), v3(-xr, rackY + 0.09, z0 + 0.1), v3(xr, rackY + 0.09, z0 + 0.1), v3(xr, rackY, z0)]);
  for (const r of rails) tube(hard, r, 0.016, { sides: 6 });
  // legs down to the wing / fuselage top
  for (const sx of [-1, 1]) {
    for (const z of [z0 + 0.04, 1.86, z1 - 0.04]) {
      let yb;
      if (z < DIM.wing.leZ + DIM.wing.chord) {
        const c = (z - DIM.wing.leZ) / DIM.wing.chord;
        yb = wingPoint(sx * xr, sForC(Math.min(Math.max(c, 0.02), 0.98), 1), new THREE.Vector3()).y;
      } else yb = fuselageSection(z).yt;
      tube(hard, [v3(sx * xr, rackY, z), v3(sx * xr * 0.97, yb + 0.01, z)], 0.014, { sides: 6 });
      box(hard, 0.07, 0.012, 0.07, mat(sx * xr * 0.97, yb + 0.006, z));
    }
  }
  // bags on the rack
  const bags = [
    { x: -0.29, z: 1.66, L: 1.02, r: 0.21 },
    { x: 0.11, z: 1.55, L: 1.12, r: 0.22 },
    { x: 0.42, z: 1.45, L: 0.78, r: 0.15 },
  ];
  bags.forEach((bg, i) => {
    const m = mat(bg.x, rackY + bg.r * 0.78 + 0.016, bg.z, 0, (rand() - 0.5) * 0.12, 0);
    const st = duffel(hard, m, bg.L, bg.r, OLIVES[i % OLIVES.length], rand, lod);
    wobble(hard, st, v3(bg.x, rackY, bg.z), WOB.RACK, 0.9);
  });
  // second layer duffel lying across
  {
    const m = mat(-0.05, rackY + 0.47, 1.98, 0, Math.PI / 2 + 0.08, 0.04);
    const st = duffel(hard, m, 0.92, 0.16, OLIVES[3], rand, lod);
    wobble(hard, st, v3(0, rackY, 1.95), WOB.RACK, 0.7);
  }
  // red jerrycan at the rear right, standing
  jerrycan(hard, mat(0.36, rackY + 0.24, 2.2, 0, 0.12, 0), 0x9e1d16, lod);
  // radio case at the front left with antennas
  {
    const c = v3(-0.3, rackY + 0.2, 1.04);
    hard.setColor(0xb3afa2).setMat(0.5, 0.6, KIND.PAINTED, 0.75);
    roundedBox(hard, 0.42, 0.38, 0.34, 0.03, mat(c.x, c.y, c.z, 0, -0.08, 0), lod === 0 ? 2 : 1);
    hard.setColor(0x3b3a35).setMat(0.4, 0.8, KIND.METAL, 0.5);
    for (const sx of [-1, 1]) box(hard, 0.03, 0.05, 0.02, mat(c.x + sx * 0.12, c.y + 0.07, c.z - 0.175, 0, -0.08, 0));
    tube(hard, [v3(c.x - 0.09, c.y + 0.19, c.z), v3(c.x - 0.09, c.y + 0.25, c.z), v3(c.x + 0.09, c.y + 0.25, c.z), v3(c.x + 0.09, c.y + 0.19, c.z)], 0.011, { sides: 5 });
    // whip & stub antennas from the radio case
    hard.setColor(0x1b1b1a).setMat(0.4, 0.6, KIND.METAL, 0.3);
    const ab = v3(c.x - 0.12, c.y + 0.19, c.z + 0.09);
    lathe(hard, [[0.015, 0], [0.012, 0.05], [0.006, 0.06]], 6, mat(ab.x, ab.y, ab.z, -Math.PI / 2, 0, 0));
    const st = hard.vertexCount;
    tube(hard, [ab.clone().add(v3(0, 0.05, 0)), ab.clone().add(v3(0, 0.6, 0.06)), ab.clone().add(v3(0, 1.1, 0.16))], (f) => 0.005 - f * 0.003, { sides: 4 });
    wobble(hard, st, ab, WOB.ANTENNA, 1.1);
    const st2 = hard.vertexCount;
    tube(hard, [v3(c.x + 0.12, c.y + 0.19, c.z + 0.07), v3(c.x + 0.12, c.y + 0.48, c.z + 0.09)], 0.008, { sides: 4 });
    wobble(hard, st2, v3(c.x + 0.12, c.y + 0.19, c.z + 0.07), WOB.ANTENNA, 0.6);
    anchors.radio = c.clone();
  }
  // lashing ropes over the rack load
  hard.setColor(0x8c7a55).setMat(0.92, 0, KIND.ROPE, 0.6);
  for (const [z, top] of [[1.25, 0.45], [1.72, 0.46], [1.98, 0.64]]) {
    const st = hard.vertexCount;
    tube(hard, [v3(-xr, rackY + 0.02, z), v3(-0.46, rackY + top * 0.72, z + 0.02), v3(-0.2, rackY + top, z), v3(0.15, rackY + top - 0.01, z - 0.02), v3(0.46, rackY + top * 0.66, z), v3(xr, rackY + 0.02, z)], 0.01, { sides: 4 });
    wobble(hard, st, v3(0, rackY, z), WOB.RACK, 1.2);
  }
  tube(hard, [v3(-xr, rackY + 0.05, z0 + 0.1), v3(-0.25, rackY + 0.43, 1.15), v3(0.05, rackY + 0.47, 1.6), v3(0.25, rackY + 0.6, 1.98), v3(xr, rackY + 0.05, z1 - 0.1)], 0.01, { sides: 4 });

  // -------- bags on the wing struts --------
  const sr = anchors.strut = {};
  const strutPoint = (side, f) => {
    const root = v3(side * (DIM.wingStrutRoot.x + 0.05), DIM.wingStrutRoot.y, DIM.wingStrutRoot.z - 0.05);
    const top = wingPoint(side * DIM.wing.strutX, sForC(DIM.wing.frontSparFrac, -1), new THREE.Vector3());
    top.y -= 0.06;
    return { p: new THREE.Vector3().lerpVectors(root, top, f), dir: new THREE.Vector3().subVectors(top, root).normalize() };
  };
  const strutBag = (side, f, size, group, color) => {
    const { p, dir } = strutPoint(side, f);
    // bag sits on the aft face of the strut, local Y along the strut
    const q = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), dir);
    const back = v3(0, 0, 1).applyQuaternion(q);
    const c = p.clone().addScaledVector(v3(0, 0, 1), size[2] * 0.5 + 0.03).addScaledVector(back, 0);
    const m = new THREE.Matrix4().compose(c, q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), Math.PI)), v3(1, 1, 1));
    const st = pouch(hard, m, size[0], size[1], size[2], color, rand, lod);
    // wrap straps around the strut
    hard.setColor(0x2b2c20).setMat(0.85, 0, KIND.STRAP, 0.5);
    for (const df of [-0.08, 0.08]) {
      const sp = p.clone().addScaledVector(dir, df * 1.5);
      const loop = [];
      for (let k = 0; k <= 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const side1 = new THREE.Vector3().crossVectors(dir, v3(0, 0, 1)).normalize();
        loop.push(sp.clone().addScaledVector(side1, Math.cos(a) * 0.05).addScaledVector(v3(0, 0, 1), Math.sin(a) * (Math.sin(a) > 0 ? size[2] + 0.07 : 0.06) + (Math.sin(a) > 0 ? 0.0 : 0)));
      }
      tube(hard, loop, 0.012, { sides: 3, rx: 0.2 });
    }
    wobble(hard, st, p, group, 0.5);
    return c;
  };
  sr.bagR1 = strutBag(1, 0.68, [0.36, 0.42, 0.18], WOB.STRUT_R, KHAKI[0]);
  sr.bagR2 = strutBag(1, 0.36, [0.26, 0.3, 0.14], WOB.STRUT_R, KHAKI[2]);
  sr.bagL1 = strutBag(-1, 0.6, [0.32, 0.38, 0.16], WOB.STRUT_L, KHAKI[1]);

  // -------- bags hanging under the right wing --------
  {
    const hangBag = (x, cz, size, color) => {
      const top = wingPoint(x, sForC((cz - DIM.wing.leZ) / DIM.wing.chord, -1), new THREE.Vector3());
      const c = top.clone().add(v3(0, -size[1] / 2 - 0.05, 0));
      const m = mat(c.x, c.y, c.z, 0, Math.PI / 2 + 0.05, 0);
      const st = pouch(hard, m, size[0], size[1], size[2], color, rand, lod);
      hard.setColor(0x2b2c20).setMat(0.85, 0, KIND.STRAP, 0.5);
      for (const dz of [-size[0] * 0.3, size[0] * 0.3]) {
        tube(hard, [top.clone().add(v3(-size[2] / 2 - 0.01, 0, dz)), c.clone().add(v3(-size[2] / 2 - 0.01, -size[1] / 2 - 0.01, dz)), c.clone().add(v3(size[2] / 2 + 0.01, -size[1] / 2 - 0.01, dz)), top.clone().add(v3(size[2] / 2 + 0.01, 0, dz))], 0.012, { sides: 3, rx: 0.2 });
      }
      wobble(hard, st, top, WOB.UNDERWING, 0.6);
      return c;
    };
    anchors.underwingBag = hangBag(3.3, 1.25, [0.62, 0.36, 0.32], KHAKI[3]);
    hangBag(3.95, 1.3, [0.38, 0.28, 0.24], KHAKI[1]);
    hangBag(-3.4, 1.28, [0.44, 0.3, 0.26], KHAKI[0]);
  }

  // -------- duffels along the rear fuselage (right side, behind the cargo door) --------
  {
    const side = 1;
    for (const [y, L, r, z] of [[2.05, 1.0, 0.16, 3.25], [2.38, 0.85, 0.15, 3.18]]) {
      const zc = z;
      const sec = fuselageSection(zc);
      const x = side * (sec.hw + r * 0.8);
      const m = mat(x, y, zc, 0, 0, 0);
      const st = duffel(hard, m, L, r, OLIVES[(y * 10) % OLIVES.length | 0], rand, lod);
      wobble(hard, st, v3(side * sec.hw, y, zc), WOB.SIDEBAGS, 0.6);
    }
    // a boxy pack behind the cargo door
    const st = pouch(hard, mat(side * (fuselageSection(2.95).hw + 0.1), 2.35, 2.95, 0, side * Math.PI / 2, 0), 0.3, 0.36, 0.18, OLIVES[2], rand, lod);
    wobble(hard, st, v3(side * 0.69, 2.35, 2.95), WOB.SIDEBAGS, 0.5);
    // tie-down straps over the side bags (around the fuselage, partly hidden)
    hard.setColor(0x7d1a12).setMat(0.8, 0, KIND.STRAP, 0.5);
    for (const z of [2.95, 3.5]) {
      const sec = fuselageSection(z);
      tube(hard, [v3(sec.hw * 0.6, sec.yt - 0.02, z), v3(sec.hw + 0.02, sec.yt - 0.15, z), v3(sec.hw + 0.33, 2.45, z), v3(sec.hw + 0.33, 1.95, z), v3(sec.hw + 0.02, sec.yb + 0.15, z), v3(sec.hw * 0.6, sec.yb + 0.01, z)], 0.02, { sides: 3, rx: 0.15, up: v3(0, 0, 1) });
    }
  }
  // left side rear duffel
  {
    const z = 3.3, sec = fuselageSection(z);
    const st = duffel(hard, mat(-(sec.hw + 0.12), 2.2, z), 0.9, 0.15, OLIVES[4], rand, lod);
    wobble(hard, st, v3(-sec.hw, 2.2, z), WOB.SIDEBAGS, 0.6);
  }

  // -------- antennas --------
  {
    const base = v3(0, fuselageSection(2.75).yt, 2.75);
    hard.setColor(0x232320).setMat(0.45, 0.6, KIND.METAL, 0.5);
    lathe(hard, [[0.025, 0], [0.02, 0.04], [0.008, 0.06]], 8, mat(base.x, base.y, base.z, -Math.PI / 2, 0, 0));
    const st = hard.vertexCount;
    tube(hard, [base.clone().add(v3(0, 0.05, 0)), base.clone().add(v3(0, 0.55, 0.12)), base.clone().add(v3(0, 1.05, 0.3))], (f) => 0.006 - f * 0.004, { sides: 4 });
    wobble(hard, st, base, WOB.ANTENNA, 1.15);
    // blade (stub) antenna
    const sb = v3(0, fuselageSection(3.7).yt, 3.7);
    hard.setColor(0x1a1a18).setMat(0.5, 0.3, KIND.PAINTED, 0.4);
    roundedBox(hard, 0.012, 0.22, 0.12, 0.005, mat(sb.x, sb.y + 0.1, sb.z + 0.02, -0.25, 0, 0));
    // long-wire HF antenna from a mast behind the rack to the fin top
    const mast = v3(0, fuselageSection(2.55).yt + 0.18, 2.55);
    tube(hard, [v3(0, fuselageSection(2.55).yt, 2.55), mast], 0.008, { sides: 4 });
    hard.curOccluder = false;
    hard.setColor(0x262624).setMat(0.4, 0.7, KIND.METAL, 0.3);
    const finTop = v3(0, DIM.fin.topY - 0.02, DIM.fin.leTopZ + 0.08);
    const pts = [];
    for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push(new THREE.Vector3().lerpVectors(mast, finTop, t).add(v3(0, -Math.sin(t * Math.PI) * 0.06, 0))); }
    const st3 = hard.vertexCount;
    tube(hard, pts, 0.0028, { sides: 3 });
    wobble(hard, st3, mast, WOB.ROPES, 4.0);
    hard.curOccluder = true;
  }
  return { anchors };
}
