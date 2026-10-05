// Sandbox sky: analytic gradient sky with sun, clouds, stars; time of day drives
// the sun light, hemisphere light, fog and a PMREM environment map.
import * as THREE from 'three';

export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uGroundColor;
uniform float uNight;
uniform float uCloud;
uniform float uSkyTime;
float sk_h(vec2 p) { p = fract(p * vec2(0.1031, 0.1137)); p += dot(p, p.yx + 19.19); return fract(p.x * p.y * 1.7313 + p.x * 0.513); }
float sk_n(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sk_h(i), sk_h(i + vec2(1, 0)), u.x), mix(sk_h(i + vec2(0, 1)), sk_h(i + vec2(1, 1)), u.x), u.y); }
float sk_fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * sk_n(p); p = p * 2.02 + 7.1; a *= 0.5; } return s; }
vec3 skyColor(vec3 d, bool withSun) {
  float h = d.y;
  vec3 c = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.42));
  c = mix(c, uGroundColor, smoothstep(0.0, -0.12, h));
  float sd = max(dot(d, uSunDir), 0.0);
  c += uSunColor * (pow(sd, 5.0) * 0.12 + pow(sd, 48.0) * 0.35) * (1.0 - uNight * 0.8);
  if (withSun) c += uSunColor * smoothstep(0.9993, 0.9997, sd) * 40.0 * (1.0 - uNight);
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.06) * 0.55 + vec2(uSkyTime * 0.004, uSkyTime * 0.0015);
    float n = sk_fbm(uv * 1.6);
    float cov = smoothstep(0.62 - uCloud * 0.32, 0.86 - uCloud * 0.2, n) * smoothstep(0.0, 0.12, h);
    float shade = sk_fbm(uv * 1.6 + uSunDir.xz * 0.15);
    vec3 lit = mix(vec3(1.0), uSunColor * 0.35 + 0.65, 0.4) * (0.95 + 0.1 * sd);
    vec3 cc = mix(lit, mix(uHorizon, vec3(0.45, 0.47, 0.5), 0.6) * 0.8, smoothstep(0.4, 0.8, shade) * 0.7);
    cc = mix(cc, vec3(0.04, 0.045, 0.06), uNight * 0.95);
    cc = mix(cc, vec3(0.42, 0.44, 0.47), uCloud * 0.5 * (1.0 - uNight));
    c = mix(c, cc, cov * 0.92);
    // stars
    vec2 sg = d.xz / (h + 0.3) * 160.0;
    float st = step(0.9965, sk_h(floor(sg))) * (1.0 - cov) * uNight * smoothstep(0.05, 0.3, h);
    c += vec3(st) * 1.5;
  }
  return c;
}`;

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const DOME_FRAG = /* glsl */ `
varying vec3 vDir;
${SKY_GLSL}
void main() { gl_FragColor = vec4(skyColor(normalize(vDir), true), 1.0); }`;

const lerpC = (a, b, t) => new THREE.Color().copy(a).lerp(b, t);

export class Sky {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() }, uGroundColor: { value: new THREE.Color(0.18, 0.2, 0.2) },
      uNight: { value: 0 }, uCloud: { value: 0.25 }, uSkyTime: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, side: THREE.BackSide, depthWrite: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    this.dome.scale.setScalar(5000);
    scene.add(this.dome);
    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x6b5a45, 0.6);
    scene.add(this.hemi);
    scene.fog = new THREE.Fog(0xa0c0d8, 150, 2600);
    // environment
    this.envScene = new THREE.Scene();
    this.envDome = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), this.material);
    this.envScene.add(this.envDome);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.sunDirection = new THREE.Vector3(0, 1, 0);
    this.hour = 10.5;
    this.cloud = 0.25;
    this.rain = 0;
    this._lastEnvKey = '';
  }

  setTime(hour) { this.hour = hour; }

  // night factor 0..1
  get night() { return this.uniforms.uNight.value; }

  update(dt, focus) {
    this.uniforms.uSkyTime.value += dt;
    const h = this.hour;
    // sun path: rises east (+x) at 6h, sets west at 18h, tilted south
    const a = ((h - 6) / 12) * Math.PI;
    const elev = Math.sin(a) * 1.15;
    const dir = new THREE.Vector3(Math.cos(a), elev, 0.42).normalize();
    if (elev < -0.08) {
      // moon light from the opposite side at night
      dir.set(-Math.cos(a) * 0.6, 0.55, -0.3).normalize();
    }
    this.sunDirection.copy(new THREE.Vector3(Math.cos(a), elev, 0.42).normalize());
    this.uniforms.uSunDir.value.copy(this.sunDirection);
    const day = THREE.MathUtils.smoothstep(elev, -0.05, 0.35);
    const sunset = Math.max(0, 1 - Math.abs(elev - 0.08) / 0.22) * (elev > -0.12 ? 1 : 0);
    const night = 1 - THREE.MathUtils.smoothstep(elev, -0.2, 0.02);
    const rainK = this.rain;
    this.uniforms.uNight.value = night;
    this.uniforms.uCloud.value = Math.min(1, this.cloud + rainK * 0.8);
    const Z_DAY = new THREE.Color(0.1, 0.27, 0.66), Z_SET = new THREE.Color(0.14, 0.17, 0.4), Z_NIGHT = new THREE.Color(0.004, 0.008, 0.022);
    const H_DAY = new THREE.Color(0.58, 0.72, 0.86), H_SET = new THREE.Color(0.98, 0.55, 0.3), H_NIGHT = new THREE.Color(0.015, 0.025, 0.045);
    let zen = lerpC(Z_NIGHT, Z_DAY, day), hor = lerpC(H_NIGHT, H_DAY, day);
    zen = lerpC(zen, Z_SET, sunset * 0.6); hor = lerpC(hor, H_SET, sunset * 0.85);
    const grey = new THREE.Color(0.42, 0.45, 0.48).multiplyScalar(0.2 + 0.8 * day);
    zen.lerp(grey, rainK * 0.75); hor.lerp(grey, rainK * 0.7);
    this.uniforms.uZenith.value.copy(zen);
    this.uniforms.uHorizon.value.copy(hor);
    const sunCol = lerpC(new THREE.Color(1.0, 0.5, 0.22), new THREE.Color(1.0, 0.95, 0.88), THREE.MathUtils.smoothstep(elev, 0.02, 0.4));
    this.uniforms.uSunColor.value.copy(sunCol).multiplyScalar(1 - night);
    this.uniforms.uGroundColor.value.copy(hor).multiplyScalar(0.35);
    // lights
    this.sun.color.copy(night > 0.6 ? new THREE.Color(0.55, 0.65, 0.9) : sunCol);
    this.sun.intensity = night > 0.6 ? 0.12 : (2.7 * day + 0.6 * sunset) * (1 - rainK * 0.75);
    this.hemi.color.copy(zen).lerp(new THREE.Color(1, 1, 1), 0.35);
    this.hemi.groundColor.set(0x5c4c38).multiplyScalar(0.35 + 0.65 * day);
    this.hemi.intensity = 0.2 + 0.55 * day;
    const f = this.scene.fog;
    f.color.copy(hor).lerp(zen, 0.15);
    f.near = 120 - rainK * 90;
    f.far = 2600 - rainK * 2000;
    // sun light follows the focus point so the shadow map covers it
    const lp = night > 0.6 ? dir : this.sunDirection;
    this.sun.position.copy(focus).addScaledVector(lp, 120);
    this.sun.target.position.copy(focus);
    // refresh the environment map when the sky changed noticeably
    const key = [h.toFixed(2), rainK.toFixed(2), this.cloud.toFixed(2)].join('|');
    if (key !== this._lastEnvKey) {
      this._lastEnvKey = key;
      if (this.envRT) this.envRT.dispose();
      this.envRT = this.pmrem.fromScene(this.envScene, 0.0, 0.1, 100);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.35 + 0.65 * day;
    }
  }
}
