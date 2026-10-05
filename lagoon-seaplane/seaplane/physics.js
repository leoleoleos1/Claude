// Seaplane physics: 6-DOF rigid body at a fixed 120 Hz step with render-pose
// interpolation; surface-based aerodynamics, float hydrostatics/hydrodynamics,
// water rudders, contacts against terrain / static world / chocks / water,
// mooring ropes and damage bookkeeping. Allocation-free in the step.
import * as THREE from 'three';
import { DIM, CG_MODEL, floatSection, floatHalfAreaBelow, wingChordY } from './model/dims.js';

const G = 9.81;
const RHO_W = 1025;
const RHO_AIR = 1.225 * 1.6; // game air density (tuned for small-world speeds)
const DEG = Math.PI / 180;
export const STEP = 1 / 120;

const L = (x, y, z) => new THREE.Vector3(x - CG_MODEL.x, y - CG_MODEL.y, z - CG_MODEL.z);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// Lift coefficient with a soft stall: linear, knee to CLmax, then a gentle
// post-stall drop toward flat-plate behaviour.
export function liftCoeff(alpha, clMax, a0, cla, stallSoft = 1) {
  const ae = alpha - a0;
  const lin = cla * ae;
  const knee = 0.82 * clMax;
  let cl;
  const al = Math.abs(lin);
  if (al < knee) cl = lin;
  else cl = Math.sign(lin) * (knee + (clMax - knee) * Math.tanh((al - knee) / (clMax - knee)));
  const aStall = clMax / cla + 2.5 * DEG;
  const over = Math.abs(ae) - aStall;
  if (over > 0) {
    // gentle break: lift settles on a shelf ~20 % below CLmax, then blends to a flat plate
    const k = smooth(0, 6 * DEG * stallSoft, over);
    const k2 = smooth(10 * DEG, 30 * DEG, over);
    const plate = 1.15 * Math.sin(2 * ae);
    const post = Math.sign(ae) * 0.8 * clMax * (1 - k2) + plate * k2;
    cl = cl * (1 - k) + post * k;
  }
  return cl;
}

// ---------------------------------------------------------------------------
export class SeaplanePhysics {
  constructor(env, opts = {}) {
    this.env = env;
    this.assist = opts.assist || 'normal';
    // state (actual CG in world, body-frame angular velocity)
    this.cg = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.w = new THREE.Vector3();
    this.cgLocal = new THREE.Vector3();
    this.mass = 1800;
    this.I = new THREE.Vector3(6500, 9000, 3800); // roll(x), yaw(y), pitch(z) about body axes x,y,z
    // render interpolation
    this.originPrev = new THREE.Vector3();
    this.qPrev = new THREE.Quaternion();
    this.origin = new THREE.Vector3();
    this.acc = 0;
    // inputs (set by the plane each frame). Sign conventions: elevator/trim > 0 = nose up
    // (stick back), aileron > 0 = roll right, rudder > 0 = yaw right, flaps in radians.
    this.input = { aileron: 0, elevator: 0, rudder: 0, flaps: 0, trim: 0, waterRudderDown: 1, waterRudder: 0, thrust: 0, torque: 0, propwash: 0, rpm: 0, pushOff: 0 };
    // loading
    this.payload = { fuelL: 100, fuelR: 100, pilot: 85, copilot: 0, cargo: 120, cargoZ: 2.4 };
    // damage 0..1 (1 = intact)
    this.damage = { wingL: 1, wingR: 1, floatL: 1, floatR: 1, prop: 1, engine: 1, tail: 1, windscreen: 1, hull: 1 };
    this.flood = { L: 0, R: 0 }; // flooded volume per float (m^3)
    this.wreck = false;
    // pre-split pieces that break off in a crash (the side that hit loses its tip / float)
    this.detached = { wingTipL: false, wingTipR: false, floatL: false, floatR: false, prop: false };
    // telemetry
    this.out = {
      airspeed: 0, groundSpeed: 0, aoa: 0, beta: 0, gLoad: 1, vs: 0, agl: 0, altitude: 0,
      onWater: false, planing: false, beached: false, submerged: 0, stall: 0, waterSpeed: 0,
      buoyancyFrac: 0, lastImpact: 0, slam: 0, sprayBow: [0, 0], sprayStep: [0, 0], groundContact: false,
      wingDrag: 0, propStrike: 0, engineWater: 0, contactsN: 0, scrape: 0, grind: 0,
      accBody: new THREE.Vector3(0, G, 0), rho: RHO_AIR, propwash: 0, waterH: 0, groundH: -1e9, propTipWater: -10,
    };
    this.events = []; // { type, data } consumed by the plane each frame
    this.onPreStep = null; // called before every fixed step (engine, controls)
    // handling tuning knobs (power effects and stability aids)
    this.tune = { torqueRoll: 0.1, pFactor: 0.06, swirl: 0.022, spiral: 7, phugoid: 40 };
    this.gust = new THREE.Vector3();
    this._gustT = 0;
    this._seed = 1.7;
    this.wasAirborne = false;
    this.airTime = 0;
    this.moor = []; // { anchor: Vector3 (world), local: Vector3 (plane-local), length, k }
    this.chocks = []; // world boxes { c: Vector3, h: Vector3, ry }
    this.worldLimitVec = new THREE.Vector3();
    this._buildGeometry();
    this._tmps();
    this.setLoading({});
  }

  _tmps() {
    this._F = new THREE.Vector3();
    this._T = new THREE.Vector3();
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3(); this._d = new THREE.Vector3();
    this._e = new THREE.Vector3(); this._f = new THREE.Vector3(); this._g = new THREE.Vector3(); this._h = new THREE.Vector3();
    this._wind = new THREE.Vector3();
    this._flow = new THREE.Vector3();
    this._flowL = new THREE.Vector3();
    this._flowR = new THREE.Vector3();
    this._out = { normal: new THREE.Vector3(), depth: 0 };
    this._m = new Float64Array(9);
    this._qa = new THREE.Quaternion();
    this._acc = new THREE.Vector3();
    this._velPrev = new THREE.Vector3();
  }

