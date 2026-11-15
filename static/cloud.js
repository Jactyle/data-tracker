/* The film cloud: the films of one source floating in a 3D box, drawn on a canvas with plain code.
 *
 * Each film is a glowing glyph. Where it floats comes from three numbers taken from the history file:
 *   IMDb       rating, votes (log scale), votes added per day
 *   Wikipedia  7-day views (log), daily views compared with the 7-day average, change in daily views since the first day
 * Drag to turn the box, click a film to pick it, or use the keyboard (arrows turn it, [ and ] step
 * through the films, the comma and full-stop keys step through the days). It turns slowly by itself when nobody is touching it.
 * A slider under the cloud travels back through the days: the films glide to where they were, and "Trails"
 * draws the path each film has taken. Everything is also in the table under the cloud, and with "reduce
 * motion" on nothing moves by itself.
 *
 * The functions at the top (build, project, nearest, step) are plain maths with no page needed, so they can
 * be tested on their own; the part below them draws the cloud and handles the mouse and keys.
 */
(function (root) {
  'use strict';

  var C = {};
  var GLYPHS = Array.from('ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ');
  var SPREAD = 0.9;          // films fill the box from -0.9 to +0.9 (the box itself is -1 to +1)
  var CAMERA = 4.4;          // how far the viewer is from the middle of the box
  var START_VIEW = { yaw: 0.62, pitch: 0.3 };
  var MAX_PITCH = 1.35;

  /* ---------- plain maths ---------- */

  // The three axes of each source. `from` says where a number comes from: the film's row in history.csv,
  // or a figure worked out from the whole history (growth, change).
  C.SPECS = {
    imdb: [
      { key: 'rating', short: 'rating', label: 'Rating', from: 'row', scale: 'linear' },
      { key: 'votes', short: 'votes', label: 'Votes (log scale)', from: 'row', scale: 'log' },
      { key: 'growth', short: 'votes/day', label: 'Votes added per day', from: 'extra', scale: 'linear' }
    ],
    wikipedia: [
      { key: 'views_7d', short: '7-day views', label: '7-day views (log scale)', from: 'row', scale: 'log' },
      { key: 'spike', short: 'vs 7-day avg', label: 'Daily views compared with the 7-day average (1.0 is typical)', from: 'extra', scale: 'linear' },
      { key: 'change', short: 'change %', label: 'Change in daily views since the first day (%)', from: 'extra', scale: 'linear' }
    ]
  };

  function finite(v) { return typeof v === 'number' && isFinite(v); }
  // A number as it is placed on its axis: logarithms squeeze the huge range of votes and views.
  function transformed(axis, v) { return axis.scale === 'log' ? Math.log10(Math.max(v, 1)) : v; }

  function valueOn(axis, row, extras) {
    var v = axis.from === 'row' ? row[axis.key] : (extras && extras[axis.key] ? extras[axis.key][row.item_id] : null);
    return finite(v) ? v : null;
  }

  // Place the films of one source. rows: the latest row of each film; extras: {growth: {item_id: n}, change: {item_id: n}}.
  // Returns the axes (with the range each one covers), the points (raw values and a position in the box), and the
  // films left out because the first two numbers are missing. A missing third number puts a film in the middle
  // of that axis and marks it.
  C.build = function (source, rows, extras, spacing, ranges) {
    var axes = (C.SPECS[source] || []).map(function (a) { return Object.assign({ lo: null, hi: null }, a); });
    var points = [], skipped = [];
    if (axes.length !== 3) return { source: source, axes: axes, points: points, skipped: skipped, thirdKnown: 0 };
    (rows || []).forEach(function (row) {
      var values = axes.map(function (axis) { return valueOn(axis, row, extras); });
      if (values[0] === null || values[1] === null) { skipped.push({ id: row.item_id, name: row.item }); return; }
      points.push({ id: row.item_id, name: row.item, values: values, pos: [0, 0, 0], thirdKnown: values[2] !== null });
    });
    axes.forEach(function (axis, k) {
      points.forEach(function (p) {
        if (p.values[k] === null) return;
        var t = transformed(axis, p.values[k]);
        axis.lo = axis.lo === null ? t : Math.min(axis.lo, t);
        axis.hi = axis.hi === null ? t : Math.max(axis.hi, t);
      });
    });
    if (ranges) {                        // a time-lapse keeps the same range on every day, so the films really move
      axes.forEach(function (axis, k) { if (ranges[k] && ranges[k].lo !== null) { axis.lo = ranges[k].lo; axis.hi = ranges[k].hi; } });
    }
    points.forEach(function (p) {
      axes.forEach(function (axis, k) {
        if (p.values[k] === null || axis.lo === null || axis.hi <= axis.lo) { p.pos[k] = 0; return; }
        var t = (transformed(axis, p.values[k]) - axis.lo) / (axis.hi - axis.lo);
        p.pos[k] = (t * 2 - 1) * SPREAD;
      });
    });
    if (spacing === 'rank') {            // spread the films evenly along each axis: only their order counts, so one extreme value cannot squeeze the rest
      axes.forEach(function (axis, k) {
        var known = points.filter(function (p) { return p.values[k] !== null; });
        known.sort(function (a, b) { return a.values[k] - b.values[k]; });
        var i = 0;
        while (i < known.length) {
          var j = i;
          while (j + 1 < known.length && known[j + 1].values[k] === known[i].values[k]) j++;      // films with equal values share their places
          var place = (i + j) / 2;
          for (var n = i; n <= j; n++) known[n].pos[k] = known.length > 1 ? (place / (known.length - 1) * 2 - 1) * SPREAD : 0;
          i = j + 1;
        }
      });
    }
    points.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1; });
    return { source: source, spacing: spacing === 'rank' ? 'rank' : 'true', axes: axes, points: points, skipped: skipped,
             thirdKnown: points.filter(function (p) { return p.thirdKnown; }).length };
  };

  // The cloud on every day the source has data: each day uses only the history up to that day, and every
  // axis keeps one range over all the days. paths: for each film, where it was on each day it was present.
  C.timeline = function (source, data, spacing) {
    var T = root.Tracker, byDay = data.analysis.bySource[source] || {}, days = Object.keys(byDay).sort();
    var sets = days.map(function (date) {
      var rows = Object.keys(byDay[date]).map(function (id) { return byDay[date][id]; });
      var upTo = data.rows.filter(function (r) { return r.date <= date; });
      var extras = { growth: {}, change: {}, spike: {} };
      rows.forEach(function (r) { if (source === 'wikipedia' && r.views > 0 && r.views_7d > 0) extras.spike[r.item_id] = r.views / (r.views_7d / 7); });
      T.voteGrowth(upTo).forEach(function (r) { extras.growth[r.item_id] = r.perDay; });
      T.risers(upTo).forEach(function (r) { if (r.source === 'wikipedia') extras.change[r.item_id] = r.percent; });
      return { date: date, rows: rows, extras: extras };
    });
    var plain = sets.map(function (s) { return C.build(source, s.rows, s.extras, 'true'); });
    var ranges = [0, 1, 2].map(function (k) {
      var lo = null, hi = null;
      plain.forEach(function (m) {
        var a = m.axes[k];
        if (a && a.lo !== null) { lo = lo === null ? a.lo : Math.min(lo, a.lo); hi = hi === null ? a.hi : Math.max(hi, a.hi); }
      });
      return { lo: lo, hi: hi };
    });
    var models = sets.map(function (s) { return C.build(source, s.rows, s.extras, spacing, ranges); });
    var paths = {};
    models.forEach(function (m, day) {
      m.points.forEach(function (p) { (paths[p.id] = paths[p.id] || []).push({ day: day, pos: p.pos.slice() }); });
    });
    return { source: source, dates: days, models: models, ranges: ranges, paths: paths };
  };

  // Glide: move `current` toward `target`, covering most of the way in about `tau` seconds.
  C.ease = function (current, target, dt, tau) { return target + (current - target) * Math.exp(-dt / tau); };

  // Turn a position in the box into a spot on the screen. view: {yaw, pitch} in radians; size: {w, h} in pixels.
  // s is how much bigger things look the closer they are; depth is larger for points nearer the viewer.
  C.project = function (pos, view, size) {
    var cosY = Math.cos(view.yaw), sinY = Math.sin(view.yaw), cosP = Math.cos(view.pitch), sinP = Math.sin(view.pitch);
    var x1 = pos[0] * cosY - pos[2] * sinY, z1 = pos[0] * sinY + pos[2] * cosY;
    var y2 = pos[1] * cosP - z1 * sinP, z2 = pos[1] * sinP + z1 * cosP;
    var s = 1 / (CAMERA - z2), unit = Math.min(size.w, size.h) * 1.1;
    return { x: size.w / 2 + x1 * s * unit, y: size.h / 2 - y2 * s * unit, s: s, depth: z2 };
  };

  // The projected point under (px, py), or -1. list: [{x, y, r}], r is how far from the middle still counts.
  C.nearest = function (list, px, py, reach) {
    var best = -1, bestDistance = Infinity;
    list.forEach(function (p, i) {
      var d = Math.hypot(p.x - px, p.y - py);
      if (d <= Math.max(reach, p.r || 0) && d < bestDistance) { best = i; bestDistance = d; }
    });
    return best;
  };

  // Move the picked film along by `direction` (1 or -1), wrapping round; with nothing picked it starts at one end.
  C.step = function (count, current, direction) {
    if (count <= 0) return -1;
    if (current < 0) return direction > 0 ? 0 : count - 1;
    return (current + direction + count) % count;
  };

  // Where a note about a glyph goes: to its right if there is room, else to its left, else squeezed in and moved below it.
  C.placeTip = function (x, width, wide, gap) {
    if (x + gap + wide <= width - 4) return { left: x + gap, below: false };
    if (x - gap - wide >= 4) return { left: x - gap - wide, below: false };
    return { left: Math.max(4, Math.min(x - wide / 2, width - wide - 4)), below: true };
  };

  C.clampPitch = function (p) { return Math.max(-MAX_PITCH, Math.min(MAX_PITCH, p)); };

  /* ---------- the picture and the controls ---------- */

  function reducedMotion() {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function glyphFor(id) {
    var h = 2166136261;
    for (var i = 0; i < id.length; i++) { h = Math.imul(h ^ id.charCodeAt(i), 16777619); }
    return GLYPHS[(h >>> 0) % GLYPHS.length];
  }

  // Put the cloud inside `host` and keep it up to date. data: what Tracker.loadData() gave.
  C.mount = function (host, data) {
    var T = root.Tracker, el = T.el, Charts = root.Charts;
    var sources = data.analysis.sources.filter(function (s) { return C.SPECS[s]; });
    if (!sources.length) return;

    var tl = null, dayIndex = 0, display = {}, trails = true, playing = false, playTimer = 0, timelines = {};
    var model = null, view = { yaw: START_VIEW.yaw, pitch: START_VIEW.pitch };
    var selected = -1, hover = -1, dragging = false, over = false, focused = false, lastTouched = 0;
    var projected = [], visible = true, raf = 0, last = 0, dirty = true, loop = !reducedMotion();
    var size = { w: 600, h: 420 }, dpr = 1;

    /* the page parts */
    var picker = el('select', { 'aria-label': 'Source shown in the cloud' }, sources.map(function (s) {
      return el('option', { value: s, text: T.sourceLabel(s) });
    }));
    var spacing = el('select', { 'aria-label': 'Spacing of the films' }, [
      el('option', { value: 'true', text: 'True values' }), el('option', { value: 'rank', text: 'Even spacing (by rank)' })]);
    var reset = el('button', { type: 'button', text: 'Reset view' });
    var canvas = el('canvas', { class: 'cloud-canvas', tabindex: '0', role: 'img' });
    var tip = el('div', { class: 'cloud-tip', hidden: '' });
    var legend = el('p', { class: 'small muted' });
    var detail = el('p', { class: 'cloud-detail', role: 'status', 'aria-live': 'polite' });
    var starButton = el('button', { type: 'button', class: 'cloud-star', 'aria-pressed': 'false', hidden: '' });
    var browseButton = el('button', { type: 'button', hidden: '', text: 'Find in Browse' });
    var compareButton = el('button', { type: 'button', hidden: '', text: 'Compare…', title: 'Put this film in the comparison below' });
    var slider = el('input', { type: 'range', min: '0', max: '0', step: '1', value: '0', class: 'cloud-slider typesound', 'aria-label': 'Day shown in the cloud' });
    var dayLabel = el('output', { class: 'cloud-day', 'aria-hidden': 'true' });
    var play = el('button', { type: 'button', class: 'cloud-play', 'aria-pressed': 'false', text: '▶ Play' });
    var trailsBox = el('input', { type: 'checkbox' });
    trailsBox.checked = true;
    var scrub = el('div', { class: 'cloud-scrub' }, [play, slider, dayLabel, el('label', { class: 'check' }, [trailsBox, 'Trails'])]);
    var scrubNote = el('p', { class: 'small muted', hidden: '', text: 'Travelling back through the days needs a second day of data.' });
    var tableHost = el('div');
    var card = el('section', { class: 'card cloud' }, [
      el('h2', { text: 'The films in three dimensions' }),
      el('p', { class: 'small muted', text: 'Each glyph is a film. Its place in the box comes from three numbers in the history file. ' +
        'Drag to turn the box, click a film to pick it, or use the keyboard: the arrow keys turn the box, [ and ] step from film to film. ' +
        'The slider travels back through the days (the films glide to where they were), and Trails draws the path each film has taken; the keys , and . step through the days.' }),
      el('div', { class: 'controls' }, [el('label', { class: 'field' }, ['Source', picker]), el('label', { class: 'field' }, ['Spacing', spacing]), reset]),
      el('div', { class: 'cloud-stage' }, [canvas, tip]),
      scrub, scrubNote,
      legend,
      el('div', { class: 'cloud-picked' }, [detail, el('div', { class: 'view-actions' }, [starButton, browseButton, compareButton])]),
      el('p', { class: 'small muted' }, [el('strong', { text: 'How it is computed: ' }),
        'IMDb: the rating and the votes come from each film’s latest row in history.csv, and the third axis is the votes added between the film’s first and latest day ' +
        'divided by the days between them. Wikipedia: the 7-day views come from the latest row; the second axis is the latest daily views divided by the 7-day views over seven ' +
        '(1.0 is a typical day, above 1 is a spike); the third is the percent change in daily views between the film’s first and latest day. ' +
        'Votes and views are placed on a logarithmic scale, because the biggest film has hundreds of times more than the smallest. ' +
        'On every day only the history up to that day is used, and each axis keeps one range over all the days, so the films really move when you travel through time. ' +
        'With true values each axis runs from the smallest to the largest value among the films shown; with even spacing the films are spread evenly by rank instead (equal values share a place), which keeps one extreme value from squeezing the rest together. A film with no third number yet (it needs two days of data) sits in the middle of that axis.']),
      tableHost
    ]);
    host.appendChild(card);

    /* ---------- drawing ---------- */

    function fmtValue(axis, v) {
      if (v === null) return '—';
      if (axis.key === 'rating') return v.toFixed(1);
      if (axis.key === 'change') return T.pct(v);
      if (axis.key === 'spike') return '×' + v.toFixed(2);
      if (axis.key === 'growth') return (v >= 0 ? '+' : '−') + Math.round(Math.abs(v)).toLocaleString('en-US');
      return T.fmt(v, axis.key);
    }
    function fmtRange(axis) {
      if (axis.lo === null) return 'no values yet';
      var log = axis.scale === 'log';
      var lo = log ? Math.round(Math.pow(10, axis.lo)) : axis.lo, hi = log ? Math.round(Math.pow(10, axis.hi)) : axis.hi;
      return fmtValue(axis, lo) + ' to ' + fmtValue(axis, hi);
    }

    function fit() {
      dpr = Math.min(root.devicePixelRatio || 1, 2);
      size.w = Math.max(240, canvas.clientWidth || 600);
      size.h = Math.max(300, canvas.clientHeight || 420);
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
      dirty = true;
    }

    function colors() {
      var style = getComputedStyle(document.documentElement);
      return { accent: style.getPropertyValue('--accent').trim() || '#00ff41', ink: style.getPropertyValue('--ink').trim() || '#c9ffd6' };
    }

    function line(ctx, a, b, alpha, width) {
      var p = C.project(a, view, size), q = C.project(b, view, size);
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width || 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }

    function draw() {
      var ctx = canvas.getContext('2d'), look = colors();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
      ctx.strokeStyle = look.accent;
      ctx.shadowBlur = 0;

      // the floor grid and the edges of the box
      var i, g;
      for (i = -1; i <= 1; i += 0.5) {
        line(ctx, [i, -1, -1], [i, -1, 1], 0.10);
        line(ctx, [-1, -1, i], [1, -1, i], 0.10);
      }
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c) { line(ctx, [c[0], -1, c[1]], [c[0], 1, c[1]], 0.14); });
      [-1, 1].forEach(function (y) {
        line(ctx, [-1, y, -1], [1, y, -1], 0.14); line(ctx, [-1, y, 1], [1, y, 1], 0.14);
        line(ctx, [-1, y, -1], [-1, y, 1], 0.14); line(ctx, [1, y, -1], [1, y, 1], 0.14);
      });

      // the three axes, from the near-left-bottom corner, named at their ends
      var corner = [-1, -1, -1];
      var ends = [[1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
      ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
      ctx.textBaseline = 'middle';
      ends.forEach(function (end, k) {
        line(ctx, corner, end, 0.7, 1.6);
        var p = C.project(end, view, size);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = look.ink;
        var text = model.axes[k].short + (k === 0 ? ' →' : k === 1 ? ' ↑' : ' ↗'), wide = ctx.measureText(text).width;
        var toRight = p.x > size.w / 2 && p.x + 8 + wide < size.w - 4;           // on the other side if it would run off the edge
        ctx.textAlign = toRight ? 'left' : 'right';
        ctx.fillText(text, Math.max(wide + 4, toRight ? p.x + 8 : p.x - 8), p.y);
      });

      // the films, farthest first so nearer ones are drawn over them
      if (trails && dayIndex > 0) {          // the path each film has taken, brighter toward today
        model.points.forEach(function (p, n) {
          var path = tl.paths[p.id], points = path ? path.filter(function (s) { return s.day <= dayIndex; }).map(function (s) { return s.pos; }) : [];
          if (points.length < 2) return;
          points[points.length - 1] = display[p.id] || points[points.length - 1];
          var strong = n === selected || n === hover;
          ctx.strokeStyle = strong ? '#eafff0' : look.accent;
          ctx.lineWidth = strong ? 1.8 : 1.2;
          for (var s = 1; s < points.length; s++) {
            var a = C.project(points[s - 1], view, size), b = C.project(points[s], view, size);
            ctx.globalAlpha = (strong ? 0.5 : 0.14) + 0.3 * (s / points.length) * (strong ? 1 : 0.6);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        });
      }

      projected = model.points.map(function (p, n) {
        var q = C.project(display[p.id] || p.pos, view, size);
        q.i = n;
        q.size = Math.max(14, Math.min(40, q.s * Math.min(size.w, size.h) * 0.21));
        q.r = q.size * 0.7;
        return q;
      });
      var order = projected.slice().sort(function (a, b) { return a.depth - b.depth; });
      ctx.textAlign = 'center';
      order.forEach(function (q) {
        var p = model.points[q.i], at = display[p.id] || p.pos, floor = C.project([at[0], -1, at[2]], view, size);
        var near = Math.max(0, Math.min(1, (q.depth + 1.5) / 3));
        var alpha = (0.35 + 0.65 * near) * (p.thirdKnown ? 1 : 0.65);
        var active = q.i === selected || q.i === hover;
        ctx.strokeStyle = look.accent;
        ctx.globalAlpha = active ? 0.55 : 0.16 * alpha;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(floor.x, floor.y);
        ctx.stroke();
        ctx.shadowColor = look.accent;
        ctx.shadowBlur = active ? 18 : 8 * near + 2;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = active ? '#eafff0' : look.accent;
        ctx.font = '600 ' + Math.round(q.size) + 'px "Courier New", ui-monospace, monospace';
        ctx.fillText(glyphFor(p.id), q.x, q.y);
        ctx.shadowBlur = 0;
        if (active) {
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = '#eafff0';
          ctx.beginPath();
          ctx.arc(q.x, q.y, q.size * 0.72, 0, 6.2832);
          ctx.stroke();
        }
      });

      // the names of the picked and the pointed-at film
      [selected, hover].forEach(function (n, k) {
        if (n < 0 || (k === 1 && n === selected)) return;
        var q = projected[n], name = model.points[n].name;
        ctx.font = '13px ui-monospace, Menlo, Consolas, monospace';
        var width = ctx.measureText(name).width + 12, x = Math.min(Math.max(q.x - width / 2, 4), size.w - width - 4), y = q.y - q.size - 14;
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#000';
        ctx.fillRect(x, y - 10, width, 20);
        ctx.strokeStyle = look.accent;
        ctx.globalAlpha = 0.6;
        ctx.strokeRect(x + 0.5, y - 9.5, width - 1, 19);
        ctx.globalAlpha = 1;
        ctx.fillStyle = look.ink;
        ctx.textAlign = 'left';
        ctx.fillText(name, x + 6, y);
      });
      ctx.globalAlpha = 1;
    }

    /* ---------- the animation loop: only runs while the cloud is on screen ---------- */

    function rotating() {
      return loop && visible && !document.hidden && !document.getElementById('matrix-intro') && !dragging && !over && !focused && Date.now() - lastTouched > 2500;
    }
    function frame(now) {
      raf = 0;
      var dt = Math.min(0.1, (now - last) / 1000 || 0);
      last = now;
      if (rotating()) { view.yaw += dt * 0.14; dirty = true; }
      if (loop && model && glide(dt)) dirty = true;
      if (dirty && model) { dirty = false; draw(); }
      if (loop && visible && !document.hidden) raf = requestAnimationFrame(frame);
    }
    function wake() {
      dirty = true;
      if (!raf && visible) { last = performance.now(); raf = requestAnimationFrame(frame); }
    }
    // The films glide to where the shown day puts them; true while any is still on its way.
    function glide(dt) {
      var moving = false;
      model.points.forEach(function (p) {
        var now = display[p.id];
        if (!now) { display[p.id] = p.pos.slice(); return; }
        for (var k = 0; k < 3; k++) {
          var next = C.ease(now[k], p.pos[k], dt, 0.16);
          if (Math.abs(next - p.pos[k]) < 0.002) next = p.pos[k];
          if (next !== now[k]) moving = true;
          now[k] = next;
        }
      });
      return moving;
    }
    function touched() { lastTouched = Date.now(); }

    /* ---------- the picked film ---------- */

    function describe(p) {
      return p.name + ' — ' + model.axes.map(function (axis, k) {
        return axis.short + ' ' + fmtValue(axis, p.values[k]);
      }).join(', ') + (p.thirdKnown ? '' : ' (' + model.axes[2].short + ' needs a second day of data)');
    }
    function showPicked() {
      var p = selected >= 0 ? model.points[selected] : null;
      detail.textContent = p ? describe(p) + (tl && tl.dates.length > 1 ? ' · ' + tl.dates[dayIndex] : '') : 'Pick a film to see its numbers.';
      starButton.hidden = browseButton.hidden = !p;
      compareButton.hidden = !p || !root.TrackerCompare;
      if (p) {
        var on = T.getShortlist().indexOf(p.id) >= 0;
        starButton.textContent = on ? '★ On your shortlist' : '☆ Add to shortlist';
        starButton.setAttribute('aria-pressed', String(on));
      }
    }
    function pick(n) {
      selected = n;
      showPicked();
      wake();
    }

    starButton.addEventListener('click', function () {
      if (selected < 0) return;
      var id = model.points[selected].id, list = T.getShortlist(), at = list.indexOf(id);
      if (at >= 0) list.splice(at, 1); else list.push(id);
      T.setShortlist(list);
      showPicked();
    });
    compareButton.addEventListener('click', function () {
      if (selected >= 0 && root.TrackerCompare) root.TrackerCompare.add(model.points[selected].name);
    });
    browseButton.addEventListener('click', function () {
      if (selected < 0) return;
      var state = {};
      Object.keys(T.BROWSE_DEFAULT).forEach(function (k) { state[k] = T.BROWSE_DEFAULT[k]; });
      state.q = model.points[selected].name;
      T.navigate('browse.html' + T.formatBrowseState(state));
    });

    /* ---------- the data for one source ---------- */

    function load(source) {
      var keep = selected >= 0 && model ? model.points[selected].id : null;       // a change of spacing keeps the picked film
      stopPlay();
      var cacheKey = source + '/' + spacing.value;                               // switching back and forth does not repeat the work
      tl = timelines[cacheKey] || (timelines[cacheKey] = C.timeline(source, data, spacing.value));
      display = {};
      var days = tl.models.length;
      slider.max = String(Math.max(0, days - 1));
      scrub.hidden = days < 2;
      scrubNote.hidden = days >= 2;
      play.hidden = !loop;                                                       // with "reduce motion" the slider alone travels
      setDay(Math.max(0, days - 1), true, keep);
    }

    // Show one day: pick its model, let the films glide there (or jump), and refresh the words and the table.
    function setDay(index, snap, keep) {
      if (keep === undefined) keep = selected >= 0 && model ? model.points[selected].id : null;
      var before = {};
      if (model) model.points.forEach(function (p) { before[p.id] = true; });
      dayIndex = Math.max(0, Math.min(tl.models.length - 1, index));
      model = tl.models[dayIndex];
      model.points.forEach(function (p) { if (snap || !before[p.id] || !display[p.id]) display[p.id] = p.pos.slice(); });
      selected = -1;
      model.points.forEach(function (p, n) { if (p.id === keep) selected = n; });
      hover = -1;
      tip.hidden = true;
      var date = tl.dates[dayIndex];
      slider.value = String(dayIndex);
      slider.setAttribute('aria-valuetext', date + ', day ' + (dayIndex + 1) + ' of ' + tl.dates.length);
      dayLabel.textContent = date + ' · day ' + (dayIndex + 1) + ' of ' + tl.dates.length;
      canvas.setAttribute('aria-label', T.sourceLabel(model.source) + ' films in a three-dimensional box on ' + date + ': ' + model.points.length + ' films. ' +
        'The numbers are in the table below.');
      legend.textContent = model.points.length
        ? 'Left to right: ' + model.axes[0].label + ', ' + fmtRange(model.axes[0]) + '. Bottom to top: ' + model.axes[1].label + ', ' + fmtRange(model.axes[1]) +
          '. Toward you: ' + model.axes[2].label + ', ' + (tl.ranges[2].lo !== null ? fmtRange(model.axes[2]) : 'needs a second day of data') + '.' +
          (model.spacing === 'rank' ? ' The films are spread evenly along each axis by rank, so only their order is shown, not how far apart the values are.' : '') +
          (model.skipped.length ? ' Left out for missing numbers: ' + model.skipped.map(function (s) { return s.name; }).join(', ') + '.' : '')
        : 'No films with these numbers on this day.';
      var wasOpen = !!(tableHost.querySelector('details') && tableHost.querySelector('details').open);        // a table you opened stays open as the day changes
      tableHost.textContent = '';
      if (model.points.length && Charts) {
        Charts.tableView(tableHost, ['Film'].concat(model.axes.map(function (a) { return a.label; })), model.points.map(function (p) {
          return [p.name].concat(model.axes.map(function (axis, k) { return fmtValue(axis, p.values[k]); }));
        }), 'Show the film cloud’s numbers for ' + date + ' as a table');
        if (wasOpen) tableHost.querySelector('details').open = true;
      }
      showPicked();
      wake();
    }

    function stopPlay() {
      playing = false;
      clearInterval(playTimer);
      play.textContent = '▶ Play';
      play.setAttribute('aria-pressed', 'false');
    }
    function startPlay() {
      if (!tl || tl.models.length < 2) return;
      if (dayIndex >= tl.models.length - 1) setDay(0, true);                     // play again from the first day
      playing = true;
      play.textContent = '❚❚ Pause';
      play.setAttribute('aria-pressed', 'true');
      playTimer = setInterval(function () {
        if (dayIndex >= tl.models.length - 1) { stopPlay(); return; }
        setDay(dayIndex + 1, false);
      }, 1100);
    }

    /* ---------- mouse, touch and keyboard ---------- */

    var down = null;
    function localPoint(e) {
      var box = canvas.getBoundingClientRect();
      return { x: (e.clientX - box.left) * (size.w / (box.width || size.w)), y: (e.clientY - box.top) * (size.h / (box.height || size.h)) };
    }
    function pointAt(e) { var p = localPoint(e); return C.nearest(projected, p.x, p.y, 18); }

    canvas.addEventListener('pointerdown', function (e) {
      down = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId, touch: e.pointerType === 'touch' };
      dragging = true;
      touched();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* the drag still works without it */ }
      canvas.classList.add('grabbing');
    });
    canvas.addEventListener('pointermove', function (e) {
      touched();
      if (down) {
        var dx = e.clientX - down.x, dy = e.clientY - down.y;
        down.moved += Math.abs(dx) + Math.abs(dy);
        down.x = e.clientX; down.y = e.clientY;
        view.yaw += dx * 0.009;
        if (!down.touch) view.pitch = C.clampPitch(view.pitch + dy * 0.009);   // a touch swipe up or down scrolls the page instead
        tip.hidden = true;
        hover = -1;
        wake();
        return;
      }
      var n = pointAt(e);
      if (n !== hover) {
        hover = n;
        canvas.classList.toggle('pointing', n >= 0);
        if (n >= 0) {
          var q = projected[n], box = canvas.getBoundingClientRect(), p = model.points[n];
          tip.textContent = model.axes.map(function (axis, k) { return axis.short + ' ' + fmtValue(axis, p.values[k]); }).join('\n');   // the name is drawn on the canvas
          tip.hidden = false;
          var scaleX = box.width / size.w, gx = q.x * scaleX, gy = q.y * (box.height / size.h), gap = q.size * 0.8 * scaleX, wide = tip.offsetWidth;
          var at = C.placeTip(gx, box.width, wide, gap);                              // beside the glyph, on the side with room
          tip.style.left = at.left + 'px';
          tip.style.top = Math.max(4, Math.min(gy - 14 + (at.below ? gap + 8 : 0), box.height - tip.offsetHeight - 4)) + 'px';
          tip.style.transform = 'none';
        } else { tip.hidden = true; }
        wake();
      }
    });
    function release(e) {
      if (!down) return;
      var wasClick = down.moved < 6 && e.type === 'pointerup';
      down = null;
      dragging = false;
      canvas.classList.remove('grabbing');
      touched();
      if (wasClick) {
        var n = pointAt(e);
        if (n >= 0 && root.Sound) root.Sound.play('select', null, true);
        pick(n >= 0 && n !== selected ? n : -1);       // clicking the picked film or empty space lets go
        canvas.focus();
      }
    }
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointerenter', function () { over = true; });
    canvas.addEventListener('pointerleave', function () {
      over = false; hover = -1; tip.hidden = true; canvas.classList.remove('pointing'); touched(); wake();
    });
    canvas.addEventListener('focus', function () { focused = true; });
    canvas.addEventListener('blur', function () { focused = false; touched(); });
    canvas.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var handled = true;
      if (e.key === 'ArrowLeft') view.yaw -= 0.15;
      else if (e.key === 'ArrowRight') view.yaw += 0.15;
      else if (e.key === 'ArrowUp') view.pitch = C.clampPitch(view.pitch + 0.1);
      else if (e.key === 'ArrowDown') view.pitch = C.clampPitch(view.pitch - 0.1);
      else if (e.key === 'Home') { view.yaw = START_VIEW.yaw; view.pitch = START_VIEW.pitch; }
      else if (e.key === ']' || e.key === '[') { pick(C.step(model.points.length, selected, e.key === ']' ? 1 : -1)); }
      else if (e.key === ',' || e.key === '.') { stopPlay(); setDay(dayIndex + (e.key === '.' ? 1 : -1), !loop); }
      else if (e.key === 'Escape' && selected >= 0) pick(-1);
      else handled = false;
      if (handled) { e.preventDefault(); touched(); wake(); }
    });
    reset.addEventListener('click', function () { view.yaw = START_VIEW.yaw; view.pitch = START_VIEW.pitch; touched(); wake(); });
    picker.addEventListener('change', function () { selected = -1; load(picker.value); });
    slider.addEventListener('input', function () { stopPlay(); setDay(+slider.value, !loop); });
    play.addEventListener('click', function () { if (playing) stopPlay(); else startPlay(); });
    trailsBox.addEventListener('change', function () { trails = trailsBox.checked; wake(); });
    spacing.addEventListener('change', function () { load(picker.value); });

    /* ---------- size, visibility ---------- */

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(function () { if (Math.abs(canvas.clientWidth - size.w) > 2 || Math.abs(canvas.clientHeight - size.h) > 2) { fit(); wake(); } }).observe(canvas);
    } else {
      root.addEventListener('resize', function () { fit(); wake(); });
    }
    if (typeof IntersectionObserver !== 'undefined') {
      new IntersectionObserver(function (entries) {
        visible = entries[entries.length - 1].isIntersecting;
        if (visible) wake();
      }).observe(canvas);
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) wake(); });
    window.addEventListener('storage', showPicked);

    fit();
    load(picker.value);
    C.view = view;                       // for tests: the angles can be set from outside
    C.redraw = function () { fit(); draw(); };
    C.state = function () { return { selected: selected, hover: hover, points: model.points.length, view: view, rotating: rotating(), day: dayIndex, days: tl.dates.length, playing: playing }; };
    C.setDay = function (i) { stopPlay(); setDay(i, !loop); };
    // For tests: let the films glide for `seconds` of animation, and say whether they have all arrived.
    C.glideFor = function (seconds) { var left = 0, moving = true; while (left < seconds && moving) { moving = glide(1 / 60); left += 1 / 60; } return !moving; };
    C.settled = function () { return model.points.every(function (p) { var d = display[p.id]; return d && d[0] === p.pos[0] && d[1] === p.pos[1] && d[2] === p.pos[2]; }); };
    C.pick = pick;
  };

  root.Cloud = C;
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
})(typeof window !== 'undefined' ? window : globalThis);
