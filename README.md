# Movie Tracker

![Tests](https://github.com/Jactyle/data-tracker/actions/workflows/tests.yml/badge.svg)

Every day, on its own, this tool downloads the latest numbers for a set of movies, adds them to a history with one row per item per day, reports what moved, and publishes the result to a website.

- **Live site:** https://jactyle.github.io/data-tracker/

A GitHub Actions workflow runs `python -m tracker.run` once a day. The site is three static pages (Today, Browse, Trends) that load `data/history.csv` and `data/status.json` in the browser and do all calculations there. The site is installable as an app and opens offline with the last data it loaded.

## Sources

| Source | Format | What it gives | Items |
| --- | --- | --- | --- |
| **IMDb ratings** (`https://datasets.imdbws.com/title.ratings.tsv.gz`, IMDb's non-commercial datasets, refreshed daily) | TSV (`imdb.tsv.gz`) | `averageRating` and `numVotes` per title | The file holds about 1.7 million titles (8.7 MB). The pipeline downloads it and **keeps only the header and the rows of the 24 films in `FILMS` in `tracker/sources/imdb.py`** (the 24 films from 2025 and 2026 with the most votes when the list was made; ids, titles and years are IMDb's own). The raw file is that small TSV. |
| **Wikipedia pageviews** (Wikimedia REST API, `…/metrics/pageviews/per-article/en.wikipedia/all-access/user/<article>/daily/<start>/<end>`) | JSON (`wikipedia.json.gz`) | Daily views of a film's English Wikipedia article | A fixed list of 18 films (`FILMS` in `tracker/sources/wikipedia.py`). One request per film for the 7 days before the run; the raw file holds all the responses in one JSON object. |

Neither source needs a login or a key. Both lists are fixed, so to track other films edit `FILMS` in the source file; rows already in the history stay.

A source that fails writes no raw file that day and does not stop the run. Wikipedia is slow to answer when asked quickly, so requests are spaced 1.5 s apart, retried with a growing wait on HTTP 429, and a film that still fails gets one more try at the end. The Wikipedia source fails if no film could be downloaded, or if none of them has data for yesterday yet (the API leaves out days it does not have, which would otherwise be recorded as 0 views). That is why the daily run is scheduled in the afternoon, UTC. The IMDb source fails if the download is not the expected file or none of the tracked films is in it.

## How a run works

`python -m tracker.run`:

1. Calls every source and saves what it returned, gzipped and in the format it came in, as `data/raw/<date>/<source>.<format>.gz`. The date is the UTC date of the moment the run starts. A response is only saved if it can be converted to rows. The result of every source (success or failure, item count, error message) goes in `data/source_log.csv`.
2. Builds `data/history.csv` from the raw files alone (see below).
3. Writes `data/status.json`, and the Atom feed `feed.xml` (see below).

Then the workflow runs `python -m tracker.issues`, which opens a GitHub Issue titled with the date (for example `2026-11-14`) listing the biggest moves and any item that appeared or disappeared, and closes the previous day's issue. The issue is opened every day, even with no changes. The workflow then commits `data/` to the repository.

A **second run on the same day** replaces that day's raw files, rebuilds the history, and updates that day's issue (the same issue, found by its title), so each day counts once. If a source fails in the second run, the raw file from the earlier run that day is kept, so no good data is lost; the failure is still recorded in the status file and the log.

A **successful run** is a run that finishes and commits, even when some sources failed.

### The Atom feed

`feed.xml` (at the top of the site, https://jactyle.github.io/data-tracker/feed.xml) is an Atom feed with one entry per day for the last 30 days: that day's biggest moves, and the items that appeared or disappeared, found with the same move rule as the daily issue. Subscribe to it in any feed reader to be told about each day's changes. It is written from `data/history.csv` alone at the end of every run, so building it again gives the same file; `python -m tracker.feed` rebuilds it by hand.

### Build the history from the raw files

```
python -m tracker.build
```

This reads every file in `data/raw/`, converts each day's files to rows with the one common set of columns, and writes `data/history.csv` sorted by `date`, then `item_id`. The file depends on the raw files alone, so running the command again gives the same bytes, and a change to a conversion rule applies to every day. A day with no raw file for a source has no rows from that source. A raw file that cannot be read is skipped with a message. To check that the committed history is what a rebuild produces:

```
python -m tracker.build --check
```

## Data files

### `data/history.csv`

One row per item per day. `date`, `item_id`, `item` and `source` come first. A value a source does not report for an item is left empty.

| Column | Meaning | Unit |
| --- | --- | --- |
| `date` | The UTC date of the run that saved the raw file | `YYYY-MM-DD` |
| `item_id` | The key that lines the same item up from day to day: `imdb:<IMDb id>` (e.g. `imdb:tt1757678`) or `wikipedia:<article title with underscores>` | text |
| `item` | The movie's name | text |
| `source` | Which source the row came from: `imdb` or `wikipedia` | text |
| `rating` | IMDb's weighted average of all user ratings for the film on that day. Empty for Wikipedia rows. | points, 0 to 10 |
| `votes` | Number of user votes IMDb has received for the film (it only grows). Empty for Wikipedia rows. | votes |
| `views` | Views of the film's English Wikipedia article on the UTC day before the run date (a day the API leaves out had no views and counts as 0). Empty for IMDb rows. | page views |
| `views_7d` | Sum of the article's views over the 7 UTC days before the run date. Empty for IMDb rows. | page views |
| `release_year` | Year the film was released (IMDb's start year; fixed in the film list for Wikipedia). Empty if unknown. | year |
| `original_language` | Original language of the film. Only the Wikipedia film list gives it, so it is empty for IMDb rows. | ISO 639-1 code, e.g. `en` |

### `data/status.json`

Describes the latest run.

| Key | Meaning |
| --- | --- |
| `run_time` | When the run happened, in UTC (`YYYY-MM-DDTHH:MM:SSZ`) |
| `first_run_date` | The date of the earliest raw file |
| `days_with_success` | The number of different dates that have a raw file |
| `items` | The number of items (rows) in the latest run |
| `new_today` | The number of items that appeared (in today's run but not in the source's previous run) |
| `gone_today` | The number of items that disappeared (in the previous run but not today) |
| `sources` | One entry per source: `name`, `ok` (true or false) and `count` (items from that source in this run, 0 on failure) |

On the first day there is no previous run, so `new_today` and `gone_today` are 0. Both film lists are fixed, so they stay 0 unless a download leaves a film out or the list is edited. A source that failed today is not compared, so its items do not count as disappeared.

### `data/source_log.csv`

One row per source per day: `date`, `run_time`, `source`, `ok`, `count`, `error`. It is the long-term record of failures. A second run on the same day replaces that day's rows.

## The move rule

For each source that has rows on the run date:

1. The **previous run** is the latest earlier date that has rows from the same source.
2. The **main value** is `votes` for IMDb and `views` for Wikipedia.
3. An item that is in both days has a **move** of `(new − old) ÷ old × 100`, in percent. The old value must be above 0 and both values must exist, otherwise the item is not ranked.
4. The **5 items with the largest absolute move** are listed from each source (so up to 10 in total), largest first, ties broken by `item_id`.
5. An item only in the run date has **appeared**; an item only in the previous run has **disappeared**.
6. A source with no rows on the run date (it failed) is skipped. A source with no earlier run has nothing to compare yet.

The rule lives in `tracker/moves.py` (used for the issue and the status file) and is repeated in `static/lib.js` (used by the Today page); the tests cover the Python version.

## Site

| Page | What it shows |
| --- | --- |
| `index.html` — **Today** | Time of the last run, the status of every source, the counts from the status file, the biggest moves since the previous run (chart and table), items that appeared or disappeared, and the latest values of every item with the change since the previous run. |
| `browse.html` — **Browse** | The latest values of every item with a search box, filters for source, language and release year, sorting up and down on every column, and a star on every item that saves it to a shortlist in the browser (`localStorage`). A "Shortlist only" switch shows just the starred items. The whole view (search, filters and sort order) is kept in the page address, for example `browse.html?source=imdb&sort=votes&dir=desc`, so it can be bookmarked or shared with the **Copy link** button, and the last view is remembered; **Clear filters** resets it. On the keyboard, `j` and `k` move down and up the list and `s` stars the chosen film. On a phone (under 640 pixels) each row is drawn as a card, with the column names beside the values and empty values left out, and a "Sort by" menu and direction button replace the column headers; the Today page's "Latest values" table does the same. |
| `trends.html` — **Trends** | A chart of every numeric value over the days with a picker for which items are shown, then a **3D film cloud** (below), then five sections whose headings state a finding that is computed from the history: the biggest rise or fall since the first run, the day with the biggest moves, how far apart the items are, the most volatile item, and how many votes each film adds per day. Each section explains the finding, gives the numbers, says how they are computed, and has a chart and a table of its numbers. The items ticked in the picker are kept in the page address (`?items=...`), so a view can be shared. The **film cloud** puts the films of one source (chosen with a switch) in a 3D box drawn on a canvas: for IMDb the axes are rating, votes (log scale) and votes added per day; for Wikipedia they are 7-day views (log scale), the latest daily views against the 7-day average (a spike shows above 1.0) and the percent change in daily views since the first day. Every number comes from `data/history.csv`. Drag to turn the box (it turns slowly by itself when left alone, unless "reduce motion" is on), hover a film for its numbers, click it to pick it and then star it or find it in Browse; with the keyboard the arrow keys turn the box and `[` and `]` step from film to film. A slider under the cloud travels back through the days (the films glide to where they were; ▶ Play runs through them), using only the history up to each day and one fixed range on every axis so the films really move, and **Trails** draws the path each film has taken (`,` and `.` step through the days). With "reduce motion" on, the slider jumps instead of gliding and there is no Play button. The numbers for the day shown are also in a table under the cloud. A **Compare two films** card follows it: pick two films (the menus, the `compare a vs b` command, or the Compare button on a film picked in the cloud) and it shows their numbers side by side, who is ahead on each measure and by how much, a heading that states the finding with a paragraph and how it is computed, a line chart per measure with one line for each film, and the numbers as a table. A film that is in both sources shows the numbers from both, and the pair is kept in the page address (`?compare=Film one~Film two`) so a comparison can be shared. |

All three pages share one navigation bar (`static/lib.js`) and one stylesheet (`static/site.css`: a monospace font and one set of Matrix-style green-on-black colors, with a dark palette for charts that need several distinguishable lines). The look follows the Matrix: falling code behind every page, and an intro screen that is a black screen with a blinking cursor. Clicking it (or pressing a key) starts the intro track and sends Matrix code bursting out of the middle of the screen, where the cursor was: the code flies outward in perspective, and how fast it flies, how much there is and how brightly it glows follow how loud the track is (a trickle in the quiet first second, an explosion on each hit, a huge climax near the end). At the climax a ring of light opens from the middle and reveals the site. To keep the wait short, the quiet stretches of the track are cut out (with a short crossfade at each join), so the whole opening takes about 7 seconds. Clicking again skips it, and the refresh button (a circular arrow) shows it again. It, and the volume button, are tucked behind a small button at the top right of every page: click it and they pop out to its left. It plays once per browser session. If the track cannot be loaded, or "reduce motion" is on, a wave of falling code opens the site instead. Sounds (a click for buttons and menus, a click in the search box and a tick for each key typed in it, a rising two-note blip when a filter value is chosen, rising or falling blips for starring or unstarring a film, a slide as the tools button opens and closes, and a rush of code when a page has loaded) are modelled on the intro track: each is a deep boom with a pitch drop (saturated so small speakers still carry it), a tick of digital hiss, and bit-crushed blips on the track's notes (F with a tritone above it), all through a dark echo. These sounds are made in the browser with the Web Audio API, so the only audio files are the intro track and the background ambience. Browsers only allow sound after a click or key press, so nothing plays before that, and the volume button turns all sound on or off and is remembered. It also controls the background ambience (`static/ambience.mp3`): a seamless 90-second loop that plays quietly under every page, fades in once the intro has finished, carries on from where it was when you go to another page, and pauses when the tab is hidden. With "reduce motion" turned on in the system settings the intro is plain and nothing animates. The site has a web app manifest and a service worker (`sw.js`): online, pages and data come from the network (scripts, styles and data are always checked with the server first, so a page never mixes scripts from two deploys); offline, the site opens from the saved copy and shows the last data it loaded.

**Interaction.** Press `/` (or Ctrl+K) on any page to open a green command bar. Type a command or the start of a film's name, pick from the suggestions with the arrow keys, and press Enter: `go trends`, `search avatar`, `star sinners`, `sort votes`, `filter source imdb`, `shortlist`, `clear`, `sound off`, `replay`, `install`, or `help` for the full list. Other shortcuts are `?` (help) and `g` then `t`, `b` or `h` (go to Trends, Browse or Today). `compare <film> vs <film>` puts two films side by side on the Trends page, and `ripples on` or `ripples off` turns the click effects on or off. Clicking or tapping a button, link, row or star makes a quick burst of falling code from the spot (starring a film drops three columns of code from the star; it does nothing with "reduce motion" on). Page titles, figures and chart titles *decode* into place from falling-code characters when a page loads. The real text is never replaced: the characters are painted over it, so screen readers, copy and paste and anything that reads the page always get the true words and numbers (nothing animates if "reduce motion" is on). When the browser can install the site as an app, an install button appears in the pop-out tray.

## Files

| Path | What it does |
| --- | --- |
| `README.md` | This file. |
| `requirements.txt` | Python packages the pipeline needs (`requests`). |
| `requirements-dev.txt` | Adds `pytest` for the tests. |
| `pytest.ini` | Tells pytest to look in `tests/`. |
| `.gitignore` | Keeps the virtual environment and caches out of git. |
| `.nojekyll` | Tells GitHub Pages to serve the files as they are. |
| `tracker/config.py` | Paths, the list of history columns, the main value per source, how many moves to keep. |
| `tracker/http.py` | HTTP GET that retries when a server is busy; the `SourceError` type. |
| `tracker/rows.py` | Makes rows with the common columns; reads and writes CSV. |
| `tracker/sources/imdb.py` | IMDb source: the film list, the download (keeping only the tracked films) and the conversion to rows. |
| `tracker/sources/wikipedia.py` | Wikipedia source: the film list, the downloads, and the conversion to rows. |
| `tracker/sources/__init__.py` | The registry of sources. |
| `tracker/raw.py` | Saves, lists and reads the gzipped raw files (written the same way every time). |
| `tracker/build.py` | Builds `data/history.csv` from the raw files (`python -m tracker.build`). |
| `tracker/moves.py` | The move rule: moves, appeared and disappeared items. |
| `tracker/status.py` | Writes `data/status.json` and `data/source_log.csv`. |
| `tracker/report.py` | The text of the daily GitHub Issue. |
| `tracker/feed.py` | Writes the Atom feed `feed.xml` from the history. |
| `tracker/issues.py` | Opens or updates today's issue and closes older ones through the GitHub API. |
| `tracker/run.py` | The daily pipeline (`python -m tracker.run`). |
| `tests/` | The pytest suite: `test_sources.py` (conversion of each source, fetching, retries), `test_build.py` (history logic), `test_moves.py` (the move rule), `test_run.py` (the pipeline, failed sources, a second run on the same day, status, issue text), `test_feed.py` (the Atom feed), `test_issues.py` (opening, updating and closing issues), `test_js_parity.py` (runs `static/lib.js` and checks it agrees with the Python move rule), `test_js_logic.py` (the view links, the decoding effect, how the command bar reads and suggests commands, the film cloud's maths, comparing two films, and the click effects), `test_site_files.py` (the site's files and the loudness curve), `js_parity.js` and `js_logic.js` (the small scripts those two JavaScript tests run, with node or JavaScriptCore), `helpers.py` and `conftest.py` (sample data). |
| `.github/workflows/tests.yml` | Runs the tests on every push. |
| `.github/workflows/daily.yml` | Runs the pipeline every day at 14:17 UTC (or by hand), opens the issue and commits `data/` and `feed.xml`. |
| `data/raw/<date>/<source>.<format>.gz` | The raw responses, one file per source per day. |
| `data/history.csv` | The history, one row per item per day. |
| `data/status.json` | The latest run. |
| `feed.xml` | The Atom feed of the daily reports, rewritten by every run. |
| `data/source_log.csv` | The result of every source on every day. |
| `index.html`, `browse.html`, `trends.html` | The three pages. |
| `static/site.css` | Shared colors, fonts and layout. |
| `static/lib.js` | Shared code: loading the data, the CSV parser, the calculations, the navigation bar, the shortlist. |
| `static/opening.js` | The opening: Matrix code bursting out of the middle of the screen, paced by the intro track, then a ring of light that reveals the page. |
| `static/intro-envelope.js` | How loud the intro track is 25 times a second (overall, bass and treble), when it hits, and which parts of the track are played. Made by `tools/make_envelope.py`; the opening reads it so it follows the pacing even when the sound is muted. |
| `static/intro.mp3` | The intro track: "Matrix code" by Jabba MTA (2020), with its tags and cover art removed. It plays from 13 seconds in, without its quiet middle parts (see `KEEP` in `tools/make_envelope.py`). |
| `static/compare.js` | The "Compare two films" card on the Trends page: the comparison logic and the card. |
| `static/ripple.js` | The burst of falling code when something is clicked (and the `ripples` on/off switch). |
| `static/cloud.js` | The 3D film cloud on the Trends page: the axes and projection maths, the canvas drawing, and the mouse, touch and keyboard controls. |
| `static/decode.js` | The decoding effect for headings and figures. |
| `static/terminal.js` | The command bar and the keyboard shortcuts. |
| `static/matrix.js` | The Matrix look: the falling-code background, the cursor intro screen, starting the opening, and the code-wave fallback. |
| `static/ambience.mp3` | The background ambience: a seamless 90-second loop cut from "Matrix Code Background Ambience" by Steven Berry (2023). The original is 54 minutes and 60 MB; `tools/make_ambience.py` makes the loop. |
| `static/sound.js` | The interface sounds, made with the Web Audio API, and the Sound on/off switch's state. |
| `static/charts.js` | The line, bar and column charts, tooltips and table views (plain SVG, no library). |
| `static/today.js`, `static/browse.js`, `static/trends.js` | The code of each page. |
| `static/icon-192.png`, `static/icon-512.png` | App icons. |
| `tools/make_ambience.py` | Cuts the ambience loop from the long original and blends its end into its start (needs ffmpeg). |
| `tools/make_envelope.py` | Measures the intro track and writes `static/intro-envelope.js` (needs ffmpeg). |
| `tools/make_icons.py` | Draws the icons (`python tools/make_icons.py`). |
| `manifest.webmanifest` | The web app manifest that makes the site installable. |
| `sw.js` | The service worker that makes the site work offline. |

## Setup

Nothing needs to be created or kept secret: both sources are open.

1. **Actions permissions.** Settings → Actions → General → Workflow permissions: allow read and write (the workflow also asks for `contents`, `issues` and `pages` write access itself).
2. **GitHub Pages.** Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. **First run.** Actions → *Daily run* → *Run workflow*. After that it runs every day at 14:17 UTC. GitHub starts scheduled runs on a best-effort basis, so one can start hours late; if a day is missed, start the run by hand the same way.

## Running it on your own computer

```
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest                              # the tests
.venv/bin/python -m tracker.run                         # one run (writes into data/)
.venv/bin/python -m tracker.build                       # rebuild history.csv from data/raw/
python3 -m http.server                                  # then open http://localhost:8000
```

## Data credits

- Ratings and votes: data courtesy of [IMDb](https://www.imdb.com), used for personal, non-commercial purposes under [IMDb's non-commercial dataset terms](https://developer.imdb.com/non-commercial-datasets/). The site says so in its footer.
- Page views: the Wikimedia pageviews API.
- Intro sound: "Matrix code" by Jabba MTA (2020), from 13 seconds in. The opening animation is original code.
- Background ambience: a 90-second excerpt of "Matrix Code Background Ambience - The Matrix Has You... in 4K" by Steven Berry (2023).
