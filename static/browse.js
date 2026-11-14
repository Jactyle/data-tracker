/* Browse page: search, filters, sorting and a shortlist saved in the browser. */
(function () {
  'use strict';
  var T = Tracker, el = T.el;

  var COLUMNS = [
    { key: 'item', label: 'Item', numeric: false },
    { key: 'source', label: 'Source', numeric: false },
    { key: 'release_year', label: 'Year', numeric: true },
    { key: 'original_language', label: 'Language', numeric: false }
  ].concat(T.NUMERIC.map(function (c) { return { key: c, label: T.LABELS[c], numeric: true }; }));

  function render(data, app) {
    var all = data.analysis.items.map(function (i) { return i.row; });
    var shortlist = T.getShortlist();
    var state = { search: '', source: '', language: '', year: '', onlyStarred: false, sortKey: 'item', sortDir: 1 };

    app.appendChild(el('h1', { text: 'Browse' }));
    app.appendChild(el('p', { class: 'muted', text: 'Latest values of every item from the most recent run of each source.' }));

    function options(values, labeler) {
      return [el('option', { value: '', text: 'All' })].concat(values.map(function (v) {
        return el('option', { value: String(v), text: labeler ? labeler(v) : String(v) });
      }));
    }
    function distinct(key) {
      var seen = {};
      all.forEach(function (r) { if (r[key] != null) seen[r[key]] = true; });
      return Object.keys(seen).sort();
    }
    function field(label, control) { return el('label', { class: 'field' }, [label, control]); }

    var search = el('input', { type: 'search', placeholder: 'Search item names', 'aria-label': 'Search item names' });
    var source = el('select', {}, options(distinct('source'), T.sourceLabel));
    var language = el('select', {}, options(distinct('original_language')));
    var year = el('select', {}, options(distinct('release_year').sort(function (a, b) { return b - a; })));
    var starred = el('input', { type: 'checkbox' });
    var count = el('p', { class: 'small muted', role: 'status' });

    app.appendChild(el('div', { class: 'controls' }, [
      field('Search', search), field('Source', source), field('Language', language), field('Release year', year),
      el('label', { class: 'check' }, [starred, 'Shortlist only'])
    ]));
    app.appendChild(count);

    var thead = el('tr'), tbody = el('tbody');
    app.appendChild(el('div', { class: 'card' }, [el('div', { class: 'table-wrap' }, [
      el('table', { id: 'items' }, [el('thead', {}, [thead]), tbody])
    ])]));

    // Header: a star column, then one sortable column per field.
    thead.appendChild(el('th', { 'aria-label': 'Shortlist' }));
    var sortButtons = {};
    COLUMNS.forEach(function (col) {
      var arrow = el('span', { class: 'arrow' });
      var button = el('button', { class: 'sort', type: 'button', onclick: function () {
        if (state.sortKey === col.key) state.sortDir = -state.sortDir;
        else { state.sortKey = col.key; state.sortDir = col.numeric ? -1 : 1; }
        draw();
      } }, [col.label + ' ', arrow]);
      sortButtons[col.key] = { button: button, arrow: arrow, th: el('th', { class: col.numeric ? 'num' : '', 'aria-sort': 'none' }, [button]) };
      thead.appendChild(sortButtons[col.key].th);
    });

    function matches(r) {
      if (state.search && r.item.toLowerCase().indexOf(state.search.toLowerCase()) < 0) return false;
      if (state.source && r.source !== state.source) return false;
      if (state.language && r.original_language !== state.language) return false;
      if (state.year && String(r.release_year) !== state.year) return false;
      if (state.onlyStarred && shortlist.indexOf(r.item_id) < 0) return false;
      return true;
    }

    function compare(a, b) {
      var x = a[state.sortKey], y = b[state.sortKey];
      if (x == null && y == null) return a.item_id < b.item_id ? -1 : 1;
      if (x == null) return 1;   // empty values always sort last, up or down
      if (y == null) return -1;
      if (typeof x === 'string') { x = x.toLowerCase(); y = y.toLowerCase(); }
      if (x < y) return -state.sortDir;
      if (x > y) return state.sortDir;
      return a.item_id < b.item_id ? -1 : 1;
    }

    function draw() {
      var rows = all.filter(matches).sort(compare);
      count.textContent = 'Showing ' + rows.length + ' of ' + all.length + ' items · ' + shortlist.length + ' starred';
      COLUMNS.forEach(function (col) {
        var s = sortButtons[col.key], active = state.sortKey === col.key;
        s.arrow.textContent = active ? (state.sortDir > 0 ? '▲' : '▼') : '';
        s.th.setAttribute('aria-sort', active ? (state.sortDir > 0 ? 'ascending' : 'descending') : 'none');
      });
      tbody.textContent = '';
      if (!rows.length) {
        tbody.appendChild(el('tr', {}, [el('td', { colspan: String(COLUMNS.length + 1), class: 'empty', text: 'No items match.' })]));
        return;
      }
      rows.forEach(function (r) {
        var on = shortlist.indexOf(r.item_id) >= 0;
        var star = el('button', { class: 'star', type: 'button', 'aria-pressed': String(on),
          'aria-label': (on ? 'Remove ' : 'Add ') + r.item + (on ? ' from' : ' to') + ' shortlist', title: on ? 'Remove from shortlist' : 'Add to shortlist',
          text: on ? '★' : '☆',
          onclick: function () {
            shortlist = T.getShortlist();
            var at = shortlist.indexOf(r.item_id);
            if (at >= 0) shortlist.splice(at, 1); else shortlist.push(r.item_id);
            T.setShortlist(shortlist);
            draw();
          } });
        var tds = [el('td', {}, [star])];
        COLUMNS.forEach(function (col) {
          var text = col.key === 'source' ? T.sourceLabel(r.source) : col.numeric ? T.fmt(r[col.key], col.key) : (r[col.key] == null ? '—' : r[col.key]);
          tds.push(el('td', { class: col.numeric ? 'num' : '', text: text }));
        });
        tbody.appendChild(el('tr', {}, tds));
      });
    }

    search.addEventListener('input', function () { state.search = search.value.trim(); draw(); });
    source.addEventListener('change', function () { state.source = source.value; draw(); });
    language.addEventListener('change', function () { state.language = language.value; draw(); });
    year.addEventListener('change', function () { state.year = year.value; draw(); });
    starred.addEventListener('change', function () { state.onlyStarred = starred.checked; shortlist = T.getShortlist(); draw(); });
    // Keep two open tabs in step.
    window.addEventListener('storage', function () { shortlist = T.getShortlist(); draw(); });
    draw();
  }

  T.start('browse', render);
})();
