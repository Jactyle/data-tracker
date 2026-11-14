/* Today page: last run, source status, counts, latest values with change, biggest moves. */
(function () {
  'use strict';
  var T = Tracker, el = T.el;

  function tile(label, value) {
    return el('div', { class: 'tile' }, [el('div', { class: 'label', text: label }), el('div', { class: 'value', text: String(value) })]);
  }

  function deltaNode(item, column) {
    if (!item.prev || item.prev[column] == null || item.row[column] == null) return null;
    var d = item.row[column] - item.prev[column];
    if (d === 0) return el('span', { class: 'delta', text: 'no change' });
    var text = T.arrow(d) + ' ' + Math.abs(d).toLocaleString('en-US', { maximumFractionDigits: column === 'vote_average' ? 2 : 1 });
    // Up is shown green and down red, and the arrow carries the direction too.
    return el('span', { class: 'delta ' + (d > 0 ? 'up' : 'down'), text: text });
  }

  function render(data, app) {
    var status = data.status, analysis = data.analysis;
    app.appendChild(el('h1', { text: 'Today' }));

    // Time of the last run.
    var when = status && status.run_time ? status.run_time : analysis.latestDate + 'T00:00:00Z';
    var local = new Date(when);
    app.appendChild(el('p', { class: 'muted' }, [
      'Last run: ', el('strong', { text: when.replace('T', ' ').replace('Z', ' UTC') }),
      isNaN(local) ? '' : ' (' + local.toLocaleString() + ' on this device)'
    ]));

    // Counts from the status file.
    if (status) {
      app.appendChild(el('div', { class: 'tiles' }, [
        tile('Items today', status.items), tile('New today', status.new_today),
        tile('Gone today', status.gone_today), tile('Days with data', status.days_with_success),
        tile('First run', status.first_run_date || '—')
      ]));
    }

    // Status of every source.
    var sources = el('div', { class: 'card' }, [el('h2', { text: 'Sources' })]);
    var body = el('tbody');
    (status ? status.sources : []).forEach(function (s) {
      body.appendChild(el('tr', {}, [
        el('td', { text: T.sourceLabel(s.name) }),
        el('td', { class: s.ok ? 'status-ok' : 'status-fail', text: s.ok ? '✓ OK' : '✕ Failed' }),
        el('td', { class: 'num', text: String(s.count) })
      ]));
    });
    sources.appendChild(el('div', { class: 'table-wrap' }, [el('table', {}, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'Source' }), el('th', { text: 'Status' }), el('th', { class: 'num', text: 'Items' })])]), body
    ])]));
    analysis.staleSources.forEach(function (s) {
      sources.appendChild(el('p', { class: 'small muted', text: T.sourceLabel(s.source) + ' had no data on ' + analysis.latestDate +
        '; its items below are from ' + s.date + '.' }));
    });
    if (!status) sources.appendChild(el('p', { class: 'small muted', text: 'status.json is not available yet.' }));
    app.appendChild(sources);

    // Biggest moves since the previous run.
    var movesCard = el('div', { class: 'card' }, [el('h2', { text: 'Biggest moves since the previous run' })]);
    if (analysis.moves.length) {
      movesCard.appendChild(el('p', { class: 'small muted', text: 'Percent change of each item’s main value (popularity for TMDB, daily views for Wikipedia). The 5 largest moves per source.' }));
      var chart = el('div');
      movesCard.appendChild(chart);
      var rows = analysis.moves.map(function (m) {
        return { label: m.item + ' · ' + T.sourceLabel(m.source), value: m.percent,
                 detail: T.LABELS[m.column] + ' ' + T.fmt(m.old, m.column) + ' → ' + T.fmt(m.now, m.column) };
      });
      Charts.responsive(chart, function () {
        Charts.bars(chart, { rows: rows, signed: true, fmt: T.pct, label: 'Biggest moves since the previous run, percent change' });
      });
      Charts.tableView(movesCard, ['Item', 'Source', 'Value', 'Old', 'New', 'Change'], analysis.moves.map(function (m) {
        return [m.item, T.sourceLabel(m.source), T.LABELS[m.column], T.fmt(m.old, m.column), T.fmt(m.now, m.column), T.pct(m.percent)];
      }));
    } else {
      movesCard.appendChild(el('p', { class: 'muted', text: analysis.dates.length < 2
        ? 'Moves appear after the second day of data.' : 'No moves to report for the latest run.' }));
    }
    app.appendChild(movesCard);

    // Items that appeared or disappeared.
    if (analysis.newItems.length || analysis.goneItems.length) {
      var changes = el('div', { class: 'card' }, [el('h2', { text: 'Appeared and disappeared' })]);
      [['Appeared', analysis.newItems], ['Disappeared', analysis.goneItems]].forEach(function (pair) {
        if (!pair[1].length) return;
        changes.appendChild(el('p', {}, [el('strong', { text: pair[0] + ': ' }), pair[1].map(function (i) { return i.item; }).join(', ')]));
      });
      app.appendChild(changes);
    }

    // Latest values of every item, with the change since the previous run.
    var items = analysis.items.slice().sort(function (a, b) {
      if (a.row.source !== b.row.source) return a.row.source < b.row.source ? -1 : 1;
      return a.row.item < b.row.item ? -1 : a.row.item > b.row.item ? 1 : 0;
    });
    var cols = T.NUMERIC;
    var head = el('tr', {}, [el('th', { text: 'Item' }), el('th', { text: 'Source' })]
      .concat(cols.map(function (c) { return el('th', { class: 'num', text: T.LABELS[c] }); }))
      .concat([el('th', { class: 'num', text: 'Move' })]));
    var tbody = el('tbody');
    items.forEach(function (it) {
      var tds = [el('td', { text: it.row.item }), el('td', { text: T.sourceLabel(it.row.source) })];
      cols.forEach(function (c) {
        tds.push(el('td', { class: 'num' }, [el('span', { text: T.fmt(it.row[c], c) }), deltaNode(it, c)]));
      });
      var move = it.percent == null ? '—' : T.pct(it.percent);
      tds.push(el('td', { class: 'num' }, [el('span', { text: move }),
        it.percent == null ? null : el('span', { class: 'delta ' + (it.percent > 0 ? 'up' : it.percent < 0 ? 'down' : ''), text: T.arrow(it.percent) + ' ' + T.LABELS[it.column] })]));
      tbody.appendChild(el('tr', {}, tds));
    });
    app.appendChild(el('div', { class: 'card' }, [
      el('h2', { text: 'Latest values' }),
      el('p', { class: 'small muted', text: 'Small numbers under each value show the change since the previous run.' }),
      el('div', { class: 'table-wrap' }, [el('table', {}, [el('thead', {}, [head]), tbody])])
    ]));
  }

  T.start('today', render);
})();
