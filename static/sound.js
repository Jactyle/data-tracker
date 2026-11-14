/* Sound for the Matrix look, made in the browser with the Web Audio API (no audio files).
 *
 *   intro   the intro track (static/intro.mp3), played from 13 seconds in when the opening starts,
 *           with the quiet stretches cut out (the list in INTRO_ENVELOPE.segments) and a short
 *           crossfade at each join; playIntro() also gives the opening a clock locked to the sound
 *   enter   a swell, rushing noise and falling blips: the sound of the code-waterfall opening, used
 *           when the intro track cannot be loaded
 * The interface sounds are built from what the intro track is made of (measured with
 * tools/make_envelope.py's source track): a deep boom around 40 to 50 Hz, held low notes (F, with a
 * tritone above it), thin digital hiss, and a dark echo. Each is a short boom (with some saturation so
 * small speakers still carry it), a tick of noise, and bit-crushed blips on those notes.
 *   click   a boom and a tick, for buttons, links, menus, checkboxes and the search box
 *   select  a boom and two code blips (F up to B, the tritone) when a filter value is chosen
 *   key     a tiny boom, tick and code blip for every key typed in the search box
 *   star    a boom and three rising code blips when a film is starred, falling when it is removed
 *   slide   a sweep of noise and a boom as the tools button opens (rising) or closes (falling)
 *   loaded  a rush of noise, falling-code blips and a boom when a page has loaded its data
 *
 * ambience  static/ambience.mp3 (a seamless 90-second loop) plays quietly under every page. It waits
 *           for the intro to finish, fades in, picks up where it left off when you go to another page,
 *           pauses when the tab is hidden, and follows the Sound switch.
 *
 * Browsers only allow sound after the person has clicked or pressed a key on the page, so
 * nothing plays before that. A Sound on/off switch in the navigation bar is remembered.
 */