  // ---------------- geometry tables -----------------------------------------
  _buildGeometry() {
    const F = DIM.float;
    // buoyancy / hydro samples: 9 stations x 2 halves per float
    const stations = [];
    const nS = 10;
    const z0 = F.bowZ + 0.25, z1 = F.sternZ - 0.15;
    for (let i = 0; i < nS; i++) {
      const za = z0 + ((z1 - z0) * i) / nS, zb = z0 + ((z1 - z0) * (i + 1)) / nS;
      const zc = (za + zb) / 2;
      const sec = floatSection(zc);
      const depth = sec.deck - sec.keel;
      const table = new Float32Array(33);
      for (let k = 0; k <= 32; k++) table[k] = floatHalfAreaBelow(sec, (depth * k) / 32);
      const deadrise = Math.atan2(sec.chine - sec.keel, sec.hw);
      stations.push({ z: zc, dz: zb - za, keel: sec.keel, depth, hw: sec.hw, chine: sec.chine - sec.keel, table, deadrise, fore: zc < F.stepZ });
    }
    this.floatStations = stations;
    this.samples = [];
    for (const fx of [-F.x, F.x]) {
      for (const st of stations) {
        for (const half of [-1, 1]) {
          this.samples.push({
            float: fx < 0 ? 'L' : 'R', half, st,
            local: L(fx + half * st.hw * 0.5, st.keel, st.z),
            nLocal: new THREE.Vector3(half * Math.sin(st.deadrise), -Math.cos(st.deadrise), 0),
            d: 0, wet: 0,
          });
        }
      }
    }
    // aero surfaces (plane-local positions of aerodynamic centres)
    const w = DIM.wing;
    const zq = w.leZ + 0.25 * w.chord;
    const dih = 4 * DEG; // effective dihedral (geometric + high-wing effect)
    const wingSurf = (name, x0, x1, side, ctrl) => {
      const xm = (x0 + x1) / 2;
      const area = (x1 - x0) * w.chord * (x1 > 6.5 ? 0.9 : 1);
      return {
        name, side, area, chord: w.chord, ctrl,
        pos: L(side * xm, wingChordY(xm), zq),
        n: new THREE.Vector3(-side * Math.sin(dih), Math.cos(dih), 0), c: new THREE.Vector3(0, 0, 1),
        incidence: w.incidence, clMax: 1.95, a0: -3 * DEG, cla: 6.2, cd0: 0.012, k: 0.046,
        propwash: x0 < 1.3 ? (1.3 - x0) / (x1 - x0) : 0, alpha: 0, cl: 0, stalled: 0, dmg: side < 0 ? 'wingL' : 'wingR',
        det: x0 > 4 ? (side < 0 ? 'wingTipL' : 'wingTipR') : null, // outer panel = the detachable tip
      };
    };
    this.surfaces = [
      wingSurf('wingL_in', 0.0, 4.1, -1, 'flap'),
      wingSurf('wingL_out', 4.1, 7.3, -1, 'aileron'),
      wingSurf('wingR_in', 0.0, 4.1, 1, 'flap'),
      wingSurf('wingR_out', 4.1, 7.3, 1, 'aileron'),
      { name: 'hstab', area: 5.4, chord: 1.15, ctrl: 'elevator', pos: L(0, DIM.hstab.y, 6.2), n: new THREE.Vector3(0, 1, 0), c: new THREE.Vector3(0, 0, 1),
        incidence: -2.5 * DEG, clMax: 1.3, a0: 0, cla: 4.2, cd0: 0.012, k: 0.09, propwash: 0.55, tail: true, alpha: 0, cl: 0, stalled: 0, dmg: 'tail' },
      { name: 'vtail', area: 2.5, chord: 1.2, ctrl: 'rudder', pos: L(0, 3.35, 6.35), n: new THREE.Vector3(1, 0, 0), c: new THREE.Vector3(0, 0, 1),
        incidence: 0, clMax: 1.25, a0: 0, cla: 3.4, cd0: 0.012, k: 0.12, propwash: 0.6, tail: true, fin: true, alpha: 0, cl: 0, stalled: 0, dmg: 'tail' },
    ];
    // contact points: [local, radius, friction, part, kind]
    const cp = [];
    // det: the contact sits on a detachable piece and stops acting once it broke off;
    // only: a stand-in at the broken end that acts only after that piece is gone
    const add = (p, r, mu, part, kind = 'hard', only = null) => {
      const tip = (kind === 'wing' || kind === 'wingtip') && Math.abs(p.x) > w.aileron.x0;
      const det = part === 'floatL' || part === 'floatR' ? part : tip ? (p.x < 0 ? 'wingTipL' : 'wingTipR') : null;
      cp.push({ local: p, r, mu, part, kind, det, only, pen: 0, vn: 0, on: false });
    };
    for (const fx of [-F.x, F.x]) {
      const fp = fx < 0 ? 'floatL' : 'floatR';
      for (const z of [F.bowZ + 0.04, -2.3, -1.6, -0.6, 0.6, F.stepZ - 0.02, 2.4, 3.6, F.sternZ - 0.1]) {
        const s = floatSection(z);
        add(L(fx, s.keel + 0.02, z), 0.03, 0.55, fp, 'keel');
      }
      for (const z of [-1.5, 0.6, 2.6]) {
        const s = floatSection(z);
        for (const h of [-1, 1]) add(L(fx + h * s.hw, s.chine, z), 0.04, 0.5, fp, 'chine');
      }
      add(L(fx, floatSection(F.bowZ + 0.1).deck, F.bowZ - 0.02), 0.12, 0.5, fp, 'bow');
    }
    add(L(-w.tipX + 0.05, wingChordY(w.tipX) + 0.02, w.leZ + 0.7), 0.2, 0.5, 'wingL', 'wingtip');
    add(L(w.tipX - 0.05, wingChordY(w.tipX) + 0.02, w.leZ + 0.7), 0.2, 0.5, 'wingR', 'wingtip');
    add(L(-4.6, wingChordY(4.6), w.leZ + 0.4), 0.18, 0.5, 'wingL', 'wing');
    add(L(4.6, wingChordY(4.6), w.leZ + 0.4), 0.18, 0.5, 'wingR', 'wing');
    // broken ends: inner wing panel, float strut stubs
    for (const sx of [-1, 1]) {
      const sd = sx < 0 ? 'L' : 'R';
      add(L(sx * 4.0, wingChordY(4.0), w.leZ + 0.6), 0.15, 0.6, 'wing' + sd, 'wing', 'wingTip' + sd);
      for (const z of [DIM.floatStruts.frontZ, DIM.floatStruts.rearZ]) add(L(sx * 1.15, 0.98, z), 0.08, 0.6, 'hull', 'hull', 'float' + sd);
    }
    add(L(-DIM.hstab.tipX + 0.1, DIM.hstab.y, 6.3), 0.15, 0.5, 'tail', 'tail');
    add(L(DIM.hstab.tipX - 0.1, DIM.hstab.y, 6.3), 0.15, 0.5, 'tail', 'tail');
    add(L(0, DIM.fin.topY, 6.6), 0.15, 0.5, 'tail', 'tail');
    add(L(0, DIM.rudder.bottomY + 0.05, 7.1), 0.12, 0.5, 'tail', 'tail');
    add(L(0, 2.75, 6.5), 0.15, 0.5, 'hull', 'hull');
    add(L(0, DIM.thrustY, DIM.spinnerTipZ + 0.05), 0.12, 0.4, 'prop', 'nose');
    add(L(0, 1.55, -1.0), 0.15, 0.5, 'engine', 'hull');
    add(L(0, DIM.bellyY + 0.05, 0.8), 0.25, 0.5, 'hull', 'hull');
    add(L(0, DIM.bellyY + 0.08, 2.6), 0.25, 0.5, 'hull', 'hull');
    add(L(0, 3.65, 1.2), 0.25, 0.5, 'hull', 'hull');
    this.contacts = cp;
    this.propHub = L(0, DIM.thrustY, DIM.propZ);
    this.propR = DIM.propRadius;
    this.engineIntake = L(0, DIM.thrustY - 0.3, -1.3);
    this.waterRudders = [
      { local: L(-F.x, floatSection(F.sternZ).keel - 0.12, F.sternZ + 0.08), area: 0.075 },
      { local: L(F.x, floatSection(F.sternZ).keel - 0.12, F.sternZ + 0.08), area: 0.075 },
    ];
  }

