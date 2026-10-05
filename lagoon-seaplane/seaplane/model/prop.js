// Three-blade propeller: twisted cambered blades (black with yellow tips) and a
// battered polished spinner. Built in prop-local space: hub at the origin,
// rotation axis +Z (thrust toward -Z). Rotates clockwise seen from the cockpit.
import * as THREE from 'three';
import { DIM, airfoilPoint } from './dims.js';
import { lathe, curve, rng, v3, KIND } from './geom.js';

export const PROP_BEND_GROUP = 15;
const R = DIM.propRadius;

// paddle blades: narrow round shank, widest around 70 % radius, broad rounded tip
const chordAt = curve([[0.12, 0.09], [0.2, 0.105], [0.28, 0.16], [0.36, 0.225], [0.45, 0.27], [0.6, 0.3], [0.75, 0.312], [0.9, 0.31], [1.05, 0.298], [1.15, 0.282], [1.22, 0.258], [1.26, 0.225], [1.285, 0.17], [1.3, 0.06]]);
const thickAt = curve([[0.12, 1], [0.24, 0.8], [0.34, 0.32], [0.45, 0.2], [0.6, 0.14], [0.9, 0.1], [1.3, 0.08]]);
const PITCH = 1.3; // fine pitch (blades at rest), faces show from the front quarters

