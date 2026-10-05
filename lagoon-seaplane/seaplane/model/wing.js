// Wing: centre section (with the eyebrow skylights in the root leading edge),
// outer panels with cut-outs for flaps and ailerons, the moving surfaces
// themselves, and wing fittings (lights, pitot, floodlight, fuel caps).
import * as THREE from 'three';
import { DIM, PART, airfoilPoint, wingChordY } from './dims.js';
import { grid, tube, lathe, box, roundedBox, polygon, mat, v3, KIND } from './geom.js';

const W = DIM.wing;
export const HINGE_C = W.hingeFrac;

export function sForC(c, side) {
  const tt = Math.acos(THREE.MathUtils.clamp(1 - 2 * c, -1, 1)) / Math.PI;
  return side > 0 ? 0.5 + tt / 2 : 0.5 - tt / 2;
}

const _af = [0, 0];
// Wing surface point for signed span x and airfoil parameter s (0 TE lower .. 0.5 LE .. 1 TE upper).
export function wingPoint(x, s, out) {
  const ax = Math.abs(x);
  airfoilPoint(s, W.thick, W.camber, _af);
  let cx = _af[0], cy = _af[1];
  if (ax > W.tipX0) {
    const f = Math.min((ax - W.tipX0) / (W.tipX - W.tipX0), 1);
    const k = Math.max(Math.sqrt(Math.max(1 - f * f, 0)), 0.04);
    cx = 0.42 + (cx - 0.42) * k;
    cy = cy * (0.35 + 0.65 * k) * k + 0.004 * (1 - k);
  }
  const z = W.leZ + cx * W.chord;
  const y = wingChordY(ax) + cy * W.chord + (W.leZ + W.chord * 0.5 - z) * Math.tan(W.incidence);
  return out.set(x, y, z);
}

// Perimeter of the airfoil in metres (panel-space circumference).
const P_AF = (() => {
  let L = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  wingPoint(2, 0, a);
  for (let i = 1; i <= 400; i++) { wingPoint(2, i / 400, b); L += a.distanceTo(b); a.copy(b); }
  return L;
})();
export const WING_PERIMETER = P_AF;

const S_HL = sForC(HINGE_C, -1), S_HU = sForC(HINGE_C, 1);
const S_SKY_LO = sForC(0.2, -1), S_SKY_HI = sForC(0.13, 1);
const SKY_X0 = 0.085, SKY_X1 = 0.575;

function sList(lod) {
  const n = lod === 0 ? 46 : lod === 1 ? 14 : 8;
  const set = new Set();
  for (let i = 0; i <= n; i++) {
    // cluster near LE and TE using a smooth remap
    const u = i / n;
    set.add(+(0.5 - 0.5 * Math.cos(u * Math.PI)).toFixed(6));
  }
  for (const s of [S_HL, S_HU]) set.add(+s.toFixed(6));
  if (lod < 2) for (const s of [S_SKY_LO, S_SKY_HI]) set.add(+s.toFixed(6));
  if (lod === 0) for (const c of [0.25, 0.62]) { set.add(+sForC(c, -1).toFixed(6)); set.add(+sForC(c, 1).toFixed(6)); }
  return [...set].sort((a, b) => a - b);
}

function xList(lod) {
  const keys = [W.rootX, W.flap.x0, W.strutX, W.flap.x1, W.aileron.x0, W.aileron.x1, W.tipX0, W.tipX];
  const out = [];
  const maxStep = lod === 0 ? 0.32 : lod === 1 ? 1.1 : 3.5;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (a === W.tipX0) {
      const tipN = lod === 0 ? 7 : lod === 1 ? 3 : 1;
      for (let k = 0; k < tipN; k++) out.push(a + (b - a) * Math.sin((k / tipN) * Math.PI / 2));
      continue;
    }
    const n = Math.max(1, Math.ceil((b - a) / maxStep));
    for (let k = 0; k < n; k++) out.push(a + ((b - a) * k) / n);
  }
  out.push(W.tipX);
  return out;
}

