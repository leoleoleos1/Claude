// Empennage: horizontal stabilizer + elevator (with trim tab), fin + rudder,
// dorsal fillet, tail light and strobe.
import * as THREE from 'three';
import { DIM, PART } from './dims.js';
import { grid, lathe, box, polygon, tube, mat, v3, KIND, curve } from './geom.js';

const HS = DIM.hstab, FIN = DIM.fin, RUD = DIM.rudder;
const naca00 = (c, t) => 5 * t * (0.2969 * Math.sqrt(Math.max(c, 0)) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4);

// Planforms -------------------------------------------------------------
// Horizontal tail: span coordinate a = |x|.
const hsRound = 0.32; // tip rounding length
function hsLE(a) {
  const a0 = HS.tipX - hsRound;
  const base = HS.leRootZ + (HS.leTipZ - HS.leRootZ) * Math.min(a / a0, 1);
  if (a <= a0) return base;
  const f = Math.min((a - a0) / hsRound, 1);
  return base + (HS.hingeZ - 0.06 - base) * (1 - Math.sqrt(Math.max(1 - f * f, 0)));
}
function hsTE(a) {
  const a0 = HS.tipX - hsRound;
  const base = HS.teRootZ + (HS.teTipZ - HS.teRootZ) * Math.min(a / a0, 1);
  if (a <= a0) return base;
  const f = Math.min((a - a0) / hsRound, 1);
  return base - (base - HS.hingeZ - 0.06) * (1 - Math.sqrt(Math.max(1 - f * f, 0)));
}
// Fin + rudder: span coordinate y.
const finLE = curve([[FIN.rootY - 0.02, FIN.leRootZ], [FIN.rootY + 0.3, FIN.leRootZ + 0.26], [FIN.topY - 0.2, FIN.leTopZ - 0.04], [FIN.topY - 0.06, FIN.leTopZ + 0.12], [FIN.topY + 0.04, FIN.leTopZ + 0.38]]);
function rudTE(y) {
  const t = THREE.MathUtils.clamp((y - RUD.bottomY) / (RUD.topY - RUD.bottomY), 0, 1);
  let z = THREE.MathUtils.lerp(RUD.teBottomZ, RUD.teTopZ, t);
  // rounded top and bottom corners
  const top = THREE.MathUtils.smoothstep(y, RUD.topY - 0.22, RUD.topY);
  z -= (z - FIN.hingeZ - 0.03) * (1 - Math.sqrt(Math.max(1 - top * top, 0)));
  const bot = THREE.MathUtils.smoothstep(-y, -(RUD.bottomY + 0.1), -RUD.bottomY);
  z -= 0.12 * bot * bot;
  return z;
}

// Point on a symmetric airfoil surface; frame: 'h' (span along x, thickness y) or 'v'
// (span along y, thickness x). side: +1 upper/right, -1 lower/left.
function surfPoint(frame, span, z0, z1, c, side, thick, base, out) {
  const chord = z1 - z0;
  const z = z0 + c * chord;
  const t = naca00(c, thick) * chord;
  if (frame === 'h') out.set(span, base + side * t, z);
  else out.set(side * t, span, z);
  return out;
}

