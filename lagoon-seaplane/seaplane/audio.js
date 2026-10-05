// Procedural sound for the seaplane. A sample-accurate DSP core synthesises
// six stems (exhaust, propeller, mechanical, water, structure, cockpit); it runs
// in an AudioWorklet (source serialised from the classes below into a Blob URL)
// or, where worklets are unavailable, in a ScriptProcessor fallback with the same
// code. Wind, water rush/spray hiss and the stall horn are plain node graphs.
// Everything is created once; per-frame updates only move AudioParams.
import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// k-rate parameters of the synth core (also the AudioWorklet parameter names)
export const SYNTH_PARAMS = ['rpm', 'combust', 'load', 'misfire', 'rough', 'starter', 'knock', 'bend', 'air', 'pops', 'drain', 'grind', 'scrape', 'rattle', 'fire', 'flap'];

// ---------------------------------------------------------------------------
// DSP building blocks (no globals: sample rate passed explicitly so the same
// code runs in the worklet scope and on the main thread).
// Two-pole resonator. tick(x): impulse excitation (unit impulse -> unit-amplitude
// ring); noise(x): white-noise excitation normalised so the output level does not
// depend on the bandwidth.
export class DspRes {
  constructor() { this.y1 = 0; this.y2 = 0; this.a1 = 0; this.a2 = 0; this.g = 0; this.nk = 0; }
  set(f, tau, sr) {
    const w = (6.283185307179586 * Math.min(f, sr * 0.45)) / sr;
    const r = Math.exp(-1 / (tau * sr));
    this.a1 = 2 * r * Math.cos(w);
    this.a2 = -r * r;
    this.g = Math.sin(w);
    this.nk = Math.sqrt(2 * (1 - r));
    return this;
  }
  noise(x) { return this.tick(x * this.nk); }
  tick(x) {
    let y = this.a1 * this.y1 + this.a2 * this.y2 + x * this.g;
    if (y < 1e-12 && y > -1e-12) y = 0;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
  clear() { this.y1 = 0; this.y2 = 0; }
}

export class DspVoice {
  constructor() {
    this.on = false; this.type = 0; this.stem = 3; this.t = 0; this.dur = 0; this.a = 0; this.p = 0;
    this.env = 0; this.k1 = 0; this.k2 = 0; this.lp = 0; this.ph = 0; this.f0 = 0; this.f1 = 0;
    this.r1 = new DspRes(); this.r2 = new DspRes(); this.r3 = new DspRes();
  }
}

// One-shot voice types: 1 slap, 2 splash, 3 slam, 4 click, 5 detent, 6 clunk,
// 7 door open, 8 door close, 9 creak / rope, 10 crash, 11 impact.
// The synthesiser (serialised into the worklet, so it references nothing
// outside these three classes). render(outs, n, p): outs = 6 Float32Arrays
//  0 exhaust (9-cylinder radial firing pulses, bark, crackle, pops, coughs)
//  1 propeller (blade-pass buzz, whoosh, bent-prop wobble)
//  2 mechanical (valvetrain, starter motor, knocking, flap motor)
//  3 water (slaps, splashes, slams, draining, grinding)
//  4 structure (doors, creaks, scrape, crash, fire crackle)
//  5 cockpit (switch clicks, lever detents, rattles)
export class SeaplaneSynthCore {
  constructor(sr, seed) {
    this.sr = sr;
    this.s = ((seed || 1) * 2654435761) >>> 0 || 1;
    this.cyc = 0; this.idx = 0; this.bp = 0; this.rev = 0;
    this.resT = new DspRes(); this.resB = new DspRes(); this.resC = new DspRes();
    this.resK = new DspRes(); this.resV = new DspRes(); this.resV2 = new DspRes();
    this.impT = 0; this.impB = 0; this.crack = 0; this.chuff = 0; this.chuffY = 0; this.impV = 0; this.impK = 0;
    this.pe1 = 0; this.pe2 = 0; this.dcY = 0;
    this.cough = 0; this.bang = 0; this.lastRpm = 0;
    this.cyl = new Float64Array(9);
    for (let i = 0; i < 9; i++) this.cyl[i] = 0.84 + this.r() * 0.32;
    this.st = 0; this.stPh = 0; this.propY = 0; this.propY2 = 0;
    this.voices = [];
    for (let i = 0; i < 16; i++) this.voices.push(new DspVoice());
    this.plink = [new DspRes(), new DspRes(), new DspRes()]; this.plinkI = 0; this.plinkImp = new Float64Array(3);
    this.rat = [new DspRes(), new DspRes(), new DspRes(), new DspRes()]; this.ratI = 0; this.ratImp = new Float64Array(4);
    this.scr = [new DspRes().set(1150, 0.02, sr), new DspRes().set(2710, 0.015, sr), new DspRes().set(4350, 0.01, sr)];
    this.scrAM = 0; this.scrT = 0; this.g1 = 0; this.g2 = 0; this.grAM = 0.5;
    this.fireR = new DspRes().set(950, 0.0025, sr); this.fireImp = 0; this.fireY = 0;
    this.flPh = 0; this.flPh2 = 0; this.flSm = 0;
    this.lp = 0;
  }

