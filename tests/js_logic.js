// Run by tests/test_js_logic.py with node or jsc: runs the plain logic of lib.js, decode.js and
// terminal.js on fixed inputs and prints the results as JSON.
var isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
var base = isNode ? process.argv[2] : arguments[0];
function loadScript(name) { var p = base + '/static/' + name; if (isNode) require(require('path').resolve(p)); else load(p); }
var store = {};      // a stand-in for the browser's localStorage
Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: {
  getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } } });
loadScript('lib.js'); loadScript('decode.js'); loadScript('terminal.js'); loadScript('cloud.js'); loadScript('compare.js'); loadScript('ripple.js');
var T = globalThis.Tracker, D = globalThis.Decode, Tm = globalThis.Terminal, Cl = globalThis.Cloud, Cmp = globalThis.Compare, Rp = globalThis.Ripple;

var out = {};
out.parseEmpty = T.parseBrowseState('');
out.parseFull = T.parseBrowseState('?q=Sin%20ners&source=imdb&language=en&year=2025&starred=1&sort=votes&dir=asc');
out.parseNumberSort = T.parseBrowseState('?sort=rating');
out.parseTextSort = T.parseBrowseState('?sort=source');
out.parseBadSort = T.parseBrowseState('?sort=evil&dir=asc&unknown=1');
out.parsePlus = T.parseBrowseState('?q=a+b%26c');
out.parseBroken = T.parseBrowseState('?q=%E0%A4%A&source=imdb');
out.formatDefault = T.formatBrowseState(T.parseBrowseState(''));
out.roundTrip = T.formatBrowseState(T.parseBrowseState('?q=Sin%20ners&source=imdb&starred=1&sort=votes&dir=asc'));
out.formatSpecial = T.formatBrowseState({ q: 'a b&c=d', source: '', language: '', year: '', starred: false, sort: 'item', dir: 1 });
out.specialBack = T.parseBrowseState(out.formatSpecial).q;
out.longQuery = T.parseBrowseState('?q=' + new Array(501).join('x')).q.length;
out.items = T.parseItemsParam('?items=imdb%3Att1%2Cwikipedia%3AInception');
out.itemsFormat = T.formatItemsParam(['imdb:tt1', 'wikipedia:Inception']);
out.itemsEmpty = T.formatItemsParam([]);
out.itemsMax = T.parseItemsParam('?items=' + encodeURIComponent('a,b,c,d,e,f,g,h,i,j')).length;

var seed = 7;
function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
out.decode = { zero: D.frame('Sinners 2025', 0, rnd), full: D.frame('Sinners 2025', 1, rnd), mid: D.frame('Sinners 2025', 0.5, rnd),
               spaces: D.frame('a b c', 0, rnd), empty: D.frame('', 0.3, rnd) };

var rows = [
  { item_id: 'imdb:tt1', item: 'Sinners', source: 'imdb' }, { item_id: 'wikipedia:Sinners', item: 'Sinners', source: 'wikipedia' },
  { item_id: 'imdb:tt2', item: 'Avatar: Fire and Ash', source: 'imdb' }, { item_id: 'wikipedia:Avatar', item: 'Avatar: Fire and Ash', source: 'wikipedia' },
  { item_id: 'wikipedia:Avengers', item: 'Avengers: Doomsday', source: 'wikipedia' }, { item_id: 'imdb:tt3', item: 'The Odyssey', source: 'imdb' },
  { item_id: 'imdb:tt4', item: 'Superman', source: 'imdb' }
];
var groups = Tm.groups(rows);
var ctx = { groups: groups, sources: ['imdb', 'wikipedia'], years: [2026, 2025], languages: ['en', 'ko'] };
function texts(list) { return list.map(function (s) { return s.text; }); }
out.parse = [Tm.parse('  Star   Sinners '), Tm.parse(''), Tm.parse('TRENDS')];
out.groupNames = groups.map(function (g) { return g.name; });
out.sinnersIds = groups.filter(function (g) { return g.name === 'Sinners'; })[0].ids;
out.resolve = { exact: Tm.resolve('sinners', groups), many: Tm.resolve('av', groups), none: Tm.resolve('zzz', groups), single: Tm.resolve('odys', groups) };
out.suggest = {
  empty: texts(Tm.suggest('', ctx)), so: texts(Tm.suggest('so', ctx)), tr: texts(Tm.suggest('tr', ctx)),
  starSin: texts(Tm.suggest('star sin', ctx)), sortV: texts(Tm.suggest('sort v', ctx)), filterSource: texts(Tm.suggest('filter source ', ctx)),
  filterY: texts(Tm.suggest('filter y', ctx)), soundO: texts(Tm.suggest('sound o', ctx)), nothing: texts(Tm.suggest('zzzz', ctx)),
  avatar: texts(Tm.suggest('avatar', ctx)), goB: texts(Tm.suggest('go b', ctx)), noContext: texts(Tm.suggest('star x'))
};
out.columns = [Tm.columnFor('7d'), Tm.columnFor('Rating'), Tm.columnFor('year'), Tm.columnFor('nonsense')];
out.inherited = { column: ['constructor', 'toString', '__proto__'].map(function (w) { var v = Tm.columnFor(w); return v === null ? 'null' : typeof v; }),
                  filter: texts(Tm.suggest('filter constructor ', ctx)), filterKey: texts(Tm.suggest('filter toString', ctx)) };
