/* Shared code: loading the data files, the calculations, the navigation bar.
 * Every number on the site is computed here, in the browser, from
 * data/history.csv and data/status.json. */
(function (root) {
  'use strict';

  var T = {};

  T.NUMERIC = ['popularity', 'vote_average', 'vote_count', 'views', 'views_7d'];
  T.LABELS = {
    popularity: 'Popularity', vote_average: 'Rating', vote_count: 'Votes',
    views: 'Daily views', views_7d: '7-day views', release_year: 'Year',
    original_language: 'Language', source: 'Source', item: 'Item'
  };
  // The value the move rule measures for each source (same as tracker/config.py).
  T.MAIN = { tmdb: 'popularity', wikipedia: 'views' };
  T.SOURCE_LABELS = { tmdb: 'TMDB', wikipedia: 'Wikipedia' };
  T.TOP_PER_SOURCE = 5;

  T.sourceLabel = function (source) { return T.SOURCE_LABELS[source] || source; };
  T.mainColumn = function (source) { return T.MAIN[source] || 'popularity'; };

  /* ---------- CSV ---------- */

  // A small RFC 4180 parser: quoted fields, doubled quotes, commas and line breaks inside quotes.
  T.parseCSV = function (text) {
    var rows = [], row = [], field = '', quoted = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
        } else { field += c; }
      } else if (c === '"') { quoted = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') { field += c; }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  };

  // Rows of history.csv as objects. Numeric columns become numbers, empty cells null.
  T.parseHistory = function (text) {
    var table = T.parseCSV(text);
    if (!table.length) return [];
    var head = table[0], out = [];
    for (var r = 1; r < table.length; r++) {
      var cells = table[r];
      if (cells.length === 1 && cells[0] === '') continue;
      var o = {};
      for (var i = 0; i < head.length; i++) {
        var v = cells[i] === undefined ? '' : cells[i];
        if (T.NUMERIC.indexOf(head[i]) >= 0 || head[i] === 'release_year') o[head[i]] = v === '' ? null : Number(v);
        else o[head[i]] = v === '' ? null : v;
      }
      out.push(o);
    }
    return out;
  };

  /* ---------- the move rule (same as tracker/moves.py) ---------- */

  T.percentChange = function (oldValue, newValue) {
    if (oldValue == null || newValue == null || !(oldValue > 0)) return null;
    return (newValue - oldValue) / oldValue * 100;
  };

  function byMove(a, b) {
    var d = Math.abs(b.percent) - Math.abs(a.percent);
    if (d !== 0) return d;
    return a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0;
  }

  // Group rows: source -> date -> item_id -> row.
  T.group = function (rows) {
    var bySource = {};
    rows.forEach(function (row) {
      var days = bySource[row.source] = bySource[row.source] || {};
      (days[row.date] = days[row.date] || {})[row.item_id] = row;
    });
    return bySource;
  };

  // Everything the Today and Browse pages need.
  T.analyze = function (rows) {
    var bySource = T.group(rows), dateSet = {};
    rows.forEach(function (row) { dateSet[row.date] = true; });
    var dates = Object.keys(dateSet).sort();
    var latest = dates.length ? dates[dates.length - 1] : null;
    var out = {
      dates: dates, latestDate: latest, firstDate: dates[0] || null,
      sources: Object.keys(bySource).sort(), bySource: bySource,
      items: [], moves: [], newItems: [], goneItems: [], staleSources: [], firstRunSources: []
    };
    out.sources.forEach(function (source) {
      var days = Object.keys(bySource[source]).sort();
      var last = days[days.length - 1];
      var prevDate = days.length > 1 ? days[days.length - 2] : null;
      var now = bySource[source][last], before = prevDate ? bySource[source][prevDate] : {};
      var column = T.mainColumn(source);
      var current = last === latest;
      if (!current) out.staleSources.push({ source: source, date: last });
      else if (!prevDate) out.firstRunSources.push(source);
      var moves = [];
      Object.keys(now).forEach(function (id) {
        var row = now[id];
        var prev = current && prevDate ? before[id] || null : null;
        var percent = prev ? T.percentChange(prev[column], row[column]) : null;
        out.items.push({ row: row, prev: prev, prevDate: prev ? prevDate : null, stale: !current,
                         column: column, percent: percent });
        if (prev && percent !== null) {
          moves.push({ item_id: id, item: row.item, source: source, column: column,
                       old: prev[column], now: row[column], percent: percent, previousDate: prevDate });
        }
      });
      if (current && prevDate) {
        Object.keys(now).sort().forEach(function (id) {
          if (!before[id]) out.newItems.push({ item_id: id, item: now[id].item, source: source });
        });
        Object.keys(before).sort().forEach(function (id) {
          if (!now[id]) out.goneItems.push({ item_id: id, item: before[id].item, source: source });
        });
      }
      moves.sort(byMove);
      out.moves = out.moves.concat(moves.slice(0, T.TOP_PER_SOURCE));
    });
    out.moves.sort(byMove);
    return out;
  };

  /* ---------- calculations for the Trends page ---------- */

  // item_id -> {item_id, item, source, points: [{date, row}]}, points oldest first.
  T.itemSeries = function (rows) {
    var map = {};
    rows.forEach(function (row) {
      var s = map[row.item_id] = map[row.item_id] || { item_id: row.item_id, item: row.item, source: row.source, points: [] };
      s.points.push({ date: row.date, row: row });
    });
    Object.keys(map).forEach(function (id) {
      map[id].points.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    });
    return map;
  };

  // Change of each item's main value from its first row to its latest row, largest rise first.
  T.risers = function (rows) {
    var series = T.itemSeries(rows), out = [];
    Object.keys(series).forEach(function (id) {
      var s = series[id], n = s.points.length;
      if (n < 2) return;
      var column = T.mainColumn(s.source);
      var first = s.points[0], last = s.points[n - 1];
      var percent = T.percentChange(first.row[column], last.row[column]);
      if (percent === null) return;
      out.push({ item_id: id, item: s.item, source: s.source, column: column,
                 firstDate: first.date, lastDate: last.date,
                 first: first.row[column], last: last.row[column], percent: percent });
    });
    out.sort(function (a, b) { return b.percent - a.percent || (a.item_id < b.item_id ? -1 : 1); });
    return out;
  };

  // For every date after a source's first: the average absolute percent move of its items
  // against that source's previous date. Dates are combined across sources.
  T.dayMoves = function (rows) {
    var bySource = T.group(rows), totals = {};
    Object.keys(bySource).forEach(function (source) {
      var days = Object.keys(bySource[source]).sort(), column = T.mainColumn(source);
      for (var d = 1; d < days.length; d++) {
        var now = bySource[source][days[d]], before = bySource[source][days[d - 1]];
        Object.keys(now).forEach(function (id) {
          if (!before[id]) return;
          var percent = T.percentChange(before[id][column], now[id][column]);
          if (percent === null) return;
          var t = totals[days[d]] = totals[days[d]] || { sum: 0, n: 0 };
          t.sum += Math.abs(percent);
          t.n += 1;
        });
      }
    });
    return Object.keys(totals).sort().map(function (date) {
      return { date: date, mean: totals[date].sum / totals[date].n, n: totals[date].n };
    });
  };

  // Each item's average absolute percent change between its consecutive rows.
  T.volatility = function (rows) {
    var series = T.itemSeries(rows), out = [];
    Object.keys(series).forEach(function (id) {
      var s = series[id], column = T.mainColumn(s.source), sum = 0, n = 0;
      for (var i = 1; i < s.points.length; i++) {
        var p = T.percentChange(s.points[i - 1].row[column], s.points[i].row[column]);
        if (p !== null) { sum += Math.abs(p); n += 1; }
      }
      if (n) out.push({ item_id: id, item: s.item, source: s.source, column: column, mean: sum / n, n: n });
    });
    out.sort(function (a, b) { return b.mean - a.mean || (a.item_id < b.item_id ? -1 : 1); });
    return out;
  };

  // Per date: how many items appeared in / disappeared from a source's list since its previous date.
  T.turnover = function (rows) {
    var bySource = T.group(rows), totals = {};
    Object.keys(bySource).forEach(function (source) {
      var days = Object.keys(bySource[source]).sort();
      for (var d = 1; d < days.length; d++) {
        var now = bySource[source][days[d]], before = bySource[source][days[d - 1]];
        var t = totals[days[d]] = totals[days[d]] || { added: 0, removed: 0 };
        Object.keys(now).forEach(function (id) { if (!before[id]) t.added += 1; });
        Object.keys(before).forEach(function (id) { if (!now[id]) t.removed += 1; });
      }
    });
    return Object.keys(totals).sort().map(function (date) {
      return { date: date, added: totals[date].added, removed: totals[date].removed };
    });
  };

  // Each item's latest row for the given column (only items that have a value), largest first.
  T.latestValues = function (rows, column) {
    var series = T.itemSeries(rows), out = [];
    Object.keys(series).forEach(function (id) {
      var s = series[id], last = s.points[s.points.length - 1];
      if (last.row[column] != null) out.push({ item_id: id, item: s.item, source: s.source, date: last.date, value: last.row[column] });
    });
    out.sort(function (a, b) { return b.value - a.value || (a.item_id < b.item_id ? -1 : 1); });
    return out;
  };

  /* ---------- number formatting ---------- */

  T.fmt = function (value, column) {
    if (value == null) return '—';
    if (column === 'release_year') return String(value);
    if (column === 'vote_average') return value.toFixed(1);
    if (Number.isInteger(value)) return value.toLocaleString('en-US');
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };
  T.pct = function (value) {
    if (value == null) return '—';
    return (value >= 0 ? '+' : '−') + Math.abs(value).toFixed(1) + '%';
  };
  T.arrow = function (value) { return value > 0 ? '▲' : value < 0 ? '▼' : '–'; };

  /* ---------- the page frame ---------- */

  // Build a DOM element. props: class, text, on<event>, anything else is an attribute.
  T.el = function (tag, props, kids) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'class') e.className = props[k];
      else if (k === 'text') e.textContent = props[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), props[k]);
      else e.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (kid) {
      if (kid == null) return;
      e.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    });
    return e;
  };

  var PAGES = [['index.html', 'today', 'Today'], ['browse.html', 'browse', 'Browse'], ['trends.html', 'trends', 'Trends']];

  // The one navigation bar, written here once and used by every page.
  T.renderNav = function (active) {
    var host = document.getElementById('nav');
    if (!host) return;
    var links = PAGES.map(function (p) {
      var a = T.el('a', { class: 'link', href: p[0], text: p[2] });
      if (p[1] === active) a.setAttribute('aria-current', 'page');
      return a;
    });
    var bar = T.el('nav', { class: 'nav', 'aria-label': 'Main' }, [
      T.el('div', { class: 'nav-inner' }, [T.el('a', { class: 'brand', href: 'index.html', text: '🎬 Movie Tracker' })].concat(links))
    ]);
    var banner = T.el('div', { class: 'banner', role: 'status', hidden: '' }, [
      'You are offline. Showing the last data this device loaded.'
    ]);
    host.textContent = '';
    host.appendChild(bar);
    host.appendChild(banner);
    function sync() { banner.hidden = navigator.onLine; }
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    sync();
  };

  T.registerServiceWorker = function () {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* the site works without it */ });
      });
    }
  };

  T.loadData = function () {
    var options = { cache: 'no-cache' };
    return Promise.all([fetch('data/history.csv', options), fetch('data/status.json', options)]).then(function (res) {
      if (res[0].status === 404) return ['', null];   // before the first run there is no file yet
      if (!res[0].ok) throw new Error('history.csv: HTTP ' + res[0].status);
      return Promise.all([res[0].text(), res[1].ok ? res[1].json() : null]);
    }).then(function (parts) {
      var rows = T.parseHistory(parts[0]);
      return { rows: rows, status: parts[1], analysis: T.analyze(rows) };
    });
  };

  // Frame every page: navigation, service worker, data, and a friendly message when data is missing.
  T.start = function (page, render) {
    T.renderNav(page);
    T.registerServiceWorker();
    var app = document.getElementById('app');
    T.loadData().then(function (data) {
      app.textContent = '';
      if (!data.rows.length) {
        app.appendChild(T.el('div', { class: 'card empty' }, [
          T.el('h2', { text: 'No data yet' }),
          T.el('p', { text: 'The daily run has not saved any movie data yet. Check back after the first run.' })
        ]));
        return;
      }
      render(data, app);
    }).catch(function (err) {
      app.textContent = '';
      app.appendChild(T.el('div', { class: 'card empty' }, [
        T.el('h2', { text: 'The data could not be loaded' }),
        T.el('p', { text: 'Open the site once while online so it can save a copy for offline use.' }),
        T.el('p', { class: 'small muted', text: String(err && err.message || err) })
      ]));
    });
  };

  // The shortlist is kept in localStorage so it survives a reload.
  var memory = [];
  T.getShortlist = function () {
    try { return JSON.parse(localStorage.getItem('movie-tracker.shortlist') || '[]'); }
    catch (e) { return memory.slice(); }
  };
  T.setShortlist = function (ids) {
    memory = ids.slice();
    try { localStorage.setItem('movie-tracker.shortlist', JSON.stringify(ids)); } catch (e) { /* kept in memory */ }
  };

  root.Tracker = T;
  if (typeof module !== 'undefined' && module.exports) module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