(function (root) {
  'use strict';

  var S = {};
  var KEY = 'movie-tracker.sound';
  var INTRO_URL = 'static/intro.mp3';
  var INTRO_START = 13;      // seconds into the track where the opening begins
  var INTRO_VOLUME = 1.0;
  var INTRO_FADE_IN = 0.2;   // a gentle start, so the first sound does not startle
  var INTRO_FADE_OUT = 0.3;
  var JOIN_FADE = 0.18;      // crossfade where two parts of the track are joined
  var AMBIENT_URL = 'static/ambience.mp3';
  var AMBIENT_KEY = 'movie-tracker.ambience';
  var AMBIENT_VOLUME = 1.8;  // the loop is quiet (about -36 dBFS), so this raises it to sit softly under everything
  var AMBIENT_FADE_IN = 2.5;
  var ctx = null, master = null, ui = null, enabled = true;
  var buffers = {};          // decoded audio files by name (null while loading)
  var clip = null;           // the audio file that is playing now, so it can be stopped
  var ambient = null;        // the ambience that is playing: { src, gain, since, offset }
  var holdAmbient = false;   // true while the intro plays, when there should be no ambience
  var saveTimer = 0;
  try { enabled = localStorage.getItem(KEY) !== 'off'; } catch (e) { /* stays on */ }

  function noop() {}
  function rand(a, b) { return a + Math.random() * (b - a); }

  /* ---------- building blocks: each takes (context, output, start time, ...) ---------- */

  // The notes of the intro: F, with a tritone (B) above it, in a dark scale.
  var DARK = [349.2, 370.0, 415.3, 493.9, 523.3, 698.5, 740.0, 830.6, 987.8, 1046.5];

  var CURVES = {};
  function curve(kind) {
    if (!CURVES[kind]) {
      var size = 2048, values = new Float32Array(size);
      for (var i = 0; i < size; i++) {
        var x = i / (size - 1) * 2 - 1;
        values[i] = kind === 'saturate' ? Math.tanh(4 * x) / Math.tanh(4) : Math.round(x * 7) / 7;   // soft clipping, or 15 levels
      }
      CURVES[kind] = values;
    }
    return CURVES[kind];
  }

  // Master volume, then a compressor so many overlapping blips can never clip.
  function chain(c) {
    var gain = c.createGain();
    gain.gain.value = 0.6;
    var compressor = c.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.knee.value = 12;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;
    gain.connect(compressor);
    compressor.connect(c.destination);
    return gain;
  }

  function blip(c, out, t, freq, dur, type, vol, glideTo) {
    var osc = c.createOscillator(), gain = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noiseBuffer(c) {
    if (!c.__noise) {
      var length = c.sampleRate * 2, buffer = c.createBuffer(1, length, c.sampleRate), data = buffer.getChannelData(0);
      for (var i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      c.__noise = buffer;
    }
    return c.__noise;
  }

  // Filtered noise whose pitch sweeps from `from` to `to` Hz: the rush of the code falling.
  function whoosh(c, out, t, dur, from, to, vol) {
    var src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    src.loop = true;
    var filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    var gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + dur * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // A low hum that rises in pitch and volume, two slightly detuned tones for a slow beat.
  function swell(c, out, t, dur, f0, f1, vol) {
    [1, 1.012].forEach(function (detune) {
      var osc = c.createOscillator(), gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f0 * detune, t);
      osc.frequency.exponentialRampToValueAtTime(f1 * detune, t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol, t + dur * 0.55);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(out);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    });
  }

  // A deep boom: a sine that drops quickly in pitch, like the track's hits. The saturation adds
  // overtones, so small speakers that cannot play 45 Hz still carry it.
  function boom(c, out, t, from, to, dur, vol) {
    var osc = c.createOscillator(), shaper = c.createWaveShaper(), gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur * 0.75);
    shaper.curve = curve('saturate');
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(shaper);
    shaper.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  // The low-mid body of a hit: a short sine near 240 Hz, one of the notes the track holds.
  function body(c, out, t, freq, dur, vol) {
    var osc = c.createOscillator(), gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.75, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // A short burst of digital hiss.
  function tick(c, out, t, dur, vol, highpass) {
    var src = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain();
    src.buffer = noiseBuffer(c);
    filter.type = 'highpass';
    filter.frequency.value = highpass;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    src.start(t, Math.random() * 1.5, dur + 0.02);
  }

  // A blip of "code": a saw wave squeezed into 15 levels, so it sounds digital and gritty.
  function codeBlip(c, out, t, freq, dur, vol) {
    var osc = c.createOscillator(), crush = c.createWaveShaper(), tone = c.createBiquadFilter(), gain = c.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t);
    crush.curve = curve('crush');
    tone.type = 'lowpass';
    tone.frequency.value = 6000;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(crush);
    crush.connect(tone);
    tone.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // The interface sounds share a dark echo, like the hall around the intro track.
  function uiBus(c, destination) {
    var bus = c.createGain();
    bus.connect(destination);
    var send = c.createGain(), delay = c.createDelay(0.6), tone = c.createBiquadFilter(), feedback = c.createGain();
    send.gain.value = 0.26;
    delay.delayTime.value = 0.17;
    tone.type = 'lowpass';
    tone.frequency.value = 1800;
    feedback.gain.value = 0.34;
    bus.connect(send);
    send.connect(delay);
    delay.connect(tone);
    tone.connect(feedback);
    feedback.connect(delay);
    tone.connect(destination);
    return bus;
  }

  // Play parts of a decoded audio file one after the other, as if the bits between them were cut out.
  // `segments` lists [from, to] seconds counted from `start` in the file. Each join is a short
  // crossfade, and the whole thing starts and ends with a fade.
  function playSegments(c, out, t, buffer, start, segments, volume) {
    var bus = c.createGain();
    bus.connect(out);
    var sources = [], offset = 0;
    segments.forEach(function (segment, k) {
      var first = k === 0, last = k === segments.length - 1;
      var pre = first ? 0 : JOIN_FADE / 2, post = last ? 0 : JOIN_FADE / 2;
      var from = start + segment[0] - pre;
      var length = Math.min(segment[1] - segment[0] + pre + post, buffer.duration - from);
      if (length <= 0.05) return;
      var when = t + offset - pre;
      var fadeIn = first ? INTRO_FADE_IN : JOIN_FADE, fadeOut = last ? INTRO_FADE_OUT : JOIN_FADE;
      var src = c.createBufferSource(), gain = c.createGain();
      src.buffer = buffer;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.linearRampToValueAtTime(volume, when + fadeIn);
      gain.gain.setValueAtTime(volume, when + length - fadeOut);
      gain.gain.linearRampToValueAtTime(0.0001, when + length);
      src.connect(gain);
      gain.connect(bus);
      src.start(when, from, length);
      sources.push(src);
      offset += segment[1] - segment[0];
    });
    if (c === ctx) {
      var mine = { bus: bus, sources: sources, c: c };
      clip = mine;
      if (sources.length) sources[sources.length - 1].onended = function () { if (clip === mine) clip = null; };
    }
  }

  /* ---------- the sounds ---------- */

  var SOUNDS = {
    click: function (c, out, t) {
      boom(c, out, t, 150, 46, 0.11, 0.26);
      body(c, out, t, 240, 0.07, 0.14);
      tick(c, out, t, 0.03, 0.6, 3500);
      tick(c, out, t, 0.02, 0.5, 8500);
      codeBlip(c, out, t, 830.6, 0.03, 0.2);
    },
    select: function (c, out, t) {
      boom(c, out, t, 130, 48, 0.14, 0.30);
      body(c, out, t, 240, 0.11, 0.30);
      tick(c, out, t, 0.02, 0.4, 3500);
      tick(c, out, t, 0.016, 0.5, 8500);
      codeBlip(c, out, t, 698.5, 0.06, 0.3);                // F ...
      codeBlip(c, out, t + 0.065, 987.8, 0.09, 0.3);        // ... up to B, the tritone
    },
    key: function (c, out, t) {
      boom(c, out, t, 120, 52, 0.06, 0.16);
      body(c, out, t, 240, 0.04, 0.10);
      tick(c, out, t, 0.014, 0.5, 3500);
      tick(c, out, t, 0.01, 0.45, 8500);
      codeBlip(c, out, t, DARK[5 + Math.floor(Math.random() * 5)], 0.022, 0.14);
    },
    star: function (c, out, t, added) {
      var notes = added ? [698.5, 830.6, 1046.5] : [1046.5, 830.6, 698.5];
      boom(c, out, t, added ? 150 : 110, added ? 44 : 40, 0.2, 0.30);
      body(c, out, t, added ? 240 : 180, 0.14, 0.26);
      tick(c, out, t, 0.02, 0.4, 3500);
      tick(c, out, t, 0.016, 0.4, 8500);
      notes.forEach(function (f, i) { codeBlip(c, out, t + i * 0.07, f, 0.1, 0.30); });
    },
    slide: function (c, out, t, opening) {
      whoosh(c, out, t, 0.24, opening ? 700 : 4500, opening ? 4500 : 700, 0.6);
      boom(c, out, t, opening ? 130 : 100, opening ? 55 : 45, 0.12, 0.3);
      body(c, out, t, opening ? 240 : 180, 0.1, 0.2);
      tick(c, out, t, 0.02, 0.4, 8500);
    },
    loaded: function (c, out, t) {
      whoosh(c, out, t, 0.34, 500, 5200, 0.3);
      for (var i = 0; i < 6; i++) codeBlip(c, out, t + i * 0.035, DARK[Math.floor(Math.random() * DARK.length)], 0.05, 0.22);
      boom(c, out, t + 0.22, 110, 42, 0.32, 0.2);
      body(c, out, t + 0.22, 240, 0.16, 0.12);
      tick(c, out, t + 0.22, 0.025, 0.3, 8500);
    },
    enter: function (c, out, t) {
      swell(c, out, t, 2.6, 45, 110, 0.30);
      whoosh(c, out, t, 2.4, 5200, 350, 0.10);
      for (var i = 0; i < 80; i++) {                       // falling digits, more of them at the start
        var when = t + 0.05 + Math.pow(Math.random(), 1.3) * 2.2;
        var high = Math.random() < 0.3;
        blip(c, out, when, high ? rand(1800, 3400) : rand(500, 1700), high ? 0.09 : rand(0.025, 0.06),
             high ? 'sine' : 'square', high ? 0.03 : 0.022);
      }
      blip(c, out, t + 1.9, 70, 0.35, 'sine', 0.35, 38);  // a soft thud as the site opens
    }
  };

  /* ---------- playing ---------- */

  function ensure() {
    if (ctx) return ctx;
    var AudioContextClass = root.AudioContext || root.webkitAudioContext;
    if (!AudioContextClass) return null;
    try {
      ctx = new AudioContextClass();
      master = chain(ctx);
      ui = uiBus(ctx, master);
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  // `gesture` is true when the sound answers a click or key press, which lets it start the audio.
  S.play = function (name, arg, gesture) {
    if (!enabled || !SOUNDS[name]) return;
    var c = ensure();
    if (!c) return;
    function go() { SOUNDS[name](c, ui, c.currentTime + 0.01, arg); }
    if (c.state === 'running') go();
    else if (gesture) c.resume().then(go, noop);
  };

  S.enabled = function () { return enabled; };

  // Fetch and decode an audio file ahead of time so it can start the moment it is needed.
  S.preload = function (name, url) {
    var c = ensure();
    if (!c || name in buffers) return;
    buffers[name] = null;
    fetch(url).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.arrayBuffer();
    }).then(function (data) {
      return new Promise(function (resolve, reject) { c.decodeAudioData(data, resolve, reject); });
    }).then(function (buffer) {
      buffers[name] = buffer;
      if (name === 'ambient') S.ensureAmbient();
    }).catch(function () {
      delete buffers[name];          // not available: the synthesized sound is used instead
    });
  };
  S.preloadIntro = function () { S.preload('intro', INTRO_URL); };
  S.hasIntro = function () { return !!buffers.intro; };

  // Start the intro track and tell the caller when it began. onStart(clock) is called exactly once:
  // clock() gives seconds since the track began as the listener hears it, so a picture driven by it
  // stays locked to the sound. onStart(null) means there is no sound (it is off, or could not start
  // within 0.4 s), and the picture should use its own clock.
  S.playIntro = function (onStart) {
    var c = enabled && buffers.intro ? ensure() : null;
    var settled = false;
    function silent() { if (!settled) { settled = true; onStart(null); } }
    if (!c) { silent(); return; }
    function go() {
      if (settled) return;
      settled = true;
      var t = c.currentTime + 0.03;
      var plan = root.INTRO_ENVELOPE && root.INTRO_ENVELOPE.segments;
      playSegments(c, master, t, buffers.intro, INTRO_START, plan || [[0, buffers.intro.duration - INTRO_START]], INTRO_VOLUME);
      var latency = c.outputLatency || c.baseLatency || 0.04;
      onStart(function () { return Math.max(0, c.currentTime - t - latency); });
    }
    if (c.state === 'running') { go(); return; }
    c.resume().then(go, silent);
    setTimeout(silent, 400);
  };

  // Stop the audio file that is playing, with a very short fade so it does not click.
  S.stop = function () {
    if (!clip) return;
    var playing = clip;
    clip = null;
    try {
      var now = playing.c.currentTime;
      playing.bus.gain.cancelScheduledValues(now);
      playing.bus.gain.setValueAtTime(Math.max(playing.bus.gain.value, 0.0001), now);
      playing.bus.gain.linearRampToValueAtTime(0.0001, now + 0.1);
      playing.sources.forEach(function (src) { try { src.stop(now + 0.12); } catch (e) { /* not started or finished */ } });
    } catch (e) { /* already finished */ }
  };

  // Render the opening's sound without playing it, and measure it. Used by the tests: it reports the
  // length, the peak, and how big the biggest sudden jump in the waveform is near each join compared
  // with the biggest jump anywhere else (a click at a join would stand out).
  S.renderIntro = function () {
    var buffer = buffers.intro;
    if (!buffer) return Promise.reject(new Error('the intro track is not loaded'));
    var plan = (root.INTRO_ENVELOPE && root.INTRO_ENVELOPE.segments) || [[0, buffer.duration - INTRO_START]];
    var total = plan.reduce(function (sum, p) { return sum + p[1] - p[0]; }, 0);
    var OfflineClass = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    var c = new OfflineClass(1, Math.ceil(44100 * (total + 0.3)), 44100);
    playSegments(c, chain(c), 0, buffer, INTRO_START, plan, INTRO_VOLUME);
    return c.startRendering().then(function (out) {
      var data = out.getChannelData(0), rate = out.sampleRate, peak = 0, bad = 0;
      for (var i = 0; i < data.length; i++) { if (data[i] !== data[i]) bad++; else peak = Math.max(peak, Math.abs(data[i])); }
      function biggestStep(from, to) {
        var m = 0;
        for (var k = Math.max(1, Math.floor(from * rate)); k < Math.min(data.length, Math.floor(to * rate)); k++) m = Math.max(m, Math.abs(data[k] - data[k - 1]));
        return m;
      }
      var joins = [], offset = 0;
      plan.forEach(function (p, k) { if (k) joins.push(offset); offset += p[1] - p[0]; });
      return { seconds: data.length / rate - 0.3, peak: peak, nan: bad, joins: joins,
               stepAtJoins: joins.map(function (j) { return biggestStep(j - 0.1, j + 0.1); }),
               stepOverall: biggestStep(0.3, total) };
    });
  };

  /* ---------- the background ambience ---------- */

  function savedPosition(duration) {
    try {
      var saved = JSON.parse(sessionStorage.getItem(AMBIENT_KEY) || 'null');
      if (saved && saved.pos >= 0 && saved.at) return ((saved.pos + (Date.now() - saved.at) / 1000) % duration + duration) % duration;
    } catch (e) { /* start from the beginning */ }
    return 0;
  }
  // Remember where in the loop the ambience is, so the next page can carry on from there.
  function savePosition() {
    if (!ambient) return;
    var duration = buffers.ambient.duration;
    var pos = (ambient.offset + (ambient.c.currentTime - ambient.since)) % duration;
    try { sessionStorage.setItem(AMBIENT_KEY, JSON.stringify({ pos: pos, at: Date.now() })); } catch (e) { /* fine */ }
  }

  S.preloadAmbient = function () { S.preload('ambient', AMBIENT_URL); };

  // Start the ambience if everything allows it: sound is on, the intro is not playing, the tab is
  // visible, the audio is allowed to run, and the loop has loaded. Safe to call at any time.
  S.ensureAmbient = function () {
    if (ambient || !enabled || holdAmbient || document.hidden) return;
    if (!buffers.ambient) { S.preloadAmbient(); return; }
    var c = ensure();
    if (!c || c.state !== 'running') return;
    var buffer = buffers.ambient, offset = savedPosition(buffer.duration);
    var src = c.createBufferSource(), gain = c.createGain();
    src.buffer = buffer;
    src.loop = true;
    gain.gain.setValueAtTime(0.0001, c.currentTime);
    gain.gain.linearRampToValueAtTime(AMBIENT_VOLUME, c.currentTime + AMBIENT_FADE_IN);
    src.connect(gain);
    gain.connect(c.destination);             // straight to the speakers: it should not squash the other sounds
    src.start(0, offset);
    ambient = { src: src, gain: gain, c: c, since: c.currentTime, offset: offset };
    clearInterval(saveTimer);
    saveTimer = setInterval(savePosition, 1000);
  };

  S.stopAmbient = function (fade) {
    if (!ambient) return;
    var playing = ambient;
    savePosition();
    ambient = null;
    clearInterval(saveTimer);
    try {
      var now = playing.c.currentTime, seconds = fade == null ? 0.8 : fade;
      playing.gain.gain.cancelScheduledValues(now);
      playing.gain.gain.setValueAtTime(Math.max(playing.gain.gain.value, 0.0001), now);
      playing.gain.gain.linearRampToValueAtTime(0.0001, now + seconds);
      playing.src.stop(now + seconds + 0.05);
    } catch (e) { /* already stopped */ }
  };

  // The intro holds the ambience off while it plays, and lets it back in afterwards.
  S.hold = function (on) {
    holdAmbient = !!on;
    if (on) S.stopAmbient(0.5); else S.ensureAmbient();
  };

  // For tests: what the ambience is doing right now.
  S.ambientState = function () {
    return { playing: !!ambient, held: holdAmbient, enabled: enabled, loaded: !!buffers.ambient,
             seconds: buffers.ambient ? buffers.ambient.duration : 0, offset: ambient ? ambient.offset : null };
  };

  // For tests: play the loop through its wrap-around point offline and measure the join.
  S.renderAmbientLoop = function () {
    var buffer = buffers.ambient;
    if (!buffer) return Promise.reject(new Error('the ambience is not loaded'));
    var OfflineClass = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    var rate = buffer.sampleRate, c = new OfflineClass(1, Math.ceil(rate * 10), rate);
    var src = c.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(c.destination);
    src.start(0, buffer.duration - 5);           // the wrap-around happens 5 seconds in
    return c.startRendering().then(function (out) {
      var data = out.getChannelData(0), at = Math.round(5 * rate), join = 0, rest = 0, typical = [];
      join = Math.abs(data[at] - data[at - 1]);
      for (var i = 1; i < data.length; i++) {
        if (Math.abs(i - at) < 3) continue;
        var step = Math.abs(data[i] - data[i - 1]);
        rest = Math.max(rest, step);
        if (i % 17 === 0) typical.push(step);
      }
      typical.sort(function (a, b) { return a - b; });
      return { joinStep: join, biggestStepElsewhere: rest, typicalStep99: typical[Math.floor(typical.length * 0.99)], seconds: buffer.duration };
    });
  };

  S.toggle = function () {
    enabled = !enabled;
    if (!enabled) { S.stop(); S.stopAmbient(0.6); }
    try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch (e) { /* kept for this visit */ }
    if (enabled) {
      S.play('click', null, true);
      var c = ensure();
      if (c) c.resume().then(S.ensureAmbient, noop);   // the switch is a click, so the audio may start
    }
    return enabled;
  };

  // Wire the sounds to the whole page once: clicks, typing in the search box, menu choices.
  var attached = false;
  S.attach = function () {
    if (attached) return;
    attached = true;
    function unlock() {
      var c = ensure();
      if (c && c.state === 'suspended') c.resume().then(S.ensureAmbient, noop);
    }
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    // No ambience in a tab nobody is looking at; carry on when it is shown again.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) S.stopAmbient(0.3); else S.ensureAmbient();
    });
    window.addEventListener('pagehide', savePosition);
    setTimeout(function () { if (enabled) S.preloadAmbient(); }, 600);

    // Capture phase, so a star still shows its old state when we look at it.
    document.addEventListener('click', function (event) {
      var target = event.target;
      if (!target.closest || target.closest('#matrix-intro')) return;   // the intro has its own sound
      var control = target.closest('a[href], button, summary, select, input[type="checkbox"], input[type="search"]');
      if (!control) return;
      if (control.classList.contains('tools-toggle')) S.play('slide', control.getAttribute('aria-expanded') !== 'true', true);
      else if (control.classList.contains('star')) S.play('star', control.getAttribute('aria-pressed') !== 'true', true);
      else S.play('click', null, true);
    }, true);

    // Choosing a value in a filter menu (the click only opened it).
    document.addEventListener('change', function (event) {
      if (event.target && event.target.tagName === 'SELECT') S.play('select', null, true);
    }, true);

    var last = 0;
    document.addEventListener('input', function (event) {
      var target = event.target;
      if (!target || (target.type !== 'search' && !(target.classList && target.classList.contains('typesound')))) return;
      var now = Date.now();
      if (now - last < 30) return;
      last = now;
      S.play('key', null, true);
    }, true);
  };

  // Render a sound without playing it, and measure it. Used by the tests.
  // `pcmRate` is optional: give a sample rate to also get the samples back (16-bit, base64) for analysis.
  S.render = function (name, seconds, arg, pcmRate) {
    var OfflineClass = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    var rate = pcmRate || 44100;
    var c = new OfflineClass(1, Math.ceil(rate * seconds), rate);
    SOUNDS[name](c, uiBus(c, chain(c)), 0, arg);
    return c.startRendering().then(function (buffer) {
      var data = buffer.getChannelData(0), peak = 0, sum = 0, bad = 0, quarter = Math.floor(data.length / 4), parts = [0, 0, 0, 0];
      for (var i = 0; i < data.length; i++) {
        var v = data[i];
        if (v !== v) { bad++; continue; }
        peak = Math.max(peak, Math.abs(v));
        sum += v * v;
        parts[Math.min(3, Math.floor(i / quarter))] += v * v;
      }
      var result = { peak: peak, rms: Math.sqrt(sum / data.length), nan: bad,
                     quarters: parts.map(function (p) { return Math.sqrt(p / quarter); }) };
      if (pcmRate) {
        var bytes = new Uint8Array(data.length * 2), view = new DataView(bytes.buffer);
        for (var k = 0; k < data.length; k++) view.setInt16(k * 2, Math.max(-1, Math.min(1, data[k])) * 32767, true);
        var text = '';
        for (var j = 0; j < bytes.length; j += 8192) text += String.fromCharCode.apply(null, bytes.subarray(j, j + 8192));
        result.pcm = btoa(text);
      }
      return result;
    });
  };

  root.Sound = S;
})(window);
