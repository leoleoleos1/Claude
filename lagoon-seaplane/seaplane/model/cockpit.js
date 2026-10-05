// Cockpit & cabin interior (model frame). Static parts go to `st`, every moving
// control / needle / card is a rigid part in `dyn` (or `gauge`) addressed by
// aRig, animated through a small matrix texture (see materials.js rig code).
import * as THREE from 'three';
import { DIM, roofY } from './dims.js';
import { GeoBuilder, grid, tube, lathe, box, roundedBox, polygon, mat, v3, rng, KIND } from './geom.js';
import { gaugeRect } from './instruments.js';

const D2R = Math.PI / 180;
// instrument panel plane
const PANEL = {
  c: v3(0, 2.595, 0.345),
  tilt: 10 * D2R,
  w: 1.24, h: 0.53,
};
const P_RIGHT = v3(1, 0, 0);
const P_UP = v3(0, Math.cos(PANEL.tilt), -Math.sin(PANEL.tilt));
const P_N = v3(0, Math.sin(PANEL.tilt), Math.cos(PANEL.tilt)); // toward the pilot
function panelPoint(u, v, d = 0, out = new THREE.Vector3()) {
  return out.copy(PANEL.c).addScaledVector(P_RIGHT, u).addScaledVector(P_UP, v).addScaledVector(P_N, d);
}
// matrix whose local +Z points toward the pilot (panel normal), +Y along the panel up
function panelMat(u, v, d = 0) {
  const m = new THREE.Matrix4().makeBasis(P_RIGHT, P_UP, P_N);
  m.setPosition(panelPoint(u, v, d));
  return m;
}

// gauge layout: name, u, v, radius (face), needles [{key, len, color, lamp}]
export const GAUGE_LAYOUT = [
  { name: 'airspeed', u: -0.435, v: 0.1, r: 0.041, needles: [{ key: 'asi', len: 0.035 }] },
  { name: 'attitude', u: -0.33, v: 0.1, r: 0.041, horizon: true },
  { name: 'altimeter', u: -0.225, v: 0.1, r: 0.041, needles: [{ key: 'alt100', len: 0.035 }, { key: 'alt1000', len: 0.022, w: 1.6 }] },
  { name: 'turn', u: -0.435, v: -0.005, r: 0.041, turn: true },
  { name: 'heading', u: -0.33, v: -0.005, r: 0.041, card: true },
  { name: 'vsi', u: -0.225, v: -0.005, r: 0.041, needles: [{ key: 'vsi', len: 0.034 }] },
  { name: 'tach', u: -0.09, v: 0.1, r: 0.041, needles: [{ key: 'tach', len: 0.035 }] },
  { name: 'manifold', u: 0.015, v: 0.1, r: 0.041, needles: [{ key: 'mp', len: 0.035 }] },
  { name: 'cht', u: 0.115, v: 0.105, r: 0.03, needles: [{ key: 'cht', len: 0.025 }] },
  { name: 'oil', u: -0.09, v: -0.005, r: 0.036, needles: [{ key: 'oilT', len: 0.021, off: -0.0121 }, { key: 'oilP', len: 0.021, off: 0.0121 }] },
  { name: 'fuel', u: 0.015, v: -0.005, r: 0.036, needles: [{ key: 'fuelL', len: 0.021, off: -0.0121 }, { key: 'fuelR', len: 0.021, off: 0.0121 }] },
  { name: 'amps', u: -0.09, v: -0.1, r: 0.028, needles: [{ key: 'amps', len: 0.023 }] },
  { name: 'flaps', u: 0.015, v: -0.1, r: 0.028, needles: [{ key: 'flaps', len: 0.023 }] },
  { name: 'clock', u: -0.53, v: -0.08, r: 0.026, needles: [{ key: 'clockH', len: 0.014, w: 1.5 }, { key: 'clockM', len: 0.021 }] },
];

