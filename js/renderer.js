/*
 * Canvas renderer. Draws the current game state in logical 360×640
 * coordinates; a single transform maps them onto the (high-DPI) backing
 * store. Rendering never changes game state.
 */
(function (ns) {
  'use strict';

  var U = ns.Util, Font = ns.Font, LAYOUT = ns.LAYOUT, Day = ns.DayCycle;
  var State = ns.Game.State;
  var WHITE = [255, 255, 255];

  var INK = '#2b1d14';
  var TITLE_FILL = ['#fff6c4', '#ffe066', '#ffd23f', '#ffb52e', '#ff9a2e', '#ff7f2a', '#f0631f'];

  function Renderer(canvas, assets, cfg) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.assets = assets;
    this.cfg = cfg;
    this.kx = 1;
    this.ky = 1;
    this.birdCache = new Map();

    // Scenery is tinted to the time of day. Each source image gets its own
    // tinted copy, refreshed only when the tint colour actually changes.
    var make = function (src) { return { src: src, out: ns.Sprites.makeCanvas(src.width, src.height).canvas }; };
    this.tinted = {
      layers: assets.layers.map(function (L) { return make(L.canvas); }),
      body: make(assets.pipe.body),
      neck: make(assets.pipe.neck),
      cap: make(assets.pipe.cap),
      ground: make(assets.ground.canvas)
    };
    this.tintKey = '';

    // Fixed star field and fireflies (positions are seeded, so stable).
    var rng = U.mulberry32(77);
    this.stars = [];
    for (var i = 0; i < 70; i++) {
      this.stars.push({ x: Math.floor(rng() * 180) * 2, y: Math.floor(rng() * 210) * 2, big: rng() < 0.12, ph: rng() * 6.28 });
    }
    this.fireflies = [];
    for (i = 0; i < 14; i++) {
      this.fireflies.push({ x: rng() * cfg.width, y: 440 + rng() * 80, ph: rng() * 6.28 });
    }
  }

  // Multiply a canvas by a colour while keeping its transparency.
  function tintInto(t, color) {
    var x = t.out.getContext('2d');
    var w = t.out.width, h = t.out.height;
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, w, h);
    x.drawImage(t.src, 0, 0);
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = color;
    x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(t.src, 0, 0);
    x.globalCompositeOperation = 'source-over';
  }

  Renderer.prototype.applyTint = function (tint) {
    var key = Math.round(tint[0]) + ',' + Math.round(tint[1]) + ',' + Math.round(tint[2]);
    if (key === this.tintKey) return;
    this.tintKey = key;
    var scenery = Day.css(tint);
    // Pipes and ground are closer to the viewer, so they darken less.
    var near = Day.css(Day.mix(tint, WHITE, 0.3));
    var T = this.tinted;
    T.layers.forEach(function (t) { tintInto(t, scenery); });
    tintInto(T.body, near);
    tintInto(T.neck, near);
    tintInto(T.cap, near);
    tintInto(T.ground, near);
  };

  // Bird frames for a colour / hat combination, built once and cached.
  Renderer.prototype.birdFrames = function (colorIdx, hatIdx) {
    var key = colorIdx + ':' + hatIdx;
    var frames = this.birdCache.get(key);
    if (!frames) {
      frames = ns.Sprites.buildBird(ns.Skins.colors[colorIdx], ns.Skins.hats[hatIdx]);
      this.birdCache.set(key, frames);
    }
    return frames;
  };

  // kx/ky: device pixels per logical pixel.
  Renderer.prototype.setScale = function (kx, ky) {
    this.kx = kx;
    this.ky = ky;
  };

  // Round to whole device pixels to avoid shimmering seams while scrolling.
  Renderer.prototype.snapX = function (x) { return Math.round(x * this.kx) / this.kx; };
  Renderer.prototype.snapY = function (y) { return Math.round(y * this.ky) / this.ky; };

  Renderer.prototype.render = function (game, alpha) {
    var ctx = this.ctx, cfg = this.cfg, w = game.world;
    var paused = game.state === State.PAUSED;
    var t = paused ? 1 : alpha; // nothing moves while paused

    ctx.setTransform(this.kx, 0, 0, this.ky, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;

    var sky = Day.sample(game.dayPhase);
    this.applyTint(sky.tint);

    // Overscan fill so screen shake never reveals empty canvas.
    ctx.fillStyle = Day.css(sky.top);
    ctx.fillRect(0, 0, cfg.width, cfg.height);

    var scroll = U.lerp(w.prevScroll, w.scroll, t);

    ctx.save();
    if (game.fx.shake > 0 && !game.reducedMotion) {
      var k = game.fx.shake / cfg.shakeTime;
      var amp = cfg.shakeAmplitude * k * k;
      ctx.translate(this.snapX((Math.random() * 2 - 1) * amp), this.snapY((Math.random() * 2 - 1) * amp));
    }
    this.drawBackground(scroll, sky, game);
    this.drawPipes(w, scroll);
    if (game.state !== State.CUSTOMIZE) this.drawBird(game, t);
    this.drawGround(scroll);
    this.drawParticles(w);
    ctx.restore();

    switch (game.state) {
      case State.READY: this.drawReady(game); break;
      case State.CUSTOMIZE: this.drawCustomize(game); break;
      case State.PLAYING:
      case State.DYING: this.drawScore(game); break;
      case State.PAUSED: this.drawScore(game); this.drawPaused(game); break;
      case State.GAME_OVER: this.drawGameOver(game); break;
    }

    if (game.fx.flash > 0) {
      var peak = game.reducedMotion ? cfg.reducedFlashAlpha : cfg.flashAlpha;
      ctx.globalAlpha = peak * (game.fx.flash / cfg.flashTime);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cfg.width, cfg.height);
      ctx.globalAlpha = 1;
    }
  };

  // --- World ---------------------------------------------------------------------
  Renderer.prototype.drawBackground = function (scroll, sky, game) {
    var ctx = this.ctx, cfg = this.cfg, a = cfg.artScale, H = cfg.height;

    // Sky: stepped bands with a dithered seam, coloured for the time of day.
    var bands = Day.bands(sky, 11);
    var bandH = 50;
    for (var i = 0; i < bands.length; i++) {
      ctx.fillStyle = Day.css(bands[i]);
      var top = i === 0 ? -8 : i * bandH;
      ctx.fillRect(-8, top, cfg.width + 16, i === bands.length - 1 ? H : (i + 1) * bandH - top);
      if (i + 1 < bands.length) {
        ctx.fillStyle = Day.css(bands[i + 1]);
        for (var x = 0; x < cfg.width; x += 4) ctx.fillRect(x, (i + 1) * bandH - 2, 2, 2);
      }
    }

    this.drawStars(sky, game);
    if (sky.moon) this.drawMoon(sky.moon);
    if (sky.sun) this.drawSun(sky.sun);

    // Parallax scenery (tinted copies).
    var layers = this.assets.layers, T = this.tinted.layers;
    for (i = 0; i < layers.length; i++) {
      var lw = layers[i].canvas.width * a;
      var off = this.snapX(-((scroll * layers[i].factor) % lw));
      for (x = off > -8 ? off - lw : off; x < cfg.width + 8; x += lw) ctx.drawImage(T[i].out, x, 0, lw, H);
    }
    this.drawFireflies(sky, game, scroll);
  };

  // Blocky disc on the 2 px art grid (sun, moon, glows).
  Renderer.prototype.pixelDisc = function (cx, cy, r, color) {
    var ctx = this.ctx;
    ctx.fillStyle = color;
    for (var dy = -r; dy < r; dy += 2) {
      var yy = dy + 1;
      var half = Math.round(Math.sqrt(Math.max(0, r * r - yy * yy)) / 2) * 2;
      if (half > 0) ctx.fillRect(cx - half, cy + dy, half * 2, 2);
    }
  };

  Renderer.prototype.drawSun = function (p) {
    var ctx = this.ctx;
    var x = Math.round(p.x / 2) * 2, y = Math.round(p.y / 2) * 2;
    // Redder and with a bigger halo as it sinks towards the horizon.
    var low = U.clamp((y - 240) / 220, 0, 1);
    var core = Day.mix([255, 244, 196], [255, 140, 70], low);
    ctx.globalAlpha = 0.1 + low * 0.12;
    this.pixelDisc(x, y, 50 + Math.round(low * 14 / 2) * 2, Day.css(Day.mix(core, WHITE, 0.4)));
    ctx.globalAlpha = 0.18 + low * 0.1;
    this.pixelDisc(x, y, 32, Day.css(Day.mix(core, WHITE, 0.3)));
    ctx.globalAlpha = 1;
    this.pixelDisc(x, y, 20, Day.css(core));
    this.pixelDisc(x - 2, y - 2, 12, Day.css(Day.mix(core, WHITE, 0.55)));
  };

  Renderer.prototype.drawMoon = function (p) {
    var ctx = this.ctx;
    var x = Math.round(p.x / 2) * 2, y = Math.round(p.y / 2) * 2;
    ctx.globalAlpha = 0.08;
    this.pixelDisc(x, y, 36, '#dfe8ff');
    ctx.globalAlpha = 0.14;
    this.pixelDisc(x, y, 24, '#dfe8ff');
    ctx.globalAlpha = 1;
    this.pixelDisc(x, y, 16, '#f4f0da');
    ctx.fillStyle = '#d8d1b2';
    ctx.fillRect(x - 8, y - 6, 6, 4);
    ctx.fillRect(x + 2, y + 2, 6, 6);
    ctx.fillRect(x - 4, y + 6, 4, 2);
    ctx.fillRect(x + 6, y - 8, 2, 2);
  };

  Renderer.prototype.drawStars = function (sky, game) {
    if (sky.stars <= 0.01) return;
    var ctx = this.ctx, t = game.clock;
    ctx.fillStyle = '#ffffff';
    for (var i = 0; i < this.stars.length; i++) {
      var st = this.stars[i];
      var tw = game.reducedMotion ? 0.8 : 0.55 + 0.45 * Math.sin(t * 1.8 + st.ph);
      ctx.globalAlpha = sky.stars * tw;
      if (st.big) {
        ctx.fillRect(st.x - 2, st.y, 6, 2);
        ctx.fillRect(st.x, st.y - 2, 2, 6);
      } else {
        ctx.fillRect(st.x, st.y, 2, 2);
      }
    }
    // Shooting star.
    var m = game.fx.meteor;
    if (m) {
      var k = m.life / m.maxLife;
      for (var j = 0; j < 10; j++) {
        ctx.globalAlpha = sky.stars * k * (1 - j / 10);
        ctx.fillRect(Math.round((m.x + j * 6) / 2) * 2, Math.round((m.y - j * 2.8) / 2) * 2, 2, 2);
      }
    }
    ctx.globalAlpha = 1;
  };

  Renderer.prototype.drawFireflies = function (sky, game, scroll) {
    var glow = U.clamp((sky.stars - 0.3) / 0.7, 0, 1);
    if (glow <= 0) return;
    var ctx = this.ctx, t = game.clock, W = this.cfg.width + 40;
    for (var i = 0; i < this.fireflies.length; i++) {
      var f = this.fireflies[i];
      var x = (((f.x - scroll * 0.6) % W) + W) % W - 20;
      var y = f.y;
      if (!game.reducedMotion) {
        x += Math.sin(t * 0.7 + f.ph * 2) * 8;
        y += Math.sin(t * 1.3 + f.ph) * 6;
      }
      var blink = 0.35 + 0.65 * Math.max(0, Math.sin(t * 2.4 + f.ph * 3));
      x = Math.round(x / 2) * 2; y = Math.round(y / 2) * 2;
      ctx.globalAlpha = glow * blink * 0.3;
      ctx.fillStyle = '#d8ff7a';
      ctx.fillRect(x - 2, y - 2, 6, 6);
      ctx.globalAlpha = glow * blink;
      ctx.fillStyle = '#f6ffbe';
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;
  };

  Renderer.prototype.drawPipes = function (w, scroll) {
    var ctx = this.ctx, cfg = this.cfg, a = cfg.artScale;
    var img = { body: this.tinted.body.out, neck: this.tinted.neck.out, cap: this.tinted.cap.out };
    var pw = cfg.pipeWidth, ov = cfg.pipeCapOverhang, capH = cfg.pipeCapHeight;
    var neckH = img.neck.height * a;
    for (var i = 0; i < w.pipes.length; i++) {
      var p = w.pipes[i];
      var x = this.snapX(p.x - scroll);
      if (x > cfg.width + ov || x + pw + ov < 0) continue;
      var gapTop = p.gapY - cfg.pipeGap / 2;
      var gapBottom = p.gapY + cfg.pipeGap / 2;
      // Upper pipe (hangs from the top, cap at its lower end).
      var topBodyH = gapTop - capH;
      if (topBodyH > 0) ctx.drawImage(img.body, x, -8, pw, topBodyH + 8);
      ctx.drawImage(img.neck, x, gapTop - capH - neckH, pw, neckH);
      ctx.drawImage(img.cap, x - ov, gapTop - capH, pw + ov * 2, capH);
      // Lower pipe (stands on the ground, cap at its upper end).
      var botY = gapBottom + capH;
      ctx.drawImage(img.body, x, botY, pw, w.groundY - botY);
      ctx.drawImage(img.neck, x, botY, pw, neckH);
      ctx.drawImage(img.cap, x - ov, gapBottom, pw + ov * 2, capH);
    }
  };

  // Wing frames: 0 up, 1 mid, 2 down. Looping order up-mid-down-mid.
  var WING_SEQ = [0, 1, 2, 1];

  Renderer.prototype.drawBird = function (game, t) {
    var ctx = this.ctx, cfg = this.cfg, b = game.world.bird;
    var frame = 1;
    if (game.state === State.READY || game.state === State.PLAYING || game.state === State.PAUSED) {
      var fps = game.state === State.READY ? cfg.readyWingFps : cfg.wingFps;
      frame = WING_SEQ[Math.floor(b.wingTime * fps) % 4];
      // Wings are tucked while diving steeply, like a real bird.
      if (game.state !== State.READY && b.angle > 1.15) frame = 1;
    }
    var y = U.lerp(b.prevY, b.y, t);
    var ang = U.lerp(b.prevAngle, b.angle, t);
    ctx.save();
    ctx.translate(this.snapX(b.x), this.snapY(y));
    ctx.rotate(ang);
    this.drawBirdSprite(this.birdFrames(game.skin.color, game.skin.hat)[frame], 0, 0, 1);
    ctx.restore();
  };

  // Draw a bird frame centred on its body at (cx, cy); the hat area sits above.
  Renderer.prototype.drawBirdSprite = function (img, cx, cy, scale) {
    var bw = this.cfg.birdSize.width * scale, bh = this.cfg.birdSize.height * scale;
    var sy = bh / 12;
    this.ctx.drawImage(img, cx - bw / 2, cy - bh / 2 - ns.Skins.HEAD_ROOM * sy, bw, img.height * sy);
  };

  Renderer.prototype.drawGround = function (scroll) {
    var ctx = this.ctx, cfg = this.cfg, g = this.assets.ground;
    var off = this.snapX(-(scroll % g.tileWidth) - g.tileWidth);
    ctx.drawImage(this.tinted.ground.out, off, cfg.height - cfg.groundHeight, g.canvas.width * cfg.artScale, cfg.groundHeight + 8);
  };

  Renderer.prototype.drawParticles = function (w) {
    var ctx = this.ctx;
    for (var i = 0; i < w.particles.length; i++) {
      var p = w.particles[i];
      ctx.globalAlpha = U.clamp(p.life / p.maxLife * 1.6, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  };

  // --- HUD & menus -------------------------------------------------------------------
  Renderer.prototype.drawScore = function (game) {
    var pop = game.reducedMotion ? 0 : game.fx.scorePop / 0.15;
    var scale = 6 + pop * 1.5;
    Font.draw(this.ctx, String(game.world.score), this.cfg.width / 2, LAYOUT.scoreY - pop * 4, {
      scale: scale, align: 'center', fill: '#ffffff', outline: INK, shadow: INK
    });
  };

  Renderer.prototype.drawReady = function (game) {
    var ctx = this.ctx, cfg = this.cfg;
    var t = game.world.time;
    var bob = game.reducedMotion ? 0 : Math.round(Math.sin(t * 2.2) * 3);
    Font.draw(ctx, 'FLAPLING', cfg.width / 2, LAYOUT.titleY + bob, {
      scale: 6, align: 'center', fill: TITLE_FILL, outline: INK, shadow: INK
    });
    Font.draw(ctx, 'GET READY', cfg.width / 2, LAYOUT.titleY + 64, {
      scale: 3, align: 'center', fill: '#ffffff', outline: INK, shadow: INK
    });

    // Gentle pulse on the instruction (opacity only, so fine for reduced motion).
    ctx.globalAlpha = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 4));
    Font.draw(ctx, 'TAP OR PRESS SPACE', cfg.width / 2, LAYOUT.readyHintY, {
      scale: 2, align: 'center', fill: '#ffffff', outline: INK
    });
    Font.draw(ctx, 'TO START', cfg.width / 2, LAYOUT.readyHintY + 22, {
      scale: 2, align: 'center', fill: '#ffffff', outline: INK
    });
    ctx.globalAlpha = 1;

    // Little tap hint: a pulsing arrow above the bird.
    var b = game.world.bird;
    var lift = game.reducedMotion ? 0 : Math.round((Math.sin(t * 5) + 1) * 2);
    this.drawUpArrow(b.x, b.y - 40 - lift);

    if (game.best > 0) {
      Font.draw(ctx, 'BEST ' + game.best, cfg.width / 2, LAYOUT.readyBestY, {
        scale: 2, align: 'center', fill: '#ffe066', outline: INK
      });
    }

    var C = LAYOUT.customizeButton;
    this.drawButton(C.x, C.y, C.w, C.h, 'CUSTOMIZE', game.ui.isPressed('customize'), 2);
  };

  // --- Bird customisation screen ------------------------------------------------------
  Renderer.prototype.drawCustomize = function (game) {
    var ctx = this.ctx, cfg = this.cfg, C = LAYOUT.custom, P = C.panel, cx = cfg.width / 2;
    var Skins = ns.Skins;
    var color = Skins.colors[game.browse.color], hat = Skins.hats[game.browse.hat];
    var colorOk = game.isUnlocked(color), hatOk = game.isUnlocked(hat);

    ctx.fillStyle = 'rgba(18, 28, 44, 0.45)';
    ctx.fillRect(0, 0, cfg.width, cfg.height);
    Font.draw(ctx, 'YOUR BIRD', cx, C.titleY, { scale: 4, align: 'center', fill: TITLE_FILL, outline: INK, shadow: INK });
    this.drawPanel(P.x, P.y, P.w, P.h);

    // Big, flapping preview of the browsed combination.
    var t = game.clock;
    var frame = [0, 1, 2, 1][Math.floor(t * cfg.readyWingFps) % 4];
    var hover = game.reducedMotion ? 0 : Math.round(Math.sin(t * 3) * 3);
    ctx.globalAlpha = colorOk && hatOk ? 1 : 0.55;
    this.drawBirdSprite(this.birdFrames(game.browse.color, game.browse.hat)[frame], cx, C.previewY + hover, 3);
    ctx.globalAlpha = 1;

    this.drawPickerRow('COLOR', C.colorY, color, colorOk, game.browse.color, Skins.colors.length, game, C.colorPrev, C.colorNext, 'color');
    this.drawPickerRow('HAT', C.hatY, hat, hatOk, game.browse.hat, Skins.hats.length, game, C.hatPrev, C.hatNext, 'hat');

    var D = C.done;
    this.drawButton(D.x, D.y, D.w, D.h, 'DONE', game.ui.isPressed('done'));
    if (game.lastInput === 'key') {
      Font.draw(ctx, 'ARROWS TO CHOOSE', cx, D.y + D.h + 14, { scale: 2, align: 'center', fill: '#ffffff', outline: INK });
    }
  };

  Renderer.prototype.drawPickerRow = function (label, y, item, ok, index, count, game, prevR, nextR, kind) {
    var ctx = this.ctx, cx = this.cfg.width / 2;
    Font.draw(ctx, label, cx, y, { scale: 2, align: 'center', fill: '#c0632a', outline: null });
    Font.draw(ctx, item.name, cx, y + 26, { scale: 3, align: 'center', fill: ok ? '#ffffff' : '#d9c8a0', outline: INK });
    this.drawArrowButton(prevR, -1, game.ui.isPressed(kind + 'Prev'));
    this.drawArrowButton(nextR, 1, game.ui.isPressed(kind + 'Next'));

    var infoY = y + 64;
    if (!ok) {
      // Lock icon + requirement, centred together.
      var text = 'NEED BEST ' + item.unlock;
      var tw = Font.width(text, 2, false);
      var left = Math.round(cx - (tw + 22) / 2);
      this.drawLock(left + 2, infoY - 6);
      Font.draw(ctx, text, left + 22, infoY - 2, { scale: 2, fill: '#c22f2f', outline: null });
      return;
    }
    // Position dots: one per option, current one highlighted.
    var size = 8, gap = 6, total = count * size + (count - 1) * gap;
    var x0 = Math.round(cx - total / 2);
    for (var i = 0; i < count; i++) {
      var x = x0 + i * (size + gap);
      ctx.fillStyle = INK;
      ctx.fillRect(x - 2, infoY - 2, size + 4, size + 4);
      if (kind === 'color') ctx.fillStyle = ns.Skins.colors[i].palette.o;
      else ctx.fillStyle = i === index ? '#ff8c2e' : '#f2dca6';
      ctx.fillRect(x, infoY, size, size);
      if (i === index) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 2, infoY + size + 4, size + 4, 2);
      }
    }
  };

  Renderer.prototype.drawArrowButton = function (r, dir, pressed) {
    var ctx = this.ctx;
    var d = pressed ? 3 : 0;
    ctx.fillStyle = INK;
    ctx.fillRect(r.x + 2, r.y + 4, r.w - 4, r.h - 4);
    ctx.fillRect(r.x + 2, r.y + d, r.w - 4, r.h - 4); ctx.fillRect(r.x, r.y + 2 + d, r.w, r.h - 8);
    ctx.fillStyle = '#c94f17'; ctx.fillRect(r.x + 2, r.y + 2 + d, r.w - 4, r.h - 8);
    ctx.fillStyle = '#ff8c2e'; ctx.fillRect(r.x + 2, r.y + 2 + d, r.w - 4, r.h - 12);
    ctx.fillStyle = '#ffc06b'; ctx.fillRect(r.x + 4, r.y + 4 + d, r.w - 8, 2);
    // Pixel triangle.
    var cx = r.x + r.w / 2, cy = r.y + (r.h - 4) / 2 + d;
    for (var i = 0; i < 6; i++) {
      var h = 14 - i * 2 - 2;
      var x = dir > 0 ? cx - 6 + i * 2 : cx + 4 - i * 2;
      ctx.fillStyle = INK;
      ctx.fillRect(x - 1, cy - h / 2 - 1, 4, h + 2);
    }
    ctx.fillStyle = '#ffffff';
    for (i = 0; i < 5; i++) {
      var hh = 10 - i * 2;
      var xx = dir > 0 ? cx - 5 + i * 2 : cx + 3 - i * 2;
      ctx.fillRect(xx, cy - hh / 2, 2, hh);
    }
  };

  Renderer.prototype.drawLock = function (x, y) {
    var ctx = this.ctx;
    ctx.fillStyle = INK;
    ctx.fillRect(x + 2, y, 8, 2); ctx.fillRect(x, y + 2, 2, 6); ctx.fillRect(x + 10, y + 2, 2, 6);
    ctx.fillRect(x - 2, y + 6, 16, 12);
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(x, y + 8, 12, 8);
    ctx.fillStyle = INK;
    ctx.fillRect(x + 5, y + 10, 2, 4);
  };

  Renderer.prototype.drawUpArrow = function (cx, top) {
    var ctx = this.ctx;
    var rows = ['...##...', '..####..', '.######.', '########', '..####..', '..####..'];
    var s = 2, x0 = Math.round(cx - 8), y0 = Math.round(top);
    ctx.fillStyle = INK;
    for (var y = 0; y < rows.length; y++) {
      for (var x = 0; x < rows[y].length; x++) {
        if (rows[y][x] === '#') ctx.fillRect(x0 + x * s - 2, y0 + y * s - 2, s + 4, s + 4);
      }
    }
    ctx.fillStyle = '#ffffff';
    for (y = 0; y < rows.length; y++) {
      for (x = 0; x < rows[y].length; x++) {
        if (rows[y][x] === '#') ctx.fillRect(x0 + x * s, y0 + y * s, s, s);
      }
    }
  };

  Renderer.prototype.drawPaused = function (game) {
    var ctx = this.ctx, cfg = this.cfg;
    var cx = cfg.width / 2;
    var digit = game.countdownDigit();
    if (digit) {
      ctx.fillStyle = 'rgba(18, 28, 44, 0.3)';
      ctx.fillRect(0, 0, cfg.width, cfg.height);
      Font.draw(ctx, String(digit), cx, 220, { scale: 9, align: 'center', fill: '#ffffff', outline: INK, shadow: null });
      Font.draw(ctx, 'GET READY', cx, 316, { scale: 3, align: 'center', fill: '#ffffff', outline: INK, shadow: INK });
      return;
    }
    ctx.fillStyle = 'rgba(18, 28, 44, 0.55)';
    ctx.fillRect(0, 0, cfg.width, cfg.height);
    // Pause icon.
    ctx.fillStyle = INK;
    ctx.fillRect(cx - 22, 196, 18, 48);
    ctx.fillRect(cx + 4, 196, 18, 48);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 18, 200, 10, 40);
    ctx.fillRect(cx + 8, 200, 10, 40);
    Font.draw(ctx, 'PAUSED', cx, 266, { scale: 5, align: 'center', fill: '#ffffff', outline: INK, shadow: INK });
    Font.draw(ctx, 'TAP OR PRESS SPACE', cx, 330, { scale: 2, align: 'center', fill: '#ffe066', outline: INK });
    Font.draw(ctx, 'TO RESUME', cx, 352, { scale: 2, align: 'center', fill: '#ffe066', outline: INK });
  };

  Renderer.prototype.drawGameOver = function (game) {
    if (!game.panelShown) return;
    var ctx = this.ctx, cfg = this.cfg, P = LAYOUT.panel;
    var el = game.stateTime - game.panelTime;
    var p = U.clamp(el / cfg.panelAnimTime, 0, 1);
    var slide = game.reducedMotion ? 0 : 1 - U.easeOutCubic(p);
    var fade = game.reducedMotion ? U.clamp(el / 0.2, 0, 1) : 1;

    ctx.globalAlpha = fade * U.clamp(p * 2.5, 0, 1);
    Font.draw(ctx, 'GAME OVER', cfg.width / 2, LAYOUT.gameOverTitleY - slide * 24, {
      scale: 5, align: 'center', fill: TITLE_FILL, outline: INK, shadow: INK
    });

    ctx.globalAlpha = fade;
    var oy = Math.round(slide * (cfg.height - P.y));
    this.drawPanel(P.x, P.y + oy, P.w, P.h);

    // Medal column.
    var mx = P.x + 64;
    Font.draw(ctx, 'MEDAL', mx, P.y + oy + 18, { scale: 2, align: 'center', fill: '#c0632a', outline: null });
    ctx.drawImage(this.assets.medals[game.medalTier()], mx - 28, P.y + oy + 42, 56, 56);

    // Score column.
    var rx = P.x + P.w - 22;
    Font.draw(ctx, 'SCORE', rx, P.y + oy + 18, { scale: 2, align: 'right', fill: '#c0632a', outline: null });
    Font.draw(ctx, String(game.world.score), rx + 2, P.y + oy + 38, {
      scale: 4, align: 'right', fill: '#ffffff', outline: INK, shadow: INK
    });
    Font.draw(ctx, 'BEST', rx, P.y + oy + 90, { scale: 2, align: 'right', fill: '#c0632a', outline: null });
    Font.draw(ctx, String(game.best), rx + 2, P.y + oy + 110, {
      scale: 4, align: 'right', fill: '#ffffff', outline: INK, shadow: INK
    });

    if (game.newBest) {
      // Badge under the medal; blinks unless reduced motion is requested.
      var on = game.reducedMotion || Math.floor(el * 3) % 2 === 0;
      var bx = mx - 54, by = P.y + oy + 120, bw = 108, bh = 26;
      ctx.fillStyle = INK; ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
      ctx.fillStyle = on ? '#e83b3b' : '#c22f2f'; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = '#ff7a6b'; ctx.fillRect(bx, by, bw, 2);
      Font.draw(ctx, 'NEW BEST!', mx, by + 5, { scale: 2, align: 'center', fill: '#ffffff', outline: null });
    }

    // Restart button slides in with the panel; dimmed until it can be used.
    var R = LAYOUT.restartButton;
    var ready = game.restartEnabled;
    ctx.globalAlpha = fade * (ready ? 1 : 0.55);
    this.drawButton(R.x, R.y + oy, R.w, R.h, 'RESTART', ready && game.ui.isPressed('restart'));
    ctx.globalAlpha = 1;

    if (ready && game.lastInput === 'key') {
      Font.draw(ctx, 'OR PRESS SPACE', cfg.width / 2, R.y + R.h + 16, {
        scale: 2, align: 'center', fill: '#ffffff', outline: INK
      });
    }
  };

  Renderer.prototype.drawPanel = function (x, y, w, h) {
    var ctx = this.ctx;
    ctx.fillStyle = INK;            ctx.fillRect(x + 2, y, w - 4, h); ctx.fillRect(x, y + 2, w, h - 4);
    ctx.fillStyle = '#fff6dc';      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    ctx.fillStyle = '#e8c98a';      ctx.fillRect(x + 6, y + 6, w - 12, h - 12);
    ctx.fillStyle = '#f2dca6';      ctx.fillRect(x + 6, y + 6, w - 12, 4);
    ctx.fillStyle = '#d2ab66';      ctx.fillRect(x + 6, y + h - 10, w - 12, 4);
    ctx.fillStyle = 'rgba(43,29,20,0.25)'; ctx.fillRect(x + 4, y + h, w - 4, 4);
  };

  Renderer.prototype.drawButton = function (x, y, w, h, label, pressed, labelScale) {
    var ls = labelScale || 3;
    var ctx = this.ctx;
    var d = pressed ? 3 : 0;
    ctx.fillStyle = INK;
    ctx.fillRect(x + 2, y + 4, w - 4, h - 4); ctx.fillRect(x, y + 6, w, h - 8); // drop shadow block
    ctx.fillRect(x + 2, y + d, w - 4, h - 4); ctx.fillRect(x, y + 2 + d, w, h - 8);
    ctx.fillStyle = '#c94f17'; ctx.fillRect(x + 2, y + 2 + d, w - 4, h - 8);
    ctx.fillStyle = '#ff8c2e'; ctx.fillRect(x + 2, y + 2 + d, w - 4, h - 12);
    ctx.fillStyle = '#ffc06b'; ctx.fillRect(x + 4, y + 4 + d, w - 8, 3);
    Font.draw(ctx, label, x + w / 2, Math.round(y + (h - 4) / 2 - (Font.GLYPH_H + 2) * ls / 2 + d), {
      scale: ls, align: 'center', fill: '#ffffff', outline: INK
    });
  };

  ns.Renderer = Renderer;
})(globalThis.Flapling = globalThis.Flapling || {});
