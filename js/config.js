/*
 * Flapling — game configuration.
 *
 * Every gameplay value lives here. All distances are in *logical* pixels of
 * the fixed 360 × 640 play area and all times are in seconds, so the game
 * plays identically on every screen size and refresh rate.
 */
(function (ns) {
  'use strict';

  var CONFIG = {
    // Logical play-area size. Rendering scales this to fit the screen.
    width: 360,
    height: 640,
    // Logical pixels per pixel-art pixel (all sprites are drawn on a 2× grid).
    artScale: 2,

    // --- Difficulty / feel -------------------------------------------------
    gravity: 1600,          // downward acceleration (px/s²)
    flapVelocity: -470,     // vertical velocity *set* on each flap (px/s, negative = up)
    maxFallSpeed: 640,      // terminal falling speed (px/s)
    scrollSpeed: 150,       // horizontal world speed (px/s)

    pipeWidth: 64,          // width of a pipe body (px)
    pipeGap: 150,           // vertical opening between the two pipes of a pair (px)
    pipeSpacing: 210,       // horizontal distance between consecutive pipe pairs (px)
    pipeCapHeight: 26,      // height of the lip at the end of each pipe (px)
    pipeCapOverhang: 4,     // how far the lip sticks out on each side (px)
    pipeMarginTop: 64,      // minimum distance from the screen top to an opening (px)
    pipeMarginBottom: 64,   // minimum distance from the ground to an opening (px)
    pipeMaxGapShift: 170,   // max change in opening height between neighbours (px) — keeps patterns reachable
    firstPipeDistance: 160, // extra run-up beyond the right edge before the first pipe (px)

    birdX: 100,                          // fixed horizontal position of the bird's centre (px)
    birdSize: { width: 34, height: 24 }, // drawn size of the bird sprite (px)
    birdHitboxRatio: 0.46,               // collision circle radius as a fraction of bird height (forgiving)
    readyY: 290,                         // hover height on the title screen (px)

    groundHeight: 96,       // height of the scrolling ground strip (px)

    // --- Bird animation ----------------------------------------------------
    noseUpAngle: -0.42,     // radians; tilt right after a flap (~ -24°)
    noseDownAngle: Math.PI / 2,
    noseDownSpeed: 160,     // fall speed at which the bird starts tipping forward (px/s)
    wingFps: 12,            // wing animation speed while playing
    readyWingFps: 8,        // wing animation speed on the title screen
    hoverAmplitude: 6,      // title-screen bobbing (px)
    hoverFrequency: 0.9,    // title-screen bobbing (Hz)

    // --- Timing ------------------------------------------------------------
    fixedTimestep: 1 / 120, // physics step (s). Simulation never runs with a variable dt.
    maxFrameDelta: 0.1,     // longest frame gap that is simulated (s); prevents spiral-of-death / big jumps
    panelDelay: 0.45,       // after the bird lands, wait this long before showing results (s)
    panelAnimTime: 0.4,     // results panel slide-in duration (s)
    restartCooldown: 0.45,  // after the panel arrives, ignore restart input for this long (s)
    resumeCountdown: 1.5,   // 3-2-1 countdown after resuming from pause (s); 0 resumes instantly

    // --- Time of day ----------------------------------------------------------
    dayCyclePipes: 16,      // pipes for one full day → sunset → night → dawn → day cycle
    dayTransitionTime: 1.2, // how long the sky takes to shift after each pipe (s)

    // --- Effects -----------------------------------------------------------
    shakeTime: 0.28,
    shakeAmplitude: 5,
    flashTime: 0.2,
    flashAlpha: 0.85,
    reducedFlashAlpha: 0.3,
    maxParticles: 64,

    // Medal thresholds shown on the results panel.
    medals: [
      { score: 40, tier: 'platinum' },
      { score: 30, tier: 'gold' },
      { score: 20, tier: 'silver' },
      { score: 10, tier: 'bronze' }
    ]
  };

  // Screen layout for menus (logical px). Shared by the renderer and the DOM
  // overlay so the accessible restart button sits exactly over the drawn one.
  var LAYOUT = {
    scoreY: 36,
    titleY: 104,
    readyHintY: 384,
    readyBestY: 434,
    customizeButton: { x: 92, y: 468, w: 176, h: 44 },
    gameOverTitleY: 132,
    panel: { x: 30, y: 196, w: 300, h: 168 },
    restartButton: { x: 95, y: 392, w: 170, h: 54 },
    // Bird customisation screen.
    custom: {
      titleY: 56,
      panel: { x: 30, y: 112, w: 300, h: 320 },
      previewY: 192,
      colorY: 252,
      hatY: 342,
      colorPrev: { x: 42, y: 270, w: 44, h: 42 },
      colorNext: { x: 274, y: 270, w: 44, h: 42 },
      hatPrev: { x: 42, y: 360, w: 44, h: 42 },
      hatNext: { x: 274, y: 360, w: 44, h: 42 },
      done: { x: 95, y: 452, w: 170, h: 54 }
    }
  };

  ns.CONFIG = CONFIG;
  ns.LAYOUT = LAYOUT;
})(globalThis.Flapling = globalThis.Flapling || {});