  // ---------------- loading / mass properties ---------------------------------
  setLoading(p) {
    Object.assign(this.payload, p);
    const pl = this.payload;
    const items = [
      [DIM.emptyMass, L(0, 2.2, 0.86)],
      [pl.fuelL * DIM.fuelDensity, L(-1.4, 3.45, 1.25)],
      [pl.fuelR * DIM.fuelDensity, L(1.4, 3.45, 1.25)],
      [pl.pilot, L(-0.33, 2.35, 1.2)],
      [pl.copilot, L(0.33, 2.35, 1.2)],
      [pl.cargo, L(0, 2.1, pl.cargoZ)],
    ];
    let m = 0;
    const c = new THREE.Vector3();
    for (const [mi, p] of items) { m += mi; c.addScaledVector(p, mi); }
    c.divideScalar(m);
    // keep world CG continuous when the CG shifts
    const R = this._m;
    if (this._initialised) {
      this._mat();
      const dx = c.x - this.cgLocal.x, dy = c.y - this.cgLocal.y, dz = c.z - this.cgLocal.z;
      this.cg.x += R[0] * dx + R[1] * dy + R[2] * dz;
      this.cg.y += R[3] * dx + R[4] * dy + R[5] * dz;
      this.cg.z += R[6] * dx + R[7] * dy + R[8] * dz;
    }
    this.cgLocal.copy(c);
    this.mass = m;
    // rolling moment of the lateral CG offset about the centreline (positive = rolls left)
    this.lateralMoment = c.x * m * G;
    // inertia: base distribution scaled with mass, plus payload point masses
    const base = DIM.emptyMass / 1450;
    const Ixx = 5200 * base + (pl.fuelL + pl.fuelR) * DIM.fuelDensity * 1.4 * 1.4;
    const Iyy = 8600 * base + (pl.fuelL + pl.fuelR) * DIM.fuelDensity * 1.4 * 1.4 + pl.cargo * 1.6;
    const Izz = 3900 * base + pl.cargo * 1.6 + (pl.pilot + pl.copilot) * 0.2;
    this.I.set(Ixx, Iyy, Izz);
  }

  // ---------------- placement ------------------------------------------------
  // pose: frame origin position + orientation
  place(origin, quat) {
    this.q.copy(quat).normalize();
    this._mat();
    const R = this._m, c = this.cgLocal;
    this.cg.set(
      origin.x + R[0] * c.x + R[1] * c.y + R[2] * c.z,
      origin.y + R[3] * c.x + R[4] * c.y + R[5] * c.z,
      origin.z + R[6] * c.x + R[7] * c.y + R[8] * c.z);
    this.vel.set(0, 0, 0);
    this.w.set(0, 0, 0);
    this.origin.copy(origin);
    this.originPrev.copy(origin);
    this.qPrev.copy(this.q);
    this.acc = 0;
    this._initialised = true;
    this.wasAirborne = false;
  }

  // Lift the airframe out of the ground after its contact set changed (repair()
  // puts the floats back while the wreck rests on the strut stubs).
  depenetrate() {
    const env = this.env;
    if (!env.groundHeight) return;
    let pen = 0;
    for (const c of this.contacts) {
      if ((c.det && this.detached[c.det]) || (c.only && !this.detached[c.only])) continue;
      this.pointWorld(c.local, this._c);
      const g = env.groundHeight(this._c.x, this._c.z);
      if (Number.isFinite(g)) pen = Math.max(pen, g - (this._c.y - c.r));
      for (const b of this.chocks) pen = Math.max(pen, this._boxPen(this._c, c.r, b, this._e));
    }
    if (pen <= 0) return;
    this.cg.y += pen + 0.01;
    this.origin.y += pen + 0.01;
    this.originPrev.copy(this.origin);
    this.qPrev.copy(this.q);
    if (this.vel.y < 0) this.vel.y = 0;
  }

  _mat() {
    const q = this.q, m = this._m;
    const x = q.x, y = q.y, z = q.z, w = q.w;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    m[0] = 1 - (yy + zz); m[1] = xy - wz; m[2] = xz + wy;
    m[3] = xy + wz; m[4] = 1 - (xx + zz); m[5] = yz - wx;
    m[6] = xz - wy; m[7] = yz + wx; m[8] = 1 - (xx + yy);
  }
  // body -> world (rotation only)
  toWorldDir(v, out) {
    const m = this._m;
    return out.set(m[0] * v.x + m[1] * v.y + m[2] * v.z, m[3] * v.x + m[4] * v.y + m[5] * v.z, m[6] * v.x + m[7] * v.y + m[8] * v.z);
  }
  toBodyDir(v, out) {
    const m = this._m;
    return out.set(m[0] * v.x + m[3] * v.y + m[6] * v.z, m[1] * v.x + m[4] * v.y + m[7] * v.z, m[2] * v.x + m[5] * v.y + m[8] * v.z);
  }
  // plane-local point -> world
  pointWorld(local, out) {
    const m = this._m, c = this.cgLocal;
    const x = local.x - c.x, y = local.y - c.y, z = local.z - c.z;
    return out.set(this.cg.x + m[0] * x + m[1] * y + m[2] * z, this.cg.y + m[3] * x + m[4] * y + m[5] * z, this.cg.z + m[6] * x + m[7] * y + m[8] * z);
  }
  // world velocity of a plane-local point
  pointVel(local, out) {
    const c = this.cgLocal, w = this.w;
    const rx = local.x - c.x, ry = local.y - c.y, rz = local.z - c.z;
    const bx = w.y * rz - w.z * ry, by = w.z * rx - w.x * rz, bz = w.x * ry - w.y * rx;
    const m = this._m;
    return out.set(this.vel.x + m[0] * bx + m[1] * by + m[2] * bz, this.vel.y + m[3] * bx + m[4] * by + m[5] * bz, this.vel.z + m[6] * bx + m[7] * by + m[8] * bz);
  }
  // accumulate a world-space force at a plane-local point
  addForceLocalPoint(local, fw) {
    this._F.add(fw);
    const c = this.cgLocal;
    const rx = local.x - c.x, ry = local.y - c.y, rz = local.z - c.z;
    const m = this._m;
    const fx = m[0] * fw.x + m[3] * fw.y + m[6] * fw.z, fy = m[1] * fw.x + m[4] * fw.y + m[7] * fw.z, fz = m[2] * fw.x + m[5] * fw.y + m[8] * fw.z;
    this._T.x += ry * fz - rz * fy; this._T.y += rz * fx - rx * fz; this._T.z += rx * fy - ry * fx;
  }
  // body-space force at a plane-local point
  addForceBody(local, fb) {
    const m = this._m;
    this._F.x += m[0] * fb.x + m[1] * fb.y + m[2] * fb.z;
    this._F.y += m[3] * fb.x + m[4] * fb.y + m[5] * fb.z;
    this._F.z += m[6] * fb.x + m[7] * fb.y + m[8] * fb.z;
    const c = this.cgLocal;
    const rx = local.x - c.x, ry = local.y - c.y, rz = local.z - c.z;
    this._T.x += ry * fb.z - rz * fb.y; this._T.y += rz * fb.x - rx * fb.z; this._T.z += rx * fb.y - ry * fb.x;
  }

