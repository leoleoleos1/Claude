// Optional seaplane-base props: open hangar with a rusty corrugated roof,
// windsock that turns and inflates with the wind, oil drums, jerrycans,
// pallets with crates, and timber chocks. Uses the plane's hardware material.
import * as THREE from 'three';
import { GeoBuilder, tube, lathe, box, roundedBox, mat, v3, rng, KIND } from './geom.js';
import { createHardMaterial, createSharedUniforms } from './materials.js';

function corrugated(b, w, h, m, waves = 0.076, depth = 0.018) {
  // corrugated sheet in local XY (x across waves), facing +Z
  const start = b.vertexCount;
  const nx = Math.max(2, Math.round(w / waves) * 4);
  for (let i = 0; i <= nx; i++) {
    const x = -w / 2 + (w * i) / nx;
    const ph = (x / waves) * Math.PI * 2;
    const z = Math.sin(ph) * depth * 0.5;
    const dz = Math.cos(ph) * depth * 0.5 * (Math.PI * 2 / waves);
    const n = v3(-dz, 0, 1).normalize();
    b.vert(x, -h / 2, z, n.x, n.y, n.z, x, 0);
    b.vert(x, h / 2, z, n.x, n.y, n.z, x, h);
  }
  for (let i = 0; i < nx; i++) { const a = start + i * 2; b.quad(a, a + 2, a + 3, a + 1); }
  // back face
  const back = b.vertexCount;
  for (let i = 0; i <= nx; i++) {
    const x = -w / 2 + (w * i) / nx;
    const z = Math.sin((x / waves) * Math.PI * 2) * depth * 0.5 - 0.002;
    b.vert(x, -h / 2, z, 0, 0, -1, x, 0);
    b.vert(x, h / 2, z, 0, 0, -1, x, h);
  }
  for (let i = 0; i < nx; i++) { const a = back + i * 2; b.quad(a, a + 1, a + 3, a + 2); }
  b.transform(start, m);
}

function drum(b, m, color, rusty) {
  const st = b.vertexCount;
  b.setColor(color).setMat(0.6, 0.4, rusty ? KIND.RUST : KIND.PAINTED, 0.8);
  const prof = [[0.001, 0], [0.27, 0], [0.29, 0.02], [0.29, 0.28], [0.3, 0.3], [0.29, 0.32], [0.29, 0.56], [0.3, 0.58], [0.29, 0.6], [0.29, 0.86], [0.27, 0.88], [0.001, 0.88]];
  lathe(b, prof.map(([r, z]) => [r, z]), 18, null);
  b.setColor(0x3b3a36).setMat(0.4, 0.9, KIND.METAL, 0.5);
  lathe(b, [[0.03, 0.881], [0.035, 0.89], [0.001, 0.892]], 8, mat(0.15, 0, 0));
  b.transform(st, new THREE.Matrix4().multiplyMatrices(m, mat(0, 0, 0, -Math.PI / 2, 0, 0)));
}

function crate(b, m, s, rand) {
  const st = b.vertexCount;
  b.setColor(new THREE.Color(0x7a6448).multiplyScalar(0.8 + rand() * 0.3)).setMat(0.85, 0, KIND.WOOD, 0.6);
  box(b, s[0], s[1], s[2], null);
  b.setColor(0x5b4a35).setMat(0.85, 0, KIND.WOOD, 0.7);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(b, 0.04, s[1] + 0.01, 0.04, mat(sx * (s[0] / 2 - 0.02), 0, sz * (s[2] / 2 - 0.02)));
  b.transform(st, m);
}

export function jerrycanGeo(b, m, color) {
  const st = b.vertexCount;
  b.setColor(color).setMat(0.55, 0.3, KIND.PAINTED, 0.6);
  roundedBox(b, 0.17, 0.44, 0.34, 0.02, null, 1);
  const c2 = new THREE.Color(color).multiplyScalar(0.85);
  b.setColor(c2).setMat(0.6, 0.3, KIND.PAINTED, 0.7);
  for (const sx of [-1, 1]) for (const a of [0.9, -0.9]) box(b, 0.008, 0.04, 0.42, mat(sx * 0.087, -0.02, 0, a, 0, 0));
  b.setColor(color).setMat(0.55, 0.3, KIND.PAINTED, 0.6);
  for (const z of [-0.09, 0, 0.09]) tube(b, [v3(0, 0.22, z - 0.03), v3(0, 0.27, z - 0.025), v3(0, 0.27, z + 0.025), v3(0, 0.22, z + 0.03)], 0.009, { sides: 5 });
  b.transform(st, m);
}

