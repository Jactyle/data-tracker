/* The Matrix look: falling code behind every page, and an intro screen that
 * "opens" like the code in the film when you click it.
 *
 * Everything is drawn with one small column model (Rain): each column has a head
 * that falls and a fading trail of characters. In "loop" mode the heads fall for
 * ever. In "reveal" mode a fresh wave falls down every column and the black cover
 * is removed behind it, so the page appears as the code passes.
 *
 * With "reduce motion" turned on in the system settings nothing animates: the
 * intro is a plain text screen and a click simply opens the site.
 */
(function (root) {
  'use strict';

  var M = {};
  var SEEN_KEY = 'movie-tracker.intro-seen';
  var GLYPHS = Array.from('ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789:.=*+-<>|');

  // A small integer hash, so neighbouring cells get unrelated characters.
  function hash(a, b) {
    var h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function remember(value) {
    try { value ? sessionStorage.setItem(SEEN_KEY, '1') : sessionStorage.removeItem(SEEN_KEY); } catch (e) { /* fine */ }
  }
  function seen() {
    try { return sessionStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return false; }
  }

  /* ---------- the rain ---------- */

  function Rain(canvas, options) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = options.fontSize || 18;      // pixel size of one character cell
    this.trail = options.trail || 18;        // characters in a trail
    this.cover = !!options.cover;            // paint a black cover (the intro) or stay transparent
    this.silent = !!options.silent;          // while looping, draw no characters at all
    this.alpha = options.alpha == null ? 1 : options.alpha;
    this.interval = 1000 / (options.fps || 30);
    this.mode = 'loop';
    this.tick = 0;
    this.running = false;
    this.colors = [];
    for (var k = 0; k <= this.trail; k++) {
      var a = Math.pow(1 - k / this.trail, 1.6) * this.alpha;
      this.colors.push(k === 0 ? 'rgba(220,255,232,' + this.alpha + ')' : 'rgba(0,255,65,' + a.toFixed(3) + ')');
    }
    this.resize();
  }

  Rain.prototype.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
    this.cols = Math.ceil(w / this.size);
    this.rows = Math.ceil(h / this.size);
    this.heads = [];
    this.speeds = [];
    for (var c = 0; c < this.cols; c++) {
      this.heads.push(Math.random() * (this.rows + this.trail) - this.trail);
      this.speeds.push(0.25 + Math.random() * 0.55);   // rows per frame
    }
    this.draw();
  };

  Rain.prototype.step = function () {
    this.tick++;
    for (var c = 0; c < this.cols; c++) {
      this.heads[c] += this.speeds[c];
      if (this.mode === 'loop' && this.heads[c] - this.trail > this.rows && Math.random() > 0.96) {
        this.heads[c] = -Math.random() * 12;               // start a new drop at the top
        this.speeds[c] = 0.25 + Math.random() * 0.55;
      }
    }
    if (this.mode === 'reveal' && this.onDone) {
      var finished = true;
      for (var i = 0; i < this.cols; i++) {
        if ((this.heads[i] - this.trail) * this.size < this.h) { finished = false; break; }
      }
      if (finished) { var done = this.onDone; this.onDone = null; done(); }
    }
  };

  Rain.prototype.draw = function () {
    var ctx = this.ctx, size = this.size, h = this.h;
    ctx.clearRect(0, 0, this.w, h);
    if (this.cover) {
      ctx.fillStyle = '#000';
      if (this.mode === 'loop') {
        ctx.fillRect(0, 0, this.w, h);
      } else {
        // Behind each column's trail the page shows through; below it stays black.
        for (var c = 0; c < this.cols; c++) {
          var top = Math.max(0, (this.heads[c] - this.trail) * size);
          if (top < h) ctx.fillRect(c * size, top, size + 0.5, h - top);
        }
      }
    }
    if (this.silent && this.mode === 'loop') return;   // just the black cover
    ctx.font = size + 'px "Courier New", ui-monospace, monospace';
    ctx.textAlign = 'center';
    var slow = this.tick >> 3;
    for (var col = 0; col < this.cols; col++) {
      var head = Math.floor(this.heads[col]);
      for (var k = 0; k <= this.trail; k++) {
        var row = head - k;
        if (row < 0 || row > this.rows) continue;
        // The head flickers every frame; a third of the trail changes slowly.
        var shift = k === 0 ? this.tick * 7 : (row % 3 === 0 ? slow : 0);
        ctx.fillStyle = this.colors[k];
        ctx.fillText(GLYPHS[hash(col + shift * 4099, row) % GLYPHS.length], col * size + size / 2, row * size + size);
      }
    }
  };

  Rain.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    var self = this, last = 0;
    function frame(time) {
      if (!self.running) return;
      self.raf = requestAnimationFrame(frame);
      if (document.hidden || time - last < self.interval) return;
      last = time;
      self.step();
      self.draw();
    }
    this.raf = requestAnimationFrame(frame);
  };

  Rain.prototype.stop = function () {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
  };

  // A fresh, faster wave falls down every column; the cover is removed behind it.
  Rain.prototype.beginReveal = function (onDone) {
    this.mode = 'reveal';
    this.onDone = onDone;
    for (var c = 0; c < this.cols; c++) {
      this.heads[c] = -Math.random() * this.rows * 0.6;
      this.speeds[c] = 1.1 + Math.random() * 0.9;
    }
  };

  /* ---------- the page background ---------- */

  M.background = function () {
    if (reducedMotion() || document.getElementById('matrix-bg')) return null;
    var canvas = document.createElement('canvas');
    canvas.id = 'matrix-bg';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(canvas, document.body.firstChild);
    var rain = new Rain(canvas, { fontSize: 18, trail: 16, alpha: 0.3, fps: 24 });
    rain.start();
    var timer;
    window.addEventListener('resize', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { rain.resize(); }, 150);
    });
    return rain;
  };

  /* ---------- the intro screen ---------- */

  function inertParts(on) {
    Array.prototype.forEach.call(document.querySelectorAll('#nav, #app, .foot'), function (node) {
      if (on) node.setAttribute('inert', ''); else node.removeAttribute('inert');
    });
    document.body.classList.toggle('intro-open', on);
  }

  // The intro is a black screen with one blinking cursor. Clicking it (or pressing a key) starts the
  // intro track and a burst of code from the middle of the screen, paced by the track (opening.js),
  // which opens up to reveal the site. Clicking again skips it. If the track cannot be loaded or
  // "reduce motion" is on, a wave of falling code opens the site instead.
  M.intro = function () {
    if (document.getElementById('matrix-intro')) return;
    var motion = !reducedMotion();
    if (root.Sound) {
      root.Sound.preloadIntro();   // so the track is ready when the cursor is clicked
      root.Sound.hold(true);       // no background ambience while the intro plays
    }
    var overlay = document.createElement('div');
    overlay.id = 'matrix-intro';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Welcome');
    if (!motion) overlay.className = 'static';

    var canvas = null, rain = null;
    if (motion) {
      canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      overlay.appendChild(canvas);
    }

    // The cursor is a real button, so keyboard and screen-reader users can open the site too.
    var cursor = document.createElement('button');
    cursor.type = 'button';
    cursor.className = 'cursor';
    cursor.setAttribute('aria-label', 'Enter the site');
    overlay.appendChild(cursor);
    document.body.appendChild(overlay);
    inertParts(true);

    if (motion) {
      rain = new Rain(canvas, { fontSize: 18, trail: 22, cover: true, silent: true, alpha: 1, fps: 30 });
      rain.start();
    }

    var entering = false, scene = null, finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      if (rain) rain.stop();
      overlay.remove();
      inertParts(false);
      window.scrollTo(0, 0);
      if (root.Sound) root.Sound.hold(false);     // the ambience fades in under the site
      root.dispatchEvent(new Event('matrix:intro-done'));   // the page can start decoding its text
    }
    // The older opening: a wave of falling code removes the black cover. Used when the burst
    // cannot run (the track has not loaded, or "reduce motion" is on).
    function waterfall() {
      if (root.Sound) root.Sound.play(motion ? 'enter' : 'click', null, true);   // this click lets the audio start
      if (rain) rain.beginReveal(finish); else finish();
    }
    // The burst of code, paced by the intro track.
    function playBurst() {
      try {
        scene = root.Opening.create(overlay, { onDone: function () { scene = null; finish(); } });
      } catch (e) {
        scene = null;
        waterfall();
        return;
      }
      if (rain) { rain.stop(); canvas.remove(); rain = null; }   // the burst paints its own black cover
      if (root.Sound) root.Sound.playIntro(function (clock) { if (scene) scene.start(clock); });
      else scene.start(null);
    }
    function burstWanted() {
      return motion && root.Opening && root.INTRO_ENVELOPE &&
             (!root.Sound || !root.Sound.enabled() || root.Sound.hasIntro());
    }

    function open() {
      if (entering) {                      // clicking again while it plays skips it
        if (scene) { if (root.Sound) root.Sound.stop(); scene.skip(); }
        return;
      }
      entering = true;
      remember(true);
      overlay.classList.add('entering');
      if (burstWanted()) playBurst(); else waterfall();
    }
    overlay.addEventListener('click', open);
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') { e.preventDefault(); cursor.focus(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || /^(Shift|Control|Alt|Meta|CapsLock|Fn)$/.test(e.key)) return;   // browser shortcuts and modifier keys
      open();
    });
    cursor.focus();
    if (rain) {
      var resizeTimer;
      window.addEventListener('resize', function () {
        if (entering) return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () { rain.resize(); }, 150);
      });
    }
  };

  M.replayIntro = function () {
    if (root.Sound) root.Sound.stop();
    remember(false);
    M.intro();
  };

  // Called once by every page: the background rain, and the intro the first time in a session.
  M.init = function () {
    M.background();
    var forced = /[?&]intro\b/.test(location.search);
    if (forced || !seen()) M.intro();
    else if (root.Sound) setTimeout(root.Sound.preloadIntro, 1500);   // ready in case the intro is replayed
  };

  M.Rain = Rain;   // exposed so the animation can be stepped by hand in tests

  root.Matrix = M;
})(window);
