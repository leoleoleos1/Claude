// Materials: stock MeshStandardMaterial / MeshBasicMaterial extended locally with
// onBeforeCompile (unique customProgramCacheKey, includes kept intact so global
// chunk patches such as CSM / custom fog keep working). All variants are created
// once; runtime changes go through shared uniforms only.
import * as THREE from 'three';
import { GLSL_NOISE, GLSL_PANEL } from './glsl.js';
import { KIND } from './geom.js';

const PERTURB = /* glsl */ `
vec3 sp_perturb(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sx = dFdx(surfPos), sy = dFdy(surfPos);
  vec3 r1 = cross(sy, surfNorm), r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

// Shared runtime uniforms (one set for all the plane's materials).
export function createSharedUniforms() {
  return {
    uSpWet: { value: 0 },
    uSpTime: { value: 0 },
    uSpWob: { value: Array.from({ length: 16 }, () => new THREE.Vector3()) },
    uSpLamp: { value: new Array(8).fill(0) },
    uSpRain: { value: 0 },
    uSpFlow: { value: 0 },
    uSpStreak: { value: 0 },
    uSpShatter: { value: 0 },
    uSpDetail: { value: 1 },
    uSpBurn: { value: 0 },
    uSpRig: { value: null },
  };
}

// Rigid-part ("rig") transforms: per-vertex part index aRig selects a 3x4 matrix
// from a float texture (3 texels per row). Lets dozens of small moving parts
// share one draw call.
export function createRigTexture(count) {
  const data = new Float32Array(3 * 4 * (count + 1));
  for (let i = 0; i <= count; i++) { data[i * 12] = 1; data[i * 12 + 5] = 1; data[i * 12 + 10] = 1; }
  const t = new THREE.DataTexture(data, 3, count + 1, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}
// write a Matrix4 into row i of the rig texture data
export function setRigMatrix(tex, i, m) {
  const e = m.elements, d = tex.image.data, o = i * 12;
  d[o] = e[0]; d[o + 1] = e[4]; d[o + 2] = e[8]; d[o + 3] = e[12];
  d[o + 4] = e[1]; d[o + 5] = e[5]; d[o + 6] = e[9]; d[o + 7] = e[13];
  d[o + 8] = e[2]; d[o + 9] = e[6]; d[o + 10] = e[10]; d[o + 11] = e[14];
}
const RIG_PARS = 'attribute float aRig;\nuniform highp sampler2D uSpRig;';
const RIG_NORMAL = /* glsl */ `
  mat4 spRigM = mat4(1.0);
  if (aRig > 0.5) {
    int spRi = int(aRig + 0.5);
    vec4 spR0 = texelFetch(uSpRig, ivec2(0, spRi), 0);
    vec4 spR1 = texelFetch(uSpRig, ivec2(1, spRi), 0);
    vec4 spR2 = texelFetch(uSpRig, ivec2(2, spRi), 0);
    spRigM = mat4(spR0.x, spR1.x, spR2.x, 0.0, spR0.y, spR1.y, spR2.y, 0.0, spR0.z, spR1.z, spR2.z, 0.0, spR0.w, spR1.w, spR2.w, 1.0);
    objectNormal = mat3(spRigM) * objectNormal;
  }`;
const RIG_POS = `  if (aRig > 0.5) transformed = (spRigM * vec4(transformed, 1.0)).xyz;`;
function injectRig(vs, U, shader) {
  shader.uniforms.uSpRig = U.uSpRig;
  vs = inject(vs, '#include <common>', RIG_PARS);
  vs = inject(vs, '#include <beginnormal_vertex>', RIG_NORMAL);
  vs = inject(vs, '#include <begin_vertex>', RIG_POS);
  return vs;
}

function inject(src, marker, code, after = true) {
  if (!src.includes(marker)) throw new Error('shader marker missing: ' + marker);
  return src.replace(marker, after ? marker + '\n' + code : code + '\n' + marker);
}

// ---------------------------------------------------------------------------
// Paint (airframe atlas + procedural fine detail)
export function createPaintMaterial(U, maps, { detail = true } = {}) {
  const m = new THREE.MeshStandardMaterial({
    name: detail ? 'seaplane.paint' : 'seaplane.paintLod',
    map: maps.map, roughnessMap: maps.data, metalnessMap: maps.data, aoMap: maps.data,
    roughness: 1, metalness: 1, aoMapIntensity: 1, envMapIntensity: 1.0,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSpWet = U.uSpWet;
    shader.uniforms.uSpDetail = U.uSpDetail;
    shader.uniforms.uSpBurn = U.uSpBurn;
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    vs = inject(vs, '#include <common>', 'attribute vec2 aPanel;\nvarying vec2 vSpPanel;\nvarying vec3 vSpObj;');
    vs = inject(vs, '#include <begin_vertex>', 'vSpPanel = aPanel;\nvSpObj = position;');
    fs = inject(fs, '#include <common>', `varying vec2 vSpPanel;\nvarying vec3 vSpObj;\nuniform float uSpWet;\nuniform float uSpDetail;\nuniform float uSpBurn;\n${GLSL_NOISE}\n${GLSL_PANEL}\n${PERTURB}`);
    if (detail) {
      fs = inject(fs, '#include <metalnessmap_fragment>', /* glsl */ `
  vec4 spData = texture2D(roughnessMap, vRoughnessMapUv);
  float spWear = spData.a;
  float spDetailMask = diffuseColor.a * uSpDetail;
  diffuseColor.a = opacity;
  vec2 spQ = vSpPanel;
  vec2 spQx = dFdx(spQ), spQy = dFdy(spQ);
  float spPx = max(length(spQx), length(spQy));
  float spFine = smoothstep(0.0045, 0.0015, spPx) * spDetailMask;
  float spMid = smoothstep(0.03, 0.008, spPx);
  float dS0, dR0, pid0, dS1, dR1, pid1, dS2, dR2, pid2;
  float spH0 = sp_panelHeight(spQ, spFine, dS0, dR0, pid0);
  float spH1 = sp_panelHeight(spQ + spQx, spFine, dS1, dR1, pid1);
  float spH2 = sp_panelHeight(spQ + spQy, spFine, dS2, dR2, pid2);
  // oil-canning scaled by the detail mask
  spH0 *= spDetailMask; spH1 *= spDetailMask; spH2 *= spDetailMask;
  // chipped paint: primer ring, bare metal core
  float spN = sp_fbm2(spQ * 34.0 + 7.0, 3) + 0.32 * sp_noise2(spQ * 190.0) - 0.16;
  float spSeamW = ((1.0 - smoothstep(0.0, 0.025, dS0)) * 0.2 + (1.0 - smoothstep(0.0, 0.009, dR0)) * 0.2) * spDetailMask;
  float spT = 1.16 - (spWear + spSeamW) * 0.85;
  float spFw = fwidth(spN) * 0.75 + 0.002;
  float spChip = smoothstep(spT - spFw, spT + spFw, spN);
  float spBare = smoothstep(spT + 0.11 - spFw, spT + 0.11 + spFw, spN);
  float spFar = smoothstep(0.005, 0.015, spPx);
  float spCov = clamp((spWear - 0.3) * 0.6, 0.0, 0.45);
  spChip = mix(spChip, spCov, spFar);
  spBare = mix(spBare, spCov * 0.3, spFar);
  vec3 spPrimer = vec3(0.04, 0.036, 0.03) * (0.8 + 0.4 * sp_noise2(spQ * 40.0));
  vec3 spMetal = vec3(0.56, 0.56, 0.54) * (0.85 + 0.25 * sp_noise2(spQ * 90.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, spPrimer, spChip);
  diffuseColor.rgb = mix(diffuseColor.rgb, spMetal, spBare);
  metalnessFactor = mix(metalnessFactor, 1.0, spBare);
  roughnessFactor = mix(roughnessFactor, 0.3 + 0.22 * sp_noise2(spQ * 70.0), spBare);
  roughnessFactor = mix(roughnessFactor, 0.85, spChip * (1.0 - spBare) * 0.4);
  // dirt packed in seams and around rivet heads
  diffuseColor.rgb *= 1.0 - (1.0 - smoothstep(0.0, 0.0022, dS0)) * 0.5 * spMid * spDetailMask;
  diffuseColor.rgb *= 1.0 - (1.0 - smoothstep(0.0028, 0.0045, dR0)) * smoothstep(0.002, 0.0028, dR0) * 0.35 * spMid * spDetailMask;
  float spChipH = -0.0004 * spChip * (1.0 - spFar);
  // scorch / soot from fire damage
  diffuseColor.rgb *= 1.0 - uSpBurn * smoothstep(0.3, 0.8, sp_noise3(vSpObj * 1.7)) * 0.85;
  // wet surfaces: darker and glossier
  float spWet = uSpWet * (1.0 - spBare * 0.5);
  diffuseColor.rgb *= mix(1.0, 0.6, spWet * clamp(roughnessFactor * 1.2, 0.0, 1.0));
  roughnessFactor = mix(roughnessFactor, 0.14, spWet * 0.85);
`);
      fs = inject(fs, '#include <normal_fragment_maps>', /* glsl */ `
  vec2 spdH = vec2(spH1 - spH0, spH2 - spH0) + vec2(dFdx(spChipH), dFdy(spChipH));
  normal = sp_perturb(-vViewPosition, normal, spdH, faceDirection);
`);
    } else {
      fs = inject(fs, '#include <metalnessmap_fragment>', /* glsl */ `
  float spWear = texture2D(roughnessMap, vRoughnessMapUv).a;
  diffuseColor.a = opacity;
  float spCov = clamp((spWear - 0.3) * 0.7, 0.0, 0.5);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.045, 0.04), spCov);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5), spCov * 0.4);
  diffuseColor.rgb *= 1.0 - uSpBurn * 0.6;
  diffuseColor.rgb *= mix(1.0, 0.6, uSpWet * clamp(roughnessFactor * 1.2, 0.0, 1.0));
  roughnessFactor = mix(roughnessFactor, 0.14, uSpWet * 0.85);
