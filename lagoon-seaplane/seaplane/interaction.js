// Player-side interaction: interactables (doors, seats, mooring, push-off,
// refuel, floodlight), walkable / blocking shapes in plane-local space,
// boarding / exit camera transitions and safe exit spots.
import * as THREE from 'three';
import { DIM, CG_MODEL } from './model/dims.js';

const L = (x, y, z) => new THREE.Vector3(x - CG_MODEL.x, y - CG_MODEL.y, z - CG_MODEL.z);
const ease = (t) => t * t * (3 - 2 * t);

// Box shape helper (plane-local AABB; world transform shared with the plane root).
function boxShape(id, min, max, kind, matrixWorld, inverse) {
  return { id, type: 'box', kind, min: min.clone(), max: max.clone(), matrixWorld, inverseMatrixWorld: inverse };
}

export class Interaction {
  constructor(plane) {
    this.plane = plane; // internal plane context (see Seaplane.js)
    this.matrixWorld = new THREE.Matrix4();
    this.inverseMatrixWorld = new THREE.Matrix4();
    this.seated = false;
    this.seatId = null;
    this.transition = null; // { t, dur, from: [pos, quat] (world), path: [local points], toSeat: bool }
    this.exitPose = { position: new THREE.Vector3(), velocity: new THREE.Vector3(), inWater: false };
    this.mooringPoints = [];
    this.jerrycans = 2;
    this.holdState = { id: null, t: 0 };
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._buildShapes();
    this._buildInteractables();
  }

  // ---------------- walk / block shapes ------------------------------------
  _buildShapes() {
    const a = this.plane.anchors;
    const M = this.matrixWorld, I = this.inverseMatrixWorld;
    const W = [];
    const deck = (k) => { const d = a[k]; return [d.min.clone(), d.max.clone()]; };
    for (const k of ['deckL', 'deckR']) { const [mn, mx] = deck(k); W.push(boxShape(k, mn, mx, 'float', M, I)); }
    for (const side of ['L', 'R']) {
      const steps = a['ladder' + side];
      if (steps) steps.forEach((p, i) => W.push(boxShape('ladder' + side + i, p.clone().add(new THREE.Vector3(-0.12, -0.02, -0.2)), p.clone().add(new THREE.Vector3(0.12, 0.01, 0.2)), 'ladder', M, I)));
      const st = a['step' + side];
      if (st) W.push(boxShape('step' + side, st.clone().add(new THREE.Vector3(-0.09, -0.01, -0.07)), st.clone().add(new THREE.Vector3(0.09, 0.008, 0.07)), 'step', M, I));
    }
    // door thresholds (cabin floor near the doors)
    W.push(boxShape('cabinL', L(-0.69, DIM.floorY - 0.02, 0.45), L(-0.35, DIM.floorY + 0.01, 1.25), 'cabin', M, I));
    W.push(boxShape('cabinR', L(0.35, DIM.floorY - 0.02, 0.45), L(0.69, DIM.floorY + 0.01, 1.25), 'cabin', M, I));
    W.push(boxShape('cabinCargo', L(0.25, DIM.floorY - 0.02, 1.45), L(0.69, DIM.floorY + 0.01, 2.6), 'cabin', M, I));
    this.walkShapes = W;
    // blocking volumes (capsule-vs-box for the host controller)
    const B = [];
    B.push(boxShape('fuselageFwd', L(-0.68, 1.58, -1.65), L(0.68, 2.95, 0.38), 'hull', M, I));
    B.push(boxShape('cabinRoof', L(-0.69, 3.0, 0.38), L(0.69, 3.45, 3.2), 'hull', M, I));
    B.push(boxShape('tailcone', L(-0.55, 1.9, 3.2), L(0.55, 3.25, 6.9), 'hull', M, I));
    B.push(boxShape('wallLaft', L(-0.72, 1.6, 1.32), L(-0.62, 3.0, 3.2), 'hull', M, I));
    B.push(boxShape('wallRaft', L(0.62, 1.6, 2.62), L(0.72, 3.0, 3.2), 'hull', M, I));
    B.push(boxShape('belly', L(-0.69, 1.55, 0.38), L(0.69, 1.74, 3.2), 'hull', M, I));
    for (const fx of [-DIM.float.x, DIM.float.x]) B.push(boxShape('floatHull' + (fx < 0 ? 'L' : 'R'), L(fx - 0.42, 0.0, DIM.float.bowZ), L(fx + 0.42, 0.72, DIM.float.sternZ), 'float', M, I));
    this.blockShapes = B;
  }

