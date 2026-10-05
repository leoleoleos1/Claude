// Fuselage: one continuous loft from the cowl lip to the tail post with the
// openings (top cowl removed, windscreen, doors, windows) cut on aligned grid
// lines, plus doors, window rims, glass panes and small fittings.
import * as THREE from 'three';
import { DIM, PART, fuselageSection } from './dims.js';
import { grid, tube, lathe, box, roundedBox, mat, v3, KIND } from './geom.js';

// Absolute side-wall heights used inside the cabin so door/window edges fall on grid lines.
const H_WALL = [1.74, 1.86, 2.1, 2.35, 2.6, 2.64, 2.85, 3.04, 3.08, 3.14, 3.165];
const CAB_W0 = 1.74, CAB_W1 = 3.2;
const NB = 3, NAB = 4, NW = H_WALL.length + 1, NAT = 4, NT = 3;
const K_WALL = NB + NAB, K_ARCT = K_WALL + NW, K_TOP = K_ARCT + NAT;
export const HALF = K_TOP + NT;
export const RING = HALF * 2;
export const P_REF = 5.98; // cabin perimeter, panel-space circumference

const sstep = THREE.MathUtils.smoothstep;
function cabinBlend(z) { return sstep(z, -0.3, -0.02) * (1 - sstep(z, 3.2, 3.55)); }

function wallY(sec, idx, z) {
  const w0 = sec.yb + sec.rb, w1 = sec.yt - sec.rt;
  if (idx <= 0) return w0;
  if (idx >= NW) return w1;
  const i0 = Math.floor(idx), f = idx - i0;
  const one = (i) => {
    if (i <= 0) return w0;
    if (i >= NW) return w1;
    const h = H_WALL[i - 1];
    const abs = THREE.MathUtils.clamp(h, w0, w1);
    const frac = w0 + (w1 - w0) * ((h - CAB_W0) / (CAB_W1 - CAB_W0));
    return THREE.MathUtils.lerp(frac, abs, cabinBlend(z));
  };
  return THREE.MathUtils.lerp(one(i0), one(i0 + 1), f);
}

// Position of ring coordinate k (0 = bottom centre .. HALF = top centre, fractional ok)
// on the right half; mirror x for the left half.
export function ringXY(z, k, out, sec = fuselageSection(z)) {
  const { hw, yb, yt, rb, rt } = sec;
  if (k <= NB) { out[0] = (k / NB) * (hw - rb); out[1] = yb; }
  else if (k <= K_WALL) { const a = ((k - NB) / NAB) * Math.PI / 2; out[0] = hw - rb + Math.sin(a) * rb; out[1] = yb + rb - Math.cos(a) * rb; }
  else if (k <= K_ARCT) { out[0] = hw; out[1] = wallY(sec, k - K_WALL, z); }
  else if (k <= K_TOP) { const a = ((k - K_ARCT) / NAT) * Math.PI / 2; out[0] = hw - rt + Math.cos(a) * rt; out[1] = yt - rt + Math.sin(a) * rt; }
  else { out[0] = (1 - (k - K_TOP) / NT) * (hw - rt); out[1] = yt; }
  return out;
}

// ring index j (0..RING) -> signed position, x mirrored on the left half
export function ringPos(z, j, out, sec) {
  const right = j <= HALF;
  ringXY(z, right ? j : RING - j, out, sec);
  if (!right) out[0] = -out[0];
  return out;
}

// Wall ring coordinate k for an absolute cabin height y.
export function kForY(y) {
  if (y <= CAB_W0) return K_WALL;
  if (y >= CAB_W1) return K_ARCT;
  for (let i = 0; i < H_WALL.length; i++) if (Math.abs(H_WALL[i] - y) < 1e-4) return K_WALL + i + 1;
  // interpolate
  const hs = [CAB_W0, ...H_WALL, CAB_W1];
  for (let i = 0; i < hs.length - 1; i++) if (y >= hs[i] && y <= hs[i + 1]) return K_WALL + i + (y - hs[i]) / (hs[i + 1] - hs[i]);
  return K_ARCT;
}

// Station list (z) with all opening edges.
function stations(lod) {
  const keys = [DIM.noseZ, -1.58, -1.53, -1.47, -1.42, DIM.cowlOpen.z0, DIM.cowlOpen.z1, 0, DIM.wsBottomZ, 0.4, 0.46, DIM.wsTopZ, 0.62,
    1.24, 1.3, 1.42, 1.5, 2.54, 2.62, 2.74, 3.1, 3.2, DIM.tailPostZ];
  keys.sort((a, b) => a - b);
  const maxStep = lod === 0 ? (z) => (z < -1.3 ? 0.07 : z < 0.05 ? 0.14 : z < 3.3 ? 0.16 : 0.22)
    : lod === 1 ? () => 0.45 : () => 1.2;
  const out = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (b - a < 1e-4) continue;
    if (lod > 0 && out.length && a - out[out.length - 1] < 0.12 && i > 0) { /* merge tiny gaps on low lods */ }
    const n = Math.max(1, Math.ceil((b - a) / maxStep((a + b) / 2)));
    for (let k = 0; k < n; k++) out.push(a + ((b - a) * k) / n);
  }
  out.push(keys[keys.length - 1]);
  return out;
}