`);
    }
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => (detail ? 'seaplane-paint-v1' : 'seaplane-paintlod-v1');
  return m;
}

// ---------------------------------------------------------------------------
// Hardware: per-vertex material (colour + aMat) with procedural surface detail,
// spring wobble for soft items and lamp emission.
export function createHardMaterial(U, { detail = true, name = 'seaplane.hard' } = {}) {
  const m = new THREE.MeshStandardMaterial({ name, vertexColors: true, roughness: 1, metalness: 1, envMapIntensity: 1.0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSpWet = U.uSpWet;
    shader.uniforms.uSpWob = U.uSpWob;
    shader.uniforms.uSpLamp = U.uSpLamp;
    shader.uniforms.uSpBurn = U.uSpBurn;
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    if (detail) vs = injectRig(vs, U, shader);
    vs = inject(vs, '#include <common>', `attribute vec4 aMat;\nattribute vec4 aWob;\nuniform vec3 uSpWob[16];\nvarying vec4 vSpMat;\nvarying vec3 vSpObj;\nvarying vec2 vSpUv;`);
    vs = inject(vs, '#include <begin_vertex>', /* glsl */ `
  vSpMat = aMat;
  vSpObj = position;
  vSpUv = uv;
  ${detail ? `
  float spG = floor(aWob.w);
  if (spG > 0.5) {
    vec3 spTh = uSpWob[int(spG)];
    float spW = fract(aWob.w);
    vec3 spR = transformed - aWob.xyz;
    transformed += cross(spTh, spR) * spW;
  }` : ''}
