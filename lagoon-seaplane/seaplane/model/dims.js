// Dimension sheet of the seaplane: the single source of truth for the model
// builders and the physics.
//
// MODEL frame (used while building): metres, x = right wing, y = up (0 = float keel
// at the step), z = aft (0 = firewall). The nose points toward -z.
// PLANE-LOCAL frame (public): model minus CG_MODEL, i.e. origin at the nominal
// centre of gravity, nose -Z, right wing +X, up +Y.
import * as THREE from 'three';
import { curve } from './geom.js';

export const CG_MODEL = new THREE.Vector3(0, 2.25, 1.1);
export const DEG = Math.PI / 180;

// Part ids written into the bake attribute (aBake.y); the texture bake keys its
// paint rules on these.
export const PART = {
  FUSE: 1, COWL_IN: 2, WING: 3, WING_C: 4, HSTAB: 5, ELEV: 6, FIN: 7, RUDDER: 8,
  AILERON: 9, FLAP: 10, FLOAT: 11, WSTRUT: 12, FSTRUT: 13, DOOR: 14, DOOR_IN: 15,
  TRIM: 16, RIM: 17, LIP: 18, FRAME: 19, PANEL: 20, FITTING: 30, BLACK: 31,
};

export const DIM = {
  length: 9.5,
  // fuselage
  noseZ: -1.62, // cowl lip
  spinnerBaseZ: -1.70,
  spinnerTipZ: -2.15,
  propZ: -1.86,
  propRadius: 1.3,
  thrustY: 2.25,
  firewallZ: 0,
  bellyY: 1.6,
  floorY: 1.78,
  roofY: 3.32,
  cabinHalfW: 0.69,
  cabinEndZ: 3.2,
  tailPostZ: 6.86,
  wsBottomZ: 0.03, // windscreen bottom edge (on the cowl top)
  wsTopZ: 0.6, // windscreen top edge (under the wing leading edge)
  cowlOpen: { z0: -1.28, z1: -0.06, halfAngle: 52 * DEG }, // removed top cowl panel
  // openings on the fuselage side walls (z range, y range); side +1 = right
  doorPilot: { z0: 0.4, z1: 1.3, y0: 1.86 },
  doorCargo: { z0: 1.42, z1: 2.62, y0: 1.74, y1: 3.14 },
  winRear: { z0: 1.5, z1: 2.54, y0: 2.6, y1: 3.08 },
  winAft: { z0: 2.74, z1: 3.1, y0: 2.64, y1: 3.04 },
  doorWin: { dz0: 0.06, dz1: 0.06, y0: 2.6, topInset: 0.035 },
  // eye point of the pilot (left seat)
  eyePilot: new THREE.Vector3(-0.33, 3.06, 1.12),
  eyeCopilot: new THREE.Vector3(0.33, 3.06, 1.12),
  // wing
  wing: {
    span: 14.6, chord: 1.6, leZ: 0.62, rootX: 0.69, chordY: 3.4,
    thick: 0.15, camber: 0.02, incidence: 2 * DEG, dihedral: 1.5 * DEG,
    hingeFrac: 0.775,
    aileron: { x0: 4.15, x1: 6.96 },
    flap: { x0: 0.72, x1: 4.1 },
    tipX0: 7.0, tipX: 7.3,
    strutX: 2.55, frontSparFrac: 0.25, rearSparFrac: 0.62,
  },
  wingStrutRoot: new THREE.Vector3(0.66, 1.8, 1.3),
  // tail
  hstab: { y: 3.0, leRootZ: 5.7, leTipZ: 5.86, hingeZ: 6.52, teRootZ: 6.98, teTipZ: 6.9, tipX: 2.5, thick: 0.1, cutX: 0.16 },
  fin: { rootY: 2.92, topY: 3.97, leRootZ: 5.45, leTopZ: 6.38, hingeZ: 6.86, thick: 0.1 },
  rudder: { bottomY: 2.6, topY: 4.0, teBottomZ: 7.42, teTopZ: 7.3 },
  // floats
  float: {
    x: 1.35, bowZ: -2.65, sternZ: 5.15, stepZ: 1.64, stepH: 0.07,
    halfWidth: 0.425, depth: 0.75,
  },
  floatStruts: { frontZ: -0.3, rearZ: 2.05, fusX: 0.55 },
  // masses (kg) & payload defaults
  emptyMass: 1450,
  fuelCapacity: 140, // litres per wing tank
  fuelDensity: 0.72,
};