export function buildWing(ctx) {
  const { paint, hard, glass, lod } = ctx;
  const ss = sList(lod);
  const xs = xList(lod);
  const tmpP = new THREE.Vector3();
  const islandW = ctx.island('wing', W.rootX, 0, W.tipX - W.rootX, P_AF, 1.0);
  const islandC = ctx.island('wingC', -W.rootX, 0, W.rootX * 2, P_AF, 1.0);
  const inCut = (x) => (x > W.flap.x0 && x < W.flap.x1) || (x > W.aileron.x0 && x < W.aileron.x1);

  // ---- outer right panel (mirrored to the left) ----
  const surf = (sign) => (s, t, out, i, j) => {
    wingPoint(sign * xs[i], ss[j], out.p);
    out.u = xs[i]; out.v = ss[j] * P_AF;
    const le = Math.abs(ss[j] - 0.5);
    out.edge = Math.max(1 - le / 0.06, 0) * 0.9 + (xs[i] > W.tipX0 ? 0.5 : 0) + (Math.min(ss[j], 1 - ss[j]) < 0.02 ? 0.5 : 0);
  };
  const skipCut = (i, j) => {
    const xc = (xs[i] + xs[i + 1]) / 2, sc = (ss[j] + ss[j + 1]) / 2;
    return inCut(xc) && (sc < S_HL || sc > S_HU);
  };
  const opts = { sValues: xs.map((_, i) => i), tValues: ss, flip: true };
  paint.curIsland = islandW;
  paint.uv1Offset = [0, 0];
  paint.setPart(-PART.WING, 0);
  const startR = paint.vertexCount;
  grid(paint, 0, 0, surf(1), { ...opts, skip: lod < 2 ? skipCut : null });
  // cove faces and cut-out side walls
  if (lod < 2) for (const [x0, x1] of [[W.flap.x0, W.flap.x1], [W.aileron.x0, W.aileron.x1]]) coveAndWalls(paint, x0, x1, xs, lod);
  const endR = paint.vertexCount;
  paint.mirrorX(startR, endR, [50, 0]);
  if (lod === 0) {
    ctx.bakeOnly.curIsland = islandW;
    ctx.bakeOnly.setPart(PART.WING, 0);
    grid(ctx.bakeOnly, 0, 0, surf(1), opts);
  }

  // ---- centre section with skylights ----
  const xc = [];
  {
    const keys = [-W.rootX, -SKY_X1, -SKY_X0, SKY_X0, SKY_X1, W.rootX];
    for (let i = 0; i < keys.length - 1; i++) {
      const n = lod === 0 ? Math.max(1, Math.ceil((keys[i + 1] - keys[i]) / 0.12)) : 1;
      for (let k = 0; k < n; k++) xc.push(keys[i] + ((keys[i + 1] - keys[i]) * k) / n);
    }
    xc.push(W.rootX);
  }
  const skySkip = (i, j) => {
    if (lod >= 2) return false;
    const xm = Math.abs((xc[i] + xc[i + 1]) / 2), sc = (ss[j] + ss[j + 1]) / 2;
    return xm > SKY_X0 && xm < SKY_X1 && sc > S_SKY_LO && sc < S_SKY_HI;
  };
  const surfC = (s, t, out, i, j) => {
    wingPoint(xc[i], ss[j], out.p);
    out.u = xc[i]; out.v = ss[j] * P_AF;
    out.edge = Math.max(1 - Math.abs(ss[j] - 0.5) / 0.05, 0) * 0.6;
  };
  paint.curIsland = islandC;
  paint.uv1Offset = [0, 0];
  paint.setPart(-PART.WING_C, 0);
  grid(paint, 0, 0, surfC, { sValues: xc.map((_, i) => i), tValues: ss, skip: skySkip, flip: true });
  if (lod === 0) {
    ctx.bakeOnly.curIsland = islandC;
    ctx.bakeOnly.setPart(PART.WING_C, 0);
    grid(ctx.bakeOnly, 0, 0, surfC, { sValues: xc.map((_, i) => i), tValues: ss, flip: true });
  }
  if (lod < 2) {
    // skylight glass wrapped around the leading edge
    for (const side of [1, -1]) {
      glass.set('aGlass', side > 0 ? 10 : 11, 0, 0.9, 1);
      grid(glass, lod === 0 ? 6 : 2, lod === 0 ? 8 : 3, (s, t, out) => {
        const x = side * THREE.MathUtils.lerp(SKY_X0 + 0.01, SKY_X1 - 0.01, s);
        const sp = THREE.MathUtils.lerp(S_SKY_LO + 0.004, S_SKY_HI - 0.004, t);
        wingPoint(x, sp, out.p);
        // inset toward the chord line
        const c = new THREE.Vector3();
        wingPoint(x, 0.5, c);
        const mid = new THREE.Vector3(x, wingChordY(Math.abs(x)) + 0.02, W.leZ + 0.3);
        out.p.addScaledVector(mid.sub(out.p).normalize(), 0.006);
        out.u = side > 0 ? s : 1 - s; out.v = t;
      }, { flip: side > 0 });
    }
    // seal around the skylights
    hard.setColor(0x111110).setMat(0.8, 0, KIND.RUBBER, 0.4);
    for (const side of [1, -1]) {
      const pts = [];
      const n = 10;
      for (let k = 0; k <= n; k++) pts.push(wingPoint(side * SKY_X0, THREE.MathUtils.lerp(S_SKY_LO, S_SKY_HI, k / n), new THREE.Vector3()));
      for (let k = 0; k <= n; k++) pts.push(wingPoint(side * SKY_X1, THREE.MathUtils.lerp(S_SKY_HI, S_SKY_LO, k / n), new THREE.Vector3()));
      pts.push(pts[0].clone());
      tube(hard, pts, 0.008, { sides: 4 });
    }
  }

  // ---- control surfaces (separate moving parts) ----
  const parts = {};
  if (lod < 2) {
    parts.flapR = controlSurface(ctx, W.flap.x0, W.flap.x1, 1, islandW, 'flapR', lod);
    parts.flapL = controlSurface(ctx, W.flap.x0, W.flap.x1, -1, islandW, 'flapL', lod);
    parts.aileronR = controlSurface(ctx, W.aileron.x0, W.aileron.x1, 1, islandW, 'aileronR', lod);
    parts.aileronL = controlSurface(ctx, W.aileron.x0, W.aileron.x1, -1, islandW, 'aileronL', lod);
  }

  // ---- fittings ----
  const lights = {};
  {
    // nav lights at the tips (lens domes); glow sprites are added by the effects
    for (const side of [1, -1]) {
      const p = wingPoint(side * (W.tipX - 0.035), 0.5, new THREE.Vector3());
      p.z += 0.13;
      hard.setColor(side > 0 ? 0x1f8a3a : 0xa31a14).setMat(0.15, 0, KIND.LAMP, 0);
      lathe(hard, [[0, 0.06], [0.03, 0.05], [0.042, 0.02], [0.044, 0]], 8, mat(p.x, p.y, p.z, 0, side * Math.PI / 2, 0));
      lights[side > 0 ? 'navR' : 'navL'] = p.clone().add(new THREE.Vector3(side * 0.05, 0, 0));
    }
  }
  if (lod < 2) {
    // floodlight (landing light) under the right wing, near the strut fitting
    const fx = 2.18;
    const under = wingPoint(fx, sForC(0.2, -1), new THREE.Vector3());
    hard.setColor(0x2a2a26).setMat(0.5, 0.6, KIND.PAINTED, 0.5);
    box(hard, 0.03, 0.12, 0.03, mat(fx, under.y - 0.06, under.z + 0.02));
    const lampC = new THREE.Vector3(fx, under.y - 0.17, under.z - 0.02);
    roundedBox(hard, 0.2, 0.15, 0.16, 0.025, mat(lampC.x, lampC.y, lampC.z, -0.12, 0, 0));
    hard.setColor(0x9c968a).setMat(0.3, 1, KIND.CHROME, 0.3);
    lathe(hard, [[0.07, 0.0], [0.082, 0.004], [0.085, 0.02]], 14, mat(lampC.x, lampC.y + 0.01, lampC.z - 0.07, Math.PI - 0.12, 0, 0));
    hard.setColor(0xf2ecd8).setMat(0.08, 0, KIND.LAMP, 2 / 8); // lamp 2: landing light
    lathe(hard, [[0, 0.012], [0.07, 0.0]], 14, mat(lampC.x, lampC.y + 0.01, lampC.z - 0.075, Math.PI - 0.12, 0, 0));
    lights.flood = new THREE.Vector3(lampC.x, lampC.y + 0.01, lampC.z - 0.1);
    lights.floodDir = new THREE.Vector3(0, -Math.sin(0.12 + 0.06), -Math.cos(0.12 + 0.06)).normalize();
    // pitot tube under the left wing
    const pp = wingPoint(-4.7, sForC(0.22, -1), new THREE.Vector3());
    hard.setColor(0x8a877e).setMat(0.35, 1, KIND.METAL, 0.3);
    tube(hard, [pp.clone().add(v3(0, 0.01, 0)), pp.clone().add(v3(0, -0.13, -0.02)), pp.clone().add(v3(0, -0.14, -0.06)), pp.clone().add(v3(0, -0.14, -0.42))], 0.009, { sides: 6 });
    // stall vane on the left leading edge
    const sv = wingPoint(-1.9, 0.5, new THREE.Vector3());
    hard.setColor(0x777570).setMat(0.4, 1, KIND.METAL, 0.3);
    box(hard, 0.04, 0.004, 0.03, mat(sv.x, sv.y - 0.005, sv.z - 0.012));
    // fuel caps on the wing top
    for (const side of [1, -1]) {
      const fc = wingPoint(side * 1.18, sForC(0.33, 1), new THREE.Vector3());
      hard.setColor(0x8f8b82).setMat(0.4, 1, KIND.METAL, 0.5);
      lathe(hard, [[0, 0.018], [0.05, 0.016], [0.058, 0.006], [0.06, -0.01]], 12, mat(fc.x, fc.y, fc.z, -Math.PI / 2, 0, 0));
      hard.setColor(0x7f1d14).setMat(0.6, 0.2, KIND.PAINTED, 0.4);
      box(hard, 0.09, 0.012, 0.016, mat(fc.x, fc.y + 0.022, fc.z));
    }
    // strut attach fittings under the wing
    hard.setColor(0x5a574f).setMat(0.45, 0.9, KIND.METAL, 0.6);
    for (const side of [1, -1]) for (const c of [W.frontSparFrac, W.rearSparFrac]) {
      const f = wingPoint(side * W.strutX, sForC(c, -1), new THREE.Vector3());
      box(hard, 0.05, 0.07, 0.08, mat(f.x, f.y - 0.03, f.z));
    }
    // hinge brackets
    hard.setColor(0x4c4a44).setMat(0.5, 0.8, KIND.METAL, 0.5);
    for (const side of [1, -1]) for (const x of [1.0, 2.0, 3.1, 4.0, 4.5, 5.6, 6.6]) {
      const hp = wingPoint(side * x, S_HL, new THREE.Vector3());
      box(hard, 0.02, 0.05, 0.12, mat(hp.x, hp.y - 0.02, hp.z + 0.04));
    }
    // static wicks on the aileron trailing edges
    if (lod === 0) {
      hard.setColor(0x151515).setMat(0.6, 0.1, KIND.RUBBER, 0.2);
      for (const side of [1, -1]) for (const x of [5.8, 6.6]) {
        const tp = wingPoint(side * x, 0.0, new THREE.Vector3());
        tube(hard, [tp, tp.clone().add(v3(0, -0.01, 0.13))], 0.003, { sides: 3 });
      }
    }
  }
  return { parts, lights };
}