const OPEN = {
  cowl(zc, x, y) { const c = DIM.cowlOpen; return zc > c.z0 && zc < c.z1 && Math.abs(Math.atan2(x, y - DIM.thrustY)) < c.halfAngle; },
};

export function buildFuselage(ctx) {
  const { paint, hard, glass, lod } = ctx;
  const zs = stations(lod);
  const ns = zs.length;
  const secs = zs.map((z) => fuselageSection(z));
  const tmp = [0, 0];
  // ring tables
  const jList = [];
  if (lod === 0) for (let j = 0; j <= RING; j++) jList.push(j);
  else {
    const half = lod === 1
      ? [0, NB, K_WALL - 2, K_WALL, K_WALL + 2, K_WALL + 5, K_WALL + 9, K_ARCT, K_ARCT + 2, K_TOP, HALF]
      : [0, K_WALL - 1, K_WALL + 5, K_ARCT, K_TOP, HALF];
    for (const k of half) jList.push(k);
    for (let i = half.length - 2; i >= 0; i--) jList.push(RING - half[i]);
  }
  const nj = jList.length;
  const XY = new Float32Array(ns * nj * 2), V = new Float32Array(ns * nj);
  for (let i = 0; i < ns; i++) {
    let acc = 0;
    for (let jj = 0; jj < nj; jj++) {
      ringPos(zs[i], jList[jj], tmp, secs[i]);
      const o = (i * nj + jj) * 2;
      if (jj > 0) acc += Math.hypot(tmp[0] - XY[o - 2], tmp[1] - XY[o - 1]);
      XY[o] = tmp[0]; XY[o + 1] = tmp[1];
      V[i * nj + jj] = acc;
    }
    const tot = V[i * nj + nj - 1] || 1;
    for (let jj = 0; jj < nj; jj++) V[i * nj + jj] = (V[i * nj + jj] / tot) * P_REF;
  }
  const island = ctx.island('fuse', DIM.noseZ, 0, DIM.tailPostZ - DIM.noseZ, P_REF, 1.15);

  const surf = (s, t, out, i, jj) => {
    const o = (i * nj + jj) * 2;
    out.p.set(XY[o], XY[o + 1], zs[i]);
    out.u = zs[i]; out.v = V[i * nj + jj];
    // wear edges: corner arcs, cowl lip
    const k = jList[jj] <= HALF ? jList[jj] : RING - jList[jj];
    let e = 0;
    if (k > NB && k < K_WALL) e = Math.sin(((k - NB) / NAB) * Math.PI) * 0.45;
    if (k > K_ARCT && k < K_TOP) e = Math.sin(((k - K_ARCT) / NAT) * Math.PI) * 0.5;
    e = Math.max(e, 1 - sstep(zs[i], DIM.noseZ, DIM.noseZ + 0.1));
    out.edge = e;
  };

  // holes (only lod 0/1 cut real openings; lod2 is closed with dark glass painted in the bake)
  const D = DIM;
  const quadInfo = (i, jj) => {
    const o00 = (i * nj + jj) * 2, o11 = ((i + 1) * nj + jj + 1) * 2;
    const x = (XY[o00] + XY[o11]) / 2, y = (XY[o00 + 1] + XY[o11 + 1]) / 2;
    const zc = (zs[i] + zs[i + 1]) / 2;
    const kA = jList[jj], kB = jList[jj + 1];
    const kc = (kA + kB) / 2;
    const k = kc <= HALF ? kc : RING - kc;
    return { x, y, zc, k, side: kc <= HALF ? 1 : -1 };
  };
  const isOpening = (i, jj) => {
    if (lod >= 2) return false;
    const q = quadInfo(i, jj);
    if (OPEN.cowl(q.zc, q.x, q.y)) return 'cowl';
    const onWall = q.k > K_WALL && q.k < K_ARCT;
    if (q.zc > D.wsBottomZ && q.zc < D.wsTopZ && q.k > K_ARCT) return 'ws';
    if (onWall) {
      if (q.zc > D.doorPilot.z0 && q.zc < D.doorPilot.z1 && q.y > D.doorPilot.y0) return q.side > 0 ? 'doorR' : 'doorL';
      if (q.side > 0 && q.zc > D.doorCargo.z0 && q.zc < D.doorCargo.z1 && q.y > D.doorCargo.y0 && q.y < D.doorCargo.y1) return 'cargo';
      if (q.side < 0 && q.zc > D.winRear.z0 && q.zc < D.winRear.z1 && q.y > D.winRear.y0 && q.y < D.winRear.y1) return 'winRearL';
      if (q.zc > D.winAft.z0 && q.zc < D.winAft.z1 && q.y > D.winAft.y0 && q.y < D.winAft.y1) return q.side > 0 ? 'winAftR' : 'winAftL';
    }
    return false;
  };

  paint.curIsland = island;
  paint.setPart(PART.FUSE, 0);
  paint.uv1Offset = [0, 0];
  const gridOpts = { flip: true, sValues: zs, tValues: jList.map((j) => j / RING) };
  grid(paint, 0, 0, surf, { ...gridOpts, skip: (i, jj) => !!isOpening(i, jj) });
  // bake-only closed skin so the openings/doors/frames have paint in the atlas
  if (lod === 0) {
    ctx.bakeOnly.curIsland = island;
    ctx.bakeOnly.setPart(PART.FUSE, 0);
    grid(ctx.bakeOnly, 0, 0, surf, gridOpts);
  }
  // tail post closing cap (small)
  {
    const last = ns - 1;
    const c = new THREE.Vector3(0, (secs[last].yb + secs[last].yt) / 2, zs[last]);
    const start = paint.vertexCount;
    paint.setPart(PART.FUSE, 0.2);
    const cIdx = paint.vert(c.x, c.y, c.z, 0, 0, 1, c.z, P_REF * 0.5);
    for (let jj = 0; jj < nj; jj++) {
      const o = (last * nj + jj) * 2;
      paint.vert(XY[o], XY[o + 1], zs[last], 0, 0, 1, zs[last], V[last * nj + jj]);
    }
    for (let jj = 0; jj < nj - 1; jj++) paint.tri(cIdx, start + 1 + jj, start + 2 + jj);
  }

  // cowl lip: rounded nose ring curling into the cowl
  {
    paint.setPart(-PART.LIP, 0.6);
    const r0 = 0.65, zc = D.noseZ;
    const prof = [];
    const segs = lod === 0 ? 7 : 3;
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * Math.PI;
      prof.push([r0 - 0.025 + Math.cos(a) * 0.025, zc - Math.sin(a) * 0.022]);
    }
    prof.push([r0 - 0.05, zc + 0.12]);
    prof.reverse();
    const st = lathe(paint, prof.map(([r, z]) => [r, z]), lod === 0 ? 48 : 16, mat(0, D.thrustY, 0), { flip: false });
    // project uvs onto the fuselage island (nose band)
    // (u follows the profile so the paint and the panel noise don't smear into radial stripes)
    for (let v = st; v < paint.vertexCount; v++) {
      const x = paint.position[v * 3], y = paint.position[v * 3 + 1] - D.thrustY, z = paint.position[v * 3 + 2];
      const ang = Math.atan2(x, -y); // 0 at bottom
      const frac = (ang < 0 ? ang + Math.PI * 2 : ang) / (Math.PI * 2);
      const along = (z - zc) + (r0 - Math.hypot(x, y)) * 1.5; // ~0 at the lip front .. ~0.2 inside
      paint.attrs.uv[v * 2] = D.noseZ + 0.006 + Math.min(Math.max(along, 0), 0.2) * 0.5;
      paint.attrs.uv[v * 2 + 1] = frac * P_REF;
      paint.attrs.uv1[v * 2] = D.noseZ + along; paint.attrs.uv1[v * 2 + 1] = frac * P_REF;
    }
  }

  // cowl inner skin + thickness around the removed top panel
  if (lod < 2) {
    paint.curIsland = ctx.genericIsland('dark');
    paint.setPart(PART.COWL_IN, 0.5);
    const c = D.cowlOpen;
    const zz = zs.filter((z) => z >= D.noseZ + 0.08 && z <= c.z1 + 0.06);
    const jIn = jList.filter((j) => { const k = j <= HALF ? j : RING - j; return k >= K_WALL - 1; });
    grid(paint, 0, 0, (s, t, out, i, jj) => {
      const z = zz[i];
      const sec = fuselageSection(z);
      ringPos(z, jIn[jj], tmp, sec);
      const dx = tmp[0], dy = tmp[1] - D.thrustY;
      const l = Math.hypot(dx, dy) || 1;
      const inset = 0.022;
      out.p.set(tmp[0] - (dx / l) * inset, tmp[1] - (dy / l) * inset, z);
      out.u = z - D.noseZ; out.v = (jIn[jj] - jIn[0]) * 0.06;
    }, { sValues: zz, tValues: jIn.map((j) => j / RING) });
    // edge strip along the opening border (left & right edges + front/back)
    paint.curIsland = island;
    paint.setPart(-PART.RIM, 0.8);
    const edgeLoop = [];
    const sideLine = (side) => {
      const pts = [];
      for (const z of zs) if (z >= c.z0 - 1e-4 && z <= c.z1 + 1e-4) {
        const sec = fuselageSection(z);
        // find angle boundary: search ring k where atan2 crosses halfAngle
        let best = HALF, bestD = 1e9;
        for (let k = K_WALL; k <= HALF; k += 0.05) {
          ringXY(z, k, tmp, sec);
          const d = Math.abs(Math.abs(Math.atan2(tmp[0], tmp[1] - D.thrustY)) - c.halfAngle);
          if (d < bestD) { bestD = d; best = k; }
        }
        ringXY(z, best, tmp, sec);
        pts.push(new THREE.Vector3(tmp[0] * side, tmp[1], z));
      }
      return pts;
    };
    edgeLoop.push(sideLine(1), sideLine(-1));
    for (const pts of edgeLoop) {
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k], b = pts[k + 1];
        const na = new THREE.Vector3(a.x, a.y - D.thrustY, 0).normalize();
        const nb = new THREE.Vector3(b.x, b.y - D.thrustY, 0).normalize();
        const s0 = paint.vertexCount;
        paint.vert(a.x, a.y, a.z, 0, 1, 0, a.z, 5.0);
        paint.vert(b.x, b.y, b.z, 0, 1, 0, b.z, 5.0);
        paint.vert(b.x - nb.x * 0.022, b.y - nb.y * 0.022, b.z, 0, 1, 0, b.z, 5.0);
        paint.vert(a.x - na.x * 0.022, a.y - na.y * 0.022, a.z, 0, 1, 0, a.z, 5.0);
        // normal: perpendicular to the strip, pointing into the opening
        const e1 = new THREE.Vector3().subVectors(b, a), e2 = new THREE.Vector3(-na.x, -na.y, 0);
        const n = new THREE.Vector3().crossVectors(e1, e2).normalize();
        const toward = new THREE.Vector3(-Math.sign(a.x), 0.3, 0);
        if (n.dot(toward) < 0) n.negate();
        for (let q = s0; q < s0 + 4; q++) { paint.normal[q * 3] = n.x; paint.normal[q * 3 + 1] = n.y; paint.normal[q * 3 + 2] = n.z; }
        if (n.dot(new THREE.Vector3().crossVectors(e1, e2)) > 0) paint.quad(s0, s0 + 1, s0 + 2, s0 + 3);
        else paint.quad(s0, s0 + 3, s0 + 2, s0 + 1);
      }
    }
  }

  // ---- window/door rims and glass ------------------------------------------------
  const rims = [];
  if (lod < 2) {
    // windscreen panes (right and left), following the curved roof corner
    const wsZ0 = D.wsBottomZ + 0.012, wsZ1 = D.wsTopZ - 0.012;
    for (const side of [1, -1]) {
      glass.set('aGlass', side > 0 ? 0 : 1, side > 0 ? 1 : 0, 0.6, 1);
      const nzs = lod === 0 ? 10 : 3, nk = lod === 0 ? 10 : 3;
      const kk0 = K_ARCT + 0.15, kk1 = HALF - 0.12;
      grid(glass, nzs, nk, (s, t, out) => {
        const z = THREE.MathUtils.lerp(wsZ0, wsZ1, s);
        const sec = fuselageSection(z);
        ringXY(z, THREE.MathUtils.lerp(kk0, kk1, t), tmp, sec);
        const dx = tmp[0], dy = tmp[1] - (sec.yt - sec.rt);
        const nrm = new THREE.Vector3(dx > 0 ? dx : 0, Math.max(dy, 0.02), 0).normalize();
        out.p.set(side * (tmp[0] - nrm.x * 0.008), tmp[1] - nrm.y * 0.008, z);
        out.u = side > 0 ? t : 1 - t; out.v = s;
      }, { flip: side > 0 });
    }
    // windscreen frame: centre post + bottom bar + top bar + side posts
    hard.setColor(0x1c1c18).setMat(0.55, 0.2, KIND.PAINTED, 0.4);
    const wsLine = (k, side) => {
      const pts = [];
      for (let q = 0; q <= 8; q++) {
        const z = THREE.MathUtils.lerp(D.wsBottomZ, D.wsTopZ, q / 8);
        ringXY(z, k, tmp);
        pts.push(new THREE.Vector3(side * tmp[0], tmp[1] + 0.006, z));
      }
      return pts;
    };
    rims.push({ pts: wsLine(HALF, 1), r: 0.026, ry: 0.55 });
    rims.push({ pts: wsLine(K_ARCT + 0.02, 1), r: 0.022 });
    rims.push({ pts: wsLine(K_ARCT + 0.02, -1), r: 0.022 });
    const arcLine = (z) => {
      const pts = [];
      for (let k = K_ARCT; k <= RING - K_ARCT; k += 0.5) { ringPos(z, k, tmp); pts.push(new THREE.Vector3(tmp[0], tmp[1] + 0.004, z)); }
      return pts;
    };
    rims.push({ pts: arcLine(D.wsBottomZ + 0.004), r: 0.024 });
    rims.push({ pts: arcLine(D.wsTopZ - 0.004), r: 0.02 });
    for (const rim of rims) tube(hard, rim.pts, rim.r, { sides: lod === 0 ? 6 : 4, rx: 1, ry: rim.ry || 0.7, up: new THREE.Vector3(0, 1, 0) });
    rims.length = 0;

    // rectangular wall openings: rubber seal + raised painted flange + glass
    const wallOpenings = [
      { name: 'winRearL', side: -1, ...D.winRear, glass: 3 },
      { name: 'winAftL', side: -1, ...D.winAft, glass: 4 },
      { name: 'winAftR', side: 1, ...D.winAft, glass: 5 },
    ];
    for (const o of wallOpenings) {
      wallFlange(ctx, o.side, o.z0, o.z1, o.y0, o.y1, island, V, zs, nj, lod);
      glass.set('aGlass', o.glass, 0, 0.8, 1);
      flatPane(glass, o.side, o.z0 + 0.01, o.z1 - 0.01, o.y0 + 0.01, o.y1 - 0.01, 0.012, lod);
    }
    // door openings get a seal frame (the gap between door and fuselage)
    for (const side of [1, -1]) doorJamb(ctx, side, D.doorPilot.z0, D.doorPilot.z1, D.doorPilot.y0, null, lod);
    doorJamb(ctx, 1, D.doorCargo.z0, D.doorCargo.z1, D.doorCargo.y0, D.doorCargo.y1, lod);
  }

  // ---- doors -------------------------------------------------------------------
  const doors = {};
  if (lod < 2) {
    doors.doorL = buildDoor(ctx, 'doorL', -1, D.doorPilot.z0, D.doorPilot.z1, D.doorPilot.y0, null, island, lod, 6);
    doors.doorR = buildDoor(ctx, 'doorR', 1, D.doorPilot.z0, D.doorPilot.z1, D.doorPilot.y0, null, island, lod, 7);
    doors.cargo = buildDoor(ctx, 'cargo', 1, D.doorCargo.z0, D.doorCargo.z1, D.doorCargo.y0, D.doorCargo.y1, island, lod, 8);
  }

  // ---- small fittings ------------------------------------------------------------
  if (lod === 0) fittings(ctx);
  return { doors, island };
}

