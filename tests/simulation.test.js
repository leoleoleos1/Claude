/*
 * Headless tests for the simulation (no browser needed):
 *   node --test tests/
 * They load the same game scripts the page uses into a Node VM.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const sandbox = { Math, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['config.js', 'util.js', 'world.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.Flapling;
}

const F = load();
const cfg = F.CONFIG;
const STEP = cfg.fixedTimestep;

// Simple autopilot: flap whenever the bird drops below a point just under
// the centre of the next opening.
function autopilot(w) {
  const b = w.bird;
  const next = w.pipes.find(p => p.x - w.scroll + cfg.pipeWidth + cfg.pipeCapOverhang > b.x - w.hitRadius);
  const target = next ? next.gapY + 22 : 290;
  return b.y > target && b.vy > 0;
}

// Drive the world through the same accumulator loop main.js uses, fed with a
// repeating pattern of frame durations, and record the bird's height after
// every simulation step. Flaps are requested at given step indices (input is
// applied before the next step, exactly as with real events between frames).
function trajectory(seed, framePattern, flapSteps, totalSteps) {
  const w = new F.World(cfg);
  w.reset(seed);
  w.beginRun();
  const ys = [];
  let acc = 0, steps = 0, fi = 0, hit = null;
  while (steps < totalSteps && !hit) {
    acc += Math.min(framePattern[fi++ % framePattern.length], cfg.maxFrameDelta);
    while (acc >= STEP && steps < totalSteps && !hit) {
      if (flapSteps.includes(steps)) w.flap();
      w.snapshot();
      hit = w.updatePlaying(STEP).hit;
      ys.push(w.bird.y);
      steps++;
      acc -= STEP;
    }
  }
  return { ys, hit, score: w.score };
}

test('physics is identical at different frame rates', () => {
  const flaps = [0, 40, 80, 125, 170, 215, 260, 300];
  const N = 360; // 3 simulated seconds
  const runs = [
    [1 / 30], [1 / 60], [1 / 144], [1 / 144, 1 / 30, 1 / 60, 1 / 90, 0.002]
  ].map(p => trajectory(1, p, flaps, N));
  for (const r of runs) {
    assert.strictEqual(r.ys.length, runs[0].ys.length);
    assert.deepStrictEqual(r.ys, runs[0].ys);
    assert.strictEqual(r.hit, runs[0].hit);
  }
});

test('flap sets (not adds) upward velocity', () => {
  const w = new F.World(cfg); w.reset(3); w.beginRun();
  w.flap(); w.flap(); w.flap();
  assert.strictEqual(w.bird.vy, cfg.flapVelocity);
  w.bird.vy = 300; w.flap();
  assert.strictEqual(w.bird.vy, cfg.flapVelocity);
});

test('gravity accelerates the bird and caps at max fall speed', () => {
  const w = new F.World(cfg); w.reset(3); w.beginRun();
  w.bird.y = 100;
  for (let i = 0; i < 30; i++) w.updatePlaying(STEP);
  assert.ok(w.bird.vy > 0 && w.bird.y > 100);
  w.bird.vy = 0; w.bird.y = 50;
  for (let i = 0; i < 120 * 2; i++) { w.bird.y = 50; w.updatePlaying(STEP); }
  assert.ok(w.bird.vy <= cfg.maxFallSpeed);
});

test('pipe openings respect margins and max shift; pipes are evenly spaced', () => {
  for (let seed = 0; seed < 200; seed++) {
    const w = new F.World(cfg); w.reset(seed); w.beginRun();
    const ys = [];
    for (let i = 0; i < 60; i++) { ys.push(w.nextGapY()); }
    const half = cfg.pipeGap / 2;
    for (let i = 0; i < ys.length; i++) {
      assert.ok(ys[i] - half >= cfg.pipeMarginTop, 'top margin');
      assert.ok(ys[i] + half <= w.groundY - cfg.pipeMarginBottom, 'bottom margin');
      if (i) assert.ok(Math.abs(ys[i] - ys[i - 1]) <= cfg.pipeMaxGapShift, 'reachable shift');
    }
  }
  const w = new F.World(cfg); w.reset(1); w.beginRun();
  for (let i = 0; i < 120 * 10; i++) { w.bird.y = 290; w.bird.vy = 0; w.updatePlaying(STEP); }
  for (let i = 1; i < w.pipes.length; i++) assert.strictEqual(w.pipes[i].x - w.pipes[i - 1].x, cfg.pipeSpacing);
});

test('first pipe leaves a run-up of at least two seconds', () => {
  const w = new F.World(cfg); w.reset(1); w.scroll = 1234.5; w.beginRun();
  const secondsUntilReach = (w.nextPipeX - w.scroll - cfg.pipeCapOverhang - (cfg.birdX + w.hitRadius)) / cfg.scrollSpeed;
  assert.ok(secondsUntilReach >= 2, `got ${secondsUntilReach.toFixed(2)}s`);
});

test('each pipe pair scores exactly once and old pipes are removed', () => {
  const w = new F.World(cfg); w.reset(7); w.beginRun();
  let events = 0, maxPipes = 0;
  for (let i = 0; i < 120 * 60; i++) {
    if (autopilot(w)) w.flap();
    const r = w.updatePlaying(STEP);
    assert.ok(r.scored <= 1);
    events += r.scored;
    maxPipes = Math.max(maxPipes, w.pipes.length);
    if (r.hit) break;
  }
  assert.strictEqual(events, w.score);
  assert.ok(w.score >= 20, 'autopilot should get far: ' + w.score);
  assert.ok(maxPipes <= 4, 'pipes culled, max alive ' + maxPipes);
});

test('generated courses are passable (autopilot over many seeds)', () => {
  let total = 0, deaths = 0;
  for (let seed = 100; seed < 140; seed++) {
    const w = new F.World(cfg); w.reset(seed); w.beginRun();
    for (let i = 0; i < 120 * 90; i++) {
      if (autopilot(w)) w.flap();
      if (w.updatePlaying(STEP).hit) { deaths++; break; }
    }
    total += w.score;
  }
  assert.ok(deaths <= 2, `autopilot crashed on ${deaths} of 40 courses (avg ${(total / 40).toFixed(1)} pipes)`);
});

test('collisions: ground, ceiling and pipe', () => {
  let w = new F.World(cfg); w.reset(1); w.beginRun();
  w.bird.y = w.groundY - 5; w.bird.vy = 100;
  assert.strictEqual(w.updatePlaying(STEP).hit, 'ground');

  w = new F.World(cfg); w.reset(1); w.beginRun();
  w.bird.y = 12; w.bird.vy = -400;
  assert.strictEqual(w.updatePlaying(STEP).hit, 'ceiling');

  w = new F.World(cfg); w.reset(1); w.beginRun();
  w.pipes.push({ x: w.scroll + cfg.birdX - 10, gapY: 300, scored: false });
  w.nextPipeX = 1e9;
  w.bird.y = 300 - cfg.pipeGap / 2 + 2; w.bird.vy = 0; // inside the upper cap
  assert.strictEqual(w.updatePlaying(STEP).hit, 'pipe');

  // Centre of the gap is safe.
  w = new F.World(cfg); w.reset(1); w.beginRun();
  w.pipes.push({ x: w.scroll + cfg.birdX - 10, gapY: 300, scored: false });
  w.nextPipeX = 1e9;
  w.bird.y = 300; w.bird.vy = 0;
  assert.strictEqual(w.updatePlaying(STEP).hit, null);
});

test('dying bird falls to the ground and stays there', () => {
  const w = new F.World(cfg); w.reset(1); w.beginRun();
  w.bird.y = 200; w.bird.vy = -300;
  let landed = false;
  for (let i = 0; i < 120 * 3 && !landed; i++) landed = w.updateDying(STEP);
  assert.ok(landed);
  assert.strictEqual(w.bird.y, w.groundY - w.hitRadius);
  const scroll = w.scroll;
  for (let i = 0; i < 60; i++) w.updateDying(STEP);
  assert.strictEqual(w.scroll, scroll, 'world stays frozen');
});

test('reset clears the run completely', () => {
  const w = new F.World(cfg); w.reset(1); w.beginRun();
  for (let i = 0; i < 120 * 5; i++) { if (autopilot(w)) w.flap(); w.updatePlaying(STEP); }
  w.emit(10, 10, 5, ['#fff'], 10, 10);
  w.reset(2);
  assert.strictEqual(w.score, 0);
  assert.strictEqual(w.pipes.length, 0);
  assert.strictEqual(w.particles.length, 0);
  assert.strictEqual(w.bird.y, cfg.readyY);
  assert.strictEqual(w.bird.vy, 0);
});
