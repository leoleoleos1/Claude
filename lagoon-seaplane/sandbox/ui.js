// Sandbox DOM UI: settings panel, key help, flight HUD (from plane.hudData),
// interaction prompt, context hints and the F1 debug panel text.
const $ = (id) => document.getElementById(id);

export class SandboxUI {
  constructor(handlers) {
    this.h = handlers;
    this.debugVisible = false;
    this._buildSettings();
    this._buildHelp();
    this.prompt = $('prompt');
    this.hint = $('hint');
    this.hud = $('hud');
    this.debug = $('debug');
    this.debug.innerHTML = '<div class="dbgb"></div><pre style="margin:6px 0 0;white-space:pre-wrap"></pre>';
    this.debugButtons = this.debug.querySelector('.dbgb');
    this.debugPre = this.debug.querySelector('pre');
    this._hudText = '';
    this._promptText = '';
    this._hintText = '';
  }

  _buildSettings() {
    const el = $('settings');
    el.innerHTML = `
      <h3>Lagoon sandbox</h3>
      <label>Time <input id="sTime" type="range" min="0" max="24" step="0.05" value="10.5"><span id="sTimeV">10:30</span></label>
      <label>Rain <input id="sRain" type="checkbox"></label>
      <label>Wind dir <input id="sWindDir" type="range" min="0" max="360" step="1" value="70"><span id="sWindDirV">70°</span></label>
      <label>Wind <input id="sWind" type="range" min="0" max="16" step="0.1" value="3.7"><span id="sWindV">3.7 m/s</span></label>
      <label>Quality <select id="sQuality"><option value="high">High</option><option value="low">Low</option></select></label>
      <label>Assist <select id="sAssist"><option value="normal">Normal</option><option value="arcade">Arcade</option><option value="realistic">Realistic</option></select></label>
      <label>Sound <input id="sVol" type="range" min="0" max="1" step="0.01" value="0.8"></label>
      <div style="margin-top:6px">Spawn:
        <button id="bBeach">Beach (chocks)</button><button id="bPier">Moored at pier</button><button id="bAir">Airborne 300 m</button>
      </div>
      <div><button id="bRepair">Repair</button><button id="bOrbit">Orbit cam (O)</button><button id="bDebug">Debug (F1)</button></div>`;
    const h = this.h;
    const time = $('sTime'), timeV = $('sTimeV');
    time.oninput = () => { const v = +time.value; timeV.textContent = `${String(Math.floor(v) % 24).padStart(2, '0')}:${String(Math.floor((v % 1) * 60)).padStart(2, '0')}`; h.time(v); };
    $('sRain').onchange = (e) => h.rain(e.target.checked);
    const wd = $('sWindDir'), ws = $('sWind');
    const wind = () => { $('sWindDirV').textContent = `${wd.value}°`; $('sWindV').textContent = `${(+ws.value).toFixed(1)} m/s`; h.wind(+wd.value, +ws.value); };
    wd.oninput = wind; ws.oninput = wind;
    $('sQuality').onchange = (e) => h.quality(e.target.value);
    $('sAssist').onchange = (e) => h.assist(e.target.value);
    $('sVol').oninput = (e) => h.volume(+e.target.value);
    $('bBeach').onclick = () => h.spawn('beach');
    $('bPier').onclick = () => h.spawn('pier');
    $('bAir').onclick = () => h.spawn('air');
    $('bRepair').onclick = () => h.repair();
    $('bOrbit').onclick = () => h.orbit();
    $('bDebug').onclick = () => this.toggleDebug();
    for (const b of el.querySelectorAll('button, select, input')) b.addEventListener('keydown', (e) => e.stopPropagation());
  }

  _buildHelp() {
    $('help').innerHTML = `
      <b>Click</b> the view to look around (Esc releases the mouse). <kbd>WASD</kbd> walk, <kbd>Shift</kbd> run, <kbd>Space</kbd> jump/climb, <kbd>E</kbd> interact (hold where shown), <kbd>O</kbd> orbit camera, <kbd>F1</kbd> debug.<br>
      <b>Flying:</b> <kbd>W</kbd>/<kbd>S</kbd> pitch, <kbd>A</kbd>/<kbd>D</kbd> roll (on water: steer), <kbd>Z</kbd>/<kbd>X</kbd> rudder, <kbd>R</kbd>/<kbd>F</kbd> or wheel throttle,
      <kbd>G</kbd>/<kbd>B</kbd> flaps up/down, hold <kbd>Q</kbd> start (tap to stop), <kbd>U</kbd> water rudders, <kbd>L</kbd> lights,
      <kbd>PgUp</kbd>/<kbd>PgDn</kbd> or <kbd>[</kbd>/<kbd>]</kbd> trim, hold <kbd>RMB</kbd> mouse-yoke, <kbd>V</kbd> chase cam, hold <kbd>E</kbd> get out.`;
  }

  toggleDebug(v = !this.debugVisible) {
    this.debugVisible = v;
    this.debug.style.display = v ? 'block' : 'none';
    if (this.h.debug) this.h.debug(v);
  }

  setPrompt(text, progress = 0) {
    const t = text ? `${text}${progress > 0 ? `|${progress.toFixed(2)}` : ''}` : '';
    if (t === this._promptText) return;
    this._promptText = t;
    if (!text) { this.prompt.innerHTML = ''; return; }
    this.prompt.innerHTML = `${text}${progress > 0 ? `<div class="bar"><i style="width:${(progress * 100).toFixed(0)}%"></i></div>` : ''}`;
  }

  setHint(text) {
    const t = text || '';
    if (t === this._hintText) return;
    this._hintText = t;
    this.hint.textContent = t;
  }

  setHud(d, visible) {
    if (!visible) { if (this._hudText) { this.hud.innerHTML = ''; this._hudText = ''; } return; }
    const t = `<span>${String(d.airspeedKt).padStart(3)} KT</span><span>${String(d.altitudeFt).padStart(5)} FT</span><span>${d.vsFpm >= 0 ? '+' : ''}${d.vsFpm} FPM</span>`
      + `<span>THR ${String(d.throttlePct).padStart(3)}%</span><span>${String(d.rpm).padStart(4)} RPM</span><span>FLAPS ${d.flapsDeg}°</span>`
      + `<span>TRIM ${(d.trim * 100).toFixed(0)}</span><span>W.RUD ${d.waterRudders.toUpperCase()}</span><span>${d.engine.toUpperCase()}</span>`
      + (d.stallWarning ? '<span class="warn">STALL</span>' : '');
    if (t === this._hudText) return;
    this._hudText = t;
    this.hud.innerHTML = t;
  }

  addDebugButton(label, fn) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = fn;
    b.addEventListener('keydown', (e) => e.stopPropagation());
    this.debugButtons.appendChild(b);
  }

  setDebug(text) { if (this.debugVisible) this.debugPre.textContent = text; }
}
