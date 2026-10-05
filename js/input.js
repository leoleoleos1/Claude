/*
 * Input handling. Translates raw keyboard and pointer events into abstract
 * actions ('flap', 'confirm', 'pause', 'mute') for the game.
 *
 * - Only Pointer Events are used for mouse/touch/pen, and pointerdown's
 *   default is prevented, so a tap can never fire both a touch and a
 *   synthetic mouse flap.
 * - Keys must be released before they flap again: auto-repeat and keys that
 *   are held down are ignored.
 */
(function (ns) {
  'use strict';

  var KEY_ACTIONS = {
    Space: 'flap',
    ArrowUp: 'flap',
    KeyW: 'flap',
    Enter: 'confirm',
    NumpadEnter: 'confirm',
    KeyP: 'pause',
    Escape: 'pause',
    KeyM: 'mute'
  };
  // Keys whose default browser behaviour (scrolling) must be suppressed.
  var BLOCK_DEFAULT = { Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, PageUp: 1, PageDown: 1, Home: 1, End: 1 };

  function isInteractive(el) {
    return !!el && el !== document.body && /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
  }

  function attach(opts) {
    var surface = opts.surface;   // element that receives taps/clicks
    var frame = opts.frame;       // element whose gestures are blocked
    var onAction = opts.onAction;
    var onGesture = opts.onGesture || function () {};
    var held = Object.create(null);

    window.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var code = e.code || (e.key === ' ' ? 'Space' : e.key);
      // Let focused buttons handle Space/Enter natively (keyboard accessibility).
      if (isInteractive(e.target) && (code === 'Space' || code === 'Enter' || code === 'NumpadEnter')) return;
      if (BLOCK_DEFAULT[code]) e.preventDefault();
      var action = KEY_ACTIONS[code];
      if (!action) return;
      e.preventDefault();
      if (e.repeat || held[code]) return; // holding a key never repeats a flap
      held[code] = true;
      onGesture();
      onAction(action, 'key');
    });

    window.addEventListener('keyup', function (e) {
      var code = e.code || (e.key === ' ' ? 'Space' : e.key);
      held[code] = false;
    });

    // Losing focus means we will never see the keyup, so forget held keys.
    window.addEventListener('blur', function () { held = Object.create(null); });

    surface.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      if (surface.focus) {
        try { surface.focus({ preventScroll: true }); } catch (err) { surface.focus(); }
      }
      onGesture();
      onAction('flap', 'pointer');
    });

    // Block scrolling, pinch-zoom, double-tap zoom, long-press menus and
    // text selection on the game surface.
    var stop = function (e) { if (e.cancelable) e.preventDefault(); };
    frame.addEventListener('touchstart', function (e) {
      if (!isInteractive(e.target) && e.cancelable) e.preventDefault();
    }, { passive: false });
    frame.addEventListener('touchmove', stop, { passive: false });
    frame.addEventListener('contextmenu', stop);
    frame.addEventListener('dblclick', stop);
    frame.addEventListener('selectstart', stop);
    document.addEventListener('gesturestart', stop, { passive: false }); // iOS Safari pinch
  }

  ns.Input = { attach: attach };
})(globalThis.Flapling = globalThis.Flapling || {});