  r() { this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0; return this.s / 4294967296; }
  _c(v, a, b) { return v < a ? a : v > b ? b : v; }

  // one-shots and engine events. a: amplitude (0..~3), p: optional variation
  trigger(e, a, p) {
    a = a === undefined ? 1 : a;
    if (e === 'cough') { this.cough += Math.max(1, Math.round(a)); return; }
    if (e === 'backfire') {
      this.bang = Math.max(this.bang, a);
      if (this.lastRpm < 15) { this.impT += 1.6 * a; this.impB += 1.4 * a; this.crack = Math.max(this.crack, 2 * a); this.bang = 0; }
      return;
    }
    let v = null, oldest = null;
    for (let i = 0; i < this.voices.length; i++) {
      const x = this.voices[i];
      if (!x.on) { v = x; break; }
      if (!oldest || x.t > oldest.t) oldest = x;
    }
    if (!v) v = oldest;
    const sr = this.sr;
    v.on = true; v.t = 0; v.a = a; v.p = p || 0; v.env = 1; v.lp = 0; v.ph = 0;
    v.r1.clear(); v.r2.clear(); v.r3.clear();
    const dk = (tau) => Math.exp(-1 / (tau * sr));
    switch (e) {
      case 'slap':
        v.type = 1; v.stem = 3; v.dur = 0.35 * sr; v.k1 = dk(0.025);
        v.r1.set(330 + this.r() * 260, 0.012, sr); v.r2.set(80 + this.r() * 30, 0.035, sr); v.r3.set(900 + this.r() * 700, 0.006, sr);
        break;
      case 'splash':
        v.type = 2; v.stem = 3; v.dur = (0.9 + 0.8 * Math.min(a, 2)) * sr; v.k1 = dk(0.25 + 0.15 * Math.min(a, 2));
        v.r2.set(65, 0.06, sr); v.r1.set(800, 0.015, sr);
        break;
      case 'slam':
        v.type = 3; v.stem = 3; v.dur = 0.9 * sr; v.k1 = dk(0.14);
        v.r2.set(52 + this.r() * 10, 0.09, sr); v.r1.set(420, 0.03, sr);
        break;
      case 'click':
        v.type = 4; v.stem = 5; v.dur = 0.04 * sr;
        v.r1.set(3600 + this.r() * 600, 0.0016, sr); v.r2.set(1450, 0.003, sr);
        break;
      case 'detent':
        v.type = 5; v.stem = 5; v.dur = 0.08 * sr;
        v.r1.set(2000 + this.r() * 300, 0.004, sr); v.r2.set(430, 0.01, sr);
        break;
      case 'clunk':
        v.type = 6; v.stem = 2; v.dur = 0.2 * sr;
        v.r1.set(150, 0.03, sr); v.r2.set(880, 0.008, sr);
        break;
      case 'doorOpen':
        v.type = 7; v.stem = 4; v.dur = 0.75 * sr; v.f0 = 55; v.f1 = 32;
        v.r1.set(2600, 0.003, sr); v.r2.set(680 + this.r() * 120, 0.009, sr); v.r3.set(1540, 0.004, sr);
        break;
      case 'doorClose':
        v.type = 8; v.stem = 4; v.dur = 0.45 * sr; v.k1 = dk(0.02);
        v.r1.set(2400, 0.003, sr); v.r2.set(112, 0.06, sr); v.r3.set(520, 0.02, sr);
        break;
      case 'creak': case 'rope': {
        const rope = e === 'rope';
        v.type = 9; v.stem = 4; v.dur = (0.25 + this.r() * 0.6) * sr;
        v.f0 = (rope ? 18 : 30) + this.r() * 30; v.f1 = v.f0 * (0.5 + this.r() * 0.9);
        const fr = (rope ? 380 : 560) + this.r() * 420;
        v.r2.set(fr, 0.012, sr); v.r3.set(fr * 2.31, 0.006, sr);
        break;
      }
      case 'crash':
        v.type = 10; v.stem = 4; v.dur = 2.4 * sr; v.k1 = dk(0.55);
        v.r1.set(1090, 0.35, sr); v.r2.set(2630, 0.25, sr); v.r3.set(46, 0.16, sr);
        break;
      case 'impact':
        v.type = 11; v.stem = 4; v.dur = 0.6 * sr; v.k1 = dk(0.04);
        v.r1.set(640 + this.r() * 300, 0.07, sr); v.r2.set(1850 + this.r() * 500, 0.045, sr); v.r3.set(85, 0.07, sr);
        break;
      default:
        v.on = false;
    }
  }