function shortlistFrom(raw) { store['movie-tracker.shortlist'] = raw; return T.getShortlist(); }
out.shortlist = { fine: shortlistFrom('["imdb:tt1","wikipedia:Sinners"]'), nothing: (delete store['movie-tracker.shortlist'], T.getShortlist()),
                  isNull: shortlistFrom('null'), isObject: shortlistFrom('{"a":1}'), isText: shortlistFrom('"imdb:tt1"'),
                  mixed: shortlistFrom('[1,"imdb:tt1",null,{"x":1}]'), garbage: shortlistFrom('not json') };
// the film cloud
var filmRows = [
  { item_id: 'imdb:a', item: 'Alpha', source: 'imdb', rating: 5.0, votes: 100 }, { item_id: 'imdb:b', item: 'Beta', source: 'imdb', rating: 7.0, votes: 1000 },
  { item_id: 'imdb:c', item: 'Gamma', source: 'imdb', rating: 9.0, votes: 10000 }, { item_id: 'imdb:d', item: 'Delta', source: 'imdb', rating: null, votes: 50 }
];
var cloud = Cl.build('imdb', filmRows, { growth: { 'imdb:a': 10, 'imdb:c': 30 } });
function byName(c, n) { return c.points.filter(function (p) { return p.name === n; })[0]; }
out.cloud = {
  names: cloud.points.map(function (p) { return p.name; }), skipped: cloud.skipped.map(function (s) { return s.name; }), thirdKnown: cloud.thirdKnown,
  ratingEnds: [byName(cloud, 'Alpha').pos[0], byName(cloud, 'Gamma').pos[0]], votesMiddle: byName(cloud, 'Beta').pos[1],
  growthEnds: [byName(cloud, 'Alpha').pos[2], byName(cloud, 'Gamma').pos[2]], unknownThird: [byName(cloud, 'Beta').pos[2], byName(cloud, 'Beta').thirdKnown],
  logRange: [cloud.axes[1].lo, cloud.axes[1].hi],
  sameRating: Cl.build('imdb', [{ item_id: 'x', item: 'X', rating: 7, votes: 5 }, { item_id: 'y', item: 'Y', rating: 7, votes: 50 }], {}).points.map(function (p) { return p.pos[0]; }),
  noSource: Cl.build('nothing', filmRows, {}).points.length,
  rank: (function () {
    var many = [{ item_id: 'a', item: 'A', rating: 1, votes: 10 }, { item_id: 'b', item: 'B', rating: 7, votes: 100 }, { item_id: 'c', item: 'C', rating: 7, votes: 1000 }, { item_id: 'd', item: 'D', rating: 9, votes: 100000 }];
    var c = Cl.build('imdb', many, {}, 'rank');
    return { mode: c.spacing, rating: c.points.map(function (p) { return p.pos[0]; }), votes: c.points.map(function (p) { return p.pos[1]; }), third: c.points.map(function (p) { return p.pos[2]; }),
             one: Cl.build('imdb', [many[0]], {}, 'rank').points[0].pos, trueMode: Cl.build('imdb', many, {}).spacing };
  })(),
  wiki: Cl.build('wikipedia', [{ item_id: 'w1', item: 'W1', views: 0, views_7d: 700 }, { item_id: 'w2', item: 'W2', views: 10, views_7d: 70 }, { item_id: 'w3', item: 'W3', views: 5, views_7d: null }],
                 { spike: { w1: 0.5, w2: 1.4 }, change: { w1: -10 } }),
  center: Cl.project([0, 0, 0], { yaw: 0, pitch: 0 }, { w: 600, h: 400 }),
  right: Cl.project([1, 0, 0], { yaw: 0, pitch: 0 }, { w: 600, h: 400 }),
  up: Cl.project([0, 1, 0], { yaw: 0, pitch: 0 }, { w: 600, h: 400 }),
  near: Cl.project([0, 0, 1], { yaw: 0, pitch: 0 }, { w: 600, h: 400 }),
  far: Cl.project([0, 0, -1], { yaw: 0, pitch: 0 }, { w: 600, h: 400 }),
  quarterTurn: Cl.project([1, 0, 0], { yaw: Math.PI / 2, pitch: 0 }, { w: 600, h: 400 }),
  nearest: [Cl.nearest([{ x: 10, y: 10, r: 5 }, { x: 100, y: 100, r: 5 }], 98, 103, 18), Cl.nearest([{ x: 10, y: 10, r: 5 }], 200, 200, 18),
            Cl.nearest([{ x: 10, y: 10, r: 5 }, { x: 14, y: 10, r: 5 }], 13, 10, 18), Cl.nearest([], 1, 1, 18)],
  step: [Cl.step(5, -1, 1), Cl.step(5, -1, -1), Cl.step(5, 4, 1), Cl.step(5, 0, -1), Cl.step(0, -1, 1)],
  tip: [Cl.placeTip(100, 600, 200, 10), Cl.placeTip(500, 600, 200, 10), Cl.placeTip(150, 340, 220, 10)],
  pitch: [Cl.clampPitch(5), Cl.clampPitch(-5), Cl.clampPitch(0.3)]
};
// the cloud over time: three days, two films, one of them new on the last day
function dayRows(date, a, b, c) {
  var rows = [{ date: date, item_id: 'imdb:a', item: 'Alpha', source: 'imdb', rating: 6, votes: a }, { date: date, item_id: 'imdb:b', item: 'Beta', source: 'imdb', rating: 8, votes: b }];
  if (c) rows.push({ date: date, item_id: 'imdb:c', item: 'Gamma', source: 'imdb', rating: 7, votes: c });
  return rows;
}
var history = dayRows('2026-11-01', 100, 1000).concat(dayRows('2026-11-02', 200, 1000), dayRows('2026-11-03', 400, 1000, 50));
var timeData = { rows: history, analysis: T.analyze(history), status: null };
var line = Cl.timeline('imdb', timeData, 'true');
function posOf(model, id) { return model.points.filter(function (p) { return p.id === id; })[0]; }
out.timeline = {
  dates: line.dates, counts: line.models.map(function (m) { return m.points.length; }), thirdKnown: line.models.map(function (m) { return m.thirdKnown; }),
  ranges: line.ranges.map(function (r) { return [r.lo, r.hi]; }),
  sameAxesEveryDay: line.models.every(function (m) { return m.axes.every(function (a, k) { return a.lo === line.ranges[k].lo && a.hi === line.ranges[k].hi; }); }),
  alphaVotesY: line.models.map(function (m) { return Math.round(posOf(m, 'imdb:a').pos[1] * 1000) / 1000; }),
  betaVotesY: line.models.map(function (m) { return Math.round(posOf(m, 'imdb:b').pos[1] * 1000) / 1000; }),
  pathLengths: { a: line.paths['imdb:a'].length, c: line.paths['imdb:c'].length }, pathDaysOfC: line.paths['imdb:c'].map(function (s) { return s.day; }),
  lastDayThirdForAlpha: posOf(line.models[2], 'imdb:a').values[2],
  rankMode: Cl.timeline('imdb', timeData, 'rank').models.map(function (m) { return m.spacing; }),
  none: Cl.timeline('wikipedia', timeData, 'true').dates
};
out.ease = [Cl.ease(0, 1, 0, 0.2), Cl.ease(0, 1, 0.2, 0.2), Cl.ease(0, 1, 100, 0.2), Cl.ease(5, 5, 1, 0.2)];
// comparing two films
function crow(date, id, item, source, extra) { return Object.assign({ date: date, item_id: id, item: item, source: source }, extra); }
var cmpRows = [
  crow('2026-11-01', 'imdb:a', 'Alpha', 'imdb', { rating: 6.0, votes: 100 }), crow('2026-11-02', 'imdb:a', 'Alpha', 'imdb', { rating: 6.5, votes: 300 }),
  crow('2026-11-01', 'wikipedia:Alpha', 'Alpha', 'wikipedia', { views: 1000, views_7d: 6000 }), crow('2026-11-02', 'wikipedia:Alpha', 'Alpha', 'wikipedia', { views: 1500, views_7d: 7000 }),
  crow('2026-11-01', 'imdb:b', 'Beta', 'imdb', { rating: 7.0, votes: 200 }), crow('2026-11-02', 'imdb:b', 'Beta', 'imdb', { rating: 7.0, votes: 250 }),
  crow('2026-11-02', 'wikipedia:Gamma', 'Gamma', 'wikipedia', { views: 500, views_7d: 3000 }),
  crow('2026-11-02', 'imdb:constructor', 'constructor', 'imdb', { rating: 5, votes: 10 })
];
var cmpFilms = Cmp.films(cmpRows), cmpSeries = T.itemSeries(cmpRows);
function filmNamed(n) { return cmpFilms.filter(function (f) { return f.name === n; })[0]; }
var statsOf = {}; cmpFilms.forEach(function (f) { statsOf[f.name] = Cmp.stats(f, cmpSeries); });
var ab = Cmp.compare(statsOf.Alpha, statsOf.Beta), bg = Cmp.compare(statsOf.Beta, statsOf.Gamma);
var level = Cmp.compare({ rating: 7, votes: 5, growth: null, views: null, views_7d: null, viewsChange: null }, { rating: 7, votes: 5, growth: null, views: null, views_7d: null, viewsChange: null });
out.compare = {
  films: cmpFilms.map(function (f) { return f.name + ':' + f.ids.length + ':' + f.sources.join('+'); }),
  alpha: statsOf.Alpha, beta: statsOf.Beta, gamma: statsOf.Gamma,
  ab: ab.map(function (r) { return [r.key, r.lead, r.gap === null ? null : Math.round(r.gap * 1000) / 1000, r.how]; }),
  gapTexts: ab.map(Cmp.gapText), levelLeads: level.map(function (r) { return r.lead; }), levelText: Cmp.gapText(level[0]),
  pointsGap: Cmp.gapText({ lead: 'a', gap: 12.54, how: 'diff', percent: true }),
  findingAB: Cmp.finding('Alpha', 'Beta', ab), findingBG: Cmp.finding('Beta', 'Gamma', bg),
  levelHeading: Cmp.finding('Alpha', 'Beta', Cmp.compare({ rating: 6, votes: 10, growth: null, views: null, views_7d: null, viewsChange: null },
                                                       { rating: 7, votes: 5, growth: null, views: null, views_7d: null, viewsChange: null })).heading,
  defaults: Cmp.defaults(cmpFilms, statsOf), defaultsOne: Cmp.defaults([cmpFilms[0]], statsOf),
  defaultsWikiOnly: Cmp.defaults([filmNamed('Gamma'), filmNamed('Alpha')].map(function (f) { return f; }), { Gamma: statsOf.Gamma, Alpha: { votes: null, views_7d: 99999 } }),
  parse: [Cmp.parse('?compare=Alpha~Beta'), Cmp.parse('?compare=Alpha'), Cmp.parse('?compare=~Beta'), Cmp.parse(''), Cmp.parse('?compare=Dune%3A%20Part%20Two~Sinners')],
  merged: T.mergeQuery('', { compare: Cmp.format('Dune: Part Two', 'Sinners') }),
  keeps: T.mergeQuery('?items=a%2Cb&x=1', { compare: 'A~B' }), removes: T.mergeQuery('?items=a%2Cb&x=1', { items: '' }), nothing: T.mergeQuery('?x=1', {}), empty: T.mergeQuery('', {}),
  suggest: { start: texts(Tm.suggest('compare sin', ctx)), second: texts(Tm.suggest('compare Sinners vs av', ctx)), blank: texts(Tm.suggest('compare Sinners vs ', ctx)),
             ripples: texts(Tm.suggest('ripples o', ctx)), word: texts(Tm.suggest('comp', ctx)) }
};

