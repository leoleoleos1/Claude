// Twin floats: hull panels (V bottom, chine with spray rail, sides, crowned deck),
// step, bow bumper, deck hardware, boarding ladders, straps, spare tyre, coiled
// ropes and the retractable water rudders (separate moving parts).
import * as THREE from 'three';
import { DIM, PART, floatSection, floatSectionPoint } from './dims.js';
import { grid, tube, lathe, box, roundedBox, polygon, mat, v3, KIND } from './geom.js';

const F = DIM.float;
// Panels of the half section (parameter ranges in floatSectionPoint).
const PANELS = [
  { name: 'bottom', s0: 0, s1: 0.38, n: [6, 2, 1] },
  { name: 'lip', s0: 0.38, s1: 0.41, n: [1, 1, 1] },
  { name: 'side', s0: 0.41, s1: 0.78, n: [3, 1, 1] },
  { name: 'deck', s0: 0.78, s1: 1.0, n: [5, 2, 1] },
];

export const FLOAT_PERIMETER = (() => {
  const sec = floatSection(0);
  let L = 0, prev = null;
  const p = [0, 0];
  for (let i = 0; i <= 200; i++) { floatSectionPoint(sec, i / 200, p); if (prev) L += Math.hypot(p[0] - prev[0], p[1] - prev[1]); prev = [p[0], p[1]]; }
  return L * 2;
})();

function zStations(z0, z1, lod, fore) {
  const out = [];
  if (fore) {
    const bow = lod === 0 ? [-2.65, -2.63, -2.59, -2.53, -2.45, -2.35, -2.22, -2.07, -1.9, -1.7, -1.48, -1.25]
      : lod === 1 ? [-2.65, -2.55, -2.35, -2.0, -1.5] : [-2.65, -2.3, -1.4];
    out.push(...bow);
    const last = bow[bow.length - 1];
    const n = lod === 0 ? 11 : lod === 1 ? 3 : 1;
    for (let i = 1; i <= n; i++) out.push(last + ((z1 - last) * i) / n);
  } else {
    const n = lod === 0 ? 14 : lod === 1 ? 4 : 2;
    for (let i = 0; i <= n; i++) out.push(z0 + ((z1 - z0) * i) / n);
  }
  return out;
}