`);
    fs = inject(fs, '#include <common>', `varying vec4 vSpMat;\nvarying vec3 vSpObj;\nvarying vec2 vSpUv;\nuniform float uSpWet;\nuniform float uSpLamp[8];\nuniform float uSpBurn;\n${GLSL_NOISE}\n${PERTURB}`);
    fs = inject(fs, '#include <metalnessmap_fragment>', /* glsl */ `
  float spKind = floor(vSpMat.z + 0.5);
  float spGrime = vSpMat.w;
  roughnessFactor = vSpMat.x;
  metalnessFactor = vSpMat.y;
  float spH = 0.0;
  vec3 spO = vSpObj;
  ${detail ? `
  vec2 spU = vSpUv;
  float spPx = max(length(dFdx(spO)), length(dFdy(spO)));
  float spFine = smoothstep(0.006, 0.002, spPx);
  float spD = sp_fbm3(spO * 3.1, 3);
  if (spKind == ${KIND.CANVAS.toFixed(1)}) {
    float weave = sin(spU.x * 2400.0) * sin(spU.y * 2400.0);
    spH += weave * 0.00012 * spFine;
    float stain = sp_fbm3(spO * 6.0 + 3.0, 3);
    diffuseColor.rgb *= 0.82 + 0.3 * stain;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.13, 0.09), smoothstep(0.55, 0.8, sp_fbm3(spO * 2.5 + 9.0, 3)) * 0.4 * spGrime);
    roughnessFactor = 0.92;
  } else if (spKind == ${KIND.ROPE.toFixed(1)}) {
    float tw = sin(spU.x * 260.0 + spU.y * 900.0);
    spH += tw * 0.0009 * spFine;
    diffuseColor.rgb *= 0.78 + 0.22 * tw + 0.2 * sp_noise3(spO * 30.0);
    roughnessFactor = 0.95;
  } else if (spKind == ${KIND.RUST.toFixed(1)}) {
    float r = sp_fbm3(spO * 9.0, 4);
    vec3 rustC = mix(vec3(0.13, 0.045, 0.015), vec3(0.32, 0.12, 0.035), sp_noise3(spO * 31.0));
    vec3 blue = vec3(0.09, 0.08, 0.1);
    diffuseColor.rgb = mix(diffuseColor.rgb, blue, smoothstep(0.4, 0.7, sp_noise3(spO * 4.0 + 2.0)) * 0.5);
    diffuseColor.rgb = mix(diffuseColor.rgb, rustC, smoothstep(0.35, 0.65, r));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012, 0.01, 0.009), smoothstep(0.5, 0.9, spGrime + (spD - 0.5)) * 0.8);
    metalnessFactor *= 1.0 - smoothstep(0.35, 0.6, r);
    roughnessFactor = mix(0.55, 0.92, smoothstep(0.3, 0.6, r));
    spH += (r - 0.5) * 0.0015 * spFine;
  } else if (spKind == ${KIND.RUBBER.toFixed(1)} || spKind == ${KIND.TREAD.toFixed(1)}) {
    diffuseColor.rgb *= 0.8 + 0.4 * sp_noise3(spO * 20.0);
    if (spKind == ${KIND.TREAD.toFixed(1)}) {
      float tr = step(0.5, fract(spU.x * 18.0 + step(0.5, fract(spU.y * 6.0)) * 0.5));
      spH += tr * 0.003;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.085, 0.06), (1.0 - tr) * 0.35);
    }
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.11, 0.08), smoothstep(0.5, 0.85, spD) * spGrime * 0.6);
  } else if (spKind == ${KIND.LEATHER.toFixed(1)}) {
    float grain = sp_noise3(spO * 260.0);
    float crack = 1.0 - smoothstep(0.0, 0.06, sp_cell2(spU * 30.0 + 2.0) - 0.0) ;
    spH += grain * 0.00025 * spFine - crack * 0.0006 * spGrime * spFine;
    float worn = smoothstep(0.45, 0.8, sp_fbm3(spO * 5.0, 3) + spGrime * 0.3);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.6 + vec3(0.03, 0.02, 0.01), worn * 0.5);
    diffuseColor.rgb *= 1.0 - crack * 0.5 * spGrime;
    roughnessFactor = mix(0.45, 0.8, worn);
  } else if (spKind == ${KIND.WOOD.toFixed(1)}) {
    float g = sin(spO.x * 40.0 + sp_fbm3(spO * vec3(2.0, 2.0, 12.0), 3) * 12.0);
    diffuseColor.rgb *= 0.75 + 0.25 * g;
    spH += g * 0.0004 * spFine;
  } else if (spKind == ${KIND.FABRIC.toFixed(1)}) {
    float q = sin(spU.x * 60.0) * sin(spU.y * 60.0);
    spH += q * 0.0015 * spFine;
    diffuseColor.rgb *= 0.85 + 0.15 * q + 0.2 * sp_noise3(spO * 15.0);
  } else if (spKind == ${KIND.LAMP.toFixed(1)}) {
    roughnessFactor = 0.06;
  } else if (spKind == ${KIND.STRAP.toFixed(1)}) {
    float w = sin(spU.x * 900.0);
    spH += w * 0.0001 * spFine;
    diffuseColor.rgb *= 0.85 + 0.15 * w + 0.25 * sp_noise3(spO * 12.0);
  } else if (spKind == ${KIND.CHROME.toFixed(1)}) {
    float ox = sp_fbm3(spO * 7.0, 4);
    float rs = smoothstep(0.62, 0.72, sp_fbm3(spO * 16.0 + 5.0, 3));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.18, 0.17, 0.15), smoothstep(0.45, 0.75, ox) * 0.7);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.07, 0.02), rs * 0.85);
    metalnessFactor = 1.0 - rs;
    roughnessFactor = clamp(0.16 + smoothstep(0.4, 0.8, ox) * 0.35 + rs * 0.5, 0.0, 1.0);
    float scr = smoothstep(0.9, 0.98, sp_noise3(spO * vec3(200.0, 200.0, 8.0)));
    roughnessFactor += scr * 0.2 * spFine;
    spH += (ox - 0.5) * 0.0004 + rs * 0.0003;
  } else {
    // painted / metal / plastic: scratches, smudges, chips
    float scr = smoothstep(0.92, 0.98, sp_noise3(spO * vec3(160.0, 6.0, 160.0)));
    float chipN = sp_fbm3(spO * 52.0, 3);
    float chip = (spKind == ${KIND.PAINTED.toFixed(1)}) ? smoothstep(0.8 - spGrime * 0.14, 0.83 - spGrime * 0.14, chipN) : 0.0;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.5, 0.48), chip);
    metalnessFactor = mix(metalnessFactor, 1.0, chip);
    roughnessFactor = mix(roughnessFactor, 0.3, chip);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.5 + 0.03, scr * 0.5 * spFine);
    roughnessFactor = clamp(roughnessFactor + (spD - 0.5) * 0.25 * spGrime, 0.05, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.04, 0.03), smoothstep(0.55, 0.9, spD) * spGrime * 0.55);
    spH -= chip * 0.0003;
  }` : ''}
  diffuseColor.rgb *= 1.0 - uSpBurn * 0.5;
  float spWet = uSpWet * step(spKind, ${KIND.TREAD.toFixed(1)}) * (1.0 - step(${KIND.LEATHER.toFixed(1)}, spKind) * step(spKind, ${KIND.LEATHER.toFixed(1)}));
  diffuseColor.rgb *= mix(1.0, 0.62, spWet * roughnessFactor);
  roughnessFactor = mix(roughnessFactor, 0.15, spWet * 0.8);
