// Instrument faces drawn on a canvas atlas (crisp markings and numerals), the
// attitude-indicator horizon card, and value->needle-angle mappings.
import * as THREE from 'three';

export const GAUGES = [
  'airspeed', 'attitude', 'altimeter', 'turn', 'heading', 'vsi',
  'tach', 'manifold', 'oil', 'fuel', 'amps', 'flaps', 'clock', 'cht', 'radio', 'compass',
];
const GRID = 4;
export function gaugeRect(name) {
  const i = GAUGES.indexOf(name);
  const cx = i % GRID, cy = Math.floor(i / GRID);
  // uv rect (u0, v0, u1, v1) with v up
  return [cx / GRID, 1 - (cy + 1) / GRID, (cx + 1) / GRID, 1 - cy / GRID];
}

const DEG = Math.PI / 180;
// sweep helpers: angle (radians, clockwise from 12 o'clock) for a value
function sweep(v, v0, v1, a0, a1) { const t = Math.min(Math.max((v - v0) / (v1 - v0), 0), 1); return (a0 + (a1 - a0) * t) * DEG; }
export const NEEDLE = {
  airspeed: (kt) => sweep(kt, 0, 160, -150, 150),
  altimeter100: (ft) => ((ft % 1000) / 1000) * Math.PI * 2,
  altimeter1000: (ft) => ((ft % 10000) / 10000) * Math.PI * 2,
  vsi: (fpm) => sweep(fpm, -2000, 2000, 100, 440), // 0 at 9 o'clock, climb clockwise over the top
  tach: (rpm) => sweep(rpm, 0, 3500, -135, 135),
  manifold: (inhg) => sweep(inhg, 10, 40, -135, 135),
  // dual gauges: left needle pivots left of centre and sweeps the left side (low at the bottom),
  // right needle mirrors it on the right side
  oilT: (c) => sweep(c, 0, 120, -150, -30),
  oilP: (psi) => sweep(psi, 0, 120, 150, 30),
  fuelL: (frac) => sweep(frac, 0, 1, -150, -30),
  fuelR: (frac) => sweep(frac, 0, 1, 150, 30),
  amps: (a) => sweep(a, -60, 60, -60, 60),
  flaps: (deg) => sweep(deg, 0, 30, -60, 60),
  cht: (c) => sweep(c, 0, 300, -60, 60),
};

function face(g, x, y, s, draw) {
  g.save();
  g.translate(x + s / 2, y + s / 2);
  g.scale(s / 256, s / 256);
  // face background with subtle ageing
  const grd = g.createRadialGradient(0, 0, 20, 0, 0, 128);
  grd.addColorStop(0, '#16171a');
  grd.addColorStop(1, '#0b0b0c');
  g.fillStyle = grd;
  g.beginPath(); g.arc(0, 0, 127, 0, Math.PI * 2); g.fill();
  draw(g);
  g.restore();
}

function ticks(g, a0, a1, n, r0, r1, w, color = '#e9e4d6') {
  g.strokeStyle = color;
  g.lineWidth = w;
  for (let i = 0; i <= n; i++) {
    const a = (a0 + ((a1 - a0) * i) / n) * DEG - Math.PI / 2;
    g.beginPath();
    g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    g.stroke();
  }
}
function arc(g, a0, a1, r, w, color) {
  g.strokeStyle = color;
  g.lineWidth = w;
  g.beginPath();
  g.arc(0, 0, r, a0 * DEG - Math.PI / 2, a1 * DEG - Math.PI / 2);
  g.stroke();
}
function nums(g, list, r, size) {
  g.fillStyle = '#ece7d9';
  g.font = `bold ${size}px "DejaVu Sans", Arial, Helvetica, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const [a, t] of list) {
    const ang = a * DEG - Math.PI / 2;
    g.fillText(t, Math.cos(ang) * r, Math.sin(ang) * r);
  }
}
function label(g, t, y, size = 13, color = '#cfc9b8') {
  g.fillStyle = color;
  g.font = `bold ${size}px "DejaVu Sans", Arial, Helvetica, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(t, 0, y);
}
const map = (v, v0, v1, a0, a1) => a0 + ((v - v0) / (v1 - v0)) * (a1 - a0);

