// Procedural textures: decal artwork painted on a canvas (shark mouth, winged
// emblem, fin art, stencils) and the GPU bake of the airframe paint atlas.
// The bake renders every paint surface into its atlas island with a shader
// that evaluates layered paint, decals and weathering from the 3D position.
import * as THREE from 'three';
import { CG_MODEL, PART } from './dims.js';
import { GLSL_NOISE, GLSL_PANEL } from './glsl.js';
import { rng } from './geom.js';

// ---------------------------------------------------------------------------
// Decal canvas
const DECAL_SIZE = 1024;
const RECTS = {
  shark: [0, 0, 1024, 560],
  emblem: [0, 560, 512, 256],
  finart: [512, 560, 256, 464],
  reg: [0, 822, 512, 118],
  nostep: [0, 944, 256, 38],
  fuel: [256, 944, 256, 38],
  danger: [0, 986, 300, 36],
  nopush: [300, 986, 212, 36],
  arrow: [768, 560, 128, 128],
  exit: [768, 700, 256, 60],
  tiedown: [768, 764, 256, 46],
};

function bez(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

function drawShark(g, x0, y0, w, h, rand) {
  g.save();
  g.translate(x0, y0);
  g.scale(w / 1024, h / 560);
  const C = [60, 300];
  const U = [C, [330, 214], [700, 120], [1030, 140]];
  const Lw = [C, [330, 392], [720, 540], [1030, 520]];
  const path = () => {
    g.beginPath();
    g.moveTo(C[0], C[1]);
    g.bezierCurveTo(U[1][0], U[1][1], U[2][0], U[2][1], U[3][0], U[3][1]);
    g.lineTo(1030, 520);
    g.bezierCurveTo(Lw[2][0], Lw[2][1], Lw[1][0], Lw[1][1], C[0], C[1]);
    g.closePath();
  };
  // black outline
  g.lineJoin = 'round';
  path();
  g.fillStyle = '#121010';
  g.fill();
  g.lineWidth = 46;
  g.strokeStyle = '#121010';
  g.stroke();
  // red gullet with darker throat
  g.save();
  path();
  g.clip();
  const grd = g.createLinearGradient(60, 0, 1030, 0);
  grd.addColorStop(0, '#5a0d09');
  grd.addColorStop(0.35, '#8e1a12');
  grd.addColorStop(1, '#b0261a');
  g.fillStyle = grd;
  g.fillRect(0, 0, 1100, 600);
  g.restore();
  // teeth
  const row = (curve, dirSign, count, t0, t1) => {
    for (let i = 0; i < count; i++) {
      const ta = t0 + ((t1 - t0) * i) / count, tb = t0 + ((t1 - t0) * (i + 1)) / count;
      const a = bez(...curve, ta), b = bez(...curve, tb);
      const m = bez(...curve, (ta + tb) / 2);
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      let nx = -dy / len, ny = dx / len;
      if (ny * dirSign < 0) { nx = -nx; ny = -ny; }
      const open = 30 + 120 * ((ta + tb) / 2) ** 1.2;
      const L = Math.min(open, len * 1.9) * (0.92 + rand() * 0.12);
      const tip = [m[0] + nx * L + dx * 0.08, m[1] + ny * L + dy * 0.08];
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(tip[0], tip[1]);
      g.lineTo(b[0], b[1]);
      g.closePath();
      g.fillStyle = '#ddd2b8';
      g.fill();
      g.lineWidth = 7;
      g.strokeStyle = '#151211';
      g.stroke();
      // shading on one flank
      g.beginPath();
      g.moveTo(m[0], m[1]);
      g.lineTo(tip[0], tip[1]);
      g.lineTo(b[0], b[1]);
      g.closePath();
      g.fillStyle = 'rgba(120,110,95,0.35)';
      g.fill();
    }
  };
  row(U, 1, 13, 0.05, 0.985);
  row(Lw, -1, 12, 0.07, 0.985);
  // re-stroke the lips over the tooth roots
  g.beginPath();
  g.moveTo(C[0], C[1]);
  g.bezierCurveTo(U[1][0], U[1][1], U[2][0], U[2][1], U[3][0], U[3][1]);
  g.moveTo(C[0], C[1]);
  g.bezierCurveTo(Lw[1][0], Lw[1][1], Lw[2][0], Lw[2][1], Lw[3][0], Lw[3][1]);
  g.lineWidth = 30;
  g.strokeStyle = '#121010';
  g.stroke();
  g.restore();
}

function drawEmblem(g, x0, y0, w, h) {
  g.save();
  g.translate(x0 + w / 2, y0 + h / 2);
  const s = h / 256;
  g.scale(s, s);
  const feather = (side, i) => {
    const ang = (-0.42 + i * 0.16) * side;
    const len = 205 - i * 22;
    g.save();
    g.scale(side, 1);
    g.rotate(-ang * side - 0.08);
    g.beginPath();
    g.moveTo(40, -8);
    g.quadraticCurveTo(40 + len * 0.55, -28 - i * 3, 40 + len, -12);
    g.quadraticCurveTo(40 + len * 0.6, 14, 40, 10);
    g.closePath();
    g.fillStyle = '#e9e3d0';
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = '#2a2722';
    g.stroke();
    g.beginPath();
    g.moveTo(48, 0);
    g.lineTo(30 + len * 0.9, -12);
    g.lineWidth = 3;
    g.stroke();
    g.restore();
  };
  for (const side of [-1, 1]) for (let i = 4; i >= 0; i--) feather(side, i);
  g.beginPath();
  g.arc(0, 0, 58, 0, Math.PI * 2);
  g.fillStyle = '#e9e3d0';
  g.fill();
  g.lineWidth = 9;
  g.strokeStyle = '#2a2722';
  g.stroke();
  g.beginPath();
  g.arc(0, 0, 42, 0, Math.PI * 2);
  g.fillStyle = '#3d4528';
  g.fill();
  // star
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 15 : 36;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = '#a3221a';
  g.fill();
  g.restore();
}

function drawFinArt(g, x0, y0, w, h) {
  g.save();
  g.translate(x0, y0);
  g.scale(w / 256, h / 464);
  const ink = '#2b2823', bone = '#ece6d4';
  // feather rising diagonally
  g.save();
  g.translate(128, 300);
  g.rotate(0.28);
  g.beginPath();
  g.moveTo(0, 30);
  g.bezierCurveTo(-70, -60, -60, -210, 8, -285);
  g.bezierCurveTo(60, -200, 66, -60, 0, 30);
  g.closePath();
  g.fillStyle = bone;
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = ink;
  g.stroke();
  g.beginPath();
  g.moveTo(0, 60);
  g.quadraticCurveTo(2, -100, 8, -280);
  g.lineWidth = 5;
  g.stroke();
  g.lineWidth = 3;
  for (let i = 0; i < 12; i++) {
    const y = -20 - i * 21;
    g.beginPath();
    g.moveTo(3 + i * 0.4, y);
    g.lineTo(-38 + i * 1.8, y - 18);
    g.moveTo(3 + i * 0.4, y);
    g.lineTo(40 - i * 1.8, y - 16);
    g.stroke();
  }
  g.restore();
  // skull at the base
  g.save();
  g.translate(118, 360);
  g.beginPath();
  g.ellipse(0, 0, 58, 52, 0, 0, Math.PI * 2);
  g.fillStyle = bone;
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = ink;
  g.stroke();
  g.beginPath();
  g.roundRect(-34, 34, 68, 42, 10);
  g.fill();
  g.stroke();
  g.fillStyle = ink;
  for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(sx * 22, 2, 15, 17, 0, 0, Math.PI * 2); g.fill(); }
  g.beginPath(); g.moveTo(0, 18); g.lineTo(-7, 32); g.lineTo(7, 32); g.closePath(); g.fill();
  g.lineWidth = 4;
  for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(i * 12, 46); g.lineTo(i * 12, 74); g.stroke(); }
  g.restore();
  g.restore();
}