`);
    if (detail) {
      fs = inject(fs, '#include <normal_fragment_maps>', /* glsl */ `
  normal = sp_perturb(-vViewPosition, normal, vec2(dFdx(spH), dFdy(spH)), faceDirection);
`);
    }
    fs = inject(fs, '#include <emissivemap_fragment>', /* glsl */ `
  if (spKind == ${KIND.LAMP.toFixed(1)}) {
    int spLi = int(spGrime * 8.0 + 0.5);
    float spL = 0.0;
    for (int i = 0; i < 8; i++) if (i == spLi) spL = uSpLamp[i];
    totalEmissiveRadiance += diffuseColor.rgb * spL * 6.0;
  }
`);
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => (detail ? 'seaplane-hard-v1' : 'seaplane-hardlod-v1');
  return m;
}

// ---------------------------------------------------------------------------
// Glass: tinted, dusty, scratched; one pane cracked; rain droplets that the
// airflow pushes up and back across the windscreen.
export function createGlassMaterial(U, { detail = true } = {}) {
  const m = new THREE.MeshStandardMaterial({
    name: detail ? 'seaplane.glass' : 'seaplane.glassLod',
    color: 0x111719, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.16,
    side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.4,
  });
  m.forceSinglePass = true;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uSpRain: U.uSpRain, uSpFlow: U.uSpFlow, uSpStreak: U.uSpStreak, uSpShatter: U.uSpShatter, uSpTime: U.uSpTime });
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    vs = inject(vs, '#include <common>', 'attribute vec4 aGlass;\nvarying vec4 vSpGlass;\nvarying vec2 vSpUv;');
    vs = inject(vs, '#include <begin_vertex>', 'vSpGlass = aGlass;\nvSpUv = uv;');
    fs = inject(fs, '#include <common>', `varying vec4 vSpGlass;\nvarying vec2 vSpUv;\nuniform float uSpRain;\nuniform float uSpFlow;\nuniform float uSpStreak;\nuniform float uSpShatter;\nuniform float uSpTime;\n${GLSL_NOISE}\n${PERTURB}`);
    fs = inject(fs, '#include <metalnessmap_fragment>', /* glsl */ `
  vec2 spUv = vSpUv;
  float spPane = vSpGlass.x;
  float spEdge = min(min(spUv.x, 1.0 - spUv.x), min(spUv.y, 1.0 - spUv.y));
  float spDust = ((1.0 - smoothstep(0.0, 0.06, spEdge)) * 0.45 + smoothstep(0.5, 0.85, sp_fbm2(spUv * 7.0 + spPane * 3.1, 4)) * 0.35) * vSpGlass.z;
  float spScr = smoothstep(0.93, 0.985, sp_noise2(vec2(spUv.x * 3.0 + spUv.y * 1.3, spUv.y * 220.0 + spPane)));
  float spCrack = 0.0;
  ${detail ? `
  if (vSpGlass.y > 0.5) {
    vec2 c = vec2(0.66, 0.4);
    vec2 d = (spUv - c) * vec2(1.4, 1.0);
    float r = length(d);
    float a = atan(d.y, d.x);
    float n = 9.0 + floor(uSpShatter * 9.0);
    float k = floor(a / 6.2831853 * n + 0.5);
    float aj = (k + (sp_h21(vec2(k, 2.0)) - 0.5) * 0.5) * 6.2831853 / n;
    float jag = (sp_noise2(vec2(r * 30.0, k)) - 0.5) * 0.05;
    float dl = abs(sin(a - aj - jag)) * r;
    float reach = 0.25 + 0.6 * sp_h21(vec2(k, 5.0)) + uSpShatter * 0.6;
    float radial = (1.0 - smoothstep(0.0012, 0.0035, dl)) * (1.0 - smoothstep(reach * 0.8, reach, r));
    float rings = (1.0 - smoothstep(0.001, 0.003, abs(fract(r * (6.0 + uSpShatter * 10.0) + sp_noise2(vec2(a * 3.0, k)) * 0.3) - 0.5) * 0.06)) * (1.0 - smoothstep(0.08, 0.2 + uSpShatter * 0.5, r));
    float star = 1.0 - smoothstep(0.0, 0.025 + uSpShatter * 0.05, r);
    spCrack = clamp(radial + rings * 0.7 + star, 0.0, 1.0);
    spCrack = max(spCrack, uSpShatter * smoothstep(0.5, 0.75, sp_fbm2(spUv * 9.0, 3)) * 0.6);
  }` : ''}
  // rain: droplets drift with the airflow, streak at speed
  float spDropH = 0.0, spRim = 0.0, spLens = 0.0;
  if (uSpRain > 0.01 && vSpGlass.w > 0.5) {
    for (int L = 0; L < 2; L++) {
      float sc = L == 0 ? 11.0 : 19.0;
      vec2 g = spUv * vec2(sc * 1.3, sc) + vec2(spPane * 7.3, -uSpFlow * (L == 0 ? 1.0 : 1.4));
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5;
      vec2 rnd = sp_h22(id + float(L) * 31.0);
      float present = step(rnd.x, uSpRain * 0.9);
      float tw = fract(uSpTime * (0.05 + rnd.y * 0.1) + rnd.x);
      vec2 off = (rnd.yx - 0.5) * 0.55;
      vec2 dd = (f - off) * vec2(1.0, mix(1.0, 0.32, uSpStreak));
      float rad = (0.1 + 0.22 * rnd.y) * present * smoothstep(0.0, 0.15, tw) * (1.0 - smoothstep(0.85, 1.0, tw));
      float dr = length(dd);
      float drop = 1.0 - smoothstep(rad * 0.7, rad, dr);
      spDropH += drop * (1.0 - dr / max(rad, 1e-3)) * 0.0012;
      // bright rim + darker lens so droplets read against sky and cockpit alike
      float rr = dr / max(rad, 1e-3);
      spRim = max(spRim, drop * smoothstep(0.45, 0.95, rr));
      spLens = max(spLens, drop * (1.0 - smoothstep(0.2, 0.8, rr)));
    }
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.34, 0.3), clamp(spDust * 0.5 + spCrack * 0.8, 0.0, 1.0));
  // droplets: dark refracting lens with a bright rim (reads against sky and cabin alike)
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.06, 0.07), spLens * 0.6);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.83, 0.86), spRim * 0.6);
  diffuseColor.a = clamp(opacity + spDust * 0.14 + spCrack * 0.55 + spScr * 0.04 + spLens * 0.22 + spRim * 0.3, 0.0, 1.0);
  roughnessFactor = clamp(roughnessFactor + spDust * 0.3 + spScr * 0.25, 0.0, 1.0);