export function createGaugeAtlas(size = 1024) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = '#0a0a0b';
  g.fillRect(0, 0, size, size);
  const s = size / GRID;
  const at = (name, draw) => { const i = GAUGES.indexOf(name); face(g, (i % GRID) * s, Math.floor(i / GRID) * s, s, draw); };
  at('airspeed', (c) => {
    const A = (kt) => map(kt, 0, 160, -150, 150);
    arc(c, A(33), A(85), 112, 9, '#e6e1d4');
    arc(c, A(39), A(118), 104, 9, '#2f9a3d');
    arc(c, A(118), A(145), 104, 9, '#d8b21c');
    ticks(c, A(145), A(145.6), 1, 92, 118, 5, '#d22f22');
    ticks(c, -150, 150, 32, 108, 118, 2);
    ticks(c, -150, 150, 16, 100, 118, 3);
    nums(c, [[A(40), '40'], [A(60), '60'], [A(80), '80'], [A(100), '100'], [A(120), '120'], [A(140), '140'], [A(160), '160']], 78, 20);
    label(c, 'AIRSPEED', -34); label(c, 'KNOTS', 34, 12);
  });
  at('attitude', (c) => {
    // fixed outer ring: roll scale + airplane symbol drawn on a transparent centre
    c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.arc(0, 0, 96, 0, Math.PI * 2); c.fill();
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = '#2b2b2e'; c.lineWidth = 30; c.beginPath(); c.arc(0, 0, 112, 0, Math.PI * 2); c.stroke();
    for (const a of [-60, -30, -20, -10, 10, 20, 30, 60]) ticks(c, a, a + 0.01, 1, 98, Math.abs(a) % 30 === 0 ? 122 : 112, 4);
    c.fillStyle = '#f0a020';
    c.beginPath(); c.moveTo(0, -97); c.lineTo(-9, -82); c.lineTo(9, -82); c.closePath(); c.fill();
  });
  at('altimeter', (c) => {
    ticks(c, 0, 360, 50, 108, 118, 2);
    ticks(c, 0, 360, 10, 98, 118, 4);
    nums(c, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [i * 36, String(i)]), 80, 24);
    label(c, 'ALT', -36); label(c, '100 FEET', 38, 11);
    c.fillStyle = '#1c1c1f'; c.fillRect(42, -10, 34, 20);
    c.fillStyle = '#d9d4c5'; c.font = 'bold 12px monospace'; c.fillText('29.9', 59, 1);
  });
  at('turn', (c) => {
    c.strokeStyle = '#ece7d9'; c.lineWidth = 4;
    for (const a of [-20, 20]) ticks(c, 90 + a, 90 + a + 0.01, 1, 96, 116, 4);
    ticks(c, -90, -89.99, 1, 96, 116, 4); ticks(c, 270, 270.01, 1, 96, 116, 4);
    ticks(c, 90, 90.01, 1, 96, 116, 4);
    label(c, 'TURN COORDINATOR', -56, 12); label(c, 'L', 60, 18); label(c, '2 MIN', 86, 11);
    // slip ball tube
    c.strokeStyle = '#d8d3c4'; c.lineWidth = 2;
    c.beginPath(); c.arc(0, -40, 120, Math.PI * 0.33, Math.PI * 0.67); c.stroke();
    c.beginPath(); c.arc(0, -40, 96, Math.PI * 0.33, Math.PI * 0.67); c.stroke();
    c.fillStyle = 'rgba(20,20,22,0.6)'; c.fillRect(-6, 54, 2, 24); c.fillRect(4, 54, 2, 24);
  });
  at('heading', (c) => {
    ticks(c, 0, 360, 72, 108, 118, 2);
    ticks(c, 0, 360, 36, 100, 118, 3);
    const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    for (let a = 0; a < 360; a += 30) {
      c.save(); c.rotate(a * DEG);
      c.fillStyle = names[a] ? '#f2ede0' : '#d8d3c4';
      c.font = `bold ${names[a] ? 26 : 19}px "DejaVu Sans", Arial, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(names[a] || String(a / 10), 0, -80);
      c.restore();
    }
  });
  at('vsi', (c) => {
    const A = (f) => map(f, -2000, 2000, 100, 440);
    ticks(c, 100, 440, 40, 108, 118, 2); ticks(c, 100, 440, 8, 98, 118, 4);
    nums(c, [[A(0), '0'], [A(500), '.5'], [A(1000), '1'], [A(1500), '1.5'], [A(2000), '2'], [A(-500), '.5'], [A(-1000), '1'], [A(-1500), '1.5']], 82, 18);
    label(c, 'UP', -34, 13); label(c, 'DN', 34, 13); label(c, 'VERTICAL SPEED', 56, 9); label(c, '1000 FT/MIN', -56, 8);
  });
  at('tach', (c) => {
    const A = (r) => map(r, 0, 3500, -135, 135);
    arc(c, A(1600), A(2300), 108, 9, '#2f9a3d');
    ticks(c, A(2300), A(2301), 1, 96, 118, 5, '#d22f22');
    ticks(c, -135, 135, 35, 108, 118, 2); ticks(c, -135, 135, 7, 98, 118, 4);
    nums(c, [0, 5, 10, 15, 20, 25, 30, 35].map((v) => [A(v * 100), String(v)]), 78, 20);
    label(c, 'RPM', -32); label(c, 'x100', 32, 12);
  });
  at('manifold', (c) => {
    const A = (v) => map(v, 10, 40, -135, 135);
    arc(c, A(15), A(30), 108, 9, '#2f9a3d');
    ticks(c, A(36), A(36.2), 1, 96, 118, 5, '#d22f22');
    ticks(c, -135, 135, 30, 108, 118, 2); ticks(c, -135, 135, 6, 98, 118, 4);
    nums(c, [10, 15, 20, 25, 30, 35, 40].map((v) => [A(v), String(v)]), 78, 20);
    label(c, 'MAN PRESS', -32, 12); label(c, 'IN.HG', 32, 12);
  });
  // dual gauges: needle pivots at x = -/+43 px, each sweeping its own side
  const PIV = 43;
  const sideArc = (c, side, a0, a1, r, w, col) => {
    c.save(); c.translate(side * PIV, 0);
    c.strokeStyle = col; c.lineWidth = w;
    c.beginPath(); c.arc(0, 0, r, Math.min(a0, a1) * DEG - Math.PI / 2, Math.max(a0, a1) * DEG - Math.PI / 2); c.stroke();
    c.restore();
  };
  const sideTicks = (c, side, a0, a1, n, r0, r1, w) => { c.save(); c.translate(side * PIV, 0); ticks(c, a0, a1, n, r0, r1, w); c.restore(); };
  const sideNums = (c, side, list, r, size) => { c.save(); c.translate(side * PIV, 0); nums(c, list, r, size); c.restore(); };
  const pivotDots = (c) => { c.fillStyle = '#2a2a2d'; for (const sx of [-1, 1]) { c.beginPath(); c.arc(sx * PIV, 0, 9, 0, Math.PI * 2); c.fill(); } };
  at('oil', (c) => {
    const T = (v) => map(v, 0, 120, -150, -30), Pp = (v) => map(v, 0, 120, 150, 30);
    sideArc(c, -1, T(40), T(100), 70, 7, '#2f9a3d');
    sideArc(c, -1, T(108), T(120), 70, 7, '#d22f22');
    sideTicks(c, -1, -150, -30, 6, 62, 76, 3);
    sideArc(c, 1, Pp(50), Pp(90), 70, 7, '#2f9a3d');
    sideArc(c, 1, Pp(100), Pp(120), 70, 7, '#d22f22');
    sideArc(c, 1, Pp(0), Pp(25), 70, 7, '#d22f22');
    sideTicks(c, 1, 30, 150, 6, 62, 76, 3);
    sideNums(c, -1, [[-150, '0'], [-90, '60'], [-30, '120']], 46, 12);
    sideNums(c, 1, [[150, '0'], [90, '60'], [30, '120']], 46, 12);
    label(c, 'OIL', -84, 15);
    label(c, '°C           PSI', 84, 12);
    pivotDots(c);
  });
  at('fuel', (c) => {
    const F = (v, side) => (side < 0 ? map(v, 0, 1, -150, -30) : map(v, 0, 1, 150, 30));
    for (const side of [-1, 1]) {
      sideArc(c, side, F(0, side), F(0.12, side), 70, 7, '#d22f22');
      sideTicks(c, side, side < 0 ? -150 : 30, side < 0 ? -30 : 150, 4, 62, 76, 3);
      sideNums(c, side, [[F(0, side), 'E'], [F(0.5, side), '½'], [F(1, side), 'F']], 46, 13);
    }
    label(c, 'FUEL', -84, 15);
    label(c, 'L               R', 84, 13);
    pivotDots(c);
  });
  at('amps', (c) => {
    ticks(c, -60, 60, 6, 100, 114, 3);
    nums(c, [[-60, '-60'], [0, '0'], [60, '+60']], 80, 14);
    label(c, 'AMPERES', 40, 12);
  });
  at('flaps', (c) => {
    ticks(c, -60, 60, 3, 98, 116, 4);
    nums(c, [[-60, 'UP'], [-20, '10'], [20, '20'], [60, '30']], 80, 14);
    label(c, 'FLAPS', 40, 14);
  });
  at('clock', (c) => {
    ticks(c, 0, 360, 60, 110, 118, 2); ticks(c, 0, 360, 12, 98, 118, 4);
    nums(c, [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((h, i) => [i * 30, String(h)]), 82, 20);
  });
  at('cht', (c) => {
    ticks(c, -60, 60, 6, 100, 114, 3);
    c.strokeStyle = '#2f9a3d'; c.lineWidth = 8; c.beginPath(); c.arc(0, 0, 105, -Math.PI / 2 - 0.4, -Math.PI / 2 + 0.6); c.stroke();
    nums(c, [[-60, '0'], [0, '150'], [60, '300']], 80, 14);
    label(c, 'CYL TEMP', 40, 12); label(c, '°C', 58, 12);
  });
  at('radio', (c) => {
    c.fillStyle = '#1b1c1e'; c.fillRect(-128, -128, 256, 256);
    c.fillStyle = '#0d1a10'; c.fillRect(-100, -70, 200, 50);
    c.fillStyle = '#7dff8a'; c.font = 'bold 30px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('122.80', 0, -45);
    c.fillStyle = '#0d1a10'; c.fillRect(-100, 10, 200, 50);
    c.fillStyle = '#ffb347'; c.fillText('118.30', 0, 35);
    label(c, 'COM 1        STBY', -90, 12, '#9a958a');
  });
  at('compass', (c) => {
    // compass card as a strip (wrapped around a drum in the model)
    c.restore(); c.save();
    const i = GAUGES.indexOf('compass');
    const x = (i % GRID) * s, y = Math.floor(i / GRID) * s;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#e9e3d0'; c.fillRect(x, y, s, s);
    c.fillStyle = '#121212';
    c.font = `bold ${Math.round(s * 0.14)}px "DejaVu Sans", Arial, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const names = ['N', '3', '6', 'E', '12', '15', 'S', '21', '24', 'W', '30', '33'];
    for (let k = 0; k <= 12; k++) {
      const px = x + (k / 12) * s;
      c.fillText(names[k % 12], px, y + s * 0.42);
      c.fillRect(px - 1, y + s * 0.62, 2, s * 0.2);
      c.fillRect(px + s / 24 - 0.5, y + s * 0.7, 1, s * 0.12);
    }
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { canvas, texture: tex };
}

// Attitude indicator card: sky / ground with pitch ladder (texture transform animates it)
export function createHorizonTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size * 2;
  const g = c.getContext('2d');
  const H = c.height, W = c.width;
  const sky = g.createLinearGradient(0, 0, 0, H / 2);
  sky.addColorStop(0, '#1d4f8a'); sky.addColorStop(1, '#3f86c8');
  g.fillStyle = sky; g.fillRect(0, 0, W, H / 2);
  const gr = g.createLinearGradient(0, H / 2, 0, H);
  gr.addColorStop(0, '#6b4a2a'); gr.addColorStop(1, '#3d2a17');
  g.fillStyle = gr; g.fillRect(0, H / 2, W, H / 2);
  g.fillStyle = '#f2efe6'; g.fillRect(0, H / 2 - 2, W, 4);
  g.strokeStyle = '#f2efe6';
  const pxPerDeg = (W * 0.5) / 30; // 30 deg over half the card width
  for (let d = -30; d <= 30; d += 5) {
    if (d === 0) continue;
    const y = H / 2 - d * pxPerDeg;
    const w = d % 10 === 0 ? W * 0.32 : W * 0.16;
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(W / 2 - w / 2, y); g.lineTo(W / 2 + w / 2, y); g.stroke();
    if (d % 10 === 0) { g.fillStyle = '#f2efe6'; g.font = 'bold 18px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(Math.abs(d)), W / 2 + w / 2 + 16, y); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.matrixAutoUpdate = false;
  tex.userData.degPerUv = 30 / 0.25; // card height 2W: 30 deg = 0.25 of the texture height
  return tex;
}
