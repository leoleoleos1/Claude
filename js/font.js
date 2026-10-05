/*
 * Original 5×7 bitmap font. Strings are rasterised once (with outline and drop
 * shadow) into small offscreen canvases at one canvas pixel per font pixel and
 * then drawn scaled up with smoothing disabled, which keeps text perfectly
 * crisp at any screen size.
 */
(function (ns) {
  'use strict';

  var G = {
    'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'B': ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    'C': ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
    'D': ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    'F': ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    'G': ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
    'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'I': ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
    'J': ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
    'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    'N': ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
    'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    'Q': ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
    'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    'S': ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'V': ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
    'W': ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
    'X': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    'Y': ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
    'Z': ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
    '0': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
    '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
    '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
    '!': ['#', '#', '#', '#', '#', '.', '#'],
    '.': ['.', '.', '.', '.', '.', '.', '#'],
    ',': ['..', '..', '..', '..', '..', '.#', '#.'],
    ':': ['.', '.', '#', '.', '.', '#', '.'],
    '-': ['....', '....', '....', '####', '....', '....', '....'],
    '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
    '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
    "'": ['#', '#', '.', '.', '.', '.', '.'],
    '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
    ' ': ['...', '...', '...', '...', '...', '...', '...']
  };

  var GLYPH_H = 7;
  var cache = new Map();
  var CACHE_LIMIT = 160;

  function glyph(ch) { return G[ch] || G['?']; }

  // Width of a string in font pixels (1px gap between glyphs).
  function measure(str) {
    var w = 0;
    for (var i = 0; i < str.length; i++) {
      w += glyph(str[i])[0].length;
      if (i < str.length - 1) w += 1;
    }
    return w;
  }

  /*
   * style: { fill: colour | [colour per glyph row], outline: colour|null,
   *          shadow: colour|null }
   * Returns a canvas with 1px of outline around the text and 1px of shadow below.
   */
  function rasterize(str, style) {
    var key = str + '|' + JSON.stringify(style);
    var hit = cache.get(key);
    if (hit) return hit;

    var pad = style.outline ? 1 : 0;
    var shadow = style.shadow ? 1 : 0;
    var tw = measure(str);
    var w = tw + pad * 2;
    var h = GLYPH_H + pad * 2 + shadow;

    // Build a boolean mask of lit pixels.
    var mask = new Uint8Array(w * h);
    var x0 = pad;
    for (var i = 0; i < str.length; i++) {
      var rows = glyph(str[i]);
      for (var gy = 0; gy < GLYPH_H; gy++) {
        for (var gx = 0; gx < rows[gy].length; gx++) {
          if (rows[gy][gx] === '#') mask[(gy + pad) * w + x0 + gx] = 1;
        }
      }
      x0 += rows[0].length + 1;
    }

    // Outline = 8-neighbourhood dilation of the mask.
    var outline = new Uint8Array(w * h);
    if (pad) {
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          if (mask[y * w + x]) continue;
          for (var dy = -1; dy <= 1 && !outline[y * w + x]; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              var nx = x + dx, ny = y + dy;
              if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[ny * w + nx]) { outline[y * w + x] = 1; break; }
            }
          }
        }
      }
    }

    var c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = h;
    var ctx = c.getContext('2d');

    var px;
    if (shadow) {
      ctx.fillStyle = style.shadow;
      for (px = 0; px < w * h; px++) {
        if ((mask[px] || outline[px]) && px + w < w * h) ctx.fillRect(px % w, Math.floor(px / w) + 1, 1, 1);
      }
    }
    if (pad) {
      ctx.fillStyle = style.outline;
      for (px = 0; px < w * h; px++) if (outline[px]) ctx.fillRect(px % w, Math.floor(px / w), 1, 1);
    }
    for (px = 0; px < w * h; px++) {
      if (!mask[px]) continue;
      var row = Math.floor(px / w);
      var fill = style.fill;
      if (Array.isArray(fill)) fill = fill[Math.min(fill.length - 1, Math.max(0, row - pad))];
      ctx.fillStyle = fill;
      ctx.fillRect(px % w, row, 1, 1);
    }

    if (cache.size >= CACHE_LIMIT) cache.clear(); // bounded: score strings change constantly
    cache.set(key, c);
    return c;
  }

  /*
   * Draw text. (x, y) is the anchor of the image's top edge; align picks the
   * horizontal anchor. scale = logical px per font pixel.
   */
  function draw(ctx, str, x, y, opts) {
    var o = opts || {};
    var scale = o.scale || 2;
    var style = {
      fill: o.fill || '#ffffff',
      outline: o.outline === undefined ? '#2b1d14' : o.outline,
      shadow: o.shadow === undefined ? null : o.shadow
    };
    var img = rasterize(String(str).toUpperCase(), style);
    var w = img.width * scale, h = img.height * scale;
    var dx = x;
    if (o.align === 'center') dx = x - w / 2;
    else if (o.align === 'right') dx = x - w;
    ctx.drawImage(img, dx, y, w, h);
    return { x: dx, y: y, w: w, h: h };
  }

  function width(str, scale, outlined) {
    return (measure(String(str).toUpperCase()) + (outlined === false ? 0 : 2)) * (scale || 2);
  }

  ns.Font = { draw: draw, width: width, GLYPH_H: GLYPH_H };
})(globalThis.Flapling = globalThis.Flapling || {});