// Concave cove (hinge recess) and the side walls of a control-surface cut-out (right side).
function coveAndWalls(paint, x0, x1, xs, lod) {
  const pl = new THREE.Vector3(), pu = new THREE.Vector3();
  const coveN = lod === 0 ? 5 : 2;
  const xsIn = xs.filter((x) => x >= x0 - 1e-6 && x <= x1 + 1e-6);
  const coveAt = (x, t, out) => {
    wingPoint(x, S_HL, pl); wingPoint(x, S_HU, pu);
    out.lerpVectors(pl, pu, t);
    const r = pl.distanceTo(pu) / 2;
    out.z -= Math.sin(t * Math.PI) * (r + 0.012);
    return out;
  };
  grid(paint, 0, 0, (s, t, out, i, j) => {
    coveAt(xsIn[i], j / coveN, out.p);
    out.u = xsIn[i]; out.v = (S_HL + (S_HU - S_HL) * (j / coveN)) * WING_PERIMETER;
  }, { sValues: xsIn.map((_, i) => i), tValues: Array.from({ length: coveN + 1 }, (_, j) => j / coveN) });
  // side walls (polygons in the x = const plane)
  for (const [x, facing] of [[x0, 1], [x1, -1]]) {
    const poly = [];
    const p = new THREE.Vector3();
    const n = lod === 0 ? 8 : 3;
    for (let k = 0; k <= n; k++) { wingPoint(x, S_HL * (1 - k / n), p); poly.push([p.z, p.y]); }
    for (let k = 0; k <= n; k++) { wingPoint(x, 1 - (1 - S_HU) * (1 - k / n), p); poly.push([p.z, p.y]); }
    for (let k = 1; k < coveN; k++) { coveAt(x, 1 - k / coveN, p); poly.push([p.z, p.y]); }
    const start = paint.vertexCount;
    polygon(paint, poly, null);
    // polygon lies in XY: map (u=z, v=y) to the wall plane at x, normal +/-x
    for (let v = start; v < paint.vertexCount; v++) {
      const z = paint.position[v * 3], y = paint.position[v * 3 + 1];
      paint.position[v * 3] = x; paint.position[v * 3 + 1] = y; paint.position[v * 3 + 2] = z;
      paint.normal[v * 3] = facing; paint.normal[v * 3 + 1] = 0; paint.normal[v * 3 + 2] = 0;
      paint.attrs.uv[v * 2] = x; paint.attrs.uv[v * 2 + 1] = S_HL * WING_PERIMETER;
    }
    // polygon() produced +Z facing triangles in (z,y) space -> after the swap the facing is -x; flip if needed
    if (facing > 0) {
      const I = paint.index;
      for (let t = 0; t < I.length; t += 3) if (I[t] >= start) { const q = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = q; }
    }
  }
}

