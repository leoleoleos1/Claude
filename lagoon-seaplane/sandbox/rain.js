// Sandbox rain: wind-slanted streaks in a box that follows the camera.
import * as THREE from 'three';

export class Rain {
  constructor(scene, count = 2600) {
    this.count = count;
    const pos = new Float32Array(count * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x9fb0c0, transparent: true, opacity: 0.35, depthWrite: false }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.name = 'rain';
    scene.add(this.mesh);
    this.drops = new Float32Array(count * 3);
    let s = 7;
    const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < count; i++) { this.drops[i * 3] = (r() - 0.5) * 50; this.drops[i * 3 + 1] = r() * 26; this.drops[i * 3 + 2] = (r() - 0.5) * 50; }
    this.intensity = 0;
  }

  update(dt, camPos, wind, intensity) {
    this.intensity = intensity;
    this.mesh.visible = intensity > 0.01;
    if (!this.mesh.visible) return;
    const P = this.mesh.geometry.attributes.position.array, D = this.drops;
    const vy = -10, vx = wind.x * 0.9, vz = wind.z * 0.9;
    const n = Math.floor(this.count * Math.min(1, intensity));
    for (let i = 0; i < this.count; i++) {
      let y = D[i * 3 + 1] + vy * dt;
      if (y < 0) y += 26;
      D[i * 3 + 1] = y;
      D[i * 3] = ((D[i * 3] + vx * dt + 25) % 50 + 50) % 50 - 25;
      D[i * 3 + 2] = ((D[i * 3 + 2] + vz * dt + 25) % 50 + 50) % 50 - 25;
      const o = i * 6;
      if (i >= n) { P[o] = P[o + 3] = 0; P[o + 1] = P[o + 4] = -1e4; P[o + 2] = P[o + 5] = 0; continue; }
      const x = camPos.x + D[i * 3], z = camPos.z + D[i * 3 + 2], yy = camPos.y - 10 + y;
      P[o] = x; P[o + 1] = yy; P[o + 2] = z;
      P[o + 3] = x - vx * 0.045; P[o + 4] = yy - vy * 0.045; P[o + 5] = z - vz * 0.045;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}