export function buildProp(ctx) {
  const { lod } = ctx;
  let b = ctx.newBuilder('hard');
  b.localSpace = true; // built around the hub; not shifted into the plane frame
  const rand = rng(ctx.seed * 31 + 5);
  // ---------------- spinner ----------------
  const prof = [[0.001, -0.36], [0.025, -0.35], [0.09, -0.31], [0.165, -0.245], [0.235, -0.155], [0.28, -0.06], [0.302, 0.03], [0.308, 0.11], [0.304, 0.16]];
  b.setColor(0xb9b3a6).setMat(0.22, 1, KIND.CHROME, 0.55);
  const s0 = b.vertexCount;
  lathe(b, prof, lod === 0 ? 40 : lod === 1 ? 16 : 8, null);
  if (lod === 0) {
    // dents: shallow gaussian depressions
    const dents = [];
    for (let i = 0; i < 6; i++) dents.push({ a: rand() * Math.PI * 2, z: -0.22 + rand() * 0.3, r: 0.03 + rand() * 0.05, d: 0.004 + rand() * 0.008 });
    const P = b.position, N = b.normal;
    for (let v = s0; v < b.vertexCount; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      const a = Math.atan2(y, x);
      let d = 0;
      for (const dn of dents) {
        let da = a - dn.a; da = Math.atan2(Math.sin(da), Math.cos(da));
        const rr = Math.hypot(x, y);
        const dist = Math.hypot(da * rr, z - dn.z);
        d += dn.d * Math.exp(-(dist * dist) / (dn.r * dn.r));
      }
      P[v * 3] -= N[v * 3] * d; P[v * 3 + 1] -= N[v * 3 + 1] * d; P[v * 3 + 2] -= N[v * 3 + 2] * d;
    }
  }
  // back plate
  b.setColor(0x2b2925).setMat(0.5, 0.7, KIND.METAL, 0.6);
  lathe(b, [[0.001, 0.2], [0.29, 0.2], [0.31, 0.17], [0.3, 0.16]], lod === 0 ? 32 : 12, null, { flip: true });
  // ---------------- blades (own builder: hidden behind the blur disc at speed) ----------------
  const spinner = b;
  b = ctx.newBuilder('hard');
  b.localSpace = true;
  const rs = lod === 0 ? [0.12, 0.2, 0.28, 0.36, 0.45, 0.6, 0.75, 0.9, 1.05, 1.15, 1.2, 1.24, 1.27, 1.29, 1.3]
    : lod === 1 ? [0.15, 0.36, 0.7, 1.05, 1.22, 1.3] : [0.2, 0.7, 1.3];
  const ns = lod === 0 ? 22 : lod === 1 ? 10 : 6;
  const af = [0, 0];
  const black = new THREE.Color(0x221f1b), yellow = new THREE.Color(0xc9900f), red = new THREE.Color(0x8a1a12);
  for (let k = 0; k < 3; k++) {
    const phi = (k / 3) * Math.PI * 2;
    const start = b.vertexCount;
    const rows = rs.length;
    for (let i = 0; i < rows; i++) {
      const r = rs[i];
      const C = chordAt(r), tau = thickAt(r);
      const beta = Math.atan(PITCH / (2 * Math.PI * r));
      const ax = v3(Math.cos(beta), 0, -Math.sin(beta)); // TE -> LE
      const nn = v3(-Math.sin(beta), 0, -Math.cos(beta)); // camber side (forward)
      const round = 1 - THREE.MathUtils.smoothstep(r, 0.22, 0.34); // round shank -> airfoil
      const tipPaint = r > R - 0.115;
      const stripe = r > R - 0.15 && r <= R - 0.125;
      for (let j = 0; j <= ns; j++) {
        const s = j / ns;
        airfoilPoint(s, Math.min(tau, 0.3), 0.04, af, 0.3);
        let ca = (0.35 - af[0]) * C, cn = af[1] * C;
        if (round > 0) {
          const ang = s * Math.PI * 2;
          const rho = 0.045;
          ca = THREE.MathUtils.lerp(ca, Math.cos(ang) * rho * -1, round);
          cn = THREE.MathUtils.lerp(cn, Math.sin(ang) * rho, round);
        }
        const p = v3(0, r, 0).addScaledVector(ax, ca).addScaledVector(nn, cn);
        const col = tipPaint ? yellow : stripe ? red : black;
        b.cur.color = [col.r, col.g, col.b];
        const le = Math.abs(s - 0.5) < 0.12;
        b.cur.aMat = [tipPaint ? 0.6 : 0.62, 0.25, KIND.PAINTED, le ? 1.0 : 0.85];
        // bend group: tip of blade 0
        if (k === 0 && r > 0.85) b.cur.aWob = [0, 0.85, 0, PROP_BEND_GROUP + Math.min((r - 0.85) / 0.45, 0.999)];
        else b.cur.aWob = [0, 0, 0, 0];
        b.vert(p.x, p.y, p.z, 0, 1, 0, r, s * C * 2.1);
      }
    }
    // faces + normals from the grid
    const ring = ns + 1;
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < ns; j++) {
      const a = start + i * ring + j, c = start + (i + 1) * ring + j;
      b.quad(a, a + 1, c + 1, c);
    }
    // tip cap
    {
      const last = start + (rows - 1) * ring;
      const P = b.position;
      let cx = 0, cy = 0, cz = 0;
      for (let j = 0; j <= ns; j++) { cx += P[(last + j) * 3]; cy += P[(last + j) * 3 + 1]; cz += P[(last + j) * 3 + 2]; }
      const cIdx = b.vert(cx / ring, cy / ring + 0.002, cz / ring, 0, 1, 0, R, 0);
      for (let j = 0; j < ns; j++) b.tri(last + j, last + j + 1, cIdx);
    }
    // normals: finite differences on the grid
    const P = b.position, N = b.normal;
    const pa = new THREE.Vector3(), pb = new THREE.Vector3(), du = new THREE.Vector3(), dv = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < rows; i++) for (let j = 0; j <= ns; j++) {
      const id = (ii, jj) => start + ii * ring + ((jj + ns) % ns);
      const i0 = Math.max(0, i - 1), i1 = Math.min(rows - 1, i + 1);
      pa.fromArray(P, id(i0, j) * 3); pb.fromArray(P, id(i1, j) * 3); du.subVectors(pb, pa);
      pa.fromArray(P, id(i, j - 1) * 3); pb.fromArray(P, id(i, j + 1) * 3); dv.subVectors(pb, pa);
      n.crossVectors(dv, du).normalize();
      const v = start + i * ring + j;
      N[v * 3] = n.x; N[v * 3 + 1] = n.y; N[v * 3 + 2] = n.z;
    }
    // rotate blade k about z
    const m = new THREE.Matrix4().makeRotationZ(-phi);
    b.transform(start, m);
  }
  return { builder: spinner, blades: b, hub: v3(0, DIM.thrustY, DIM.propZ) };
}
