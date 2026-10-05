// Piston radial + constant-speed propeller model: start sequence (cranking,
// coughs, catch, rough idle), flooding, governor, power/thrust, fuel system,
// temperatures/pressures for the gauges, misfires, water ingestion, prop strike.
const TAU = Math.PI * 2;
const RPM = 60 / TAU; // rad/s -> rpm
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const ENGINE = {
  qMax: 820, // N*m full-throttle torque
  inertia: 6.0, // kg*m^2 engine + prop
  idleRpm: 700,
  maxRpm: 2300,
  cqFine: 0.0184, // fine-pitch prop torque coefficient (N*m per (rad/s)^2)
  staticThrust: 6400,
  fuelCapacity: 140,
};

export class EngineModel {
  constructor(rand = Math.random) {
    this.rand = rand;
    this.state = 'off';
    this.omega = 0;
    this.throttleCmd = 0;
    this.throttle = 0; // lagged
    this.mixture = 1; // 1 rich, 0 cutoff
    this.propLever = 1; // 1 = 2300 rpm
    this.master = false;
    this.magnetos = 0; // 0 off, 1 L, 2 R, 3 both
    this.starter = false;
    this.fuelSelector = 'both'; // both | left | right | off
    this.fuel = [ENGINE.fuelCapacity * 0.72, ENGINE.fuelCapacity * 0.72];
    this.health = 1;
    this.propHealth = 1;
    this.fire = false;
    this.flood = 0;
    this.catchT = 9;
    this.crankTime = 0;
    this.catchAt = 1.5;
    this.attempt = 0;
    this.rough = 0;
    this.misfire = 0;
    this.hydrolock = 0;
    this.starve = 0;
    this.oilTemp = 26;
    this.oilPress = 0;
    this.cht = 26;
    this.manifold = 29.9;
    this.amps = 0;
    this.power = 0;
    this.thrust = 0;
    this.torque = 0;
    this.load = 0;
    this.governorK = 1;
    this.fuelFlow = 0;
    this.events = []; // 'cough', 'catch', 'backfire', 'stall', 'shutdown', 'misfire', 'starterOn', 'starterOff', 'fail'
    this._cough = 0;
    this._shut = 0;
  }

  get rpm() { return this.omega * RPM; }
  get running() { return this.state === 'running'; }

  // request start (hold) / stop
  setStarter(on) {
    if (on === this.starter) return;
    this.starter = on;
    if (on) {
      if (this.state === 'dead') { this.events.push('fail'); return; }
      this.master = true;
      this.magnetos = 3;
      if (this.state !== 'running') {
        this.state = 'cranking';
        this.crankTime = 0;
        this.attempt++;
        // occasional reluctant start (character): first try often needs longer
        const reluctant = this.rand() < (this.attempt === 1 ? 0.35 : 0.15);
        this.catchAt = 0.9 + this.rand() * 1.4 + (reluctant ? 3.5 + this.rand() * 2 : 0);
        this.events.push('starterOn');
      }
    } else {
      this.events.push('starterOff');
      if (this.state === 'cranking') this.state = 'off';
    }
  }

  shutdown() {
    if (this.state === 'running') {
      this.mixture = 0;
      this._shut = 0.0001;
      this.events.push('shutdown');
    }
  }

  fuelAvailable() {
    const s = this.fuelSelector;
    if (s === 'off') return false;
    if (s === 'left') return this.fuel[0] > 0.05;
    if (s === 'right') return this.fuel[1] > 0.05;
    return this.fuel[0] > 0.05 || this.fuel[1] > 0.05;
  }