  // A float that broke off takes its deck, ladder and hull box along: those shapes
  // become empty boxes (min > max) until the float is reattached.
  setFloatAttached(side, attached) {
    const mine = (id) => id === 'deck' + side || id === 'floatHull' + side || id.startsWith('ladder' + side);
    for (const list of [this.walkShapes, this.blockShapes]) {
      for (const s of list) {
        if (!mine(s.id)) continue;
        if (!s._rest) s._rest = [s.min.clone(), s.max.clone()];
        if (attached) { s.min.copy(s._rest[0]); s.max.copy(s._rest[1]); }
        else { s.min.setScalar(Infinity); s.max.setScalar(-Infinity); }
      }
    }
  }

  // ---------------- interactables ---------------------------------------------
  _buildInteractables() {
    const P = this.plane;
    const list = [];
    const add = (o) => { o.progress = 0; list.push(o); return o; };
    const doorDefs = [
      ['doorL', 'left door', L(-0.75, 2.32, 1.18)],
      ['doorR', 'right door', L(0.75, 2.32, 1.18)],
      ['cargo', 'cargo door', L(0.75, 2.35, 1.6)],
    ];
    for (const [name, txt, pos] of doorDefs) {
      add({
        id: 'door.' + name, local: pos, radius: 1.9, viewCone: 0.55, hold: false,
        get labelKey() { return P.doorOpen(name) ? 'seaplane.door.close' : 'seaplane.door.open'; },
        get label() { return (P.doorOpen(name) ? 'Close ' : 'Open ') + txt; },
        // once open, boarding takes precedence over closing the door again
        get priority() { return P.doorOpen(name) ? -1 : 0; },
        enabled: () => !this.seated && !this.transition,
        use: () => P.toggleDoor(name),
      });
    }
    add({
      id: 'seat.pilot', local: L(-1.05, 2.45, 1.0), radius: 2.0, viewCone: 0.45, hold: false, priority: 1,
      labelKey: 'seaplane.seat.pilot', label: 'Get in (pilot)',
      enabled: () => !this.seated && !this.transition && P.doorOpen('doorL') && !P.physics.wreck,
      use: (from) => P.api.seat('pilot', from && from.position, from && from.quaternion),
    });
    add({
      id: 'seat.copilot', local: L(1.05, 2.45, 1.3), radius: 2.0, viewCone: 0.45, hold: false, priority: 1,
      labelKey: 'seaplane.seat.copilot', label: 'Get in (co-pilot)',
      enabled: () => !this.seated && !this.transition && (P.doorOpen('doorR') || P.doorOpen('cargo')) && !P.physics.wreck,
      use: (from) => P.api.seat('copilot', from && from.position, from && from.quaternion),
    });
    add({
      id: 'seat.exit', local: L(-0.33, 2.9, 1.15), radius: 1.2, viewCone: -1, hold: true, holdTime: 0.6,
      labelKey: 'seaplane.seat.exit', label: 'Hold E: Get out',
      enabled: () => this.seated && !this.transition,
      use: () => P.api.unseat(),
    });
    for (const side of ['L', 'R']) {
      const cleat = P.anchors['cleatBow' + side];
      add({
        // radius from the eye: a standing player's eye is ~1.7 m above the deck
        id: 'moor.' + side, local: cleat ? cleat.clone() : L(0, 0, 0), radius: 2.5, viewCone: 0.3, hold: false,
        get labelKey() { return P.physics.moor.length ? 'seaplane.moor.castoff' : 'seaplane.moor.tie'; },
        get label() { return P.physics.moor.length ? 'Cast off' : 'Tie up'; },
        enabled: () => !this.seated && !!cleat && !P.physics.detached['float' + side] && (P.physics.moor.length > 0 || this._nearestMooring(cleat) !== null),
        use: () => { if (P.physics.moor.length) P.api.castOff(); else { const mp = this._nearestMooring(cleat); if (mp) P.api.moorTo([mp]); } },
      });
      const bow = P.anchors['bow' + side];
      add({
        id: 'pushoff.' + side, local: bow ? bow.clone() : L(0, 0, 0), radius: 2.5, viewCone: 0.2, hold: true, holdTime: 0, continuous: true,
        labelKey: 'seaplane.pushoff', label: 'Hold E: Push off the beach',
        enabled: () => !this.seated && !P.physics.detached['float' + side] && (P.physics.out.beached || (P.physics.out.groundContact && P.physics.out.groundSpeed < 1.5)) && !P.physics.moor.length,
        use: () => P.api.pushOff(1), // continuous: the host calls use() every frame while E is held
      });
    }
    add({
      id: 'refuel', local: L(-0.75, 2.05, 2.86), radius: 1.6, viewCone: 0.5, hold: true, holdTime: 4,
      get labelKey() { return 'seaplane.refuel'; },
      get label() { return `Hold E: Refuel from jerrycan (${this._cans()} left)`; },
      enabled: () => !this.seated && this._cans() > 0 && P.engine.fuel[0] + P.engine.fuel[1] < 2 * 140 - 5,
      use: () => { this.jerrycans--; P.engine.fuel[0] = Math.min(140, P.engine.fuel[0] + 10); P.engine.fuel[1] = Math.min(140, P.engine.fuel[1] + 10); P.emit('refuel', { litres: 20 }); },
    });
    add({
      id: 'floodlight', local: L(2.18, 3.15, 0.95), radius: 1.6, viewCone: 0.5, hold: false,
      labelKey: 'seaplane.floodlight', get label() { return P.lights.landing ? 'Switch floodlight off' : 'Switch floodlight on'; },
      enabled: () => !this.seated,
      use: () => { P.lights.landing = !P.lights.landing; P.emit('switch', { name: 'landing' }); },
    });
    for (const o of list) {
      const local = o.local;
      o.getWorldPosition = (out = new THREE.Vector3()) => out.copy(local).applyMatrix4(this.matrixWorld);
    }
    this.interactables = list;
  }

