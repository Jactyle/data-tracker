/* Trends page: every number is computed here, in the browser, from data/history.csv. */
(function () {
  'use strict';
  var T = Tracker, el = T.el;

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function lower(s) { return s.toLowerCase(); }

  /* ---------- Part 1: a chart of every numeric value, with an item picker ---------- */

  function valuesCharts(app, data) {
    var rows = data.rows, dates = data.analysis.dates, series = T.itemSeries(rows);
    var ids = Object.keys(series).sort(function (a, b) {
      var x = series[a], y = series[b];
      if (x.source !== y.source) return x.source < y.source ? -1 : 1;
      return x.item < y.item ? -1 : x.item > y.item ? 1 : 0;
    });
    var byDate = {};
    ids.forEach(function (id) {
      byDate[id] = {};
      series[id].points.forEach(function (p) { byDate[id][p.date] = p.row; });
    });

    // The colour belongs to the item: it keeps its slot while it stays selected.
    var MAX = 8, slots = {};
    function selectedIds() { return ids.filter(function (id) { return slots[id]; }); }
    function takeSlot(id) {
      var used = {};
      Object.keys(slots).forEach(function (k) { used[slots[k]] = true; });
      for (var s = 1; s <= MAX; s++) if (!used[s]) { slots[id] = s; return; }
    }

    // Start with the 3 items of each source that have the largest latest main value.
    function defaults() {
      slots = {};
      data.analysis.sources.forEach(function (source) {
        var col = T.mainColumn(source);
        T.latestValues(rows, col).filter(function (v) { return v.source === source; }).slice(0, 3)
          .forEach(function (v) { takeSlot(v.item_id); });
      });
    }
    defaults();

    var card = el('div', { class: 'card' }, [
      el('h2', { text: 'Every value over the days' }),
      el('p', { class: 'small muted', text: 'Pick up to ' + MAX + ' items. Each chart shows one numeric column from history.csv; an item appears only in the charts for columns its source reports.' })
    ]);
    var picker = el('div');
    card.appendChild(picker);
    app.appendChild(card);
    var grid = el('div', { class: 'charts-grid' });
    app.appendChild(grid);

    var panels = T.NUMERIC.map(function (col) {
      var chart = el('div'), table = el('div');
      var panel = el('div', { class: 'card' }, [el('div', { class: 'chart-title', text: T.LABELS[col] }), chart, table]);
      grid.appendChild(panel);
      return { col: col, panel: panel, chart: chart, table: table };
    });

    function drawPicker() {
      picker.textContent = '';
      var buttons = el('div', { class: 'controls' }, [
        el('button', { type: 'button', text: 'Reset to top items', onclick: function () { defaults(); redraw(); } }),
        el('button', { type: 'button', text: 'Clear', onclick: function () { slots = {}; redraw(); } })
      ]);
      picker.appendChild(buttons);
      var full = selectedIds().length >= MAX;
      data.analysis.sources.forEach(function (source) {
        var group = el('div', { class: 'picker-group' }, [el('h3', { text: T.sourceLabel(source) })]);
        var list = el('div', { class: 'picker' });
        ids.filter(function (id) { return series[id].source === source; }).forEach(function (id) {
          var box = el('input', { type: 'checkbox' });
          box.checked = !!slots[id];
          box.disabled = full && !slots[id];
          box.addEventListener('change', function () {
            if (box.checked) takeSlot(id); else delete slots[id];
            redraw();
          });
          var swatch = el('span', { class: 'swatch' });
          if (slots[id]) { swatch.style.background = Charts.slotVar(slots[id]); swatch.style.borderColor = 'transparent'; }
          list.appendChild(el('label', {}, [box, swatch, series[id].item]));
        });
        group.appendChild(list);
        picker.appendChild(group);
      });
    }

    function drawCharts() {
      var chosen = selectedIds();
      panels.forEach(function (p) {
        var shown = chosen.filter(function (id) {
          return dates.some(function (d) { return byDate[id][d] && byDate[id][d][p.col] != null; });
        });
        p.panel.hidden = !shown.length;
        p.table.textContent = '';
        if (!shown.length) { p.chart.textContent = ''; return; }
        var lines = shown.map(function (id) {
          return { name: series[id].item, slot: slots[id], values: dates.map(function (d) {
            return byDate[id][d] ? byDate[id][d][p.col] : null; }) };
        });
        Charts.responsive(p.chart, function () {
          Charts.line(p.chart, { dates: dates, series: lines, label: T.LABELS[p.col] + ' by day',
                                 fmt: function (v) { return T.fmt(v, p.col); } });
        });
        Charts.tableView(p.table, ['Date'].concat(lines.map(function (l) { return l.name; })), dates.map(function (d, i) {
          return [d].concat(lines.map(function (l) { return T.fmt(l.values[i], p.col); }));
        }));
      });
    }

    function redraw() { drawPicker(); drawCharts(); }
    redraw();
  }

  /* ---------- Part 2: findings ---------- */

  // A section whose heading states a finding, with an explanation, the numbers, and a chart.
  function finding(app, heading, paragraphs, how, drawChart, tableHeaders, tableRows) {
    var card = el('section', { class: 'card' }, [el('h2', { text: heading })]);
    paragraphs.forEach(function (p) { card.appendChild(el('p', { text: p })); });
    card.appendChild(el('p', { class: 'small muted' }, [el('strong', { text: 'How it is computed: ' }), how]));
    if (drawChart) {
      var chart = el('div');
      card.appendChild(chart);
      Charts.responsive(chart, function () { drawChart(chart); });
      if (tableRows && tableRows.length) Charts.tableView(card, tableHeaders, tableRows);
    }
    app.appendChild(card);
  }

  function risersSection(app, rows) {
    var list = T.risers(rows);
    var how = 'For every item with rows on at least two days, take its main value (popularity for TMDB, daily views for Wikipedia) ' +
      'on its first and its latest day in history.csv and compute (latest − first) ÷ first × 100. The chart shows the 5 biggest rises and the 5 biggest falls.';
    if (!list.length) {
      return finding(app, 'Nothing can rise or fall until a second day of data arrives',
        ['Each item has been recorded once so far, so there is no first-to-latest change to measure. This section fills in on its own as the history grows.'], how);
    }
    var top = list[0], bottom = list[list.length - 1];
    function describe(r) {
      return r.item + ' (' + T.LABELS[r.column] + ' ' + T.fmt(r.first, r.column) + ' on ' + r.firstDate + ' → ' + T.fmt(r.last, r.column) + ' on ' + r.lastDate + ', ' + T.pct(r.percent) + ')';
    }
    var shown = list.slice(0, 5);
    list.slice(-5).forEach(function (r) { if (shown.indexOf(r) < 0) shown.push(r); });
    var fell = bottom.percent < 0;
    finding(app, top.item + ' rose the most: ' + T.pct(top.percent) + ' in ' + lower(T.LABELS[top.column]) + ' since ' + top.firstDate,
      ['The biggest rise since the first recorded day is ' + describe(top) + '. ' +
        (fell ? 'The biggest fall is ' + describe(bottom) + '.' : 'No item has fallen: the smallest rise is ' + describe(bottom) + '.') +
        ' Out of ' + plural(list.length, 'item') + ' with at least two days of data, ' + list.filter(function (r) { return r.percent > 0; }).length + ' rose and ' +
        list.filter(function (r) { return r.percent < 0; }).length + ' fell.'],
      how,
      function (chart) {
        Charts.bars(chart, { signed: true, fmt: T.pct, label: 'Percent change from first to latest day',
          rows: shown.map(function (r) { return { label: r.item + ' · ' + T.sourceLabel(r.source), value: r.percent,
            detail: T.LABELS[r.column] + ' ' + T.fmt(r.first, r.column) + ' → ' + T.fmt(r.last, r.column) }; }) });
      },
      ['Item', 'Source', 'Value', 'First day', 'First', 'Latest day', 'Latest', 'Change'],
      shown.map(function (r) { return [r.item, T.sourceLabel(r.source), T.LABELS[r.column], r.firstDate, T.fmt(r.first, r.column), r.lastDate, T.fmt(r.last, r.column), T.pct(r.percent)]; }));
  }

  function daySection(app, rows) {
    var days = T.dayMoves(rows);
    var how = 'For each source, compare every item with the previous day that source has data for and take the absolute percent change of its main value. ' +
      'Then average those changes over all items and sources for each date.';
    if (!days.length) {
      return finding(app, 'The biggest day of movement is still to come',
        ['A day can only be compared with an earlier one, and the history has a single day so far.'], how);
    }
    var best = days[0], quiet = days[0];
    days.forEach(function (d) { if (d.mean > best.mean) best = d; if (d.mean < quiet.mean) quiet = d; });
    finding(app, best.date + ' was the day items moved the most: ' + best.mean.toFixed(1) + '% on average',
      ['On ' + best.date + ', the ' + plural(best.n, 'item comparison') + ' moved ' + best.mean.toFixed(1) + '% on average (ignoring direction). ' +
        (days.length > 1 ? 'The quietest day was ' + quiet.date + ' at ' + quiet.mean.toFixed(1) + '%. ' : '') +
        'The chart covers ' + plural(days.length, 'day') + ' with a comparison.'],
      how,
      function (chart) {
        Charts.columns(chart, { fmt: function (v) { return v.toFixed(1) + '%'; }, label: 'Average absolute move by day',
          items: days.map(function (d) { return { label: d.date, value: d.mean, detail: plural(d.n, 'comparison') }; }) });
      },
      ['Date', 'Average move', 'Comparisons'],
      days.map(function (d) { return [d.date, d.mean.toFixed(1) + '%', String(d.n)]; }));
  }

  function spreadSection(app, rows) {
    var views = T.latestValues(rows, 'views_7d'), pop = T.latestValues(rows, 'popularity');
    var list = views.length >= 2 ? views : pop;
    var column = views.length >= 2 ? 'views_7d' : 'popularity';
    var how = 'Take each item’s latest row in history.csv, sort by ' + lower(T.LABELS[column]) + ', and divide the largest value by the smallest. ' +
      'The median is the middle value of the sorted list.';
    if (list.length < 2) {
      return finding(app, 'There are not enough items yet to measure the spread', ['At least two items with a ' + lower(T.LABELS[column]) + ' value are needed.'], how);
    }
    var top = list[0], low = list[list.length - 1];
    var mid = list.length % 2 ? list[(list.length - 1) / 2].value : (list[list.length / 2 - 1].value + list[list.length / 2].value) / 2;
    var ratio = low.value > 0 ? top.value / low.value : null;
    var heading = ratio === null
      ? top.item + ' leads on ' + lower(T.LABELS[column]) + ' while ' + low.item + ' has none'
      : top.item + ' has ' + ratio.toFixed(1) + '× the ' + lower(T.LABELS[column]) + ' of ' + low.item;
    var paras = ['Across ' + plural(list.length, 'item') + ', ' + lower(T.LABELS[column]) + ' runs from ' + T.fmt(low.value, column) + ' (' + low.item + ') to ' +
      T.fmt(top.value, column) + ' (' + top.item + '), with a median of ' + T.fmt(mid, column) + '.'];
    if (column === 'views_7d' && pop.length >= 2 && pop[pop.length - 1].value > 0) {
      paras.push('Among the TMDB items, popularity ranges from ' + T.fmt(pop[pop.length - 1].value, 'popularity') + ' to ' + T.fmt(pop[0].value, 'popularity') +
        ', a ratio of ' + (pop[0].value / pop[pop.length - 1].value).toFixed(1) + '×.');
    }
    finding(app, heading, paras, how,
      function (chart) {
        Charts.bars(chart, { fmt: function (v) { return T.fmt(v, column); }, label: T.LABELS[column] + ' by item, latest day',
          rows: list.map(function (r) { return { label: r.item, value: r.value, detail: r.date }; }) });
      },
      ['Item', T.LABELS[column], 'Day'],
      list.map(function (r) { return [r.item, T.fmt(r.value, column), r.date]; }));
  }

  function volatilitySection(app, rows) {
    var list = T.volatility(rows);
    var how = 'For each item, take the absolute percent change of its main value between each pair of consecutive rows, then average them. ' +
      'An item needs at least two rows. The chart shows the 8 most volatile items.';
    if (!list.length) {
      return finding(app, 'Volatility needs at least two days of data', ['No item has two rows yet, so no day-to-day change can be averaged.'], how);
    }
    var top = list[0], calm = list[list.length - 1];
    finding(app, top.item + ' is the most volatile: its ' + lower(T.LABELS[top.column]) + ' changes ' + top.mean.toFixed(1) + '% a day on average',
      ['Averaged over ' + plural(top.n, 'day-to-day change') + ', ' + top.item + ' moves ' + top.mean.toFixed(1) + '% a day. The calmest item is ' + calm.item +
        ' at ' + calm.mean.toFixed(1) + '%. Across all ' + plural(list.length, 'item') + ' the typical (median) item moves ' +
        (list.length % 2 ? list[(list.length - 1) / 2].mean : (list[list.length / 2 - 1].mean + list[list.length / 2].mean) / 2).toFixed(1) + '% a day.'],
      how,
      function (chart) {
        Charts.bars(chart, { fmt: function (v) { return v.toFixed(1) + '%'; }, label: 'Average absolute daily change',
          rows: list.slice(0, 8).map(function (r) { return { label: r.item + ' · ' + T.sourceLabel(r.source), value: r.mean, detail: plural(r.n, 'change') }; }) });
      },
      ['Item', 'Source', 'Average daily move', 'Changes averaged'],
      list.slice(0, 8).map(function (r) { return [r.item, T.sourceLabel(r.source), r.mean.toFixed(1) + '%', String(r.n)]; }));
  }

  function turnoverSection(app, rows) {
    var list = T.turnover(rows);
    var how = 'For each source, compare the set of item_ids on a date with the set on that source’s previous date. Items only in the newer set count as entering, ' +
      'items only in the older set count as leaving. Counts are added across sources for each date.';
    if (!list.length) {
      return finding(app, 'List changes can be counted once a second day arrives', ['Entering and leaving items are found by comparing two days.'], how);
    }
    var added = 0, removed = 0, busiest = list[0];
    list.forEach(function (d) { added += d.added; removed += d.removed; if (d.added + d.removed > busiest.added + busiest.removed) busiest = d; });
    finding(app, plural(added, 'item') + ' entered the lists and ' + removed + ' left since the first run',
      ['Across ' + plural(list.length, 'day') + ' with a comparison, ' + plural(added, 'item') + ' appeared and ' + removed + ' disappeared. The busiest day was ' + busiest.date +
        ' with ' + busiest.added + ' entering and ' + busiest.removed + ' leaving. The TMDB trending list changes every day; the Wikipedia list is fixed, so it only changes if a download fails.'],
      how,
      function (chart) {
        Charts.columns(chart, { integer: true, fmt: function (v) { return String(v); }, label: 'Items entering the lists by day',
          items: list.map(function (d) { return { label: d.date, value: d.added, detail: d.removed + ' left' }; }) });
      },
      ['Date', 'Entered', 'Left'],
      list.map(function (d) { return [d.date, String(d.added), String(d.removed)]; }));
  }

  function render(data, app) {
    var a = data.analysis;
    app.appendChild(el('h1', { text: 'Trends' }));
    app.appendChild(el('p', { class: 'muted', text: 'Every number on this page is calculated in your browser from data/history.csv: ' +
      plural(data.rows.length, 'row') + ' covering ' + plural(a.dates.length, 'day') + ' (' + a.firstDate + ' to ' + a.latestDate + '). ' +
      'The page changes as the history grows.' }));
    valuesCharts(app, data);
    app.appendChild(el('h2', { text: 'What the history shows', style: 'margin-top: 24px' }));
    risersSection(app, data.rows);
    daySection(app, data.rows);
    spreadSection(app, data.rows);
    volatilitySection(app, data.rows);
    turnoverSection(app, data.rows);
  }

  T.start('trends', render);
})();