// Timber chock block (local: long axis X).
export function chockGeo(b, m, rand) {
  const st = b.vertexCount;
  b.setColor(new THREE.Color(0x5d4a34).multiplyScalar(0.8 + rand() * 0.3)).setMat(0.9, 0, KIND.WOOD, 0.9);
  box(b, 0.9, 0.16, 0.22, mat(0, 0.08, 0));
  box(b, 0.85, 0.15, 0.2, mat(0.02, 0.235, 0, 0, 0.03, 0));
  b.transform(st, m);
}

export function createSeaplaneBase({ seed = 7, uniforms = null } = {}) {
  const U = uniforms || createSharedUniforms();
  const material = createHardMaterial(U, { name: 'seaplaneBase.hard' });
  const rand = rng(seed * 13 + 1);
  const group = new THREE.Group();
  group.name = 'seaplaneBase';
  const colliders = []; // boxes in kit-local space { x,y,z,hx,hy,hz,ry }

  // ---------------- hangar (local origin at the front-left post) ----------------
  const hb = new GeoBuilder('hard');
  const W = 13, D = 10, H = 4.8, Hb = 3.9; // width, depth, front height, back height
  hb.setColor(0x5a4630).setMat(0.9, 0, KIND.WOOD, 0.8);
  const posts = [];
  for (const x of [0, W / 2, W]) for (const z of [0, D / 2, D]) posts.push([x, z]);
  for (const [x, z] of posts) {
    const h = THREE.MathUtils.lerp(H, Hb, z / D);
    box(hb, 0.2, h, 0.2, mat(x, h / 2, z, 0, rand() * 0.05, (rand() - 0.5) * 0.03));
    colliders.push({ x, y: h / 2, z, hx: 0.12, hy: h / 2, hz: 0.12, ry: 0 });
  }
  // beams & rafters
  for (const z of [0, D / 2, D]) { const h = THREE.MathUtils.lerp(H, Hb, z / D); box(hb, W + 0.4, 0.22, 0.14, mat(W / 2, h - 0.05, z)); }
  for (const x of [0, W / 4, W / 2, (3 * W) / 4, W]) {
    const a = v3(x, H + 0.1, -0.3), bb = v3(x, Hb + 0.1, D + 0.3);
    const m = new THREE.Matrix4().lookAt(a, bb, v3(0, 1, 0));
    m.setPosition(a.clone().add(bb).multiplyScalar(0.5));
    box(hb, 0.1, 0.16, a.distanceTo(bb), m);
  }
  // corrugated roof sheets, some offset/missing for character
  const pitch = Math.atan2(H - Hb, D);
  for (let i = 0; i < 9; i++) {
    if (i === 6) continue;
    const x = 0.75 + i * 1.45 + (rand() - 0.5) * 0.06;
    hb.setColor(new THREE.Color(0x6a4a33).lerp(new THREE.Color(0x8a8378), rand() * 0.4)).setMat(0.8, 0.5, KIND.RUST, 0.6 + rand() * 0.4);
    const len = D + 0.9;
    const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2 + pitch);
    const rot = new THREE.Matrix4().makeRotationY((rand() - 0.5) * 0.015);
    const pos = new THREE.Matrix4().makeTranslation(x, (H + Hb) / 2 + 0.22 + i * 0.002, D / 2);
    corrugated(hb, 1.5, len, pos.multiply(rot).multiply(m));
  }
  // back & side walls: corrugated with a gap, plank lower wall
  hb.setColor(0x70533a).setMat(0.85, 0.4, KIND.RUST, 0.8);
  for (let i = 0; i < 8; i++) {
    if (i === 3) continue;
    corrugated(hb, 1.62, Hb - 0.9, mat(0.81 + i * 1.62, (Hb - 0.9) / 2 + 0.75, D + 0.05, 0, Math.PI, 0));
  }
  for (const x of [-0.05, W + 0.05]) for (let i = 0; i < 4; i++) {
    if (x > W / 2 && i === 0) continue;
    const z = 1.6 + i * 2.2;
    const h = THREE.MathUtils.lerp(H, Hb, z / D) - 1.0;
    corrugated(hb, 2.15, h, mat(x, h / 2 + 0.8, z, 0, x < W / 2 ? -Math.PI / 2 : Math.PI / 2, 0));
  }
  hb.setColor(0x4a3a2a).setMat(0.9, 0, KIND.WOOD, 0.8);
  for (let i = 0; i < 4; i++) box(hb, W, 0.18, 0.04, mat(W / 2, 0.15 + i * 0.2, D + 0.02));
  colliders.push({ x: W / 2, y: 1.5, z: D + 0.05, hx: W / 2, hy: 1.5, hz: 0.1, ry: 0 });
  // workbench, shelves, crates, drums inside
  hb.setColor(0x5c4a36).setMat(0.85, 0, KIND.WOOD, 0.8);
  box(hb, 3.2, 0.08, 0.8, mat(3.2, 0.95, D - 0.6));
  for (const x of [1.7, 4.7]) for (const z of [D - 0.95, D - 0.25]) box(hb, 0.08, 0.95, 0.08, mat(x, 0.47, z));
  colliders.push({ x: 3.2, y: 0.5, z: D - 0.6, hx: 1.6, hy: 0.5, hz: 0.4, ry: 0 });
  for (let i = 0; i < 6; i++) {
    const s = [0.6 + rand() * 0.4, 0.45 + rand() * 0.3, 0.5 + rand() * 0.3];
    const x = 7.5 + (i % 3) * 0.9, z = D - 0.7 - Math.floor(i / 3) * 0.95;
    crate(hb, mat(x, s[1] / 2 + (i > 2 ? 0 : 0), z, 0, rand() * 0.3, 0), s, rand);
    colliders.push({ x, y: s[1] / 2, z, hx: s[0] / 2, hy: s[1] / 2, hz: s[2] / 2, ry: 0 });
  }
  const drumColors = [0x7a2a1c, 0x2b4a6b, 0x4a5a2c, 0x6b6b6b];
  for (let i = 0; i < 5; i++) {
    const x = 11.0 + (i % 2) * 0.62, z = 1.2 + Math.floor(i / 2) * 0.62;
    drum(hb, mat(x, 0, z), drumColors[i % 4], rand() > 0.4);
    colliders.push({ x, y: 0.44, z, hx: 0.3, hy: 0.44, hz: 0.3, ry: 0 });
  }
  const hangar = new THREE.Mesh(hb.toGeometry(), material);
  hangar.name = 'hangar';
  hangar.castShadow = true;
  hangar.receiveShadow = true;
  group.add(hangar);

  // ---------------- loose props (in front of / beside the hangar) ----------------
  const pb = new GeoBuilder('hard');
  const props = [];
  const addDrum = (x, z, color, lying = false) => {
    if (lying) drum(pb, mat(x, 0.3, z, 0, rand(), Math.PI / 2), color, true);
    else drum(pb, mat(x, 0, z), color, rand() > 0.5);
    colliders.push({ x, y: lying ? 0.3 : 0.44, z, hx: 0.32, hy: lying ? 0.3 : 0.44, hz: 0.32, ry: 0 });
  };
  addDrum(-1.6, 1.2, 0x8a2c1a);
  addDrum(-1.0, 1.0, 0x8a2c1a);
  addDrum(-1.3, 1.75, 0x355a7a);
  addDrum(-2.2, 2.6, 0x7a2a1c, true);
  // pallets with jerrycans
  pb.setColor(0x6d5a40).setMat(0.9, 0, KIND.WOOD, 0.8);
  const pallet = (x, z, ry) => {
    const st = pb.vertexCount;
    for (let i = 0; i < 5; i++) box(pb, 1.2, 0.02, 0.14, mat(0, 0.13, -0.4 + i * 0.2));
    for (const zz of [-0.4, 0, 0.4]) box(pb, 1.2, 0.1, 0.1, mat(0, 0.06, zz));
    pb.transform(st, mat(x, 0, z, 0, ry, 0));
    colliders.push({ x, y: 0.07, z, hx: 0.6, hy: 0.07, hz: 0.5, ry });
  };
  pallet(-3.5, 4.0, 0.3);
  const cans = [0x8c1f16, 0x4a5530, 0x8c1f16, 0x4a5530, 0x8c1f16];
  cans.forEach((c, i) => jerrycanGeo(pb, mat(-3.5 + (i - 2) * 0.2, 0.37, 4.0 + (i % 2) * 0.12, 0, 0.3 + rand() * 0.1, 0), c));
  props.push(pb);
  const propsMesh = new THREE.Mesh(pb.toGeometry(), material);
  propsMesh.name = 'baseProps';
  propsMesh.castShadow = true;
  propsMesh.receiveShadow = true;
  group.add(propsMesh);

  // ---------------- windsock ----------------
  const wsGroup = new THREE.Group();
  wsGroup.name = 'windsock';
  wsGroup.position.set(-4.5, 0, -1.5);
  const pole = new GeoBuilder('hard');
  pole.setColor(0x8a877e).setMat(0.4, 0.9, KIND.METAL, 0.6);
  tube(pole, [v3(0, 0, 0), v3(0, 6.2, 0)], 0.04, { sides: 8 });
  tube(pole, [v3(0, 6.2, 0), v3(0.08, 6.2, 0)], 0.015, { sides: 6 });
  wsGroup.add(Object.assign(new THREE.Mesh(pole.toGeometry(), material), { castShadow: true }));
  colliders.push({ x: -4.5, y: 3.1, z: -1.5, hx: 0.06, hy: 3.1, hz: 0.06, ry: 0 });
  const yaw = new THREE.Group();
  yaw.position.set(0, 6.2, 0);
  wsGroup.add(yaw);
  const pitchG = new THREE.Group();
  yaw.add(pitchG);
  const sock = new GeoBuilder('hard');
  // cone along +X from the ring, red/white stripes, flexible tail via wobble group 1
  const segs = 10, len = 1.7;
  for (let s = 0; s < 5; s++) {
    const x0 = (s / 5) * len, x1 = ((s + 1) / 5) * len;
    sock.setColor(s % 2 ? 0xe8e2d4 : 0xc2311f).setMat(0.85, 0, KIND.FABRIC, 0.4);
    const st = sock.vertexCount;
    lathe(sock, [[0.24 - x0 * 0.06, 0], [0.24 - x1 * 0.06, x1 - x0]], segs, mat(0.1 + x0, 0, 0, 0, Math.PI / 2, 0));
    for (let v = st; v < sock.vertexCount; v++) {
      const x = sock.position[v * 3];
      sock.attrs.aWob[v * 4] = 0.1; sock.attrs.aWob[v * 4 + 1] = 0; sock.attrs.aWob[v * 4 + 2] = 0;
      sock.attrs.aWob[v * 4 + 3] = 1 + Math.min(x / (len * 1.2), 0.999);
    }
  }
  const sockMesh = new THREE.Mesh(sock.toGeometry(), material);
  sockMesh.castShadow = true;
  pitchG.add(sockMesh);
  group.add(wsGroup);
  let flutter = 0;
  const windsock = {
    group: wsGroup,
    // wind: world-space Vector3 (m/s); the kit group may be rotated so pass group yaw
    update(wind, dt) {
      const speed = Math.hypot(wind.x, wind.z);
      flutter += dt * (3 + speed * 0.8);
      const inv = group.quaternion.clone().invert();
      const wl = wind.clone().applyQuaternion(inv);
      yaw.rotation.y = Math.atan2(-wl.z, wl.x);
      const droop = (1 - Math.min(speed / 9, 1)) * 1.25;
      pitchG.rotation.z = -droop + Math.sin(flutter) * 0.04 * Math.min(speed / 4, 1);
      U.uSpWob.value[1].set(0, Math.sin(flutter * 1.7) * 0.05, Math.sin(flutter * 1.3) * 0.08 * Math.min(speed / 5, 1));
    },
  };

  return { group, material, uniforms: U, colliders, windsock, hangarSize: { W, D, H } };
}