// Painted flange around a rectangular wall opening (raised strip) + dark rubber seal.
function wallFlange(ctx, side, z0, z1, y0, y1, island, V, zs, nj, lod) {
  const { paint, hard } = ctx;
  const hw = DIM.cabinHalfW;
  const w = 0.035, h = 0.006;
  // loop corners in (z, y)
  const loop = [[z0, y0], [z1, y0], [z1, y1], [z0, y1]];
  paint.curIsland = island;
  paint.setPart(-PART.RIM, 0.7);
  const uvAt = (z, y) => {
    // approximate fuselage atlas coordinate for a wall point
    const sec = fuselageSection(z);
    const k = kForY(y);
    const tmp = [0, 0];
    // arc position fraction: integrate ring up to k on this station
    let acc = 0, prev = null, tot = 0;
    for (let q = 0; q <= RING; q++) {
      ringPos(z, q, tmp, sec);
      if (prev) { const d = Math.hypot(tmp[0] - prev[0], tmp[1] - prev[1]); tot += d; if (q <= (side > 0 ? k : RING - k)) acc += d; }
      prev = [tmp[0], tmp[1]];
    }
    return [z, (acc / tot) * P_REF];
  };
  for (let e = 0; e < 4; e++) {
    const a = loop[e], b = loop[(e + 1) % 4];
    // outward direction in the wall plane (away from opening centre)
    const cz = (z0 + z1) / 2, cy = (y0 + y1) / 2;
    const mz = (a[0] + b[0]) / 2 - cz, my = (a[1] + b[1]) / 2 - cy;
    const horiz = Math.abs(a[1] - b[1]) < 1e-6;
    const oz = horiz ? 0 : Math.sign(mz), oy = horiz ? Math.sign(my) : 0;
    // corners extended (mitre by extending along the edge)
    const ext = (p, dir) => [p[0] + dir[0] * w, p[1] + dir[1] * w];
    const ed = [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];
    const aO = ext([a[0] + oz * w, a[1] + oy * w], [-ed[0], -ed[1]]);
    const bO = ext([b[0] + oz * w, b[1] + oy * w], ed);
    const x = side * (hw + h), xo = side * (hw + 0.001);
    const s0 = paint.vertexCount;
    const nx = side;
    const ua = uvAt(a[0], a[1]), ub = uvAt(b[0], b[1]), uaO = uvAt(aO[0], aO[1]), ubO = uvAt(bO[0], bO[1]);
    paint.vert(x, a[1], a[0], nx, 0, 0, ua[0], ua[1]);
    paint.vert(x, b[1], b[0], nx, 0, 0, ub[0], ub[1]);
    paint.vert(xo, bO[1], bO[0], nx, 0, 0, ubO[0], ubO[1]);
    paint.vert(xo, aO[1], aO[0], nx, 0, 0, uaO[0], uaO[1]);
    // inner wall of the flange (depth into the opening)
    const d = 0.03;
    paint.vert(x, a[1], a[0], -oz * 0, -oy, -oz, ua[0], ua[1]);
    paint.vert(x, b[1], b[0], -oz * 0, -oy, -oz, ub[0], ub[1]);
    paint.vert(side * (hw - d), b[1], b[0], 0, -oy, -oz, ub[0], ub[1]);
    paint.vert(side * (hw - d), a[1], a[0], 0, -oy, -oz, ua[0], ua[1]);
    const fix = (q0, nrm) => {
      // ensure winding agrees with nrm
      const P = paint.position;
      const pa = new THREE.Vector3(P[q0 * 3], P[q0 * 3 + 1], P[q0 * 3 + 2]);
      const pb = new THREE.Vector3(P[q0 * 3 + 3], P[q0 * 3 + 4], P[q0 * 3 + 5]);
      const pc = new THREE.Vector3(P[q0 * 3 + 6], P[q0 * 3 + 7], P[q0 * 3 + 8]);
      const n = new THREE.Vector3().crossVectors(pb.sub(pa), pc.sub(pa));
      if (n.dot(nrm) >= 0) paint.quad(q0, q0 + 1, q0 + 2, q0 + 3); else paint.quad(q0, q0 + 3, q0 + 2, q0 + 1);
    };
    fix(s0, new THREE.Vector3(side, 0, 0));
    fix(s0 + 4, new THREE.Vector3(0, -oy, -oz));
  }
  // rubber seal inside the opening
  ctx.hard.setColor(0x121212).setMat(0.75, 0, KIND.RUBBER, 0.3);
  const pts = [];
  const xs = side * (hw - 0.004);
  const r = 0.012;
  for (const [z, y] of [[z0 + r, y0 + r], [z1 - r, y0 + r], [z1 - r, y1 - r], [z0 + r, y1 - r], [z0 + r, y0 + r]]) pts.push(new THREE.Vector3(xs, y, z));
  tube(hard, densify(pts, 0.05), r, { sides: lod === 0 ? 5 : 3, up: new THREE.Vector3(side, 0, 0) });
}

