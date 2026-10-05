// First-person walker for the sandbox. Uses only the plane's public API the
// game would use: walkShapes (stand / ride on floats, ladder, step, cabin
// floor), blockShapes (capsule vs. hull), interactables (E prompts, hold-E
// progress, continuous actions) and pointVelocity (inherit motion on jumps).
import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const R = 0.33, HEIGHT = 1.8, EYE = 1.7, STEP = 0.45;

export class Walker {
  constructor({ world, groundHeight, waterHeight, pier, plane }) {
    this.world = world;
    this.groundHeight = groundHeight;
    this.waterHeight = waterHeight;
    this.pier = pier;
    this.plane = plane;
    this.pos = new THREE.Vector3(); // feet
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.keys = new Set();
    this.onGround = false;
    this.swimming = false;
    this.platform = null; // plane walk shape we stand on
    this.platformLocal = new THREE.Vector3();
    this.platformHeading = 0;
    this.focus = null; // interactable under the crosshair
    this.holdT = 0;
    this.holding = false;
    this.eHeld = false;
    this.eUsed = false;
    this.climbT = 0;
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._l = new THREE.Vector3();
    this._out = { normal: new THREE.Vector3(), depth: 0 };
    this._dir = new THREE.Vector3(); this._eye = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._m = new THREE.Matrix4();
  }