// Stencil text with cut bridges.
function stencil(g, text, rect, color, fontPx, opts = {}) {
  const [x, y, w, h] = rect;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.font = `bold ${fontPx}px "DejaVu Sans", "Arial Narrow", Arial, Helvetica, sans-serif`;
  const sp = opts.spacing || 0.06;
  // manual letter spacing
  const chars = [...text];
  const widths = chars.map((c) => g.measureText(c).width);
  const total = widths.reduce((a, b2) => a + b2, 0) + sp * fontPx * (chars.length - 1);
  const scale = Math.min(1, (w * 0.94) / total);
  let cx = x + w / 2 - (total * scale) / 2;
  g.translate(0, 0);
  for (let i = 0; i < chars.length; i++) {
    const cw = widths[i] * scale;
    g.save();
    g.translate(cx + cw / 2, y + h / 2);
    g.scale(scale, 1);
    g.fillText(chars[i], 0, 0);
    g.restore();
    // stencil bridges through round glyphs
    if ('0OQDBP8R6A9GCU'.includes(chars[i])) {
      g.save();
      g.globalCompositeOperation = 'destination-out';
      const bw = Math.max(2, fontPx * 0.07);
      g.fillRect(cx + cw / 2 - bw / 2, y + h * 0.1, bw, h * 0.22);
      g.fillRect(cx + cw / 2 - bw / 2, y + h * 0.68, bw, h * 0.22);
      g.restore();
    }
    cx += cw + sp * fontPx * scale;
  }
  g.restore();
}

export function createDecalCanvas(seed) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = DECAL_SIZE;
  const g = canvas.getContext('2d');
  const rand = rng(seed * 17 + 3);
  g.clearRect(0, 0, DECAL_SIZE, DECAL_SIZE);
  drawShark(g, ...RECTS.shark, rand);
  drawEmblem(g, ...RECTS.emblem);
  drawFinArt(g, ...RECTS.finart);
  stencil(g, 'LG-07', RECTS.reg, '#17150f', 110, { spacing: 0.1 });
  stencil(g, 'NO STEP', RECTS.nostep, '#1a1812', 30);
  stencil(g, 'FUEL 100/130', RECTS.fuel, '#1a1812', 30);
  stencil(g, 'DANGER - PROPELLER', RECTS.danger, '#7d140e', 26);
  stencil(g, 'NO PUSH', RECTS.nopush, '#1a1812', 26);
  stencil(g, 'EMERGENCY EXIT', RECTS.exit, '#7d140e', 30);
  stencil(g, 'TIE DOWN', RECTS.tiedown, '#1a1812', 30);
  // arrow
  {
    const [x, y, w, h] = RECTS.arrow;
    g.save();
    g.translate(x + w / 2, y + h / 2);
    g.fillStyle = '#7d140e';
    g.beginPath();
    g.moveTo(-50, -14); g.lineTo(10, -14); g.lineTo(10, -36); g.lineTo(56, 0); g.lineTo(10, 36); g.lineTo(10, 14); g.lineTo(-50, 14);
    g.closePath();
    g.fill();
    g.restore();
  }
  return canvas;
}

function rectUV(r) {
  const [x, y, w, h] = r;
  return new THREE.Vector4(x / DECAL_SIZE, 1 - (y + h) / DECAL_SIZE, w / DECAL_SIZE, h / DECAL_SIZE);
}

