// Nine-cylinder radial with the top cowl removed: finned cylinders, rocker
// boxes, pushrods, ignition harness, intake pipes, collector ring + exposed
// exhaust stacks, mount truss, oil tank, magnetos, carburettor, oil cooler.
import * as THREE from 'three';
import { DIM, fuselageSection } from './dims.js';
import { tube, lathe, box, roundedBox, mat, matAlong, v3, KIND } from './geom.js';

const CYL_Z = -1.36; // cylinder plane (model z)

// x of the fuselage/cowl surface at height y for a section (right side)
function sideXAt(sec, y) {
  const { hw, yb, yt, rb, rt } = sec;
  if (y > yt - rt) { const dy = y - (yt - rt); return hw - rt + Math.sqrt(Math.max(rt * rt - dy * dy, 0)); }
  if (y < yb + rb) { const dy = (yb + rb) - y; return hw - rb + Math.sqrt(Math.max(rb * rb - dy * dy, 0)); }
  return hw;
}
const AXIS_Y = DIM.thrustY;

function finProfile(r0, r1, core, fin, count, endCap) {
  // radial profile along the cylinder axis (local z = radial distance)
  const prof = [];
  if (endCap) prof.push([0.001, r0]);
  prof.push([core, r0]);
  const pitch = (r1 - r0) / count;
  for (let i = 0; i < count; i++) {
    const z = r0 + i * pitch;
    prof.push([core, z + pitch * 0.25]);
    prof.push([fin, z + pitch * 0.3]);
    prof.push([fin, z + pitch * 0.62]);
    prof.push([core, z + pitch * 0.7]);
  }
  prof.push([core, r1]);
  return prof;
}