  _voice(v, nz) {
    const sr = this.sr;
    const t = v.t;
    const a = v.a;
    let y = 0;
    switch (v.type) {
      case 1: { // slap: hull thump + short burst of filtered noise
        const imp = t === 0 ? a * 1.4 : 0;
        v.env *= v.k1;
        const ns = nz * v.env * a;
        y = v.r2.tick(imp) * 0.9 + v.r1.noise(ns) * 1.6 + v.r3.noise(ns) * 0.6;
        break;
      }
      case 2: { // splash: noisy wash with bubbles
        const att = Math.min(1, t / (0.015 * sr));
        v.env *= v.k1;
        v.lp += (nz - v.lp) * 0.3;
        const imp = t === 0 ? a : 0;
        if (this.r() < 90 / sr) v.r1.set(500 + this.r() * 2400, 0.012 + this.r() * 0.02, sr);
        y = v.lp * att * v.env * a * 0.75 + v.r2.tick(imp) * 0.7 + v.r1.noise(nz * v.env * a) * 0.5;
        break;
      }
      case 3: { // slam: big low thud + spray noise
        const imp = t === 0 ? a * 2.2 : 0;
        v.env *= v.k1;
        v.lp += (nz - v.lp) * 0.4;
        y = v.r2.tick(imp) * 0.8 + v.r1.tick(imp * 0.3) + v.lp * v.env * a * 0.5;
        break;
      }
      case 4: { // switch click: two contacts a few ms apart
        const imp = t === 0 || t === Math.round(0.006 * sr) ? a : 0;
        y = v.r1.tick(imp) * 0.8 + v.r2.tick(imp) * 0.4;
        break;
      }
      case 5: { // lever detent
        const imp = t === 0 ? a : t === Math.round(0.012 * sr) ? a * 0.4 : 0;
        y = v.r1.tick(imp) * 0.6 + v.r2.tick(imp) * 0.6;
        break;
      }
      case 6: { // clunk (starter bendix, lever stops)
        const imp = t === 0 ? a : 0;
        y = v.r1.tick(imp) * 0.9 + v.r2.tick(imp) * 0.4;
        break;
      }
      case 7: { // door open: latch click, then a hinge creak
        const imp = t === 0 ? a : 0;
        y = v.r1.tick(imp) * 0.6;
        const tc = t - 0.05 * sr;
        if (tc > 0) {
          const u = tc / (v.dur - 0.05 * sr);
          const f = v.f0 + (v.f1 - v.f0) * u;
          v.ph += f / sr;
          let pulse = 0;
          if (v.ph >= 1) { v.ph -= 1; pulse = a * (0.6 + this.r() * 0.6) * Math.sin(Math.PI * Math.min(u, 1)); }
          y += v.r2.tick(pulse) * 0.5 + v.r3.tick(pulse) * 0.25;
        }
        break;
      }
      case 8: { // door close: thud, rattle, latch
        const imp = t === 0 ? a * 1.5 : 0;
        const latch = t === Math.round(0.045 * sr) ? a * 0.8 : 0;
        v.env *= v.k1;
        y = v.r2.tick(imp) * 0.8 + v.r3.tick(imp * 0.5) * 0.5 + v.r3.noise(nz * v.env * a) * 0.3 + v.r1.tick(latch) * 0.6;
        break;
      }
      case 9: { // creak: stick-slip impulse train through a wooden/metal resonance
        const u = t / v.dur;
        const f = v.f0 + (v.f1 - v.f0) * u;
        v.ph += f / sr;
        let pulse = 0;
        if (v.ph >= 1) { v.ph -= 1; pulse = a * (0.5 + this.r() * 0.7) * Math.sin(Math.PI * u); }
        y = v.r2.tick(pulse) * 0.55 + v.r3.tick(pulse) * 0.3;
        break;
      }
      case 10: { // crash: thump, tearing noise, ringing metal
        const imp = t === 0 ? a * 3 : 0;
        v.env *= v.k1;
        v.lp += (nz - v.lp) * 0.35;
        const ns = v.lp * v.env * a;
        y = v.r3.tick(imp) * 0.8 + ns * 0.7 + v.r1.noise(nz * v.env * a) * 0.6 + v.r2.noise(nz * v.env * a) * 0.45;
        break;
      }
      case 11: { // impact / bump on something hard
        const imp = t === 0 ? a : 0;
        v.env *= v.k1;
        y = v.r3.tick(imp * 1.2) * 0.8 + v.r1.tick(imp) * 0.5 + v.r1.noise(nz * v.env * a) * 0.4 + v.r2.tick(imp * 0.7) * 0.35;
        break;
      }
      default:
        break;
    }
    v.t = t + 1;
    if (v.t >= v.dur) v.on = false;
    return y;
  }

  // engine firing event (every 2/9 rev); i: cylinder in firing order
  _fire(i, combust, load, misfire, rough, pops, knock, rpm) {
    if (combust && this.r() >= misfire) {
      let a = (0.3 + 0.7 * load) * this.cyl[i] * (1 + (this.r() - 0.5) * (0.12 + rough * 0.9));
      if (this.cough > 0) { a *= 1.9; this.cough -= 1; }
      if (this.bang > 0) { a *= 1 + 2 * this.bang; this.crack = Math.max(this.crack, 2.4 * this.bang); this.bang = 0; }
      if (pops > 0 && this.r() < pops) { a *= 1.7; this.crack = Math.max(this.crack, 1.8); }
      this.impT += a;
      this.impB += a * 0.8;
      this.crack = Math.max(this.crack, a * 0.8);
      if (knock > 0 && this.r() < knock * 0.5) this.impK += 0.7 * knock;
    } else if (rpm > 15) {
      if (this.cough > 0 && this.r() < 0.45) { // a cylinder fires while cranking / sputtering
        const a = 1.3 + this.r() * 0.9;
        this.cough -= 1;
        this.impT += a; this.impB += a * 0.9; this.crack = Math.max(this.crack, a);
      } else if (this.bang > 0) {
        this.impT += 1.5 * this.bang; this.impB += 1.3 * this.bang; this.crack = Math.max(this.crack, 2 * this.bang); this.bang = 0;
      } else {
        const a = 0.18 * Math.min(1, rpm / 220); // compression chuff, no combustion
        this.impT += a * 0.55;
        this.chuff = Math.max(this.chuff, a);
      }
    }
    if (rpm > 15) this.impV += (0.1 + this.r() * 0.14) * Math.min(1, rpm / 450);
  }