// Decal placements in MODEL space. u: image-right axis, n: projection normal.
const DECALS = [
  { key: 'shark', c: [0.6, 2.02, -0.97], u: [0, 0, -1], n: [1, 0, 0], size: [1.36, 0.74], depth: 0.7, facing: 0.08 },
  { key: 'shark', c: [-0.6, 2.02, -0.97], u: [0, 0, -1], n: [-1, 0, 0], size: [1.36, 0.74], depth: 0.7, facing: 0.08 },
  { key: 'emblem', c: [0.69, 2.4, 0.21], u: [0, 0, -1], n: [1, 0, 0], size: [0.8, 0.4], depth: 0.25, facing: 0.3 },
  { key: 'emblem', c: [-0.69, 2.4, 0.21], u: [0, 0, 1], n: [-1, 0, 0], size: [0.8, 0.4], depth: 0.25, facing: 0.3 },
  { key: 'finart', c: [0, 3.42, 6.27], u: [0, 0, -1], n: [1, 0, 0], size: [0.6, 1.09], depth: 0.3, facing: 0.3 },
  { key: 'finart', c: [0, 3.42, 6.27], u: [0, 0, 1], n: [-1, 0, 0], size: [0.6, 1.09], depth: 0.3, facing: 0.3 },
  { key: 'reg', c: [0.5, 2.62, 4.72], u: [0, 0, -1], n: [1, 0, 0], size: [1.0, 0.23], depth: 0.4, facing: 0.25 },
  { key: 'reg', c: [-0.5, 2.62, 4.72], u: [0, 0, 1], n: [-1, 0, 0], size: [1.0, 0.23], depth: 0.4, facing: 0.25 },
  { key: 'fuel', c: [-0.69, 2.16, 2.86], u: [0, 0, 1], n: [-1, 0, 0], size: [0.34, 0.05], depth: 0.2, facing: 0.4 },
  { key: 'danger', c: [0.66, 1.78, -0.25], u: [0, 0, -1], n: [1, 0, 0], size: [0.42, 0.05], depth: 0.3, facing: 0.3 },
  { key: 'danger', c: [-0.66, 1.78, -0.25], u: [0, 0, 1], n: [-1, 0, 0], size: [0.42, 0.05], depth: 0.3, facing: 0.3 },
  { key: 'exit', c: [0.69, 3.0, 2.02], u: [0, 0, -1], n: [1, 0, 0], size: [0.36, 0.06], depth: 0.2, facing: 0.4 },
  { key: 'nopush', c: [0, 3.25, 7.0], u: [0, 0, -1], n: [1, 0, 0], size: [0.22, 0.04], depth: 0.15, facing: 0.4 },
  { key: 'tiedown', c: [0.18, 2.69, 6.55], u: [0, 0, -1], n: [1, 0, 0], size: [0.2, 0.035], depth: 0.25, facing: 0.2 },
  { key: 'arrow', c: [0.69, 1.98, 1.36], u: [0, 0, -1], n: [1, 0, 0], size: [0.12, 0.12], depth: 0.2, facing: 0.4 },
  { key: 'nostep', c: [0.0, 3.3, 2.93], u: [1, 0, 0], n: [0, 1, 0], v: [0, 0, -1], size: [0.34, 0.05], depth: 0.2, facing: 0.5 },
];
const MAX_DECALS = 16;

// Repair patches (model space boxes): centre, half size, kind (0 bare alu, 1 zinc primer, 2 red oxide, 3 olive)
const PATCHES = [
  { c: [0.69, 1.98, 0.68], h: [0.08, 0.13, 0.17], k: 0 },
  { c: [-0.6, 2.48, 3.95], h: [0.15, 0.16, 0.24], k: 1 },
  { c: [1.8, 0.48, -0.95], h: [0.1, 0.12, 0.22], k: 0 },
  { c: [4.9, 3.46, 1.1], h: [0.3, 0.12, 0.25], k: 2 },
  { c: [-0.58, 1.86, 0.15], h: [0.12, 0.1, 0.14], k: 3 },
  { c: [0.0, 3.38, 5.2], h: [0.25, 0.08, 0.2], k: 0 },
];


const BAKE_VERT = /* glsl */ `
attribute vec2 aPanel;
attribute vec4 aBake;
uniform vec3 uCG;
varying vec3 vP;
varying vec3 vN;
varying vec2 vQ;
varying vec4 vB;
void main() {
  vP = position + uCG;
  vN = normal;
  vQ = aPanel;
  vB = aBake;
  gl_Position = aBake.y < 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;

const BAKE_FRAG = /* glsl */ `
uniform int uPass;
uniform float uSeed;
uniform sampler2D uDecalTex;
uniform vec4 uDA[${MAX_DECALS}]; // centre.xyz, sizeU
uniform vec4 uDB[${MAX_DECALS}]; // axisU.xyz, sizeV
uniform vec4 uDC[${MAX_DECALS}]; // axisN.xyz, depth
uniform vec4 uDV[${MAX_DECALS}]; // axisV.xyz, minFacing
uniform vec4 uDR[${MAX_DECALS}]; // atlas rect
uniform int uDecalCount;
uniform vec4 uPA[8]; // centre.xyz, kind
uniform vec4 uPB[8]; // half size.xyz
uniform int uPatchCount;
varying vec3 vP;
varying vec3 vN;
varying vec2 vQ;
varying vec4 vB;
${GLSL_NOISE}
${GLSL_PANEL}
#define P_FUSE ${PART.FUSE}
#define P_COWLIN ${PART.COWL_IN}
#define P_WING ${PART.WING}
#define P_WINGC ${PART.WING_C}
#define P_HSTAB ${PART.HSTAB}
#define P_FIN ${PART.FIN}
#define P_RUDDER ${PART.RUDDER}
#define P_FLOAT ${PART.FLOAT}
#define P_WSTRUT ${PART.WSTRUT}
#define P_DOOR ${PART.DOOR}
#define P_DOORIN ${PART.DOOR_IN}
#define P_FITTING ${PART.FITTING}
#define P_BLACK ${PART.BLACK}