// ---------------------------------------------------------------------------
// Fuselage cross-section along z: half width, bottom y, top y, corner radii.
const fz = [-1.62, -1.45, -1.25, -1.0, -0.5, 0.0, 0.62, 2.3, 2.9, 3.6, 4.5, 5.5, 6.3, 6.86];
const tbl = (vals) => curve(fz.map((z, i) => [z, vals[i]]));
const fHW = tbl([0.65, 0.668, 0.676, 0.68, 0.686, 0.69, 0.69, 0.69, 0.685, 0.63, 0.5, 0.34, 0.21, 0.1]);
const fYB = tbl([1.59, 1.578, 1.574, 1.576, 1.584, 1.594, 1.6, 1.6, 1.62, 1.74, 2.0, 2.33, 2.57, 2.72]);
const fYT = tbl([2.89, 2.914, 2.92, 2.918, 2.902, 2.88, 3.32, 3.3, 3.26, 3.2, 3.1, 3.0, 2.95, 2.92]);
const fRB = tbl([0.65, 0.63, 0.56, 0.46, 0.28, 0.17, 0.14, 0.14, 0.15, 0.2, 0.22, 0.18, 0.1, 0.05]);
const fRT = tbl([0.65, 0.65, 0.6, 0.52, 0.34, 0.2, 0.12, 0.12, 0.14, 0.18, 0.2, 0.17, 0.1, 0.05]);
const aftTop = curve([[2.5, 3.345], [2.9, 3.292], [3.6, 3.21], [4.5, 3.1], [5.5, 3.0], [6.3, 2.95], [6.86, 2.92]]);
const _wp = new THREE.Vector3();
// Cabin roof under the wing = the wing root's lower surface (slight overlap).
export function roofY(z) {
  const w = DIM.wing;
  const c = THREE.MathUtils.clamp((z - w.leZ) / w.chord, 0, 1);
  return wingSurfacePoint(0, c, -1, _wp).y - 0.006;
}

export function fuselageSection(z, out = {}) {
  const w = DIM.wing;
  let hw = fHW(z), yb = fYB(z), yt = fYT(z);
  const teZ = w.leZ + w.chord;
  if (z > 0 && z < w.leZ) yt = 2.88 + (roofY(w.leZ) - 2.88) * (z / w.leZ); // windscreen ramp
  else if (z >= w.leZ && z <= teZ) yt = roofY(z);
  else if (z > teZ) { const r = roofY(teZ); yt = z < 2.5 ? THREE.MathUtils.lerp(r, aftTop(2.5), (z - teZ) / (2.5 - teZ)) : aftTop(z); }
  const h = yt - yb;
  let rb = Math.min(fRB(z), hw, h * 0.5), rt = Math.min(fRT(z), hw, h * 0.5);
  if (rb + rt > h) { const k = h / (rb + rt); rb *= k; rt *= k; }
  out.hw = hw; out.yb = yb; out.yt = yt; out.rb = rb; out.rt = rt;
  return out;
}

// ---------------------------------------------------------------------------
// Float hull: profile along the float (local z from the float's own bow), keel,
// chine, deck heights and half width. All in model y.
const F = DIM.float;
const flz = (z) => z; // model z
const kTblF = curve([[-2.66, 0.5], [-2.5, 0.33], [-2.2, 0.17], [-1.8, 0.075], [-1.3, 0.02], [-0.8, 0.0], [1.64, 0.0]]);
const hwTbl = curve([[-2.66, 0.1], [-2.55, 0.2], [-2.3, 0.3], [-1.8, 0.38], [-1.0, 0.42], [-0.6, 0.425], [1.9, 0.425], [2.8, 0.4], [3.6, 0.35], [4.4, 0.25], [5.0, 0.12], [5.16, 0.06]]);
const deckTbl = curve([[-2.66, 0.6], [-2.4, 0.7], [-1.9, 0.745], [-1.4, 0.75], [2.4, 0.75], [3.4, 0.72], [4.3, 0.66], [5.16, 0.56]]);
const AFT_SLOPE = Math.tan(7.5 * DEG);

export function floatSection(z, out = {}) {
  const zz = flz(z);
  let keel;
  if (zz <= F.stepZ) keel = kTblF(zz);
  else keel = F.stepH + (zz - F.stepZ) * AFT_SLOPE;
  const hw = hwTbl(zz);
  const deck = deckTbl(zz);
  // deadrise: sharper at the bow
  const dr = THREE.MathUtils.lerp(32 * DEG, 20 * DEG, THREE.MathUtils.smoothstep(zz, -2.4, -0.8)) -
    THREE.MathUtils.smoothstep(zz, 1.6, 4.5) * 4 * DEG;
  let chine = keel + hw * Math.tan(dr);
  chine = Math.min(chine, deck - 0.12);
  out.keel = keel; out.hw = hw; out.deck = Math.max(deck, keel + 0.06); out.chine = chine;
  return out;
}