function densify(pts, maxSeg) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / maxSeg));
    for (let k = 1; k <= n; k++) out.push(new THREE.Vector3().lerpVectors(a, b, k / n));
  }
  // nudge duplicate corners so parallel transport stays stable
  return out;
}

// Flat glass pane on the side wall.
function flatPane(glass, side, z0, z1, y0, y1, inset, lod) {
  const hw = DIM.cabinHalfW - inset;
  grid(glass, lod === 0 ? 2 : 1, lod === 0 ? 2 : 1, (s, t, out) => {
    out.p.set(side * hw, THREE.MathUtils.lerp(y0, y1, t), THREE.MathUtils.lerp(z0, z1, s));
    out.u = side > 0 ? 1 - s : s; out.v = t;
  }, { flip: side > 0 });
}

// Dark rubber seal tube around a door opening (reads as the door gap).
function doorJamb(ctx, side, z0, z1, y0, y1, lod) {
  const hw = DIM.cabinHalfW;
  const pts = [];
  const top = (z) => { const sec = fuselageSection(z); return y1 !== null ? Math.min(y1, sec.yt - sec.rt) : sec.yt - sec.rt; };
  const n = 12;
  pts.push(new THREE.Vector3(side * (hw + 0.002), y0, z0));
  pts.push(new THREE.Vector3(side * (hw + 0.002), y0, z1));
  for (let k = 0; k <= n; k++) { const z = THREE.MathUtils.lerp(z1, z0, k / n); pts.push(new THREE.Vector3(side * (hw + 0.002), top(z), z)); }
  pts.push(new THREE.Vector3(side * (hw + 0.002), y0, z0));
  ctx.hard.setColor(0x0d0d0c).setMat(0.8, 0, KIND.RUBBER, 0.5);
  tube(ctx.hard, densify(pts, 0.08), 0.009, { sides: lod === 0 ? 5 : 3, up: new THREE.Vector3(side, 0, 0) });
}

