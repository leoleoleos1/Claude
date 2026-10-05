/*
 * Time of day. A run starts at midday; every pipe passed moves the clock a
 * little further (CONFIG.dayCyclePipes pipes = one full day → night → day).
 *
 * `sample(phase)` turns a phase (any real number; only the fractional part
 * matters) into everything the renderer needs: sky gradient colours, a tint
 * for the scenery, star visibility and sun / moon positions. Pure function,
 * no DOM access.
 */
(function (ns) {
  'use strict';

  function hex(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }

  // Sky keyframes. top / mid / bot = sky gradient; tint = multiply colour
  // applied to scenery; stars = 0..1 visibility. The last key wraps to the first.
  var KEYS = [
    { t: 0.00, top: '#3d98e0', mid: '#74c2f0', bot: '#bde8fa', tint: '#ffffff', stars: 0 },   // midday
    { t: 0.12, top: '#3f8fd8', mid: '#80c0ea', bot: '#dcecec', tint: '#fff3e2', stars: 0 },   // afternoon
    { t: 0.21, top: '#4a6fc0', mid: '#e6a07a', bot: '#ffd78a', tint: '#ffd6aa', stars: 0 },   // golden hour
    { t: 0.28, top: '#3a3f8f', mid: '#d9707a', bot: '#ffb36b', tint: '#f2a48f', stars: 0.1 }, // sunset
    { t: 0.35, top: '#1c2260', mid: '#56408a', bot: '#c0708a', tint: '#9c88c2', stars: 0.55 },// dusk
    { t: 0.42, top: '#0b1030', mid: '#16204a', bot: '#2c3c70', tint: '#5c6aa8', stars: 1 },   // night
    { t: 0.60, top: '#0b1030', mid: '#16204a', bot: '#2c3c70', tint: '#5c6aa8', stars: 1 },   // night
    { t: 0.67, top: '#1a2458', mid: '#4a4a8c', bot: '#b0709a', tint: '#8c86bc', stars: 0.6 }, // before dawn
    { t: 0.74, top: '#4a6ab8', mid: '#e0a0b8', bot: '#ffd0a8', tint: '#f4c6c8', stars: 0.1 }, // dawn
    { t: 0.84, top: '#4fa3e6', mid: '#94cdf0', bot: '#f0ead6', tint: '#fff2ea', stars: 0 },   // morning
    { t: 1.00, top: '#3d98e0', mid: '#74c2f0', bot: '#bde8fa', tint: '#ffffff', stars: 0 }    // midday
  ].map(function (k) {
    return { t: k.t, top: hex(k.top), mid: hex(k.mid), bot: hex(k.bot), tint: hex(k.tint), stars: k.stars };
  });

  // Paths of the sun and moon across the play area (logical px), keyed by phase.
  // Phases beyond 1 continue past midnight-wrap. Points below ~y 480 sink
  // behind the distant clouds and hills, so rising and setting look natural.
  var SUN = [[0.70, 20, 560], [0.78, 60, 400], [0.88, 160, 280], [1.0, 262, 236], [1.12, 300, 290], [1.24, 318, 420], [1.32, 330, 560]];
  var MOON = [[0.28, 30, 560], [0.36, 70, 380], [0.46, 150, 250], [0.56, 240, 230], [0.66, 300, 330], [0.76, 336, 560]];

  function mix(a, b, f) {
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  function smooth(f) { return f * f * (3 - 2 * f); }
  function frac(p) { return ((p % 1) + 1) % 1; }

  // Catmull-Rom interpolation along a keyed path; null when off the path.
  function pathPoint(path, phase) {
    var p = frac(phase);
    if (p < path[0][0]) p += 1;
    if (p > path[path.length - 1][0]) return null;
    for (var i = 0; i < path.length - 1; i++) {
      var a = path[i], b = path[i + 1];
      if (p > b[0]) continue;
      var f = (p - a[0]) / (b[0] - a[0]);
      var a0 = path[Math.max(0, i - 1)], b1 = path[Math.min(path.length - 1, i + 2)];
      var cr = function (k) {
        var p0 = a0[k], p1 = a[k], p2 = b[k], p3 = b1[k];
        return 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
      };
      return { x: cr(1), y: cr(2) };
    }
    return null;
  }

  function sample(phase) {
    var p = frac(phase);
    var i = 0;
    while (i < KEYS.length - 2 && p >= KEYS[i + 1].t) i++;
    var a = KEYS[i], b = KEYS[i + 1];
    var f = smooth((p - a.t) / (b.t - a.t));
    return {
      phase: p,
      top: mix(a.top, b.top, f),
      mid: mix(a.mid, b.mid, f),
      bot: mix(a.bot, b.bot, f),
      tint: mix(a.tint, b.tint, f),
      stars: a.stars + (b.stars - a.stars) * f,
      sun: pathPoint(SUN, p),
      moon: pathPoint(MOON, p)
    };
  }

  // n sky band colours from top to horizon.
  function bands(s, n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1);
      out.push(t < 0.5 ? mix(s.top, s.mid, t * 2) : mix(s.mid, s.bot, (t - 0.5) * 2));
    }
    return out;
  }

  function css(c) { return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')'; }

  ns.DayCycle = { sample: sample, bands: bands, css: css, mix: mix };
})(globalThis.Flapling = globalThis.Flapling || {});
