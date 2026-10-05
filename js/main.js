/*
 * Boot: wires modules together, keeps the canvas sized to the screen and runs
 * the single animation loop with a fixed-timestep accumulator.
 */
(function (ns) {
  'use strict';

  var cfg = ns.CONFIG;
  var frame = document.getElementById('game');
  var canvas = document.getElementById('screen');

  var audio = new ns.AudioFX();
  audio.setMuted(ns.Storage.getMuted());

  var ui = new ns.UI({
    config: cfg,
    layout: ns.LAYOUT,
    restartBtn: document.getElementById('btn-restart'),
    pauseBtn: document.getElementById('btn-pause'),
    muteBtn: document.getElementById('btn-mute'),
    status: document.getElementById('status')
  });
  ui.setMuted(audio.muted);

  var world = new ns.World(cfg);
  var game = new ns.Game({ config: cfg, world: world, audio: audio, storage: ns.Storage, ui: ui });
  var renderer = new ns.Renderer(canvas, ns.Sprites.build(cfg), cfg);

  function unlockAudio() { audio.unlock(); }

  ns.Input.attach({
    surface: canvas,
    frame: frame,
    onGesture: unlockAudio,
    onAction: function (action, source) { game.handleAction(action, source); }
  });

  ui.bind({
    onGesture: unlockAudio,
    onRestart: function () { game.lastInput = 'pointer'; game.restart(); },
    onPause: function () { game.pause(); },
    onMute: function () { game.toggleMute(); }
  });

  // --- Reduced motion ------------------------------------------------------------
  var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function syncMotion() { game.reducedMotion = !!(motionQuery && motionQuery.matches); }
  syncMotion();
  if (motionQuery) {
    if (motionQuery.addEventListener) motionQuery.addEventListener('change', syncMotion);
    else if (motionQuery.addListener) motionQuery.addListener(syncMotion);
  }

  // --- Responsive sizing ------------------------------------------------------------
  // The logical 360×640 area is scaled uniformly to fit; the canvas backing
  // store matches the physical pixel size for crisp output on high-DPI screens.
  // Gameplay never sees any of this — it always runs in logical units.
  function resize() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var roomy = vw >= 480 && vh >= 720;
    var pad = roomy ? 24 : 0;
    var scale = Math.min((vw - pad * 2) / cfg.width, (vh - pad * 2) / cfg.height);
    scale = Math.max(scale, 0.25);
    var cssW = Math.floor(cfg.width * scale);
    var cssH = Math.floor(cfg.height * scale);
    frame.style.width = cssW + 'px';
    frame.style.height = cssH + 'px';
    frame.classList.toggle('is-fullbleed', !roomy);

    var dpr = Math.min(window.devicePixelRatio || 1, 4);
    var bw = Math.max(1, Math.round(cssW * dpr));
    var bh = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    renderer.setScale(bw / cfg.width, bh / cfg.height);
    renderer.render(game, 1);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  resize();

  // --- Main loop ------------------------------------------------------------------------
  // One requestAnimationFrame loop for the whole lifetime of the page; restarts
  // only reset game state. Real elapsed time is fed into an accumulator and the
  // simulation is advanced in fixed steps, so physics is identical at 30, 60
  // or 144 Hz. The leftover fraction is used to interpolate rendering.
  var STEP = cfg.fixedTimestep;
  var accumulator = 0;
  var lastTime = -1;
  var rafId = 0;

  function resetClock() {
    lastTime = -1;
    accumulator = 0;
  }

  function tick(now) {
    rafId = window.requestAnimationFrame(tick);
    if (lastTime < 0) lastTime = now;
    var dt = (now - lastTime) / 1000;
    lastTime = now;
    // Clamp long gaps (background tab, debugger, slow device) so the bird never
    // teleports; the game simply runs slower for that frame.
    if (dt > cfg.maxFrameDelta) dt = cfg.maxFrameDelta;
    if (dt < 0) dt = 0;
    accumulator += dt;
    while (accumulator >= STEP) {
      game.update(STEP);
      accumulator -= STEP;
    }
    renderer.render(game, accumulator / STEP);
  }

  function startLoop() {
    if (rafId) return; // never run two loops
    resetClock();
    rafId = window.requestAnimationFrame(tick);
  }

  // --- Visibility ---------------------------------------------------------------------------
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      game.onHidden();
      if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; }
    } else {
      startLoop(); // resets the clock: no catch-up after returning
    }
  });
  window.addEventListener('pagehide', function () { game.onHidden(); });

  startLoop();
  try { canvas.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }

  // Handle for debugging and automated tests.
  ns.app = { game: game, world: world, renderer: renderer, audio: audio };
})(globalThis.Flapling = globalThis.Flapling || {});