float boxDist(vec3 p, vec3 c, vec3 h) { vec3 d = abs(p - c) - h; return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0); }
float rectDist(vec2 p, vec2 a, vec2 b) { vec2 c = (a + b) * 0.5, h = (b - a) * 0.5; vec2 d = abs(p - c) - h; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }

void main() {
  vec3 P = vP;
  vec3 N = normalize(vN);
  int part = int(vB.y + 0.5);
  float edge = vB.x, wearBias = vB.z, ao = vB.w;
  vec3 S = P + uSeed * vec3(1.37, 0.71, 2.13);
  vec3 col;
  float rough;
  float metal = 0.0;
  float wear;
  float detail = 1.0;

  if (part == P_COWLIN || part == P_DOORIN || part == P_FITTING || part == P_BLACK) {
    // ---------------- generic islands ----------------
    vec2 q = vQ * 3.0 + uSeed;
    float n = sp_fbm2(q * 2.0, 4);
    if (part == P_COWLIN) { col = vec3(0.03, 0.029, 0.024) * (0.7 + 0.6 * n); rough = 0.45 + 0.35 * n; wear = 0.3; }
    else if (part == P_DOORIN) {
      col = vec3(0.07, 0.076, 0.064) * (0.8 + 0.4 * n);
      float scuff = smoothstep(0.6, 0.8, sp_fbm2(q * vec2(6.0, 1.5) + 4.0, 3));
      col = mix(col, vec3(0.15, 0.14, 0.12), scuff * 0.6);
      rough = 0.72; wear = 0.45;
    } else if (part == P_FITTING) { col = vec3(0.42, 0.41, 0.39) * (0.7 + 0.5 * n); rough = 0.36 + 0.25 * n; metal = 1.0; wear = 0.0; }
    else { col = vec3(0.016) * (0.8 + 0.4 * n); rough = 0.75; wear = 0.0; }
    detail = 0.0;
    ao = 1.0;
  } else {
    // ---------------- layered paint ----------------
    vec3 YEL = vec3(0.64, 0.315, 0.014);
    vec3 OLV = vec3(0.07, 0.081, 0.029);
    vec3 DRK = vec3(0.021, 0.021, 0.019);
    vec3 WHT = vec3(0.5, 0.44, 0.34);
    col = YEL * (0.93 + 0.14 * sp_fbm3(S * 2.3, 3));
    vec3 q = S * vec3(0.43, 0.6, 0.37);
    vec3 warp = vec3(sp_fbm3(q * 1.7 + 3.1, 3), sp_fbm3(q * 1.7 + 7.7, 3), sp_fbm3(q * 1.7 + 1.3, 3));
    float camoN = sp_fbm3(q + warp * 1.1, 4);
    float cw = max(fwidth(camoN), 0.003) + 0.006;
    float camo = smoothstep(0.52 - cw, 0.52 + cw, camoN);
    float stripe = 0.0, sCoord = 0.0, sGate = 0.0;
    if (part == P_FLOAT) { sCoord = (P.z * 0.82 + P.y * 1.15 + abs(P.x) * 0.2) / 1.3; sGate = 1.0; }
    else if (part == P_WING) { sCoord = (abs(P.x) * 0.72 + P.z * 0.5) / 1.55; sGate = smoothstep(2.7, 3.2, abs(P.x)) + (1.0 - smoothstep(1.3, 1.8, abs(P.x))); }
    else if (part == P_HSTAB || part == P_FIN || part == P_RUDDER) { sCoord = (abs(P.x) * 0.7 + P.y * 0.6 + P.z * 0.5) / 0.75; sGate = 1.0; }
    else if (part == P_FUSE || part == P_DOOR) { sCoord = (P.z * 0.8 + P.y * 0.6) / 1.4; sGate = smoothstep(4.0, 4.3, P.z) * (1.0 - smoothstep(5.9, 6.2, P.z)); }
    if (sGate > 0.0) {
      float idx = floor(sCoord);
      float band = fract(sCoord);
      float on = step(0.3, sp_h21(vec2(idx, 3.0 + float(part))));
      float sw = max(fwidth(sCoord), 0.002);
      float wid = 0.36 + 0.08 * sp_h21(vec2(idx, 9.0));
      stripe = on * smoothstep(0.0, sw, band) * (1.0 - smoothstep(wid - sw, wid + sw, band)) * clamp(sGate, 0.0, 1.0);
    }
    col = mix(col, OLV * (0.85 + 0.3 * sp_noise3(S * 3.0)), camo);
    col = mix(col, DRK * (0.8 + 0.5 * sp_noise3(S * 4.0)), stripe);
    if (part == P_FUSE && P.z < -1.46) col = vec3(0.028, 0.027, 0.025);
    if (part == P_FUSE || part == P_DOOR) {
      float e0 = 0.02 + 0.014 * (sp_noise3(S * 11.0) - 0.5);
      float e1 = 0.4 + 0.016 * (sp_noise3(S * 9.0 + 4.0) - 0.5);
      float bw = max(fwidth(P.z), 0.002);
      float band = smoothstep(e0 - bw, e0 + bw, P.z) * (1.0 - smoothstep(e1 - bw, e1 + bw, P.z));
      col = mix(col, WHT * (0.9 + 0.15 * sp_noise3(S * 5.0)), band);
    }
    for (int i = 0; i < 8; i++) {
      if (i >= uPatchCount) break;
      float d = boxDist(P, uPA[i].xyz, uPB[i].xyz);
      if (d < 0.006) {
        float k = uPA[i].w;
        vec3 pc = k < 0.5 ? vec3(0.5, 0.5, 0.47) : k < 1.5 ? vec3(0.22, 0.27, 0.07) : k < 2.5 ? vec3(0.17, 0.045, 0.025) : OLV * 1.3;
        float inside = 1.0 - smoothstep(-0.006, -0.002, d);
        col = mix(col * 0.3, pc * (0.85 + 0.3 * sp_noise3(S * 13.0)), inside);
        metal = max(metal, k < 0.5 ? inside : 0.0);
      }
    }
    float decalA = 0.0;
    for (int i = 0; i < ${MAX_DECALS}; i++) {
      if (i >= uDecalCount) break;
      vec3 d = P - uDA[i].xyz;
      float u = dot(d, uDB[i].xyz) / uDA[i].w + 0.5;
      float v = dot(d, uDV[i].xyz) / uDB[i].w + 0.5;
      float w = dot(d, uDC[i].xyz) / uDC[i].w;
      if (u > 0.0 && u < 1.0 && v > 0.0 && v < 1.0 && abs(w) < 1.0 && dot(N, uDC[i].xyz) > uDV[i].w) {
        vec4 dc = texture2D(uDecalTex, uDR[i].xy + vec2(u, v) * uDR[i].zw);
        col = mix(col, dc.rgb * 0.9, dc.a * 0.96);
        decalA = max(decalA, dc.a);
      }
    }
    // ---------------- weathering ----------------
    float up = clamp(N.y, 0.0, 1.0);
    float down = clamp(-N.y, 0.0, 1.0);
    float h = P.y;
    float paintLum = dot(col, vec3(0.3, 0.59, 0.11)); // before weathering: yellow / white vs olive / black
    float bright = smoothstep(0.035, 0.1, paintLum);
    float macro = sp_fbm3(S * 0.9 + 11.0, 4);
    float region = 0.0;
    if (part == P_FLOAT) region += step(0.6, N.y) * 0.18 + (1.0 - smoothstep(-2.3, -1.6, P.z)) * 0.3 + (1.0 - smoothstep(0.1, 0.35, h)) * 0.12;
    if (part == P_FUSE || part == P_DOOR) {
      float dd = 1e3;
      if (abs(P.x) > 0.5) {
        dd = min(dd, abs(rectDist(P.zy, vec2(0.4, 1.86), vec2(1.3, 3.25))));
        if (P.x > 0.0) dd = min(dd, abs(rectDist(P.zy, vec2(1.42, 1.74), vec2(2.62, 3.14))));
      }
      region += (1.0 - smoothstep(0.0, 0.07, dd)) * 0.25 + down * 0.12 + (1.0 - smoothstep(-1.62, -1.45, P.z)) * 0.2 + (1.0 - smoothstep(-0.4, 0.3, P.z)) * 0.16;
    }
    if (part == P_WING || part == P_WINGC) region += step(0.5, N.y) * (1.0 - smoothstep(1.2, 1.9, abs(P.x))) * 0.3 + (1.0 - smoothstep(0.62, 0.8, P.z)) * 0.15;
    float lowK = 1.0 - smoothstep(0.3, 2.4, h);
    // panel seams and rivet rows (panel space): grime lines, chip clusters
    float dS, dR, pid;
    sp_panelHeight(vQ, 1.0, dS, dR, pid);
    float seamZ = 1.0 - smoothstep(0.0, 0.05, dS);
    float rivZ = 1.0 - smoothstep(0.003, 0.016, dR);
    float noStrut = part == P_WSTRUT ? 0.0 : 1.0;
    // sun-bleached tops, cavity darkening
    float lum = dot(col, vec3(0.3, 0.59, 0.11));
    col = mix(col, mix(vec3(lum), col, 0.8) * 1.04 + 0.004, up * 0.35);
    col = mix(col, vec3(0.05, 0.042, 0.03), (1.0 - ao) * 0.55);
    // big soft grime smudges and general dirt, heavier low on the airframe
    float smudge = smoothstep(0.52, 0.78, sp_fbm3(S * 1.5 + 41.0, 4) + lowK * 0.12 + region * 0.12);
    col = mix(col, col * vec3(0.52, 0.45, 0.35), smudge * 0.6);
    float dirtN = sp_fbm3(S * vec3(2.0, 3.5, 2.0) + 2.0, 4);
    col = mix(col, vec3(0.1, 0.085, 0.065), smoothstep(0.48, 0.8, dirtN) * (0.2 + 0.45 * lowK));
    // grime packed along seams (a dark line with a dirty halo)
    float seamLine = (1.0 - smoothstep(0.0012, 0.0055, dS)) * (0.55 + 0.45 * sp_noise3(S * 3.0 + 9.0));
    col *= 1.0 - seamLine * 0.55 * noStrut;
    col = mix(col, col * vec3(0.5, 0.44, 0.36), seamZ * smoothstep(0.35, 0.7, sp_noise3(S * 16.0)) * 0.55 * noStrut);
    // chipped paint, clustered on seams, rivet rows, edges and worn regions:
    // dark primer / dirt on the bright paint, bare aluminium on the dark paint
    float wornA = smoothstep(0.56, 0.74, macro + edge * 0.18 + region * 0.3 + wearBias * 0.2);
    float chipCov = seamZ * 0.42 + rivZ * 0.25 + edge * 0.5 + region * 0.45 + wornA * 0.35 + (macro - 0.5) * 0.7 + lowK * 0.15 + wearBias * 0.5;
    if (part == P_FLOAT) chipCov += 0.03 + up * 0.12;
    chipCov += seamZ * 0.18 * bright;
    if (part == P_WSTRUT) chipCov = chipCov * 0.5 + edge * 0.2;
    if (part == P_FUSE && P.z < -1.46) chipCov *= 0.3; // thin cowl-lip island: keep it dark worn metal
    // chips come in clusters (scuffed zones) and stretch a little along the airflow
    float cluster = smoothstep(0.32, 0.68, sp_fbm3(S * 2.2 + 77.0, 3) + seamZ * 0.1);
    chipCov *= 0.45 + 0.85 * cluster;
    chipCov += decalA * 0.55; // painted-on art flakes first
    float chipN = sp_fbm3(S * vec3(22.0, 26.0, 15.0) + 5.0, 3) * 0.72 + sp_noise3(S * 70.0) * 0.28;
    float chipT = 0.8 - clamp(chipCov, 0.0, 1.0) * 0.36;
    float chipW = max(fwidth(chipN), 0.003);
    float chip = smoothstep(chipT - chipW, chipT + chipW, chipN);
    float core = smoothstep(chipT + 0.06 - chipW, chipT + 0.06 + chipW, chipN);
    vec3 primer = mix(vec3(0.03, 0.026, 0.02), vec3(0.11, 0.06, 0.025), sp_noise3(S * 37.0));
    vec3 bareAl = vec3(0.36, 0.355, 0.335) * (0.78 + 0.35 * sp_noise3(S * 61.0));
    float bareMask = chip * mix(0.7, 0.04, bright) + core * mix(0.2, 0.22, bright);
    bareMask = clamp(bareMask, 0.0, 1.0);
    col = mix(col, primer, chip);
    col = mix(col, bareAl, bareMask);
    metal = max(metal, bareMask * 0.9);
    // fine dark specks: flaked paint, dried mud and oil (denser in worn areas)
    float fleckN = sp_noise3(S * 52.0 + 7.0) * 0.7 + sp_noise3(S * 131.0) * 0.3;
    float fleckK = 0.3 + 0.7 * smoothstep(0.38, 0.72, macro + region * 0.4 + edge * 0.25);
    float fleck = smoothstep(0.69, 0.74, fleckN) * fleckK;
    col = mix(col, vec3(0.04, 0.034, 0.026), fleck * (part == P_WSTRUT ? 0.35 : 0.75));
    // dark drips and rust runs down the sides from seams and rivets
    float dripN = sp_noise3(S * vec3(38.0, 1.5, 38.0)) * sp_noise3(S * vec3(10.0, 0.75, 10.0) + 7.0);
    float drips = smoothstep(0.2, 0.38, dripN) * (1.0 - up) * (1.0 - down * 0.7) * (0.55 + 0.45 * seamZ);
    col = mix(col, col * vec3(0.38, 0.31, 0.23), drips * 0.6 * noStrut);
    float rustRegion = smoothstep(0.45, 0.7, sp_fbm3(S * 0.7 + 21.0, 3)) * 0.8 + lowK * 0.35 + (part == P_FLOAT ? 0.25 : 0.0);
    float spot = rivZ * step(0.45, sp_noise2(vQ * 27.0 + 3.0));
    float streakV = sp_noise3(S * vec3(28.0, 1.4, 28.0)) * sp_noise3(S * vec3(9.0, 0.9, 9.0));
    float seamBleed = 1.0 - smoothstep(0.0, 0.05, dS);
    float rust = clamp(spot * 0.9 * rustRegion + smoothstep(0.28, 0.5, streakV) * (0.45 + seamBleed) * rustRegion * (1.0 - up * 0.7) * 0.85, 0.0, 1.0);
    if (part == P_WSTRUT) rust *= 0.4;
    vec3 RUST = mix(vec3(0.15, 0.05, 0.014), vec3(0.38, 0.14, 0.035), sp_noise3(S * 40.0));
    col = mix(col, RUST, rust * 0.75);
    metal *= 1.0 - rust * 0.7;
    // exhaust soot along the fuselage sides, oil along the belly
    float soot = 0.0, oil = 0.0;
    if ((part == P_FUSE || part == P_DOOR) && abs(N.x) > 0.1) {
      float zz = P.z + 0.22;
      if (zz > 0.0) {
        float yc = 2.62 - 0.11 * zz;
        float w = 0.1 + 0.1 * zz;
        float dy = (P.y - yc) / w;
        soot = exp(-dy * dy) * exp(-zz / 2.6) * (0.55 + 0.7 * sp_noise3(S * vec3(1.2, 16.0, 1.6)));
      }
    }
    if ((part == P_FUSE || part == P_DOOR) && N.y < 0.3 && P.y < 2.0) {
      float zz = P.z + 1.25;
      if (zz > 0.0) { float w = 0.14 + 0.07 * zz; oil = exp(-(P.x * P.x) / (w * w)) * exp(-zz / 3.2) * (0.4 + 0.9 * sp_noise3(S * vec3(16.0, 16.0, 1.2))); }
    }
    soot = clamp(soot, 0.0, 1.0); oil = clamp(oil, 0.0, 1.0);
    col = mix(col, vec3(0.012, 0.01, 0.008), soot * 0.85);
    col = mix(col, vec3(0.02, 0.016, 0.01), oil * 0.7);
    metal *= 1.0 - max(soot, oil) * 0.8;
    // mud, splash and waterline; scraped bare metal along the float chines and bottoms
    float mud = 0.0;
    if (part == P_FLOAT) {
      float mh = h + (sp_fbm3(S * 3.0, 3) - 0.5) * 0.22;
      mud = 1.0 - smoothstep(0.2, 0.5, mh); // dried silt up to the chines
      float spl = sp_fbm3(S * vec3(11.0, 17.0, 11.0), 3);
      mud = max(mud, step(0.62 - (1.0 - smoothstep(0.05, 0.75, h)) * 0.22, spl) * (1.0 - smoothstep(0.3, 0.85, h)));
      float scrapeN = sp_fbm3(S * vec3(3.0, 9.0, 3.0) + 13.0, 3);
      float scrape = smoothstep(0.55, 0.66, scrapeN + down * 0.15) * (1.0 - smoothstep(0.3, 0.42, h)) * smoothstep(0.12, 0.2, h);
      col = mix(col, bareAl * 0.8, scrape * 0.55);
      metal = max(metal, scrape * 0.55);
      float wl = exp(-pow((h - 0.27) / 0.035, 2.0));
      col = mix(col, vec3(0.06, 0.06, 0.035), wl * 0.55);
      col = mix(col, col * vec3(0.55, 0.65, 0.42), (1.0 - smoothstep(0.22, 0.27, h)) * 0.5);
    } else if (h < 1.9) {
      float spl = sp_fbm3(S * vec3(10.0, 16.0, 10.0), 3);
      mud = step(0.68, spl) * (1.0 - smoothstep(0.9, 1.9, h)) * 0.8 + (1.0 - smoothstep(1.55, 1.75, h)) * down * 0.35;
    }
    mud = clamp(mud, 0.0, 1.0);
    vec3 MUD = mix(vec3(0.2, 0.165, 0.12), vec3(0.07, 0.058, 0.042), sp_noise3(S * 9.0));
    col = mix(col, MUD, mud * 0.85);
    metal *= 1.0 - mud * 0.9;
    float ws = smoothstep(0.62, 0.8, sp_noise3(S * vec3(22.0, 1.1, 22.0))) * (1.0 - up) * 0.2;
    col = mix(col, col * 1.3 + 0.015, ws);
    wear = 0.14 + wearBias + edge * 0.45 + region + (macro - 0.47) * 0.7 + (1.0 - ao) * 0.12;
    wear = clamp(wear * (1.0 - mud * 0.6), 0.0, 1.0);
    rough = 0.6 + up * 0.12 - soot * 0.18 - oil * 0.3 + mud * 0.32 + rust * 0.22 + chip * 0.12 + smudge * 0.08 + (dirtN - 0.5) * 0.12;
    rough = clamp(mix(rough, 0.38 + 0.2 * sp_noise3(S * 50.0), metal), 0.18, 1.0);
    if (part == P_WSTRUT) detail = 0.0;
  }
  ao = mix(0.25, 1.0, ao);
  if (uPass == 0) gl_FragColor = vec4(col, 0.5 + 0.5 * detail);
  else gl_FragColor = vec4(ao, rough, metal, 0.5 + 0.5 * wear);
}`;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DILATE_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uFinal;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uTex, vUv);
  if (c.a < 0.25) {
    vec4 sum = vec4(0.0);
    float n = 0.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec4 s = texture2D(uTex, vUv + vec2(float(x), float(y)) * uTexel);
      if (s.a >= 0.25) { sum += s; n += 1.0; }
    }
    if (n > 0.0) c = sum / n;
  }
  if (uFinal > 0.5) c.a = c.a >= 0.25 ? clamp((c.a - 0.5) * 2.0, 0.0, 1.0) : 0.0;
  gl_FragColor = c;
}`;