// Door: outer skin (fuselage island uvs), inner trim, edges, window + glass, handle, hinges.
function buildDoor(ctx, name, side, z0, z1, y0, y1, island, lod, glassId) {
  const paint = ctx.newBuilder('paint'), glass = ctx.newBuilder('glass'), hard = ctx.newBuilder('hard');
  const hw = DIM.cabinHalfW;
  const gap = 0.006;
  const W = DIM.doorWin;
  const isCargo = name === 'cargo';
  const zA = z0 + gap, zB = z1 - gap;
  const wz0 = z0 + (isCargo ? 0.08 : W.dz0), wz1 = z1 - (isCargo ? 0.08 : W.dz1);
  const topY = (z) => { const sec = fuselageSection(z); const t = sec.yt - sec.rt; return (y1 !== null ? Math.min(y1, t) : t) - gap; };
  const winTop = (z) => topY(z) - (isCargo ? 0.06 : W.topInset);
  const winBot = isCargo ? 2.62 : W.y0;
  const zsList = [zA, wz0];
  const nIn = lod === 0 ? 8 : 2;
  for (let k = 1; k < nIn; k++) zsList.push(THREE.MathUtils.lerp(wz0, wz1, k / nIn));
  zsList.push(wz1, zB);
  const rows = 6; // y0, mid, winBot, mid-window..., winTop, top
  const yAt = (z, r) => {
    const yb = y0 + gap, wt = winTop(z), tp = topY(z);
    const ys = [yb, (yb + winBot) * 0.5, winBot, THREE.MathUtils.lerp(winBot, wt, 0.5), wt, tp];
    return ys[r];
  };
  // fuselage-island uv for wall point
  const uvWall = (z, y) => {
    const sec = fuselageSection(z);
    const tmp = [0, 0];
    let acc = 0, tot = 0, prev = null;
    const kT = kForY(y);
    for (let q = 0; q <= HALF; q++) {
      ringXY(z, q, tmp, sec);
      if (prev) { const d = Math.hypot(tmp[0] - prev[0], tmp[1] - prev[1]); tot += d; if (q <= kT) acc += d; }
      prev = [tmp[0], tmp[1]];
    }
    const frac = (acc / tot) * 0.5;
    return [z, (side > 0 ? frac : 1 - frac) * P_REF];
  };
  const inWindow = (i, r) => i >= 1 && i < zsList.length - 2 && r >= 2 && r < 4;
  // outer skin
  paint.curIsland = island;
  paint.setPart(PART.DOOR, 0.04);
  const outer = (x) => (s, t, out, i, r) => {
    const z = zsList[i];
    const y = yAt(z, r);
    out.p.set(x, y, z);
    const uv = uvWall(z, y);
    out.u = uv[0]; out.v = uv[1];
    out.uv1 = [z + 37.0, y];
    out.edge = (i === 0 || i === zsList.length - 1 || r === 0 || r === rows - 1) ? 0.9 : (inWindow(i, r) ? 0 : 0.0);
  };
  grid(paint, 0, 0, outer(side * hw), { sValues: zsList.map((_, i) => i), tValues: [0, 1, 2, 3, 4, 5], flip: side > 0, skip: inWindow });
  // inner trim (generic interior paint island)
  paint.curIsland = ctx.genericIsland('interior');
  paint.setPart(PART.DOOR_IN, 0.4);
  const t = 0.045;
  grid(paint, 0, 0, (s, tt, out, i, r) => {
    const z = zsList[i];
    const y = yAt(z, r);
    out.p.set(side * (hw - t), y, z);
    out.u = z - z0; out.v = y - y0;
  }, { sValues: zsList.map((_, i) => i), tValues: [0, 1, 2, 3, 4, 5], flip: side < 0, skip: inWindow });
  // edges (outer border + window border)
  paint.curIsland = island;
  paint.setPart(-PART.RIM, 0.9);
  const borderLoop = [];
  for (let i = 0; i < zsList.length; i++) borderLoop.push([zsList[i], 0]);
  for (let i = zsList.length - 1; i >= 0; i--) borderLoop.push([zsList[i], rows - 1]);
  const winLoop = [];
  for (let i = 1; i < zsList.length - 1; i++) winLoop.push([zsList[i], 2]);
  for (let i = zsList.length - 2; i >= 1; i--) winLoop.push([zsList[i], 4]);
  const edgeStrip = (loop, inward) => {
    // build quads between outer x and inner x for each segment
    const ptsO = [];
    for (const [z, r] of loop) ptsO.push([z, yAt(z, r)]);
    // vertical edges at the ends of the outer loop
    const segs = [];
    for (let k = 0; k < ptsO.length; k++) segs.push([ptsO[k], ptsO[(k + 1) % ptsO.length]]);
    const cz = loop.reduce((a, q) => a + q[0], 0) / loop.length;
    const cy = ptsO.reduce((a, q) => a + q[1], 0) / ptsO.length;
    for (const [a, b] of segs) {
      if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) continue;
      const s0 = paint.vertexCount;
      const mz = (a[0] + b[0]) / 2 - cz, my = (a[1] + b[1]) / 2 - cy;
      // edge normal in the wall plane
      const ez = b[0] - a[0], ey = b[1] - a[1];
      let nz = -ey, ny = ez;
      const l = Math.hypot(nz, ny) || 1; nz /= l; ny /= l;
      if (nz * mz + ny * my < 0) { nz = -nz; ny = -ny; }
      if (inward) { nz = -nz; ny = -ny; }
      const uva = uvWall(a[0], a[1]), uvb = uvWall(b[0], b[1]);
      paint.vert(side * hw, a[1], a[0], 0, ny, nz, uva[0], uva[1]);
      paint.vert(side * hw, b[1], b[0], 0, ny, nz, uvb[0], uvb[1]);
      paint.vert(side * (hw - t), b[1], b[0], 0, ny, nz, uvb[0], uvb[1]);
      paint.vert(side * (hw - t), a[1], a[0], 0, ny, nz, uva[0], uva[1]);
      const P = paint.position;
      const pa = new THREE.Vector3(P[s0 * 3], P[s0 * 3 + 1], P[s0 * 3 + 2]);
      const pb = new THREE.Vector3(P[s0 * 3 + 3], P[s0 * 3 + 4], P[s0 * 3 + 5]);
      const pc = new THREE.Vector3(P[s0 * 3 + 6], P[s0 * 3 + 7], P[s0 * 3 + 8]);
      const n = new THREE.Vector3().crossVectors(pb.sub(pa), pc.sub(pa));
      if (n.dot(new THREE.Vector3(0, ny, nz)) >= 0) paint.quad(s0, s0 + 1, s0 + 2, s0 + 3); else paint.quad(s0, s0 + 3, s0 + 2, s0 + 1);
    }
  };
  edgeStrip(borderLoop, false);
  edgeStrip(winLoop, true);
  // window glass
  glass.set('aGlass', glassId, 0, 0.7, 1);
  const gz0 = zsList[1], gz1 = zsList[zsList.length - 2];
  grid(glass, lod === 0 ? 4 : 1, 1, (s, tt, out) => {
    const z = THREE.MathUtils.lerp(gz0, gz1, s);
    const y = THREE.MathUtils.lerp(winBot, winTop(z), tt);
    out.p.set(side * (hw - 0.016), y, z);
    out.u = side > 0 ? 1 - s : s; out.v = tt;
  }, { flip: side > 0 });
  // window seal
  hard.setColor(0x101010).setMat(0.8, 0, KIND.RUBBER, 0.3);
  const seal = [];
  for (let i = 1; i < zsList.length - 1; i++) seal.push(new THREE.Vector3(side * (hw - 0.012), winBot + 0.008, zsList[i]));
  for (let i = zsList.length - 2; i >= 1; i--) seal.push(new THREE.Vector3(side * (hw - 0.012), winTop(zsList[i]) - 0.008, zsList[i]));
  seal.push(seal[0].clone());
  tube(hard, densify(seal, 0.06), 0.01, { sides: lod === 0 ? 5 : 3, up: new THREE.Vector3(side, 0, 0) });
  // handle (outside + inside) and hinges
  // the cargo door is top-hinged (it swings up under the wing): handle on the bottom edge
  const hz = isCargo ? (z0 + z1) / 2 : z1 - 0.12;
  const hy = isCargo ? y0 + 0.15 : 2.32;
  hard.setColor(0x8c8a84).setMat(0.35, 1, KIND.METAL, 0.3);
  roundedBox(hard, 0.03, 0.03, 0.17, 0.012, mat(side * (hw + 0.035), hy, hz, 0, 0, 0));
  box(hard, 0.02, 0.02, 0.04, mat(side * (hw + 0.016), hy, hz - 0.06));
  box(hard, 0.02, 0.02, 0.04, mat(side * (hw + 0.016), hy, hz + 0.06));
  hard.setColor(0x3a3a36).setMat(0.5, 0.6, KIND.METAL, 0.2);
  roundedBox(hard, 0.025, 0.03, 0.14, 0.01, mat(side * (hw - t - 0.03), hy, hz));
  const hingeZ = z0;
  const topHinge = isCargo ? topY((z0 + z1) / 2) : 0;
  hard.setColor(0x6f6c64).setMat(0.45, 0.9, KIND.METAL, 0.5);
  if (isCargo) {
    for (const z of [z0 + 0.22, z1 - 0.22]) lathe(hard, [[0, -0.06], [0.014, -0.06], [0.014, 0.06], [0, 0.06]], 8, mat(side * (hw + 0.01), topHinge, z));
  } else {
    for (const y of [y0 + 0.22, (y0 + topY(hingeZ)) * 0.5 + 0.25]) {
      lathe(hard, [[0, -0.05], [0.014, -0.05], [0.014, 0.05], [0, 0.05]], 8, mat(side * (hw + 0.01), y, hingeZ, Math.PI / 2, 0, 0));
    }
  }
  // latch plate / stencil plate (painted in the bake), window stop strap inside
  if (lod === 0 && !isCargo) {
    hard.setColor(0x262019).setMat(0.85, 0, KIND.STRAP, 0.4);
    tube(hard, [new THREE.Vector3(side * (hw - t - 0.005), 2.5, z1 - 0.3), new THREE.Vector3(side * (hw - t - 0.03), 2.38, z1 - 0.22), new THREE.Vector3(side * (hw - t - 0.005), 2.3, z1 - 0.12)], 0.012, { sides: 4, rx: 1, ry: 0.25, up: new THREE.Vector3(side, 0, 0) });
  }
  const hinge = isCargo
    ? { origin: new THREE.Vector3(side * hw, topHinge, (z0 + z1) / 2), axis: new THREE.Vector3(0, 0, 1) }
    : { origin: new THREE.Vector3(side * hw, 0, hingeZ), axis: new THREE.Vector3(0, 1, 0) };
  const openAngle = isCargo ? side * 1.6 : -side * 1.3;
  return { name, paint, glass, hard, hinge, openAngle, side, isCargo, z0, z1, y0 };
}

