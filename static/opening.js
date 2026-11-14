/* The opening: Matrix code bursting out of the middle of the screen, paced by the intro track.
 *
 * Glyphs (the same characters as the code rain) fly outward in perspective from the exact spot
 * where the cursor was. How fast they fly, how many there are and how bright they glow all
 * follow how loud the track is (the numbers in INTRO_ENVELOPE, made by tools/make_envelope.py):
 * almost nothing in the quiet opening second, an explosion on each hit, a steady stream while the
 * track plays, and a huge climax. The bass makes the middle glow, the treble makes the glyphs
 * flicker. At the climax a ring of light opens from the middle and reveals the page.
 *
 * The opening plays only parts of the track (INTRO_ENVELOPE.segments, with the quiet stretches cut
 * out to shorten the wait), so the animation works in "track time": the position in the full track
 * after the 13-second start. The click's clock is mapped to track time through the same cuts as the
 * sound. Clicking again while it plays skips it.
 */
(function (root) {
  'use strict';

  var O = {};
  var END = 10.85;         // (track time) the last sound is at about 10.6 s; the page is clear by 10.85 s
  var HOLE_START = 9.3;    // the ring of light starts to open (the climax rises from about 9.9 s)
  var HOLE_END = 10.6;     // ...and has uncovered the whole page when the sound cuts off
  var MAX = 700;           // most glyph streaks alive at once (fewer keeps the burst clean)
  var CELL = 96;           // size of one glyph in the sprite sheet

  // The same characters as the code rain in matrix.js.
  var GLYPHS = Array.from('ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789:.=*+-<>|');

  function mulberry32(seed) {                // a small seeded random generator, so a run can be repeated exactly
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(a, b) {
    var h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function smoothstep(a, b, x) {
    var t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  // Read a curve (values 0 to 100, `rate` per second) at time t, as 0 to 1.
  function sample(curve, rate, t) {
    var x = t * rate, i = Math.floor(x);
    if (i < 0) return curve[0] / 100;
    if (i >= curve.length - 1) return curve[curve.length - 1] / 100;
    var f = x - i;
    return (curve[i] * (1 - f) + curve[i + 1] * f) / 100;
  }

  // The parts of the track that are played, one after another. toSource(t) turns time since the click
  // into the matching position in the track; total is how long the opening lasts.
  function makeTimeline(segments) {
    var starts = [], total = 0;
    segments.forEach(function (segment) { starts.push(total); total += segment[1] - segment[0]; });
    return {
      total: total,
      toSource: function (t) {
        for (var i = segments.length - 1; i >= 0; i--) {
          if (t >= starts[i]) return segments[i][0] + Math.min(t - starts[i], segments[i][1] - segments[i][0]);
        }
        return segments[0][0];
      }
    };
  }

  // Every glyph twice in one sheet: bright green on the first row, white (for the leading glyph) on the second.
  function makeSprites() {
    var canvas = document.createElement('canvas');
    canvas.width = CELL * GLYPHS.length;
    canvas.height = CELL * 2;
    var ctx = canvas.getContext('2d');
    ctx.font = '600 76px "Courier New", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    [['#46ff78', '#00ff41'], ['#f0fff4', '#8dffae']].forEach(function (colors, row) {
      ctx.fillStyle = colors[0];
      ctx.shadowColor = colors[1];
      ctx.shadowBlur = 14;
      GLYPHS.forEach(function (g, i) { ctx.fillText(g, i * CELL + CELL / 2, row * CELL + CELL / 2 + 4); });
    });
    return canvas;
  }

  /* ---------- the burst ---------- */

  function Burst(canvas, envelope, timeline) {
    this.canvas = canvas;
    this.timeline = timeline || makeTimeline(envelope.segments || [[0, envelope.e.length / envelope.rate]]);
    this.elapsed = 0;                      // seconds since the click
    this.ctx = canvas.getContext('2d');
    this.env = envelope;
    this.sprites = makeSprites();
    this.rand = mulberry32(20260314);
    this.cos = new Float32Array(MAX);
    this.sin = new Float32Array(MAX);
    this.rho = new Float32Array(MAX);      // sideways distance from the middle, before perspective
    this.z = new Float32Array(MAX);        // distance away: 1 is far (near the middle), 0 is at the screen
    this.pace = new Float32Array(MAX);     // each streak's own speed factor
    this.id = new Int32Array(MAX);
    this.alive = new Uint8Array(MAX);
    this.cursor = 0;
    this.time = 0;
    this.level = 0;                        // overall loudness, 0 to 1, with a quick attack and a slow release
    this.bass = 0;
    this.treble = 0;
    this.kick = 0;                         // extra speed after a hit, fading away
    this.carry = 0;
    this.nextOnset = 0;
    this.quality = 1;                      // lowered if the computer cannot keep up
    this.count = 0;
    this.resize(canvas.width, canvas.height);
  }

  Burst.prototype.resize = function (width, height) {
    this.W = width;
    this.H = height;
    this.cx = width / 2;
    this.cy = height / 2;
    this.unit = Math.min(width, height);
    this.focal = 0.30 * this.unit;
    this.reach = Math.hypot(width, height) / 2 * 1.12;
  };

  Burst.prototype.spawn = function (n, zMin, zMax) {
    for (var made = 0, tries = 0; made < n && tries < MAX; tries++) {
      var i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      if (this.alive[i]) continue;
      var angle = this.rand() * 6.2832;
      this.cos[i] = Math.cos(angle);
      this.sin[i] = Math.sin(angle);
      this.rho[i] = 0.05 + 0.95 * Math.sqrt(this.rand());
      this.z[i] = zMin + (zMax - zMin) * this.rand();
      this.pace[i] = 0.7 + 0.6 * this.rand();
      this.id[i] = (this.rand() * 1e9) | 0;
      this.alive[i] = 1;
      made++;
    }
  };

  // Move everything forward by dt seconds; t is the time in the track.
  Burst.prototype.step = function (dt, t) {
    var env = this.env, rate = env.rate;
    function follow(now, target, release) { return target > now ? target : now + (target - now) * (1 - Math.exp(-dt / release)); }
    this.level = follow(this.level, sample(env.e, rate, t), 0.16);
    this.bass = follow(this.bass, sample(env.l, rate, t), 0.2);
    this.treble = follow(this.treble, sample(env.h, rate, t), 0.1);
    this.kick *= Math.exp(-dt / 0.45);

    // each hit in the track is an explosion from the middle
    while (this.nextOnset < env.onsets.length && env.onsets[this.nextOnset][0] <= t) {
      var strength = env.onsets[this.nextOnset][1];
      this.kick += 1.3 * strength;
      this.spawn(Math.floor((110 + 340 * strength) * this.quality), 0.55, 1.0);
      this.nextOnset++;
    }
    // between hits, a stream whose thickness follows the loudness
    this.carry += (6 + 520 * Math.pow(this.level, 1.7)) * dt * this.quality;
    var n = Math.floor(this.carry);
    this.carry -= n;
    this.spawn(n, 0.82, 1.0);

    var speed = (0.028 + 0.62 * Math.pow(this.level, 0.95) + 0.5 * this.kick) * dt;
    var alive = 0;
    for (var i = 0; i < MAX; i++) {
      if (!this.alive[i]) continue;
      this.z[i] -= speed * this.pace[i];
      if (this.z[i] < 0.10) { this.alive[i] = 0; continue; }
      alive++;
    }
    this.count = alive;
    this.time = t;
  };

  // Run the simulation from the click up to `elapsed` seconds in small steps (used by the tests).
  Burst.prototype.advanceTo = function (elapsed) {
    while (this.elapsed < elapsed - 1e-6) {
      var next = Math.min(elapsed, this.elapsed + 1 / 60);
      var dt = next - this.elapsed;
      this.elapsed = next;
      this.step(dt, this.timeline.toSource(next));
    }
  };

  Burst.prototype.draw = function () {
    var ctx = this.ctx, W = this.W, H = this.H, cx = this.cx, cy = this.cy, t = this.time;

    // the black cover, with a ring of light opening from the middle to reveal the page
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    var open = smoothstep(HOLE_START, HOLE_END, t);
    var hole = this.reach * Math.pow(open, 1.5);
    if (hole > 1) {
      ctx.globalCompositeOperation = 'destination-out';
      var cut = ctx.createRadialGradient(cx, cy, hole * 0.72, cx, cy, hole);
      cut.addColorStop(0, 'rgba(0,0,0,1)');
      cut.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = cut;
      ctx.fillRect(0, 0, W, H);
    }

    // the cursor, for the first moment, so the burst seems to come out of it
    ctx.globalCompositeOperation = 'source-over';
    if (t < 0.4) {
      ctx.globalAlpha = 1 - t / 0.4;
      ctx.fillStyle = '#00ff41';
      ctx.shadowColor = '#00ff41';
      ctx.shadowBlur = 24;
      var cw = this.unit * 0.034, ch = this.unit * 0.06;
      ctx.fillRect(cx - cw / 2, cy - ch / 2, cw, ch);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    ctx.globalCompositeOperation = 'lighter';

    // the glow in the middle pumps with the bass
    var glowRadius = this.unit * (0.10 + 0.55 * this.level + 0.25 * this.bass);
    var glowPower = Math.min(0.6, 0.08 + 0.9 * this.bass + 0.35 * this.level) * (1 - smoothstep(10.2, 10.9, t) * 0.8);
    var glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
    glow.addColorStop(0, 'rgba(120,255,160,' + (0.5 * glowPower).toFixed(3) + ')');
    glow.addColorStop(0.4, 'rgba(40,255,100,' + (0.2 * glowPower).toFixed(3) + ')');
    glow.addColorStop(1, 'rgba(0,255,65,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - glowRadius, cy - glowRadius, glowRadius * 2, glowRadius * 2);

    // the bright edge of the opening ring
    if (hole > 1 && open < 1) {
      var ring = ctx.createRadialGradient(cx, cy, hole * 0.86, cx, cy, hole * 1.06);
      ring.addColorStop(0, 'rgba(0,255,65,0)');
      ring.addColorStop(0.62, 'rgba(190,255,215,0.55)');
      ring.addColorStop(1, 'rgba(0,255,65,0)');
      ctx.fillStyle = ring;
      ctx.fillRect(0, 0, W, H);
    }

    // the glyph streaks
    var fade = 1 - smoothstep(10.2, 10.7, t);
    var brightness = (0.3 + 0.55 * Math.min(1, this.level * 1.6 + 0.15)) * fade;
    var flicker = Math.floor(t * (6 + 14 * this.treble));
    var unit = this.unit, focal = this.focal, glyphs = GLYPHS.length, sprites = this.sprites;
    for (var i = 0; i < MAX; i++) {
      if (!this.alive[i]) continue;
      var z = this.z[i];
      var r = this.rho[i] * focal / z;
      var x = cx + this.cos[i] * r, y = cy + this.sin[i] * r;
      var size = Math.min(unit * 0.016 / z, unit * 0.11);
      if (x < -size * 3 || x > W + size * 3 || y < -size * 3 || y > H + size * 3) { this.alive[i] = 0; continue; }
      var a = brightness * (1 - smoothstep(0.8, 1.0, z)) * smoothstep(0.10, 0.22, z);
      if (a < 0.02) continue;
      var tail = size < 12 ? 1 : size < 26 ? 3 : 5;
      tail = Math.max(1, Math.round(tail * this.quality));
      var id = this.id[i];
      for (var j = tail - 1; j >= 0; j--) {          // the tail first, so the head is drawn on top
        var rr = r - j * size * 0.95;
        if (rr < 0) continue;
        var gx = cx + this.cos[i] * rr, gy = cy + this.sin[i] * rr;
        ctx.globalAlpha = a * (j === 0 ? 1 : Math.pow(1 - j / (tail + 1), 1.4));
        ctx.drawImage(sprites, (hash(id + j * 7919, flicker + (id & 15)) % glyphs) * CELL, j === 0 ? CELL : 0, CELL, CELL,
                      gx - size / 2, gy - size / 2, size, size);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  /* ---------- playing it in the page ---------- */

  // Put the opening inside `host`. Returns a controller.
  O.create = function (host, options) {
    var onDone = (options && options.onDone) || function () {};
    var envelope = root.INTRO_ENVELOPE;
    if (!envelope) throw new Error('the loudness curve is missing');
    var canvas = document.createElement('canvas');
    canvas.className = 'opening';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    var scale = Math.min(window.devicePixelRatio || 1, 1.5);
    function fit() {
      var w = host.clientWidth || window.innerWidth, h = host.clientHeight || window.innerHeight;
      canvas.width = Math.max(2, Math.round(w * scale));
      canvas.height = Math.max(2, Math.round(h * scale));
      burst.resize(canvas.width, canvas.height);
    }
    var timeline = makeTimeline(envelope.segments || [[0, envelope.e.length / envelope.rate]]);
    var burst = new Burst(canvas, envelope, timeline);
    fit();
    burst.draw();                           // the first frame is ready before the click's sound begins
    var onResize = function () { fit(); };
    window.addEventListener('resize', onResize);

    var clock = null, raf = 0, done = false, skipping = false, fading = false;
    var started = 0, lastT = 0, lastNow = 0, slow = 0;

    function finish() {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      canvas.remove();
      onDone();
    }
    function fadeOut(seconds) {
      if (fading) return;
      fading = true;
      canvas.style.transition = 'opacity ' + seconds + 's ease';
      canvas.style.opacity = '0';
    }
    function frame(now) {
      if (done) return;
      raf = requestAnimationFrame(frame);
      var elapsed = clock();                       // seconds since the click
      var t = timeline.toSource(elapsed);          // the matching moment in the track
      if (!skipping) {
        var dt = Math.min(0.05, Math.max(0, elapsed - lastT));
        burst.step(dt, Math.max(t, burst.time));
        burst.draw();
        // if the computer is struggling, draw fewer glyphs
        if (lastNow && now - lastNow > 26) slow++; else slow = Math.max(0, slow - 1);
        if (slow > 25 && burst.quality > 0.35) { burst.quality *= 0.8; slow = 0; }
        lastNow = now;
      }
      lastT = elapsed;
      if (t >= END) finish();
    }

    return {
      canvas: canvas,
      // audioClock() gives seconds since the track began; pass null to use the wall clock.
      start: function (audioClock) {
        if (started) return;
        started = performance.now();
        clock = audioClock || function () { return (performance.now() - started) / 1000; };
        raf = requestAnimationFrame(frame);
      },
      skip: function () {
        if (skipping || done) return;
        skipping = true;
        fadeOut(0.45);
        setTimeout(finish, 520);
      },
      active: function () { return !done; }
    };
  };

  O.Burst = Burst;      // exposed so single frames can be drawn in tests
  O.timeline = makeTimeline;
  O.END = END;
  root.Opening = O;
})(window);
