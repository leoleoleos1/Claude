// Input: remappable KEYMAP (KeyboardEvent.code), smoothing / rate limiting of the
// control positions, mouse-yoke, wheel throttle, flap notches, trim, discrete
// commands. The host may skip attachInput() and drive setControls()/command().

export const KEYMAP = {
  pitchDown: ['KeyW'],
  pitchUp: ['KeyS'],
  rollLeft: ['KeyA'],
  rollRight: ['KeyD'],
  rudderLeft: ['KeyZ'],
  rudderRight: ['KeyX'],
  throttleUp: ['KeyR'],
  throttleDown: ['KeyF'],
  flapsUp: ['KeyG'], // retract one notch
  flapsDown: ['KeyB'], // extend one notch
  engine: ['KeyQ'], // hold: crank / tap: shut down when running
  waterRudder: ['KeyU'],
  lights: ['KeyL'], // cycles: off -> nav -> nav + landing -> off
  camera: ['KeyV'],
  trimUp: ['PageUp', 'BracketLeft'], // nose up
  trimDown: ['PageDown', 'BracketRight'], // nose down
  interact: ['KeyE'], // hold to get out when seated
  mouseYokeButton: 2, // right mouse button
};

export const FLAP_NOTCHES = [0, 10, 20, 30]; // degrees

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function approach(cur, target, up, down, dt) {
  const rate = Math.abs(target) > Math.abs(cur) && Math.sign(target) === Math.sign(cur || target) ? up : down;
  const d = target - cur;
  const step = rate * dt;
  return Math.abs(d) <= step ? target : cur + Math.sign(d) * step;
}

export class Controls {
  constructor(keymap = KEYMAP) {
    this.keymap = keymap;
    this.keys = new Set();
    // smoothed control positions
    this.pitch = 0; // +1 = stick back (nose up)
    this.roll = 0; // +1 = right
    this.yaw = 0; // +1 = right pedal
    this.throttle = 0;
    this.trim = 0;
    this.flapIndex = 0;
    // external (programmatic) targets; null = not driven
    this.ext = { pitch: null, roll: null, yaw: null, throttle: null };
    this.mouseYoke = false;
    this.yoke = { x: 0, y: 0 }; // mouse yoke position
    this.mouseSensitivity = 0.0045;
    this.wheelStep = 0.05;
    this.commands = []; // discrete edge events for the plane
    this.held = { engine: false, interact: false };
    this._engineDown = 0;
    this._dom = null;
    this._h = null;
    this.enabled = true;
  }

  _match(action, code) { const k = this.keymap[action]; return Array.isArray(k) && k.includes(code); }
  _down(action) { const k = this.keymap[action]; if (!Array.isArray(k)) return false; for (const c of k) if (this.keys.has(c)) return true; return false; }

  attach(dom) {
    if (this._dom) this.detach();
    this._dom = dom;
    const h = this._h = {
      keydown: (e) => {
        if (!this.enabled) return;
        const code = e.code;
        if (this.keys.has(code)) return; // ignore auto-repeat
        this.keys.add(code);
        if (this._match('flapsUp', code)) this.commands.push('flapsUp');
        else if (this._match('flapsDown', code)) this.commands.push('flapsDown');
        else if (this._match('waterRudder', code)) this.commands.push('toggleWaterRudder');
        else if (this._match('lights', code)) this.commands.push('cycleLights');
        else if (this._match('camera', code)) this.commands.push('toggleCamera');
        else if (this._match('engine', code)) { this.held.engine = true; this._engineDown = performance.now(); this.commands.push('engineDown'); }
        else if (this._match('interact', code)) { this.held.interact = true; this.commands.push('interactDown'); }
        if (code === 'PageUp' || code === 'PageDown') e.preventDefault();
      },
      keyup: (e) => {
        const code = e.code;
        this.keys.delete(code);
        if (this._match('engine', code)) {
          this.held.engine = false;
          const dtMs = performance.now() - this._engineDown;
          this.commands.push(dtMs < 280 ? 'engineTap' : 'engineUp');
        } else if (this._match('interact', code)) { this.held.interact = false; this.commands.push('interactUp'); }
      },
      blur: () => { this.keys.clear(); this.held.engine = false; this.held.interact = false; this.mouseYoke = false; },
      mousedown: (e) => { if (e.button === this.keymap.mouseYokeButton) { this.mouseYoke = true; e.preventDefault(); } },
      mouseup: (e) => { if (e.button === this.keymap.mouseYokeButton) this.mouseYoke = false; },
      mousemove: (e) => {
        if (!this.mouseYoke || !this.enabled) return;
        this.yoke.x = clamp(this.yoke.x + e.movementX * this.mouseSensitivity, -1, 1);
        this.yoke.y = clamp(this.yoke.y + e.movementY * this.mouseSensitivity, -1, 1);
      },
      wheel: (e) => {
        if (!this.enabled) return;
        this.throttle = clamp(this.throttle - Math.sign(e.deltaY) * this.wheelStep, 0, 1);
        this.ext.throttle = null;
      },
      contextmenu: (e) => { e.preventDefault(); },
    };
    dom.addEventListener('keydown', h.keydown);
    dom.addEventListener('keyup', h.keyup);
    dom.addEventListener('blur', h.blur);
    dom.addEventListener('mousedown', h.mousedown);
    dom.addEventListener('mouseup', h.mouseup);
    dom.addEventListener('mousemove', h.mousemove);
    dom.addEventListener('wheel', h.wheel, { passive: true });
    dom.addEventListener('contextmenu', h.contextmenu);
  }

