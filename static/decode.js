/* The "decoding" effect: text shows as falling-code glyphs and resolves into the real words, left
 * to right, like the code in the film turning into a picture.
 *
 * The real text never leaves the page. While an element decodes, the glyphs are painted by a CSS
 * overlay (see .decoding in site.css) and the actual text is only made see-through, so screen
 * readers, copy and paste, and anything that reads the page always get the true words and numbers.
 * Nothing happens if "reduce motion" is on.
 */
(function (root) {
  'use strict';

  var D = {};
  // Half-width katakana and digits, the same characters as the code rain; they are as wide as letters.
  var GLYPHS = Array.from('ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789');

  // A steady pseudo-random number from 0 up to (not including) 1 for each position, so every
  // character has its own moment to resolve.
  function jitter(i) {
    var x = Math.sin(i * 12.9898 + 4.1414) * 43758.5453;
    return x - Math.floor(x);
  }

  // The text as it looks when `progress` (0 to 1) of the decoding is done. Spaces and line breaks
  // stay as they are, resolved characters are the real ones, the rest are random glyphs.
  // progress 1 always gives back the text unchanged.
  D.frame = function (text, progress, random) {
    var pick = random || Math.random, n = text.length, out = '';
    for (var i = 0; i < n; i++) {
      var ch = text.charAt(i);
      if (ch === ' ' || ch === '\n' || ch === '\t') { out += ch; continue; }
      var resolvesAt = (i / Math.max(1, n - 1)) * 0.75 + 0.25 * jitter(i);
      out += progress >= resolvesAt ? ch : GLYPHS[Math.floor(pick() * GLYPHS.length)];
    }
    return out;
  };

  function reducedMotion() {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Decode one element's text. `quick` makes it short, for small things that change often.
  D.run = function (el, options) {
    if (!el || reducedMotion() || el.__decoding) return;
    var text = el.textContent;
    if (!text || !text.trim()) return;
    var duration = (options && options.quick) ? 320 : Math.min(1100, Math.max(420, 300 + text.length * 32));
    var begin = performance.now();
    el.__decoding = true;
    el.classList.add('decoding');
    function done() {
      el.classList.remove('decoding');
      el.removeAttribute('data-scramble');
      el.__decoding = false;
    }
    (function tick(now) {
      var progress = (now - begin) / duration;
      if (progress >= 1 || !el.isConnected) { done(); return; }
      el.setAttribute('data-scramble', D.frame(text, progress));
      requestAnimationFrame(tick);
    })(begin);
  };

  // Decode the headings, figures and chart titles inside `scope`, one after another. If the intro is
  // still on screen, wait until it has gone.
  D.start = function (scope) {
    function go() {
      var targets = scope.querySelectorAll('h1, h2, .tile .value, .chart-title');
      Array.prototype.slice.call(targets, 0, 60).forEach(function (el, i) {
        setTimeout(function () { D.run(el); }, Math.min(i * 45, 700));
      });
    }
    if (document.getElementById('matrix-intro')) root.addEventListener('matrix:intro-done', go, { once: true });
    else go();
  };

  root.Decode = D;
  if (typeof module !== 'undefined' && module.exports) module.exports = D;
})(typeof window !== 'undefined' ? window : globalThis);
