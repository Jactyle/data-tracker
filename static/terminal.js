/* The command bar and the keyboard shortcuts.
 *
 * Press / (or Ctrl+K, or Cmd+K) on any page and a green prompt opens. Type a command or the start of
 * a film's name, pick from the suggestions with the arrow keys, and press Enter. `help` lists everything.
 *
 *   go today | browse | trends        search <text>          star <film> / unstar <film>
 *   sort <column> [asc|desc]          filter source|year|language <value>
 *   compare <film> vs <film>
 *   shortlist   clear   sound on|off   ripples on|off   replay   install   help
 *
 * Shortcuts (when you are not typing in a box):  /  open the bar    ?  help    g then t, b or h  go to
 * Trends, Browse or Today.  The Browse page adds j and k (move down and up the list) and s (star).
 *
 * The functions at the top (parse, suggest, resolve ...) are plain logic with no page needed, so they
 * can be tested on their own; the part below them builds the bar and runs the commands.
 */
(function (root) {
  'use strict';

  var Tm = {};

  // Look a word up in a table, ignoring things every object inherits (so typing "constructor" finds nothing).
  function own(table, key) { return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined; }

  var PAGES = { today: 'index.html', home: 'index.html', browse: 'browse.html', trends: 'trends.html' };
  var COLUMNS = {
    item: 'item', name: 'item', title: 'item', source: 'source', year: 'release_year', released: 'release_year',
    language: 'original_language', lang: 'original_language', rating: 'rating', votes: 'votes',
    views: 'views', daily: 'views', '7d': 'views_7d', week: 'views_7d', views7: 'views_7d', views_7d: 'views_7d'
  };
  var COLUMN_NAMES = ['item', 'source', 'year', 'language', 'rating', 'votes', 'views', '7d'];

  Tm.COMMANDS = [
    { name: 'go', usage: 'go today | browse | trends', help: 'open a page', args: true },
    { name: 'search', usage: 'search <text>', help: 'find films by name on the Browse page', args: true },
    { name: 'star', usage: 'star <film>', help: 'add a film to your shortlist', args: true },
    { name: 'unstar', usage: 'unstar <film>', help: 'take a film off your shortlist', args: true },
    { name: 'compare', usage: 'compare <film> vs <film>', help: 'compare two films side by side', args: true },
    { name: 'shortlist', usage: 'shortlist', help: 'show only your starred films', args: false },
    { name: 'sort', usage: 'sort <column> [asc|desc]', help: 'sort the Browse page by rating, votes, views, 7d, year ...', args: true },
    { name: 'filter', usage: 'filter source|year|language <value>', help: 'filter the Browse page', args: true },
    { name: 'clear', usage: 'clear', help: 'clear the search and the filters', args: false },
    { name: 'sound', usage: 'sound on | off', help: 'turn all sound on or off', args: true },
    { name: 'ripples', usage: 'ripples on | off', help: 'turn the click effects on or off', args: true },
    { name: 'replay', usage: 'replay', help: 'play the intro again', args: false },
    { name: 'install', usage: 'install', help: 'install this site as an app', args: false },
    { name: 'help', usage: 'help', help: 'list the commands and the keyboard shortcuts', args: false }
  ];
  Tm.SHORTCUTS = [
    ['/  or  Ctrl+K', 'open this command bar'],
    ['?', 'show this help'],
    ['g  then  t / b / h', 'go to Trends / Browse / Today'],
    ['j  and  k', 'Browse: move down and up the list'],
    ['s', 'Browse: star or unstar the chosen film'],
    ['Esc', 'close the bar or the pop-out buttons']
  ];

  /* ---------- plain logic ---------- */

  // Split what was typed into a command word and the rest.
  Tm.parse = function (text) {
    var t = String(text || '').trim();
    if (!t) return { name: '', args: '' };
    var m = t.match(/^(\S+)\s*([\s\S]*)$/);
    return { name: m[1].toLowerCase(), args: m[2].trim() };
  };

  // Films grouped by name (a film can appear once per source), with the item ids behind each name.
  Tm.groups = function (items) {
    var by = {}, order = [];
    (items || []).forEach(function (it) {
      var g = by[it.item];
      if (!g) { g = by[it.item] = { name: it.item, ids: [], sources: [] }; order.push(g); }
      if (g.ids.indexOf(it.item_id) < 0) g.ids.push(it.item_id);
      if (g.sources.indexOf(it.source) < 0) g.sources.push(it.source);
    });
    return order.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
  };

  // Groups whose name matches `text`, best first: the whole name, then the start, then a word start, then anywhere.
  function matchGroups(text, groups) {
    var t = String(text || '').toLowerCase().trim();
    if (!t) return [];
    var ranked = [];
    groups.forEach(function (g) {
      var name = g.name.toLowerCase(), at = name.indexOf(t), rank;
      if (name === t) rank = 0;
      else if (at === 0) rank = 1;
      else if (at > 0 && /[\s:\-(]/.test(name.charAt(at - 1))) rank = 2;
      else if (at > 0) rank = 3;
      else return;
      ranked.push({ g: g, rank: rank });
    });
    ranked.sort(function (a, b) { return a.rank - b.rank || (a.g.name < b.g.name ? -1 : 1); });
    return ranked.map(function (r) { return r.g; });
  }
  Tm.matchGroups = matchGroups;

  // The one film a command means: {group}, or {many: [names]} if it is not clear, or {none: true}.
  Tm.resolve = function (text, groups) {
    var found = matchGroups(text, groups);
    if (!found.length) return { none: true };
    if (found[0].name.toLowerCase() === String(text).trim().toLowerCase() || found.length === 1) return { group: found[0] };
    return { many: found.map(function (g) { return g.name; }) };
  };

  Tm.columnFor = function (word) { return own(COLUMNS, String(word || '').toLowerCase()) || null; };

  function commandSuggestion(c) {
    return { type: 'command', text: c.name + (c.args ? ' ' : ''), label: c.usage, hint: c.help, needsArg: c.args };
  }
  function limit(list) { return list.slice(0, 7); }

  // What to offer under the prompt for what has been typed so far. ctx = {groups, sources, years, languages}.
  Tm.suggest = function (text, ctx) {
    ctx = ctx || { groups: [], sources: [], years: [], languages: [] };
    var raw = String(text || '').replace(/^\s+/, ''), p = Tm.parse(raw), spaced = /\s/.test(raw), out = [];
    if (!p.name) return limit(Tm.COMMANDS.map(commandSuggestion));

    if (!spaced) {                                   // still on the first word
      var t = p.name;
      Tm.COMMANDS.forEach(function (c) { if (c.name.indexOf(t) === 0) out.push(commandSuggestion(c)); });
      ['today', 'browse', 'trends'].forEach(function (page) {
        if (page.indexOf(t) === 0) out.push({ type: 'page', text: 'go ' + page, label: 'go ' + page, hint: 'open the ' + page + ' page' });
      });
      if (t.length >= 2) {
        matchGroups(t, ctx.groups).slice(0, 4).forEach(function (g) {
          out.push({ type: 'item', text: 'search ' + g.name, label: g.name, hint: 'find this film on Browse' });
        });
      }
      return limit(out);
    }

    var cmd = p.name === 'find' || p.name === 'open' ? 'search' : p.name, args = p.args, lower = args.toLowerCase();
    if (cmd === 'go') {
      ['today', 'browse', 'trends'].forEach(function (page) {
        if (!lower || page.indexOf(lower) === 0) out.push({ type: 'page', text: 'go ' + page, label: 'go ' + page, hint: 'open the ' + page + ' page' });
      });
    } else if (cmd === 'search' || cmd === 'star' || cmd === 'unstar') {
      if (cmd === 'search' && args) out.push({ type: 'command', text: 'search ' + args, label: 'search “' + args + '”', hint: 'find it on the Browse page' });
      matchGroups(args, ctx.groups).slice(0, 6).forEach(function (g) {
        out.push({ type: 'item', text: cmd + ' ' + g.name, label: g.name, hint: g.sources.join(' + ') });
      });
    } else if (cmd === 'compare') {
      var versus = args.match(/^(.*?)\s+vs\.?(?:\s+(.*))?$/i);
      if (versus) {                                              // the first film is chosen: suggest the second
        var firstFilm = versus[1].trim(), second = versus[2] || '';
        matchGroups(second, ctx.groups).slice(0, 6).forEach(function (g) {
          out.push({ type: 'item', text: 'compare ' + firstFilm + ' vs ' + g.name, label: firstFilm + ' vs ' + g.name, hint: 'compare these two' });
        });
      } else {
        matchGroups(args, ctx.groups).slice(0, 6).forEach(function (g) {
          out.push({ type: 'item', text: 'compare ' + g.name + ' vs ', label: g.name, hint: 'then type the second film', needsArg: true });
        });
      }
    } else if (cmd === 'sort') {
      var parts = args.split(/\s+/), word = (parts[0] || '').toLowerCase();
      if (parts.length <= 1) {
        COLUMN_NAMES.forEach(function (n) { if (!word || n.indexOf(word) === 0) out.push({ type: 'command', text: 'sort ' + n, label: 'sort ' + n, hint: 'highest first for numbers' }); });
      } else {
        ['asc', 'desc'].forEach(function (d) { if (d.indexOf(parts[1].toLowerCase()) === 0) out.push({ type: 'command', text: 'sort ' + word + ' ' + d, label: 'sort ' + word + ' ' + d, hint: d === 'asc' ? 'lowest first' : 'highest first' }); });
      }
    } else if (cmd === 'filter') {
      var f = args.split(/\s+/), key = (f[0] || '').toLowerCase(), values = { source: ctx.sources, year: ctx.years, language: ctx.languages, lang: ctx.languages };
      var known = own(values, key);
      if (f.length <= 1 && !known) {
        ['source', 'year', 'language'].forEach(function (k) { if (!key || k.indexOf(key) === 0) out.push({ type: 'command', text: 'filter ' + k + ' ', label: 'filter ' + k, hint: 'pick a ' + k, needsArg: true }); });
      } else if (known) {
        var wanted = (f[1] || '').toLowerCase();
        known.forEach(function (v) { if (!wanted || String(v).toLowerCase().indexOf(wanted) === 0) out.push({ type: 'command', text: 'filter ' + key + ' ' + v, label: 'filter ' + key + ' ' + v, hint: 'show only this' }); });
      }
    } else if (cmd === 'sound' || cmd === 'ripples') {
      ['on', 'off'].forEach(function (v) { if (!lower || v.indexOf(lower) === 0) out.push({ type: 'command', text: cmd + ' ' + v, label: cmd + ' ' + v, hint: 'turn ' + (cmd === 'sound' ? 'all sound ' : 'the click effects ') + v }); });
    }
    return limit(out);
  };

  /* ---------- the bar, the shortcuts and running commands ---------- */

  var ctx = { groups: [], sources: [], years: [], languages: [], page: '' };
  var ui = null, isOpen = false, active = 0, current = [], lastFocus = null, pendingG = 0, wired = false, toastTimer = 0;

  function T() { return root.Tracker; }
  function sound(name, arg) { if (root.Sound) root.Sound.play(name, arg, true); }

  function distinct(rows, key) {
    var seen = {}, out = [];
    rows.forEach(function (r) { if (r[key] != null && !seen[r[key]]) { seen[r[key]] = true; out.push(r[key]); } });
    return out.sort();
  }

  // Remember the films on this page (called by every page once its data has loaded) and listen for keys.
  Tm.init = function (data, page) {
    var rows = data && data.analysis ? data.analysis.items.map(function (i) { return i.row; }) : [];
    ctx = { groups: Tm.groups(rows), sources: distinct(rows, 'source'), years: distinct(rows, 'release_year').reverse(),
            languages: distinct(rows, 'original_language'), page: page };
    if (wired) return;
    wired = true;
    document.addEventListener('keydown', onKey);
  };

  function typing(target) {
    var tag = target && target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable);
  }

  function onKey(e) {
    if (isOpen || e.defaultPrevented || document.getElementById('matrix-intro')) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === 'k') { e.preventDefault(); openBar(); return; }
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); openBar(); return; }
    if (e.key === '?') { e.preventDefault(); openBar('help'); return; }
    if (pendingG && Date.now() - pendingG < 1200) {
      pendingG = 0;
      var go = own({ t: 'trends', b: 'browse', h: 'today' }, String(e.key).toLowerCase());
      if (go) { e.preventDefault(); run('go ' + go); }
      return;
    }
    if (e.key === 'g') pendingG = Date.now();
  }

  function toast(message) {
    if (!message) return;
    var node = document.getElementById('toast');
    if (!node) {
      node = T().el('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.classList.add('show');
    if (root.Decode) root.Decode.run(node, { quick: true });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove('show'); }, 2800);
  }
  Tm.toast = toast;

  function build() {
    var t = T();
    var input = t.el('input', { class: 'cmd-input typesound', type: 'text', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'cmd-list',
                                'aria-autocomplete': 'list', 'aria-label': 'Command', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
                                placeholder: 'type a command or a film…' });
    var list = t.el('ul', { id: 'cmd-list', class: 'cmd-list', role: 'listbox', 'aria-label': 'Suggestions' });
    var bar = t.el('div', { id: 'cmdbar', hidden: '' }, [
      t.el('div', { class: 'cmd-backdrop' }),
      t.el('div', { class: 'cmd-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command bar' }, [
        t.el('div', { class: 'cmd-row' }, [t.el('span', { class: 'cmd-prompt', 'aria-hidden': 'true', text: '>' }), input]),
        list,
        t.el('div', { class: 'cmd-hint', text: '↑ ↓ choose · Enter run · Tab complete · Esc close' })
      ])
    ]);
    document.body.appendChild(bar);
    bar.querySelector('.cmd-backdrop').addEventListener('click', closeBar);
    input.addEventListener('input', function () { active = 0; render(); });
    input.addEventListener('keydown', onBarKey);
    ui = { bar: bar, input: input, list: list };
  }

  function render() {
    current = Tm.suggest(ui.input.value, ctx);
    ui.list.textContent = '';
    ui.list.classList.remove('help');
    current.forEach(function (s, i) {
      var li = T().el('li', { class: 'cmd-item' + (i === active ? ' active' : ''), id: 'cmd-opt-' + i, role: 'option', 'aria-selected': String(i === active) }, [
        T().el('span', { class: 'cmd-label', text: s.label }), T().el('span', { class: 'cmd-hintline', text: s.hint || '' })
      ]);
      li.addEventListener('mousemove', function () { if (active !== i) { active = i; markActive(); } });
      li.addEventListener('click', function () { choose(s); });
      ui.list.appendChild(li);
    });
    ui.input.setAttribute('aria-activedescendant', current.length ? 'cmd-opt-' + active : '');
    if (!current.length && ui.input.value.trim()) {
      ui.list.appendChild(T().el('li', { class: 'cmd-empty', text: 'No such command. Press Enter to search the films for “' + ui.input.value.trim() + '”.' }));
    }
  }

  function markActive() {
    Array.prototype.forEach.call(ui.list.querySelectorAll('.cmd-item'), function (li, i) {
      li.classList.toggle('active', i === active);
      li.setAttribute('aria-selected', String(i === active));
    });
    ui.input.setAttribute('aria-activedescendant', current.length ? 'cmd-opt-' + active : '');
    var node = ui.list.querySelector('.cmd-item.active');
    if (node && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
  }

  function choose(s) {
    if (s.needsArg && s.text.slice(-1) === ' ') {          // a command that needs more: fill it in and keep typing
      ui.input.value = s.text;
      active = 0;
      render();
      ui.input.focus();
    } else {
      run(s.text);
    }
  }

  function onBarKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeBar(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!current.length) {                       // the help list has no choices, so the arrows scroll it
        if (ui.list.classList.contains('help')) ui.list.scrollTop += (e.key === 'ArrowDown' ? 1 : -1) * 80;
        return;
      }
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + current.length) % current.length;
      markActive();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (current[active]) { ui.input.value = current[active].text; active = 0; render(); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      var typed = ui.input.value.trim();
      if (current[active] && (!typed || current[active].text.trim() !== typed)) choose(current[active]);
      else if (typed) run(typed);
    }
  }

  function openBar(initial) {
    if (!ui) build();
    lastFocus = document.activeElement;
    isOpen = true;
    ui.bar.hidden = false;
    document.body.classList.add('cmd-open');
    ui.input.value = initial === 'help' ? '' : (initial || '');
    active = 0;
    if (initial === 'help') showHelp(); else render();
    ui.input.focus();
    sound('slide', true);
  }

  function closeBar() {
    if (!isOpen) return;
    isOpen = false;
    ui.bar.hidden = true;
    document.body.classList.remove('cmd-open');
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
    sound('slide', false);
  }
  Tm.close = closeBar;
  Tm.open = openBar;

  function showHelp() {
    ui.list.textContent = '';
    ui.list.classList.add('help');       // the help list is long, so it gets more room
    current = [];
    Tm.COMMANDS.forEach(function (c) {
      ui.list.appendChild(T().el('li', { class: 'cmd-line' }, [T().el('span', { class: 'cmd-label', text: c.usage }), T().el('span', { class: 'cmd-hintline', text: c.help })]));
    });
    Tm.SHORTCUTS.forEach(function (s) {
      ui.list.appendChild(T().el('li', { class: 'cmd-line shortcut' }, [T().el('span', { class: 'cmd-label', text: s[0] }), T().el('span', { class: 'cmd-hintline', text: s[1] })]));
    });
  }

  // Change the Browse view: on the Browse page straight away, otherwise by opening it with that view.
  function applyBrowse(partial) {
    if (root.TrackerBrowse) { root.TrackerBrowse.apply(partial); return; }
    var state = {};
    Object.keys(T().BROWSE_DEFAULT).forEach(function (k) { state[k] = T().BROWSE_DEFAULT[k]; });
    Object.keys(partial).forEach(function (k) { state[k] = partial[k]; });
    T().navigate('browse.html' + T().formatBrowseState(state));
  }

  // Run a command and say what happened. Returns the message (also shown as a toast).
  function execute(text) {
    var p = Tm.parse(text), name = p.name, args = p.args;
    if (!name) return '';
    if (own(PAGES, name) && !args) { args = name; name = 'go'; }
    if (name === 'find' || name === 'open') name = 'search';
    var t = T();

    if (name === 'go') {
      var page = own(PAGES, args.toLowerCase());
      if (!page) return 'Pages: today, browse, trends';
      t.navigate(page);
      return 'Opening ' + args.toLowerCase() + '…';
    }
    if (name === 'search') {
      if (!args) return 'Type what to search for, like: search avatar';
      applyBrowse({ q: args });
      return 'Searching for “' + args + '”';
    }
    if (name === 'star' || name === 'unstar') {
      if (!args) return 'Type a film, like: ' + name + ' sinners';
      var found = Tm.resolve(args, ctx.groups);
      if (found.none) return 'No film matches “' + args + '”';
      if (found.many) return found.many.length + ' films match: ' + found.many.slice(0, 3).join(', ') + (found.many.length > 3 ? '…' : '') + '. Be more specific.';
      var saved = t.getShortlist(), ids = found.group.ids, want = name === 'star';
      ids.forEach(function (id) {
        var at = saved.indexOf(id);
        if (want && at < 0) saved.push(id);
        if (!want && at >= 0) saved.splice(at, 1);
      });
      t.setShortlist(saved);
      if (root.TrackerBrowse) root.TrackerBrowse.refresh();
      sound('star', want);
      return (want ? 'Starred ' : 'Removed from your shortlist: ') + found.group.name;
    }
    if (name === 'compare') {
      var pair = args.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
      if (!pair) return 'Try: compare inception vs oppenheimer';
      var first = Tm.resolve(pair[1], ctx.groups), other = Tm.resolve(pair[2], ctx.groups);
      var trouble = [[first, pair[1]], [other, pair[2]]].map(function (x) {
        return x[0].none ? 'No film matches “' + x[1].trim() + '”'
             : x[0].many ? x[0].many.length + ' films match “' + x[1].trim() + '”: ' + x[0].many.slice(0, 3).join(', ') + '…. Be more specific.' : '';
      }).filter(Boolean)[0];
      if (trouble) return trouble;
      if (first.group.name === other.group.name) return 'Pick two different films to compare';
      if (root.TrackerCompare) { root.TrackerCompare.set(first.group.name, other.group.name); return 'Comparing ' + first.group.name + ' with ' + other.group.name; }
      t.navigate('trends.html' + t.mergeQuery('', { compare: first.group.name + '~' + other.group.name }));
      return 'Opening the comparison…';
    }
    if (name === 'shortlist') { applyBrowse({ starred: true }); return 'Showing your shortlist'; }
    if (name === 'clear') { applyBrowse({ reset: true }); return 'Cleared the search and filters'; }
    if (name === 'sort') {
      var words = args.split(/\s+/), column = Tm.columnFor(words[0]);
      if (!column) return 'Sort by: ' + COLUMN_NAMES.join(', ');
      var numeric = t.NUMERIC.indexOf(column) >= 0 || column === 'release_year';
      var dir = /^asc/i.test(words[1] || '') ? 1 : /^desc/i.test(words[1] || '') ? -1 : (numeric ? -1 : 1);
      applyBrowse({ sort: column, dir: dir });
      return 'Sorted by ' + words[0].toLowerCase() + (dir > 0 ? ' (lowest first)' : ' (highest first)');
    }
    if (name === 'filter') {
      var f = args.split(/\s+/), key = (f[0] || '').toLowerCase(), value = f.slice(1).join(' ');
      var field = own({ source: 'source', year: 'year', language: 'language', lang: 'language' }, key);
      if (!field || !value) return 'Try: filter source imdb, filter year 2025, filter language en';
      var pool = { source: ctx.sources, year: ctx.years, language: ctx.languages }[field].map(String);
      var hit = pool.filter(function (v) { return v.toLowerCase() === value.toLowerCase(); })[0];
      if (!hit) return 'No ' + field + ' “' + value + '”. Options: ' + pool.join(', ');
      var partial = {};
      partial[field] = hit;
      applyBrowse(partial);
      return 'Filtering by ' + field + ' ' + hit;
    }
    if (name === 'sound') {
      var turnOn = /^(on|1|yes)$/i.test(args) ? true : /^(off|0|no)$/i.test(args) ? false : !root.Sound.enabled();
      if (root.Sound.enabled() !== turnOn) root.Sound.toggle();
      return 'Sound is ' + (turnOn ? 'on' : 'off');
    }
    if (name === 'ripples') {
      var effects = /^(on|1|yes)$/i.test(args) ? true : /^(off|0|no)$/i.test(args) ? false : !(root.Ripple && root.Ripple.enabled());
      if (root.Ripple) root.Ripple.setEnabled(effects);
      return 'Click effects are ' + (effects ? 'on' : 'off');
    }
    if (name === 'replay') { if (root.Matrix) root.Matrix.replayIntro(); return ''; }
    if (name === 'install') {
      if (t.canInstall()) { t.install(); return 'Choose Install in the prompt'; }
      return 'Install: in Safari use Share, then Add to Dock (or Add to Home Screen); in other browsers look for the install icon in the address bar. Already installed?';
    }
    if (name === 'help') return null;
    // anything else is taken as a film name to look for
    applyBrowse({ q: text.trim() });
    return 'No such command, so searching for “' + text.trim() + '”';
  }

  function run(text) {
    if (Tm.parse(text).name === 'help') {
      if (!isOpen) openBar('help'); else { ui.input.value = ''; showHelp(); }
      return;
    }
    var message = execute(text);
    sound('select');
    if (isOpen) closeBar();
    toast(message);
  }
  Tm.run = run;

  root.Terminal = Tm;
  if (typeof module !== 'undefined' && module.exports) module.exports = Tm;
})(typeof window !== 'undefined' ? window : globalThis);