  detach() {
    const dom = this._dom, h = this._h;
    if (!dom) return;
    dom.removeEventListener('keydown', h.keydown);
    dom.removeEventListener('keyup', h.keyup);
    dom.removeEventListener('blur', h.blur);
    dom.removeEventListener('mousedown', h.mousedown);
    dom.removeEventListener('mouseup', h.mouseup);
    dom.removeEventListener('mousemove', h.mousemove);
    dom.removeEventListener('wheel', h.wheel);
    dom.removeEventListener('contextmenu', h.contextmenu);
    this._dom = null;
    this.keys.clear();
    this.mouseYoke = false;
  }

  // programmatic path (host input systems)
  set(obj) {
    for (const k of ['pitch', 'roll', 'yaw', 'throttle']) if (obj[k] !== undefined) this.ext[k] = obj[k] === null ? null : clamp(obj[k], k === 'throttle' ? 0 : -1, 1);
    if (obj.trim !== undefined) this.trim = clamp(obj.trim, -1, 1);
    if (obj.flaps !== undefined) this.flapIndex = clamp(Math.round(obj.flaps), 0, FLAP_NOTCHES.length - 1);
    if (obj.starter !== undefined) this.held.engine = !!obj.starter;
    if (obj.mouseYoke !== undefined) { this.yoke.x = clamp(obj.mouseYoke.x, -1, 1); this.yoke.y = clamp(obj.mouseYoke.y, -1, 1); }
  }

  // smoothing step (call every frame with real dt)
  update(dt) {
    const k = (a) => (this._down(a) ? 1 : 0);
    let tp = k('pitchUp') - k('pitchDown');
    let tr = k('rollRight') - k('rollLeft');
    let ty = k('rudderRight') - k('rudderLeft');
    if (this.mouseYoke) { tp = -this.yoke.y; tr = this.yoke.x; }
    else { this.yoke.x = approach(this.yoke.x, 0, 0, 2.5, dt); this.yoke.y = approach(this.yoke.y, 0, 0, 2.5, dt); }
    if (this.ext.pitch !== null) tp = this.ext.pitch;
    if (this.ext.roll !== null) tr = this.ext.roll;
    if (this.ext.yaw !== null) ty = this.ext.yaw;
    // keyboard: ramp up gently, return briskly; mouse/external follow fast
    const fast = this.mouseYoke || this.ext.pitch !== null;
    this.pitch = approach(this.pitch, tp, fast ? 6 : 1.6, fast ? 6 : 3.2, dt);
    this.roll = approach(this.roll, tr, fast ? 6 : 2.2, fast ? 6 : 3.6, dt);
    this.yaw = approach(this.yaw, ty, this.ext.yaw !== null ? 6 : 2.0, 3.2, dt);
    // throttle
    if (this.ext.throttle !== null) this.throttle = approach(this.throttle, this.ext.throttle, 1.2, 1.2, dt);
    else this.throttle = clamp(this.throttle + (k('throttleUp') - k('throttleDown')) * 0.45 * dt, 0, 1);
    // trim (held keys)
    this.trim = clamp(this.trim + (k('trimUp') - k('trimDown')) * 0.3 * dt, -1, 1);
  }

  drainCommands(out) {
    out.length = 0;
    for (const c of this.commands) out.push(c);
    this.commands.length = 0;
    return out;
  }
}
