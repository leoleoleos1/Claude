/*
 * World simulation: bird physics, pipe generation, collisions, scoring and
 * particles. Pure logic — no DOM, rendering or audio — and always advanced
 * with the same fixed timestep, so results don't depend on frame rate or
 * screen size.
 *
 * Coordinates: logical pixels. The bird stays at a fixed screen x; the world
 * scrolls instead. Pipes store a *world* x, and their screen x is
 * `pipe.x - scroll`. Rendering interpolates between the previous and current
 * step using the stored `prev*` values.
 */
(function (ns) {
  'use strict';

  var U = ns.Util;

  function World(cfg) {
    this.cfg = cfg;
    this.groundY = cfg.height - cfg.groundHeight;
    // Forgiving circular hitbox: a bit smaller than the drawn sprite (beak and
    // tail tips don't count), and independent of the bird's rotation.
    this.hitRadius = cfg.birdSize.height * cfg.birdHitboxRatio;
    this.reset();
  }

  World.prototype.reset = function (seed) {
    var cfg = this.cfg;
    this.rng = U.mulberry32(seed === undefined ? (Math.random() * 4294967296) >>> 0 : seed);
    this.time = 0;
    this.scroll = 0;
    this.prevScroll = 0;
    this.bird = {
      x: cfg.birdX,
      y: cfg.readyY,
      prevY: cfg.readyY,
      vy: 0,
      angle: 0,
      prevAngle: 0,
      wingTime: 0,
      onGround: false
    };
    this.pipes = [];
    this.nextPipeX = 0;
    this.lastGapY = null;
    this.score = 0;
    this.particles = [];
  };

  // Remember the state before a step so rendering can interpolate.
  World.prototype.snapshot = function () {
    this.prevScroll = this.scroll;
    this.bird.prevY = this.bird.y;
    this.bird.prevAngle = this.bird.angle;
  };

  // --- Ready (title) screen ---------------------------------------------------
  World.prototype.updateReady = function (dt) {
    var cfg = this.cfg, b = this.bird;
    this.time += dt;
    this.scroll += cfg.scrollSpeed * dt;
    b.y = cfg.readyY + Math.sin(this.time * Math.PI * 2 * cfg.hoverFrequency) * cfg.hoverAmplitude;
    b.angle = 0;
    b.wingTime += dt;
  };

  // Called on the transition Ready -> Playing.
  World.prototype.beginRun = function () {
    // Leave a run-up before the first obstacle.
    this.nextPipeX = this.scroll + this.cfg.width + this.cfg.firstPipeDistance;
    this.bird.vy = 0;
  };

  // A flap *sets* the vertical velocity (it does not add to it), so mashing
  // can never build up unlimited upward speed.
  World.prototype.flap = function () {
    this.bird.vy = this.cfg.flapVelocity;
    this.bird.wingTime = 0;
  };

  // --- Playing ----------------------------------------------------------------
  // Returns { scored: number, hit: null | 'pipe' | 'ground' | 'ceiling' }.
  World.prototype.updatePlaying = function (dt) {
    var cfg = this.cfg, b = this.bird;
    var result = { scored: 0, hit: null };
    this.time += dt;
    b.wingTime += dt;

    // 1. Scroll the world and manage the pipe queue.
    this.scroll += cfg.scrollSpeed * dt;
    this.spawnPipes();
    this.cullPipes();

    // 2. Semi-implicit Euler: update velocity first, then position.
    this.integrateBird(dt);
    this.updateRotation(dt, false);

    // 3. Collisions. Any contact ends the run immediately.
    var r = this.hitRadius;
    if (b.y - r <= 0) {
      b.y = r;
      result.hit = 'ceiling';
    } else if (b.y + r >= this.groundY) {
      b.y = this.groundY - r;
      b.onGround = true;
      result.hit = 'ground';
    } else if (this.hitsPipe()) {
      result.hit = 'pipe';
    }
    if (result.hit) return result;

    // 4. Scoring: a pair counts once the hitbox has completely cleared its
    //    right edge (cap included), i.e. once it can no longer be touched.
    var birdLeft = b.x - r;
    for (var i = 0; i < this.pipes.length; i++) {
      var p = this.pipes[i];
      if (!p.scored && birdLeft > p.x - this.scroll + cfg.pipeWidth + cfg.pipeCapOverhang) {
        p.scored = true; // guarantees exactly one point per pair
        this.score++;
        result.scored++;
      }
    }
    return result;
  };

  World.prototype.integrateBird = function (dt) {
    var b = this.bird;
    b.vy = Math.min(b.vy + this.cfg.gravity * dt, this.cfg.maxFallSpeed);
    b.y += b.vy * dt;
  };

  // Tilt up immediately after a flap; once the bird is falling faster than
  // noseDownSpeed, tip forward gradually until it points straight down.
  World.prototype.updateRotation = function (dt, dead) {
    var cfg = this.cfg, b = this.bird;
    var target;
    if (dead) {
      target = cfg.noseDownAngle;
    } else if (b.vy < cfg.noseDownSpeed) {
      target = cfg.noseUpAngle;
    } else {
      var t = (b.vy - cfg.noseDownSpeed) / (cfg.maxFallSpeed - cfg.noseDownSpeed);
      target = U.lerp(cfg.noseUpAngle, cfg.noseDownAngle, U.clamp(t, 0, 1));
    }
    var rate = target < b.angle ? 22 : (dead ? 9 : 6);
    b.angle += (target - b.angle) * (1 - Math.exp(-rate * dt));
  };

  // --- Pipes --------------------------------------------------------------------
  World.prototype.spawnPipes = function () {
    var cfg = this.cfg;
    while (this.nextPipeX < this.scroll + cfg.width + cfg.pipeCapOverhang) {
      this.pipes.push({ x: this.nextPipeX, gapY: this.nextGapY(), scored: false });
      this.nextPipeX += cfg.pipeSpacing;
    }
  };

  // Remove pairs once they are entirely off the left edge.
  World.prototype.cullPipes = function () {
    var cfg = this.cfg;
    var minX = this.scroll - cfg.pipeWidth - cfg.pipeCapOverhang * 2;
    while (this.pipes.length && this.pipes[0].x < minX) this.pipes.shift();
  };

  // Random opening centre, always at least pipeMarginTop/Bottom from the
  // edges, and never more than pipeMaxGapShift away from the previous opening
  // so every sequence is physically reachable.
  World.prototype.nextGapY = function () {
    var cfg = this.cfg;
    var half = cfg.pipeGap / 2;
    var minY = cfg.pipeMarginTop + half;
    var maxY = this.groundY - cfg.pipeMarginBottom - half;
    var lo, hi;
    if (this.lastGapY === null) {
      // First opening near the middle for a fair start.
      var mid = (minY + maxY) / 2;
      lo = Math.max(minY, mid - 60);
      hi = Math.min(maxY, mid + 60);
    } else {
      lo = Math.max(minY, this.lastGapY - cfg.pipeMaxGapShift);
      hi = Math.min(maxY, this.lastGapY + cfg.pipeMaxGapShift);
    }
    var y = Math.round(lo + this.rng() * (hi - lo));
    this.lastGapY = y;
    return y;
  };

  // The rectangles a pipe pair occupies on screen (bodies + wider caps).
  World.prototype.pipeRects = function (p) {
    var cfg = this.cfg;
    var x = p.x - this.scroll;
    var w = cfg.pipeWidth, ov = cfg.pipeCapOverhang, capH = cfg.pipeCapHeight;
    var gapTop = p.gapY - cfg.pipeGap / 2;
    var gapBottom = p.gapY + cfg.pipeGap / 2;
    return [
      { x: x, y: -1000, w: w, h: gapTop - capH + 1000 },                      // upper body (extends above screen)
      { x: x - ov, y: gapTop - capH, w: w + ov * 2, h: capH },               // upper cap
      { x: x - ov, y: gapBottom, w: w + ov * 2, h: capH },                    // lower cap
      { x: x, y: gapBottom + capH, w: w, h: this.groundY - gapBottom - capH } // lower body
    ];
  };

  World.prototype.hitsPipe = function () {
    var b = this.bird, r = this.hitRadius, cfg = this.cfg;
    for (var i = 0; i < this.pipes.length; i++) {
      var p = this.pipes[i];
      var sx = p.x - this.scroll;
      // Broad phase: skip pairs that are horizontally out of reach.
      if (sx - cfg.pipeCapOverhang > b.x + r || sx + cfg.pipeWidth + cfg.pipeCapOverhang < b.x - r) continue;
      var rects = this.pipeRects(p);
      for (var j = 0; j < rects.length; j++) {
        var q = rects[j];
        if (U.circleRect(b.x, b.y, r, q.x, q.y, q.w, q.h)) return true;
      }
    }
    return false;
  };

  // --- After a collision ---------------------------------------------------------
  // The world is frozen; only the bird falls to the ground. Returns true on the
  // step it lands.
  World.prototype.updateDying = function (dt) {
    var b = this.bird;
    this.time += dt;
    if (b.onGround) {
      this.updateRotation(dt, true);
      return false;
    }
    if (b.vy < 0) b.vy = 0; // no more lift once dead
    this.integrateBird(dt);
    this.updateRotation(dt, true);
    var rest = this.groundY - this.hitRadius;
    if (b.y >= rest) {
      b.y = rest;
      b.vy = 0;
      b.onGround = true;
      return true;
    }
    return false;
  };

  // --- Particles (purely cosmetic) ------------------------------------------------
  World.prototype.emit = function (x, y, count, colors, spread, lift) {
    for (var i = 0; i < count && this.particles.length < this.cfg.maxParticles; i++) {
      var ang = Math.random() * Math.PI * 2;
      var speed = spread * (0.4 + Math.random() * 0.6);
      var life = 0.45 + Math.random() * 0.45;
      this.particles.push({
        x: x, y: y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - lift,
        life: life, maxLife: life,
        size: Math.random() < 0.5 ? 4 : 2,
        color: colors[(Math.random() * colors.length) | 0]
      });
    }
  };

  World.prototype.updateParticles = function (dt) {
    var list = this.particles;
    for (var i = list.length - 1; i >= 0; i--) {
      var p = list[i];
      p.life -= dt;
      if (p.life <= 0) { list.splice(i, 1); continue; }
      p.vx *= Math.exp(-2.5 * dt);
      p.vy += 500 * dt;
      p.x += p.vx * dt;
      p.y = Math.min(p.y + p.vy * dt, this.groundY);
    }
  };

  ns.World = World;
})(globalThis.Flapling = globalThis.Flapling || {});
