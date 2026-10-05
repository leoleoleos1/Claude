// Wing V-struts, float N-struts, spreader bars, bracing wires and fittings.
import * as THREE from 'three';
import { DIM, PART, floatSection } from './dims.js';
import { tube, lathe, box, roundedBox, mat, matAlong, v3, KIND } from './geom.js';
import { wingPoint, sForC } from './wing.js';

const W = DIM.wing, F = DIM.float, FS = DIM.floatStruts;

export function buildStruts(ctx) {
  const { paint, hard, lod } = ctx;
  const anchors = {};
  const deckY = (z) => floatSection(z).deck + 0.01;
  const sides = lod === 0 ? 12 : lod === 1 ? 6 : 4;

  // tube in the paint material with its own (L/R shared) island
  const paintTube = (name, a, b, r, opts, side) => {
    const len = a.distanceTo(b);
    const circ = 2 * Math.PI * r * Math.max(opts.rx || 1, opts.ry || 1);
    const island = ctx.island(name, 0, 0, len + 0.02, circ, 1.0);
    paint.curIsland = island;
    paint.uv1Offset = side > 0 ? [0, 0] : [0, 30];
    paint.setPart(PART.WSTRUT, opts.wear || 0.2);
    const n = Math.max(2, Math.ceil(len / (lod === 0 ? 0.3 : 1.5)));
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(new THREE.Vector3().lerpVectors(a, b, i / n));
    const st = paint.vertexCount;
    tube(paint, pts, opts.radiusFn || r, { sides, rx: opts.rx || 1, ry: opts.ry || 1, up: opts.up, vLen: circ });
    // part id per strut kind is the same; edges get extra wear at the ends
    for (let v = st; v < paint.vertexCount; v++) {
      const u = paint.attrs.uv[v * 2];
      paint.attrs.aBake[v * 4] = Math.max(1 - u / 0.15, 1 - (len - u) / 0.15, 0) * 0.8;
    }
    return st;
  };

  // ---- wing struts (right side; left mirrored) ----
  const root = DIM.wingStrutRoot.clone();
  root.x += 0.05;
  const wf = wingPoint(W.strutX, sForC(W.frontSparFrac, -1), new THREE.Vector3());
  const wr = wingPoint(W.strutX, sForC(W.rearSparFrac, -1), new THREE.Vector3());
  wf.y -= 0.06; wr.y -= 0.06;
  const streamline = { rx: 0.42, ry: 1, up: new THREE.Vector3(0, 0, 1), wear: 0.08 };
  const startP = paint.vertexCount;
  paintTube('wstrutF', root.clone().add(v3(0, 0, -0.05)), wf, 0.056, streamline, 1);
  paintTube('wstrutR', root.clone().add(v3(0, 0, 0.05)), wr, 0.05, streamline, 1);
  const endP = paint.vertexCount;
  paint.mirrorX(startP, endP, [0, 30]);
  anchors.wingStrut = { root: root.clone(), front: wf.clone(), rear: wr.clone() };

  // ---- float struts ----
  const fFront = v3(F.x, deckY(FS.frontZ), FS.frontZ);
  const fRear = v3(F.x, deckY(FS.rearZ), FS.rearZ);
  const uFront = v3(FS.fusX, 1.605, 0.05);
  const uRear = v3(FS.fusX, 1.6, 2.3);
  const startF = paint.vertexCount;
  const round = { wear: 0.06 };
  paintTube('fstrutF', fFront, uFront, 0.036, round, 1);
  paintTube('fstrutR', fRear, uRear, 0.036, round, 1);
  paintTube('fstrutD', fRear.clone().add(v3(0, 0, -0.06)), uFront.clone().add(v3(0.02, 0, 0.06)), 0.03, round, 1);
  // short outboard brace from the float to the front strut (stiffener)
  if (lod < 2) paintTube('fstrutB', fFront.clone().add(v3(0, 0, 0.45)), new THREE.Vector3().lerpVectors(fFront, uFront, 0.45), 0.024, round, 1);
  const endF = paint.vertexCount;
  paint.mirrorX(startF, endF, [0, 30]);
  // spreader bars between the floats (one piece each, unique islands)
  paintTube('spreadF', v3(-F.x + 0.06, deckY(FS.frontZ) + 0.05, FS.frontZ + 0.08), v3(F.x - 0.06, deckY(FS.frontZ) + 0.05, FS.frontZ + 0.08), 0.032, round, 1);
  paintTube('spreadR', v3(-F.x + 0.06, deckY(FS.rearZ) + 0.05, FS.rearZ - 0.08), v3(F.x - 0.06, deckY(FS.rearZ) + 0.05, FS.rearZ - 0.08), 0.032, round, 1);

  // ---- fittings, wires, step ----
  const h0 = hard.vertexCount;
  hard.setColor(0x4a4842).setMat(0.45, 0.85, KIND.METAL, 0.6);
  // deck fittings (both struts)
  for (const p of [fFront, fRear]) {
    roundedBox(hard, 0.09, 0.05, 0.16, 0.012, mat(p.x, p.y + 0.012, p.z));
  }
  // fuselage strut fittings
  for (const p of [uFront, uRear]) box(hard, 0.08, 0.06, 0.1, mat(p.x, p.y + 0.02, p.z));
  // wing strut root fork
  box(hard, 0.08, 0.1, 0.18, mat(root.x - 0.02, root.y + 0.02, root.z));
  for (const p of [wf, wr]) {
    const m = matAlong(root, p);
    lathe(hard, [[0.032, 0], [0.036, 0.04], [0.02, 0.1]], 8, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, m.len - 0.1)));
  }
  // footstep on the front float strut (to climb to the cockpit door)
  if (lod < 2) {
    const sp = new THREE.Vector3().lerpVectors(fFront, uFront, 0.4);
    hard.setColor(0x6a675e).setMat(0.6, 0.8, KIND.TREAD, 0.8);
    roundedBox(hard, 0.16, 0.014, 0.12, 0.005, mat(sp.x + 0.04, sp.y, sp.z));
    box(hard, 0.02, 0.06, 0.02, mat(sp.x + 0.01, sp.y - 0.03, sp.z));
    anchors.stepR = sp.clone().add(v3(0.04, 0.007, 0));
    anchors.stepL = v3(-anchors.stepR.x, anchors.stepR.y, anchors.stepR.z);
  }
  // jury struts (wing strut to wing) — small
  if (lod < 2) {
    hard.setColor(0xb88a17).setMat(0.6, 0.2, KIND.PAINTED, 0.5);
    const mid = new THREE.Vector3().lerpVectors(root, wf, 0.62);
    const wj = wingPoint(W.strutX - 0.55, sForC(0.3, -1), new THREE.Vector3());
    tube(hard, [mid, wj], 0.013, { sides: 6 });
  }
  const h1 = hard.vertexCount;
  hard.mirrorX(h0, h1);
  // bracing wires with turnbuckles
  if (lod < 2) {
    hard.setColor(0x6b6a66).setMat(0.35, 1, KIND.METAL, 0.4);
    hard.curOccluder = false;
    const wire = (a, b) => {
      tube(hard, [a, b], 0.0045, { sides: lod === 0 ? 4 : 3 });
      const m = matAlong(a, b);
      lathe(hard, [[0.006, 0], [0.01, 0.02], [0.01, 0.07], [0.006, 0.09]], 6, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, m.len * 0.2)));
    };
    for (const z of [FS.frontZ, FS.rearZ]) {
      const dy = deckY(z) + 0.02;
      const uz = z === FS.frontZ ? uFront.z : uRear.z;
      wire(v3(F.x - 0.04, dy, z), v3(-FS.fusX, 1.6, uz));
      wire(v3(-F.x + 0.04, dy, z), v3(FS.fusX, 1.6, uz));
    }
    const yb = deckY(0.9) + 0.06;
    wire(v3(-F.x + 0.08, yb, FS.frontZ + 0.1), v3(F.x - 0.08, yb, FS.rearZ - 0.1));
    wire(v3(F.x - 0.08, yb, FS.frontZ + 0.1), v3(-F.x + 0.08, yb, FS.rearZ - 0.1));
    // water-rudder cables running along the inner deck edges up to the rear strut
    hard.setColor(0x2c2b29).setMat(0.5, 0.6, KIND.METAL, 0.3);
    for (const sx of [1, -1]) {
      const zs = F.sternZ - 0.1;
      tube(hard, [v3(sx * F.x, deckY(zs) + 0.09, zs), v3(sx * (F.x - 0.2), deckY(3.0) + 0.03, 3.0), v3(sx * (F.x - 0.25), deckY(2.2) + 0.03, 2.2), v3(sx * FS.fusX, 1.62, 2.35)], 0.003, { sides: 3 });
    }
    hard.curOccluder = true;
  }
  anchors.floatStruts = { fFront, fRear, uFront, uRear };
  return { anchors };
}
