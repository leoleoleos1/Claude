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
    DYING: 'dying',
    GAME_OVER: 'gameover'
  });

  var FEATHERS = ['#ff8c2e', '#ffc06b', '#fff2cf', '#fff7e3'];
  var DUST = ['#ddc386', '#ecd9a6', '#c6a96c'];

  function Game(opts) {
    this.cfg = opts.config;
    this.world = opts.world;
    this.audio = opts.audio;
    this.storage = opts.storage;
    this.ui = opts.ui;
    this.reducedMotion = false;

    this.best = this.storage.getBest();
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
    this.fx = { flash: 0, shake: 0, scorePop: 0 };
  };

  Game.prototype.setState = function (s) {
    this.state = s;
    this.stateTime = 0;
    this.ui.setPauseVisible(s === State.PLAYING);
    if (s !== State.GAME_OVER) this.ui.setRestartVisible(false);
  };

  // --- Input ------------------------------------------------------------------
  // action: 'flap' | 'confirm' | 'pause' | 'mute';  source: 'key' | 'pointer'
  Game.prototype.handleAction = function (action, source) {
    if (source) this.lastInput = source;

    if (action === 'mute') { this.toggleMute(); return; }

    switch (this.state) {
      case State.READY:
        if (action === 'flap' || action === 'confirm') this.start();
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
    var fx = this.fx;
    fx.flash = Math.max(0, fx.flash - dt);
    fx.shake = Math.max(0, fx.shake - dt);
    fx.scorePop = Math.max(0, fx.scorePop - dt);

    switch (this.state) {
      case State.READY:
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
      w.emit(w.bird.x, w.bird.y, 10, FEATHERS, 160, 120);
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