export function buildCockpit(ctx) {
  const st = new GeoBuilder('hard');
  const dyn = new GeoBuilder('rig');
  const gauge = new GeoBuilder('plain');
  const gglass = new GeoBuilder('glass');
  const horizon = new GeoBuilder('plain');
  const rand = rng(ctx.seed * 61 + 9);
  const parts = []; // rigid parts: { name, index, pivot, axis, slide }
  const part = (name, pivot, axis, slide = null) => {
    const p = { name, index: parts.length + 1, pivot: pivot.clone(), axis: axis ? axis.clone().normalize() : null, slide: slide ? slide.clone() : null };
    parts.push(p);
    return p;
  };
  const anchors = {};
  const hw = DIM.cabinHalfW - 0.05;
  const floor = DIM.floorY;

  // =============================== shell ===============================
  // floor: tread plate with sand and mud
  st.setColor(0x56544e).setMat(0.6, 0.8, KIND.TREAD, 0.9);
  box(st, hw * 2, 0.02, 3.05, mat(0, floor - 0.01, 0.1 + 1.525));
  // raised floor step under the front seats and a kick plate
  st.setColor(0x3b3a36).setMat(0.55, 0.6, KIND.PAINTED, 0.8);
  box(st, hw * 2, 0.06, 0.02, mat(0, floor + 0.03, 0.62));
  // side walls: quilted padding forward of the doors and below the sills, ribs + painted skin aft
  const quilt = (x0, y0, z0, z1, y1, side) => {
    st.setColor(new THREE.Color(0x4a3b2c).multiplyScalar(0.85 + rand() * 0.2)).setMat(0.85, 0, KIND.FABRIC, 0.7);
    grid(st, Math.max(2, Math.round((z1 - z0) / 0.06)), Math.max(2, Math.round((y1 - y0) / 0.06)), (s, t, out) => {
      const z = z0 + (z1 - z0) * s, y = y0 + (y1 - y0) * t;
      const puff = Math.sin(((z - z0) / 0.12) * Math.PI) ** 2 * Math.sin(((y - y0) / 0.12) * Math.PI) ** 2;
      out.p.set(side * (x0 - 0.012 * puff), y, z);
      out.u = z; out.v = y;
    }, { flip: side < 0 });
  };
  for (const side of [-1, 1]) {
    quilt(hw, floor, 0.06, DIM.doorPilot.z0 - 0.01, 2.9, side);
    quilt(hw, floor, DIM.doorPilot.z0, DIM.doorPilot.z1, DIM.doorPilot.y0 - 0.005, side);
  }
  // aft cabin walls (painted zinc-chromate skin) with openings + exposed ribs and stringers
  const zinc = new THREE.Color(0x5f6a4a);
  for (const side of [-1, 1]) {
    const z0 = 1.38, z1 = 3.12;
    const outline = [[z0, floor], [z1, floor], [z1, 3.15], [z0, 3.18]];
    const holes = [];
    if (side > 0) holes.push([[DIM.doorCargo.z0 + 0.01, DIM.doorCargo.y0 + 0.01], [DIM.doorCargo.z1 - 0.01, DIM.doorCargo.y0 + 0.01], [DIM.doorCargo.z1 - 0.01, DIM.doorCargo.y1 - 0.01], [DIM.doorCargo.z0 + 0.01, DIM.doorCargo.y1 - 0.01]]);
    else holes.push([[DIM.winRear.z0, DIM.winRear.y0], [DIM.winRear.z1, DIM.winRear.y0], [DIM.winRear.z1, DIM.winRear.y1], [DIM.winRear.z0, DIM.winRear.y1]]);
    holes.push([[DIM.winAft.z0, DIM.winAft.y0], [DIM.winAft.z1, DIM.winAft.y0], [DIM.winAft.z1, DIM.winAft.y1], [DIM.winAft.z0, DIM.winAft.y1]]);
    st.setColor(zinc).setMat(0.7, 0.2, KIND.PAINTED, 0.7);
    const startW = st.vertexCount;
    polygon(st, outline, null, holes);
    for (let v = startW; v < st.vertexCount; v++) {
      const z = st.position[v * 3], y = st.position[v * 3 + 1];
      st.position[v * 3] = side * (hw + 0.035); st.position[v * 3 + 1] = y; st.position[v * 3 + 2] = z;
      st.normal[v * 3] = -side; st.normal[v * 3 + 1] = 0; st.normal[v * 3 + 2] = 0;
      st.attrs.uv[v * 2] = z; st.attrs.uv[v * 2 + 1] = y;
    }
    // polygon faced -x after the (z,y) swap; flip for the left wall (needs +x)
    if (side < 0) { const I = st.index; for (let q = 0; q < I.length; q += 3) if (I[q] >= startW) { const t = I[q + 1]; I[q + 1] = I[q + 2]; I[q + 2] = t; } }
    // ribs (frames) and stringers
    st.setColor(0x6a6e5a).setMat(0.55, 0.5, KIND.PAINTED, 0.6);
    for (const z of [1.4, 2.0, 2.65, 3.1]) {
      if (side > 0 && z > DIM.doorCargo.z0 && z < DIM.doorCargo.z1) continue;
      box(st, 0.035, 3.18 - floor, 0.03, mat(side * (hw + 0.012), (3.18 + floor) / 2, z));
    }
    for (const y of [2.05, 2.55]) {
      if (side > 0) box(st, 0.02, 0.03, 0.5, mat(side * (hw + 0.02), y, 2.88));
      else box(st, 0.02, 0.03, 1.7, mat(side * (hw + 0.02), y, 2.25));
    }
  }
  // aft bulkhead with a cut-out to the tail cone (dark)
  st.setColor(0x4c5440).setMat(0.75, 0.2, KIND.PAINTED, 0.8);
  polygon(st, [[-hw, floor], [hw, floor], [hw, 3.1], [-hw, 3.1]], mat(0, 0, 3.13, 0, Math.PI, 0), [[[-0.25, 2.1], [0.25, 2.1], [0.25, 2.7], [-0.25, 2.7]]]);
  st.setColor(0x050505).setMat(1, 0, KIND.RUBBER, 0);
  polygon(st, [[-0.25, 2.1], [0.25, 2.1], [0.25, 2.7], [-0.25, 2.7]], mat(0, 0, 3.2, 0, Math.PI, 0));
  // headliner with skylight openings (fabric), following the roof line
  {
    st.setColor(0x6b6152).setMat(0.9, 0, KIND.FABRIC, 0.5);
    const zs = [0.42, 0.62, 0.95, 1.4, 1.9, 2.4, 2.9, 3.12];
    const xs = [-hw, -0.575, -0.085, 0.085, 0.575, hw];
    grid(st, 0, 0, (s, t, out, i, j) => {
      const z = zs[i], x = xs[j];
      out.p.set(x, roofY(Math.max(z, 0.62)) - 0.07 - (Math.abs(x) > 0.55 ? 0.03 : 0), z);
      out.u = z; out.v = x;
    }, { sValues: zs.map((_, i) => i), tValues: xs.map((_, j) => j), flip: true, skip: (i, j) => i === 1 && (j === 1 || j === 3) });
    // headliner sloping down to the windscreen top frame
  }
  // ============================ instrument panel ============================
  {
    const ph = PANEL.h, pw = PANEL.w;
    const holes = [];
    for (const gdef of GAUGE_LAYOUT) {
      const r = gdef.r + 0.004, n = 20;
      const hole = [];
      for (let k = 0; k < n; k++) { const a = (-k / n) * Math.PI * 2; hole.push([gdef.u + Math.cos(a) * r, gdef.v + Math.sin(a) * r]); }
      holes.push(hole);
    }
    // radio stack opening
    holes.push([[0.24, -0.06], [0.24, 0.12], [0.44, 0.12], [0.44, -0.06]]);
    st.setColor(0x1c1d1a).setMat(0.55, 0.35, KIND.PAINTED, 0.75);
    const startP = st.vertexCount;
    polygon(st, [[-pw / 2, -ph / 2], [pw / 2, -ph / 2], [pw / 2, ph / 2], [-pw / 2, ph / 2]], null, holes);
    st.transform(startP, panelMat(0, 0, 0));
    // panel thickness edges + back box
    st.setColor(0x151614).setMat(0.6, 0.3, KIND.PAINTED, 0.6);
    box(st, pw, 0.02, 0.06, panelMat(0, ph / 2, -0.03).multiply(mat(0, 0, 0)));
    box(st, pw, 0.02, 0.06, panelMat(0, -ph / 2, -0.03));
    // gauge bezels, cans and screws (some missing)
    for (const gdef of GAUGE_LAYOUT) {
      const m = panelMat(gdef.u, gdef.v, 0);
      st.setColor(0x0e0e0d).setMat(0.45, 0.4, KIND.PAINTED, 0.5);
      lathe(st, [[gdef.r + 0.006, 0.0], [gdef.r + 0.008, 0.004], [gdef.r + 0.002, 0.007], [gdef.r - 0.001, 0.004]], 24, m);
      lathe(st, [[gdef.r + 0.002, -0.045], [gdef.r + 0.002, -0.003]], 16, m, { flip: true });
      st.setColor(0x8c877b).setMat(0.4, 1, KIND.METAL, 0.6);
      for (let k = 0; k < 4; k++) {
        if (rand() < 0.12) continue;
        const a = Math.PI / 4 + (k * Math.PI) / 2;
        const sr = gdef.r + 0.013;
        lathe(st, [[0.0045, 0.0], [0.004, 0.0018], [0.001, 0.0022]], 6, panelMat(gdef.u + Math.cos(a) * sr, gdef.v + Math.sin(a) * sr, 0.0005));
      }
    }
    // taped-up crack in the panel (dark crack line + grey tape)
    st.setColor(0x050505).setMat(0.9, 0, KIND.RUBBER, 0);
    box(st, 0.004, 0.09, 0.002, panelMat(-0.6, -0.17, 0.001).multiply(mat(0, 0, 0, 0, 0, 0.4)));
    st.setColor(0x8a877c).setMat(0.85, 0, KIND.FABRIC, 0.6);
    box(st, 0.05, 0.11, 0.0015, panelMat(-0.598, -0.17, 0.0025).multiply(mat(0, 0, 0, 0, 0, 0.35)));
    // glareshield (padded hood) over the panel top
    st.setColor(0x221d18).setMat(0.85, 0, KIND.LEATHER, 0.6);
    grid(st, 12, 4, (s, t, out) => {
      const x = (s - 0.5) * (pw + 0.02);
      const a = t * Math.PI * 0.55;
      out.p.set(x, 2.86 + Math.sin(a) * 0.06, 0.4 - (1 - Math.cos(a)) * 0.16 - t * 0.04);
      out.u = x; out.v = t * 0.3;
    });
    // wet compass on the glareshield centre
    st.setColor(0x151515).setMat(0.4, 0.2, KIND.PLASTIC, 0.4);
    roundedBox(st, 0.075, 0.06, 0.07, 0.012, mat(0, 2.965, 0.27));
    box(st, 0.02, 0.045, 0.02, mat(0, 2.925, 0.28));
    anchors.compass = v3(0, 2.968, 0.27);
    // rear-view mirror on the windscreen centre post with the talisman
    st.setColor(0x2b2b28).setMat(0.4, 0.6, KIND.METAL, 0.4);
    box(st, 0.012, 0.012, 0.08, mat(0, 3.2, 0.42, 0.6, 0, 0));
    st.setColor(0xa9b0b2).setMat(0.05, 1, KIND.CHROME, 0.1);
    roundedBox(st, 0.16, 0.055, 0.015, 0.01, mat(0, 3.16, 0.46, 0.3, 0, 0));
    anchors.mirror = v3(0, 3.13, 0.47);
  }
  // radio stack faceplates (gauge atlas 'radio') + knobs
  {
    for (const [v, off] of [[0.075, 0], [-0.015, 0.5]]) {
      const m = panelMat(0.34, v, -0.004);
      const r = gaugeRect('radio');
      const st0 = gauge.vertexCount;
      gauge.setRig(0);
      grid(gauge, 1, 1, (s, t, out) => {
        out.p.set((s - 0.5) * 0.19, (t - 0.5) * 0.085, 0);
        out.u = r[0] + (r[2] - r[0]) * (0.05 + s * 0.9); out.v = r[1] + (r[3] - r[1]) * (0.3 + t * 0.4 + off * 0.0);
      }, { flip: false });
      gauge.transform(st0, m);
      st.setColor(0x111111).setMat(0.5, 0.3, KIND.PLASTIC, 0.4);
      for (const ku of [-0.075, 0.075]) lathe(st, [[0.009, 0], [0.009, 0.012], [0.006, 0.016], [0.001, 0.017]], 10, panelMat(0.34 + ku, v - 0.03, 0));
    }
    anchors.radioGlow = panelPoint(0.34, 0.03, 0.01);
  }
  // gauge faces + needles + glass
  const needleParts = {};
  for (const gdef of GAUGE_LAYOUT) {
    const r = gaugeRect(gdef.name);
    const m = panelMat(gdef.u, gdef.v, -0.009);
    if (!gdef.horizon && !gdef.card) {
      const s0 = gauge.vertexCount;
      gauge.setRig(0);
      polygonDisc(gauge, gdef.r, 28, r);
      gauge.transform(s0, m);
    }
    if (gdef.horizon) {
      // horizon card disc (own texture, transformed at runtime) behind the fixed mask ring
      const s0 = horizon.vertexCount;
      polygonDisc(horizon, gdef.r, 32, [0, 0, 1, 1], true);
      horizon.transform(s0, panelMat(gdef.u, gdef.v, -0.012));
      const s1 = gauge.vertexCount;
      gauge.setRig(0);
      polygonDisc(gauge, gdef.r, 32, r);
      gauge.transform(s1, panelMat(gdef.u, gdef.v, -0.008));
      // fixed airplane symbol (orange)
      st.setColor(0xf0a020).setMat(0.4, 0, KIND.LAMP, 5 / 8);
      box(st, 0.03, 0.003, 0.002, panelMat(gdef.u, gdef.v - 0.002, -0.004));
      box(st, 0.004, 0.004, 0.003, panelMat(gdef.u, gdef.v - 0.002, -0.003));
      anchors.attitude = { u: gdef.u, v: gdef.v, r: gdef.r };
    }
    if (gdef.card) {
      // rotating heading card (rig part in the gauge mesh) + fixed lubber line
      const pr = part('headingCard', panelPoint(gdef.u, gdef.v, -0.009), P_N);
      const s0 = gauge.vertexCount;
      gauge.setRig(pr.index);
      polygonDisc(gauge, gdef.r, 32, r);
      gauge.transform(s0, m);
      gauge.setRig(0);
      st.setColor(0xf0a020).setMat(0.4, 0, KIND.LAMP, 5 / 8);
      box(st, 0.003, 0.012, 0.002, panelMat(gdef.u, gdef.v + gdef.r - 0.008, -0.005));
      box(st, 0.012, 0.003, 0.002, panelMat(gdef.u, gdef.v, -0.005));
    }
    if (gdef.turn) {
      // turn coordinator airplane + slip ball
      const pa = part('turnPlane', panelPoint(gdef.u, gdef.v, -0.006), P_N);
      dyn.setRig(pa.index).setColor(0xeeeae0).setMat(0.4, 0, KIND.LAMP, 5 / 8);
      box(dyn, 0.05, 0.004, 0.002, panelMat(gdef.u, gdef.v, -0.005));
      box(dyn, 0.005, 0.016, 0.002, panelMat(gdef.u, gdef.v + 0.004, -0.005));
      const pb = part('slipBall', panelPoint(gdef.u, gdef.v - gdef.r * 0.62, -0.006), null, P_RIGHT);
      dyn.setRig(pb.index).setColor(0x111111).setMat(0.3, 0, KIND.PLASTIC, 0);
      dyn.append(new THREE.SphereGeometry(0.0045, 8, 6), panelMat(gdef.u, gdef.v - gdef.r * 0.62, -0.005));
      dyn.setRig(0);
    }
    // needles
    for (const nd of gdef.needles || []) {
      const pivot = panelPoint(gdef.u + (nd.off || 0), gdef.v, -0.005);
      const pn = part('needle.' + nd.key, pivot, P_N);
      needleParts[nd.key] = pn;
      dyn.setRig(pn.index).setColor(nd.key.startsWith('clockH') ? 0xe6e1d0 : 0xf2eee2).setMat(0.4, 0, KIND.LAMP, 5 / 8);
      const w = 0.0016 * (nd.w || 1);
      const m2 = panelMat(gdef.u + (nd.off || 0), gdef.v, -0.005);
      const s0 = dyn.vertexCount;
      polygon(dyn, [[-w, -0.006], [w, -0.006], [w * 0.4, nd.len], [-w * 0.4, nd.len]], null);
      dyn.transform(s0, m2);
      dyn.setColor(0x111111).setMat(0.5, 0, KIND.PLASTIC, 0);
      lathe(dyn, [[0.0035, 0], [0.0035, 0.002], [0.001, 0.003]], 8, m2);
      dyn.setRig(0);
    }
    // glass
    gglass.set('aGlass', 20 + GAUGE_LAYOUT.indexOf(gdef), 0, 0.5, 0);
    const s2 = gglass.vertexCount;
    polygonDisc(gglass, gdef.r + 0.003, 20, [0, 0, 1, 1]);
    gglass.transform(s2, panelMat(gdef.u, gdef.v, 0.002));
  }
  anchors.needles = needleParts;
  // compass card drum (rigged in the gauge mesh)
  {
    const pc = part('compassCard', anchors.compass.clone(), v3(0, 1, 0));
    const r = gaugeRect('compass');
    gauge.setRig(pc.index);
    const s0 = gauge.vertexCount;
    grid(gauge, 24, 1, (s, t, out) => {
      const a = s * Math.PI * 2;
      out.p.set(Math.sin(a) * 0.026, (t - 0.5) * 0.022, Math.cos(a) * 0.026);
      out.u = r[0] + (r[2] - r[0]) * (1 - s); out.v = r[1] + (r[3] - r[1]) * (0.3 + t * 0.5);
    });
    gauge.transform(s0, mat(anchors.compass.x, anchors.compass.y, anchors.compass.z));
    gauge.setRig(0);
    gglass.set('aGlass', 40, 0, 0.6, 0);
    const s1 = gglass.vertexCount;
    polygonDisc(gglass, 0.026, 16, [0, 0, 1, 1]);
    gglass.transform(s1, mat(anchors.compass.x, anchors.compass.y, anchors.compass.z + 0.036));
  }
  // stall warning light and annunciators
  st.setColor(0xd2261a).setMat(0.2, 0, KIND.LAMP, 3 / 8); // lamp 3: stall warning
  lathe(st, [[0.0, 0.012], [0.008, 0.01], [0.009, 0.0]], 10, panelMat(-0.16, 0.2, 0.0));
  anchors.stallLight = panelPoint(-0.16, 0.2, 0.01);
  st.setColor(0xd8a520).setMat(0.2, 0, KIND.LAMP, 4 / 8); // lamp 4: low fuel / volts
  lathe(st, [[0.0, 0.01], [0.006, 0.008], [0.007, 0.0]], 10, panelMat(-0.13, 0.2, 0.0));

  // ============================ switches & small controls ============================
  const swDefs = [['master', -0.56, -0.17], ['nav', -0.38, -0.2], ['landing', -0.34, -0.2], ['panel', -0.3, -0.2], ['pump', -0.26, -0.2], ['avionics', 0.2, -0.17]];
  const switches = {};
  for (const [name, u, v] of swDefs) {
    st.setColor(0x9c978b).setMat(0.35, 1, KIND.METAL, 0.4);
    lathe(st, [[0.007, 0], [0.007, 0.004], [0.004, 0.006]], 8, panelMat(u, v, 0));
    const pv = panelPoint(u, v, 0.005);
    const ps = part('switch.' + name, pv, P_RIGHT);
    dyn.setRig(ps.index).setColor(0xc8c4b8).setMat(0.3, 1, KIND.CHROME, 0.3);
    tube(dyn, [pv.clone(), pv.clone().addScaledVector(P_N, 0.022)], (f) => 0.0022 - f * 0.0008, { sides: 6 });
    dyn.setRig(0);
    switches[name] = ps;
  }
  // magneto key
  {
    st.setColor(0x7c776c).setMat(0.4, 1, KIND.METAL, 0.5);
    lathe(st, [[0.012, 0], [0.012, 0.006], [0.008, 0.008]], 12, panelMat(-0.53, -0.17, 0));
    const pk = part('magKey', panelPoint(-0.53, -0.17, 0.008), P_N);
    dyn.setRig(pk.index).setColor(0xb9a76a).setMat(0.3, 1, KIND.METAL, 0.3);
    box(dyn, 0.016, 0.025, 0.004, panelMat(-0.53, -0.165, 0.016));
    // key ring + tag dangling (wobble)
    dyn.setColor(0x9a968a).setMat(0.3, 1, KIND.METAL, 0.3);
    dyn.append(new THREE.TorusGeometry(0.009, 0.0012, 4, 12), panelMat(-0.53, -0.185, 0.02));
    dyn.setColor(0x8a1d14).setMat(0.7, 0, KIND.PLASTIC, 0.4);
    roundedBox(dyn, 0.022, 0.035, 0.003, 0.004, panelMat(-0.53, -0.21, 0.022));
    dyn.setRig(0);
    anchors.magKey = pk;
  }
  // circuit breakers
  st.setColor(0x101010).setMat(0.5, 0.1, KIND.PLASTIC, 0.3);
  for (let i = 0; i < 9; i++) lathe(st, [[0.005, 0], [0.005, 0.007], [0.003, 0.009]], 8, panelMat(0.27 + i * 0.022, -0.2, 0));
  // primer & carb heat knobs
  st.setColor(0x222222).setMat(0.5, 0.2, KIND.PLASTIC, 0.3);
  for (const u of [-0.47, -0.43]) lathe(st, [[0.003, 0], [0.003, 0.02], [0.009, 0.024], [0.009, 0.03], [0.001, 0.032]], 10, panelMat(u, -0.22, 0));

  // ============================ yokes ============================
  const yokeParts = [];
  for (const side of [-1, 1]) {
    const x = side * 0.33;
    const base = panelPoint(x, -0.13, 0);
    const z1 = 0.7;
    const pivot = v3(x, base.y, z1);
    const py = part('yoke' + (side < 0 ? 'L' : 'R'), pivot, v3(0, 0, 1), v3(0, 0, 1));
    dyn.setRig(py.index);
    dyn.setColor(0x2c2c2a).setMat(0.4, 0.8, KIND.METAL, 0.5);
    tube(dyn, [v3(x, base.y, base.z - 0.05), v3(x, base.y, z1 - 0.02)], 0.016, { sides: 10 });
    // ram's horn wheel
    dyn.setColor(0x161616).setMat(0.55, 0.1, KIND.PLASTIC, 0.6);
    roundedBox(dyn, 0.07, 0.05, 0.05, 0.015, mat(x, base.y, z1));
    const horn = (sx) => {
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        pts.push(v3(x + sx * (0.03 + 0.12 * Math.sin(t * Math.PI * 0.55)), base.y + 0.02 + 0.08 * Math.sin(t * Math.PI * 0.9) - t * 0.02, z1 + 0.01 + t * 0.015));
      }
      tube(dyn, pts, (f) => 0.012 + 0.004 * Math.sin(f * Math.PI), { sides: 8, caps: true });
    };
    horn(-1); horn(1);
    // worn grip tape on the left horn
    dyn.setColor(0x6d6355).setMat(0.85, 0, KIND.FABRIC, 0.8);
    tube(dyn, [v3(x - 0.135, base.y + 0.06, z1 + 0.018), v3(x - 0.15, base.y + 0.095, z1 + 0.02)], 0.0145, { sides: 8 });
    dyn.setRig(0);
    yokeParts.push(py);
    anchors['yokeGrip' + (side < 0 ? 'L' : 'R')] = [v3(x - 0.14, base.y + 0.08, z1 + 0.02), v3(x + 0.14, base.y + 0.08, z1 + 0.02)];
  }
  // ============================ pedals ============================
  const pedals = [];
  for (const seat of [-1, 1]) for (const side of [-1, 1]) {
    const x = seat * 0.33 + side * 0.085;
    const pivot = v3(x, floor + 0.04, 0.34);
    const pp = part('pedal' + (seat < 0 ? 'L' : 'R') + (side < 0 ? 'l' : 'r'), pivot, v3(1, 0, 0));
    dyn.setRig(pp.index).setColor(0x3a3a36).setMat(0.45, 0.8, KIND.METAL, 0.8);
    tube(dyn, [pivot.clone(), v3(x, floor + 0.18, 0.27)], 0.008, { sides: 6 });
    dyn.setColor(0x5c5a54).setMat(0.6, 0.8, KIND.TREAD, 0.9);
    roundedBox(dyn, 0.07, 0.12, 0.015, 0.005, mat(x, floor + 0.2, 0.27, -0.45, 0, 0));
    dyn.setRig(0);
    pedals.push(pp);
  }
  // ============================ throttle quadrant & pedestal ============================
  const levers = {};
  {
    st.setColor(0x1e1f1c).setMat(0.55, 0.3, KIND.PAINTED, 0.7);
    // pedestal from below the panel to the floor
    const s0 = st.vertexCount;
    polygon(st, [[0.39, 2.33], [0.48, 2.33], [0.78, floor], [0.39, floor]], null);
    for (let v = s0; v < st.vertexCount; v++) { const zz = st.position[v * 3], yy = st.position[v * 3 + 1]; st.position[v * 3] = -0.06; st.position[v * 3 + 1] = yy; st.position[v * 3 + 2] = zz; st.normal[v * 3] = -1; st.normal[v * 3 + 1] = 0; st.normal[v * 3 + 2] = 0; }
    st.mirrorX(s0);
    box(st, 0.12, 0.02, 0.1, mat(0, 2.33, 0.435));
    grid(st, 1, 6, (s, t, out) => {
      const z = 0.48 + t * 0.3, y = 2.33 - t * (2.33 - floor);
      out.p.set((s - 0.5) * 0.12, y, z); out.u = s; out.v = t;
    }, { flip: true });
    const defs = [['throttle', -0.035, 0x111111], ['prop', 0, 0x1f3f8c], ['mixture', 0.035, 0x9c1b12]];
    for (const [name, x, col] of defs) {
      const pivot = v3(x, 2.29, 0.5);
      const pl = part('lever.' + name, pivot, v3(1, 0, 0));
      dyn.setRig(pl.index).setColor(0x9a968b).setMat(0.35, 1, KIND.METAL, 0.4);
      tube(dyn, [pivot.clone(), v3(x, 2.37, 0.47)], 0.0055, { sides: 6 });
      dyn.setColor(col).setMat(0.35, 0.1, KIND.PLASTIC, 0.3);
      if (name === 'throttle') dyn.append(new THREE.SphereGeometry(0.017, 12, 8), mat(x, 2.385, 0.468));
      else roundedBox(dyn, 0.022, 0.03, 0.022, 0.008, mat(x, 2.385, 0.468));
      dyn.setRig(0);
      levers[name] = pl;
    }
    anchors.throttleKnob = v3(-0.035, 2.39, 0.47);
    // trim wheel on the pedestal side
    const tp = part('trimWheel', v3(-0.065, 2.0, 0.66), v3(1, 0, 0));
    dyn.setRig(tp.index).setColor(0x1a1a18).setMat(0.5, 0.2, KIND.PLASTIC, 0.6);
    lathe(dyn, [[0.06, -0.008], [0.065, 0.0], [0.06, 0.008]], 20, mat(-0.068, 2.0, 0.66, 0, Math.PI / 2, 0));
    for (let k = 0; k < 18; k++) { const a = (k / 18) * Math.PI * 2; box(dyn, 0.012, 0.004, 0.008, mat(-0.068, 2.0 + Math.sin(a) * 0.066, 0.66 + Math.cos(a) * 0.066, a, 0, 0)); }
    dyn.setRig(0);
    levers.trimWheel = tp;
  }
  // flap lever (Johnson bar) between the seats
  {
    const pivot = v3(-0.08, floor + 0.04, 1.42);
    const pf = part('flapLever', pivot, v3(1, 0, 0));
    st.setColor(0x2b2a26).setMat(0.5, 0.7, KIND.METAL, 0.8);
    box(st, 0.05, 0.05, 0.14, mat(-0.08, floor + 0.025, 1.4));
    dyn.setRig(pf.index).setColor(0x3e3d38).setMat(0.4, 0.9, KIND.METAL, 0.7);
    tube(dyn, [pivot.clone(), v3(-0.08, floor + 0.07, 1.1)], 0.011, { sides: 8 });
    dyn.setColor(0x151515).setMat(0.6, 0, KIND.RUBBER, 0.6);
    tube(dyn, [v3(-0.08, floor + 0.068, 1.16), v3(-0.08, floor + 0.075, 1.06)], 0.016, { sides: 8, caps: true });
    dyn.setRig(0);
    levers.flap = pf;
    anchors.flapHandle = v3(-0.08, floor + 0.075, 1.1);
  }
  // water rudder handle (floor, left of the pilot seat) and fuel selector (floor centre)
  {
    const pw = part('waterRudderHandle', v3(-0.55, floor + 0.05, 0.85), null, v3(0, 1, 0));
    st.setColor(0x2a2925).setMat(0.5, 0.7, KIND.METAL, 0.8);
    tube(st, [v3(-0.55, floor, 0.85), v3(-0.55, floor + 0.07, 0.85)], 0.012, { sides: 8 });
    dyn.setRig(pw.index).setColor(0xc89a1c).setMat(0.5, 0.2, KIND.PAINTED, 0.7);
    tube(dyn, [v3(-0.55, floor + 0.07, 0.85), v3(-0.55, floor + 0.13, 0.85)], 0.006, { sides: 6 });
    tube(dyn, [v3(-0.55, floor + 0.13, 0.8), v3(-0.55, floor + 0.13, 0.9)], 0.01, { sides: 8, caps: true });
    dyn.setRig(0);
    levers.waterRudder = pw;
    const pfs = part('fuelSelector', v3(0, floor + 0.02, 0.86), v3(0, 1, 0));
    st.setColor(0x6b6a60).setMat(0.45, 0.8, KIND.METAL, 0.6);
    lathe(st, [[0.06, 0], [0.06, 0.01], [0.001, 0.012]], 16, mat(0, floor, 0.86, -Math.PI / 2, 0, 0));
    dyn.setRig(pfs.index).setColor(0x9c1b12).setMat(0.45, 0.1, KIND.PLASTIC, 0.5);
    roundedBox(dyn, 0.022, 0.03, 0.11, 0.008, mat(0, floor + 0.03, 0.86));
    dyn.setRig(0);
    levers.fuelSelector = pfs;
  }

  // ============================ seats ============================
  const leather = [0x6b3f22, 0x7a4a28, 0x5c341c];
  const seat = (x, z, w, recline, color) => {
    // frame
    st.setColor(0x2a2a27).setMat(0.45, 0.8, KIND.METAL, 0.7);
    for (const sx of [-1, 1]) {
      tube(st, [v3(x + sx * w * 0.42, floor, z - 0.2), v3(x + sx * w * 0.42, floor + 0.36, z - 0.18)], 0.012, { sides: 6 });
      tube(st, [v3(x + sx * w * 0.42, floor, z + 0.2), v3(x + sx * w * 0.42, floor + 0.36, z + 0.18)], 0.012, { sides: 6 });
    }
    // cushion with tufted channels
    const cushion = (cx, cy, cz, sw, sd, sh, rx) => {
      st.setColor(new THREE.Color(color).multiplyScalar(0.9 + rand() * 0.2)).setMat(0.55, 0, KIND.LEATHER, 0.6 + rand() * 0.3);
      const s0 = st.vertexCount;
      roundedBox(st, sw, sh, sd, 0.045, null, 3);
      const P = st.position;
      for (let v = s0; v < st.vertexCount; v++) {
        const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
        // tufted channels along the depth, bulging top
        const ch = Math.cos((px / sw) * Math.PI * 5);
        if (py > sh * 0.3) P[v * 3 + 1] += (0.012 * (1 - (px / (sw / 2)) ** 2) - 0.006 * Math.max(ch, 0) ** 8) * (1 - Math.abs(pz / (sd / 2)) ** 4);
        // sag & creases
        P[v * 3 + 1] -= 0.008 * Math.exp(-((px / 0.12) ** 2 + (pz / 0.14) ** 2)) * (py > 0 ? 1 : 0);
      }
      st.transform(s0, mat(cx, cy, cz, rx, 0, 0));
    };
    cushion(x, floor + 0.42, z, w, 0.46, 0.12, 0);
    const backH = 0.62;
    cushion(x, floor + 0.47 + backH / 2 * Math.cos(recline), z + 0.25 + Math.sin(recline) * backH / 2, w, backH, 0.11, recline - Math.PI / 2);
    // seam stitching (thin light lines across the back)
    st.setColor(0xb39a72).setMat(0.8, 0, KIND.FABRIC, 0.6);
    for (const k of [-0.3, 0.3]) box(st, 0.002, 0.004, backH * 0.9, mat(x + k * w, floor + 0.47 + backH / 2 * Math.cos(recline), z + 0.25 + Math.sin(recline) * backH / 2 - 0.057, recline - Math.PI / 2 + Math.PI / 2, 0, 0));
  };
  seat(-0.33, 1.24, 0.46, 0.2, leather[0]);
  seat(0.33, 1.24, 0.46, 0.18, leather[1]);
  // rear bench
  {
    const z = 2.18;
    st.setColor(0x2a2a27).setMat(0.45, 0.8, KIND.METAL, 0.7);
    for (const sx of [-0.5, 0, 0.5]) tube(st, [v3(sx, floor, z), v3(sx, floor + 0.36, z)], 0.012, { sides: 6 });
    st.setColor(leather[2]).setMat(0.6, 0, KIND.LEATHER, 0.85);
    roundedBox(st, 1.15, 0.12, 0.45, 0.04, mat(0, floor + 0.42, z), 3);
    roundedBox(st, 1.15, 0.6, 0.11, 0.04, mat(0, floor + 0.78, z + 0.27, -0.16, 0, 0), 3);
  }
  // harnesses hanging from the cabin frame behind the front seats (wobble group 9)
  st.setColor(0x3a3424).setMat(0.85, 0, KIND.STRAP, 0.6);
  for (const x of [-0.33, 0.33]) {
    for (const dx of [-0.13, 0.13]) {
      const top = v3(x + dx * 0.4, 3.2, 1.62);
      const pts = [top, v3(x + dx * 0.8, 3.0, 1.58), v3(x + dx, 2.75, 1.5), v3(x + dx * 1.1, 2.5, 1.43), v3(x + dx * 1.2, 2.32, 1.36)];
      const s0 = st.vertexCount;
      st.setWobble(top, 9, 0);
      tube(st, pts, 0.022, { sides: 3, rx: 0.12, ry: 1, up: v3(0, 0, 1) });
      wob(st, s0, top, 9, 1.0);
      st.setWobble(null);
    }
    // lap belt buckles on the cushion
    st.setColor(0x9a968a).setMat(0.3, 1, KIND.CHROME, 0.3);
    box(st, 0.06, 0.01, 0.04, mat(x - 0.1, floor + 0.49, 1.08, 0, 0.3, 0));
    st.setColor(0x3a3424).setMat(0.85, 0, KIND.STRAP, 0.6);
    tube(st, [v3(x - 0.24, floor + 0.47, 1.3), v3(x - 0.2, floor + 0.49, 1.15), v3(x - 0.12, floor + 0.495, 1.08)], 0.02, { sides: 3, rx: 0.12, up: v3(0, 1, 0) });
  }

  // ============================ props ============================
  // fire extinguisher by the pilot seat
  st.setColor(0xb0231a).setMat(0.35, 0.2, KIND.PAINTED, 0.5);
  lathe(st, [[0.001, 0], [0.055, 0], [0.06, 0.02], [0.06, 0.34], [0.045, 0.38], [0.02, 0.4], [0.001, 0.41]], 14, mat(-0.52, floor, 1.5, -Math.PI / 2, 0, 0));
  st.setColor(0x222222).setMat(0.5, 0.6, KIND.METAL, 0.5);
  box(st, 0.03, 0.04, 0.08, mat(-0.52, floor + 0.43, 1.5));
  tube(st, [v3(-0.52, floor + 0.43, 1.53), v3(-0.5, floor + 0.38, 1.6), v3(-0.49, floor + 0.2, 1.58)], 0.008, { sides: 5 });
  // map pocket with charts on the left wall forward of the door
  st.setColor(0x2c2a24).setMat(0.85, 0, KIND.CANVAS, 0.6);
  box(st, 0.02, 0.2, 0.28, mat(-hw + 0.005, 2.05, 0.22));
  st.setColor(0xd9d0b6).setMat(0.8, 0, KIND.PLASTIC, 0.4);
  for (let k = 0; k < 3; k++) box(st, 0.004, 0.17, 0.22, mat(-hw + 0.022 + k * 0.004, 2.12 + k * 0.012, 0.21 + k * 0.015, 0.05 * k, 0, 0.04 * k));
  // handheld radio on the glareshield (right)
  st.setColor(0x1b1c1a).setMat(0.6, 0.1, KIND.PLASTIC, 0.6);
  roundedBox(st, 0.06, 0.03, 0.14, 0.01, mat(0.42, 2.93, 0.3, 0, 0.4, 0));
  st.setColor(0x111111).setMat(0.6, 0.1, KIND.RUBBER, 0.4);
  tube(st, [v3(0.4, 2.95, 0.24), v3(0.39, 3.08, 0.22)], 0.006, { sides: 5 });
  // map light on the ceiling
  st.setColor(0x2b2b28).setMat(0.4, 0.7, KIND.METAL, 0.5);
  lathe(st, [[0.001, 0], [0.025, 0], [0.03, -0.04], [0.02, -0.06]], 10, mat(-0.12, roofY(1.0) - 0.07, 1.0, Math.PI / 2, 0, 0));
  st.setColor(0xf5e7c0).setMat(0.1, 0, KIND.LAMP, 7 / 8);
  lathe(st, [[0.001, -0.06], [0.019, -0.06]], 10, mat(-0.12, roofY(1.0) - 0.07, 1.0, Math.PI / 2, 0, 0));
  anchors.mapLight = v3(-0.12, roofY(1.0) - 0.14, 1.0);
  // headset on a hook (wobble group 10)
  {
    const hook = v3(-hw + 0.02, 2.95, 1.62);
    st.setColor(0x2b2b28).setMat(0.4, 0.8, KIND.METAL, 0.5);
    tube(st, [hook.clone().add(v3(-0.02, 0, 0)), hook.clone().add(v3(0.03, 0.0, 0)), hook.clone().add(v3(0.035, 0.02, 0))], 0.004, { sides: 4 });
    const s0 = st.vertexCount;
    st.setColor(0x1d3a5c).setMat(0.5, 0.1, KIND.PLASTIC, 0.5);
    const band = [];
    for (let k = 0; k <= 10; k++) { const a = Math.PI * (k / 10); band.push(v3(hook.x + 0.03, hook.y - 0.02 - Math.sin(a) * 0.0 - (1 - Math.sin(a)) * 0.1, hook.z - Math.cos(a) * 0.09)); }
    tube(st, band, 0.007, { sides: 5 });
    st.setColor(0x151515).setMat(0.6, 0, KIND.LEATHER, 0.5);
    for (const dz of [-0.09, 0.09]) { const c = v3(hook.x + 0.035, hook.y - 0.12, hook.z + dz); st.append(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 14), mat(c.x, c.y, c.z, 0, 0, Math.PI / 2)); }
    st.setColor(0x0f0f0f).setMat(0.6, 0, KIND.RUBBER, 0.4);
    tube(st, [v3(hook.x + 0.04, hook.y - 0.16, hook.z + 0.09), v3(hook.x + 0.08, hook.y - 0.35, hook.z + 0.05), v3(hook.x + 0.1, hook.y - 0.5, hook.z - 0.08), v3(hook.x + 0.15, 2.38, hook.z - 0.3)], 0.004, { sides: 4 });
    wob(st, s0, hook, 10, 0.4);
  }
  // talisman hanging from the mirror: string + carved tiki/feather + beads (wobble group 11)
  {
    const top = anchors.mirror.clone();
    const s0 = st.vertexCount;
    st.setColor(0x3b2a1a).setMat(0.9, 0, KIND.ROPE, 0.4);
    tube(st, [top, top.clone().add(v3(0, -0.09, 0.0)), top.clone().add(v3(0, -0.13, 0.0))], 0.0015, { sides: 3 });
    st.setColor(0x6a4a2a).setMat(0.7, 0, KIND.WOOD, 0.4);
    roundedBox(st, 0.022, 0.04, 0.012, 0.006, mat(top.x, top.y - 0.155, top.z));
    st.setColor(0xb23a1e).setMat(0.4, 0, KIND.PLASTIC, 0.2);
    st.append(new THREE.SphereGeometry(0.006, 8, 6), mat(top.x, top.y - 0.1, top.z));
    st.setColor(0xe6dcc2).setMat(0.8, 0, KIND.FABRIC, 0.4);
    box(st, 0.004, 0.06, 0.012, mat(top.x + 0.008, top.y - 0.2, top.z, 0, 0, 0.25));
    wob(st, s0, top, 11, 0.22);
  }
  // cargo behind the rear bench: duffels, crates, green jerrycan, cargo net
  {
    const s0 = st.vertexCount;
    st.setColor(0x4b4f31).setMat(0.92, 0, KIND.CANVAS, 0.6);
    lathe(st, [[0.001, -0.4], [0.12, -0.37], [0.16, -0.25], [0.16, 0.25], [0.12, 0.37], [0.001, 0.4]], 12, mat(-0.25, floor + 0.15, 2.75, 0, Math.PI / 2, 0));
    st.setColor(0x585b38).setMat(0.92, 0, KIND.CANVAS, 0.6);
    lathe(st, [[0.001, -0.35], [0.1, -0.33], [0.13, -0.2], [0.13, 0.2], [0.1, 0.33], [0.001, 0.35]], 12, mat(-0.2, floor + 0.42, 2.8, 0.1, Math.PI / 2, 0));
    st.setColor(0x6a5640).setMat(0.85, 0, KIND.WOOD, 0.7);
    box(st, 0.42, 0.36, 0.38, mat(0.3, floor + 0.18, 2.78, 0, 0.1, 0));
    box(st, 0.36, 0.26, 0.3, mat(0.28, floor + 0.49, 2.8, 0, -0.08, 0));
    st.setColor(0x4a5530).setMat(0.55, 0.3, KIND.PAINTED, 0.6);
    roundedBox(st, 0.17, 0.44, 0.34, 0.02, mat(0.0, floor + 0.22, 2.95, 0, Math.PI / 2, 0));
    st.setColor(0x7c6b4c).setMat(0.92, 0, KIND.ROPE, 0.6);
    // cargo net: rope grid draped over the load
    const netAt = (u, w) => v3(-0.5 + u * 1.0, floor + 0.62 - Math.abs(u - 0.5) * 0.2 - (w - 0.5) ** 2 * 0.3, 2.5 + w * 0.55);
    for (let i = 0; i <= 6; i++) { const pts = []; for (let k = 0; k <= 6; k++) pts.push(netAt(i / 6, k / 6)); tube(st, pts, 0.004, { sides: 3 }); }
    for (let k = 0; k <= 6; k++) { const pts = []; for (let i = 0; i <= 6; i++) pts.push(netAt(i / 6, k / 6)); tube(st, pts, 0.004, { sides: 3 }); }
    void s0;
  }
  // seats, hand and eye anchors
  anchors.eyePilot = DIM.eyePilot.clone();
  anchors.eyeCopilot = DIM.eyeCopilot.clone();
  anchors.throttleHand = v3(-0.035, 2.38, 0.47);
  return { st, dyn, gauge, gglass, horizon, parts, anchors, switches, levers, yokeParts, pedals, needleParts };
}

