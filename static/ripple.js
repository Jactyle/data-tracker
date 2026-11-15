/* Click ripples: a quick burst of falling-code glyphs from wherever you click or tap.
 *
 *   ripple    a ring of glyphs flies outward from the click, with a thin ring of light
 *   star-on   starring a film: three columns of code fall from the star
 *   star-off  un-starring: a few glyphs are drawn back in toward the star
 *
 * One transparent canvas covers the window and never takes a click. It is made on the first burst, only
 * draws while there is something to draw, and does nothing with "reduce motion" on, in a hidden tab, or
 * after `ripples off` in the command bar (the choice is remembered).
 *
 * The functions at the top (spawn, step, fade, cap) are plain logic with no page needed, so they can be
 * tested on their own; the part below them draws and listens for clicks.
 */
(function (root) {
  'use strict';

  var R = {};
  var KEY = 'movie-tracker.ripples';
  var GLYPHS = Array.from('ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789');
  R.MAX = 160;                // most glyphs alive at once, so quick clicking can never pile up

  /* ---------- plain logic ---------- */

  // The glyphs (and ring) a click makes. rand() gives numbers from 0 up to 1 (Math.random, or a seeded one in tests).
  // Each has a place (x, y), a velocity (vx, vy in pixels per second), how long it lives (ttl), its age, and a
  // delay before it appears.
  R.spawn = function (kind, x, y, rand) {
    var out = [], i;
    function glyph(extra) {
      out.push(Object.assign({ kind: 'glyph', x: x, y: y, vx: 0, vy: 0, age: 0, delay: 0, ttl: 0.6, size: 15, alpha: 1, drag: 2.2, seed: Math.floor(rand() * 1e6) }, extra));
    }
    if (kind === 'star-on') {
      for (var column = -1; column <= 1; column++) {
        for (i = 0; i < 6; i++) {
          glyph({ x: x + column * 15 + (rand() - 0.5) * 4, y: y - 6, vx: 0, vy: 230 + rand() * 120, delay: i * 0.055 + rand() * 0.03,
                  ttl: 0.55 + rand() * 0.2, size: 14 + rand() * 3, drag: 0.4 });
        }
      }
      out.push({ kind: 'ring', x: x, y: y, r: 4, grow: 120, age: 0, delay: 0, ttl: 0.45, alpha: 0.9 });
    } else if (kind === 'star-off') {
      for (i = 0; i < 8; i++) {
        var angle = i / 8 * 6.2832 + rand() * 0.4, near = 34 + rand() * 12, speed = 120 + rand() * 40;
        glyph({ x: x + Math.cos(angle) * near, y: y + Math.sin(angle) * near, vx: -Math.cos(angle) * speed, vy: -Math.sin(angle) * speed,
                ttl: 0.3, size: 13, alpha: 0.7, drag: 0 });
      }
    } else {
      var count = 14;
      for (i = 0; i < count; i++) {
        var a = i / count * 6.2832 + (rand() - 0.5) * 0.35, v = 90 + rand() * 80;
        glyph({ vx: Math.cos(a) * v, vy: Math.sin(a) * v, ttl: 0.5 + rand() * 0.25, size: 13 + rand() * 4 });
      }
      out.push({ kind: 'ring', x: x, y: y, r: 3, grow: 150, age: 0, delay: 0, ttl: 0.5, alpha: 0.8 });
    }
    return out;
  };

  // Move everything on by dt seconds; returns the ones still alive (a new list).
  R.step = function (list, dt) {
    var alive = [];
    list.forEach(function (p) {
      if (p.delay > 0) { p.delay -= dt; alive.push(p); return; }
      p.age += dt;
      if (p.age >= p.ttl) return;
      if (p.kind === 'ring') p.r += p.grow * dt;
      else {
        var slow = Math.exp(-(p.drag || 0) * dt);
        p.vx *= slow; p.vy *= slow;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
      alive.push(p);
    });
    return alive;
  };

  // How see-through a particle is: full at the start, gone at the end (0 while it is still waiting to appear).
  R.fade = function (p) {
    if (p.delay > 0) return 0;
    return p.alpha * Math.pow(Math.max(0, 1 - p.age / p.ttl), 1.3);
  };

  // Keep at most `max` particles (the oldest are dropped first).
  R.cap = function (list, max) { return list.length > max ? list.slice(list.length - max) : list; };

  R.glyphAt = function (p) { return GLYPHS[(p.seed + Math.floor(p.age * 14)) % GLYPHS.length]; };   // a new glyph about every 70 ms

  /* ---------- the picture and the listener ---------- */

  var enabled = true, canvas = null, ctx = null, particles = [], raf = 0, last = 0, lastBurst = 0, attached = false, dpr = 1;
  try { enabled = localStorage.getItem(KEY) !== 'off'; } catch (e) { /* stays on */ }

  function reducedMotion() {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function fit() {
    dpr = Math.min(root.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(root.innerWidth * dpr);
    canvas.height = Math.round(root.innerHeight * dpr);
  }
  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'ripples';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    fit();
    root.addEventListener('resize', function () { if (canvas) fit(); });
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, root.innerWidth, root.innerHeight);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    particles.forEach(function (p) {
      var a = R.fade(p);
      if (a <= 0.01) return;
      ctx.globalAlpha = a;
      if (p.kind === 'ring') {
        ctx.strokeStyle = '#7dffa0';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.2832);
        ctx.stroke();
        return;
      }
      var head = p.age < p.ttl * 0.22;                     // the newest glyphs are nearly white, then they turn green
      ctx.fillStyle = head ? '#eafff0' : '#00ff41';
      ctx.shadowColor = '#00ff41';
      ctx.shadowBlur = head ? 10 : 4;
      ctx.font = '600 ' + Math.round(p.size) + 'px "Courier New", ui-monospace, monospace';
      ctx.fillText(R.glyphAt(p), p.x, p.y);
    });
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    raf = 0;
    var dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    particles = R.step(particles, dt);
    if (particles.length) {
      draw();
      raf = requestAnimationFrame(frame);
    } else if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  R.burst = function (kind, x, y) {
    if (!enabled || reducedMotion() || document.hidden) return;
    ensureCanvas();
    particles = R.cap(particles.concat(R.spawn(kind, x, y, Math.random)), R.MAX);
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  };

  R.enabled = function () { return enabled; };
  R.setEnabled = function (on) {
    enabled = !!on;
    try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch (e) { /* kept for this visit */ }
    if (!enabled) { particles = []; if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); } }
    return enabled;
  };

  // Where a click happened: its own spot, or the middle of the control when it came from the keyboard.
  function pointOf(e, control) {
    if (e.detail === 0 && !e.clientX && !e.clientY && control) {
      var box = control.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }
    return { x: e.clientX, y: e.clientY };
  }

  var TARGETS = 'a[href], button, summary, select, label, input[type="checkbox"], input[type="range"], tbody tr, .tile, canvas.cloud-canvas';

  R.attach = function () {
    if (attached) return;
    attached = true;
    // Capture phase, so a star still shows its old state when we look at it (as in sound.js).
    document.addEventListener('click', function (event) {
      if (!enabled) return;
      var target = event.target;
      if (!target || !target.closest || target.closest('#matrix-intro, #cmdbar, #ripples')) return;
      var control = target.closest(TARGETS);
      if (!control) return;
      var now = Date.now();
      if (now - lastBurst < 90) return;                    // a label and its checkbox both report a click
      lastBurst = now;
      var at = pointOf(event, control), kind = 'ripple';
      if (control.classList.contains('star') || control.classList.contains('cloud-star')) kind = control.getAttribute('aria-pressed') !== 'true' ? 'star-on' : 'star-off';
      R.burst(kind, at.x, at.y);
    }, true);
  };

  root.Ripple = R;
  if (typeof module !== 'undefined' && module.exports) module.exports = R;
})(typeof window !== 'undefined' ? window : globalThis);
