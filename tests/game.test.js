/*
 * Tests for the time-of-day cycle and the state machine / bird customisation,
 * run headlessly with stub audio, storage and UI:  node --test
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const sandbox = { Math, console, JSON };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['config.js', 'util.js', 'daycycle.js', 'skins.js', 'world.js', 'game.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.Flapling;
}

const F = load();
const cfg = F.CONFIG;
const STEP = cfg.fixedTimestep;

function makeGame(best = 0, skin = { color: 'sunny', hat: 'none' }) {
  const saved = { best, skin, muted: false };
  const noop = () => {};
  const game = new F.Game({
    config: cfg,
    world: new F.World(cfg),
    audio: { play: noop, setMuted: noop, muted: false },
    storage: {
      getBest: () => saved.best, setBest: n => { saved.best = n; },
      getSkin: () => saved.skin, setSkin: s => { saved.skin = s; },
      setMuted: noop
    },
    ui: { setPauseVisible: noop, setRestartVisible: noop, setReadyControls: noop, setCustomizeControls: noop, setMuted: noop, announce: noop }
  });
  return { game, saved };
}

const run = (game, seconds) => { for (let i = 0; i < Math.round(seconds / STEP); i++) game.update(STEP); };

test('day cycle: midday at 0, night halfway, wraps smoothly', () => {
  const noon = F.DayCycle.sample(0), night = F.DayCycle.sample(0.5), wrap = F.DayCycle.sample(1);
  assert.strictEqual(noon.stars, 0);
  assert.strictEqual(night.stars, 1);
  assert.ok(noon.sun && !noon.moon, 'sun up at midday');
  assert.ok(night.moon && !night.sun, 'moon up at night');
  assert.deepStrictEqual(wrap.top, noon.top);
  // No sudden jumps in colour between nearby phases.
  for (let p = 0; p < 1; p += 0.005) {
    const a = F.DayCycle.sample(p), b = F.DayCycle.sample(p + 0.005);
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(a.mid[c] - b.mid[c]) < 30, `colour jump at ${p.toFixed(3)}`);
  }
});

test('each pipe moves the time of day forward gradually', () => {
  const { game } = makeGame();
  game.handleAction('flap', 'key');
  assert.strictEqual(game.state, 'playing');
  game.world.score = 1; // as if a pipe was just passed
  game.update(STEP);
  const step = 1 / cfg.dayCyclePipes;
  assert.ok(game.dayPhase > 0 && game.dayPhase < step, 'starts easing, no jump');
  game.world.bird.y = 300; // keep the bird safe while time passes
  for (let i = 0; i < Math.round(cfg.dayTransitionTime / STEP) + 2; i++) { game.world.bird.y = 300; game.world.bird.vy = 0; game.update(STEP); }
  assert.ok(Math.abs(game.dayPhase - step) < 1e-9, 'reaches the next time of day');
});

test('after a run the sky rolls forward to midday again', () => {
  const { game } = makeGame();
  game.handleAction('flap', 'key');
  game.world.score = 6;
  game.dayPhase = 6 / cfg.dayCyclePipes; // evening
  game.die('ground');
  run(game, 3);
  assert.ok(game.restart());
  const before = game.dayPhase;
  run(game, 0.2);
  assert.ok(game.dayPhase > before, 'moves forward, not backwards');
  run(game, 6);
  assert.strictEqual(game.dayPhase, 0);
  assert.strictEqual(game.dayBase, 0);
});

test('paused games freeze the time of day', () => {
  const { game } = makeGame();
  game.handleAction('flap', 'key');
  game.world.score = 3;
  game.pause();
  const p = game.dayPhase;
  run(game, 1);
  assert.strictEqual(game.dayPhase, p);
});

test('customisation: unlocked items are equipped and saved, locked ones only previewed', () => {
  const { game, saved } = makeGame(12);
  game.handleAction('customize', 'key', 'KeyC');
  assert.strictEqual(game.state, 'customize');
  game.handleAction('right', 'key', 'ArrowRight');
  assert.strictEqual(F.Skins.colors[game.skin.color].id, 'sky');
  assert.strictEqual(saved.skin.color, 'sky');
  assert.strictEqual(saved.skin.hat, 'none');
  // Crown needs 20: browse to it, it must not be equipped.
  const crown = F.Skins.hats.findIndex(h => h.id === 'crown');
  for (let i = 0; i < crown; i++) game.handleAction('down', 'key', 'ArrowDown');
  assert.strictEqual(game.browse.hat, crown);
  assert.notStrictEqual(game.skin.hat, crown);
  // Party hat (10) is unlocked with best 12 and was equipped on the way.
  assert.strictEqual(F.Skins.hats[game.skin.hat].id, 'party');
  // Taps on the canvas don't start the game or close the picker.
  game.handleAction('flap', 'pointer', null);
  assert.strictEqual(game.state, 'customize');
  game.handleAction('confirm', 'key', 'Enter');
  assert.strictEqual(game.state, 'ready');
  assert.strictEqual(game.browse.hat, game.skin.hat, 'browse resets to the equipped hat');
});

test('a locked skin in storage falls back to the default', () => {
  const { game } = makeGame(0, { color: 'gold', hat: 'crown' });
  assert.strictEqual(game.skin.color, 0);
  assert.strictEqual(game.skin.hat, 0);
});

test('customisation is only reachable from the title screen', () => {
  const { game } = makeGame();
  game.handleAction('flap', 'key');
  game.handleAction('customize', 'key', 'KeyC');
  assert.strictEqual(game.state, 'playing');
});
