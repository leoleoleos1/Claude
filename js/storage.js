/*
 * Persistent settings (best score, mute). localStorage can throw (Safari
 * private mode, disabled cookies, sandboxed iframes, quota), so every access is
 * guarded and an in-memory fallback keeps the game working for the session.
 */
(function (ns) {
  'use strict';

  var KEY_BEST = 'flapling.bestScore';
  var KEY_MUTED = 'flapling.muted';
  var KEY_SKIN = 'flapling.skin';
  var memory = {};

  var store = null;
  try {
    var probe = '__flapling_probe__';
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    store = window.localStorage;
  } catch (e) {
    store = null;
  }

  function read(key) {
    if (store) {
      try { return store.getItem(key); } catch (e) { /* fall through to memory */ }
    }
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
  }

  function write(key, value) {
    memory[key] = String(value);
    if (store) {
      try { store.setItem(key, String(value)); } catch (e) { /* keep the in-memory copy */ }
    }
  }

  ns.Storage = {
    persistent: store !== null,
    getBest: function () {
      var n = parseInt(read(KEY_BEST), 10);
      return isFinite(n) && n > 0 ? Math.min(n, 999999) : 0;
    },
    setBest: function (n) { write(KEY_BEST, Math.max(0, Math.floor(n))); },
    getMuted: function () { return read(KEY_MUTED) === '1'; },
    setMuted: function (muted) { write(KEY_MUTED, muted ? '1' : '0'); },
    // Equipped bird skin as { color: id, hat: id }.
    getSkin: function () {
      try {
        var v = JSON.parse(read(KEY_SKIN));
        if (v && typeof v.color === 'string' && typeof v.hat === 'string') return v;
      } catch (e) { /* corrupt or missing */ }
      return { color: 'sunny', hat: 'none' };
    },
    setSkin: function (skin) { write(KEY_SKIN, JSON.stringify({ color: skin.color, hat: skin.hat })); }
  };
})(globalThis.Flapling = globalThis.Flapling || {});