export function buildTail(ctx) {
  const { paint, hard, lod } = ctx;
  const parts = {};
  const lights = {};
  const nC = lod === 0 ? 12 : lod === 1 ? 5 : 3;
  const nSpan = lod === 0 ? 10 : lod === 1 ? 4 : 2;

  // ---------------- horizontal stabilizer (fixed part, right half mirrored) --------
  const hsSpan = [];
  for (let i = 0; i <= nSpan; i++) {
    const f = i / nSpan;
    hsSpan.push(f < 0.75 ? (f / 0.75) * (HS.tipX - hsRound) : HS.tipX - hsRound + hsRound * Math.sin(((f - 0.75) / 0.25) * Math.PI / 2));
  }
  const hsPerim = 2 * 1.3 * 1.02;
  const islandH = ctx.island('hstab', 0, 0, HS.tipX, hsPerim, 1.0);
  // parameter t over the full chord: lower TE -> LE -> upper TE; the stab covers c <= hinge
  const hingeC = (a) => THREE.MathUtils.clamp((HS.hingeZ - hsLE(a)) / Math.max(hsTE(a) - hsLE(a), 1e-3), 0.05, 0.98);
  const stabLoop = [];
  for (let j = 0; j <= nC; j++) stabLoop.push({ side: -1, f: 1 - j / nC }); // lower: hinge -> LE
  for (let j = 1; j <= nC; j++) stabLoop.push({ side: 1, f: j / nC }); // upper: LE -> hinge
  const hsPoint = (a, item, cmax, out) => {
    const c = cmax * (1 - Math.cos((item.f * Math.PI) / 2));
    return surfPoint('h', a, hsLE(a), hsTE(a), c, item.side, HS.thick, HS.y, out);
  };
  const vOf = (side, c) => (side < 0 ? (1 - c) * hsPerim * 0.5 : hsPerim * 0.5 + c * hsPerim * 0.5);
  paint.curIsland = islandH;
  paint.uv1Offset = [0, 0];
  paint.setPart(PART.HSTAB, 0);
  const startH = paint.vertexCount;
  grid(paint, 0, 0, (s, t, out, i, j) => {
    const a = hsSpan[i];
    const it = stabLoop[j];
    const hc = hingeC(a);
    hsPoint(a, it, hc, out.p);
    const c = hc * (1 - Math.cos((it.f * Math.PI) / 2));
    out.u = a; out.v = vOf(it.side, c);
    out.edge = it.f < 0.12 ? 0.8 : 0;
  }, { sValues: hsSpan.map((_, i) => i), tValues: stabLoop.map((_, j) => j), flip: true });
  // aft (hinge) face of the stab: concave cove
  grid(paint, 0, 0, (s, t, out, i, j) => {
    const a = hsSpan[i];
    const hc = hingeC(a);
    const up = surfPoint('h', a, hsLE(a), hsTE(a), hc, 1, HS.thick, HS.y, new THREE.Vector3());
    const lo = surfPoint('h', a, hsLE(a), hsTE(a), hc, -1, HS.thick, HS.y, new THREE.Vector3());
    const f = j / 4;
    out.p.lerpVectors(lo, up, f);
    out.p.z -= Math.sin(f * Math.PI) * (up.y - lo.y) * 0.6;
    out.u = a; out.v = hsPerim * 0.02;
  }, { sValues: hsSpan.map((_, i) => i), tValues: [0, 1, 2, 3, 4] });
  paint.mirrorX(startH, paint.vertexCount, [40, 0]);

  // ---------------- elevator (both halves, one moving part) ----------------
  {
    const b = ctx.newBuilder('paint');
    b.curIsland = islandH;
    b.setPart(-PART.ELEV, 0.3);
    const span = [];
    const a0 = HS.cutX, a1 = HS.tipX - 0.01;
    for (let i = 0; i <= nSpan; i++) {
      const f = i / nSpan;
      span.push(a0 + (a1 - a0) * (f < 0.8 ? f / 0.8 * 0.85 : 0.85 + 0.15 * Math.sin(((f - 0.8) / 0.2) * Math.PI / 2)));
    }
    const nn = lod === 0 ? 5 : 2;
    const loop = [];
    for (let j = 0; j <= nC; j++) loop.push({ side: -1, f: 1 - j / nC, arc: -1 });
    for (let k = 1; k < nn; k++) loop.push({ arc: k / nn });
    for (let j = 0; j <= nC; j++) loop.push({ side: 1, f: j / nC, arc: -1 });
    const pt = (a, it, out) => {
      const z0 = hsLE(a), z1 = hsTE(a), hc = hingeC(a);
      if (it.arc === undefined || it.arc < 0) {
        const c = hc + (1 - hc) * it.f;
        return surfPoint('h', a, z0, z1, c, it.side, HS.thick, HS.y, out);
      }
      const up = surfPoint('h', a, z0, z1, hc, 1, HS.thick, HS.y, new THREE.Vector3());
      const lo = surfPoint('h', a, z0, z1, hc, -1, HS.thick, HS.y, new THREE.Vector3());
      const r = (up.y - lo.y) / 2;
      const ang = it.arc * Math.PI;
      return out.set(a, HS.y - Math.cos(ang) * r, HS.hingeZ - Math.sin(ang) * r * 0.9);
    };
    const start = b.vertexCount;
    b.uv1Offset = [0, 0];
    grid(b, 0, 0, (s, t, out, i, j) => {
      pt(span[i], loop[j], out.p);
      const hc = hingeC(span[i]);
      const it = loop[j];
      out.u = span[i];
      out.v = it.arc !== undefined && it.arc >= 0 ? vOf(-1, hc) : vOf(it.side, hc + (1 - hc) * it.f);
      out.edge = it.f > 0.95 ? 0.6 : 0;
    }, { sValues: span.map((_, i) => i), tValues: loop.map((_, j) => j), flip: true });
    // inner end caps
    const cap = (a, facing) => {
      const pts = loop.map((it) => { const p = pt(a, it, new THREE.Vector3()); return [p.z, p.y]; });
      const st = b.vertexCount;
      polygon(b, pts, null);
      for (let v = st; v < b.vertexCount; v++) {
        const z = b.position[v * 3], y = b.position[v * 3 + 1];
        b.position[v * 3] = a; b.position[v * 3 + 1] = y; b.position[v * 3 + 2] = z;
        b.normal[v * 3] = facing; b.normal[v * 3 + 1] = 0; b.normal[v * 3 + 2] = 0;
        b.attrs.uv[v * 2] = a; b.attrs.uv[v * 2 + 1] = vOf(-1, 0.9);
      }
      if (facing > 0) { const I = b.index; for (let q = 0; q < I.length; q += 3) if (I[q] >= st) { const w = I[q + 1]; I[q + 1] = I[q + 2]; I[q + 2] = w; } }
    };
    cap(span[0], -1);
    b.mirrorX(start, b.vertexCount, [40, 0]);
    parts.elevator = { name: 'elevator', paint: b, hinge: { origin: new THREE.Vector3(0, HS.y, HS.hingeZ), axis: new THREE.Vector3(1, 0, 0) } };

    // trim tab on the left elevator trailing edge (child of the elevator)
    if (lod < 2) {
      const tb = ctx.newBuilder('paint');
      tb.curIsland = islandH;
      tb.setPart(-PART.TRIM, 0.4);
      const tx0 = 0.72, tx1 = 1.32, tc = 0.085;
      const pts = [];
      for (let k = 0; k <= 3; k++) pts.push(tx0 + ((tx1 - tx0) * k) / 3);
      const tabPt = (a, f, side, out) => {
        const te = hsTE(a);
        const z = te - tc + f * tc;
        return out.set(-a, HS.y + side * (1 - f) * 0.008 + side * 0.001, z + 0.004);
      };
      grid(tb, 0, 0, (s, t, out, i, j) => {
        const loopT = [[-1, 1], [-1, 0], [1, 0], [1, 1]][j];
        tabPt(pts[i], loopT[1], loopT[0], out.p);
        out.u = pts[i]; out.v = vOf(loopT[0], 0.97);
      }, { sValues: pts.map((_, i) => i), tValues: [0, 1, 2, 3], flip: false });
      const z0 = hsTE((tx0 + tx1) / 2) - tc;
      parts.trimTab = { name: 'trimTab', paint: tb, parent: 'elevator', hinge: { origin: new THREE.Vector3(-(tx0 + tx1) / 2, HS.y, z0), axis: new THREE.Vector3(1, 0, 0) } };
      // cut is implied by the tab sitting proud of the trailing edge (visual only)
    }
  }

  // ---------------- fin ----------------
  const finSpan = [];
  const nFin = lod === 0 ? 10 : lod === 1 ? 4 : 2;
  for (let i = 0; i <= nFin; i++) {
    const f = i / nFin;
    finSpan.push(FIN.rootY - 0.02 + (FIN.topY + 0.04 - FIN.rootY + 0.02) * (f < 0.8 ? f / 0.8 * 0.86 : 0.86 + 0.14 * Math.sin(((f - 0.8) / 0.2) * Math.PI / 2)));
  }
  const finPerim = 2 * 1.9 * 1.02;
  const islandF = ctx.island('fin', FIN.rootY - 0.1, 0, FIN.topY - FIN.rootY + 0.2, finPerim, 1.1);
  const finLoop = [];
  for (let j = 0; j <= nC; j++) finLoop.push({ side: -1, f: 1 - j / nC });
  for (let j = 1; j <= nC; j++) finLoop.push({ side: 1, f: j / nC });
  // the fin's thickness is referenced to the full fin+rudder chord so the rudder fairs in
  const fullTE = (y) => Math.max(rudTE(Math.min(Math.max(y, RUD.bottomY), RUD.topY)), FIN.hingeZ + 0.05);
  const finPt = (y, it, out) => {
    const z0 = finLE(y), z1 = fullTE(y);
    const hc = THREE.MathUtils.clamp((FIN.hingeZ - z0) / Math.max(z1 - z0, 1e-3), 0.05, 0.99);
    const c = hc * (1 - Math.cos((it.f * Math.PI) / 2));
    return surfPoint('v', y, z0, z1, c, it.side, FIN.thick, 0, out);
  };
  const finV = (side, c) => (side < 0 ? (1 - c) * finPerim * 0.5 : finPerim * 0.5 + c * finPerim * 0.5);
  paint.curIsland = islandF;
  paint.uv1Offset = [0, 0];
  paint.setPart(PART.FIN, 0);
  grid(paint, 0, 0, (s, t, out, i, j) => {
    const y = finSpan[i];
    finPt(y, finLoop[j], out.p);
    const z0 = finLE(y), z1 = fullTE(y);
    const hc = THREE.MathUtils.clamp((FIN.hingeZ - z0) / Math.max(z1 - z0, 1e-3), 0.05, 0.99);
    out.u = y; out.v = finV(finLoop[j].side, hc * (1 - Math.cos((finLoop[j].f * Math.PI) / 2)));
    out.uv1 = [out.p.z, y];
    out.edge = finLoop[j].f < 0.1 ? 0.8 : 0;
  }, { sValues: finSpan.map((_, i) => i), tValues: finLoop.map((_, j) => j), flip: false });
  // fin aft face at the hinge
  grid(paint, 0, 0, (s, t, out, i, j) => {
    const y = finSpan[i];
    const r = finPt(y, { side: 1, f: 1 }, new THREE.Vector3());
    const l = finPt(y, { side: -1, f: 1 }, new THREE.Vector3());
    const f = j / 4;
    out.p.lerpVectors(l, r, f);
    out.p.z -= Math.sin(f * Math.PI) * (r.x - l.x) * 0.6;
    out.u = y; out.v = finPerim * 0.02;
  }, { sValues: finSpan.map((_, i) => i), tValues: [0, 1, 2, 3, 4], flip: true });
  // dorsal fillet blending the fin into the tail cone
  if (lod < 2) {
    const dz0 = 4.55, dz1 = FIN.leRootZ + 0.35;
    const fil = [];
    const n = lod === 0 ? 8 : 3;
    for (let i = 0; i <= n; i++) fil.push(dz0 + ((dz1 - dz0) * i) / n);
    paint.setPart(PART.FIN, 0.1);
    grid(paint, 0, 0, (s, t, out, i, j) => {
      const z = fil[i];
      const f = (z - dz0) / (dz1 - dz0);
      const h = 0.03 + 0.26 * f * f;
      const yBase = 3.08 - (z - 4.5) * 0.105 - 0.02;
      const side = j < 2 ? -1 : 1;
      const up = j === 1 || j === 2;
      const w = 0.012 + 0.02 * (1 - f);
      out.p.set(up ? side * w * 0.6 : side * (w + 0.03), up ? yBase + h : yBase - 0.01, z);
      out.u = yBase; out.v = finPerim * (0.3 + 0.1 * j);
      out.uv1 = [z, out.p.y];
    }, { sValues: fil.map((_, i) => i), tValues: [0, 1, 2, 3] });
  }
  if (lod === 0) {
    // bake-only full fin+rudder surface so the rudder samples matching paint
    const bo = ctx.bakeOnly;
    bo.curIsland = islandF;
    bo.setPart(PART.RUDDER, 0);
    const rudSpan = [];
    for (let i = 0; i <= nFin; i++) rudSpan.push(RUD.bottomY + ((RUD.topY - RUD.bottomY) * i) / nFin);
    const loopFull = [];
    for (let j = 0; j <= nC; j++) loopFull.push({ side: -1, f: 1 - j / nC });
    for (let j = 1; j <= nC; j++) loopFull.push({ side: 1, f: j / nC });
    grid(bo, 0, 0, (s, t, out, i, j) => {
      const y = rudSpan[i];
      const z0 = Math.min(finLE(Math.min(y, FIN.topY)), FIN.hingeZ - 0.2), z1 = fullTE(y);
      const hc = THREE.MathUtils.clamp((FIN.hingeZ - z0) / Math.max(z1 - z0, 1e-3), 0.05, 0.99);
      const c = hc + (1 - hc) * (1 - loopFull[j].f) * 0 + (1 - hc) * (loopFull[j].f);
      surfPoint('v', y, z0, z1, Math.min(c, 1), loopFull[j].side, FIN.thick, 0, out.p);
      out.u = y; out.v = finV(loopFull[j].side, Math.min(c, 1));
    }, { sValues: rudSpan.map((_, i) => i), tValues: loopFull.map((_, j) => j) });
  }

  // ---------------- rudder (moving part) ----------------
  {
    const b = ctx.newBuilder('paint');
    b.curIsland = islandF;
    b.setPart(-PART.RUDDER, 0.3);
    const span = [];
    const nR = lod === 0 ? 12 : lod === 1 ? 4 : 2;
    for (let i = 0; i <= nR; i++) span.push(RUD.bottomY + ((RUD.topY - RUD.bottomY) * i) / nR);
    const nn = lod === 0 ? 5 : 2;
    const loop = [];
    for (let j = 0; j <= nC; j++) loop.push({ side: -1, f: 1 - j / nC, arc: -1 });
    for (let k = 1; k < nn; k++) loop.push({ arc: k / nn });
    for (let j = 0; j <= nC; j++) loop.push({ side: 1, f: j / nC, arc: -1 });
    const pt = (y, it, out) => {
      const z0 = Math.min(finLE(Math.min(y, FIN.topY)), FIN.hingeZ - 0.25), z1 = fullTE(y);
      const hc = THREE.MathUtils.clamp((FIN.hingeZ - z0) / Math.max(z1 - z0, 1e-3), 0.05, 0.99);
      if (it.arc < 0) {
        const c = hc + (1 - hc) * it.f;
        const p = surfPoint('v', y, z0, z1, c, it.side, FIN.thick, 0, out);
        // collapse thickness smoothly at the rounded top/bottom
        const k = Math.min(THREE.MathUtils.smoothstep(y, RUD.bottomY, RUD.bottomY + 0.08), 1 - THREE.MathUtils.smoothstep(y, RUD.topY - 0.06, RUD.topY));
        p.x *= 0.15 + 0.85 * k;
        return p;
      }
      const r = surfPoint('v', y, z0, z1, hc, 1, FIN.thick, 0, new THREE.Vector3()).x;
      const k = Math.min(THREE.MathUtils.smoothstep(y, RUD.bottomY, RUD.bottomY + 0.08), 1 - THREE.MathUtils.smoothstep(y, RUD.topY - 0.06, RUD.topY));
      const ang = it.arc * Math.PI;
      return out.set(-Math.cos(ang) * r * (0.15 + 0.85 * k), y, FIN.hingeZ - Math.sin(ang) * r * 0.9 * (0.15 + 0.85 * k));
    };
    grid(b, 0, 0, (s, t, out, i, j) => {
      const y = span[i];
      pt(y, loop[j], out.p);
      const z0 = Math.min(finLE(Math.min(y, FIN.topY)), FIN.hingeZ - 0.25), z1 = fullTE(y);
      const hc = THREE.MathUtils.clamp((FIN.hingeZ - z0) / Math.max(z1 - z0, 1e-3), 0.05, 0.99);
      out.u = y; out.v = loop[j].arc >= 0 ? finV(-1, hc) : finV(loop[j].side, hc + (1 - hc) * loop[j].f);
      out.uv1 = [out.p.z, y];
      out.edge = loop[j].f > 0.95 ? 0.6 : 0;
    }, { sValues: span.map((_, i) => i), tValues: loop.map((_, j) => j), flip: false });
    parts.rudder = { name: 'rudder', paint: b, hinge: { origin: new THREE.Vector3(0, (RUD.bottomY + RUD.topY) / 2, FIN.hingeZ), axis: new THREE.Vector3(0, 1, 0) } };
  }

  // ---------------- lights & small parts ----------------
  hard.setColor(0xe8e4d8).setMat(0.12, 0, KIND.LAMP, 0);
  const tl = new THREE.Vector3(0, 2.83, DIM.tailPostZ + 0.02);
  lathe(hard, [[0, 0.05], [0.025, 0.04], [0.032, 0.0]], 8, mat(tl.x, tl.y, tl.z - 0.01));
  lights.tail = tl.clone().add(new THREE.Vector3(0, 0, 0.05));
  // strobe on the fin top
  const st = new THREE.Vector3(0, FIN.topY + 0.035, FIN.leTopZ + 0.24);
  hard.setColor(0x2a2a26).setMat(0.5, 0.4, KIND.PAINTED, 0.3);
  box(hard, 0.05, 0.03, 0.14, mat(st.x, st.y - 0.01, st.z));
  hard.setColor(0xf0ecdf).setMat(0.1, 0, KIND.LAMP, 0);
  lathe(hard, [[0, 0.045], [0.02, 0.04], [0.026, 0.0]], 8, mat(st.x, st.y + 0.005, st.z, -Math.PI / 2, 0, 0));
  lights.strobe = st.clone().add(new THREE.Vector3(0, 0.05, 0));
  if (lod < 2) {
    // elevator & rudder hinge brackets, control horns
    hard.setColor(0x4c4a44).setMat(0.5, 0.85, KIND.METAL, 0.5);
    for (const sx of [-1, 1]) for (const a of [0.55, 1.4, 2.1]) box(hard, 0.02, 0.05, 0.1, mat(sx * a, HS.y - 0.02, HS.hingeZ - 0.02));
    for (const y of [2.75, 3.25, 3.7]) box(hard, 0.05, 0.02, 0.1, mat(0, y, FIN.hingeZ - 0.02));
    // tail-cone stiffeners: horizontal stabilizer struts (bracing to the fin)
    hard.setColor(0x6b6a62).setMat(0.4, 0.9, KIND.METAL, 0.5);
    for (const sx of [-1, 1]) tube(hard, [v3(sx * 0.05, 3.42, 6.15), v3(sx * 1.05, HS.y + 0.02, 6.1)], 0.01, { sides: 5 });
    for (const sx of [-1, 1]) tube(hard, [v3(sx * 0.05, 2.7, 6.2), v3(sx * 1.05, HS.y - 0.02, 6.12)], 0.01, { sides: 5 });
  }
  return { parts, lights };
}

