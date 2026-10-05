// F1 debug visuals: CG, contact points, buoyancy samples, walk/block shapes,
// velocity / wind / gust vectors, hand targets. Created up front (compiled with
// the scene) and only toggled visible.
import * as THREE from 'three';

export class DebugViz {
  constructor(scene, plane) {
    this.plane = plane;
    this.group = new THREE.Group();
    this.group.name = 'debugviz';
    this.group.visible = false;
    scene.add(this.group);
    const ph = plane.physics;
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 });
    this.contacts = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), mat, ph.contacts.length);
    this.samples = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), mat.clone(), ph.samples.length);
    this.cg = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff2020, depthTest: false }));
    for (const m of [this.contacts, this.samples, this.cg]) { m.renderOrder = 10; m.frustumCulled = false; this.group.add(m); }
    this.contacts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ph.contacts.length * 3), 3);
    this.samples.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ph.samples.length * 3), 3);
    this.arrows = {
      vel: new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xffd040),
      wind: new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0x40d0ff),
      acc: new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xff60ff),
    };
    for (const k in this.arrows) { this.arrows[k].renderOrder = 10; this.group.add(this.arrows[k]); }
    // walk shapes (green) and block shapes (red) as box outlines in plane space
    this.shapes = new THREE.Group();
    this.group.add(this.shapes);
    this._shapesBuilt = false;
    this.hands = new THREE.Group();
    for (const c of [0x40ff80, 0xff8040]) this.hands.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.09), new THREE.MeshBasicMaterial({ color: c, depthTest: false })));
    this.group.add(this.hands);
    this._m = new THREE.Matrix4(); this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._c = new THREE.Color();
  }

  _buildShapes() {
    const p = this.plane;
    const add = (s, color) => {
      if (!(s.max.x >= s.min.x)) return; // emptied shape (its float broke off)
      const size = new THREE.Vector3().subVectors(s.max, s.min);
      const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, Math.max(size.y, 0.01), size.z)), new THREE.LineBasicMaterial({ color, depthTest: false }));
      box.position.addVectors(s.min, s.max).multiplyScalar(0.5);
      box.renderOrder = 10;
      this.shapes.add(box);
    };
    for (const s of p.walkShapes) add(s, 0x40ff60);
    for (const s of p.blockShapes) add(s, 0xff4040);
    this._shapesBuilt = true;
  }

  update(env) {
    if (!this.group.visible) return;
    const p = this.plane, ph = p.physics;
    if (!this._shapesBuilt && p.walkShapes.length) this._buildShapes();
    this.shapes.matrixAutoUpdate = false;
    this.shapes.matrix.copy(p.root.matrixWorld);
    for (let i = 0; i < ph.contacts.length; i++) {
      const c = ph.contacts[i];
      ph.pointWorld(c.local, this._v);
      this._m.makeScale(c.r, c.r, c.r).setPosition(this._v);
      this.contacts.setMatrixAt(i, this._m);
      this._c.set(c.on ? 0xff3030 : 0xe0e0e0);
      this.contacts.setColorAt(i, this._c);
    }
    this.contacts.instanceMatrix.needsUpdate = true;
    this.contacts.instanceColor.needsUpdate = true;
    for (let i = 0; i < ph.samples.length; i++) {
      const s = ph.samples[i];
      ph.pointWorld(s.local, this._v);
      this._m.makeTranslation(this._v.x, this._v.y, this._v.z);
      this.samples.setMatrixAt(i, this._m);
      this._c.setRGB(0.2 + 0.8 * (1 - s.wet), 0.5, 0.3 + 0.7 * s.wet);
      this.samples.setColorAt(i, this._c);
    }
    this.samples.instanceMatrix.needsUpdate = true;
    this.samples.instanceColor.needsUpdate = true;
    this.cg.position.copy(ph.cg);
    const a = this.arrows;
    const up = this._w.copy(ph.cg).add(this._v.set(0, 2.2, 0));
    const vl = ph.vel.length();
    a.vel.position.copy(up); a.vel.setDirection(this._v.copy(ph.vel).normalize()); a.vel.setLength(Math.max(0.01, vl * 0.25), 0.4, 0.2);
    const wl = env.wind.length() + ph.gust.length();
    a.wind.position.copy(up).y += 0.3; a.wind.setDirection(this._v.copy(env.wind).add(ph.gust).normalize()); a.wind.setLength(Math.max(0.01, wl * 0.4), 0.3, 0.15);
    if (ph.out.accBody) {
      ph.toWorldDir(ph.out.accBody, this._v);
      const al = this._v.length();
      a.acc.position.copy(ph.cg); a.acc.setDirection(this._v.normalize()); a.acc.setLength(Math.max(0.01, al * 0.15), 0.3, 0.15);
    }
    p.handTargets.left.getWorldPosition(this.hands.children[0].position);
    p.handTargets.right.getWorldPosition(this.hands.children[1].position);
  }
}