  // h: step (s); airspeed (m/s, axial); rhoK: density ratio for power; ingest: water depth at the intake (m)
  step(h, airspeed, rhoK, ingest, propStrike) {
    const E = ENGINE;
    this.throttle += (this.throttleCmd - this.throttle) * Math.min(1, h / 0.22);
    const omega = this.omega;
    const rpm = omega * RPM;
    // ---- hazards
    if (ingest > 0.05 && this.state === 'running') this._stall('water', 9);
    if (propStrike >= 2 && this.omega > 20) {
      this.propHealth = Math.max(0, this.propHealth - 0.5 * h * 30);
      this.health = Math.max(0, this.health - 0.15 * h * 30);
      if (this.state === 'running') this._stall('strike', 3);
      this.omega *= 0.85;
    } else if (propStrike === 1 && this.omega > 40) {
      // blades slapping the water: violent but survivable at low rpm
      this.propHealth = Math.max(0, this.propHealth - 0.08 * h * (this.omega / 60));
      this.omega *= 1 - 0.6 * h;
      if (this.rand() < h * 4) this.events.push('splash');
    }
    if (this.hydrolock > 0) this.hydrolock -= h;
    // ---- combustion torque
    let qComb = 0;
    const fuelOK = this.fuelAvailable();
    if (this.state === 'running') {
      if (!fuelOK) {
        this.starve += h;
        if (this.starve > 2.2) this._stall('fuel', 0);
      } else this.starve = Math.max(0, this.starve - h);
      if (this._shut > 0) {
        this._shut += h;
        if (this._shut > 0.4) { this.state = 'off'; this.events.push('runDown'); this._shut = 0; }
      }
      // idle mixture keeps ~700 rpm at closed throttle; right after the catch the
      // engine flares (pilot pumping the throttle) and then settles into a rough idle
      this.catchT += h;
      const flare = this.catchT < 1.5 ? 0.7 * (1 - this.catchT / 1.5) : 0;
      const mp = 0.2 + 0.8 * this.throttle + flare;
      const g = 1 - ((rpm - 1900) / 2600) ** 2;
      const altK = clamp(rhoK, 0.2, 1.1);
      let q = E.qMax * mp * clamp(g, 0.55, 1) * Math.sqrt(this.health) * altK;
      // rough idle after start, misfires when damaged or starved
      this.rough = Math.max(0, this.rough - h * 0.35);
      const missRate = (1 - this.health) * 6 + this.rough * 3 + (this.starve > 0 ? 8 : 0) + (1 - this.propHealth) * 1.5;
      if (this.rand() < missRate * h) { this.misfire = 1; this.events.push('misfire'); }
      this.misfire = Math.max(0, this.misfire - h * 9);
      q *= 1 - this.misfire * 0.55;
      q *= 1 + (this.rand() - 0.5) * this.rough * 0.25;
      if (this.mixture < 0.5) q = 0;
      qComb = q;
      if (this.catchT > 2.5 && rpm < 260 && this.throttle < 0.95) this._stall('lowrpm', 0);
      // overspeed damage
      if (rpm > 2650) this.health = Math.max(0, this.health - (rpm - 2650) * 0.00002 * h * 60);
    } else if (this.state === 'cranking') {
      this.crankTime += h;
      // flooding: cranking with a lot of throttle pumps fuel
      this.flood += h * (this.throttle > 0.4 ? 0.12 : 0.03) * (this.attempt > 2 ? 1.6 : 1);
      if (this.throttle > 0.9) this.flood = Math.max(0, this.flood - h * 0.25); // clear-flood technique
      // coughs
      this._cough -= h;
      if (this._cough <= 0 && rpm > 90) {
        this._cough = 0.25 + this.rand() * 0.6;
        if (fuelOK && this.hydrolock <= 0) { this.events.push('cough'); qComb += 260; }
      }
      const canCatch = fuelOK && this.hydrolock <= 0 && this.flood < 0.6 && this.health > 0.05 && this.propHealth > 0.05 && this.mixture >= 0.5;
      if (canCatch && this.crankTime > this.catchAt && rpm > 110) {
        this.state = 'running';
        this.rough = 1;
        this.catchT = 0;
        this.events.push('catch');
      }
      if (!canCatch && this.crankTime > 6 && this.rand() < h * 0.5) this.events.push('backfire');
    } else {
      this.flood = Math.max(0, this.flood - h * 0.06);
      if (this.mixture < 1) this.mixture = Math.min(1, this.mixture + h * 0.2);
    }
    if (this.state !== 'running' && this.state !== 'cranking') this.mixture = Math.max(this.mixture, 0.0);
    if (this.state === 'off' && this._shut === 0) this.mixture = 1;
    // ---- loads
    const starterQ = this.state === 'cranking' && this.master ? 150 * clamp(1 - rpm / 260, 0, 1) + 15 : 0;
    const unload = 1 - 0.35 * clamp(airspeed / 45, 0, 1.2);
    let qProp = E.cqFine * omega * omega * unload;
    // constant speed governor: coarsens pitch to hold the set rpm
    const setOmega = (1100 + 1200 * this.propLever) / RPM;
    if (this.state === 'running') {
      const err = (omega - setOmega) / setOmega;
      this.governorK = clamp(this.governorK + err * h * 8, 1, 6);
    } else this.governorK = Math.max(1, this.governorK - h * 2);
    qProp *= this.governorK;
    if (this.propHealth < 1) qProp *= 1 + (1 - this.propHealth) * 0.6;
    const windmill = 0.16 * airspeed * airspeed * (this.state === 'running' ? 0.2 : 1);
    const friction = (this.state === 'running' ? 25 : 45) + 0.06 * omega + (omega > 0.1 ? 0 : 0);
    let net = qComb + starterQ + windmill - qProp - friction * Math.sign(omega);
    if (omega <= 0 && net < 0) net = 0;
    this.omega = Math.max(0, omega + (net / E.inertia) * h);
    // ---- outputs
    const w = this.omega;
    const pProp = qProp * w;
    this.power = this.state === 'running' ? qComb * w : 0;
    this.load = clamp(qComb / E.qMax, 0, 1);
    const eta = (0.82 - 0.12 * clamp((airspeed - 38) / 30, 0, 1)) * this.propHealth;
    const capped = E.staticThrust * (w * RPM / E.maxRpm) ** 2 * (1 - 0.25 * clamp(airspeed / 50, 0, 1.3)) * (0.5 + 0.5 * this.propHealth);
    let T = Math.min(eta * pProp / Math.max(airspeed, 1), capped);
    // throttled back at fine pitch the blades run at a negative angle of attack:
    // the prop windmills and brakes (steeper idle glides); a stopped prop drags too
    T -= 1.6 * airspeed * airspeed * (1 - this.load) ** 3 * this.propHealth;
    if (this.state !== 'running') T = Math.min(T, 0) - 0.45 * airspeed * airspeed * this.propHealth;
    this.thrust = T;
    this.torque = qComb * 0.9 + starterQ;
    // fuel
    if (this.state === 'running') {
      const lph = 22 + 95 * (this.power / 210000);
      this.fuelFlow = lph;
      const lps = (lph / 3600) * h;
      if (this.fuelSelector === 'both') {
        const both = this.fuel[0] > 0.05 && this.fuel[1] > 0.05;
        if (both) { this.fuel[0] -= lps / 2; this.fuel[1] -= lps / 2; }
        else if (this.fuel[0] > 0.05) this.fuel[0] -= lps; else this.fuel[1] -= lps;
      } else if (this.fuelSelector === 'left') this.fuel[0] -= lps;
      else if (this.fuelSelector === 'right') this.fuel[1] -= lps;
      this.fuel[0] = Math.max(0, this.fuel[0]);
      this.fuel[1] = Math.max(0, this.fuel[1]);
    } else this.fuelFlow = 0;
    // temperatures / pressures
    const running = this.state === 'running';
    const targetOil = running ? 62 + 28 * this.load + (1 - this.health) * 40 : 26;
    this.oilTemp += (targetOil - this.oilTemp) * h * (running ? 0.012 : 0.004);
    const targetCht = running ? 140 + 90 * this.load + (1 - this.health) * 80 - Math.min(airspeed, 45) * 0.8 : 26;
    this.cht += (targetCht - this.cht) * h * 0.03;
    const targetP = running ? clamp(30 + 50 * (w * RPM / 2300) - (this.oilTemp - 70) * 0.2, 0, 95) * Math.sqrt(this.health) : 0;
    this.oilPress += (targetP - this.oilPress) * h * 3;
    const ambientMp = 29.9 * clamp(rhoK, 0.5, 1.05);
    this.manifold += ((running ? 10 + (ambientMp - 10) * this.throttle - (w * RPM / 2300) * 2 : ambientMp) - this.manifold) * h * 4;
    this.amps += ((this.master ? (running && w * RPM > 1000 ? 12 : -8) : 0) + (this.state === 'cranking' ? -40 : 0) - this.amps) * h * 3;
    // fire
    if (this.health <= 0.02 && !this.fire) { this.fire = true; this.events.push('fire'); }
    if (this.fire && running) this._stall('fire', 0);
    if (this.health <= 0 || this.propHealth <= 0.05) { if (this.state === 'running') this._stall('dead', 0); this.state = this.health <= 0 ? 'dead' : this.state; }
    return T;
  }

  _stall(reason, lock) {
    if (this.state !== 'running') return;
    this.state = 'stalled';
    this.hydrolock = Math.max(this.hydrolock, lock);
    this.events.push('stall:' + reason);
  }

  repair() {
    this.health = 1; this.propHealth = 1; this.fire = false; this.hydrolock = 0; this.flood = 0;
    if (this.state === 'dead' || this.state === 'stalled') this.state = 'off';
  }
}
