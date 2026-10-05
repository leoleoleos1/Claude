/*
 * Game state machine. Owns the World and decides what each input means in
 * each state, when sounds play, when the best score is saved, and which DOM
 * controls are visible.
 *
 *   READY ──input──▶ PLAYING ──collision──▶ DYING ──bird lands──▶ GAME_OVER
 *     ▲                │  ▲                                          │
 *     │   tab hidden / │  │ countdown                                │
 *     │   P / Esc      ▼  │ finished                                 │
 *     │               PAUSED ──input──▶ (3-2-1 countdown)            │
 *     └──────────────────────── restart (after cooldown) ────────────┘
 *     │
 *     └──▶ CUSTOMIZE (bird colour / hat picker, only from READY)
 *
 * While PAUSED the world is completely frozen. An explicit input starts a
 * short countdown; the run then continues from exactly the same position and
 * velocity, so returning to the tab never causes a sudden jump.
 */
(function (ns) {
  'use strict';

  var State = Object.freeze({
    READY: 'ready',
    PLAYING: 'playing',
    PAUSED: 'paused',
    CUSTOMIZE: 'customize',
    DYING: 'dying',
    GAME_OVER: 'gameover'
  });

  var DUST = ['#ddc386', '#ecd9a6', '#c6a96c'];

  function Game(opts) {
    this.cfg = opts.config;
    this.world = opts.world;
    this.audio = opts.audio;
    this.storage = opts.storage;
    this.ui = opts.ui;
    this.reducedMotion = false;

    this.best = this.storage.getBest();
    this.skins = ns.Skins;
    var saved = this.storage.getSkin();
    this.skin = {
      color: this.skins.indexOf(this.skins.colors, saved.color),
      hat: this.skins.indexOf(this.skins.hats, saved.hat)
    };
    // Never wear something that isn't unlocked (e.g. edited storage).
    if (!this.isUnlocked(this.skins.colors[this.skin.color])) this.skin.color = 0;
    if (!this.isUnlocked(this.skins.hats[this.skin.hat])) this.skin.hat = 0;
    this.browse = { color: this.skin.color, hat: this.skin.hat };

    // Time of day: dayPhase is what is drawn and eases towards
    // dayBase + score / dayCyclePipes (1.0 = one full day).
    this.dayPhase = 0;
    this.dayBase = 0;
    this.clock = 0; // ever-increasing simulation time for ambient animation
    this.state = State.READY;
    this.stateTime = 0;
    this.lastInput = 'pointer';
    this.resumeCountdown = 0;
    this.resetRun();
  }

  Game.State = State;

  Game.prototype.resetRun = function () {
    this.world.reset();
    this.newBest = false;
    this.bestAtStart = this.best;
    this.hitKind = null;
    this.fallSoundAt = -1;
    this.panelShown = false;
    this.restartEnabled = false;
    this.fx = { flash: 0, shake: 0, scorePop: 0, meteor: null };
    // A new run starts at midday: roll the sky forward to the next midday.
    this.dayBase = Math.ceil(this.dayPhase - 1e-9);
  };

  Game.prototype.setState = function (s) {
    this.state = s;
    this.stateTime = 0;
    this.ui.setPauseVisible(s === State.PLAYING);
    this.ui.setReadyControls(s === State.READY);
    this.ui.setCustomizeControls(s === State.CUSTOMIZE);
    if (s !== State.GAME_OVER) this.ui.setRestartVisible(false);
  };

  // --- Input ------------------------------------------------------------------
  // action: 'flap' | 'confirm' | 'pause' | 'mute' | 'customize' | 'left' |
  //         'right' | 'down';  source: 'key' | 'pointer';  code: KeyboardEvent.code
  Game.prototype.handleAction = function (action, source, code) {
    if (source) this.lastInput = source;

    if (action === 'mute') { this.toggleMute(); return; }

    switch (this.state) {
      case State.READY:
        if (action === 'flap' || action === 'confirm') this.start();
        else if (action === 'customize') this.openCustomize();
        break;

      case State.CUSTOMIZE:
        // Arrows browse; Space / Enter / Esc / C close. Taps on the canvas
        // itself do nothing so the picker can't be closed by accident.
        if (source !== 'key') break;
        if (action === 'left') this.cycle('color', -1);
        else if (action === 'right') this.cycle('color', 1);
        else if (code === 'ArrowUp') this.cycle('hat', -1);
        else if (action === 'down') this.cycle('hat', 1);
        else if (action === 'flap' || action === 'confirm' || action === 'pause' || action === 'customize') this.closeCustomize();
        break;

      case State.PLAYING:
        if (action === 'flap') this.flap();
        else if (action === 'pause') this.pause();
        break;

      case State.PAUSED:
        // Resume only on explicit input, followed by a countdown. Inputs during
        // the countdown are ignored so they can't cause an accidental flap.
        if (this.resumeCountdown <= 0 &&
            (action === 'flap' || action === 'confirm' || action === 'pause')) this.beginResume();
        break;

      case State.DYING:
        break; // flapping is disabled once the bird has crashed

      case State.GAME_OVER:
        // Pointer users restart with the on-screen button (handled by the UI);
        // keyboard users can press Space / Up / Enter once the cooldown is over.
        if (source === 'key' && (action === 'flap' || action === 'confirm')) this.restart();
        break;
    }
  };

  Game.prototype.start = function () {
    this.world.beginRun();
    this.setState(State.PLAYING);
    this.flap();
  };

  Game.prototype.flap = function () {
    this.world.flap();
    this.audio.play('flap');
  };

  Game.prototype.pause = function () {
    if (this.state !== State.PLAYING) return;
    this.setState(State.PAUSED);
    this.resumeCountdown = 0;
    this.ui.announce('Paused. Tap or press Space to resume.');
  };

  Game.prototype.beginResume = function () {
    if (this.state !== State.PAUSED) return;
    if (this.cfg.resumeCountdown <= 0) { this.resume(); return; }
    this.resumeCountdown = this.cfg.resumeCountdown;
    this.audio.play('click');
    this.ui.announce('Resuming in 3');
  };

  Game.prototype.resume = function () {
    if (this.state !== State.PAUSED) return;
    this.resumeCountdown = 0;
    this.setState(State.PLAYING);
    this.ui.announce('');
  };

  // Countdown digit to display (3, 2, 1) or 0 when not counting down.
  Game.prototype.countdownDigit = function () {
    if (this.state !== State.PAUSED || this.resumeCountdown <= 0) return 0;
    return Math.ceil(this.resumeCountdown / this.cfg.resumeCountdown * 3);
  };

  Game.prototype.canRestart = function () {
    return this.state === State.GAME_OVER && this.restartEnabled;
  };

  Game.prototype.restart = function () {
    if (!this.canRestart()) return false;
    this.audio.play('click');
    this.resetRun();
    this.setState(State.READY);
    this.ui.announce('');
    return true;
  };

  // --- Bird customisation ---------------------------------------------------------
  Game.prototype.isUnlocked = function (item) { return this.best >= item.unlock; };

  Game.prototype.openCustomize = function () {
    if (this.state !== State.READY) return;
    this.browse = { color: this.skin.color, hat: this.skin.hat };
    this.audio.play('click');
    this.setState(State.CUSTOMIZE);
    this.ui.announce('Customize your bird. Colour ' + this.skins.colors[this.skin.color].name +
      ', hat ' + this.skins.hats[this.skin.hat].name + '.');
  };

  Game.prototype.closeCustomize = function () {
    if (this.state !== State.CUSTOMIZE) return;
    this.browse = { color: this.skin.color, hat: this.skin.hat };
    this.audio.play('click');
    this.setState(State.READY);
    this.ui.announce('');
  };

  // Browse colours or hats. Unlocked items are equipped and saved right away;
  // locked ones are only previewed.
  Game.prototype.cycle = function (kind, dir) {
    if (this.state !== State.CUSTOMIZE) return;
    var list = kind === 'color' ? this.skins.colors : this.skins.hats;
    var i = (this.browse[kind] + dir + list.length) % list.length;
    this.browse[kind] = i;
    var item = list[i];
    var label = (kind === 'color' ? 'Colour ' : 'Hat ') + item.name.toLowerCase();
    if (this.isUnlocked(item)) {
      this.skin[kind] = i;
      this.storage.setSkin({ color: this.skins.colors[this.skin.color].id, hat: this.skins.hats[this.skin.hat].id });
      this.ui.announce(label + ' equipped.');
    } else {
      this.ui.announce(label + ' is locked. Reach a best score of ' + item.unlock + ' to unlock it.');
    }
    this.audio.play('click');
  };

  Game.prototype.toggleMute = function () {
    var muted = !this.audio.muted;
    this.audio.setMuted(muted);
    this.storage.setMuted(muted);
    this.ui.setMuted(muted);
    if (!muted) this.audio.play('click');
  };

  // Browser tab hidden: pause an active run so nothing happens unseen. If a
  // resume countdown was running, cancel it and wait for input again.
  Game.prototype.onHidden = function () {
    if (this.state === State.PLAYING) this.pause();
    else if (this.state === State.PAUSED) this.resumeCountdown = 0;
  };

  // --- Simulation step (fixed dt) -----------------------------------------------
  Game.prototype.update = function (dt) {
    var w = this.world;
    w.snapshot();
    this.updateDayPhase(dt);
    if (this.state === State.PAUSED) {
      // The world stays frozen; only the resume countdown advances.
      if (this.resumeCountdown > 0) {
        var before = this.countdownDigit();
        this.resumeCountdown -= dt;
        if (this.resumeCountdown <= 0) this.resume();
        else if (this.countdownDigit() !== before) {
          this.audio.play('click');
          this.ui.announce('Resuming in ' + this.countdownDigit());
        }
      }
      return;
    }

    this.stateTime += dt;
    this.clock += dt;
    var fx = this.fx;
    this.updateMeteor(dt);
    fx.flash = Math.max(0, fx.flash - dt);
    fx.shake = Math.max(0, fx.shake - dt);
    fx.scorePop = Math.max(0, fx.scorePop - dt);

    switch (this.state) {
      case State.READY:
      case State.CUSTOMIZE:
        w.updateReady(dt);
        break;

      case State.PLAYING: {
        var res = w.updatePlaying(dt);
        if (res.hit) this.die(res.hit);
        else if (res.scored) this.onScore();
        break;
      }

      case State.DYING:
        if (this.fallSoundAt >= 0 && this.stateTime >= this.fallSoundAt) {
          this.fallSoundAt = -1;
          if (!w.bird.onGround) this.audio.play('fall');
        }
        if (w.updateDying(dt)) {
          this.land();
        } else if (w.bird.onGround) {
          this.setState(State.GAME_OVER);
        }
        break;

      case State.GAME_OVER:
        w.updateDying(dt); // lets the bird finish tipping over
        if (!this.panelShown && this.stateTime >= this.cfg.panelDelay) {
          this.panelShown = true;
          this.panelTime = this.stateTime;
          this.audio.play('gameover');
          this.ui.announce('Game over. Score ' + w.score + '. Best ' + this.best + '.' +
            (this.newBest ? ' New best!' : ''));
        }
        // Cooldown: the input that caused the crash can't restart the game.
        if (this.panelShown && !this.restartEnabled &&
            this.stateTime >= this.panelTime + this.cfg.panelAnimTime + this.cfg.restartCooldown) {
          this.restartEnabled = true;
          this.ui.setRestartVisible(true);
        }
        break;
    }
    w.updateParticles(dt);
  };

  // Ease the sky towards the time of day for the current score. Far behind
  // (e.g. rolling forward to midday after a restart) it catches up faster.
  Game.prototype.updateDayPhase = function (dt) {
    if (this.state === State.PAUSED) return;
    var cfg = this.cfg;
    var target = this.dayBase + this.world.score / cfg.dayCyclePipes;
    var diff = target - this.dayPhase;
    if (diff > 0) {
      var base = 1 / cfg.dayCyclePipes / cfg.dayTransitionTime;
      this.dayPhase = Math.min(target, this.dayPhase + base * Math.max(1, diff * cfg.dayCyclePipes) * dt);
    }
    // Keep the number small: midday again → back to 0.
    if (this.dayPhase === target && this.world.score === 0 && this.dayBase > 0) {
      this.dayPhase = 0;
      this.dayBase = 0;
    }
  };

  // Occasional shooting star at night (purely decorative).
  Game.prototype.updateMeteor = function (dt) {
    var m = this.fx.meteor;
    if (m) {
      m.life -= dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.life <= 0) this.fx.meteor = null;
      return;
    }
    if (this.reducedMotion) return;
    var stars = ns.DayCycle.sample(this.dayPhase).stars;
    if (stars > 0.8 && Math.random() < dt / 5) {
      this.fx.meteor = { x: 120 + Math.random() * 220, y: 20 + Math.random() * 140, vx: -300, vy: 140, life: 0.6, maxLife: 0.6 };
    }
  };

  Game.prototype.currentSkin = function () {
    return { color: this.skins.colors[this.skin.color], hat: this.skins.hats[this.skin.hat] };
  };

  Game.prototype.onScore = function () {
    var score = this.world.score;
    this.audio.play('score');
    this.fx.scorePop = 0.15;
    if (score > this.best) {
      // Save immediately so the record survives even if the tab is closed mid-run.
      this.best = score;
      this.newBest = true;
      this.storage.setBest(score);
    }
  };

  Game.prototype.die = function (kind) {
    var cfg = this.cfg, w = this.world;
    this.hitKind = kind;
    this.audio.play('hit');
    if (!this.reducedMotion) {
      this.fx.shake = cfg.shakeTime;
      var pal = this.currentSkin().color.palette;
      w.emit(w.bird.x, w.bird.y, 10, [pal.o, pal.h, pal.c, pal.m], 160, 120);
    }
    this.fx.flash = cfg.flashTime;
    this.setState(State.DYING);
    // Whistle while falling from a pipe or the ceiling (not when already on the ground).
    this.fallSoundAt = kind === 'ground' ? -1 : 0.22;
    if (kind === 'ground') this.land();
  };

  Game.prototype.land = function () {
    var w = this.world;
    if (!this.reducedMotion) w.emit(w.bird.x, w.groundY - 2, 7, DUST, 90, 80);
    this.setState(State.GAME_OVER);
  };

  Game.prototype.medalTier = function () {
    var s = this.world.score, m = this.cfg.medals;
    for (var i = 0; i < m.length; i++) if (s >= m[i].score) return m[i].tier;
    return 'none';
  };

  ns.Game = Game;
})(globalThis.Flapling = globalThis.Flapling || {});