const GENERIC_PART = { g_dark: PART.COWL_IN, g_interior: PART.DOOR_IN, g_fitting: PART.FITTING, g_black: PART.BLACK };

// Collect the paint builders into bake geometries (generic-island vertices are skipped;
// generic islands are filled by one quad each).
function bakeGeometries(model) {
  const ctx = model.ctx;
  const geos = [];
  const builders = [ctx.paint, ctx.bakeOnly, ...ctx.extra.filter((b) => b.layoutName === 'paint' && !b.localSpace)];
  for (const b of builders) {
    if (!b.vertexCount) continue;
    const bake = new Float32Array(b.attrs.aBake);
    for (let v = 0; v < b.vertexCount; v++) {
      const is = b.island[v];
      if (is >= 0 && ctx.islands[is].generic) bake[v * 4 + 1] = -1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.position), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(b.normal), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b.attrs.uv), 2));
    g.setAttribute('aPanel', new THREE.BufferAttribute(new Float32Array(b.attrs.uv1), 2));
    g.setAttribute('aBake', new THREE.BufferAttribute(bake, 4));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(b.index), 1));
    geos.push(g);
  }
  // generic island quads
  const pos = [], nrm = [], uv = [], pan = [], bk = [], idx = [];
  ctx.islands.forEach((is, i) => {
    if (!is.generic) return;
    const r = model.atlas.byName[is.name];
    const x0 = r.x, y0 = r.y, x1 = r.x + is.w * r.sx, y1 = r.y + is.h * r.sy;
    const base = pos.length / 3;
    const corners = [[x0, y0, 0, 0], [x1, y0, is.w, 0], [x1, y1, is.w, is.h], [x0, y1, 0, is.h]];
    for (const c of corners) {
      pos.push(0, 0, 0); nrm.push(0, 1, 0); uv.push(c[0], c[1]); pan.push(c[2] + i * 3.1, c[3]);
      bk.push(0, GENERIC_PART[is.name] || PART.BLACK, 0, 1);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  if (idx.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aPanel', new THREE.Float32BufferAttribute(pan, 2));
    g.setAttribute('aBake', new THREE.Float32BufferAttribute(bk, 4));
    g.setIndex(idx);
    geos.push(g);
  }
  return geos;
}

// Renderer state helpers (the module never changes renderer settings persistently).
function saveState(renderer) {
  return {
    target: renderer.getRenderTarget(),
    autoClear: renderer.autoClear,
    clearColor: renderer.getClearColor(new THREE.Color()),
    clearAlpha: renderer.getClearAlpha(),
    clipping: renderer.clippingPlanes,
    localClip: renderer.localClippingEnabled,
  };
}
function restoreState(renderer, s) {
  renderer.setRenderTarget(s.target);
  renderer.autoClear = s.autoClear;
  renderer.setClearColor(s.clearColor, s.clearAlpha);
  renderer.clippingPlanes = s.clipping;
  renderer.localClippingEnabled = s.localClip;
}

// GPU bake of the airframe atlas. Returns { map, data, dispose }.
export function bakeAirframe(renderer, model, { size = 2048, dataSize = 1024, seed = 7 } = {}) {
  const state = saveState(renderer);
  renderer.clippingPlanes = [];
  renderer.localClippingEnabled = false;
  renderer.autoClear = false;
  const decalCanvas = createDecalCanvas(seed);
  const decalTex = new THREE.CanvasTexture(decalCanvas);
  decalTex.colorSpace = THREE.SRGBColorSpace;
  decalTex.generateMipmaps = true;
  decalTex.minFilter = THREE.LinearMipmapLinearFilter;
  decalTex.anisotropy = 4;
  const v4 = () => new THREE.Vector4();
  const uniforms = {
    uPass: { value: 0 }, uSeed: { value: (seed % 97) * 3.17 }, uCG: { value: CG_MODEL.clone() },
    uDecalTex: { value: decalTex },
    uDA: { value: Array.from({ length: MAX_DECALS }, v4) }, uDB: { value: Array.from({ length: MAX_DECALS }, v4) },
    uDC: { value: Array.from({ length: MAX_DECALS }, v4) }, uDV: { value: Array.from({ length: MAX_DECALS }, v4) },
    uDR: { value: Array.from({ length: MAX_DECALS }, v4) }, uDecalCount: { value: DECALS.length },
    uPA: { value: Array.from({ length: 8 }, v4) }, uPB: { value: Array.from({ length: 8 }, v4) }, uPatchCount: { value: PATCHES.length },
  };
  DECALS.forEach((d, i) => {
    const n = new THREE.Vector3(...d.n), u = new THREE.Vector3(...d.u);
    const v = d.v ? new THREE.Vector3(...d.v) : new THREE.Vector3(0, 1, 0);
    uniforms.uDA.value[i].set(d.c[0], d.c[1], d.c[2], d.size[0]);
    uniforms.uDB.value[i].set(u.x, u.y, u.z, d.size[1]);
    uniforms.uDC.value[i].set(n.x, n.y, n.z, d.depth);
    uniforms.uDV.value[i].set(v.x, v.y, v.z, d.facing);
    uniforms.uDR.value[i].copy(rectUV(RECTS[d.key]));
  });
  PATCHES.forEach((p, i) => {
    uniforms.uPA.value[i].set(p.c[0], p.c[1], p.c[2], p.k);
    uniforms.uPB.value[i].set(p.h[0], p.h[1], p.h[2], 0);
  });
  const bakeMat = new THREE.ShaderMaterial({ uniforms, vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG, side: THREE.DoubleSide, depthTest: false, depthWrite: false, toneMapped: false });
  const scene = new THREE.Scene();
  const geos = bakeGeometries(model);
  for (const g of geos) { const m = new THREE.Mesh(g, bakeMat); m.frustumCulled = false; scene.add(m); }
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const rtOpts = (s, srgb, mip) => ({
    depthBuffer: false, generateMipmaps: mip, colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
    minFilter: mip ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter, magFilter: mip ? THREE.LinearFilter : THREE.NearestFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
  });
  const tA = [new THREE.WebGLRenderTarget(size, size, rtOpts(size, true, false)), new THREE.WebGLRenderTarget(size, size, rtOpts(size, true, false))];
  const tB = [new THREE.WebGLRenderTarget(dataSize, dataSize, rtOpts(dataSize, false, false)), new THREE.WebGLRenderTarget(dataSize, dataSize, rtOpts(dataSize, false, false))];
  const finalA = new THREE.WebGLRenderTarget(size, size, rtOpts(size, true, true));
  const finalB = new THREE.WebGLRenderTarget(dataSize, dataSize, rtOpts(dataSize, false, true));
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  finalA.texture.anisotropy = Math.min(8, maxAniso);
  finalB.texture.anisotropy = Math.min(4, maxAniso);
  renderer.setClearColor(0x000000, 0);
  // pass 0: albedo + detail mask, pass 1: ao/rough/metal/wear
  uniforms.uPass.value = 0;
  renderer.setRenderTarget(tA[0]); renderer.clear(); renderer.render(scene, cam);
  uniforms.uPass.value = 1;
  renderer.setRenderTarget(tB[0]); renderer.clear(); renderer.render(scene, cam);
  // dilation
  const dil = new THREE.ShaderMaterial({ uniforms: { uTex: { value: null }, uTexel: { value: new THREE.Vector2() }, uFinal: { value: 0 } }, vertexShader: QUAD_VERT, fragmentShader: DILATE_FRAG, depthTest: false, depthWrite: false, toneMapped: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dil);
  quad.frustumCulled = false;
  const qs = new THREE.Scene();
  qs.add(quad);
  const dilate = (targets, finalRT, px, iters) => {
    let src = 0;
    for (let i = 0; i < iters; i++) {
      const last = i === iters - 1;
      dil.uniforms.uTex.value = targets[src].texture;
      dil.uniforms.uTexel.value.set(1 / px, 1 / px);
      dil.uniforms.uFinal.value = last ? 1 : 0;
      renderer.setRenderTarget(last ? finalRT : targets[1 - src]);
      renderer.clear();
      renderer.render(qs, cam);
      src = 1 - src;
    }
  };
  dilate(tA, finalA, size, Math.max(6, Math.round(size / 160)));
  dilate(tB, finalB, dataSize, Math.max(4, Math.round(dataSize / 160)));
  restoreState(renderer, state);
  // cleanup transient resources
  for (const t of [...tA, ...tB]) t.dispose();
  for (const g of geos) g.dispose();
  bakeMat.dispose(); dil.dispose(); quad.geometry.dispose(); decalTex.dispose();
  return {
    map: finalA.texture, data: finalB.texture,
    dispose() { finalA.dispose(); finalB.dispose(); },
  };
}
