// Run by tests/test_js_logic.py with node or jsc: runs the plain logic of lib.js, decode.js and
// terminal.js on fixed inputs and prints the results as JSON.
var isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
var base = isNode ? process.argv[2] : arguments[0];
function loadScript(name) { var p = base + '/static/' + name; if (isNode) require(require('path').resolve(p)); else load(p); }
var store = {};      // a stand-in for the browser's localStorage
globalThis.localStorage = { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); } };
loadScript('lib.js'); loadScript('decode.js'); loadScript('terminal.js');
var T = globalThis.Tracker, D = globalThis.Decode, Tm = globalThis.Terminal;

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
var json = JSON.stringify(out);
if (isNode) console.log(json); else print(json);
