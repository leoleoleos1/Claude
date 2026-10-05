// Crash debris. The pre-split pieces (both float hulls, both outer wing panels and
// the propeller) leave the airframe when physics.detached flags them: the static
// meshes of every LOD drop the piece's triangles (index range, see assemble.js) and
// a world-space copy takes over - a small rigid box that tumbles, floats or sinks
// and comes to rest flat on the ground. When repair() clears the flags, sync()
// puts every piece back.
import * as THREE from 'three';
import { PIECES, createPieceViews } from './model/assemble.js';

const G = 9.81;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// density relative to water (< 1 floats), launch kick in plane axes (m/s),
// tumble rate (rad/s) and the box axis that ends up vertical when it settles
const SPEC = {
  floatL: { density: 0.22, kick: [-4.2, 2.0, 1.5], spin: 1.2, flat: 1 },
  floatR: { density: 0.22, kick: [4.2, 2.0, 1.5], spin: 1.2, flat: 1 },
  wingTipL: { density: 0.55, kick: [-3.2, 2.2, 1.5], spin: 3.5, flat: 1 },
  wingTipR: { density: 0.55, kick: [3.2, 2.2, 1.5], spin: 3.5, flat: 1 },
  prop: { density: 3.5, kick: [0, 2.5, -4.5], spin: 5, flat: 2 },
};

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

export class Debris {
  // o: { root, worldRoot, lods, hinges, prop: { pivot, blades, spinner, hub, radius }, physics, env, rand,
  //      onSplash(x, y, z, strength, vel), onImpact(strength), onDetach(id) }
  constructor(o) {
    this.o = o;
    this.pieces = [];
    this.mask = 0;
    this.active = 0;
    const lod0 = o.lods[0];
    PIECES.forEach((def, k) => {
      const box = new THREE.Box3();
      for (const br of lod0.breakables) if (br.runs[k].count) box.union(br.runs[k].box);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const p = this._piece(def.id, k, center, box.getSize(new THREE.Vector3()).multiplyScalar(0.5));
      for (const m of createPieceViews(lod0, k, center)) p.group.add(m);
      const h = o.hinges[def.hinge];
      p.carry = h ? (h.retract ? h.retract.object : h.object) : null;
      this.pieces.push(p);
    });
    // the propeller: the LOD0 pivot (spinner + blades) flies off as it is
    const pr = o.prop;
    const pp = this._piece('prop', -1, pr.hub.clone(), new THREE.Vector3(pr.radius, pr.radius, 0.22));
    pp.carry = pr.pivot;
    this.pieces.push(pp);
    this.byId = {};
    for (const p of this.pieces) this.byId[p.id] = p;
  }

  _piece(id, k, center, half) {
    const group = new THREE.Group();
    group.name = 'seaplane.debris.' + id;
    group.visible = false;
    this.o.worldRoot.add(group);
    return {
      id, k, bit: 1 << (k < 0 ? PIECES.length : k), spec: SPEC[id], group, center, half,
      carry: null, carryParent: null, carryPos: new THREE.Vector3(), carryQuat: new THREE.Quaternion(),
      vel: new THREE.Vector3(), w: new THREE.Vector3(), on: false, asleep: false, restT: 0, wet: false, dryT: 0,
    };
  }

  // bit mask of detached pieces (bits follow PIECES, then the prop)
  static maskOf(det) {
    let m = 0;
    for (let k = 0; k < PIECES.length; k++) if (det[PIECES[k].id]) m |= 1 << k;
    if (det.prop) m |= 1 << PIECES.length;
    return m;
  }

  // Bring the visuals in line with physics.detached (call every frame; cheap when unchanged).
  sync() {
    const det = this.o.physics.detached;
    const mask = Debris.maskOf(det);
    if (mask === this.mask) return false;
    for (const p of this.pieces) {
      const now = (mask & p.bit) !== 0, was = (this.mask & p.bit) !== 0;
      if (now && !was) this._detach(p);
      else if (!now && was) this._attach(p);
    }
    this.mask = mask;
    this._trim(det);
    return true;
  }

  // statics of every LOD: visible runs first, the draw range ends before the detached ones
  _trim(det) {
    for (const lod of this.o.lods) {
      for (const br of lod.breakables) {
        const idx = br.mesh.geometry.index, arr = idx.array;
        let pos = br.rest;
        for (let k = 0; k < PIECES.length; k++) {
          const r = br.runs[k];
          if (!r.count || det[PIECES[k].id]) continue;
          arr.set(br.tail.subarray(r.start - br.rest, r.start - br.rest + r.count), pos);
          pos += r.count;
        }
        br.mesh.geometry.setDrawRange(0, pos === arr.length ? Infinity : pos);
        idx.clearUpdateRanges();
        idx.addUpdateRange(br.rest, arr.length - br.rest);
        idx.needsUpdate = true;
      }
    }
  }