`);
    fs = inject(fs, '#include <normal_fragment_maps>', /* glsl */ `
  normal = sp_perturb(-vViewPosition, normal, vec2(dFdx(spDropH), dFdy(spDropH)) * 2.0, faceDirection);
`);
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => (detail ? 'seaplane-glass-v1' : 'seaplane-glasslod-v1');
  return m;
}

// Placeholder textures so materials compile with their final defines before the bake.
export function placeholderTextures() {
  const a = new THREE.DataTexture(new Uint8Array([200, 150, 30, 255]), 1, 1);
  a.colorSpace = THREE.SRGBColorSpace;
  a.needsUpdate = true;
  const d = new THREE.DataTexture(new Uint8Array([255, 150, 0, 128]), 1, 1);
  d.needsUpdate = true;
  return { map: a, data: d };
}

// Instrument faces (canvas atlas) with backlighting, rig-capable for rotating cards.
export function createGaugeMaterial(U, map, { name = 'seaplane.gauges', rig = true } = {}) {
  const m = new THREE.MeshStandardMaterial({
    name, map, emissiveMap: map, emissive: new THREE.Color(1.0, 0.62, 0.32), emissiveIntensity: 0,
    roughness: 0.55, metalness: 0.0, envMapIntensity: 0.6,
    alphaTest: 0.5, // the attitude face has a see-through window onto the horizon card
  });
  if (rig) {
    m.onBeforeCompile = (shader) => { shader.vertexShader = injectRig(shader.vertexShader, U, shader); };
    m.customProgramCacheKey = () => 'seaplane-gauge-rig-v1';
  } else {
    m.customProgramCacheKey = () => 'seaplane-gauge-v1';
  }
  return m;
}
