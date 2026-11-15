/* Browse page: search, filters, sorting and a shortlist saved in the browser.
 *
 * The view (search, filters, sort order, "shortlist only") is kept in the page address, for example
 * browse.html?source=imdb&sort=votes&dir=desc, so it can be bookmarked and shared, and in localStorage so
 * the last view is still there next time. j and k move down and up the list, and s stars the chosen film.
 * window.TrackerBrowse lets the command bar (terminal.js) change the view. */
(function () {
  'use strict';
  var T = Tracker, el = T.el;
  var VIEW_KEY = 'movie-tracker.browse';

  var COLUMNS = [
    { key: 'item', label: 'Item', numeric: false },
    { key: 'source', label: 'Source', numeric: false },
    { key: 'release_year', label: 'Year', numeric: true },
    { key: 'original_language', label: 'Language', numeric: false }
  ].concat(T.NUMERIC.map(function (c) { return { key: c, label: T.LABELS[c], numeric: true }; }));

  function render(data, app) {
    var all = data.analysis.items.map(function (i) { return i.row; });
    var shortlist = T.getShortlist();
    var currentId = null;                                      // the film j, k and s work on

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

    var sources = distinct('source'), languages = distinct('original_language');
    var years = distinct('release_year').sort(function (a, b) { return b - a; });

    var search = el('input', { type: 'search', placeholder: 'Search item names', 'aria-label': 'Search item names' });
    var source = el('select', {}, options(sources, T.sourceLabel));
    var language = el('select', {}, options(languages));
    var year = el('select', {}, options(years));
    var starred = el('input', { type: 'checkbox' });
    var sortChoice = el('select', { 'aria-label': 'Sort by' }, COLUMNS.map(function (c) { return el('option', { value: c.key, text: c.label }); }));
    var sortDirection = el('button', { type: 'button', class: 'sort-direction' });
    var clearButton = el('button', { type: 'button', text: 'Clear filters' });
    var copyButton = el('button', { type: 'button', text: 'Copy link', title: 'Copy a link to this view' });
    var count = el('p', { class: 'small muted', role: 'status' });

    app.appendChild(el('div', { class: 'controls' }, [
      field('Search', search), field('Source', source), field('Language', language), field('Release year', year),
      el('div', { class: 'sort-field' }, [field('Sort by', sortChoice), sortDirection]),       // on a phone the column headers are gone, so sorting is here
      el('label', { class: 'check' }, [starred, 'Shortlist only']), el('div', { class: 'view-actions' }, [clearButton, copyButton])
    ]));
    app.appendChild(count);

    var thead = el('tr'), tbody = el('tbody');
    var table = el('table', { id: 'items', class: 'cards' }, [el('thead', {}, [thead]), tbody]);
    app.appendChild(el('div', { class: 'card' }, [el('div', { class: 'table-wrap' }, [table])]));

    /* ---------- the view: from the address, or the last one used ---------- */

    function sane(s) {                       // drop values that this data does not have
      if (s.source && sources.indexOf(s.source) < 0) s.source = '';
      if (s.language && languages.indexOf(s.language) < 0) s.language = '';
      if (s.year && years.map(String).indexOf(s.year) < 0) s.year = '';
      return s;
    }
    var remembered = '';
    try { remembered = localStorage.getItem(VIEW_KEY) || ''; } catch (e) { /* no memory */ }
    var state = sane(T.parseBrowseState(location.search || remembered));

    function showState() {                   // put the view into the controls
      search.value = state.q;
      source.value = state.source;
      language.value = state.language;
      year.value = state.year;
      starred.checked = state.starred;
    }

    // Header: a star column, then one sortable column per field.
    thead.appendChild(el('th', { 'aria-label': 'Shortlist' }));
    var sortButtons = {};
    COLUMNS.forEach(function (col) {
      var arrow = el('span', { class: 'arrow' });
      var button = el('button', { class: 'sort', type: 'button', onclick: function () {
        if (state.sort === col.key) state.dir = -state.dir;
        else { state.sort = col.key; state.dir = col.numeric ? -1 : 1; }
        commit(true);
      } }, [col.label + ' ', arrow]);
      sortButtons[col.key] = { button: button, arrow: arrow, th: el('th', { class: col.numeric ? 'num' : '', 'aria-sort': 'none' }, [button]) };
      thead.appendChild(sortButtons[col.key].th);
    });

    function matches(r) {
      if (state.q && r.item.toLowerCase().indexOf(state.q.toLowerCase()) < 0) return false;
      if (state.source && r.source !== state.source) return false;
      if (state.language && r.original_language !== state.language) return false;
      if (state.year && String(r.release_year) !== state.year) return false;
      if (state.starred && shortlist.indexOf(r.item_id) < 0) return false;
      return true;
    }

    function compare(a, b) {
      var x = a[state.sort], y = b[state.sort];
      if (x == null && y == null) return a.item_id < b.item_id ? -1 : 1;
      if (x == null) return 1;   // empty values always sort last, up or down
      if (y == null) return -1;
      if (typeof x === 'string') { x = x.toLowerCase(); y = y.toLowerCase(); }
      if (x < y) return -state.dir;
      if (x > y) return state.dir;
      return a.item_id < b.item_id ? -1 : 1;
    }

    function toggleStar(id) {
      shortlist = T.getShortlist();
      var at = shortlist.indexOf(id);
      if (at >= 0) shortlist.splice(at, 1); else shortlist.push(id);
      T.setShortlist(shortlist);
      draw();
    }

    var shown = [];                           // the films on screen, in order
    function draw() {
      shown = all.filter(matches).sort(compare);
      count.textContent = 'Showing ' + shown.length + ' of ' + all.length + ' items · ' + shortlist.length + ' starred';
      COLUMNS.forEach(function (col) {
        var s = sortButtons[col.key], active = state.sort === col.key;
        s.arrow.textContent = active ? (state.dir > 0 ? '▲' : '▼') : '';
        s.th.setAttribute('aria-sort', active ? (state.dir > 0 ? 'ascending' : 'descending') : 'none');
      });
      clearButton.hidden = T.formatBrowseState(state) === '';
      sortChoice.value = state.sort;
      sortDirection.textContent = state.dir > 0 ? '▲ Ascending' : '▼ Descending';
      sortDirection.setAttribute('aria-label', 'Sort direction: ' + (state.dir > 0 ? 'ascending' : 'descending') + ' (press to reverse)');
      tbody.textContent = '';
      if (!shown.length) {
        tbody.appendChild(el('tr', {}, [el('td', { colspan: String(COLUMNS.length + 1), class: 'empty', text: 'No items match.' })]));
        T.keepTableRoles(table);
        return;
      }
      shown.forEach(function (r) {
        var on = shortlist.indexOf(r.item_id) >= 0;
        var star = el('button', { class: 'star', type: 'button', 'aria-pressed': String(on),
          'aria-label': (on ? 'Remove ' : 'Add ') + r.item + (on ? ' from' : ' to') + ' shortlist', title: on ? 'Remove from shortlist' : 'Add to shortlist',
          text: on ? '★' : '☆', onclick: function () { toggleStar(r.item_id); } });
        var tds = [el('td', { class: 'c-star' }, [star])];
        COLUMNS.forEach(function (col) {
          var text = col.key === 'source' ? T.sourceLabel(r.source) : col.numeric ? T.fmt(r[col.key], col.key) : (r[col.key] == null ? '—' : r[col.key]);
          // data-label is the name shown beside the value when a phone draws the row as a card
          tds.push(el('td', { class: (col.numeric ? 'num' : '') + (col.key === 'item' ? ' c-item' : '') + (r[col.key] == null ? ' nil' : ''), 'data-label': col.label, text: text }));
        });
        var row = el('tr', { 'data-id': r.item_id }, tds);
        if (r.item_id === currentId) { row.classList.add('current'); row.setAttribute('aria-current', 'true'); }
        tbody.appendChild(row);
      });
      T.keepTableRoles(table);
    }

    // The view changed: show it, remember it, put it in the address.
    function commit(animate) {
      var query = T.formatBrowseState(state);
      T.replaceQuery(query);
      try { localStorage.setItem(VIEW_KEY, query); } catch (e) { /* not remembered */ }
      draw();
      if (animate && window.Decode) window.Decode.run(count, { quick: true });
    }

    /* ---------- controls ---------- */

    search.addEventListener('input', function () { state.q = search.value.trim(); commit(false); });
    source.addEventListener('change', function () { state.source = source.value; commit(true); });
    language.addEventListener('change', function () { state.language = language.value; commit(true); });
    year.addEventListener('change', function () { state.year = year.value; commit(true); });
    sortChoice.addEventListener('change', function () {
      var col = COLUMNS.filter(function (c) { return c.key === sortChoice.value; })[0];
      state.sort = col.key;
      state.dir = col.numeric ? -1 : 1;
      commit(true);
    });
    sortDirection.addEventListener('click', function () { state.dir = -state.dir; commit(true); });
    starred.addEventListener('change', function () { state.starred = starred.checked; shortlist = T.getShortlist(); commit(true); });
    clearButton.addEventListener('click', function () { api.apply({ reset: true }); });
    copyButton.addEventListener('click', function () {
      function done(ok) { if (window.Terminal) window.Terminal.toast(ok ? 'Link to this view copied' : 'Copy this address from the address bar'); }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(function () { done(true); }, function () { done(false); });
      else done(false);
    });
    // Keep two open tabs in step.
    window.addEventListener('storage', function () { shortlist = T.getShortlist(); draw(); });

    /* ---------- keys: j and k move, s stars ---------- */

    function moveCurrent(step) {
      if (!shown.length) return;
      var at = -1;
      shown.forEach(function (r, i) { if (r.item_id === currentId) at = i; });
      at = at < 0 ? (step > 0 ? 0 : shown.length - 1) : Math.min(shown.length - 1, Math.max(0, at + step));
      currentId = shown[at].item_id;
      draw();
      var row = tbody.querySelector('tr.current');
      if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    }
    document.addEventListener('keydown', function (e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || document.getElementById('matrix-intro') || document.body.classList.contains('cmd-open')) return;
      var tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'j') { e.preventDefault(); moveCurrent(1); }
      else if (e.key === 'k') { e.preventDefault(); moveCurrent(-1); }
      else if (e.key === 's' && currentId) { e.preventDefault(); toggleStar(currentId); }
      else if (e.key === 'Escape' && currentId) { currentId = null; draw(); }
    });

    /* ---------- for the command bar ---------- */

    var api = window.TrackerBrowse = {
      // Change the view: { reset: true } first goes back to the plain view; the other keys are the view's fields.
      apply: function (partial) {
        if (partial.reset) state = T.parseBrowseState('');
        ['q', 'source', 'language', 'year', 'starred', 'sort', 'dir'].forEach(function (k) { if (partial[k] !== undefined) state[k] = partial[k]; });
        state = sane(state);
        showState();
        commit(true);
      },
      refresh: function () { shortlist = T.getShortlist(); draw(); },
      state: function () { return state; }
    };

    showState();
    T.replaceQuery(T.formatBrowseState(state));      // a remembered view shows in the address too
    draw();
  }

  T.start('browse', render);
})();