  setPose(pos, yaw = this.yaw) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.platform = null;
  }

  look(dx, dy) {
    this.yaw -= dx * 0.0022;
    this.pitch = clamp(this.pitch - dy * 0.0022, -1.45, 1.45);
  }

  eye(out) { return out.set(this.pos.x, this.pos.y + (this.swimming ? 1.45 : EYE), this.pos.z); }
  quaternion(out) { this._e.set(this.pitch, this.yaw, 0, 'YXZ'); return out.setFromEuler(this._e); }
  lookDir(out) { return out.set(0, 0, -1).applyQuaternion(this.quaternion(this._q)); }

  // support height under the feet from the terrain, the pier and the plane's walk shapes
  _support(px, py, pz) {
    let best = this.groundHeight(px, pz);
    let shape = null;
    const ps = this.pier.supportAt(px, pz, py);
    if (ps > best) best = ps;
    const shapes = this.plane.walkShapes;
    for (let i = 0; i < shapes.length; i++) {
      const s = shapes[i];
      const l = this._l.set(px, py, pz).applyMatrix4(s.inverseMatrixWorld);
      const m = 0.12;
      if (l.x < s.min.x - m || l.x > s.max.x + m || l.z < s.min.z - m || l.z > s.max.z + m) continue;
      if (l.y < s.max.y - STEP - 0.1 || l.y > s.max.y + 1.0) continue;
      this._w.set(l.x, s.max.y, l.z).applyMatrix4(s.matrixWorld);
      if (this._w.y > best) { best = this._w.y; shape = s; }
    }
    return { y: best, shape };
  }

  update(dt, input) {
    const plane = this.plane;
    // ride the platform: keep the plane-local foot position from the last frame
    if (this.platform && this.onGround) {
      const s = this.platform;
      this.pos.copy(this.platformLocal).applyMatrix4(s.matrixWorld);
      const hdg = Math.atan2(-s.matrixWorld.elements[8], -s.matrixWorld.elements[10]);
      let dh = hdg - this.platformHeading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.yaw += dh;
    }
    // input direction
    const k = this.keys;
    const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const r = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    const speed = this.swimming ? 1.6 : run ? 6.2 : 3.4;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wx = (-sy * f + cy * r), wz = (-cy * f - sy * r);
    const l = Math.hypot(wx, wz) || 1;
    const tx = (wx / l) * speed * (f || r ? 1 : 0), tz = (wz / l) * speed * (f || r ? 1 : 0);
    const accel = this.onGround || this.swimming ? 14 : 2.5;
    this.vel.x += (tx - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (tz - this.vel.z) * Math.min(1, accel * dt);
    // water
    const wh = this.waterHeight(this.pos.x, this.pos.z);
    const depth = wh - this.pos.y;
    this.swimming = depth > 1.25 && !(this.onGround && this.platform);
    if (this.swimming) {
      this.vel.y += ((wh - 1.35 - this.pos.y) * 4 - this.vel.y) * Math.min(1, dt * 3);
    } else {
      this.vel.y -= 9.81 * dt;
    }
    if (k.has('Space') && this.onGround && !this.swimming) {
      this.vel.y = 4.2;
      this.onGround = false;
      if (this.platform) { plane.pointVelocity(this.pos, this._v); this.vel.x += this._v.x; this.vel.z += this._v.z; this.vel.y += Math.max(0, this._v.y); }
      this.platform = null;
    }
    this.pos.addScaledVector(this.vel, dt);
    // collisions: world statics (palms, rocks, posts, hangar) — horizontal push-out
    for (const h of [0.45, 1.05, 1.55]) {
      this._v.set(this.pos.x, this.pos.y + h, this.pos.z);
      if (this.world.contact(this._v, R, this._out) && this._out.depth > 0) {
        const n = this._out.normal;
        if (n.y > 0.7 && h < 0.5) continue; // walkable top (handled as support)
        const hl = Math.hypot(n.x, n.z) || 1;
        this.pos.x += (n.x / hl) * this._out.depth;
        this.pos.z += (n.z / hl) * this._out.depth;
      }
    }
    // plane hull blocks (capsule vs. boxes in plane-local space)
    const blocks = plane.blockShapes;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const lp = this._l.copy(this.pos).applyMatrix4(b.inverseMatrixWorld);
      const y0 = lp.y + R, y1 = lp.y + HEIGHT - R;
      if (y1 < b.min.y || y0 > b.max.y) continue;
      const cx = clamp(lp.x, b.min.x, b.max.x), cz = clamp(lp.z, b.min.z, b.max.z);
      let dx = lp.x - cx, dz = lp.z - cz;
      let d = Math.hypot(dx, dz);
      if (d >= R) continue;
      if (d < 1e-5) {
        // inside: leave by the nearest side
        const ex = Math.min(lp.x - b.min.x, b.max.x - lp.x), ez = Math.min(lp.z - b.min.z, b.max.z - lp.z);
        if (ex < ez) { dx = lp.x - (b.min.x + b.max.x) / 2 > 0 ? 1 : -1; dz = 0; d = 0; lp.x = dx > 0 ? b.max.x : b.min.x; }
        else { dz = lp.z - (b.min.z + b.max.z) / 2 > 0 ? 1 : -1; dx = 0; d = 0; lp.z = dz > 0 ? b.max.z : b.min.z; }
        lp.x += dx * R; lp.z += dz * R;
      } else {
        lp.x += (dx / d) * (R - d);
        lp.z += (dz / d) * (R - d);
      }
      this.pos.copy(lp).applyMatrix4(b.matrixWorld);
    }
    // ground / platform support
    const sup = this._support(this.pos.x, this.pos.y, this.pos.z);
    const climb = this.swimming && (k.has('Space') || f > 0) && sup.y > this.pos.y && sup.y - this.pos.y < 2.1 && sup.shape;
    if (climb) { this.pos.y = sup.y; this.vel.y = 0; this.swimming = false; }
    if (this.pos.y <= sup.y + 0.02 && (this.pos.y > sup.y - STEP || this.vel.y <= 0)) {
      if (this.pos.y < sup.y - STEP && !climb) {
        // too high to step onto: treat as a wall (undo horizontal motion)
        this.pos.x -= this.vel.x * dt; this.pos.z -= this.vel.z * dt;
      } else {
        this.pos.y = sup.y;
        if (this.vel.y < 0) this.vel.y = 0;
        this.onGround = true;
      }
    } else if (this.pos.y > sup.y + 0.05) this.onGround = false;
    if (this.swimming) this.onGround = false;
    // remember the platform-local foot position for the next frame
    this.platform = this.onGround ? sup.shape : null;
    if (this.platform) {
      this.platformLocal.copy(this.pos).applyMatrix4(this.platform.inverseMatrixWorld);
      const e = this.platform.matrixWorld.elements;
      this.platformHeading = Math.atan2(-e[8], -e[10]);
    }
    // interactables (crosshair pick, E / hold-E)
    this._pick();
    this._interact(dt, input);
  }

  _pick() {
    const eye = this.eye(this._eye);
    const dir = this.lookDir(this._dir);
    let best = null, bestScore = -1e9;
    for (const it of this.plane.interactables) {
      if (!it.enabled()) continue;
      const p = it.getWorldPosition(this._w);
      const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > it.radius) continue;
      const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / Math.max(d, 1e-4);
      if (cos < it.viewCone) continue;
      const score = cos - d * 0.12;
      if (score > bestScore) { bestScore = score; best = it; }
    }
    if (best !== this.focus) { this.focus = best; this.holdT = 0; this.eUsed = false; }
  }

  _interact(dt, input) {
    const it = this.focus;
    const e = input.eDown;
    if (!it) { this.holdT = 0; this.eUsed = e; return; }
    if (!e) { this.holdT = 0; this.eUsed = false; it.progress = 0; return; }
    if (it.continuous) { it.use(this._from()); it.progress = 1; return; }
    if (this.eUsed) return;
    if (!it.hold || !it.holdTime) { it.use(this._from()); this.eUsed = true; return; }
    this.holdT += dt;
    it.progress = clamp(this.holdT / it.holdTime, 0, 1);
    if (this.holdT >= it.holdTime) { it.use(this._from()); this.eUsed = true; this.holdT = 0; it.progress = 0; }
  }

  _from() {
    this._fromObj = this._fromObj || { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    this.eye(this._fromObj.position);
    this.quaternion(this._fromObj.quaternion);
    return this._fromObj;
  }
}