export function buildFloats(ctx) {
  const { paint, hard, lod } = ctx;
  const island = ctx.island('float', F.bowZ, 0, F.sternZ - F.bowZ, FLOAT_PERIMETER, 1.05);
  const parts = {};
  const anchors = {};
  const eps = 1e-4;
  const fore = zStations(F.bowZ, F.stepZ - eps, lod, true);
  const aft = zStations(F.stepZ + eps, F.sternZ, lod, false);
  const tmp = [0, 0];
  const halfPerim = FLOAT_PERIMETER / 2;
  // arc-position (v) of section parameter s, normalized to the reference perimeter
  const vAt = (sec, s) => {
    let L = 0, Ls = 0, prev = null;
    for (let i = 0; i <= 40; i++) {
      const si = i / 40;
      floatSectionPoint(sec, si, tmp);
      if (prev) { const d = Math.hypot(tmp[0] - prev[0], tmp[1] - prev[1]); L += d; if (si <= s + 1e-6) Ls += d; }
      prev = [tmp[0], tmp[1]];
    }
    return (Ls / L) * halfPerim;
  };

  const start = paint.vertexCount;
  paint.curIsland = island;
  paint.uv1Offset = [0, 0];
  paint.setPart(PART.FLOAT, 0);
  const hullPanel = (zs, panel) => {
    const n = panel.n[Math.min(lod, 2)];
    const ts = [];
    for (let k = 0; k <= n; k++) ts.push(panel.s0 + ((panel.s1 - panel.s0) * k) / n);
    const secs = zs.map((z) => floatSection(z));
    grid(paint, 0, 0, (s, t, out, i, j) => {
      floatSectionPoint(secs[i], ts[j], tmp);
      out.p.set(F.x + tmp[0], tmp[1], zs[i]);
      out.u = zs[i];
      out.v = halfPerim + vAt(secs[i], ts[j]) * (panel.name === 'deck' ? 1 : 1);
      // edge wear: chine lip, deck edge, bow
      let e = 0;
      if (panel.name === 'lip') e = 0.9;
      if (panel.name === 'deck' && ts[j] < 0.84) e = 0.6;
      if (panel.name === 'bottom' && ts[j] < 0.03) e = 0.7;
      e = Math.max(e, 1 - THREE.MathUtils.smoothstep(zs[i], F.bowZ, F.bowZ + 0.5));
      out.edge = e;
    }, { sValues: zs.map((_, i) => i), tValues: ts, flip: true });
  };
  for (const panel of PANELS) { hullPanel(fore, panel); hullPanel(aft, panel); }
  // step face (vertical, facing aft) between the forebody end and the afterbody start
  {
    const sf = floatSection(F.stepZ - eps), sa = floatSection(F.stepZ + eps);
    const pts = [];
    const n = lod === 0 ? 8 : 3;
    for (let k = 0; k <= n; k++) { floatSectionPoint(sf, (0.41 * k) / n, tmp); pts.push([tmp[0], tmp[1]]); }
    for (let k = n; k >= 0; k--) { floatSectionPoint(sa, (0.41 * k) / n, tmp); pts.push([tmp[0], tmp[1]]); }
    const st = paint.vertexCount;
    paint.setPart(PART.FLOAT, 0.6);
    polygon(paint, pts, mat(F.x, 0, F.stepZ));
    for (let v = st; v < paint.vertexCount; v++) { paint.attrs.uv[v * 2] = F.stepZ; paint.attrs.uv[v * 2 + 1] = halfPerim + 0.05; }
    // polygon faces +z already (aft) — keep
  }
  // bow & stern closing caps (hidden by the bumper / stern post)
  for (const [z, facing] of [[F.bowZ, -1], [F.sternZ, 1]]) {
    const sec = floatSection(z);
    const pts = [];
    for (let k = 0; k <= 10; k++) { floatSectionPoint(sec, k / 10, tmp); pts.push([tmp[0], tmp[1]]); }
    pts.push([0, sec.deck]);
    pts.unshift([0, sec.keel]);
    const st = paint.vertexCount;
    polygon(paint, pts, mat(F.x, 0, z));
    for (let v = st; v < paint.vertexCount; v++) { paint.attrs.uv[v * 2] = z; paint.attrs.uv[v * 2 + 1] = halfPerim; }
    if (facing < 0) {
      for (let v = st; v < paint.vertexCount; v++) paint.normal[v * 3 + 2] = -1;
      const I = paint.index;
      for (let q = 0; q < I.length; q += 3) if (I[q] >= st) { const w = I[q + 1]; I[q + 1] = I[q + 2]; I[q + 2] = w; }
    }
  }
  const endHalf = paint.vertexCount;
  // mirror the half hull about the float centreline (x = F.x): mirror globally then shift
  {
    const P = paint.position;
    // temporarily move to centreline origin, mirror, move back
    for (let v = start; v < endHalf; v++) P[v * 3] -= F.x;
    const mStart = paint.mirrorX(start, endHalf);
    for (let v = start; v < endHalf; v++) P[v * 3] += F.x;
    for (let v = mStart; v < paint.vertexCount; v++) {
      P[v * 3] += F.x;
      // left half of the section: v runs the other way around the hull
      paint.attrs.uv[v * 2 + 1] = 2 * halfPerim - paint.attrs.uv[v * 2 + 1];
      paint.attrs.uv1[v * 2 + 1] = 2 * halfPerim - paint.attrs.uv1[v * 2 + 1];
    }
  }
  const endFloat = paint.vertexCount;
  // left float = mirror of the right float across x = 0 (uv1 shifted for unique detail)
  paint.mirrorX(start, endFloat, [0, 60]);

  // ---- hardware on both floats ----
  const hw0 = hard.vertexCount;
  const deckY = (z) => floatSection(z).deck + 0.012;
  const sideX = (z) => floatSection(z).hw;
  // bow bumper (black rubber dome)
  {
    const sec = floatSection(F.bowZ + 0.05);
    hard.setColor(0x0e0e0d).setMat(0.55, 0, KIND.RUBBER, 0.5);
    const g = new THREE.SphereGeometry(1, lod === 0 ? 18 : 8, lod === 0 ? 12 : 6);
    hard.append(g, mat(F.x, (sec.keel + sec.deck) / 2 + 0.01, F.bowZ + 0.035, 0, 0, 0, 0.135, (sec.deck - sec.keel) / 2 + 0.03, 0.12));
  }
  // keel strip & stern post
  hard.setColor(0x5d5a52).setMat(0.4, 0.9, KIND.METAL, 0.7);
  {
    const kp = [];
    for (let z = -2.3; z <= F.stepZ - 0.02; z += lod === 0 ? 0.25 : 1.2) kp.push(v3(F.x, floatSection(z).keel - 0.008, z));
    tube(hard, kp, 0.014, { sides: 4, ry: 0.5 });
    const ka = [];
    for (let z = F.stepZ + 0.02; z <= F.sternZ - 0.05; z += lod === 0 ? 0.3 : 1.5) ka.push(v3(F.x, floatSection(z).keel - 0.008, z));
    if (ka.length > 1) tube(hard, ka, 0.012, { sides: 4, ry: 0.5 });
  }
  if (lod < 2) {
    // deck hatches (oval covers with a recessed handle)
    for (const z of [-1.95, -0.75, 0.45, 2.55, 3.75]) {
      const y = deckY(z);
      hard.setColor(0x6e6a5f).setMat(0.55, 0.7, KIND.METAL, 0.8);
      const g = new THREE.CylinderGeometry(1, 1, 1, lod === 0 ? 16 : 8);
      hard.append(g, mat(F.x, y - 0.004, z, 0, 0, 0, 0.13, 0.016, 0.1));
      hard.setColor(0x2c2a26).setMat(0.5, 0.8, KIND.METAL, 0.6);
      box(hard, 0.09, 0.012, 0.02, mat(F.x, y + 0.008, z));
    }
    // cleats: bow, mid outer, stern
    hard.setColor(0x47453f).setMat(0.45, 0.9, KIND.METAL, 0.6);
    const cleat = (x, z, rotY) => {
      const y = deckY(z);
      box(hard, 0.03, 0.035, 0.04, mat(x, y + 0.017, z, 0, rotY, 0));
      roundedBox(hard, 0.026, 0.024, 0.2, 0.01, mat(x, y + 0.045, z, 0, rotY, 0));
    };
    cleat(F.x, -2.25, 0);
    cleat(F.x + 0.3, 1.0, 0);
    cleat(F.x, 4.75, 0);
    anchors.cleatBowR = v3(F.x, deckY(-2.25) + 0.05, -2.25);
    anchors.cleatSternR = v3(F.x, deckY(4.75) + 0.05, 4.75);
    anchors.cleatMidR = v3(F.x + 0.3, deckY(1.0) + 0.05, 1.0);
    // pump-out caps
    hard.setColor(0x8b867a).setMat(0.4, 1, KIND.METAL, 0.5);
    for (const z of [-1.3, 0.0, 1.2, 3.1, 4.3]) lathe(hard, [[0, 0.012], [0.02, 0.01], [0.022, 0]], 8, mat(F.x - 0.25, deckY(z), z, -Math.PI / 2, 0, 0));
    // boarding ladder on the outer side (rails + rungs), hooked over the deck edge
    {
      const lz0 = 0.62, lz1 = 1.06;
      const top = deckY(0.84);
      const xo = F.x + sideX(0.84) + 0.035;
      hard.setColor(0x9a968b).setMat(0.35, 1, KIND.METAL, 0.8);
      for (const z of [lz0, lz1]) {
        tube(hard, [v3(F.x + sideX(z) - 0.05, top + 0.02, z), v3(xo, top + 0.04, z), v3(xo + 0.03, top - 0.05, z), v3(xo + 0.06, 0.16, z)], 0.013, { sides: 6 });
      }
      for (const y of [0.24, 0.43]) {
        const t = (y - 0.16) / (top - 0.05 - 0.16);
        const x = xo + 0.06 - t * 0.03;
        tube(hard, [v3(x, y, lz0), v3(x, y, lz1)], 0.013, { sides: 6 });
      }
      anchors.ladderR = [v3(xo + 0.05, 0.24, (lz0 + lz1) / 2), v3(xo + 0.04, 0.43, (lz0 + lz1) / 2)];
    }
    // red ratchet straps around the hull
    for (const z of [0.22, 2.32]) {
      hard.setColor(0x8a1b12).setMat(0.75, 0, KIND.STRAP, 0.6);
      const sec = floatSection(z);
      const pts = [];
      const n = lod === 0 ? 28 : 10;
      for (let k = 0; k <= n; k++) {
        const s = k / n;
        floatSectionPoint(sec, s, tmp);
        pts.push(v3(F.x + tmp[0] * 1.012 + 0.003, tmp[1] - (s < 0.01 ? 0.004 : 0) + (s > 0.85 ? 0.006 : 0), z));
      }
      const left = pts.map((p) => v3(2 * F.x - p.x, p.y, p.z)).reverse();
      const loop = left.concat(pts.slice(1));
      tube(hard, loop, 0.024, { sides: 4, rx: 0.12, ry: 1, up: new THREE.Vector3(0, 0, 1) });
      // ratchet buckle on the deck
      hard.setColor(0x55524a).setMat(0.4, 0.9, KIND.METAL, 0.5);
      roundedBox(hard, 0.06, 0.03, 0.09, 0.008, mat(F.x + 0.18, deckY(z) + 0.02, z));
    }
  }
  const hwHalfEnd = hard.vertexCount;
  hard.mirrorX(hw0, hwHalfEnd);
  for (const k of ['cleatBow', 'cleatStern', 'cleatMid']) {
    const r = anchors[k + 'R'];
    if (r) anchors[k + 'L'] = v3(-r.x, r.y, r.z);
  }
  if (anchors.ladderR) anchors.ladderL = anchors.ladderR.map((p) => v3(-p.x, p.y, p.z));

  // asymmetric float cargo: spare tyre on the right rear deck, coiled ropes at the bows
  if (lod < 2) {
    const tz = 3.55, ty = deckY(tz);
    hard.setColor(0x151413).setMat(0.85, 0, KIND.TREAD, 0.7);
    const tyre = new THREE.TorusGeometry(0.24, 0.085, lod === 0 ? 10 : 6, lod === 0 ? 28 : 12);
    hard.append(tyre, mat(F.x - 0.02, ty + 0.085, tz, Math.PI / 2, 0.08, 0, 1, 1, 0.95), [3.2, 0.6]);
    hard.setColor(0x34322f).setMat(0.5, 0.9, KIND.METAL, 0.5);
    lathe(hard, [[0.08, -0.07], [0.15, -0.06], [0.155, 0.06], [0.08, 0.07]], 14, mat(F.x - 0.02, ty + 0.085, tz, Math.PI / 2, 0.08, 0));
    // rope lashing over the tyre
    hard.setColor(0x8a7752).setMat(0.9, 0, KIND.ROPE, 0.6);
    for (const dz of [-0.1, 0.1]) {
      tube(hard, [v3(F.x - 0.42, ty - 0.01, tz + dz), v3(F.x - 0.28, ty + 0.16, tz + dz), v3(F.x, ty + 0.19, tz + dz * 1.2), v3(F.x + 0.28, ty + 0.16, tz + dz), v3(F.x + 0.43, ty - 0.01, tz + dz)], 0.011, { sides: 5 });
    }
    // coiled ropes
    const coil = (x, z, turns, r0) => {
      hard.setColor(0x9a8660).setMat(0.92, 0, KIND.ROPE, 0.5);
      const pts = [];
      const steps = lod === 0 ? turns * 22 : turns * 8;
      for (let k = 0; k <= steps; k++) {
        const a = (k / steps) * turns * Math.PI * 2;
        const r = r0 * (0.86 + 0.14 * Math.sin(a * 0.31) + (k / steps) * 0.05);
        pts.push(v3(x + Math.cos(a) * r, deckY(z) + 0.012 + (k / steps) * 0.05 + 0.012 * Math.sin(a * 3.1), z + Math.sin(a) * r * 0.8));
      }
      tube(hard, pts, 0.011, { sides: lod === 0 ? 5 : 3 });
    };
    coil(F.x + 0.04, -1.55, 4, 0.16);
    coil(-F.x - 0.05, -1.45, 3, 0.15);
    // tail of rope running from the coil to the bow cleat
    hard.setColor(0x9a8660).setMat(0.92, 0, KIND.ROPE, 0.5);
    tube(hard, [v3(F.x + 0.1, deckY(-1.6) + 0.04, -1.7), v3(F.x + 0.05, deckY(-2.0) + 0.02, -2.0), v3(F.x, deckY(-2.24) + 0.05, -2.24)], 0.011, { sides: 5 });
    // rope hanging over the side of the right float (chafe area in the reference)
    tube(hard, [v3(F.x + 0.2, deckY(-1.2) + 0.02, -1.25), v3(F.x + 0.43, deckY(-1.2) - 0.02, -1.2), v3(F.x + 0.46, 0.45, -1.05), v3(F.x + 0.45, 0.28, -0.95), v3(F.x + 0.43, 0.3, -0.75), v3(F.x + 0.44, 0.5, -0.6), v3(F.x + 0.3, deckY(-0.6) + 0.01, -0.62)], 0.012, { sides: 5 });
  }

  // ---- water rudders (moving parts) ----
  if (lod < 2) {
    for (const side of [1, -1]) {
      const b = ctx.newBuilder('hard');
      const x = side * F.x;
      const zp = F.sternZ - 0.06;
      const sec = floatSection(zp);
      const topY = sec.deck + 0.02;
      b.setColor(0x3d3b36).setMat(0.5, 0.85, KIND.METAL, 0.6);
      // post
      tube(b, [v3(x, topY + 0.07, zp), v3(x, sec.keel - 0.05, zp)], 0.018, { sides: 6 });
      // blade
      b.setColor(0xc89a1c).setMat(0.6, 0.2, KIND.PAINTED, 0.7);
      roundedBox(b, 0.016, 0.34, 0.24, 0.01, mat(x, sec.keel - 0.12, zp + 0.13));
      b.setColor(0x2a2825).setMat(0.5, 0.8, KIND.METAL, 0.5);
      box(b, 0.05, 0.03, 0.12, mat(x, topY + 0.07, zp + 0.03));
      parts[side > 0 ? 'waterRudderR' : 'waterRudderL'] = {
        name: side > 0 ? 'waterRudderR' : 'waterRudderL', hard: b,
        hinge: { origin: v3(x, topY + 0.07, zp), axis: v3(0, 1, 0) },
        retract: { origin: v3(x, topY + 0.07, zp), axis: v3(1, 0, 0) },
      };
    }
  }
  // walk areas (float decks) for the interaction layer
  anchors.deckR = { min: v3(F.x - 0.36, deckY(0) - 0.01, -2.2), max: v3(F.x + 0.36, deckY(0) + 0.02, 4.3) };
  anchors.deckL = { min: v3(-F.x - 0.36, deckY(0) - 0.01, -2.2), max: v3(-F.x + 0.36, deckY(0) + 0.02, 4.3) };
  anchors.bowR = v3(F.x, deckY(-2.2), -2.3);
  anchors.bowL = v3(-F.x, deckY(-2.2), -2.3);
  return { parts, anchors };
}
