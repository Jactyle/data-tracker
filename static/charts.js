/* Small SVG charts: lines over time, horizontal bars, columns, and a data table.
 * No library, so the charts also work offline. Colors come from CSS variables
 * (--series-1 ... --series-8) so they follow light and dark mode. */
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var C = {};

  function svg(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }
  function html(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  C.slotVar = function (slot) { return 'var(--series-' + slot + ')'; };

  /* ---------- scales ---------- */

  C.niceTicks = function (min, max, count, integer) {
    if (min === max) { if (min === 0) max = 1; else { min = Math.min(min, 0); max = Math.max(max, 0); } }
    var raw = (max - min) / (count || 4);
    var pow = Math.pow(10, Math.floor(Math.log10(raw)));
    var frac = raw / pow;
    var step = (frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10) * pow;
    if (integer && step < 1) step = 1; // counts are whole numbers
    var start = Math.floor(min / step + 1e-9) * step, end = Math.ceil(max / step - 1e-9) * step;
    var ticks = [];
    for (var v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v / step) * step);
    return { ticks: ticks, step: step };
  };

  function trim(n) { return String(Math.round(n * 10) / 10); }
  C.fmtAxis = function (v, step) {
    var a = Math.abs(v);
    if (a >= 1e6) return trim(v / 1e6) + 'M';
    if (a >= 1e4) return trim(v / 1e3) + 'K';
    if (step < 1) return v.toFixed(step < 0.1 ? 2 : 1);
    return v.toLocaleString('en-US');
  };

  /* ---------- shared pieces ---------- */

  // Redraw when the container's width changes (window resize, rotating a phone).
  C.responsive = function (container, draw) {
    if (container.__observer) container.__observer.disconnect();
    var last = 0;
    function run() { last = container.clientWidth; draw(); }
    run();
    if (typeof ResizeObserver !== 'undefined') {
      container.__observer = new ResizeObserver(function () {
        // Redraw on the next frame so drawing never triggers the observer in the same frame.
        if (Math.abs(container.clientWidth - last) > 8) requestAnimationFrame(run);
      });
      container.__observer.observe(container);
    }
  };

  function makeTooltip(container) {
    var tip = html('div', 'tooltip');
    tip.hidden = true;
    tip.setAttribute('role', 'status');
    container.appendChild(tip);
    return {
      node: tip,
      // rows: [{slot, name, value}]; the value leads, the name follows.
      show: function (head, rows, x, y) {
        tip.textContent = '';
        tip.appendChild(html('div', 'head', head));
        rows.forEach(function (r) {
          var row = html('div', 'row');
          if (r.slot) {
            var key = html('span', 'key');
            key.style.background = C.slotVar(r.slot);
            row.appendChild(key);
          }
          row.appendChild(html('strong', null, r.value));
          if (r.name) row.appendChild(html('span', 'name', r.name));
          tip.appendChild(row);
        });
        tip.hidden = false;
        var w = tip.offsetWidth, h = tip.offsetHeight, cw = container.clientWidth;
        var left = x + 14;
        if (left + w > cw) left = Math.max(0, x - w - 14);
        tip.style.left = left + 'px';
        tip.style.top = Math.max(0, y - h / 2) + 'px';
      },
      hide: function () { tip.hidden = true; }
    };
  }

  function empty(container, message) {
    container.textContent = '';
    container.appendChild(html('p', 'muted small', message));
  }

  function truncate(text, max) {
    return text.length > max ? text.slice(0, Math.max(1, max - 1)) + '…' : text;
  }

  /* ---------- line chart over days ---------- */

  // o: {dates: ['2026-11-14', ...], series: [{name, slot, values: [number|null...]}], fmt, label}
  C.line = function (container, o) {
    container.textContent = '';
    container.classList.add('chart');
    var all = [];
    o.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null) all.push(v); }); });
    if (!all.length) { empty(container, 'Nothing selected, or no values yet.'); return; }

    var width = Math.max(container.clientWidth || 600, 260), height = o.height || 260;
    var m = { top: 14, right: 18, bottom: 30, left: 54 };
    var plotW = width - m.left - m.right, plotH = height - m.top - m.bottom;
    var n = o.dates.length;
    var days = o.dates.map(function (d) { return Date.parse(d + 'T00:00:00Z') / 86400000; });
    var scale = C.niceTicks(Math.min.apply(null, all), Math.max.apply(null, all), 4);
    var y0 = scale.ticks[0], y1 = scale.ticks[scale.ticks.length - 1];
    function X(i) { return n === 1 ? m.left + plotW / 2 : m.left + (days[i] - days[0]) / (days[n - 1] - days[0]) * plotW; }
    function Y(v) { return m.top + plotH - (v - y0) / (y1 - y0) * plotH; }

    var el = svg('svg', { viewBox: '0 0 ' + width + ' ' + height, role: 'img', tabindex: '0',
                          'aria-label': o.label || 'Line chart' }, container);
    scale.ticks.forEach(function (t) {
      svg('line', { class: 'grid', x1: m.left, x2: width - m.right, y1: Y(t), y2: Y(t) }, el);
      var lab = svg('text', { class: 't-axis', x: m.left - 8, y: Y(t) + 4, 'text-anchor': 'end' }, el);
      lab.textContent = C.fmtAxis(t, scale.step);
    });
    svg('line', { class: 'axis', x1: m.left, x2: width - m.right, y1: m.top + plotH, y2: m.top + plotH }, el);
    var every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 64))));
    o.dates.forEach(function (d, i) {
      if (i % every !== 0 && i !== n - 1) return;
      if (i !== n - 1 && n - 1 - i < every / 2) return;
      var lab = svg('text', { class: 't-axis', x: X(i), y: height - 8, 'text-anchor': n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, el);
      lab.textContent = d.slice(5);
    });

    var crosshair = svg('line', { class: 'crosshair', y1: m.top, y2: m.top + plotH, visibility: 'hidden' }, el);
    o.series.forEach(function (s) {
      var d = '', pen = false, last = -1;
      s.values.forEach(function (v, i) {
        if (v == null) { pen = false; return; }
        d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1);
        pen = true; last = i;
      });
      var path = svg('path', { d: d, fill: 'none', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, el);
      path.style.stroke = C.slotVar(s.slot);
      s.values.forEach(function (v, i) {
        if (v == null) return;
        if (n > 31 && i !== last) return; // many days: mark only the latest value
        var dot = svg('circle', { cx: X(i), cy: Y(v), r: 4, 'stroke-width': 2 }, el);
        dot.style.fill = C.slotVar(s.slot);
        dot.style.stroke = 'var(--surface)';
      });
    });

    var tip = makeTooltip(container);
    function showAt(i) {
      crosshair.setAttribute('x1', X(i));
      crosshair.setAttribute('x2', X(i));
      crosshair.setAttribute('visibility', 'visible');
      var rows = [];
      o.series.forEach(function (s) {
        if (s.values[i] != null) rows.push({ slot: s.slot, name: s.name, value: o.fmt(s.values[i]) });
      });
      tip.show(o.dates[i], rows, X(i), m.top + plotH / 3);
    }
    function hideTip() { crosshair.setAttribute('visibility', 'hidden'); tip.hide(); }
    var overlay = svg('rect', { class: 'hit', x: m.left, y: m.top, width: plotW, height: plotH }, el);
    overlay.addEventListener('pointermove', function (e) {
      var box = el.getBoundingClientRect(), px = (e.clientX - box.left) * (width / box.width);
      var best = 0;
      for (var i = 1; i < n; i++) if (Math.abs(X(i) - px) < Math.abs(X(best) - px)) best = i;
      showAt(best);
    });
    overlay.addEventListener('pointerleave', hideTip);
    var focused = n - 1;
    el.addEventListener('focus', function () { showAt(focused); });
    el.addEventListener('blur', hideTip);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') focused = Math.max(0, focused - 1);
      else if (e.key === 'ArrowRight') focused = Math.min(n - 1, focused + 1);
      else return;
      e.preventDefault();
      showAt(focused);
    });

    if (o.series.length >= 2) {
      var legend = html('div', 'legend');
      o.series.forEach(function (s) {
        var item = html('span', 'item');
        var key = html('span', 'key');
        key.style.background = C.slotVar(s.slot);
        item.appendChild(key);
        item.appendChild(document.createTextNode(s.name));
        legend.appendChild(item);
      });
      container.appendChild(legend);
    }
  };

  /* ---------- horizontal bars ---------- */

  function barPath(x0, x1, y, h, r) {
    var dir = x1 >= x0 ? 1 : -1;
    if (Math.abs(x1 - x0) < 1) x1 = x0 + dir;
    r = Math.min(r, Math.abs(x1 - x0), h / 2);
    var sweep = dir > 0 ? 1 : 0;
    return 'M' + x0 + ',' + y + ' H' + (x1 - dir * r) + ' A' + r + ',' + r + ' 0 0 ' + sweep + ' ' + x1 + ',' + (y + r) +
      ' V' + (y + h - r) + ' A' + r + ',' + r + ' 0 0 ' + sweep + ' ' + (x1 - dir * r) + ',' + (y + h) + ' H' + x0 + ' Z';
  }

  // o: {rows: [{label, value, detail, slot}], fmt, signed, label}
  C.bars = function (container, o) {
    container.textContent = '';
    container.classList.add('chart');
    if (!o.rows.length) { empty(container, 'Nothing to show yet.'); return; }

    var width = Math.max(container.clientWidth || 600, 260);
    var rowH = 30, barH = 18, top = 6, axisH = 24;
    var labelW = Math.min(Math.max(width * 0.36, 110), 230);
    var values = o.rows.map(function (r) { return r.value; });
    var hasNeg = values.some(function (v) { return v < 0; });
    var left = labelW + (hasNeg ? 62 : 8), right = 70;
    var plotW = Math.max(60, width - left - right);
    var scale = C.niceTicks(Math.min(0, Math.min.apply(null, values)), Math.max(0, Math.max.apply(null, values)), 4);
    var d0 = scale.ticks[0], d1 = scale.ticks[scale.ticks.length - 1];
    function X(v) { return left + (v - d0) / (d1 - d0) * plotW; }
    var height = top + o.rows.length * rowH + axisH;

    var el = svg('svg', { viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': o.label || 'Bar chart' }, container);
    scale.ticks.forEach(function (t) {
      svg('line', { class: 'grid', x1: X(t), x2: X(t), y1: top, y2: height - axisH }, el);
      var lab = svg('text', { class: 't-axis', x: X(t), y: height - 6, 'text-anchor': 'middle' }, el);
      lab.textContent = C.fmtAxis(t, scale.step);
    });
    svg('line', { class: 'axis', x1: X(0), x2: X(0), y1: top, y2: height - axisH }, el);

    var tip = makeTooltip(container);
    var maxChars = Math.floor((labelW - 12) / 6.6);
    o.rows.forEach(function (r, i) {
      var y = top + i * rowH, by = y + (rowH - barH) / 2;
      var g = svg('g', {}, el);
      var name = svg('text', { class: 't-label', x: labelW - 8, y: y + rowH / 2 + 4, 'text-anchor': 'end' }, g);
      name.textContent = truncate(r.label, maxChars);
      var bar = svg('path', { class: 'mark', d: barPath(X(0), X(r.value), by, barH, 4) }, g);
      bar.style.fill = r.slot ? C.slotVar(r.slot) : (o.signed && r.value < 0 ? C.slotVar(8) : C.slotVar(1));
      var dir = r.value >= 0 ? 1 : -1;
      var val = svg('text', { class: 't-value', x: X(r.value) + dir * 6, y: y + rowH / 2 + 4, 'text-anchor': dir > 0 ? 'start' : 'end' }, g);
      val.textContent = o.fmt(r.value);
      var hit = svg('rect', { class: 'hit', x: 0, y: y, width: width, height: rowH, tabindex: '0',
                              'aria-label': r.label + ': ' + o.fmt(r.value) }, g);
      function show() {
        bar.classList.add('lift');
        tip.show(r.label, [{ value: o.fmt(r.value), name: r.detail || '' }], Math.min(X(r.value), width - 120), y + rowH / 2);
      }
      function hide() { bar.classList.remove('lift'); tip.hide(); }
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointermove', show);
      hit.addEventListener('pointerleave', hide);
      hit.addEventListener('focus', show);
      hit.addEventListener('blur', hide);
    });
  };

  /* ---------- vertical columns (one per day) ---------- */

  // o: {items: [{label, value, detail}], fmt, label}
  C.columns = function (container, o) {
    container.textContent = '';
    container.classList.add('chart');
    if (!o.items.length) { empty(container, 'Nothing to show yet.'); return; }

    var width = Math.max(container.clientWidth || 600, 260), height = 230;
    var m = { top: 20, right: 12, bottom: 28, left: 54 };
    var plotW = width - m.left - m.right, plotH = height - m.top - m.bottom;
    var values = o.items.map(function (r) { return r.value; });
    var scale = C.niceTicks(0, Math.max.apply(null, values), 4, o.integer);
    var y1 = scale.ticks[scale.ticks.length - 1] || 1;
    function Y(v) { return m.top + plotH - v / y1 * plotH; }
    var n = o.items.length, band = plotW / n, bw = Math.min(24, band * 0.7);

    var el = svg('svg', { viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': o.label || 'Column chart' }, container);
    scale.ticks.forEach(function (t) {
      svg('line', { class: 'grid', x1: m.left, x2: width - m.right, y1: Y(t), y2: Y(t) }, el);
      var lab = svg('text', { class: 't-axis', x: m.left - 8, y: Y(t) + 4, 'text-anchor': 'end' }, el);
      lab.textContent = C.fmtAxis(t, scale.step);
    });
    svg('line', { class: 'axis', x1: m.left, x2: width - m.right, y1: m.top + plotH, y2: m.top + plotH }, el);

    var tip = makeTooltip(container);
    var every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 52))));
    o.items.forEach(function (r, i) {
      var cx = m.left + band * i + band / 2, x = cx - bw / 2, yb = m.top + plotH, yt = Y(r.value);
      var rr = Math.min(4, bw / 2, Math.max(0, yb - yt));
      var d = r.value > 0
        ? 'M' + x + ',' + yb + ' V' + (yt + rr) + ' A' + rr + ',' + rr + ' 0 0 1 ' + (x + rr) + ',' + yt +
          ' H' + (x + bw - rr) + ' A' + rr + ',' + rr + ' 0 0 1 ' + (x + bw) + ',' + (yt + rr) + ' V' + yb + ' Z'
        : '';
      var bar = svg('path', { class: 'mark', d: d }, el);
      bar.style.fill = C.slotVar(1);
      if (band >= 40 && r.value > 0) {
        var v = svg('text', { class: 't-value', x: cx, y: yt - 5, 'text-anchor': 'middle' }, el);
        v.textContent = o.fmt(r.value);
      }
      if (i % every === 0) {
        var lab = svg('text', { class: 't-axis', x: cx, y: height - 8, 'text-anchor': 'middle' }, el);
        lab.textContent = r.label.slice(5);
      }
      var hit = svg('rect', { class: 'hit', x: cx - band / 2, y: m.top, width: band, height: plotH, tabindex: '0',
                              'aria-label': r.label + ': ' + o.fmt(r.value) }, el);
      function show() { bar.classList.add('lift'); tip.show(r.label, [{ value: o.fmt(r.value), name: r.detail || '' }], cx, m.top + plotH / 3); }
      function hide() { bar.classList.remove('lift'); tip.hide(); }
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointerleave', hide);
      hit.addEventListener('focus', show);
      hit.addEventListener('blur', hide);
    });
  };

  /* ---------- table view: every number a chart shows, without hovering ---------- */

  C.tableView = function (container, headers, rows, summary) {
    var details = html('details', 'data-table');
    details.appendChild(html('summary', null, summary || 'Show the numbers as a table'));
    var wrap = html('div', 'table-wrap');
    var table = html('table');
    var head = html('tr');
    headers.forEach(function (h, i) { head.appendChild(html('th', i ? 'num' : '', h)); });
    table.appendChild(html('thead')).appendChild(head);
    var body = html('tbody');
    rows.forEach(function (r) {
      var tr = html('tr');
      r.forEach(function (cell, i) { tr.appendChild(html('td', i ? 'num' : '', cell)); });
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrap.appendChild(table);
    details.appendChild(wrap);
    container.appendChild(details);
  };

  root.Charts = C;
})(typeof window !== 'undefined' ? window : globalThis);
