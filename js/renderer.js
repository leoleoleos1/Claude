/*
 * Canvas renderer. Draws the current game state in logical 360×640
 * coordinates; a single transform maps them onto the (high-DPI) backing
 * store. Rendering never changes game state.
 */
(function (ns) {
  'use strict';

  var U = ns.Util, Font = ns.Font, LAYOUT = ns.LAYOUT;
  var State = ns.Game.State;

  var INK = '#2b1d14';
  var TITLE_FILL = ['#fff6c4', '#ffe066', '#ffd23f', '#ffb52e', '#ff9a2e', '#ff7f2a', '#f0631f'];

  function Renderer(canvas, assets, cfg) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.assets = assets;
    this.cfg = cfg;
    this.kx = 1;
    this.ky = 1;
  }

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

    // Overscan fill so screen shake never reveals empty canvas.
    ctx.fillStyle = '#3d98e0';
    ctx.fillRect(0, 0, cfg.width, cfg.height);
    ctx.fillStyle = '#ddc386';
    ctx.fillRect(0, w.groundY, cfg.width, cfg.groundHeight);

    var scroll = U.lerp(w.prevScroll, w.scroll, t);

    ctx.save();
    if (game.fx.shake > 0 && !game.reducedMotion) {
      var k = game.fx.shake / cfg.shakeTime;
      var amp = cfg.shakeAmplitude * k * k;
      ctx.translate(this.snapX((Math.random() * 2 - 1) * amp), this.snapY((Math.random() * 2 - 1) * amp));
    }
    this.drawBackground(scroll);
    this.drawPipes(w, scroll);
    this.drawBird(game, t);
    this.drawGround(scroll);
    this.drawParticles(w);
    ctx.restore();

    switch (game.state) {
      case State.READY: this.drawReady(game); break;
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
  Renderer.prototype.drawBackground = function (scroll) {
    var ctx = this.ctx, a = this.cfg.artScale, H = this.cfg.height;
    // Drawn slightly oversized so screen shake never exposes an edge.
    ctx.drawImage(this.assets.sky, -8, -8, this.cfg.width + 16, H + 16);
    var layers = this.assets.layers;
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      var lw = L.canvas.width * a;
      var off = this.snapX(-((scroll * L.factor) % lw));
      for (var x = off > -8 ? off - lw : off; x < this.cfg.width + 8; x += lw) ctx.drawImage(L.canvas, x, 0, lw, H);
    }
  };

  Renderer.prototype.drawPipes = function (w, scroll) {
    var ctx = this.ctx, cfg = this.cfg, img = this.assets.pipe, a = cfg.artScale;
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
    var bw = cfg.birdSize.width, bh = cfg.birdSize.height;
    ctx.save();
    ctx.translate(this.snapX(b.x), this.snapY(y));
    ctx.rotate(ang);
    ctx.drawImage(this.assets.bird[frame], -bw / 2, -bh / 2, bw, bh);
    ctx.restore();
  };

  Renderer.prototype.drawGround = function (scroll) {
    var ctx = this.ctx, cfg = this.cfg, g = this.assets.ground;
    var off = this.snapX(-(scroll % g.tileWidth) - g.tileWidth);
    ctx.drawImage(g.canvas, off, cfg.height - cfg.groundHeight, g.canvas.width * cfg.artScale, cfg.groundHeight + 8);
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
    this.drawButton(R.x, R.y + oy, R.w, R.h, 'RESTART', ready && game.ui.restartPressed);
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

  Renderer.prototype.drawButton = function (x, y, w, h, label, pressed) {
    var ctx = this.ctx;
    var d = pressed ? 3 : 0;
    ctx.fillStyle = INK;
    ctx.fillRect(x + 2, y + 4, w - 4, h - 4); ctx.fillRect(x, y + 6, w, h - 8); // drop shadow block
    ctx.fillRect(x + 2, y + d, w - 4, h - 4); ctx.fillRect(x, y + 2 + d, w, h - 8);
    ctx.fillStyle = '#c94f17'; ctx.fillRect(x + 2, y + 2 + d, w - 4, h - 8);
    ctx.fillStyle = '#ff8c2e'; ctx.fillRect(x + 2, y + 2 + d, w - 4, h - 12);
    ctx.fillStyle = '#ffc06b'; ctx.fillRect(x + 4, y + 4 + d, w - 8, 3);
    Font.draw(ctx, label, x + w / 2, y + (h - 4) / 2 - 12 + d, {
      scale: 3, align: 'center', fill: '#ffffff', outline: INK
    });
  };

  ns.Renderer = Renderer;
})(globalThis.Flapling = globalThis.Flapling || {});
