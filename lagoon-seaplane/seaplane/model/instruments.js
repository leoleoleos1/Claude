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
  vsi: (fpm) => sweep(fpm, -2000, 2000, -170 + 180, 170 + 180) - Math.PI,
  tach: (rpm) => sweep(rpm, 0, 3500, -135, 135),
  manifold: (inhg) => sweep(inhg, 10, 40, -135, 135),
  oilT: (c) => sweep(c, 0, 120, -60, 60) - Math.PI / 2 + Math.PI / 2,
  oilP: (psi) => sweep(psi, 0, 120, -60, 60),
  fuel: (frac) => sweep(frac, 0, 1, -60, 60),
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
    const A = (f) => map(f, -2000, 2000, 10, 350);
    ticks(c, 10, 350, 40, 108, 118, 2); ticks(c, 10, 350, 8, 98, 118, 4);
    nums(c, [[A(0), '0'], [A(500), '.5'], [A(1000), '1'], [A(1500), '1.5'], [A(2000), '2'], [A(-500), '.5'], [A(-1000), '1'], [A(-1500), '1.5']], 82, 18);
    label(c, 'UP', -30, 13); label(c, 'DN', 30, 13); label(c, 'VERTICAL SPEED', 52, 9);
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
  const dual = (c, l1, l2, arcs1, arcs2) => {
    // two half gauges, needles pivot left (-) and right (+)
    for (const [side, l, arcs] of [[-1, l1, arcs1], [1, l2, arcs2]]) {
      c.save(); c.translate(side * 30, 0);
      for (const [a0, a1, col] of arcs) { c.strokeStyle = col; c.lineWidth = 8; c.beginPath(); c.arc(0, 0, 80, (side > 0 ? 0 : Math.PI) + a0 * DEG * side, (side > 0 ? 0 : Math.PI) + a1 * DEG * side, side < 0); c.stroke(); }
      c.restore();
      label(c, l, side * 60 > 0 ? 0 : 0, 12);
    }
  };
  at('oil', (c) => {
    c.strokeStyle = '#2f9a3d'; c.lineWidth = 8;
    c.beginPath(); c.arc(-30, 30, 82, -Math.PI * 0.5 - 0.6, -Math.PI * 0.5 + 0.3); c.stroke();
    c.beginPath(); c.arc(30, 30, 82, -Math.PI * 0.5 - 0.3, -Math.PI * 0.5 + 0.6); c.stroke();
    ticks(c, -60, 60, 6, 100, 112, 3);
    label(c, 'OIL', -20, 16); label(c, 'TEMP', 56, 11); label(c, '°C      PSI', 72, 11);
    dual(c, '', '', [], []);
  });
  at('fuel', (c) => {
    c.strokeStyle = '#d22f22'; c.lineWidth = 8;
    c.beginPath(); c.arc(0, 30, 82, -Math.PI * 0.5 - 1.05, -Math.PI * 0.5 - 0.85); c.stroke();
    ticks(c, -60, 60, 4, 100, 114, 3);
    label(c, 'FUEL', -20, 16); label(c, 'L        R', 50, 15); label(c, 'E   ½   F', 72, 11);
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
