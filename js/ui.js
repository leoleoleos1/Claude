/*
 * DOM overlay controls: mute and pause buttons, plus transparent buttons that
 * sit exactly over buttons drawn on the canvas (restart, customise, the
 * colour / hat arrows and "done") so they are clickable, focusable and
 * announced by assistive technology. Also owns the screen-reader live region.
 */
(function (ns) {
  'use strict';

  function pct(v, total) { return (v / total * 100) + '%'; }

  function UI(opts) {
    var cfg = opts.config, L = opts.layout;
    this.btn = opts.buttons;   // { restart, pause, mute, customize, colorPrev, colorNext, hatPrev, hatNext, done }
    this.status = opts.status;
    this.pressed = null;       // id of the canvas-drawn button currently held down

    var place = function (btn, r) {
      btn.style.left = pct(r.x, cfg.width);
      btn.style.top = pct(r.y, cfg.height);
      btn.style.width = pct(r.w, cfg.width);
      btn.style.height = pct(r.h, cfg.height);
    };
    place(this.btn.restart, L.restartButton);
    place(this.btn.customize, L.customizeButton);
    ['colorPrev', 'colorNext', 'hatPrev', 'hatNext', 'done'].forEach(function (k) {
      place(this.btn[k], L.custom[k]);
    }, this);
    this.customizeButtons = [this.btn.colorPrev, this.btn.colorNext, this.btn.hatPrev, this.btn.hatNext, this.btn.done];
  }

  // Remove focus after a mouse/touch click so a later Space press flaps
  // instead of re-activating the button. Keyboard activation keeps focus.
  function blurIfPointer(btn, e) {
    if (e.detail > 0) btn.blur();
  }

  UI.prototype.bind = function (h) {
    var self = this;
    var handlers = {
      restart: h.onRestart,
      pause: h.onPause,
      mute: h.onMute,
      customize: h.onCustomize,
      colorPrev: function () { h.onCycle('color', -1); },
      colorNext: function () { h.onCycle('color', 1); },
      hatPrev: function () { h.onCycle('hat', -1); },
      hatNext: function () { h.onCycle('hat', 1); },
      done: h.onDone
    };
    Object.keys(handlers).forEach(function (id) {
      var btn = self.btn[id];
      btn.addEventListener('pointerdown', function () { h.onGesture(); self.pressed = id; });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (type) {
        btn.addEventListener(type, function () { if (self.pressed === id) self.pressed = null; });
      });
      btn.addEventListener('click', function (e) {
        blurIfPointer(btn, e);
        h.onGesture();
        handlers[id]();
      });
    });
  };

  UI.prototype.isPressed = function (id) { return this.pressed === id; };

  function show(btn, v) {
    if (!v && document.activeElement === btn) btn.blur();
    btn.hidden = !v;
  }

  UI.prototype.setRestartVisible = function (v) { show(this.btn.restart, v); };
  UI.prototype.setPauseVisible = function (v) { show(this.btn.pause, v); };
  UI.prototype.setReadyControls = function (v) { show(this.btn.customize, v); };
  UI.prototype.setCustomizeControls = function (v) {
    this.customizeButtons.forEach(function (b) { show(b, v); });
  };

  UI.prototype.setMuted = function (muted) {
    this.btn.mute.setAttribute('aria-pressed', muted ? 'true' : 'false');
    this.btn.mute.classList.toggle('is-muted', muted);
  };

  UI.prototype.announce = function (text) {
    this.status.textContent = text;
  };

  ns.UI = UI;
})(globalThis.Flapling = globalThis.Flapling || {});
