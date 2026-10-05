/*
 * DOM overlay controls: mute, pause and restart buttons plus a screen-reader
 * live region. The restart button is drawn on the canvas; the real <button>
 * sits exactly on top of it (transparent) so it is clickable, focusable and
 * announced by assistive technology.
 */
(function (ns) {
  'use strict';

  function pct(v, total) { return (v / total * 100) + '%'; }

  function UI(opts) {
    this.restartBtn = opts.restartBtn;
    this.pauseBtn = opts.pauseBtn;
    this.muteBtn = opts.muteBtn;
    this.status = opts.status;
    this.restartPressed = false;

    var cfg = opts.config, r = opts.layout.restartButton;
    var s = this.restartBtn.style;
    s.left = pct(r.x, cfg.width);
    s.top = pct(r.y, cfg.height);
    s.width = pct(r.w, cfg.width);
    s.height = pct(r.h, cfg.height);
  }

  // Remove focus after a mouse/touch click so a later Space press flaps
  // instead of re-activating the button. Keyboard activation keeps focus.
  function blurIfPointer(btn, e) {
    if (e.detail > 0) btn.blur();
  }

  UI.prototype.bind = function (h) {
    var self = this;
    [this.restartBtn, this.pauseBtn, this.muteBtn].forEach(function (btn) {
      btn.addEventListener('pointerdown', function () { h.onGesture(); });
    });

    this.restartBtn.addEventListener('pointerdown', function () { self.restartPressed = true; });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (type) {
      self.restartBtn.addEventListener(type, function () { self.restartPressed = false; });
    });

    this.restartBtn.addEventListener('click', function (e) {
      blurIfPointer(self.restartBtn, e);
      h.onGesture();
      h.onRestart();
    });
    this.pauseBtn.addEventListener('click', function (e) {
      blurIfPointer(self.pauseBtn, e);
      h.onPause();
    });
    this.muteBtn.addEventListener('click', function (e) {
      blurIfPointer(self.muteBtn, e);
      h.onGesture();
      h.onMute();
    });
  };

  UI.prototype.setRestartVisible = function (v) {
    this.restartBtn.hidden = !v;
    if (!v) this.restartPressed = false;
  };

  UI.prototype.setPauseVisible = function (v) {
    if (!v && document.activeElement === this.pauseBtn) this.pauseBtn.blur();
    this.pauseBtn.hidden = !v;
  };

  UI.prototype.setMuted = function (muted) {
    this.muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    this.muteBtn.classList.toggle('is-muted', muted);
  };

  UI.prototype.announce = function (text) {
    this.status.textContent = text;
  };

  ns.UI = UI;
})(globalThis.Flapling = globalThis.Flapling || {});
