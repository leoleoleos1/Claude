// Shared GLSL snippets: hashes, value noise / fBm and the riveted panel grid.
// Used by the GPU texture bake and by the runtime materials (onBeforeCompile).

export const GLSL_NOISE = /* glsl */ `
float sp_h21(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1137));
  p += dot(p, p.yx + 19.19);
  return fract(p.x * p.y * 1.7313 + p.x * 0.5131);
}
float sp_h31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1137, 0.1219));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z * 1.3127 + p.x * 0.7131);
}
vec2 sp_h22(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1137, 0.1219));
  q += dot(q, q.yzx + 19.19);
  return fract((q.xx + q.yz) * q.zy);
}
float sp_noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = sp_h21(i), b = sp_h21(i + vec2(1.0, 0.0));
  float c = sp_h21(i + vec2(0.0, 1.0)), d = sp_h21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float sp_noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = sp_h31(i), n100 = sp_h31(i + vec3(1.0, 0.0, 0.0));
  float n010 = sp_h31(i + vec3(0.0, 1.0, 0.0)), n110 = sp_h31(i + vec3(1.0, 1.0, 0.0));
  float n001 = sp_h31(i + vec3(0.0, 0.0, 1.0)), n101 = sp_h31(i + vec3(1.0, 0.0, 1.0));
  float n011 = sp_h31(i + vec3(0.0, 1.0, 1.0)), n111 = sp_h31(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float sp_fbm2(vec2 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * sp_noise2(p);
    p = p * 2.03 + vec2(17.13, 9.71);
    a *= 0.5;
  }
  return s;
}
float sp_fbm3(vec3 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * sp_noise3(p);
    p = p * 2.03 + vec3(17.13, 9.71, 3.17);
    a *= 0.5;
  }
  return s;
}
// Voronoi-ish cellular distance (F1) in 2D
float sp_cell2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = sp_h22(i + g);
    vec2 r = g + o - f;
    d = min(d, dot(r, r));
  }
  return sqrt(d);
}
`;

// Panel grid in panel space q (metres). Seams every SP_PANEL; rivet rows run
// beside every seam (some lines doubled). Returns height (m) of seams, rivets
// and oil-canning; writes the distance to the nearest seam and rivet.
export const GLSL_PANEL = /* glsl */ `
const vec2 SP_PANEL = vec2(0.82, 0.46);
const float SP_RIVET = 0.042;
float sp_panelHeight(vec2 q, float fineFade, out float dSeam, out float dRivet, out float panelId) {
  vec2 c = q / SP_PANEL;
  vec2 cell = floor(c);
  vec2 f = c - cell;
  panelId = sp_h21(cell + 3.7);
  // seam lines at cell borders
  vec2 du = vec2(min(f.x, 1.0 - f.x) * SP_PANEL.x, min(f.y, 1.0 - f.y) * SP_PANEL.y);
  dSeam = min(du.x, du.y);
  float h = -0.00045 * (1.0 - smoothstep(0.0003, 0.0016, dSeam)) * fineFade;
  // oil-canning: panels pillow in or out a little
  float pill = sin(3.14159 * f.x) * sin(3.14159 * f.y);
  h += (panelId > 0.5 ? 0.0011 : -0.0009) * pill;
  // rivets: rows 11 mm beside the vertical (u) and horizontal (v) lines
  float uk = floor(c.x + 0.5) * SP_PANEL.x;
  float vk = floor(c.y + 0.5) * SP_PANEL.y;
  float dblU = step(0.62, sp_h21(vec2(floor(c.x + 0.5), 7.1)));
  float dblV = step(0.62, sp_h21(vec2(13.3, floor(c.y + 0.5))));
  float vm = (floor(q.y / SP_RIVET) + 0.5) * SP_RIVET;
  float um = (floor(q.x / SP_RIVET) + 0.5) * SP_RIVET;
  float d1 = length(vec2(q.x - (uk + 0.011), q.y - vm));
  float d1b = mix(1.0, length(vec2(q.x - (uk - 0.017), q.y - vm)), dblU);
  float d2 = length(vec2(q.x - um, q.y - (vk + 0.011)));
  float d2b = mix(1.0, length(vec2(q.x - um, q.y - (vk - 0.017))), dblV);
  dRivet = min(min(d1, d1b), min(d2, d2b));
  float rr = 0.0029;
  float dome = max(1.0 - (dRivet * dRivet) / (rr * rr), 0.0);
  h += 0.0009 * sqrt(dome) * fineFade;
  return h;
}
`;