// flat disc facing +z with atlas uvs (rect = [u0, v0, u1, v1])
function polygonDisc(b, r, n, rect, flipV = false) {
  const start = b.vertexCount;
  const cu = (rect[0] + rect[2]) / 2, cv = (rect[1] + rect[3]) / 2, su = (rect[2] - rect[0]) / 2, sv = (rect[3] - rect[1]) / 2;
  b.vert(0, 0, 0, 0, 0, 1, cu, cv);
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI * 2;
    b.vert(Math.cos(a) * r, Math.sin(a) * r, 0, 0, 0, 1, cu + Math.cos(a) * su * 0.98, cv + Math.sin(a) * sv * 0.98 * (flipV ? 1 : 1));
  }
  for (let k = 0; k < n; k++) b.tri(start, start + 1 + k, start + 2 + k);
  return start;
}

function wob(b, start, pivot, group, reach) {
  const W = b.attrs.aWob, P = b.position;
  for (let v = start; v < b.vertexCount; v++) {
    const d = Math.hypot(P[v * 3] - pivot.x, P[v * 3 + 1] - pivot.y, P[v * 3 + 2] - pivot.z);
    W[v * 4] = pivot.x; W[v * 4 + 1] = pivot.y; W[v * 4 + 2] = pivot.z; W[v * 4 + 3] = group + Math.min(d / reach, 0.999);
  }
}