  _detach(p) {
    const { root, physics, rand } = this.o;
    const g = p.group;
    g.position.copy(p.center).applyMatrix4(root.matrixWorld);
    root.getWorldQuaternion(g.quaternion);
    g.updateMatrixWorld(true);
    if (p.carry) {
      p.carryParent = p.carry.parent;
      p.carryPos.copy(p.carry.position);
      p.carryQuat.copy(p.carry.quaternion);
      p.carry.position.sub(p.center);
      g.add(p.carry);
    }
    g.visible = true;
    // velocity of that point of the airframe plus a kick in plane axes
    physics.pointVelocityWorld(g.position, p.vel);
    const s = p.spec;
    _v.set(s.kick[0] * (0.7 + rand() * 0.6), s.kick[1] * (0.7 + rand() * 0.6), s.kick[2] * (0.7 + rand() * 0.6)).applyQuaternion(g.quaternion);
    p.vel.add(_v);
    physics.toWorldDir(physics.w, p.w);
    p.w.x += (rand() - 0.5) * 2 * s.spin; p.w.y += (rand() - 0.5) * 2 * s.spin; p.w.z += (rand() - 0.5) * 2 * s.spin;
    p.on = true; p.asleep = false; p.restT = 0; p.wet = false; p.dryT = 1;
    this.active++;
    if (this.o.onDetach) this.o.onDetach(p.id);
  }

  _attach(p) {
    p.group.visible = false;
    if (p.carry && p.carryParent) {
      p.carryParent.add(p.carry);
      p.carry.position.copy(p.carryPos);
      p.carry.quaternion.copy(p.carryQuat);
    }
    if (p.on) this.active--;
    p.on = false;
  }

  update(dt) {
    if (!this.active || dt <= 0) return;
    const n = Math.min(Math.ceil(dt / 0.02), 6), h = dt / n;
    for (const p of this.pieces) {
      if (!p.on || p.asleep) continue;
      for (let i = 0; i < n; i++) this._step(p, h);
    }
  }

  _step(p, h) {
    const env = this.o.env, g = p.group, pos = g.position, v = p.vel, w = p.w, s = p.spec;
    _m.makeRotationFromQuaternion(g.quaternion);
    const e = _m.elements;
    // vertical half extent of the rotated box (its lowest corner is pos.y - hy)
    const hy = Math.abs(e[1]) * p.half.x + Math.abs(e[5]) * p.half.y + Math.abs(e[9]) * p.half.z;
    v.y -= G * h;
    // water: buoyancy by submerged fraction, drag towards the current, splash on entry
    const wh = env.waterHeight(pos.x, pos.z);
    const sub = clamp((wh - (pos.y - hy)) / (2 * hy), 0, 1);
    if (sub > 0) {
      if (!p.wet && p.dryT > 0.4 && v.y < -2) {
        const k = clamp((-v.y / 5) * Math.sqrt(p.half.x * p.half.z + 0.1), 0.4, 2.2);
        if (this.o.onSplash) this.o.onSplash(pos.x, wh, pos.z, k, v);
      }
      p.wet = true; p.dryT = 0;
      v.y += (G * sub / s.density) * h;
      if (env.waterFlow) env.waterFlow(pos.x, pos.z, _f); else _f.set(0, 0, 0);
      if (env.wind && s.density < 1) _f.addScaledVector(env.wind, 0.025 * (1 - sub));
      const kH = 1 - Math.exp(-(0.5 + 2 * sub) * h), kV = 1 - Math.exp(-(1.5 + 6 * sub) * h);
      v.x += (_f.x - v.x) * kH; v.z += (_f.z - v.z) * kH; v.y -= v.y * kV;
      w.multiplyScalar(Math.exp(-2.5 * sub * h));
    } else {
      p.dryT += h;
      if (p.dryT > 0.4) p.wet = false;
    }
    // ground: lowest corner on the terrain, small bounce, strong friction
    const gh = env.groundHeight(pos.x, pos.z);
    let ground = false;
    if (Number.isFinite(gh) && pos.y - hy < gh) {
      pos.y = gh + hy;
      if (v.y < 0) {
        if (v.y < -3 && this.o.onImpact) this.o.onImpact(clamp(-v.y / 6, 0.3, 1.5));
        v.y *= -0.2;
      }
      const kf = 1 - Math.exp(-4 * h);
      v.x -= v.x * kf; v.z -= v.z * kf;
      w.multiplyScalar(Math.exp(-5 * h));
      ground = true;
    }
    // settle flat: turn the piece's flat axis (either sign) towards world up
    if (ground || sub > 0) {
      const a = s.flat * 4, sg = e[a + 1] < 0 ? -1 : 1;
      const k = (ground ? 22 : 10 * sub) * h;
      w.x += -e[a + 2] * sg * k;
      w.z += e[a] * sg * k;
      w.multiplyScalar(Math.exp(-2 * h));
    }
    v.multiplyScalar(Math.exp(-0.03 * h));
    pos.addScaledVector(v, h);
    const wl = w.length();
    if (wl > 1e-6) {
      _q.setFromAxisAngle(_v.copy(w).divideScalar(wl), wl * h);
      g.quaternion.premultiply(_q).normalize();
    }
    // rest on the ground; a sinking piece out of sight stops too
    if (ground && v.lengthSq() < 0.01 && wl < 0.1) {
      p.restT += h;
      if (p.restT > 1) p.asleep = true;
    } else p.restT = 0;
    if (pos.y < wh - 30) { p.asleep = true; g.visible = false; }
  }

  // world positions of the detached pieces (for hosts that want to tag / collide them)
  list(out = []) {
    out.length = 0;
    for (const p of this.pieces) if (p.on) out.push(p.group);
    return out;
  }

  dispose() {
    for (const p of this.pieces) {
      this._attach(p);
      p.group.traverse((o) => { if (o.isMesh && o.name.endsWith('.piece')) o.geometry.dispose(); });
      p.group.removeFromParent();
    }
  }
}