  render(outs, n, p) {
    const sr = this.sr;
    const o0 = outs[0], o1 = outs[1], o2 = outs[2], o3 = outs[3], o4 = outs[4], o5 = outs[5];
    const rpm = p.rpm > 0 ? p.rpm : 0;
    const combust = p.combust > 0.5;
    const cl = this._c;
    const load = cl(p.load, 0, 1), misfire = cl(p.misfire, 0, 1), rough = cl(p.rough, 0, 1);
    const starter = cl(p.starter, 0, 1), knock = cl(p.knock, 0, 1), bend = cl(p.bend, 0, 1);
    const air = p.air > 0 ? p.air : 0, pops = cl(p.pops, 0, 1), drain = cl(p.drain, 0, 1);
    const grind = cl(p.grind, 0, 2), scrape = cl(p.scrape, 0, 2), rattle = cl(p.rattle, 0, 2), fire = cl(p.fire, 0, 1), flap = cl(p.flap, 0, 1);
    this.lastRpm = rpm;
    const revRate = rpm / 60;
    // block-rate coefficients
    this.resT.set(64 + 34 * load + revRate * 0.5, 0.017, sr);
    this.resB.set(200 + 150 * load + revRate * 1.2, 0.006, sr);
    this.resC.set(1250 + 650 * load, 0.0011, sr);
    this.resK.set(1930, 0.012, sr);
    this.resV.set(3150, 0.0011, sr);
    this.resV2.set(1720, 0.0019, sr);
    const crackDecay = Math.exp(-1 / (0.0042 * sr)), chuffDecay = Math.exp(-1 / (0.028 * sr));
    // pressure-pulse body (alpha function per firing, strong firing fundamental) + DC blocker
    const fc = 30 + revRate * 4.5 * 1.3;
    const pd = Math.exp(-6.283185307179586 * fc / sr);
    const dcK = 1 - Math.exp(-6.283185307179586 * 25 / sr);
    const wTh = 0.75 * (1 - 0.55 * Math.min(rpm / 2300, 1));
    const dcyc = revRate / 2 / sr;
    const dbp = (revRate * 3) / sr, drev = revRate / sr;
    const tip = rpm / 2300;
    const bladeAmp = tip * tip * (0.4 + 0.6 * load);
    const whooshK = 1 - Math.exp((-6.283 * (900 + air * 18)) / sr);
    const whooshAmp = tip * tip * 0.45 + (air / 60) * 0.12;
    const mechK = 0.6 + 0.4 * (1 - load);
    const TAU = 6.283185307179586;
    for (let i = 0; i < n; i++) {
      const nz = this.r() * 2 - 1;
      // ---------------- engine ----------------
      if (rpm > 0.5) {
        this.cyc += dcyc;
        if (this.cyc >= 1) this.cyc -= 1;
        const idx = (this.cyc * 9) | 0;
        if (idx !== this.idx) { this.idx = idx; this._fire(idx, combust, load, misfire, rough, pops, knock, rpm); }
      }
      const th = this.resT.tick(this.impT);
      this.pe1 = this.pe1 * pd + this.impT * 2.718;
      this.pe2 = this.pe2 * pd + this.pe1 * (1 - pd);
      this.impT = 0;
      this.dcY += (this.pe2 - this.dcY) * dcK;
      const body = this.pe2 - this.dcY;
      const bk = this.resB.tick(this.impB); this.impB = 0;
      const cr = this.resC.noise(nz * this.crack); this.crack *= crackDecay;
      this.chuffY += (nz * this.chuff - this.chuffY) * 0.09; this.chuff *= chuffDecay;
      let ex = body * 0.85 + th * wTh + bk * 0.32 + cr * 1.1 + this.chuffY * 1.1;
      ex = ex / (1 + Math.abs(ex) * 0.55);
      o0[i] = ex * 0.75;
      // ---------------- propeller ----------------
      let pr = 0;
      if (rpm > 1) {
        this.bp += dbp; if (this.bp >= 1) this.bp -= 1;
        this.rev += drev; if (this.rev >= 1) this.rev -= 1;
        const ph = TAU * this.bp;
        const wob = 1 + bend * 0.75 * Math.sin(TAU * this.rev);
        pr = (Math.sin(ph) + 0.5 * Math.sin(2 * ph + 0.4) + 0.28 * Math.sin(3 * ph + 1.1) + 0.14 * Math.sin(4 * ph + 0.3) + 0.07 * Math.sin(5 * ph + 2)) * bladeAmp * 0.3 * wob;
        this.propY += (nz - this.propY) * whooshK;
        this.propY2 += (this.propY - this.propY2) * whooshK;
        pr += this.propY2 * whooshAmp * (0.62 + 0.38 * Math.sin(ph)) * wob * 1.6;
      } else if (air > 2) {
        this.propY += (nz - this.propY) * whooshK;
        this.propY2 += (this.propY - this.propY2) * whooshK;
        pr = this.propY2 * whooshAmp * 1.2;
      }
      o1[i] = pr;
      // ---------------- mechanical ----------------
      const vt = this.resV.tick(this.impV) + this.resV2.tick(this.impV * 0.7); this.impV = 0;
      const kn = this.resK.tick(this.impK); this.impK = 0;
      this.st += (starter - this.st) * 0.0007;
      let sm = 0;
      if (this.st > 0.0005) {
        const fs = 230 + 3.1 * Math.min(rpm, 330);
        this.stPh += fs / sr; if (this.stPh >= 1) this.stPh -= 1;
        const sp = TAU * this.stPh;
        sm = (Math.sin(sp) * 0.5 + Math.sin(2 * sp) * 0.26 + Math.sin(3.02 * sp) * 0.17 + nz * 0.07) * this.st;
      }
      this.flSm += (flap - this.flSm) * 0.002;
      let fm = 0;
      if (this.flSm > 0.0005) {
        this.flPh += 97 / sr; if (this.flPh >= 1) this.flPh -= 1;
        this.flPh2 += 655 / sr; if (this.flPh2 >= 1) this.flPh2 -= 1;
        fm = ((this.flPh * 2 - 1) * 0.3 + Math.sin(TAU * this.flPh2) * 0.12 + nz * 0.03) * this.flSm;
      }
      o2[i] = vt * 0.4 * mechK + kn * 0.7 + sm * 0.4 + fm * 0.35;
      // ---------------- continuous textures ----------------
      let w = 0, s = 0, c = 0;
      if (drain > 0.001 && this.r() < (drain * 45) / sr) {
        this.plinkI = (this.plinkI + 1) % 3;
        this.plink[this.plinkI].set(850 + this.r() * 2000, 0.015 + this.r() * 0.025, sr);
        this.plinkImp[this.plinkI] = (0.25 + this.r() * 0.5) * drain;
      }
      for (let k = 0; k < 3; k++) { w += this.plink[k].tick(this.plinkImp[k]) * 0.6; this.plinkImp[k] = 0; }
      if (grind > 0.001) {
        this.g1 += (nz - this.g1) * 0.035;
        this.g2 += (this.g1 - this.g2) * 0.035;
        if (this.r() < 35 / sr) this.grAM = 0.35 + this.r() * 0.65;
        w += this.g2 * grind * 2.6 * this.grAM;
      }
      if (scrape > 0.001) {
        if (this.r() < 25 / sr) this.scrT = 0.3 + this.r() * 0.7;
        this.scrAM += (this.scrT - this.scrAM) * 0.002;
        const x = nz * scrape * this.scrAM;
        s += (this.scr[0].noise(x) + this.scr[1].noise(x) * 0.8 + this.scr[2].noise(x) * 0.6) * 0.5;
      }
      if (fire > 0.001) {
        if (this.r() < (fire * 55) / sr) this.fireImp = (0.3 + this.r()) * fire;
        s += this.fireR.tick(this.fireImp) * 0.9; this.fireImp = 0;
        this.fireY += (nz - this.fireY) * 0.012;
        s += this.fireY * fire * 1.4;
      }
      if (rattle > 0.001 && this.r() < (rattle * 70) / sr) {
        this.ratI = (this.ratI + 1) % 4;
        this.rat[this.ratI].set(1100 + this.r() * 2600, 0.0018 + this.r() * 0.003, sr);
        this.ratImp[this.ratI] = (0.2 + this.r() * 0.5) * Math.min(1, rattle);
      }
      for (let k = 0; k < 4; k++) { c += this.rat[k].tick(this.ratImp[k]) * 0.5; this.ratImp[k] = 0; }
      // ---------------- one-shot voices ----------------
      for (let k = 0; k < 16; k++) {
        const v = this.voices[k];
        if (!v.on) continue;
        const y = this._voice(v, nz);
        if (v.stem === 3) w += y; else if (v.stem === 4) s += y; else if (v.stem === 5) c += y; else o2[i] += y;
      }
      o3[i] = w;
      o4[i] = s;
      o5[i] = c;
    }
  }
}

// AudioWorklet source: the classes above, serialised, plus a thin processor.
function workletSource() {
  return `${DspRes.toString()}
${DspVoice.toString()}
${SeaplaneSynthCore.toString()}
const SP_PARAMS = ${JSON.stringify(SYNTH_PARAMS)};
class SeaplaneSynthProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return SP_PARAMS.map((name) => ({ name, defaultValue: 0, automationRate: 'k-rate' })); }
  constructor(o) {
    super();
    const seed = (o && o.processorOptions && o.processorOptions.seed) || 1;
    this.core = new ${SeaplaneSynthCore.name}(sampleRate, seed);
    this.p = {};
    for (const k of SP_PARAMS) this.p[k] = 0;
    this.alive = true;
    this.port.onmessage = (e) => { const d = e.data; if (d === 'stop') { this.alive = false; return; } this.core.trigger(d.e, d.a, d.p); };
  }
  process(inputs, outputs, params) {
    const o = outputs[0];
    if (o && o.length >= 6) {
      for (let i = 0; i < SP_PARAMS.length; i++) { const k = SP_PARAMS[i]; this.p[k] = params[k][0]; }
      this.core.render(o, o[0].length, this.p);
    }
    return this.alive;
  }
}
registerProcessor('seaplane-synth-v1', SeaplaneSynthProcessor);
`;
}

const _workletLoads = new WeakMap(); // AudioContext -> Promise (module added once per context)

function tanhCurve(n = 2048) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * 1.4) / Math.tanh(1.4); }
  return c;
}

