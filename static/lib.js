/* Shared code: loading the data files, the calculations, the navigation bar.
 * Every number on the site is computed here, in the browser, from
 * data/history.csv and data/status.json. */
(function (root) {
  'use strict';

  var T = {};

  T.NUMERIC = ['rating', 'votes', 'views', 'views_7d'];
  T.LABELS = {
    rating: 'Rating', votes: 'Votes',
    views: 'Daily views', views_7d: '7-day views', release_year: 'Year',
    original_language: 'Language', source: 'Source', item: 'Item'
  };
  // The value the move rule measures for each source (same as tracker/config.py).
  T.MAIN = { imdb: 'votes', wikipedia: 'views' };
  T.SOURCE_LABELS = { imdb: 'IMDb', wikipedia: 'Wikipedia' };
  T.TOP_PER_SOURCE = 5;

  T.sourceLabel = function (source) { return T.SOURCE_LABELS[source] || source; };
  T.mainColumn = function (source) { return T.MAIN[source] || 'votes'; };

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

  // Votes added per day between each item's first and latest row, for items that have votes.
  T.voteGrowth = function (rows) {
    var series = T.itemSeries(rows), out = [];
    Object.keys(series).forEach(function (id) {
      var pts = series[id].points.filter(function (p) { return p.row.votes != null; });
      if (pts.length < 2) return;
      var first = pts[0], last = pts[pts.length - 1];
      var days = (Date.parse(last.date + 'T00:00:00Z') - Date.parse(first.date + 'T00:00:00Z')) / 86400000;
      if (days <= 0) return;
      out.push({ item_id: id, item: series[id].item, source: series[id].source,
                 firstDate: first.date, lastDate: last.date, first: first.row.votes, last: last.row.votes,
                 days: days, perDay: (last.row.votes - first.row.votes) / days });
    });
    out.sort(function (a, b) { return b.perDay - a.perDay || (a.item_id < b.item_id ? -1 : 1); });
    return out;
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
    if (column === 'rating') return value.toFixed(1);
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

  // A small line icon: an empty 24 x 24 svg, and a helper to add shapes to it.
  function iconBase() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    ['viewBox', '0 0 24 24', 'width', '22', 'height', '22', 'aria-hidden', 'true', 'fill', 'none', 'stroke', 'currentColor',
     'stroke-width', '2', 'stroke-linecap', 'round', 'stroke-linejoin', 'round'].forEach(function (v, i, all) {
      if (i % 2 === 0) svg.setAttribute(v, all[i + 1]);
    });
    return { svg: svg, add: function (tag, attrs) {
      var node = document.createElementNS(ns, tag);
      Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
      svg.appendChild(node);
    } };
  }

  // A speaker symbol: with sound waves when the sound is on, with a cross when it is off.
  T.volumeIcon = function (on) {
    var icon = iconBase();
    icon.add('polygon', { points: '3,9 7,9 12,5 12,19 7,15 3,15', fill: 'currentColor' });
    if (on) {
      icon.add('path', { d: 'M15.5 9a4 4 0 0 1 0 6' });
      icon.add('path', { d: 'M18.5 6a8 8 0 0 1 0 12' });
    } else {
      icon.add('line', { x1: '16', y1: '9', x2: '22', y2: '15' });
      icon.add('line', { x1: '22', y1: '9', x2: '16', y2: '15' });
    }
    return icon.svg;
  };

  // A refresh symbol: a circular arrow.
  T.refreshIcon = function () {
    var icon = iconBase();
    icon.add('polyline', { points: '22 4 22 10 16 10' });
    icon.add('path', { d: 'M19.5 15a8 8 0 1 1-1.9-8.3L22 10' });
    return icon.svg;
  };

  // An arrow pointing into a tray: the install symbol.
  T.installIcon = function () {
    var icon = iconBase();
    icon.add('path', { d: 'M12 3v12' });
    icon.add('polyline', { points: '7 11 12 16 17 11' });
    icon.add('path', { d: 'M5 21h14' });
    return icon.svg;
  };

  /* ---------- the Browse view as a link ----------
   * The search, filters and sort order are kept in the page address (?q=...&source=imdb&sort=votes&dir=desc)
   * so a view can be bookmarked or shared, and in localStorage so it is remembered. These functions
   * turn a view into a query string and back. */

  var SORTABLE = ['item', 'source', 'release_year', 'original_language'].concat(T.NUMERIC);
  T.BROWSE_DEFAULT = { q: '', source: '', language: '', year: '', starred: false, sort: 'item', dir: 1 };

  function readQuery(search) {
    var out = {};
    String(search || '').replace(/^\?/, '').split('&').forEach(function (pair) {
      if (!pair) return;
      var at = pair.indexOf('='), key = at < 0 ? pair : pair.slice(0, at), value = at < 0 ? '' : pair.slice(at + 1);
      try { out[decodeURIComponent(key.replace(/\+/g, ' '))] = decodeURIComponent(value.replace(/\+/g, ' ')); }
      catch (e) { /* ignore a piece that is not valid */ }
    });
    return out;
  }

  T.parseBrowseState = function (search) {
    var q = readQuery(search), state = {};
    Object.keys(T.BROWSE_DEFAULT).forEach(function (k) { state[k] = T.BROWSE_DEFAULT[k]; });
    if (q.q) state.q = q.q.slice(0, 100);
    ['source', 'language', 'year'].forEach(function (k) { if (q[k]) state[k] = q[k].slice(0, 40); });
    if (q.starred === '1') state.starred = true;
    if (q.sort && SORTABLE.indexOf(q.sort) >= 0) {
      state.sort = q.sort;
      state.dir = q.dir === 'asc' ? 1 : q.dir === 'desc' ? -1 : (T.NUMERIC.indexOf(q.sort) >= 0 || q.sort === 'release_year' ? -1 : 1);
    }
    return state;
  };

  // The query string for a view ('' when it is the plain default view).
  T.formatBrowseState = function (state) {
    var d = T.BROWSE_DEFAULT, parts = [];
    function add(k, v) { parts.push(k + '=' + encodeURIComponent(v)); }
    if (state.q) add('q', state.q);
    if (state.source) add('source', state.source);
    if (state.language) add('language', state.language);
    if (state.year) add('year', state.year);
    if (state.starred) add('starred', '1');
    if (state.sort !== d.sort || state.dir !== d.dir) { add('sort', state.sort); add('dir', state.dir > 0 ? 'asc' : 'desc'); }
    return parts.length ? '?' + parts.join('&') : '';
  };

  // The items chosen on the Trends page, as ?items=a,b,c
  T.parseItemsParam = function (search) {
    var value = readQuery(search).items;
    return value ? value.split(',').filter(Boolean).slice(0, 8) : [];
  };
  T.formatItemsParam = function (ids) { return ids.length ? '?items=' + encodeURIComponent(ids.join(',')) : ''; };

  // Keep a query string's other parts when one changes: changes is {name: value}, a value of null or '' removes that part.
  T.readQuery = readQuery;
  T.mergeQuery = function (search, changes) {
    var q = readQuery(search);
    Object.keys(changes).forEach(function (k) { if (changes[k] === null || changes[k] === '') delete q[k]; else q[k] = changes[k]; });
    var parts = Object.keys(q).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); });
    return parts.length ? '?' + parts.join('&') : '';
  };
  T.updateQuery = function (changes) { T.replaceQuery(T.mergeQuery(root.location.search, changes)); };

  // On a phone a table is drawn as a stack of cards (display: block in site.css), which makes some
  // screen readers forget it is a table. Saying so with roles keeps the rows and columns.
  T.keepTableRoles = function (table) {
    table.setAttribute('role', 'table');
    Array.prototype.forEach.call(table.querySelectorAll('thead, tbody'), function (n) { n.setAttribute('role', 'rowgroup'); });
    Array.prototype.forEach.call(table.querySelectorAll('tr'), function (n) { n.setAttribute('role', 'row'); });
    Array.prototype.forEach.call(table.querySelectorAll('th'), function (n) { n.setAttribute('role', 'columnheader'); });
    Array.prototype.forEach.call(table.querySelectorAll('td'), function (n) { n.setAttribute('role', 'cell'); });
  };

  // Change the address without adding a step to the browser history.
  T.replaceQuery = function (query) {
    try { root.history.replaceState(null, '', root.location.pathname + query + root.location.hash); } catch (e) { /* the address stays as it is */ }
  };

  // Go to another page. (A function of its own so it can be replaced in tests.)
  T.navigate = function (url) { root.location.href = url; };

  /* ---------- installing the site as an app ----------
   * Browsers that can install a site hand over a prompt (the "beforeinstallprompt" event). It is kept
   * until the install button is clicked. */
  var installPrompt = null;
  function installed() {
    return !!((root.matchMedia && root.matchMedia('(display-mode: standalone)').matches) || (root.navigator && root.navigator.standalone === true));
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      installPrompt = e;
      document.dispatchEvent(new Event('movie-tracker:install'));
    });
    window.addEventListener('appinstalled', function () {
      installPrompt = null;
      document.dispatchEvent(new Event('movie-tracker:install'));
    });
  }
  T.canInstall = function () { return !!installPrompt && !installed(); };
  T.install = function () {
    if (!installPrompt) return Promise.resolve('unavailable');
    var offer = installPrompt;
    installPrompt = null;
    document.dispatchEvent(new Event('movie-tracker:install'));
    offer.prompt();
    return offer.userChoice.then(function (choice) { return choice.outcome; }, function () { return 'dismissed'; });
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
    // Top right: one small button that pops the sound switch and the replay button out to its left.
    var tools = T.el('div', { class: 'nav-tools' });
    var tray = T.el('div', { class: 'tool-tray', id: 'tool-tray' });
    var toggle = T.el('button', { class: 'navbtn tools-toggle', type: 'button', 'aria-expanded': 'false',
                                  'aria-controls': 'tool-tray', 'aria-label': 'Show tools', title: 'Sound and replay' },
                      [T.el('span', { class: 'chev', text: '‹', 'aria-hidden': 'true' })]);
    function setOpen(open, refocus) {
      tools.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Hide tools' : 'Show tools');
      if (!open && refocus) toggle.focus();
    }
    toggle.addEventListener('click', function () { setOpen(!tools.classList.contains('open')); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && tools.classList.contains('open')) setOpen(false, true);
    });
    document.addEventListener('click', function (e) { if (!tools.contains(e.target)) setOpen(false); });
    var install = T.el('button', { class: 'navbtn icon-btn', type: 'button', 'aria-label': 'Install the app', title: 'Install this site as an app', hidden: '',
                                   onclick: function () { T.install(); } }, [T.installIcon()]);
    function syncInstall() { install.hidden = !T.canInstall(); }
    document.addEventListener('movie-tracker:install', syncInstall);
    syncInstall();
    tray.appendChild(install);
    if (root.Sound) {
      var sound = T.el('button', { class: 'navbtn icon-btn', type: 'button', 'aria-label': 'Sound' });
      var paint = function () {
        var on = root.Sound.enabled();
        sound.textContent = '';
        sound.appendChild(T.volumeIcon(on));
        sound.setAttribute('aria-pressed', String(on));
        sound.title = on ? 'Sound is on (click to turn it off)' : 'Sound is off (click to turn it on)';
      };
      sound.addEventListener('click', function () { root.Sound.toggle(); paint(); });
      paint();
      tray.appendChild(sound);
    }
    if (root.Matrix) {
      tray.appendChild(T.el('button', { class: 'navbtn icon-btn', type: 'button', 'aria-label': 'Replay intro', title: 'Replay the intro',
                                        onclick: function () { setOpen(false); root.Matrix.replayIntro(); } }, [T.refreshIcon()]));
    }
    tools.appendChild(tray);
    tools.appendChild(toggle);
    var bar = T.el('nav', { class: 'nav', 'aria-label': 'Main' }, [
      T.el('div', { class: 'nav-inner' }, [T.el('a', { class: 'brand', href: 'index.html', text: 'Movie Tracker' })].concat(links).concat([tools]))
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

  // The credit line shared by every page.
  T.renderFooter = function () {
    var foot = T.el('footer', { class: 'foot small muted' }, [
      'Ratings and votes: data courtesy of ',
      T.el('a', { href: 'https://www.imdb.com', text: 'IMDb' }),
      ', used for personal, non-commercial purposes under ',
      T.el('a', { href: 'https://developer.imdb.com/non-commercial-datasets/', text: 'IMDb’s non-commercial dataset terms' }),
      '. Page views: Wikimedia pageviews API. ',
      T.el('a', { href: 'feed.xml', text: 'Daily report feed' }),
      ' (Atom).'
    ]);
    document.body.appendChild(foot);
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
    T.renderFooter();
    if (root.Sound) root.Sound.attach();    // clicks, typing and menus make sounds
    if (root.Ripple) root.Ripple.attach();  // clicks make a burst of falling code
    if (root.Matrix) root.Matrix.init();   // the code rain, and the intro screen the first time in a session
    T.registerServiceWorker();
    var app = document.getElementById('app');
    T.loadData().then(function (data) {
      app.textContent = '';
      T.data = data;
      if (root.Terminal) root.Terminal.init(data, page);   // the command bar and keyboard shortcuts
      if (!data.rows.length) {
        app.appendChild(T.el('div', { class: 'card empty' }, [
          T.el('h2', { text: 'No data yet' }),
          T.el('p', { text: 'The daily run has not saved any movie data yet. Check back after the first run.' })
        ]));
        return;
      }
      render(data, app);
      if (root.Decode) root.Decode.start(app);      // headings and figures decode into place
      if (root.Sound) root.Sound.play('loaded');   // only sounds if the browser already allows audio
    }).catch(function (err) {
      app.textContent = '';
      if (root.Terminal) root.Terminal.init(null, page);
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
    try {
      var saved = JSON.parse(localStorage.getItem('movie-tracker.shortlist') || '[]');
      return Array.isArray(saved) ? saved.filter(function (id) { return typeof id === 'string'; }) : [];   // anything else is damaged
    } catch (e) { return memory.slice(); }
  };
  T.setShortlist = function (ids) {
    memory = ids.slice();
    try { localStorage.setItem('movie-tracker.shortlist', JSON.stringify(ids)); } catch (e) { /* kept in memory */ }
  };

  root.Tracker = T;
  if (typeof module !== 'undefined' && module.exports) module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
