/*
 * Sound effects synthesised at runtime with the Web Audio API — no audio
 * files. The AudioContext is created lazily from the first user gesture
 * (browsers block audio before that). If Web Audio is missing or fails, every
 * call silently becomes a no-op and the game stays fully playable.
 */
(function (ns) {
  'use strict';

  var MASTER_VOLUME = 0.5;

  function AudioFX() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.muted = false;
    this.failed = false;
  }

  // Call from inside a user-gesture handler (pointerdown / keydown / click).
  AudioFX.prototype.unlock = function () {
    if (this.failed) return;
    try {
      if (!this.ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { this.failed = true; return; }
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
        this.master.connect(this.ctx.destination);
        this.noiseBuffer = this.makeNoise();
      }
      if (this.ctx.state === 'suspended' && this.ctx.resume) {
        var p = this.ctx.resume();
        if (p && p.catch) p.catch(function () {});
      }
    } catch (e) {
      this.failed = true;
      this.ctx = null;
    }
  };

  AudioFX.prototype.makeNoise = function () {
    var len = Math.floor(this.ctx.sampleRate * 0.5);
    var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  };

  AudioFX.prototype.setMuted = function (muted) {
    this.muted = !!muted;
    if (this.master) {
      try {
        this.master.gain.cancelScheduledValues(this.ctx.currentTime);
        this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_VOLUME, this.ctx.currentTime, 0.015);
      } catch (e) { /* ignore */ }
    }
  };

  AudioFX.prototype.play = function (name) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    var fn = SOUNDS[name];
    if (!fn) return;
    try { fn(this); } catch (e) { /* never let audio break the game */ }
  };

  // Oscillator with a short attack and exponential decay, optional pitch sweep.
  AudioFX.prototype.tone = function (o) {
    var ctx = this.ctx;
    var t = ctx.currentTime + (o.delay || 0);
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.from, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + o.dur + 0.03);
  };

  // Filtered white-noise burst with a sweeping filter frequency.
  AudioFX.prototype.noise = function (o) {
    var ctx = this.ctx;
    var t = ctx.currentTime + (o.delay || 0);
    var src = ctx.createBufferSource();
    var filter = ctx.createBiquadFilter();
    var g = ctx.createGain();
    src.buffer = this.noiseBuffer;
    filter.type = o.filter || 'bandpass';
    filter.Q.value = o.q || 1;
    filter.frequency.setValueAtTime(o.from, t);
    filter.frequency.exponentialRampToValueAtTime(o.to || o.from, t + o.dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + o.dur + 0.03);
  };

  var SOUNDS = {
    // Soft wing "fwip".
    flap: function (a) {
      a.noise({ from: 900, to: 2600, q: 1.1, dur: 0.11, vol: 0.32 });
      a.tone({ type: 'triangle', from: 360, to: 620, dur: 0.07, vol: 0.05 });
    },
    // Bright two-note chime (a rising fifth).
    score: function (a) {
      a.tone({ type: 'square', from: 880, dur: 0.07, vol: 0.05 });
      a.tone({ type: 'triangle', from: 880, dur: 0.07, vol: 0.08 });
      a.tone({ type: 'square', from: 1320, dur: 0.18, vol: 0.05, delay: 0.07 });
      a.tone({ type: 'triangle', from: 1320, dur: 0.18, vol: 0.08, delay: 0.07 });
    },
    // Crunchy thud.
    hit: function (a) {
      a.noise({ filter: 'lowpass', from: 2400, to: 250, q: 0.7, dur: 0.2, vol: 0.55 });
      a.tone({ type: 'square', from: 210, to: 50, dur: 0.17, vol: 0.16 });
    },
    // Falling whistle after hitting a pipe.
    fall: function (a) {
      a.tone({ type: 'triangle', from: 760, to: 170, dur: 0.5, vol: 0.12 });
    },
    // Panel swoosh followed by a short descending jingle.
    gameover: function (a) {
      a.noise({ from: 300, to: 2400, q: 0.9, dur: 0.26, vol: 0.14 });
      var notes = [587.33, 493.88, 392.0, 293.66];
      for (var i = 0; i < notes.length; i++) {
        var last = i === notes.length - 1;
        a.tone({ type: 'square', from: notes[i], dur: last ? 0.34 : 0.1, vol: 0.05, delay: 0.12 + i * 0.11 });
        a.tone({ type: 'triangle', from: notes[i] / 2, dur: last ? 0.34 : 0.1, vol: 0.07, delay: 0.12 + i * 0.11 });
      }
    },
    click: function (a) {
      a.tone({ type: 'square', from: 520, to: 780, dur: 0.05, vol: 0.05 });
    }
  };

  ns.AudioFX = AudioFX;
})(globalThis.Flapling = globalThis.Flapling || {});
