// Cameras: seat camera with a damped head spring (g-forces, vibration, chop,
// neck pivot) and a spring-arm chase camera. Allocation free per frame.
import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const LOOK_LIMITS = { yaw: (150 * Math.PI) / 180, pitchDown: (-70 * Math.PI) / 180, pitchUp: (60 * Math.PI) / 180 };

export class SeatCamera {
  constructor() {
    this.offset = new THREE.Vector3(); // head offset (plane-local)
    this.vel = new THREE.Vector3();
    this.vib = new THREE.Vector3();
    this.t = 0;
    this.fovDelta = 0;
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._n = new THREE.Vector3();
  }

  // accBody: specific force in the body frame (m/s^2, includes gravity reaction);
  // shake: { engine (0..1), rpm, chop (0..1), buffet (0..1), turbulence (0..1) }
  update(dt, accBody, shake, airspeed) {
    this.t += dt;
    const k = 140, c = 18;
    // head lags the cabin: acceleration pushes it opposite (gravity excluded)
    const ax = clamp(-accBody.x * 0.0035, -0.06, 0.06);
    const ay = clamp(-(accBody.y - 9.81) * 0.0028, -0.07, 0.05);
    const az = clamp(-accBody.z * 0.0035, -0.06, 0.06);
    this.vel.x += (-k * (this.offset.x - ax) - c * this.vel.x) * dt;
    this.vel.y += (-k * (this.offset.y - ay) - c * this.vel.y) * dt;
    this.vel.z += (-k * (this.offset.z - az) - c * this.vel.z) * dt;
    this.offset.addScaledVector(this.vel, dt);
    // vibration: engine firing (fast, tiny), chop and buffet (slower, larger)
    const t = this.t;
    const ef = (shake.rpm || 0) / 60 * 4.5;
    const e = (shake.engine || 0) * 0.0009;
    const ch = (shake.chop || 0) * 0.012, bf = (shake.buffet || 0) * 0.006, tb = (shake.turbulence || 0) * 0.004;
    this.vib.set(
      Math.sin(t * ef * 6.28 + 1.3) * e + Math.sin(t * 13.1) * bf + Math.sin(t * 2.3) * tb,
      Math.sin(t * ef * 6.28) * e * 1.4 + Math.sin(t * 7.3 + 0.5) * ch + Math.sin(t * 17.3) * bf + Math.sin(t * 3.1 + 1) * tb,
      Math.sin(t * ef * 3.14 + 0.7) * e * 0.6 + Math.sin(t * 5.1) * ch * 0.4);
    this.fovDelta += (clamp((airspeed - 18) * 0.11, 0, 5) - this.fovDelta) * Math.min(1, dt * 1.5);
  }

  // eyeLocal: seat eye point (plane-local). Writes world position / orientation.
  get(eyeLocal, lookYaw, lookPitch, planePos, planeQuat, outPos, outQuat) {
    const yaw = clamp(lookYaw, -LOOK_LIMITS.yaw, LOOK_LIMITS.yaw);
    const pitch = clamp(lookPitch, LOOK_LIMITS.pitchDown, LOOK_LIMITS.pitchUp);
    // neck pivot ~10 cm behind and below the eyes
    this._n.set(-Math.sin(yaw) * 0.09, Math.sin(pitch) * 0.04 - (1 - Math.cos(pitch)) * 0.05, -(1 - Math.cos(yaw)) * 0.06 + Math.sin(Math.abs(yaw)) * 0.03);
    this._v.copy(eyeLocal).add(this.offset).add(this.vib).add(this._n);
    outPos.copy(this._v).applyQuaternion(planeQuat).add(planePos);
    this._e.set(pitch, yaw, 0, 'YXZ');
    this._q.setFromEuler(this._e);
    outQuat.copy(planeQuat).multiply(this._q);
    return outPos;
  }
}

export class ChaseCamera {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.initialised = false;
    this.distance = 13;
    this.height = 3.2;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this._fwd = new THREE.Vector3();
    this._des = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._up = new THREE.Vector3(0, 1, 0);
    this._t = new THREE.Vector3();
    this._qt = new THREE.Quaternion();
    this._fresh = true;
  }

  reset() { this.initialised = false; this._fresh = true; }

  // planePos: frame origin; vel: world velocity; yawRate: rad/s; env for collisions
  update(dt, planePos, planeQuat, vel, yawRate, env) {
    const fwd = this._fwd.set(0, 0, -1).applyQuaternion(planeQuat);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    // orbit offsets from mouse look
    const yaw = this.orbitYaw - clamp(yawRate * 0.6, -0.35, 0.35);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const bx = -(fwd.x * c - fwd.z * s), bz = -(fwd.x * s + fwd.z * c);
    const h = this.height + Math.sin(this.orbitPitch) * this.distance;
    const d = this.distance * Math.cos(this.orbitPitch);
    this._des.set(planePos.x + bx * d, planePos.y + h, planePos.z + bz * d);
    // terrain / water clearance
    if (env) {
      const wh = env.waterHeight ? env.waterHeight(this._des.x, this._des.z) : -1e9;
      const gh = env.groundHeight ? env.groundHeight(this._des.x, this._des.z) : -1e9;
      this._des.y = Math.max(this._des.y, wh + 0.7, gh + 0.9);
    }
    if (!this.initialised) { this.pos.copy(this._des); this.vel.set(0, 0, 0); this.initialised = true; this._fresh = true; }
    // critically damped spring toward the desired point
    const w = 4.5;
    this._t.subVectors(this._des, this.pos);
    this.vel.addScaledVector(this._t, w * w * dt).multiplyScalar(Math.max(0, 1 - 2 * w * dt));
    this.pos.addScaledVector(this.vel, dt);
    // look slightly ahead of the plane, into the turn
    this.look.set(planePos.x + vel.x * 0.25, planePos.y + 1.0 + vel.y * 0.1, planePos.z + vel.z * 0.25);
    this._m.lookAt(this.pos, this.look, this._up);
    this._qt.setFromRotationMatrix(this._m);
    if (this._fresh) { this.quat.copy(this._qt); this._fresh = false; }
    else this.quat.slerp(this._qt, Math.min(1, dt * 8));
  }
}
