/* Small math / helper functions shared by every module. */
(function (ns) {
  'use strict';

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutBack(t) {
    var c1 = 1.4, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  // Deterministic PRNG (mulberry32) so pipe layouts and procedural art are reproducible.
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Circle vs axis-aligned rectangle overlap test: find the point of the
  // rectangle closest to the circle centre and compare its distance to r.
  function circleRect(cx, cy, r, rx, ry, rw, rh) {
    var nx = clamp(cx, rx, rx + rw);
    var ny = clamp(cy, ry, ry + rh);
    var dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  ns.Util = {
    clamp: clamp,
    lerp: lerp,
    easeOutCubic: easeOutCubic,
    easeOutBack: easeOutBack,
    mulberry32: mulberry32,
    circleRect: circleRect
  };
})(globalThis.Flapling = globalThis.Flapling || {});