// Small fittings on the fuselage: antennas, filler, tie-down, steps, drains, lights.
function fittings(ctx) {
  const { hard } = ctx;
  const D = DIM;
  // fuel filler cap (left side, aft of the door) and a strap-on handle
  hard.setColor(0x9a968c).setMat(0.4, 1, KIND.METAL, 0.5);
  lathe(hard, [[0, 0], [0.045, 0], [0.05, 0.012], [0.045, 0.022], [0, 0.024]], 12, mat(-D.cabinHalfW, 2.05, 2.86, 0, -Math.PI / 2, 0));
  box(hard, 0.012, 0.012, 0.07, mat(-D.cabinHalfW - 0.026, 2.05, 2.86));
  // grab handles near the doors (help climbing in from the float)
  hard.setColor(0x6d6a63).setMat(0.45, 0.9, KIND.METAL, 0.6);
  for (const [side, z] of [[-1, 0.3], [1, 0.3], [1, 2.72]]) {
    tube(hard, [v3(side * D.cabinHalfW, 2.62, z), v3(side * (D.cabinHalfW + 0.05), 2.6, z), v3(side * (D.cabinHalfW + 0.05), 2.36, z), v3(side * D.cabinHalfW, 2.34, z)], 0.011, { sides: 6 });
  }
  // belly antenna and drain, tail tie-down ring
  hard.setColor(0x1d1d1b).setMat(0.6, 0.3, KIND.PAINTED, 0.4);
  tube(hard, [v3(0, D.bellyY, 2.0), v3(0, D.bellyY - 0.2, 2.18)], (f) => 0.012 - f * 0.006, { sides: 5 });
  hard.setColor(0x7a776f).setMat(0.45, 0.9, KIND.METAL, 0.6);
  lathe(hard, [[0.03, -0.006], [0.036, 0], [0.03, 0.006], [0.024, 0], [0.03, -0.006]], 10, mat(0, 2.66, 6.62, 0, Math.PI / 2, 0));
  // static ports & small rivet-head plates are textured; pitot lives on the wing.
  // tail nav light (white) & strobe housing on the rudder top handled in tail.js
}

