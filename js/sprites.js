/*
 * Procedurally generated pixel art. Everything is painted once at startup
 * into offscreen canvases at "art resolution" (1 canvas px = 1 art pixel =
 * CONFIG.artScale logical px) and later drawn scaled up with smoothing off.
 * All artwork is original.
 */
(function (ns) {
  'use strict';

  var mulberry32 = ns.Util.mulberry32;

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    return { canvas: c, ctx: ctx };
  }

  // Paint a character map ('.' = transparent) using a palette lookup.
  function paintMap(ctx, rows, palette, ox, oy) {
    for (var y = 0; y < rows.length; y++) {
      for (var x = 0; x < rows[y].length; x++) {
        var col = palette[rows[y][x]];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect((ox || 0) + x, (oy || 0) + y, 1, 1);
      }
    }
  }

  // Filled pixel circle, drawn row by row so edges stay on the art grid.
  function disc(ctx, cx, cy, r, color) {
    ctx.fillStyle = color;
    for (var dy = -r; dy <= r; dy++) {
      var half = Math.floor(Math.sqrt(r * r - dy * dy) + 0.35);
      ctx.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
    }
  }

  // Draw something three times so it wraps seamlessly around a tile of width w.
  function wrapped(w, fn) { fn(-w); fn(0); fn(w); }

  // Triangle wave in [0, 1] with the given period.
  function tri(x, period, phase) {
    var t = ((x / period + phase) % 1 + 1) % 1;
    return 1 - Math.abs(t * 2 - 1);
  }

  // ---------------------------------------------------------------------------
  // Bird: 17 × 12 art px, facing right. Three wing frames.
  // ---------------------------------------------------------------------------
  var BIRD_PALETTE = {
    k: '#2b1d14', // outline
    o: '#ff8c2e', // body
    h: '#ffc06b', // body highlight
    d: '#e0621c', // body shade
    c: '#ffd28f', // belly
    w: '#ffffff', // eye white
    b: '#ffd93b', // beak
    r: '#f2a516', // beak shade
    m: '#ffffff', // wing
    n: '#ead7b6'  // wing shade
  };

  var BIRD_BODY = [
    '.....kkkkkk......',
    '...kkhhhhhhkkkk..',
    '..khhoooookwwwwk.',
    '.khoooooookwwkwk.',
    '.kooooooookwwkwk.',
    'koooooooookwwwwk.',
    'kooooooooookkkkkk',
    'kooooooooookbbbbk',
    'kcccoooooookkkkk.',
    '.kcccccoooorrrrk.',
    '..kcccccddkkkkk..',
    '....kkkkkkk......'
  ];

  var WING_FRAMES = [
    { oy: 2, rows: ['kk.....', 'kmk....', 'kmmkk..', 'kmmmmk.', '.kkkk..'] }, // up
    { oy: 5, rows: ['.kkkk..', 'kmmmmk.', 'kmmmnk.', '.kkkk..'] },            // mid
    { oy: 6, rows: ['.kkkk..', 'kmmmmk.', 'kmmnk..', 'knk....', '.k.....'] }  // down
  ];

  function buildBird() {
    var frames = [];
    for (var i = 0; i < WING_FRAMES.length; i++) {
      var c = makeCanvas(17, 12);
      paintMap(c.ctx, BIRD_BODY, BIRD_PALETTE);
      paintMap(c.ctx, WING_FRAMES[i].rows, BIRD_PALETTE, 0, WING_FRAMES[i].oy);
      frames.push(c.canvas);
    }
    return frames;
  }

  // ---------------------------------------------------------------------------
  // Pipes
  // ---------------------------------------------------------------------------
  var PIPE = {
    O: '#1e3410', H: '#e2fbb0', L: '#a5e35c', M: '#66bd2f',
    D1: '#4f9e25', D2: '#3d801c', D3: '#2d6315'
  };

  function pipeColumns(width) {
    // Light comes from the upper left: a bright highlight band near the left,
    // fading to darker greens on the right, with a dark outline on both sides.
    var cols = [];
    for (var x = 0; x < width; x++) {
      var t = x / (width - 1);
      var c;
      if (x === 0 || x === width - 1) c = PIPE.O;
      else if (t < 0.1) c = PIPE.L;
      else if (t < 0.2) c = PIPE.H;
      else if (t < 0.32) c = PIPE.L;
      else if (t < 0.62) c = PIPE.M;
      else if (t < 0.7) c = PIPE.D1;
      else if (t < 0.74) c = PIPE.M;
      else if (t < 0.84) c = PIPE.D1;
      else if (t < 0.92) c = PIPE.D2;
      else c = PIPE.D3;
      cols.push(c);
    }
    return cols;
  }

  function buildPipes(cfg) {
    var a = cfg.artScale;
    var bodyW = Math.round(cfg.pipeWidth / a);
    var capW = Math.round((cfg.pipeWidth + cfg.pipeCapOverhang * 2) / a);
    var capH = Math.round(cfg.pipeCapHeight / a);

    // Body: one row, stretched vertically when drawn.
    var body = makeCanvas(bodyW, 1);
    var bodyCols = pipeColumns(bodyW);
    for (var x = 0; x < bodyW; x++) { body.ctx.fillStyle = bodyCols[x]; body.ctx.fillRect(x, 0, 1, 1); }

    // Neck: a darker band where the body meets the cap (cap casts a shadow).
    var neck = makeCanvas(bodyW, 3);
    for (x = 0; x < bodyW; x++) {
      neck.ctx.fillStyle = x === 0 || x === bodyW - 1 ? PIPE.O : (x < bodyW * 0.3 ? PIPE.D1 : PIPE.D3);
      neck.ctx.fillRect(x, 0, 1, 2);
      neck.ctx.fillStyle = x === 0 || x === bodyW - 1 ? PIPE.O : (x < bodyW * 0.3 ? PIPE.M : PIPE.D2);
      neck.ctx.fillRect(x, 2, 1, 1);
    }

    // Cap: wider lip with outline all around, top highlight and bottom shade.
    var cap = makeCanvas(capW, capH);
    var capCols = pipeColumns(capW);
    for (var y = 0; y < capH; y++) {
      for (x = 0; x < capW; x++) {
        var col = capCols[x];
        if (y === 0 || y === capH - 1) col = PIPE.O;
        else if (y === 1 && x > 0 && x < capW - 1) col = x < capW * 0.75 ? PIPE.H : PIPE.L;
        else if (y === capH - 2 && x > 0 && x < capW - 1) col = x < capW * 0.3 ? PIPE.D1 : PIPE.D3;
        cap.ctx.fillStyle = col;
        cap.ctx.fillRect(x, y, 1, 1);
      }
    }
    return { body: body.canvas, neck: neck.canvas, cap: cap.canvas };
  }

  // ---------------------------------------------------------------------------
  // Ground strip (tile repeated across the screen + one spare tile for scrolling)
  // ---------------------------------------------------------------------------
  function buildGround(cfg) {
    var a = cfg.artScale;
    var tileW = 24;
    var h = Math.round(cfg.groundHeight / a);
    var tile = makeCanvas(tileW, h);
    var t = tile.ctx;
    var rng = mulberry32(7);

    t.fillStyle = '#2a4b17'; t.fillRect(0, 0, tileW, 1);           // top outline
    t.fillStyle = '#c3f07a'; t.fillRect(0, 1, tileW, 1);           // grass highlight
    t.fillStyle = '#9edb52'; t.fillRect(0, 2, tileW, 7);           // grass
    // Diagonal stripes give the strip a strong sense of motion.
    t.fillStyle = '#7cc23f';
    for (var y = 2; y < 9; y++) {
      for (var x = 0; x < tileW; x++) {
        if (((x + y) % 12) < 6) t.fillRect(x, y, 1, 1);
      }
    }
    t.fillStyle = '#5a9a2c'; t.fillRect(0, 9, tileW, 1);           // grass edge
    t.fillStyle = '#3f6e20'; t.fillRect(0, 10, tileW, 1);
    t.fillStyle = '#b48a4a'; t.fillRect(0, 11, tileW, 2);          // shadow under grass
    t.fillStyle = '#ddc386'; t.fillRect(0, 13, tileW, h - 13);     // soil
    // Pebbles and specks (stay inside the tile so it repeats seamlessly).
    for (var i = 0; i < 14; i++) {
      var px = Math.floor(rng() * (tileW - 2));
      var py = 15 + Math.floor(rng() * (h - 17));
      t.fillStyle = rng() < 0.5 ? '#c6a96c' : '#ecd9a6';
      t.fillRect(px, py, rng() < 0.3 ? 2 : 1, 1);
    }
    t.fillStyle = '#c6a96c';
    t.fillRect(4, 22, 3, 2); t.fillRect(16, 34, 2, 2);
    t.fillStyle = '#f1e2b6';
    t.fillRect(4, 22, 1, 1); t.fillRect(16, 34, 1, 1);

    var stripTiles = Math.ceil(cfg.width / a / tileW) + 3;
    var strip = makeCanvas(tileW * stripTiles, h);
    for (i = 0; i < stripTiles; i++) strip.ctx.drawImage(tile.canvas, i * tileW, 0);
    return { canvas: strip.canvas, tileWidth: tileW * a };
  }

  // ---------------------------------------------------------------------------
  // Background layers (seamlessly tiling horizontally)
  // ---------------------------------------------------------------------------
  function buildSky(cfg) {
    var a = cfg.artScale;
    var w = Math.round(cfg.width / a), h = Math.round(cfg.height / a);
    var c = makeCanvas(w, h);
    var bands = ['#3d98e0', '#469fe3', '#50a7e6', '#5bb0ea', '#67b9ed', '#74c2f0',
                 '#82cbf2', '#91d3f5', '#a0dbf7', '#afe2f8', '#bde8fa'];
    var bandH = Math.ceil((h - cfg.groundHeight / a) / bands.length);
    for (var i = 0; i < bands.length; i++) {
      c.ctx.fillStyle = bands[i];
      c.ctx.fillRect(0, i * bandH, w, bandH);
      // One row of checkerboard dithering softens each band edge.
      if (i + 1 < bands.length) {
        c.ctx.fillStyle = bands[i + 1];
        for (var x = 0; x < w; x += 2) c.ctx.fillRect(x, (i + 1) * bandH - 1, 1, 1);
      }
    }
    c.ctx.fillStyle = bands[bands.length - 1];
    c.ctx.fillRect(0, bands.length * bandH, w, h);
    return c.canvas;
  }

  function cloud(ctx, cx, cy, s, rng, fill, shade) {
    var puffs = [[0, 0, 7], [-8, 2, 5], [8, 2, 5], [-4, -3, 5], [5, -2, 6], [-13, 4, 3], [13, 4, 3]];
    var i, p;
    for (i = 0; i < puffs.length; i++) {
      p = puffs[i];
      disc(ctx, cx + Math.round(p[0] * s), cy + Math.round(p[1] * s) + 1, Math.max(2, Math.round(p[2] * s)), shade);
    }
    for (i = 0; i < puffs.length; i++) {
      p = puffs[i];
      disc(ctx, cx + Math.round(p[0] * s), cy + Math.round(p[1] * s), Math.max(2, Math.round(p[2] * s)), fill);
    }
    ctx.fillStyle = shade;
    ctx.fillRect(cx - Math.round(14 * s), cy + Math.round(6 * s), Math.round(28 * s), 1);
  }

  function buildFarClouds(cfg) {
    var w = 360, h = Math.round(cfg.height / cfg.artScale);
    var c = makeCanvas(w, h);
    var rng = mulberry32(42);
    var spots = [[30, 40, 1.0], [120, 82, 0.7], [205, 28, 0.85], [290, 70, 1.1], [330, 120, 0.6], [70, 130, 0.65]];
    spots.forEach(function (s) {
      wrapped(w, function (off) { cloud(c.ctx, s[0] + off, s[1], s[2], rng, '#ffffff', '#d6ecf8'); });
    });
    return c.canvas;
  }

  function buildMountains(cfg) {
    var w = 180, h = Math.round(cfg.height / cfg.artScale);
    var c = makeCanvas(w, h);
    var ground = h - Math.round(cfg.groundHeight / cfg.artScale);
    for (var x = 0; x < w; x++) {
      var peak = 34 * tri(x, 90, 0.15) + 18 * tri(x, 36, 0.4) + 8 * tri(x, 20, 0.1);
      var top = Math.round(ground - 46 - peak);
      var next = 34 * tri(x + 1, 90, 0.15) + 18 * tri(x + 1, 36, 0.4) + 8 * tri(x + 1, 20, 0.1);
      c.ctx.fillStyle = '#8fbfdc';
      c.ctx.fillRect(x, top, 1, ground - top);
      // Sunlit (rising) slopes get a lighter face.
      if (next > peak) {
        c.ctx.fillStyle = '#a8d0e6';
        c.ctx.fillRect(x, top, 1, Math.min(14, ground - top));
      }
      c.ctx.fillStyle = '#7fb2d2';
      c.ctx.fillRect(x, top, 1, 1);
    }
    return c.canvas;
  }

  function buildCloudBank(cfg) {
    var w = 180, h = Math.round(cfg.height / cfg.artScale);
    var c = makeCanvas(w, h);
    var ground = h - Math.round(cfg.groundHeight / cfg.artScale);
    var rng = mulberry32(9);
    var puffs = [];
    for (var x = 0; x < w; x += 12) puffs.push([x + Math.floor(rng() * 6), ground - 34 - Math.floor(rng() * 10), 7 + Math.floor(rng() * 6)]);
    puffs.forEach(function (p) {
      wrapped(w, function (off) { disc(c.ctx, p[0] + off, p[1] + 1, p[2], '#cfe7f5'); });
    });
    puffs.forEach(function (p) {
      wrapped(w, function (off) { disc(c.ctx, p[0] + off, p[1], p[2], '#f2faff'); });
    });
    c.ctx.fillStyle = '#f2faff';
    c.ctx.fillRect(0, ground - 30, w, 30);
    return c.canvas;
  }

  function buildHills(cfg) {
    var w = 180, h = Math.round(cfg.height / cfg.artScale);
    var c = makeCanvas(w, h);
    var ground = h - Math.round(cfg.groundHeight / cfg.artScale);
    var ctx = c.ctx;
    var tops = [];
    for (var x = 0; x < w; x++) {
      var y = ground - 22 - Math.round(8 * Math.sin((x / w) * Math.PI * 4 + 0.6) + 5 * Math.sin((x / w) * Math.PI * 6 + 2.1));
      tops.push(y);
      ctx.fillStyle = '#5aae6c';
      ctx.fillRect(x, y, 1, ground - y);
      ctx.fillStyle = '#3f8b52';
      ctx.fillRect(x, y, 1, 1);
    }
    // Distant trees along the ridge.
    var rng = mulberry32(5);
    for (var tx = 4; tx < w; tx += 9 + Math.floor(rng() * 8)) {
      var r = 3 + Math.floor(rng() * 3);
      var ty = tops[tx] - r + 2;
      (function (tx, ty, r) {
        wrapped(w, function (off) {
          disc(ctx, tx + off, ty + 1, r, '#2f7343');
          disc(ctx, tx + off, ty, r, '#41935a');
          ctx.fillStyle = '#5db474';
          ctx.fillRect(tx + off - 1, ty - r + 1, 2, 1);
        });
      })(tx, ty, r);
    }
    // Speckled texture.
    ctx.fillStyle = '#4e9f61';
    for (var i = 0; i < 90; i++) {
      var sx = Math.floor(rng() * w);
      var sy = tops[sx] + 3 + Math.floor(rng() * Math.max(1, ground - tops[sx] - 3));
      ctx.fillRect(sx, sy, 2, 1);
    }
    return c.canvas;
  }

  function buildBushes(cfg) {
    var w = 180, h = Math.round(cfg.height / cfg.artScale);
    var c = makeCanvas(w, h);
    var ground = h - Math.round(cfg.groundHeight / cfg.artScale);
    var ctx = c.ctx;
    var rng = mulberry32(11);
    var bumps = [];
    for (var x = 0; x < w; x += 10) bumps.push([x + Math.floor(rng() * 5), ground - 7 - Math.floor(rng() * 5), 6 + Math.floor(rng() * 4)]);
    bumps.forEach(function (b) { wrapped(w, function (off) { disc(ctx, b[0] + off, b[1], b[2] + 1, '#2f6e1c'); }); });
    bumps.forEach(function (b) { wrapped(w, function (off) { disc(ctx, b[0] + off, b[1], b[2], '#6cc743'); }); });
    bumps.forEach(function (b) {
      wrapped(w, function (off) {
        ctx.fillStyle = '#9be36a';
        ctx.fillRect(b[0] + off - 2, b[1] - b[2] + 2, 3, 1);
        ctx.fillRect(b[0] + off - 3, b[1] - b[2] + 3, 1, 1);
      });
    });
    ctx.fillStyle = '#6cc743';
    ctx.fillRect(0, ground - 6, w, 6);
    return c.canvas;
  }

  // ---------------------------------------------------------------------------
  // Medals for the results panel (24 × 24 art px)
  // ---------------------------------------------------------------------------
  var MEDAL_COLORS = {
    none: { rim: '#b79e66', face: '#d8c38f', star: null },
    bronze: { rim: '#8a4a1f', face: '#d0813f', star: '#f0b071' },
    silver: { rim: '#7f8b95', face: '#d3dbe2', star: '#ffffff' },
    gold: { rim: '#b77d0c', face: '#ffd23f', star: '#fff6c4' },
    platinum: { rim: '#4f9fb8', face: '#c4f1ff', star: '#ffffff' }
  };

  var STAR = [
    '....#....',
    '....#....',
    '...###...',
    '#########',
    '.#######.',
    '..#####..',
    '..##.##..',
    '.##...##.',
    '.#.....#.'
  ];

  function buildMedals() {
    var out = {};
    Object.keys(MEDAL_COLORS).forEach(function (tier) {
      var m = MEDAL_COLORS[tier];
      var c = makeCanvas(24, 24);
      disc(c.ctx, 12, 12, 11, '#2b1d14');
      disc(c.ctx, 12, 12, 10, m.rim);
      disc(c.ctx, 12, 12, 8, m.face);
      if (m.star) {
        paintMap(c.ctx, STAR, { '#': m.rim }, 8, 8);
        paintMap(c.ctx, STAR, { '#': m.star }, 7, 7);
        c.ctx.fillStyle = 'rgba(255,255,255,0.7)';
        c.ctx.fillRect(7, 5, 3, 1); c.ctx.fillRect(6, 6, 1, 2);
      } else {
        c.ctx.fillStyle = m.rim;
        c.ctx.fillRect(10, 11, 5, 2);
      }
      out[tier] = c.canvas;
    });
    return out;
  }

  function build(cfg) {
    return {
      bird: buildBird(),
      pipe: buildPipes(cfg),
      ground: buildGround(cfg),
      sky: buildSky(cfg),
      layers: [
        // factor = scroll speed relative to the pipes (parallax depth).
        { canvas: buildFarClouds(cfg), factor: 0.06 },
        { canvas: buildMountains(cfg), factor: 0.12 },
        { canvas: buildCloudBank(cfg), factor: 0.2 },
        { canvas: buildHills(cfg), factor: 0.35 },
        { canvas: buildBushes(cfg), factor: 0.6 }
      ],
      medals: buildMedals()
    };
  }

  ns.Sprites = { build: build };
})(globalThis.Flapling = globalThis.Flapling || {});