  // ---------------- main update ------------------------------------------------
  update(dt) {
    dt = Math.min(dt, 0.1);
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n < 14) {
      this.originPrev.copy(this.origin);
      this.qPrev.copy(this.q);
      if (this.onPreStep) this.onPreStep(STEP);
      this.step(STEP);
      this.acc -= STEP;
      n++;
    }
    if (n >= 14) this.acc = 0;
    return this.acc / STEP;
  }

  // interpolated render pose (frame origin)
  renderPose(alpha, outPos, outQuat) {
    outPos.lerpVectors(this.originPrev, this.origin, alpha);
    outQuat.slerpQuaternions(this.qPrev, this.q, alpha);
  }

  step(h) {
    this._stepH = h;
    const env = this.env;
    this._mat();
    const F = this._F.set(0, -this.mass * G, 0);
    const T = this._T.set(0, 0, 0);
    const o = this.out;
    // wind + gusts
    const wind = this._wind;
    if (env.wind) wind.copy(env.wind); else wind.set(0, 0, 0);
    this._turbulence(h, wind);
    // aerodynamics
    this._aero(wind);
    // thrust & torque along the prop axis (body -z)
    const inp = this.input;
    const thrustK = this.detached.prop ? 0 : 1;
    this._a.set(0, 0, -inp.thrust * thrustK);
    // thrust line rigged a little above the loaded CG: mild nose-down with power
    this._b.set(0, this.cgLocal.y + 0.04, this.propHub.z);
    this.addForceBody(this._b, this._a);
    T.z += inp.torque * this.tune.torqueRoll * thrustK; // reaction torque rolls left (mild: rigging compensates most of it)
    // aileron rigging: the mechanic trims out the lateral CG offset (pilot in the left seat)
    T.z += this.lateralMoment * clamp(this.out.airspeed / 25, 0, 1);
    // P-factor: yaw left proportional to thrust and angle of attack
    T.y += inp.thrust * this.tune.pFactor * clamp(o.aoa, -0.3, 0.4) * thrustK;
    // hydro
    let waterNear = true;
    if (env.waterHeight) {
      const wh = env.waterHeight(this.cg.x, this.cg.z);
      waterNear = this.cg.y - wh < 6;
      o.altitude = this.cg.y;
      o.waterH = wh;
    } else { waterNear = false; o.waterH = -1e9; }
    if (waterNear) this._hydro(h);
    else this._clearHydro();
    // contacts
    this._contacts(h);
    // ropes
    for (const r of this.moor) this._rope(r);
    // push-off from the beach (interaction): backwards force along body +z at the bows
    if (inp.pushOff > 0) {
      this._a.set(0, 0.25, 1).normalize().multiplyScalar(inp.pushOff * 4200);
      const bow = this.contacts[0].local;
      this._b.set(0, bow.y, bow.z);
      this.addForceBody(this._b, this._a);
    }
    // world limit: push-back acceleration + gentle heading torque
    if (env.worldLimit) {
      const wl = this.worldLimitVec.set(0, 0, 0);
      const r = env.worldLimit(this.cg.x, this.cg.y, this.cg.z, wl);
      if (r !== false && wl.lengthSq() > 0) {
        F.addScaledVector(wl, this.mass);
        this.toBodyDir(wl, this._b);
        T.y += -this._b.x * this.mass * 0.6;
      }
    }
    // integrate (semi-implicit Euler)
    this._velPrev.copy(this.vel);
    this.vel.addScaledVector(F, h / this.mass);
    const I = this.I, w = this.w;
    // Euler's equations in body frame (diagonal inertia)
    const Iwx = I.x * w.x, Iwy = I.y * w.y, Iwz = I.z * w.z;
    const gx = w.y * Iwz - w.z * Iwy, gy = w.z * Iwx - w.x * Iwz, gz = w.x * Iwy - w.y * Iwx;
    w.x += ((T.x - gx) / I.x) * h;
    w.y += ((T.y - gy) / I.y) * h;
    w.z += ((T.z - gz) / I.z) * h;
    // safety clamp
    const wl2 = w.lengthSq();
    if (wl2 > 64) w.multiplyScalar(8 / Math.sqrt(wl2));
    const vl2 = this.vel.lengthSq();
    if (vl2 > 160 * 160) this.vel.multiplyScalar(160 / Math.sqrt(vl2));
    this.cg.addScaledVector(this.vel, h);
    // q += 0.5 * q * (0, w) * h  (body-frame angular velocity)
    const q = this.q;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const hx = w.x * h * 0.5, hy = w.y * h * 0.5, hz = w.z * h * 0.5;
    q.x += qw * hx + qy * hz - qz * hy;
    q.y += qw * hy + qz * hx - qx * hz;
    q.z += qw * hz + qx * hy - qy * hx;
    q.w += -qx * hx - qy * hy - qz * hz;
    q.normalize();
    this._mat();
    // frame origin
    const m = this._m, c = this.cgLocal;
    this.origin.set(this.cg.x - (m[0] * c.x + m[1] * c.y + m[2] * c.z), this.cg.y - (m[3] * c.x + m[4] * c.y + m[5] * c.z), this.cg.z - (m[6] * c.x + m[7] * c.y + m[8] * c.z));
    // derived telemetry
    this._acc.subVectors(this.vel, this._velPrev).divideScalar(h);
    this._acc.y += G;
    this.toBodyDir(this._acc, this._b);
    const gl = this._b.y / G;
    o.gLoad += (gl - o.gLoad) * Math.min(1, h * 12);
    o.accBody.lerp(this._b, Math.min(1, h * 20));
    o.vs = this.vel.y;
    o.groundSpeed = Math.hypot(this.vel.x, this.vel.z);
    // landing / airborne bookkeeping
    const airborne = !o.onWater && !o.groundContact;
    if (airborne) this.airTime += h; else this.airTime = 0;
    if (this.airTime > 1.0) this.wasAirborne = true;
  }

  // ---------------- turbulence ----------------------------------------------------
  _turbulence(h, wind) {
    const env = this.env;
    const ws = Math.hypot(wind.x, wind.z);
    const rain = env.rain ? env.rain() : 0;
    this._gustT += h;
    const t = this._gustT;
    // land below? (thermals)
    let land = 0;
    if (env.groundHeight && env.waterHeight) {
      const gh = env.groundHeight(this.cg.x, this.cg.z);
      land = gh > (this.out.waterH ?? 0) + 0.5 ? 1 : 0;
    }
    const day = env.night ? 1 - env.night() : 1;
    const agl = Math.max(0, this.cg.y - (this.out.groundH ?? 0));
    const k = (0.12 * ws + rain * 1.6 + land * day * 0.9) * smooth(2, 25, agl);
    const nx = Math.sin(t * 0.73 + 1.3) * 0.6 + Math.sin(t * 1.71 + 0.2) * 0.3 + Math.sin(t * 3.9) * 0.1;
    const ny = Math.sin(t * 0.91 + 2.1) * 0.5 + Math.sin(t * 2.3 + 1.0) * 0.35 + Math.sin(t * 5.1 + 0.4) * 0.15;
    const nz = Math.sin(t * 0.61 + 4.0) * 0.6 + Math.sin(t * 1.37 + 3.3) * 0.4;
    this.gust.set(nx * k, (ny * k * 0.8) + land * day * 0.6 * smooth(10, 80, agl) * (0.5 + 0.5 * Math.sin(t * 0.17)), nz * k);
    wind.add(this.gust);
  }

  // ---------------- aerodynamics ---------------------------------------------------
  _aero(wind) {
    const inp = this.input, o = this.out;
    const alt = this.cg.y;
    const rhoK = Math.exp(-Math.max(alt, 0) / 9000) * (1 - smooth(500, 900, alt) * 0.35);
    const rho = RHO_AIR * rhoK;
    o.rho = rho;
    // overall airspeed at the CG
    const vw = this._a.subVectors(wind, this.vel);
    const bodyAir = this.toBodyDir(vw, this._b);
    const V = bodyAir.length();
    o.airspeed = V;
    o.aoa = Math.atan2(bodyAir.y, Math.max(bodyAir.z, 0.1));
    o.beta = Math.atan2(bodyAir.x, Math.max(bodyAir.z, 0.1));
    // ground effect (height of the wing above water/ground)
    const surfH = Math.max(o.waterH ?? -1e9, o.groundH ?? -1e9);
    const hw = Math.max(this.cg.y + 1.1 - surfH, 0.3);
    const ge = (16 * hw / DIM.wing.span) ** 2;
    const geInduced = ge / (1 + ge);
    const geLift = 1 + 0.12 * Math.exp(-hw / 3);
    // propwash slipstream speed increment at the tail (momentum theory)
    const A = Math.PI * DIM.propRadius * DIM.propRadius;
    const Vax = Math.max(bodyAir.z, 0);
    const T0 = Math.max(inp.thrust, 0);
    const vi = 0.5 * (-Vax + Math.sqrt(Vax * Vax + (2 * T0) / (RHO_AIR * A)));
    const vslip = 2 * vi;
    o.propwash = vslip;
    let stallMax = 0;
    const fl = inp.flaps; // radians of flap deflection
    for (const s of this.surfaces) {
      // local airflow at the surface: wind - point velocity, in body frame
      this.pointVel(s.pos, this._c);
      this._d.subVectors(wind, this._c);
      const w = this.toBodyDir(this._d, this._e);
      if (s.propwash > 0) {
        w.z += vslip * s.propwash * (s.tail ? 0.75 : 1);
        if (s.fin) w.x += -this.tune.swirl * vslip; // slipstream swirl on the fin (needs right rudder)
      }
      const wc = w.x * s.c.x + w.y * s.c.y + w.z * s.c.z;
      const wn = w.x * s.n.x + w.y * s.n.y + w.z * s.n.z;
      const vp2 = wc * wc + wn * wn;
      if (vp2 < 0.04 || (s.det && this.detached[s.det])) { s.alpha = 0; s.cl = 0; s.stalled = 0; continue; }
      let alpha = Math.atan2(wn, wc) + s.incidence;
      // control deflections
      let dCm = 0, dCd = 0, clMax = s.clMax, a0 = s.a0;
      if (s.ctrl === 'aileron') {
        // Beaver-style drooping ailerons follow the flaps at half angle
        const fd = (fl / DEG) * 0.5;
        a0 += -0.14 * fd * DEG;
        clMax += 0.025 * fd;
        dCd += 0.0012 * fd;
        alpha += -s.side * inp.aileron * 0.38 * 0.5;
        dCd += Math.abs(inp.aileron) * 0.01;
      }
      else if (s.ctrl === 'elevator') { alpha -= (inp.elevator * 0.36 + inp.trim * 0.12) * 0.85; dCd += Math.abs(inp.elevator) * 0.012; }
      else if (s.ctrl === 'rudder') { alpha += -inp.rudder * 0.45 * 0.5; dCd += Math.abs(inp.rudder) * 0.012; }
      else if (s.ctrl === 'flap') {
        const fd = fl / DEG;
        a0 += -0.15 * fd * DEG;
        clMax += 0.027 * fd;
        dCd += 0.0032 * fd;
        dCm += -0.0022 * fd;
      }
      s.alpha = alpha;
      let cl = liftCoeff(alpha, clMax, a0, s.cla, s.fin || s.tail ? 0.6 : 1.4);
      const dmg = this.damage[s.dmg] ?? 1;
      if (s.side) cl *= 0.65 + 0.35 * dmg;
      if (!s.tail) cl *= geLift;
      s.cl = cl;
      const ae = Math.abs(alpha - a0);
      const stallA = clMax / s.cla + 2.5 * DEG;
      s.stalled = smooth(stallA - 3 * DEG, stallA + 4 * DEG, ae);
      if (!s.tail) stallMax = Math.max(stallMax, smooth(stallA - 4 * DEG, stallA, ae));
      const kInd = s.k * (s.tail ? 1 : geInduced);
      const cd = s.cd0 + dCd + kInd * cl * cl + 1.1 * s.stalled * Math.sin(ae) ** 2 + (1 - dmg) * 0.04;
      const q = 0.5 * rho * vp2 * s.area;
      // lift direction: n * wc - c * wn (normalized), drag along the in-plane flow
      const inv = 1 / Math.sqrt(vp2);
      const lx = (s.n.x * wc - s.c.x * wn) * inv, ly = (s.n.y * wc - s.c.y * wn) * inv, lz = (s.n.z * wc - s.c.z * wn) * inv;
      const dx = (s.c.x * wc + s.n.x * wn) * inv, dy = (s.c.y * wc + s.n.y * wn) * inv, dz = (s.c.z * wc + s.n.z * wn) * inv;
      this._f.set(q * (cl * lx + cd * dx), q * (cl * ly + cd * dy), q * (cl * lz + cd * dz));
      this.addForceBody(s.pos, this._f);
      if (dCm !== 0) this._T.x += q * s.chord * dCm;
    }
    o.stall = stallMax;
    // bodies: fuselage, floats, struts/cargo: drag + side force, destabilising nose moment
    const vb2 = V * V;
    if (vb2 > 0.01) {
      const q = 0.5 * rho;
      const fFront = 0.85 - (this.detached.floatL ? 0.15 : 0) - (this.detached.floatR ? 0.15 : 0);
      const fSide = 9.5, fVert = 14;
      const Dx = q * fSide * 0.55 * bodyAir.x * Math.abs(bodyAir.x);
      const Dy = q * fVert * 0.5 * bodyAir.y * Math.abs(bodyAir.y);
      const Dz = q * fFront * bodyAir.z * Math.abs(bodyAir.z);
      this._f.set(Dx, Dy, Dz);
      this._g.set(0, 0, -0.35); // centre of pressure slightly ahead of the CG (floats + nose)
      this._g.add(this.cgLocal);
      this.addForceBody(this._g, this._f);
    }
    // aerodynamic damping (tuning aid for smooth hands-off flight)
    const qd = 0.5 * rho * V;
    // pitch damping keeps a floor at low speed (no falling-leaf after a stall break)
    this._T.x += -this.w.x * Math.max(qd, 0.5 * rho * 28) * 34;
    this._T.y += -this.w.y * qd * 40;
    this._T.z += -this.w.z * qd * 30;
    // gentle spiral stability: banked flight slowly rolls back toward wings level
    if (!o.onWater && V > 12) {
      const m = this._m;
      const rollAng = Math.atan2(-m[3], m[4]);
      const qv = Math.max(qd * V, 0.5 * rho * 30 * 30);
      this._T.z += rollAng * qv * this.tune.spiral * (1 - o.stall);
      // phugoid damping aid: nose-down moment while the flight path is curving upward
      const gam = Math.asin(clamp(this.vel.y / Math.max(V, 1), -1, 1));
      const gdot = this._gamInit ? (gam - this._gamPrev) / this._stepH : 0;
      this._gamPrev = gam; this._gamInit = true;
      this._T.x += -clamp(gdot, -1, 1) * qd * V * this.tune.phugoid;
    }
  }

  // ---------------- hydrostatics / hydrodynamics ----------------------------------
  _clearHydro() {
    const o = this.out;
    o.onWater = false; o.planing = false; o.submerged = 0; o.buoyancyFrac = 0; o.waterSpeed = 0;
    o.sprayBow[0] = o.sprayBow[1] = 0; o.sprayStep[0] = o.sprayStep[1] = 0; o.slam = 0;
    for (const s of this.samples) { s.d = 0; s.wet = 0; }
  }

  _hydro(h) {
    const env = this.env, o = this.out;
    const P = this._c, V = this._d, U = this._e, Fv = this._g;
    let buoy = 0, wetCount = 0;
    let bowL = 0, bowR = 0, stepL = 0, stepR = 0, slam = 0;
    const flowOK = !!env.waterFlow;
    if (flowOK) {
      // one current sample per float (the current varies slowly over a float length)
      this._h.set(-DIM.float.x - CG_MODEL.x, -CG_MODEL.y, 1.2 - CG_MODEL.z);
      this.pointWorld(this._h, P); env.waterFlow(P.x, P.z, this._flowL);
      this._h.x = DIM.float.x - CG_MODEL.x;
      this.pointWorld(this._h, P); env.waterFlow(P.x, P.z, this._flowR);
    }
    const floodL = this.flood.L, floodR = this.flood.R;
    let fwdSpeed = 0;
    let whPair = 0;
    const detL = this.detached.floatL, detR = this.detached.floatR;
    for (const s of this.samples) {
      if (s.float === 'L' ? detL : detR) { s.d = 0; s.wet = 0; continue; } // float broke off
      this.pointWorld(s.local, P);
      // the two halves of a station are ~0.2 m apart: one surface query per station
      const wh = s.half < 0 ? (whPair = env.waterHeight(P.x, P.z)) : whPair;
      const d = wh - P.y;
      s.d = d;
      if (d <= 0) { s.wet = 0; continue; }
      const st = s.st;
      const df = Math.min(d / st.depth, 1);
      const idx = df * 32;
      const i0 = Math.min(Math.floor(idx), 31);
      const area = st.table[i0] + (st.table[i0 + 1] - st.table[i0]) * (idx - i0);
      s.wet = df;
      wetCount++;
      // buoyancy (vertical), reduced on a flooded float
      const fb = RHO_W * G * area * st.dz;
      buoy += fb;
      Fv.set(0, fb, 0);
      // apply at the centroid of the submerged half section (approx.)
      this._h.copy(s.local); this._h.y += Math.min(d, st.depth) * 0.42;
      this.addForceLocalPoint(this._h, Fv);
      // point velocity relative to the water
      this.pointVel(s.local, V);
      if (flowOK) V.sub(s.float === 'L' ? this._flowL : this._flowR);
      this.toBodyDir(V, U); // body frame relative velocity of the hull point
      // wetted areas
      const chineH = st.chine;
      const wetBottom = Math.min(d, chineH) / Math.max(Math.sin(st.deadrise + 0.35), 0.3) + Math.max(d - chineH, 0) * 0.2;
      const Sb = wetBottom * st.dz;
      const Sside = Math.min(d, st.depth) * st.dz;
      // pressure on the V bottom: linear in incidence (planing lift, slamming, bow digging)
      const un = U.x * s.nLocal.x + U.y * s.nLocal.y + U.z * s.nLocal.z; // >0: surface moving into the water
      const umag = Math.sqrt(U.x * U.x + U.y * U.y + U.z * U.z);
      if (un > 0) {
        const cp = st.fore ? 1.25 : 0.9;
        let p = 0.5 * RHO_W * cp * umag * un * Sb + 0.5 * RHO_W * 1.2 * un * un * Sb;
        p = Math.min(p, 60000);
        this._a.copy(s.nLocal).multiplyScalar(-p);
        this.addForceBody(s.local, this._a);
        if (un > 2.5) slam = Math.max(slam, un);
      }
      // lateral (keel/sides) resistance and vertical heave damping
      const fx = -0.5 * RHO_W * 1.05 * U.x * Math.abs(U.x) * Sside - 160 * U.x * Sside;
      const fy = -0.5 * RHO_W * 0.6 * U.y * Math.abs(U.y) * Sb * 0.5 - 420 * U.y * Sb;
      // skin friction along the float
      const fz = -0.5 * RHO_W * 0.003 * U.z * Math.abs(U.z) * (Sb + Sside) - 6 * U.z * Sb;
      this._a.set(fx, fy, fz);
      this.addForceBody(s.local, this._a);
      fwdSpeed = Math.max(fwdSpeed, -U.z);
      // spray emitters bookkeeping (bow / step)
      if (st.fore && st.z < -1.2) { if (s.float === 'L') bowL = Math.max(bowL, df * Math.max(-U.z, 0)); else bowR = Math.max(bowR, df * Math.max(-U.z, 0)); }
      if (st.fore && st.z > 0.6) { if (s.float === 'L') stepL = Math.max(stepL, df * Math.max(-U.z, 0)); else stepR = Math.max(stepR, df * Math.max(-U.z, 0)); }
    }
    // flooding (holed floats take on water): downward force at the float centre
    for (const side of ['L', 'R']) {
      const dmg = side === 'L' ? this.damage.floatL : this.damage.floatR;
      const hole = Math.max(0, 0.75 - dmg);
      if (hole > 0 && wetCount > 0) this.flood[side] = Math.min(this.flood[side] + hole * 0.004 * h * 60, 2.6);
      const vol = side === 'L' ? floodL : floodR;
      if (vol > 0) {
        this._a.set(0, -RHO_W * G * vol, 0);
        this._b.set(side === 'L' ? -DIM.float.x : DIM.float.x, 0.3, 1.2).sub(CG_MODEL);
        this.addForceLocalPoint(this._b, this._a);
      }
    }
    // hump (wave-making) drag, function of Froude number on the displaced weight
    // speed coefficient based on the float beam: hump near Cv = 2.5, planing above ~3.5
    const cv = fwdSpeed / Math.sqrt(G * 0.85);
    const humpK = 0.15 * Math.exp(-((cv - 2.5) ** 2) / 1.3) + 0.02 * smooth(0, 1.5, cv);
    if (buoy > 0 && fwdSpeed > 0.1) {
      this._a.set(0, 0, buoy * humpK);
      this._b.set(0, -0.3, 0.6).add(this.cgLocal);
      this._b.y = this.samples[0].local.y + 0.2;
      this.addForceBody(this._b, this._a);
    }
    // water rudders (lifting blades at the sterns)
    const inp = this.input;
    if (inp.waterRudderDown > 0.5) {
      for (let i = 0; i < this.waterRudders.length; i++) {
        const r = this.waterRudders[i];
        if (i === 0 ? this.detached.floatL : this.detached.floatR) continue;
        this.pointWorld(r.local, P);
        const wh = env.waterHeight(P.x, P.z);
        if (wh < P.y) continue;
        this.pointVel(r.local, V);
        this.toBodyDir(V, U);
        const sp2 = U.x * U.x + U.z * U.z;
        if (sp2 < 0.01) continue;
        const a = clamp(-inp.waterRudder * 0.5 + Math.atan2(-U.x, Math.max(-U.z, 0.3)), -0.7, 0.7);
        const lift = 0.5 * RHO_W * Math.min(sp2, 64) * r.area * 3.0 * a;
        this._a.set(lift, 0, -0.5 * RHO_W * Math.min(sp2, 64) * r.area * (0.05 + Math.abs(a) * 0.3) * Math.sign(U.z));
        this.addForceBody(r.local, this._a);
      }
    }
    o.onWater = wetCount > 0;
    o.buoyancyFrac = buoy / (this.mass * G);
    o.submerged = wetCount / this.samples.length;
    o.waterSpeed = fwdSpeed;
    o.planing = o.onWater && fwdSpeed > 9 && o.buoyancyFrac < 0.55;
    o.sprayBow[0] = bowL; o.sprayBow[1] = bowR;
    o.sprayStep[0] = stepL; o.sprayStep[1] = stepR;
    o.slam = slam;
    // touchdown judgement
    if (o.onWater && this.wasAirborne) {
      this.wasAirborne = false;
      const vs = -this.vel.y;
      const pitch = this.pitch();
      const quality = vs < 1.6 && pitch > -3 * DEG ? 'smooth' : vs < 3.2 ? 'firm' : vs < 6 ? 'hard' : 'crash';
      this.events.push({ type: 'touchdown', quality, vs, pitch, speed: o.airspeed });
      if (quality === 'hard') { this.damage.floatL -= 0.25; this.damage.floatR -= 0.25; this.damage.hull -= 0.2; }
      if (quality === 'crash') this._crash(vs * 1.5);
    }
  }

  pitch() { this._mat(); return Math.asin(clamp(-this._m[5], -1, 1)); }

  // ---------------- contacts -----------------------------------------------------
  _contacts(h) {
    const env = this.env, o = this.out;
    const P = this._c, V = this._d, N = this._e, Ft = this._f;
    let any = false, scrape = 0, grind = 0;
    const gh = env.groundHeight ? env.groundHeight(this.cg.x, this.cg.z) : -1e9;
    o.groundH = gh;
    o.agl = this.cg.y - Math.max(gh, o.waterH ?? -1e9);
    const nearGround = this.cg.y - gh < 12;
    let staticNear = false;
    if (env.contact) staticNear = env.contact(this.cg, 9, this._out);
    const chockNear = this.chocks.length > 0;
    // local ground plane under the plane from three samples; exact queries only for
    // contacts the plane estimate puts within half a metre of the ground
    let gPlane = false, sF = 0, sR = 0, fx = 0, fz = 0;
    if (nearGround && Number.isFinite(gh)) {
      const m = this._m;
      fx = -m[2]; fz = -m[8];
      const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
      const g1 = env.groundHeight(this.cg.x + fx * 5, this.cg.z + fz * 5);
      const g2 = env.groundHeight(this.cg.x - fz * 5, this.cg.z + fx * 5);
      if (Number.isFinite(g1) && Number.isFinite(g2)) { sF = (g1 - gh) / 5; sR = (g2 - gh) / 5; gPlane = true; }
    }
    const waterTop = (o.waterH ?? -1e9) + 1.5;
    let n = 0;
    o.propStrike = 0;
    o.wingDrag = 0;
    o.engineWater = 0;
    for (const c of this.contacts) {
      c.on = false;
      if ((c.det && this.detached[c.det]) || (c.only && !this.detached[c.only])) continue;
      this.pointWorld(c.local, P);
      let pen = 0;
      N.set(0, 1, 0);
      let mu = c.mu;
      if (nearGround) {
        let g;
        if (gPlane) {
          const dx = P.x - this.cg.x, dz = P.z - this.cg.z;
          g = gh + sF * (dx * fx + dz * fz) + sR * (-dx * fz + dz * fx);
          if (g - (P.y - c.r) > -0.5) g = env.groundHeight(P.x, P.z);
        } else g = env.groundHeight(P.x, P.z);
        const pg = g - (P.y - c.r);
        if (pg > 0) {
          pen = pg;
          if (env.groundNormal) env.groundNormal(P.x, P.z, N);
          else {
            const e = 0.5;
            const hx = env.groundHeight(P.x + e, P.z) - env.groundHeight(P.x - e, P.z);
            const hz = env.groundHeight(P.x, P.z + e) - env.groundHeight(P.x, P.z - e);
            N.set(-hx, 2 * e, -hz).normalize();
          }
        }
      }
      if (staticNear) {
        if (env.contact(P, c.r, this._out) && this._out.depth > pen) { pen = this._out.depth; N.copy(this._out.normal); mu = 0.45; }
      }
      if (chockNear) {
        for (const b of this.chocks) {
          const d = this._boxPen(P, c.r, b, this._g);
          if (d > pen) { pen = d; N.copy(this._g); mu = 0.7; }
        }
      }
      // a crew member rocking / pushing the plane breaks it free
      if (this.input.pushOff > 0) mu *= 1 - 0.8 * this.input.pushOff;
      // water: non-float points get strong drag when dipped
      if (c.kind !== 'keel' && c.kind !== 'chine' && c.kind !== 'bow' && (o.waterH ?? -1e9) > -1e8 && P.y - c.r < waterTop) {
        const wh = env.waterHeight(P.x, P.z);
        const dw = wh - (P.y - c.r);
        if (dw > 0) {
          this.pointVel(c.local, V);
          const sp = V.length();
          const area = c.kind === 'wingtip' || c.kind === 'wing' ? 0.6 : 0.25;
          const k = 0.5 * RHO_W * 0.9 * area * Math.min(dw / (c.r * 2), 1);
          Ft.copy(V).multiplyScalar(-k * sp);
          Ft.y += RHO_W * G * Math.min(dw, c.r * 2) * area * 0.3;
          this.addForceLocalPoint(c.local, Ft);
          if (c.kind === 'wingtip' || c.kind === 'wing') o.wingDrag = Math.max(o.wingDrag || 0, sp);
          if (c.kind === 'nose') o.engineWater = Math.max(o.engineWater, dw);
          if (sp > 12 && (c.kind === 'wingtip' || c.kind === 'wing')) this._damagePart(c.part, (sp - 12) * 0.02 * h * 60);
        }
      }
      if (pen <= 0) continue;
      c.on = true;
      any = true;
      n++;
      this.pointVel(c.local, V);
      const vn = V.x * N.x + V.y * N.y + V.z * N.z;
      // impact damage on first touch
      if (!c.wasOn && vn < -3.5) this._impact(c, -vn);
      const k = c.kind === 'keel' ? 2.0e5 : 1.4e5;
      const cd = c.kind === 'keel' ? 1.6e4 : 1.2e4;
      let fn = k * pen - cd * vn;
      if (fn < 0) fn = 0;
      fn = Math.min(fn, 3e5);
      // tangential friction (regularised Coulomb)
      const vtx = V.x - vn * N.x, vty = V.y - vn * N.y, vtz = V.z - vn * N.z;
      const vt = Math.sqrt(vtx * vtx + vty * vty + vtz * vtz);
      const fric = mu * fn / Math.max(vt, 0.25);
      Ft.set(N.x * fn - vtx * fric, N.y * fn - vty * fric, N.z * fn - vtz * fric);
      this.addForceLocalPoint(c.local, Ft);
      if (c.kind === 'keel' || c.kind === 'chine' || c.kind === 'bow') grind = Math.max(grind, vt * Math.min(fn / 4000, 1));
      else scrape = Math.max(scrape, vt);
    }
    for (const c of this.contacts) c.wasOn = c.on;
    // propeller disc vs ground / water: lowest point of the disc
    {
      this.pointWorld(this.propHub, P);
      // world down projected onto the disc plane (body xy)
      this._a.set(0, -1, 0);
      this.toBodyDir(this._a, this._b);
      this._b.z = 0;
      const l = this._b.length();
      if (l > 1e-3) {
        this._b.multiplyScalar(this.propR / l);
        this._h.copy(this.propHub).add(this._b);
        this.pointWorld(this._h, P);
        const g = nearGround ? env.groundHeight(P.x, P.z) : -1e9;
        const wh = env.waterHeight ? env.waterHeight(P.x, P.z) : -1e9;
        const rpm = this.input.rpm;
        if (g > P.y && rpm > 50) { o.propStrike = 2; }
        else if (wh > P.y && rpm > 50) o.propStrike = Math.max(o.propStrike, 1);
        o.propTipWater = wh - P.y;
      }
    }
    o.groundContact = any;
    o.contactsN = n;
    o.scrape = scrape;
    o.grind = grind;
    // beached: resting on keels / chocks with little buoyancy
    let keelOn = false;
    for (let i = 0; i < this.contacts.length; i++) { const c = this.contacts[i]; if (c.on && (c.kind === 'keel' || c.kind === 'chine')) { keelOn = true; break; } }
    o.beached = any && o.buoyancyFrac < 0.6 && o.groundSpeed < 1.5 && keelOn;
    if (any && this.wasAirborne && !o.onWater) {
      this.wasAirborne = false;
      const vs = -this.vel.y;
      this.events.push({ type: 'touchdown', quality: vs < 2 ? 'firm' : vs < 5 ? 'hard' : 'crash', vs, ground: true, speed: o.airspeed });
      if (vs > 5) this._crash(vs);
    }
  }

  _boxPen(P, r, b, nOut) {
    const cr = Math.cos(b.ry), sr = Math.sin(b.ry);
    const dx0 = P.x - b.c.x, dz0 = P.z - b.c.z;
    const lx = cr * dx0 - sr * dz0, lz = sr * dx0 + cr * dz0, ly = P.y - b.c.y;
    const qx = clamp(lx, -b.h.x, b.h.x), qy = clamp(ly, -b.h.y, b.h.y), qz = clamp(lz, -b.h.z, b.h.z);
    let dx = lx - qx, dy = ly - qy, dz = lz - qz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let pen;
    if (d > 1e-6) { pen = r - d; dx /= d; dy /= d; dz /= d; }
    else { pen = b.h.y - ly + r; dx = 0; dy = 1; dz = 0; }
    if (pen <= 0) return 0;
    nOut.set(cr * dx + sr * dz, dy, -sr * dx + cr * dz);
    return pen;
  }

  _impact(c, speed) {
    this.events.push({ type: 'impact', part: c.part, kind: c.kind, speed });
    const k = (speed - 3.5) * 0.12;
    this._damagePart(c.part, k);
    if (speed > 11) this._crash(speed, c.local.x < -0.3 ? 'L' : c.local.x > 0.3 ? 'R' : null);
  }

  _damagePart(part, amount) {
    if (amount <= 0 || !(part in this.damage)) return;
    this.damage[part] = Math.max(0, this.damage[part] - amount);
    this.events.push({ type: 'damage', part, amount });
  }

  // side: 'L' | 'R' (the side that hit); null = the lower wing (left when level)
  _crash(speed, side = null) {
    if (this.wreck) return;
    if (speed < 7) return;
    if (side !== 'L' && side !== 'R') { this._mat(); side = Math.atan2(-this._m[3], this._m[4]) > 0.05 ? 'R' : 'L'; }
    this.wreck = true;
    this.damage.engine = 0;
    this.damage.prop = 0;
    this.damage.windscreen = 0;
    this.damage['wing' + side] = Math.min(this.damage['wing' + side], 0.2);
    this.damage['float' + side] = Math.min(this.damage['float' + side], 0.3);
    this.detached['wingTip' + side] = true;
    this.detached.prop = true;
    if (speed > 13) this.detached['float' + side] = true;
    this.events.push({ type: 'wreck', speed, side });
  }

  _rope(r) {
    this.pointWorld(r.local, this._c);
    this._a.subVectors(r.anchor, this._c);
    const d = this._a.length();
    if (d < 1e-4) return;
    const stretch = d - r.length;
    if (stretch <= 0) { r.tension = 0; return; }
    this._a.divideScalar(d);
    this.pointVel(r.local, this._d);
    const vrel = -this._d.dot(this._a);
    const f = Math.min(r.k * stretch + 2500 * Math.max(vrel, -2), 25000);
    r.tension = Math.max(f, 0);
    this._a.multiplyScalar(Math.max(f, 0));
    this.addForceLocalPoint(r.local, this._a);
  }

  // ---------------- queries -------------------------------------------------------
  // world velocity of a world point rigidly attached to the plane
  pointVelocityWorld(p, out) {
    this._mat();
    const m = this._m;
    const dx = p.x - this.cg.x, dy = p.y - this.cg.y, dz = p.z - this.cg.z;
    // world angular velocity
    const wx = m[0] * this.w.x + m[1] * this.w.y + m[2] * this.w.z;
    const wy = m[3] * this.w.x + m[4] * this.w.y + m[5] * this.w.z;
    const wz = m[6] * this.w.x + m[7] * this.w.y + m[8] * this.w.z;
    return out.set(this.vel.x + wy * dz - wz * dy, this.vel.y + wz * dx - wx * dz, this.vel.z + wx * dy - wy * dx);
  }

  euler(out) {
    // heading (0 = north/-Z, clockwise positive), pitch (nose up +), roll (right wing down +)
    this._mat();
    const m = this._m;
    const fx = -m[2], fy = -m[5], fz = -m[8]; // forward = body -Z in world
    out.pitch = Math.asin(clamp(fy, -1, 1));
    out.heading = Math.atan2(fx, -fz);
    if (out.heading < 0) out.heading += Math.PI * 2;
    out.roll = Math.atan2(-m[3], m[4]);
    return out;
  }
}