// ---------------------------------------------------------------------------
// createSeaplaneAudio(audioCtx, outputNode, options)
// options: { seed, listener: 'camera' (default: positions are computed relative to
// the camera passed to update(); ctx.listener is never touched) | 'world' (panner in
// world coordinates; the host keeps ctx.listener at the camera pose) }
export function createSeaplaneAudio(audioCtx, outputNode, options = {}) {
  const ctx = audioCtx;
  const o = Object.assign({ seed: 7, listener: 'camera' }, options);
  const nodes = [];
  const keep = (n) => { nodes.push(n); return n; };
  const gain = (v) => { const g = keep(ctx.createGain()); g.gain.value = v; return g; };
  const biquad = (type, f, q, g = 0) => { const b = keep(ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = g; return b; };
  const sr = ctx.sampleRate;
  let disposed = false;

  // ---------------- master: compressor -> soft clip -> -6 dBFS ceiling ----------------
  const mix = gain(1);
  const comp = keep(ctx.createDynamicsCompressor());
  comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 10; comp.attack.value = 0.003; comp.release.value = 0.25;
  const clip = keep(ctx.createWaveShaper());
  clip.curve = tanhCurve();
  clip.oversample = '2x';
  const ceiling = gain(0.5); // peaks <= -6 dBFS
  const fade = gain(0);
  mix.connect(comp); comp.connect(clip); clip.connect(ceiling); ceiling.connect(fade);
  fade.connect(outputNode || ctx.destination);
  fade.gain.setTargetAtTime(1, ctx.currentTime + 0.05, 0.25);

  // ---------------- exterior chain: propagation delay (Doppler) -> air absorption -> panner ----------------
  const extIn = gain(1);
  const extDelay = keep(ctx.createDelay(4));
  extDelay.delayTime.value = 0.03;
  const extAir = biquad('lowpass', 16000, 0.5);
  const pan = keep(ctx.createPanner());
  pan.panningModel = 'HRTF';
  pan.distanceModel = 'inverse';
  pan.refDistance = 7;
  pan.maxDistance = 5000;
  pan.rolloffFactor = 1;
  const extGain = gain(1);
  extIn.connect(extDelay); extDelay.connect(extAir); extAir.connect(pan); pan.connect(extGain); extGain.connect(mix);
  // ---------------- interior chain: hull low-pass + cabin boom ----------------
  const intIn = gain(1);
  const intLP = biquad('lowpass', 1150, 0.6);
  const intBody = biquad('peaking', 112, 1.1, 6);
  const intGain = gain(0);
  intIn.connect(intLP); intLP.connect(intBody); intBody.connect(intGain); intGain.connect(mix);
  const ckGain = gain(0);
  ckGain.connect(mix);

  // ---------------- synth stems ----------------
  const split = keep(ctx.createChannelSplitter(6));
  const EXT = [1.0, 0.85, 0.2, 0.9, 0.9];
  const INT = [0.95, 0.6, 0.85, 0.65, 0.75];
  const stemExt = [], stemInt = [];
  for (let i = 0; i < 5; i++) {
    const ge = gain(EXT[i]); split.connect(ge, i); ge.connect(extIn); stemExt.push(ge);
    const gi = gain(INT[i]); split.connect(gi, i); gi.connect(intIn); stemInt.push(gi);
  }
  split.connect(ckGain, 5);

  // ---------------- noise beds (looping buffers, started once) ----------------
  const nb = ctx.createBuffer(1, Math.round(sr * 2.5), sr);
  {
    const d = nb.getChannelData(0);
    let s = (o.seed * 977 + 13) >>> 0;
    for (let i = 0; i < d.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; d[i] = (s / 4294967296) * 2 - 1; }
  }
  const noiseA = keep(ctx.createBufferSource()); noiseA.buffer = nb; noiseA.loop = true;
  const noiseB = keep(ctx.createBufferSource()); noiseB.buffer = nb; noiseB.loop = true;
  noiseA.start(ctx.currentTime);
  noiseB.start(ctx.currentTime, 1.13);
  // wind (listener-local: the listener rides with the plane or the chase camera)
  const windBP = biquad('bandpass', 400, 0.7);
  const windShelf = biquad('highshelf', 2500, 0.7, -8);
  const windGain = gain(0);
  const windLP = biquad('lowpass', 9000, 0.5);
  noiseA.connect(windBP); windBP.connect(windShelf); windShelf.connect(windGain); windGain.connect(windLP); windLP.connect(mix);
  const whistleBP = biquad('bandpass', 2300, 10);
  const whistleGain = gain(0);
  noiseB.connect(whistleBP); whistleBP.connect(whistleGain); whistleGain.connect(windLP);
  // water rush (planing) and spray hiss, spatialised with the plane
  const rushLP = biquad('lowpass', 520, 0.7);
  const rushGain = gain(0);
  noiseB.connect(rushLP); rushLP.connect(rushGain); rushGain.connect(extIn); rushGain.connect(intIn);
  const sprayHP = biquad('highpass', 2600, 0.6);
  const sprayGain = gain(0);
  noiseA.connect(sprayHP); sprayHP.connect(sprayGain); sprayGain.connect(extIn);
  const sprayInt = gain(0.25); sprayGain.connect(sprayInt); sprayInt.connect(intIn);
  // stall warning horn (reed horn: two detuned saws through a formant)
  const hornA = keep(ctx.createOscillator()); hornA.type = 'sawtooth'; hornA.frequency.value = 498;
  const hornB = keep(ctx.createOscillator()); hornB.type = 'sawtooth'; hornB.frequency.value = 503;
  const hornBP = biquad('bandpass', 1020, 1.6);
  const hornLP = biquad('lowpass', 2600, 0.7);
  const hornGain = gain(0);
  hornA.connect(hornBP); hornB.connect(hornBP); hornBP.connect(hornLP); hornLP.connect(hornGain);
  hornGain.connect(ckGain);
  hornA.start(); hornB.start();

  // ---------------- synth node: AudioWorklet, or a ScriptProcessor running the
  // same core where worklets are unavailable (insecure context, blocked blob: URLs)
  const core = new SeaplaneSynthCore(sr, o.seed);
  const pv = {};
  for (const k of SYNTH_PARAMS) pv[k] = 0;
  let sp = null;
  const chans = [null, null, null, null, null, null];
  const startFallback = () => {
    if (disposed || sp || !ctx.createScriptProcessor) return;
    sp = ctx.createScriptProcessor(1024, 1, 6);
    sp.onaudioprocess = (e) => {
      const ob = e.outputBuffer;
      for (let i = 0; i < 6; i++) chans[i] = ob.getChannelData(i);
      core.render(chans, ob.length, pv);
    };
    sp.connect(split);
  };
  let worklet = null;
  let wparams = null;
  let ready = Promise.resolve();
  if (!(ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined')) startFallback();
  else {
    let pr = _workletLoads.get(ctx);
    if (!pr) {
      const url = URL.createObjectURL(new Blob([workletSource()], { type: 'application/javascript' }));
      pr = ctx.audioWorklet.addModule(url);
      pr.then(() => URL.revokeObjectURL(url), () => URL.revokeObjectURL(url));
      _workletLoads.set(ctx, pr);
    }
    ready = pr.then(() => {
      if (disposed) return;
      worklet = new AudioWorkletNode(ctx, 'seaplane-synth-v1', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [6], processorOptions: { seed: o.seed } });
      wparams = {};
      for (const k of SYNTH_PARAMS) { wparams[k] = worklet.parameters.get(k); wparams[k].value = pv[k]; }
      worklet.connect(split);
    }).catch(() => startFallback());
  }

  // ---------------- per-frame update ----------------
  const _rel = new THREE.Vector3();
  const _qi = new THREE.Quaternion();
  const worldPosition = new THREE.Vector3();
  const st = { inside: 0, creakCool: 0, slapT: 0.5, ropeCool: 0, lastG: 1, drain: 0, wasWater: false, t: 0 };
  const setP = (k, v, now) => {
    pv[k] = v;
    if (wparams) wparams[k].setTargetAtTime(v, now, 0.015);
  };
  const ramp = (param, v, now, tau = 0.05) => param.setTargetAtTime(v, now, tau);

  function trigger(e, a = 1, p = 0) {
    if (disposed) return;
    if (worklet) worklet.port.postMessage({ e, a, p });
    else core.trigger(e, a, p);
  }

  // s: see Seaplane.js (_audioFrame)
  function update(dt, s) {
    if (disposed || ctx.state === 'closed') return;
    const now = ctx.currentTime;
    st.t += dt;
    // engine & synth parameters
    setP('rpm', s.rpm, now);
    setP('combust', s.combust ? 1 : 0, now);
    setP('load', s.load, now);
    setP('misfire', s.misfire, now);
    setP('rough', s.rough, now);
    setP('starter', s.starter ? 1 : 0, now);
    setP('knock', s.knock, now);
    setP('bend', s.bend, now);
    setP('air', s.airspeed, now);
    setP('pops', s.pops, now);
    setP('grind', s.grind, now);
    setP('scrape', s.scrape, now);
    setP('rattle', s.rattle, now);
    setP('fire', s.fire, now);
    setP('flap', s.flap, now);
    // draining water after leaving the water
    if (s.onWater) st.drain = Math.min(1, st.drain + dt * 0.5 * Math.min(1, s.waterSpeed / 3 + 0.2));
    else st.drain = Math.max(0, st.drain - dt / 7);
    setP('drain', s.onWater ? 0 : st.drain, now);
    // interior / exterior mix
    st.inside += ((s.inside ? 1 : 0) - st.inside) * Math.min(1, dt * 6);
    const ins = st.inside;
    ramp(extGain.gain, 1 - ins * (0.94 - 0.4 * s.doorOpen), now);
    ramp(intGain.gain, ins, now);
    ramp(ckGain.gain, ins, now);
    // spatial position
    worldPosition.copy(s.srcPos);
    let dist;
    if (o.listener === 'world') {
      if (pan.positionX) { ramp(pan.positionX, s.srcPos.x, now, 0.02); ramp(pan.positionY, s.srcPos.y, now, 0.02); ramp(pan.positionZ, s.srcPos.z, now, 0.02); }
      else pan.setPosition(s.srcPos.x, s.srcPos.y, s.srcPos.z);
      dist = s.srcPos.distanceTo(s.camPos);
    } else {
      _rel.subVectors(s.srcPos, s.camPos);
      dist = _rel.length();
      _qi.copy(s.camQuat).invert();
      _rel.applyQuaternion(_qi);
      if (ins > 0.5) _rel.set(0, -0.2, -1.6); // engine in front of the pilot
      if (pan.positionX) { ramp(pan.positionX, _rel.x, now, 0.02); ramp(pan.positionY, _rel.y, now, 0.02); ramp(pan.positionZ, _rel.z, now, 0.02); }
      else pan.setPosition(_rel.x, _rel.y, _rel.z);
    }
    // propagation delay gives the Doppler shift for free; air absorption with distance
    ramp(extDelay.delayTime, Math.min((ins > 0.5 ? 2 : dist) / 343, 3.9), now, 0.12);
    ramp(extAir.frequency, clamp(17000 / (1 + dist / 140), 800, 17000), now, 0.1);
    // wind
    const air = s.airspeed;
    const turb = 1 + (s.turbulence || 0) * 0.45 * Math.sin(st.t * 6.3) * Math.sin(st.t * 2.1 + 1);
    const wv = clamp(air / 45, 0, 1.6);
    ramp(windGain.gain, wv * wv * 0.22 * turb * (1 + s.doorOpen * 1.8 * ins) * (0.55 + 0.45 * (1 - ins)), now, 0.08);
    ramp(windBP.frequency, 260 + air * 22, now, 0.1);
    ramp(windLP.frequency, ins > 0.5 ? 1500 + s.doorOpen * 6000 : 9000, now, 0.1);
    ramp(whistleGain.gain, clamp((air - 38) / 22, 0, 1) * 0.05 * turb, now, 0.1);
    ramp(whistleBP.frequency, 1900 + air * 9, now, 0.2);
    // water beds
    ramp(rushGain.gain, s.onWater ? clamp(s.waterSpeed / 14, 0, 1) * 0.3 : 0, now, 0.08);
    ramp(sprayGain.gain, clamp(s.spray / 3, 0, 1) * clamp(s.waterSpeed / 6, 0, 1) * 0.16, now, 0.06);
    // stall horn
    ramp(hornGain.gain, s.stallWarn ? 0.055 : 0, now, 0.025);
    // hull slaps at rest / slow taxi, rope creaks, g-load creaks
    if (s.onWater && s.waterSpeed < 4) {
      st.slapT -= dt * (0.4 + s.chop * 3);
      if (st.slapT <= 0) { st.slapT = 0.35 + Math.random() * 1.2; trigger('slap', 0.25 + Math.random() * 0.4 + s.chop * 0.5); }
    }
    st.ropeCool -= dt;
    if (s.ropeJerk > 0.15 && st.ropeCool <= 0) { st.ropeCool = 0.6 + Math.random() * 0.8; trigger('rope', clamp(s.ropeJerk, 0.2, 1)); }
    st.creakCool -= dt;
    const dg = Math.abs(s.gLoad - st.lastG);
    st.lastG += (s.gLoad - st.lastG) * Math.min(1, dt * 2);
    if ((dg > 0.35 || (s.chop > 0.4 && Math.random() < dt * 0.5)) && st.creakCool <= 0) { st.creakCool = 0.8 + Math.random() * 1.5; trigger('creak', clamp(0.3 + dg * 0.5, 0.3, 1)); }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    const now = ctx.currentTime;
    fade.gain.cancelScheduledValues(now);
    fade.gain.setTargetAtTime(0, now, 0.06);
    setTimeout(() => {
      try { noiseA.stop(); noiseB.stop(); hornA.stop(); hornB.stop(); } catch (e) { /* already stopped */ }
      if (worklet) { worklet.port.postMessage('stop'); worklet.disconnect(); }
      if (sp) { sp.disconnect(); sp.onaudioprocess = null; }
      for (const n of nodes) { try { n.disconnect(); } catch (e) { /* not connected */ } }
    }, 400);
  }

  return {
    ready, worldPosition, output: fade, update, trigger, dispose,
    get usingWorklet() { return !!worklet; },
    setVolume(v) { ceiling.gain.setTargetAtTime(0.5 * clamp(v, 0, 1), ctx.currentTime, 0.05); },
  };
}