// Right half of a float cross-section, s in [0,1] from keel (0) to deck centre (1).
// Returns [x, y] relative to the float centreline. The polyline below is the
// canonical section shared by model and physics.
const FLOAT_KEYS = [0, 0.3, 0.38, 0.41, 0.6, 0.78, 0.86, 0.92, 1.0];
export function floatSectionPoint(sec, s, out) {
  const { keel, hw, deck, chine } = sec;
  const sideTop = deck - Math.min(0.05, (deck - chine) * 0.3);
  // control points along the half section
  const pts = [
    [0, keel],
    [hw * 0.72, keel + (chine - keel) * 0.66], // slightly convex V bottom
    [hw * 0.98, chine - 0.004],
    [hw * 1.015, chine + 0.012], // spray rail lip
    [hw * 1.0, chine + (sideTop - chine) * 0.35],
    [hw * 0.985, sideTop],
    [hw * 0.9, deck - 0.006],
    [hw * 0.7, deck + 0.008],
    [0, deck + 0.016],
  ];
  let k = 0;
  while (k < FLOAT_KEYS.length - 2 && s > FLOAT_KEYS[k + 1]) k++;
  const f = (s - FLOAT_KEYS[k]) / (FLOAT_KEYS[k + 1] - FLOAT_KEYS[k]);
  out[0] = THREE.MathUtils.lerp(pts[k][0], pts[k + 1][0], f);
  out[1] = THREE.MathUtils.lerp(pts[k][1], pts[k + 1][1], f);
  return out;
}

// Area (m^2) of a half float section below height h above its keel.
export function floatHalfAreaBelow(sec, h, samples = 24) {
  // integrate the polygon (keel centre, half section, back down the centreline) clipped at y < keel + h
  const yCut = sec.keel + h;
  const pts = [];
  const tmp = [0, 0];
  for (let i = 0; i <= samples; i++) { floatSectionPoint(sec, i / samples, tmp); pts.push([tmp[0], tmp[1]]); }
  // polygon: centreline (x=0) closes it
  let area = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    // clip segment to y <= yCut: area between segment and the centreline x=0 (horizontal strips)
    const ya = Math.min(a[1], yCut), yb = Math.min(b[1], yCut);
    if (a[1] >= yCut && b[1] >= yCut) continue;
    // trapezoid width integral along y of x(y)
    let xa = a[0], xb = b[0];
    if (a[1] > yCut || b[1] > yCut) {
      const t = (yCut - a[1]) / (b[1] - a[1]);
      const xc = a[0] + (b[0] - a[0]) * t;
      if (a[1] > yCut) xa = xc; else xb = xc;
    }
    area += ((xa + xb) / 2) * (yb - ya);
  }
  return Math.abs(area);
}

// ---------------------------------------------------------------------------
// Wing airfoil (NACA 4-digit style). Returns [x, y] in chord units for a
// parameter s in [0,1]: 0 = trailing edge lower, 0.5 = leading edge, 1 = TE upper.
export function airfoilPoint(s, thick, camber, out, p = 0.4) {
  const upper = s >= 0.5;
  const tt = upper ? (s - 0.5) * 2 : (0.5 - s) * 2; // 0 at LE, 1 at TE
  const x = (1 - Math.cos(tt * Math.PI)) / 2; // cosine spacing
  const yt = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  let yc, dyc;
  if (x < p) { yc = (camber / (p * p)) * (2 * p * x - x * x); dyc = ((2 * camber) / (p * p)) * (p - x); }
  else { yc = (camber / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * x - x * x); dyc = ((2 * camber) / ((1 - p) ** 2)) * (p - x); }
  const th = Math.atan(dyc);
  if (upper) { out[0] = x - yt * Math.sin(th); out[1] = yc + yt * Math.cos(th); }
  else { out[0] = x + yt * Math.sin(th); out[1] = yc - yt * Math.cos(th); }
  return out;
}

// Wing chord line height at a spanwise station (model), including dihedral.
export function wingChordY(absX) {
  const w = DIM.wing;
  return w.chordY + Math.max(absX - w.rootX, 0) * Math.tan(w.dihedral);
}

// World position on the wing (model) for span x (signed), chord fraction c, surface
// side (+1 upper, -1 lower) — approximate, used for attachments.
export function wingSurfacePoint(x, c, side, out = new THREE.Vector3()) {
  const w = DIM.wing;
  const tmp = [0, 0];
  // find s for chord fraction c on the given side
  const s = side > 0 ? 0.5 + Math.acos(1 - 2 * c) / Math.PI / 2 : 0.5 - Math.acos(1 - 2 * c) / Math.PI / 2;
  airfoilPoint(s, w.thick, w.camber, tmp);
  const zc = w.leZ + tmp[0] * w.chord;
  const yc = wingChordY(Math.abs(x)) + tmp[1] * w.chord + (w.leZ + w.chord * 0.5 - zc) * Math.tan(w.incidence);
  return out.set(x, yc, zc);
}

export function L(x, y, z) { return new THREE.Vector3(x - CG_MODEL.x, y - CG_MODEL.y, z - CG_MODEL.z); }