export function buildPowerplant(ctx) {
  const { hard, lod } = ctx;
  const anchors = {};
  if (lod >= 2) {
    // distant LOD: dark disc behind the cowl ring
    hard.setColor(0x151513).setMat(0.7, 0.3, KIND.METAL, 0.5);
    lathe(hard, [[0.0, -0.01], [0.58, 0.0]], 10, mat(0, AXIS_Y, -1.5));
    anchors.exhaustR = v3(0.55, 2.58, -0.12); anchors.exhaustL = v3(-0.55, 2.58, -0.12);
    anchors.engine = v3(0, AXIS_Y, -1.0);
    return { anchors };
  }
  const seg = lod === 0 ? 10 : 6;
  const E = (x, y, z) => v3(x, AXIS_Y + y, CYL_Z + z); // engine-local helper
  // crankcase, nose case, accessory case
  hard.setColor(0x585a57).setMat(0.45, 0.75, KIND.METAL, 0.7);
  lathe(hard, [[0.001, -0.33], [0.055, -0.33], [0.06, -0.28], [0.1, -0.26], [0.16, -0.17], [0.19, -0.09], [0.215, -0.07], [0.22, 0.07], [0.205, 0.1], [0.2, 0.36], [0.16, 0.42], [0.001, 0.43]], lod === 0 ? 20 : 10, mat(0, AXIS_Y, CYL_Z));
  // cylinders
  const n = 9;
  const finsB = lod === 0 ? 10 : 4, finsH = lod === 0 ? 7 : 3;
  // LOD1: plain tapered cylinders (fins are invisible beyond 30 m)
  const headProfile = lod === 0 ? (() => {
    const p = finProfile(0.4, 0.53, 0.062, 0.088, finsH, false);
    p.push([0.055, 0.545], [0.035, 0.556], [0.001, 0.56]);
    return p;
  })() : [[0.085, 0.4], [0.085, 0.53], [0.04, 0.556], [0.001, 0.56]];
  const barrelProfile = lod === 0 ? finProfile(0.21, 0.4, 0.056, 0.073, finsB, false) : [[0.072, 0.21], [0.072, 0.4]];
  for (let k = 0; k < n; k++) {
    const th = (k / n) * Math.PI * 2;
    const dir = v3(Math.sin(th), Math.cos(th), 0);
    // matrix: local +Z along the radial dir, origin at the engine centre
    const m = matAlong(E(0, 0, 0), E(dir.x, dir.y, 0));
    hard.setColor(0x44464a).setMat(0.5, 0.7, KIND.METAL, 0.8);
    lathe(hard, barrelProfile, seg, m);
    hard.setColor(0x2f3032).setMat(0.55, 0.55, KIND.METAL, 0.7);
    lathe(hard, headProfile, seg, m);
    // rocker boxes (front & rear) on the head
    hard.setColor(0x4d4f50).setMat(0.45, 0.7, KIND.METAL, 0.6);
    if (lod === 0) for (const dz of [-0.06, 0.06]) {
      const c = E(dir.x * 0.5, dir.y * 0.5, dz);
      roundedBox(hard, 0.07, 0.07, 0.05, 0.015, new THREE.Matrix4().compose(c, new THREE.Quaternion().setFromAxisAngle(v3(0, 0, 1), -th), v3(1, 1, 1)));
    }
    if (lod === 0) {
      // pushrod tubes from the crankcase front to the rocker boxes
      hard.setColor(0x6e6f6a).setMat(0.35, 0.9, KIND.METAL, 0.5);
      for (const dz of [-0.05, 0.04]) {
        const t = v3(Math.cos(th), -Math.sin(th), 0).multiplyScalar(dz > 0 ? 0.025 : -0.025);
        tube(hard, [E(dir.x * 0.2 + t.x, dir.y * 0.2 + t.y, -0.1), E(dir.x * 0.48 + t.x, dir.y * 0.48 + t.y, dz)], 0.009, { sides: 5 });
      }
      // spark plug leads from the harness ring
      hard.setColor(0x1b1b1a).setMat(0.7, 0.1, KIND.RUBBER, 0.3);
      const hr = E(dir.x * 0.3, dir.y * 0.3, -0.13);
      tube(hard, [hr, E(dir.x * 0.38, dir.y * 0.38, -0.12), E(dir.x * 0.47, dir.y * 0.47, -0.075)], 0.006, { sides: 4 });
    }
    // intake pipe from the accessory section to the rear of the head
    hard.setColor(0x5f625e).setMat(0.45, 0.7, KIND.METAL, 0.7);
    tube(hard, [E(dir.x * 0.17, dir.y * 0.17, 0.34), E(dir.x * 0.3, dir.y * 0.3, 0.26), E(dir.x * 0.42, dir.y * 0.42, 0.09)], 0.022, { sides: lod === 0 ? 7 : 4 });
    // exhaust stub from the head to the collector ring behind the engine
    hard.setColor(0x4a3626).setMat(0.75, 0.6, KIND.RUST, 0.8);
    const tng = v3(Math.cos(th), -Math.sin(th), 0);
    tube(hard, [E(dir.x * 0.47, dir.y * 0.47, 0.07), E(dir.x * 0.5 + tng.x * 0.05, dir.y * 0.5 + tng.y * 0.05, 0.14), E(dir.x * 0.47 + tng.x * 0.08, dir.y * 0.47 + tng.y * 0.08, 0.2)], 0.03, { sides: lod === 0 ? 7 : 4 });
  }
  // ignition harness ring
  hard.setColor(0x2a2a28).setMat(0.6, 0.3, KIND.METAL, 0.5);
  hard.append(new THREE.TorusGeometry(0.3, 0.016, 6, lod === 0 ? 36 : 14), mat(0, AXIS_Y, CYL_Z - 0.13));
  // exhaust collector ring
  hard.setColor(0x4d3828).setMat(0.75, 0.6, KIND.RUST, 0.9);
  hard.append(new THREE.TorusGeometry(0.47, 0.04, lod === 0 ? 8 : 5, lod === 0 ? 40 : 16, Math.PI * 1.7), mat(0, AXIS_Y, CYL_Z + 0.21, 0, 0, Math.PI * 0.65));
  // exposed exhaust stacks: out of the collector, up through the missing top cowl,
  // aft along the upper sides just above the remaining cowl edge, ending at the firewall
  const stacks = [];
  const cowlX = (z, y) => { const sec = fuselageSection(z); return sideXAt(sec, y); };
  for (const sx of [1, -1]) {
    const pipes = [
      { y: 2.71, r: 0.064, xo: 0.0, end: 0.02, endY: 2.63 },
      { y: 2.83, r: 0.056, xo: -0.07, end: -0.04, endY: 2.78 },
      { y: 2.57, r: 0.052, xo: 0.03, end: -0.12, endY: 2.49 },
    ];
    pipes.forEach((p, i) => {
      const pts = [E(sx * 0.4, 0.28 + i * 0.03, 0.2), E(sx * 0.5, p.y - AXIS_Y - 0.04, 0.3)];
      for (const z of [-0.95, -0.7, -0.45, -0.25]) {
        const x = Math.max(cowlX(z, p.y) + p.r + 0.012 + p.xo, 0.3);
        pts.push(v3(sx * x, p.y, z));
      }
      const xe = cowlX(p.end, p.endY) + p.r + 0.015;
      pts.push(v3(sx * (xe - 0.02), (p.y + p.endY) / 2, p.end - 0.1));
      pts.push(v3(sx * xe, p.endY, p.end));
      hard.setColor(i === 0 ? 0x6a4a30 : 0x5b4634).setMat(0.45, 0.85, KIND.EXHAUST, 0.75);
      tube(hard, pts, p.r, { sides: lod === 0 ? 12 : 5 });
      // open pipe end: thin lip + sooty inside
      const tip = pts[pts.length - 1], prev = pts[pts.length - 2];
      const dir = new THREE.Vector3().subVectors(tip, prev).normalize();
      const mEnd = matAlong(tip, tip.clone().add(dir));
      hard.setColor(0x050403).setMat(0.9, 0.2, KIND.RUST, 1);
      lathe(hard, [[p.r * 0.98, 0.0], [p.r * 0.82, -0.003], [p.r * 0.8, -0.06], [0.001, -0.07]], lod === 0 ? 10 : 5, mEnd);
      stacks.push(tip.clone().addScaledVector(dir, 0.02));
      // pipe clamps
      if (lod === 0) {
        hard.setColor(0x2a2725).setMat(0.5, 0.8, KIND.METAL, 0.6);
        const c = pts[3];
        hard.append(new THREE.TorusGeometry(p.r + 0.006, 0.007, 4, 12), matAlong(c, c.clone().add(v3(0, 0, 1))));
        const c2 = pts[5];
        hard.append(new THREE.TorusGeometry(p.r + 0.006, 0.007, 4, 12), matAlong(c2, c2.clone().add(v3(0, 0, 1))));
      }
    });
  }
  anchors.exhaustR = stacks[0].clone();
  anchors.exhaustL = stacks[3].clone();
  anchors.exhaustAll = stacks;
  // engine mount truss (black steel tubes) from the mount ring to the firewall
  hard.setColor(0x1d1e1c).setMat(0.55, 0.6, KIND.PAINTED, 0.6);
  const ringZ = CYL_Z + 0.45;
  hard.append(new THREE.TorusGeometry(0.27, 0.018, 5, lod === 0 ? 24 : 10), mat(0, AXIS_Y, ringZ));
  const fwPts = [[0.5, 0.42], [-0.5, 0.42], [0.55, -0.45], [-0.55, -0.45]];
  for (const [fx, fy] of fwPts) {
    for (const a of [Math.atan2(fx, fy) - 0.45, Math.atan2(fx, fy) + 0.45]) {
      tube(hard, [v3(Math.sin(a) * 0.27, AXIS_Y + Math.cos(a) * 0.27, ringZ), v3(fx, AXIS_Y + fy, -0.02)], 0.016, { sides: 5 });
    }
  }
  // firewall (visible through the open cowl)
  hard.setColor(0x262622).setMat(0.7, 0.3, KIND.PAINTED, 0.8);
  {
    const g = new THREE.CircleGeometry(0.66, lod === 0 ? 28 : 12);
    hard.append(g, mat(0, AXIS_Y + 0.02, -0.025, 0, Math.PI, 0, 1.03, 0.98, 1));
  }
  // oil tank, magnetos, carburettor, hoses, wiring
  hard.setColor(0x3f4730).setMat(0.6, 0.2, KIND.PAINTED, 0.8);
  lathe(hard, [[0.001, 0], [0.12, 0.0], [0.135, 0.03], [0.135, 0.42], [0.12, 0.45], [0.001, 0.45]], lod === 0 ? 14 : 7, mat(0, AXIS_Y + 0.38, -0.72));
  hard.setColor(0x7c776c).setMat(0.4, 1, KIND.METAL, 0.5);
  lathe(hard, [[0, 0.04], [0.04, 0.035], [0.045, 0]], 8, mat(0, AXIS_Y + 0.52, -0.6, -Math.PI / 2, 0, 0));
  hard.setColor(0x151514).setMat(0.55, 0.3, KIND.PAINTED, 0.5);
  for (const sx of [1, -1]) lathe(hard, [[0.001, 0], [0.05, 0], [0.05, 0.15], [0.03, 0.17], [0.001, 0.17]], 10, mat(sx * 0.13, AXIS_Y + 0.12, CYL_Z + 0.43));
  hard.setColor(0x5b5850).setMat(0.45, 0.8, KIND.METAL, 0.6);
  roundedBox(hard, 0.18, 0.16, 0.2, 0.02, mat(0, AXIS_Y - 0.28, CYL_Z + 0.42));
  tube(hard, [E(0, -0.36, 0.42), E(0, -0.5, 0.45), E(0, -0.6, 0.55)], 0.06, { sides: 8 });
  if (lod === 0) {
    hard.setColor(0x15130f).setMat(0.7, 0, KIND.RUBBER, 0.6);
    tube(hard, [v3(0.08, AXIS_Y + 0.3, -0.6), v3(0.2, AXIS_Y + 0.22, -0.75), v3(0.22, AXIS_Y + 0.05, CYL_Z + 0.42)], 0.016, { sides: 6 });
    tube(hard, [v3(-0.08, AXIS_Y + 0.3, -0.6), v3(-0.25, AXIS_Y + 0.18, -0.8), v3(-0.25, AXIS_Y - 0.1, CYL_Z + 0.45)], 0.016, { sides: 6 });
    hard.setColor(0x6b1610).setMat(0.6, 0, KIND.RUBBER, 0.4);
    tube(hard, [v3(0.13, AXIS_Y + 0.2, CYL_Z + 0.6), v3(0.3, AXIS_Y + 0.35, -0.5), v3(0.35, AXIS_Y + 0.42, -0.04)], 0.007, { sides: 4 });
    tube(hard, [v3(-0.13, AXIS_Y + 0.2, CYL_Z + 0.6), v3(-0.32, AXIS_Y + 0.3, -0.45), v3(-0.36, AXIS_Y + 0.4, -0.04)], 0.007, { sides: 4 });
    hard.setColor(0x111110).setMat(0.6, 0, KIND.RUBBER, 0.4);
    tube(hard, [v3(0.1, AXIS_Y + 0.16, CYL_Z + 0.6), v3(0.15, AXIS_Y + 0.46, -0.3), v3(0.1, AXIS_Y + 0.48, -0.04)], 0.009, { sides: 4 });
    // baffles between cylinders (dark sheet)
    hard.setColor(0x1a1a19).setMat(0.6, 0.5, KIND.PAINTED, 0.7);
    for (let k = 0; k < n; k++) {
      const th = ((k + 0.5) / n) * Math.PI * 2;
      const c = E(Math.sin(th) * 0.47, Math.cos(th) * 0.47, 0.0);
      box(hard, 0.004, 0.14, 0.22, new THREE.Matrix4().compose(c, new THREE.Quaternion().setFromAxisAngle(v3(0, 0, 1), -th), v3(1, 1, 1)));
    }
  }
  // oil cooler under the nose with scoop
  hard.setColor(0x343229).setMat(0.55, 0.7, KIND.METAL, 0.8);
  roundedBox(hard, 0.34, 0.13, 0.36, 0.02, mat(0, 1.56, -1.02));
  if (lod === 0) {
    hard.setColor(0x14130f).setMat(0.7, 0.6, KIND.METAL, 0.5);
    for (let i = 0; i < 9; i++) box(hard, 0.003, 0.09, 0.02, mat(-0.13 + i * 0.0325, 1.56, -1.205));
  }
  hard.setColor(0x403d34).setMat(0.55, 0.6, KIND.METAL, 0.7);
  roundedBox(hard, 0.2, 0.08, 0.3, 0.02, mat(0, 1.5, -0.6, 0.12, 0, 0));
  anchors.engine = v3(0, AXIS_Y, -1.0);
  anchors.cowlFront = v3(0, AXIS_Y, DIM.noseZ);
  return { anchors };
}