// click ripples
function seeded(n) { var s = n; return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
function dot(p, ox, oy) { return (p.x - ox) * p.vx + (p.y - oy) * p.vy; }
var ripple = Rp.spawn('ripple', 100, 50, seeded(3)), glyphs = ripple.filter(function (p) { return p.kind === 'glyph'; });
var moved = Rp.step(Rp.spawn('ripple', 100, 50, seeded(3)), 0.1), movedGlyphs = moved.filter(function (p) { return p.kind === 'glyph'; });
var on = Rp.spawn('star-on', 200, 80, seeded(5)), onGlyphs = on.filter(function (p) { return p.kind === 'glyph'; });
var off = Rp.spawn('star-off', 200, 80, seeded(9)).filter(function (p) { return p.kind === 'glyph'; });
var waiting = { kind: 'glyph', x: 0, y: 0, vx: 0, vy: 0, age: 0, delay: 0.2, ttl: 0.5, alpha: 1, drag: 0 };
var big = []; for (var q = 0; q < 200; q++) big.push({ id: q });
var aged = { kind: 'glyph', seed: 5, age: 0 }, later = { kind: 'glyph', seed: 5, age: 0.5 };
out.ripple = {
  counts: [glyphs.length, ripple.length - glyphs.length], startsAtClick: glyphs.every(function (p) { return p.x === 100 && p.y === 50; }),
  speeds: glyphs.map(function (p) { return Math.hypot(p.vx, p.vy); }).reduce(function (m, v) { return [Math.min(m[0], v), Math.max(m[1], v)]; }, [1e9, 0]),
  ttls: glyphs.map(function (p) { return p.ttl; }).reduce(function (m, v) { return [Math.min(m[0], v), Math.max(m[1], v)]; }, [1e9, 0]),
  movesOutward: movedGlyphs.length === 14 && movedGlyphs.every(function (p) { return dot(p, 100, 50) > 0; }),
  ringGrows: moved.filter(function (p) { return p.kind === 'ring'; })[0].r,
  allGoneAfterASecond: Rp.step(ripple, 1).length,
  starOn: { glyphs: onGlyphs.length, allFall: onGlyphs.every(function (p) { return p.vy > 0; }), xSpread: onGlyphs.every(function (p) { return Math.abs(p.x - 200) < 20; }),
            staggered: onGlyphs.some(function (p) { return p.delay > 0.1; }), hasRing: on.length - onGlyphs.length },
  starOff: { glyphs: off.length, allInward: off.every(function (p) { return dot(p, 200, 80) < 0; }) },
  fade: [Rp.fade({ delay: 0, age: 0, ttl: 0.5, alpha: 1 }), Rp.fade({ delay: 0, age: 0.5, ttl: 0.5, alpha: 1 }), Rp.fade(waiting), Rp.fade({ delay: 0, age: 0.25, ttl: 0.5, alpha: 0.5 })],
  waitingStays: Rp.step([waiting], 0.1).length === 1 && Rp.step([waiting], 0.1)[0].delay < 0.2,
  cap: [Rp.cap(big, 160).length, Rp.cap(big, 160)[0].id, Rp.cap(big.slice(0, 5), 160).length],
  glyph: [Rp.glyphAt(aged).length, Rp.glyphAt(aged) !== Rp.glyphAt(later)], max: Rp.MAX
};
var json = JSON.stringify(out);
if (isNode) console.log(json); else print(json);