// Flap / aileron as its own builder with hinge information.
function controlSurface(ctx, x0, x1, side, island, name, lod) {
  const b = ctx.newBuilder('paint');
  const gap = 0.012;
  const xa = x0 + gap, xb = x1 - gap;
  const n = Math.max(2, Math.ceil((xb - xa) / (lod === 0 ? 0.3 : 1.2)));
  const xsS = Array.from({ length: n + 1 }, (_, i) => xa + ((xb - xa) * i) / n);
  const nl = lod === 0 ? 7 : 3, nn = lod === 0 ? 6 : 3;
  // loop: lower TE->hinge, nose arc, upper hinge->TE
  const loop = [];
  for (let k = 0; k <= nl; k++) loop.push({ s: (S_HL * k) / nl, arc: -1 });
  for (let k = 1; k < nn; k++) loop.push({ s: -1, arc: k / nn });
  for (let k = 0; k <= nl; k++) loop.push({ s: S_HU + ((1 - S_HU) * k) / nl, arc: -1 });
  const pl = new THREE.Vector3(), pu = new THREE.Vector3();
  const pointAt = (x, item, out) => {
    if (item.arc < 0) return wingPoint(x, item.s, out);
    wingPoint(x, S_HL, pl); wingPoint(x, S_HU, pu);
    const c = new THREE.Vector3().lerpVectors(pl, pu, 0.5);
    const r = pl.distanceTo(pu) / 2;
    const dirU = new THREE.Vector3().subVectors(pu, c).normalize();
    const fwd = new THREE.Vector3(0, 0, -1);
    const a = item.arc * Math.PI; // 0 at lower -> pi at upper
    return out.copy(c).addScaledVector(dirU, -Math.cos(a) * r).addScaledVector(fwd, Math.sin(a) * r * 0.95);
  };
  b.curIsland = island;
  b.uv1Offset = side > 0 ? [0, 0] : [50, 0];
  b.setPart(-(name.startsWith('flap') ? PART.FLAP : PART.AILERON), 0.3);
  grid(b, 0, 0, (s, t, out, i, j) => {
    pointAt(side * xsS[i], loop[j], out.p);
    out.u = xsS[i];
    out.v = (loop[j].arc < 0 ? loop[j].s : S_HL) * WING_PERIMETER;
    out.edge = (j === 0 || j === loop.length - 1) ? 0.6 : 0;
  }, { sValues: xsS.map((_, i) => i), tValues: loop.map((_, j) => j), flip: side > 0 });
  // end caps
  for (const [x, facing] of [[xa, -1], [xb, 1]]) {
    const pts = loop.map((it) => { const p = pointAt(side * x, it, new THREE.Vector3()); return [p.z, p.y]; });
    const start = b.vertexCount;
    polygon(b, pts, null);
    const fx = facing * side;
    for (let v = start; v < b.vertexCount; v++) {
      const z = b.position[v * 3], y = b.position[v * 3 + 1];
      b.position[v * 3] = side * x; b.position[v * 3 + 1] = y; b.position[v * 3 + 2] = z;
      b.normal[v * 3] = fx; b.normal[v * 3 + 1] = 0; b.normal[v * 3 + 2] = 0;
      b.attrs.uv[v * 2] = x; b.attrs.uv[v * 2 + 1] = S_HL * WING_PERIMETER;
    }
    if (fx > 0) {
      const I = b.index;
      for (let t = 0; t < I.length; t += 3) if (I[t] >= start) { const q = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = q; }
    }
  }
  // hinge axis (TE-down positive rotation)
  const h0 = new THREE.Vector3(), h1 = new THREE.Vector3();
  wingPoint(side * xa, S_HL, pl); wingPoint(side * xa, S_HU, pu); h0.lerpVectors(pl, pu, 0.5);
  wingPoint(side * xb, S_HL, pl); wingPoint(side * xb, S_HU, pu); h1.lerpVectors(pl, pu, 0.5);
  const axis = side > 0 ? new THREE.Vector3().subVectors(h1, h0).normalize() : new THREE.Vector3().subVectors(h0, h1).normalize();
  return { name, paint: b, hinge: { origin: h0.clone().lerp(h1, 0.5), axis } };
}
