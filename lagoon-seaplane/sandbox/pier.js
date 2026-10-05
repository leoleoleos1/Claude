// Sandbox pier: weathered plank deck at y = 0.85 on pilings, two mooring posts
// with rope wraps. Registers its colliders with the world and exposes walkable
// deck boxes for the walker and mooring points for the plane.
import * as THREE from 'three';

export const PIER_DECK_Y = 0.85;

export class Pier {
  // start: shore end (x, z); length along +x; width across z
  constructor(scene, world, { x = 214, z = -10, length = 44, width = 2.6 } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'pier';
    scene.add(this.group);
    this.x0 = x; this.z = z; this.length = length; this.width = width;
    const rnd = mulberry(91);
    const deckT = 0.07;
    // deck planks (instanced), stringers, pilings
    const plankW = 0.24, gap = 0.025;
    const nPlanks = Math.floor(length / (plankW + gap));
    const plankGeo = new THREE.BoxGeometry(plankW, deckT, width);
    const plankMat = new THREE.MeshStandardMaterial({ color: 0x8a7458, roughness: 0.92, metalness: 0 });
    const planks = new THREE.InstancedMesh(plankGeo, plankMat, nPlanks);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < nPlanks; i++) {
      const px = x + i * (plankW + gap) + plankW / 2;
      q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.02, (rnd() - 0.5) * 0.015, (rnd() - 0.5) * 0.02));
      s.set(1, 1, 0.97 + rnd() * 0.06);
      p.set(px, PIER_DECK_Y - deckT / 2 + (rnd() - 0.5) * 0.01, z + (rnd() - 0.5) * 0.06);
      m.compose(p, q, s);
      planks.setMatrixAt(i, m);
      c.setHSL(0.08 + rnd() * 0.03, 0.25 + rnd() * 0.15, 0.25 + rnd() * 0.12);
      planks.setColorAt(i, c);
    }
    planks.castShadow = true;
    planks.receiveShadow = true;
    this.group.add(planks);
    const woodDark = new THREE.MeshStandardMaterial({ color: 0x4a3c2c, roughness: 0.95 });
    for (const side of [-1, 1]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(length, 0.18, 0.14), woodDark);
      beam.position.set(x + length / 2, PIER_DECK_Y - deckT - 0.09, z + side * (width / 2 - 0.12));
      beam.castShadow = true; beam.receiveShadow = true;
      this.group.add(beam);
    }
    const pileGeo = new THREE.CylinderGeometry(0.13, 0.15, 5, 8);
    pileGeo.translate(0, -2.5, 0);
    const nPiles = Math.floor(length / 3) + 1;
    const piles = new THREE.InstancedMesh(pileGeo, woodDark, nPiles * 2);
    let k = 0;
    for (let i = 0; i < nPiles; i++) for (const side of [-1, 1]) {
      m.makeTranslation(x + 0.3 + i * 3, PIER_DECK_Y - deckT, z + side * (width / 2 - 0.1));
      piles.setMatrixAt(k++, m);
    }
    piles.castShadow = true;
    this.group.add(piles);
    // mooring posts on the +z side near the end, with rope wraps
    this.posts = [];
    this.mooringPoints = [];
    const postMat = new THREE.MeshStandardMaterial({ color: 0x3f3226, roughness: 0.9 });
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x8a7650, roughness: 0.95 });
    for (const dx of [length - 11, length - 1.2]) {
      const px = x + dx, pz = z + width / 2 + 0.05;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 2.4, 10), postMat);
      post.position.set(px, PIER_DECK_Y + 0.5 - 1.2 + 0.3, pz);
      post.castShadow = true;
      this.group.add(post);
      const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 6, 16), ropeMat);
      wrap.rotation.x = Math.PI / 2;
      wrap.position.set(px, PIER_DECK_Y + 0.35, pz);
      this.group.add(wrap);
      this.posts.push(post);
      world.addBox(px, PIER_DECK_Y - 0.5, pz, 0.17, 1.5, 0.17, 0);
      this.mooringPoints.push({ id: 'pierPost' + this.posts.length, position: new THREE.Vector3(px, PIER_DECK_Y + 0.35, pz) });
    }
    // colliders: deck slab (the plane collides with it; the walker stands on it)
    world.addBox(x + length / 2, PIER_DECK_Y - 0.15, z, length / 2, 0.15, width / 2, 0);
    this.deck = { min: new THREE.Vector3(x, PIER_DECK_Y - 0.3, z - width / 2), max: new THREE.Vector3(x + length, PIER_DECK_Y, z + width / 2) };
  }

  // walker support height at (x, z) or -Infinity
  supportAt(x, z, footY) {
    const d = this.deck;
    if (x < d.min.x || x > d.max.x || z < d.min.z - 0.15 || z > d.max.z + 0.15) return -Infinity;
    return footY > d.max.y - 0.5 ? d.max.y : -Infinity;
  }
}

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
