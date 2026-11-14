// Run by tests/test_js_parity.py with node or jsc: prints what static/lib.js makes of a history file.
var isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
var argv = isNode ? process.argv.slice(2) : Array.prototype.slice.call(arguments);
var text = isNode ? require('fs').readFileSync(argv[0], 'utf8') : read(argv[0]);
var T;
if (isNode) { T = require(require('path').resolve(argv[1])); }
else { load(argv[1]); T = globalThis.Tracker; }
var rows = T.parseHistory(text), a = T.analyze(rows);
var out = JSON.stringify({ rows: rows, latestDate: a.latestDate, moves: a.moves,
                           newItems: a.newItems, goneItems: a.goneItems, stale: a.staleSources });
if (isNode) console.log(out); else print(out);
