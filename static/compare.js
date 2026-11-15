/* Compare two films side by side, on the Trends page.
 *
 * Pick two films (the menus, the `compare a vs b` command, or the Compare button on a film picked in the
 * 3D cloud) and the card shows their numbers next to each other, who is ahead on each measure and by how
 * much, a sentence saying what that adds up to, and a chart per measure with one line for each film.
 * A film that is in both sources (IMDb and Wikipedia) shows the numbers from both. The pair is kept in
 * the page address (?compare=Film one~Film two), so a comparison can be shared.
 *
 * The functions at the top (films, stats, compare, finding, parse) are plain logic with no page needed, so
 * they can be tested on their own; the part below them builds the card.
 */
(function (root) {
  'use strict';

  var Cmp = {};
  var SEPARATOR = '~';

  // What can be compared. `how` says how the gap is shown: a ratio (3.2×) or a plain difference.
  Cmp.MEASURES = [
    { key: 'rating', label: 'Rating', how: 'diff' },
    { key: 'votes', label: 'Votes', how: 'ratio' },
    { key: 'growth', label: 'Votes added per day', how: 'ratio' },
    { key: 'views', label: 'Daily views', how: 'ratio' },
    { key: 'views_7d', label: '7-day views', how: 'ratio' },
    { key: 'viewsChange', label: 'Change in daily views since the first day', how: 'diff', percent: true }
  ];

  function byName(a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }
  function dayNumber(date) { return Date.parse(date + 'T00:00:00Z') / 86400000; }

  // The films in the data, one entry per name (a film in both sources is one entry holding both item ids).
  Cmp.films = function (rows) {
    var by = Object.create(null), list = [];
    (rows || []).forEach(function (r) {
      var film = by[r.item];
      if (!film) { film = by[r.item] = { name: r.item, ids: [], sources: [] }; list.push(film); }
      if (film.ids.indexOf(r.item_id) < 0) film.ids.push(r.item_id);
      if (film.sources.indexOf(r.source) < 0) film.sources.push(r.source);
    });
    return list.sort(byName);
  };

  // A film's numbers. series: item_id -> {points: [{date, row}]} as Tracker.itemSeries gives. A number the film does not
  // have (it is not in that source, or it needs a second day) is null.
  Cmp.stats = function (film, series) {
    var out = { rating: null, votes: null, growth: null, views: null, views_7d: null, viewsChange: null };
    function history(column) {
      var all = [];
      film.ids.forEach(function (id) {
        var s = Object.prototype.hasOwnProperty.call(series, id) ? series[id] : null;
        (s ? s.points : []).forEach(function (p) { if (p.row[column] != null) all.push({ date: p.date, value: p.row[column] }); });
      });
      return all.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    }
    ['rating', 'votes', 'views', 'views_7d'].forEach(function (column) {
      var h = history(column);
      if (h.length) out[column] = h[h.length - 1].value;
    });
    var votes = history('votes');
    if (votes.length > 1) {
      var days = dayNumber(votes[votes.length - 1].date) - dayNumber(votes[0].date);
      if (days > 0) out.growth = (votes[votes.length - 1].value - votes[0].value) / days;
    }
    var views = history('views');
    if (views.length > 1 && views[0].value > 0) out.viewsChange = (views[views.length - 1].value - views[0].value) / views[0].value * 100;
    return out;
  };

  // The two films measure by measure: [{key, label, a, b, lead: 'a' | 'b' | 'tie' | null, gap, how}]. A measure neither
  // film has is left out; lead is null when only one of them has it.
  Cmp.compare = function (a, b) {
    var rows = [];
    Cmp.MEASURES.forEach(function (m) {
      var x = a[m.key], y = b[m.key];
      if (x === null && y === null) return;
      var row = { key: m.key, label: m.label, a: x, b: y, lead: null, gap: null, how: m.how, percent: !!m.percent };
      if (x !== null && y !== null) {
        row.lead = x === y ? 'tie' : x > y ? 'a' : 'b';
        var hi = Math.max(x, y), lo = Math.min(x, y);
        if (row.lead !== 'tie') {
          if (m.how === 'ratio' && lo > 0) row.gap = hi / lo;
          else { row.gap = hi - lo; row.how = 'diff'; }          // a ratio means nothing when the smaller number is not above zero
        }
      }
      rows.push(row);
    });
    return rows;
  };

  // The gap on one measure in words: "3.2×", "0.3" or "12.5 points".
  Cmp.gapText = function (row) {
    if (row.lead === 'tie') return 'level';
    if (row.gap === null) return '';
    if (row.how === 'ratio') return row.gap.toFixed(1) + '×';
    return row.gap.toFixed(1) + (row.percent ? ' points' : '');
  };

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  // What the comparison adds up to: a heading that states the finding and the paragraphs under it.
  Cmp.finding = function (nameA, nameB, rows) {
    var both = rows.filter(function (r) { return r.lead !== null; });
    if (!both.length) {
      return { heading: nameA + ' and ' + nameB + ' have no measure in common yet',
               paragraphs: ['One of them is only on IMDb and the other only on Wikipedia, or the numbers need a second day, so there is nothing to put side by side yet.'] };
    }
    var aAhead = both.filter(function (r) { return r.lead === 'a'; }), bAhead = both.filter(function (r) { return r.lead === 'b'; });
    var level = both.length - aAhead.length - bAhead.length;
    var heading, leader = null, trailer = null;
    if (aAhead.length === bAhead.length) {
      heading = nameA + ' and ' + nameB + ' are level: each is ahead on ' + aAhead.length + ' of ' + plural(both.length, 'measure');
    } else {
      leader = aAhead.length > bAhead.length ? nameA : nameB;
      trailer = leader === nameA ? nameB : nameA;
      heading = leader + ' is ahead of ' + trailer + ' on ' + Math.max(aAhead.length, bAhead.length) + ' of ' + plural(both.length, 'measure');
    }
    var paragraphs = [];
    var widest = null;
    both.forEach(function (r) { if (r.how === 'ratio' && r.gap !== null && (!widest || r.gap > widest.gap)) widest = r; });
    var parts = [nameA + ' is ahead on ' + aAhead.length + ' and ' + nameB + ' on ' + bAhead.length + ' of the ' + both.length + ' measures they share' +
                 (level ? ', and ' + level + ' ' + (level === 1 ? 'is' : 'are') + ' level' : '') + '.'];
    if (widest) {
      var winner = widest.lead === 'a' ? nameA : nameB, other = widest.lead === 'a' ? nameB : nameA;
      parts.push('The widest gap is ' + widest.label.toLowerCase() + ', where ' + winner + ' has ' + Cmp.gapText(widest) + ' as many as ' + other + '.');
    }
    var rating = both.filter(function (r) { return r.key === 'rating'; })[0];
    if (rating && rating.lead !== 'tie') parts.push('Their ratings differ by ' + rating.gap.toFixed(1) + ', in favour of ' + (rating.lead === 'a' ? nameA : nameB) + '.');
    paragraphs.push(parts.join(' '));
    var lonely = rows.filter(function (r) { return r.lead === null; });
    if (lonely.length) paragraphs.push('Not compared, because only one of the two has it: ' + lonely.map(function (r) { return r.label.toLowerCase(); }).join(', ') + '.');
    return { heading: heading, paragraphs: paragraphs };
  };

  // The pair in a page address (?compare=a~b), and back.
  Cmp.format = function (a, b) { return a + SEPARATOR + b; };
  Cmp.parse = function (search) {
    var value = root.Tracker.readQuery(search).compare;
    if (!value) return null;
    var at = value.indexOf(SEPARATOR);
    if (at <= 0 || at === value.length - 1) return null;
    return { a: value.slice(0, at), b: value.slice(at + 1) };
  };

  // Which two films to show when nothing was asked for: the two with the most votes. Votes and views are not on the same
  // scale, so films with votes always come first; the ones without (only on Wikipedia) follow, by 7-day views.
  Cmp.defaults = function (films, statsByName) {
    function number(f, key) { var v = statsByName[f.name][key]; return v === null ? -1 : v; }
    var withVotes = films.filter(function (f) { return statsByName[f.name].votes !== null; })
      .sort(function (x, y) { return number(y, 'votes') - number(x, 'votes') || byName(x, y); });
    var rest = films.filter(function (f) { return statsByName[f.name].votes === null; })
      .sort(function (x, y) { return number(y, 'views_7d') - number(x, 'views_7d') || byName(x, y); });
    var ranked = withVotes.concat(rest);
    return ranked.length > 1 ? { a: ranked[0].name, b: ranked[1].name } : null;
  };

  /* ---------- the card ---------- */

  Cmp.mount = function (host, data) {
    var T = root.Tracker, el = T.el, Charts = root.Charts;
    var films = Cmp.films(data.analysis.items.map(function (i) { return i.row; }));
    if (films.length < 2 || !Charts) return;
    var series = T.itemSeries(data.rows), dates = data.analysis.dates;
    var filmByName = Object.create(null), stats = Object.create(null);
    films.forEach(function (f) { filmByName[f.name] = f; stats[f.name] = Cmp.stats(f, series); });
    var rowsById = {};                                     // item_id -> date -> row, for the charts
    Object.keys(series).forEach(function (id) {
      rowsById[id] = {};
      series[id].points.forEach(function (p) { rowsById[id][p.date] = p.row; });
    });

    function lookup(name) {                                // exact name first, then ignoring case
      if (filmByName[name]) return name;
      var lower = String(name).toLowerCase(), hit = films.filter(function (f) { return f.name.toLowerCase() === lower; })[0];
      return hit ? hit.name : null;
    }
    var chosen = Cmp.parse(root.location.search), a, b;
    if (chosen && lookup(chosen.a) && lookup(chosen.b) && lookup(chosen.a) !== lookup(chosen.b)) { a = lookup(chosen.a); b = lookup(chosen.b); }
    else { var d = Cmp.defaults(films, stats); a = d.a; b = d.b; }

    function menu(label, slot, value) {
      // A film in only one source cannot be set beside one that is only in the other, so the menu says which source it is in.
      var select = el('select', { 'aria-label': label }, films.map(function (f) {
        return el('option', { value: f.name, text: f.name + (f.sources.length === 1 ? ' · ' + T.sourceLabel(f.sources[0]) + ' only' : '') });
      }));
      select.value = value;
      var swatch = el('span', { class: 'cmp-swatch' });
      swatch.style.background = Charts.slotVar(slot);
      return { select: select, field: el('label', { class: 'field' }, [el('span', {}, [swatch, label]), select]) };
    }
    var menuA = menu('Film A', 1, a), menuB = menu('Film B', 2, b);
    var swap = el('button', { type: 'button', text: '⇄ Swap' });
    var out = el('div');
    var card = el('section', { class: 'card compare', id: 'compare' }, [
      el('h2', { text: 'Compare two films' }),
      el('p', { class: 'small muted', text: 'Pick two films to see their numbers side by side, who is ahead and by how much, and how each has moved. ' +
        'A film that is in both IMDb and Wikipedia shows the numbers from both. The pair is kept in the page address, so a comparison can be shared.' }),
      el('div', { class: 'controls' }, [menuA.field, menuB.field, swap]),
      out
    ]);
    host.appendChild(card);

    /* values shown in the card */
    function fmt(key, v) {
      if (v === null) return '—';
      if (key === 'rating') return v.toFixed(1);
      if (key === 'viewsChange') return T.pct(v);
      if (key === 'growth') return (v >= 0 ? '+' : '−') + Math.round(Math.abs(v)).toLocaleString('en-US');
      return T.fmt(v, key);
    }
    function valueOn(film, column, date) {                 // the film's number on one day, from whichever source has it
      for (var i = 0; i < film.ids.length; i++) {
        var row = rowsById[film.ids[i]] && rowsById[film.ids[i]][date];
        if (row && row[column] != null) return row[column];
      }
      return null;
    }

    var charts = [];                                       // the chart boxes of the card now on screen
    function show() {
      charts.forEach(function (box) { if (box.__observer) box.__observer.disconnect(); });      // the old charts are about to go: stop watching them
      charts = [];
      var filmA = filmByName[a], filmB = filmByName[b];
      var rows = Cmp.compare(stats[a], stats[b]), finding = Cmp.finding(a, b, rows);
      if (!rows.some(function (r) { return r.lead !== null; }) && filmA.sources.length === 1 && filmB.sources.length === 1 && filmA.sources[0] !== filmB.sources[0]) {
        // say exactly why there is nothing to compare, and what to do about it
        finding.paragraphs = [a + ' is only in the ' + T.sourceLabel(filmA.sources[0]) + ' data and ' + b + ' only in the ' + T.sourceLabel(filmB.sources[0]) +
          ' data, so they share no numbers. Pick two films from the same source (the menus say which source a film is in), or a film that is in both.'];
      }
      var wasOpen = !!(out.querySelector('details.data-table') && out.querySelector('details.data-table').open);     // a table you opened stays open
      out.textContent = '';

      var table = el('table', { class: 'cmp-table cards' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: 'Measure' }), el('th', { class: 'num', text: a }), el('th', { class: 'num', text: b }), el('th', { text: 'Ahead' })])]),
        el('tbody', {}, rows.map(function (r) {
          var ahead = r.lead === 'a' ? a : r.lead === 'b' ? b : r.lead === 'tie' ? 'level' : '—';
          var text = r.lead === 'a' || r.lead === 'b' ? ahead + ' · ' + Cmp.gapText(r) : ahead;
          return el('tr', {}, [
            el('td', { class: 'c-item', text: r.label }),
            el('td', { class: 'num cv' + (r.lead === 'a' ? ' lead' : ''), 'data-label': a, text: fmt(r.key, r.a) }),
            el('td', { class: 'num cv' + (r.lead === 'b' ? ' lead' : ''), 'data-label': b, text: fmt(r.key, r.b) }),
            el('td', { 'data-label': 'Ahead', text: text })
          ]);
        }))
      ]);
      out.appendChild(el('h3', { class: 'cmp-finding', text: finding.heading }));
      finding.paragraphs.forEach(function (p) { out.appendChild(el('p', { text: p })); });
      out.appendChild(el('p', { class: 'small muted' }, [el('strong', { text: 'How it is computed: ' }),
        'Each film’s numbers are its latest values in history.csv (votes and rating from IMDb, views from Wikipedia; a film in both sources has both). ' +
        'Votes added per day is the votes gained between the film’s first and latest day divided by the days between them, and the change in daily views is the percent change between those two days. ' +
        'On each measure the larger number is ahead; the gap is the larger divided by the smaller (for ratings and percent changes, the plain difference).']));
      T.keepTableRoles(table);
      out.appendChild(el('div', { class: 'table-wrap' }, [table]));

      var grid = el('div', { class: 'charts-grid' });
      out.appendChild(grid);
      [['rating', 'Rating'], ['votes', 'Votes'], ['views', 'Daily views'], ['views_7d', '7-day views']].forEach(function (m) {
        var lines = [[filmA, a, 1], [filmB, b, 2]].map(function (x) {
          return { name: x[1], slot: x[2], values: dates.map(function (d) { return valueOn(x[0], m[0], d); }) };
        }).filter(function (l) { return l.values.some(function (v) { return v !== null; }); });
        if (!lines.length) return;
        var chart = el('div');
        charts.push(chart);
        grid.appendChild(el('div', { class: 'card' }, [el('div', { class: 'chart-title', text: m[1] }), chart]));
        Charts.responsive(chart, function () {
          Charts.line(chart, { dates: dates, series: lines, label: m[1] + ' by day, ' + a + ' and ' + b, fmt: function (v) { return fmt(m[0], v); } });
        });
      });
      Charts.tableView(out, ['Measure', a, b, 'Ahead'], rows.map(function (r) {
        return [r.label, fmt(r.key, r.a), fmt(r.key, r.b), r.lead === 'a' || r.lead === 'b' ? (r.lead === 'a' ? a : b) + ' · ' + Cmp.gapText(r) : r.lead === 'tie' ? 'level' : '—'];
      }), 'Show the comparison as a table');
      if (wasOpen) out.querySelector('details.data-table').open = true;
    }

    function choose(nextA, nextB, fromUser) {
      a = nextA; b = nextB;
      menuA.select.value = a; menuB.select.value = b;
      if (fromUser) T.updateQuery({ compare: Cmp.format(a, b) });
      show();
    }
    menuA.select.addEventListener('change', function () {
      if (menuA.select.value === b) b = a;                // choosing the other film's name swaps them, so they are never the same
      choose(menuA.select.value, b, true);
    });
    menuB.select.addEventListener('change', function () {
      if (menuB.select.value === a) a = b;
      choose(a, menuB.select.value, true);
    });
    swap.addEventListener('click', function () { choose(b, a, true); });

    function reveal() {
      var reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (card.scrollIntoView) card.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    }
    // For the command bar and the 3D cloud.
    root.TrackerCompare = {
      set: function (x, y) {
        var nx = lookup(x), ny = lookup(y);
        if (!nx || !ny || nx === ny) return false;
        choose(nx, ny, true);
        reveal();
        return true;
      },
      add: function (name) {                               // the new film becomes A and the old A becomes B
        var n = lookup(name);
        if (!n) return false;
        if (n === a) { reveal(); return true; }
        choose(n, a, true);                                // if n was B, this swaps them
        reveal();
        return true;
      },
      state: function () { return { a: a, b: b }; }
    };
    show();
  };

  root.Compare = Cmp;
  if (typeof module !== 'undefined' && module.exports) module.exports = Cmp;
})(typeof window !== 'undefined' ? window : globalThis);