  _cans() { return this.jerrycans; }

  _nearestMooring(localCleat) {
    let best = null, bd = 6;
    this._v.copy(localCleat).applyMatrix4(this.matrixWorld);
    for (const m of this.mooringPoints) {
      const p = m.position || m;
      const d = p.distanceTo(this._v);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  // Which interactable the player is looking at (host may implement its own logic).
  pick(eyePos, lookDir) {
    let best = null, bestScore = -1;
    for (const o of this.interactables) {
      if (!o.enabled()) continue;
      o.getWorldPosition(this._v);
      this._w.subVectors(this._v, eyePos);
      const d = this._w.length();
      if (d > o.radius) continue;
      const cos = this._w.dot(lookDir) / Math.max(d, 1e-4);
      if (cos < o.viewCone) continue;
      const score = cos - d * 0.15 + (o.priority || 0) * 0.4;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    return best;
  }

  // ---------------- seats & transitions ---------------------------------------
  eyeFor(id) { return id === 'copilot' ? this.plane.anchors.eyeCopilot : this.plane.anchors.eyePilot; }

  seat(id, fromPos, fromQuat) {
    if (this.seated || this.transition) return false;
    const P = this.plane;
    const eye = this.eyeFor(id);
    const side = id === 'pilot' ? -1 : 1;
    const doorOut = L(side * 1.05, 2.75, 1.0);
    const doorIn = L(side * 0.62, 2.95, 1.05);
    const fromLocal = fromPos ? fromPos.clone().applyMatrix4(this.inverseMatrixWorld) : doorOut.clone();
    this.transition = {
      t: 0, dur: 0.85, toSeat: true, id,
      path: [fromLocal, doorOut, doorIn, eye.clone()],
      q0: fromQuat ? fromQuat.clone() : null,
    };
    this.seatId = id;
    P.emit('seatStart', { id });
    return true;
  }

  seatInstant(id) {
    this.transition = null;
    this.seated = true;
    this.seatId = id;
    this.plane.emit('seated', { id });
  }

  canExit() {
    const P = this.plane, o = P.physics.out;
    if (!this.seated) return { ok: false, reason: 'notSeated' };
    if (!o.onWater && !o.groundContact && P.physics.wreck === false && o.agl > 1.5) return { ok: false, reason: 'flying', hintKey: 'seaplane.hint.flying', hint: "Can't get out while flying" };
    if (o.groundSpeed > 4 && !P.physics.wreck) return { ok: false, reason: 'moving', hintKey: 'seaplane.hint.moving', hint: 'Slow down before getting out' };
    return { ok: true };
  }

  // computes the exit spot (world) into this.exitPose
  _exitSpot() {
    const P = this.plane, env = P.env;
    const side = this.seatId === 'copilot' ? 1 : -1;
    const ph = P.physics;
    const sinking = ph.flood.L + ph.flood.R > 0.8 || ph.wreck;
    // candidate 1: float deck beside the door
    const deckLocal = L(side * DIM.float.x, P.anchors.deckR.max.y + CG_MODEL.y, 1.0);
    // candidate 2: ground beside the door (beached)
    const groundLocal = L(side * 2.2, 0, 1.0);
    const pDeck = this._v.copy(deckLocal).applyMatrix4(this.matrixWorld);
    const out = this.exitPose;
    out.inWater = false;
    if (ph.out.beached || ph.out.groundContact) {
      const g = this._w.copy(groundLocal).applyMatrix4(this.matrixWorld);
      const gh = env.groundHeight ? env.groundHeight(g.x, g.z) : -1e9;
      const wh = env.waterHeight ? env.waterHeight(g.x, g.z) : -1e9;
      if (gh > wh - 0.25) { out.position.set(g.x, gh, g.z); out.surface = 'ground'; P.physics.pointVelocityWorld(g, out.velocity); return out; }
    }
    if (sinking) {
      const g = this._w.copy(groundLocal).applyMatrix4(this.matrixWorld);
      out.position.set(g.x, env.waterHeight ? env.waterHeight(g.x, g.z) : g.y, g.z);
      out.inWater = true; out.surface = 'water';
      out.velocity.set(0, 0, 0);
      return out;
    }
    out.position.copy(pDeck);
    out.surface = 'float';
    P.physics.pointVelocityWorld(pDeck, out.velocity);
    return out;
  }

  unseat() {
    if (!this.seated || this.transition) return null;
    const chk = this.canExit();
    if (!chk.ok) { this.plane.emit('hint', chk); return null; }
    const pose = this._exitSpot();
    const side = this.seatId === 'copilot' ? 1 : -1;
    const local = pose.position.clone().applyMatrix4(this.inverseMatrixWorld);
    local.y += 1.7; // eye height above the exit surface
    this.transition = {
      t: 0, dur: 0.7, toSeat: false, id: this.seatId,
      path: [this.eyeFor(this.seatId).clone(), L(side * 0.62, 2.95, 1.05), L(side * 1.05, 2.75, 1.0), local],
    };
    this.plane.emit('exitStart', { id: this.seatId });
    return pose;
  }

  // world position along the transition path (Catmull-Rom through plane-local points)
  _pathPoint(tr, t, out) {
    const p = tr.path;
    const n = p.length - 1;
    const f = Math.min(t * n, n - 1e-6);
    const i = Math.floor(f), u = f - i;
    const p0 = p[Math.max(i - 1, 0)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(i + 2, n)];
    const u2 = u * u, u3 = u2 * u;
    out.set(
      0.5 * (2 * p1.x + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3),
      0.5 * (2 * p1.y + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3),
      0.5 * (2 * p1.z + (-p0.z + p2.z) * u + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * u2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * u3));
    return out.applyMatrix4(this.matrixWorld);
  }

  update(dt, rootMatrixWorld) {
    this.matrixWorld.copy(rootMatrixWorld);
    this.inverseMatrixWorld.copy(rootMatrixWorld).invert();
    const tr = this.transition;
    if (tr) {
      tr.t += dt / tr.dur;
      if (tr.t >= 1) {
        this.transition = null;
        if (tr.toSeat) { this.seated = true; this.plane.emit('seated', { id: tr.id }); }
        else { this.seated = false; this.seatId = null; this.plane.emit('unseated', { pose: this.exitPose }); }
      }
    }
    // update exit pose while getting out so the host gets a current spot
    if (tr && !tr.toSeat) this._exitSpot();
  }

  // Seat camera with transitions. Returns true while the plane owns the camera.
  cameraPose(seatCam, lookYaw, lookPitch, planePos, planeQuat, outPos, outQuat) {
    const tr = this.transition;
    if (!this.seated && !tr) return false;
    const eye = this.eyeFor(this.seatId || 'pilot');
    seatCam.get(eye, lookYaw, lookPitch, planePos, planeQuat, outPos, outQuat);
    if (tr) {
      const k = ease(Math.min(tr.t, 1));
      this._pathPoint(tr, k, this._v);
      if (tr.toSeat) {
        // follow the path through the door, settle into the live seat pose at the end
        const b = k < 0.75 ? 0 : ease((k - 0.75) / 0.25);
        outPos.lerpVectors(this._v, outPos, b);
        if (tr.q0) { this._q.copy(tr.q0).slerp(outQuat, k); outQuat.copy(this._q); }
      } else {
        const b = k > 0.25 ? 1 : ease(k / 0.25);
        outPos.lerp(this._v, b);
      }
    }
    return true;
  }
}
