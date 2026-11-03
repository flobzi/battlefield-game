// Audio engine: slot system over Web Audio. Loads files from audio/, falls back to synth.
(function () {
  const A = {};
  const AN = window.AUDIO_ANALYSIS || {};
  let ctx = null, master, musicBus, sfxBus, ambBus;
  const buffers = {};       // name -> AudioBuffer
  const layers = {};        // slot -> CrossfadeLayer
  let musicNode = null;
  A.enabled = true;
  A.ready = false;

  const dbToGain = (db) => Math.pow(10, db / 20);
  function fileGain(slot, name) {
    const s = AUDIO_SLOTS[slot]; const a = AN[name];
    let db = (s.gainDb || 0);
    if (a && s.normDb !== undefined) db += Math.max(-24, Math.min(18, s.normDb - a.mean));
    return dbToGain(db);
  }

  A.unlock = function () {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) { A.enabled = false; return; }
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = CONFIG.audio.master; master.connect(ctx.destination);
    // gentle compressor so big clashes don't clip
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = CONFIG.audio.music; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = CONFIG.audio.sfx; sfxBus.connect(comp);
    ambBus = ctx.createGain(); ambBus.gain.value = 1; ambBus.connect(comp);
    A.ctx = ctx;
    loadAll();
  };

  function loadAll() {
    const names = new Set();
    for (const k in AUDIO_SLOTS) for (const f of AUDIO_SLOTS[k].files) names.add(f);
    let pending = names.size; if (!pending) A.ready = true;
    names.forEach((n) => {
      fetch((window.AUDIO_BASE || '') + 'audio/' + n + '.mp3').then((r) => { if (!r.ok) throw 0; return r.arrayBuffer(); })
        .then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
        .then((b) => { buffers[n] = b; if (n.startsWith('menu_music') && A._wantMusic) A.playMusic(A._wantMusic); })
        .catch(() => {}).finally(() => { if (--pending === 0) A.ready = true; });
    });
  }
  const has = (slot) => AUDIO_SLOTS[slot] && AUDIO_SLOTS[slot].files.some((f) => buffers[f]);
  const avail = (slot) => AUDIO_SLOTS[slot].files.filter((f) => buffers[f]);

  // ---- music ----------------------------------------------------------------
  // music = crossfading Layer over the menu tracks (random start track, smooth rotation)
  A.playMusic = function (vol = 1) { A._wantMusic = vol; if (!ctx || !has('menu_music')) return; A.layer('menu_music', vol); };
  A.stopMusic = function () { A._wantMusic = 0; if (layers.menu_music) layers.menu_music.target = 0; };
  // ---- one-shots ------------------------------------------------------------
  A.play = function (slot, opt = {}) {
    if (!ctx || !A.enabled) return;
    const s = AUDIO_SLOTS[slot]; if (!s) return;
    const files = avail(slot);
    if (!files.length) return synth(s.synth || 'tick', opt);
    const f = files[(Math.random() * files.length) | 0];
    const src = ctx.createBufferSource(); src.buffer = buffers[f];
    src.playbackRate.value = (s.rate || 1) * (opt.rate || 1) * (1 + (Math.random() - 0.5) * 2 * (opt.pitchVar || 0));
    const g = ctx.createGain(); const vol = fileGain(slot, f) * (opt.vol === undefined ? 1 : opt.vol);
    g.gain.value = vol;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = Math.max(-1, Math.min(1, opt.pan || 0)); src.connect(g).connect(p).connect(opt.bus === 'amb' ? ambBus : sfxBus); }
    else src.connect(g).connect(sfxBus);
    let off = 0, dur = undefined;
    if (opt.offset !== undefined) { off = opt.offset; dur = opt.dur; }
    else if (s.maxDur) { off = Math.random() * Math.max(0, buffers[f].duration - s.maxDur); dur = s.maxDur; }
    if (dur) { // envelope
      const t = ctx.currentTime; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.015);
      g.gain.setValueAtTime(vol, t + Math.max(0.02, dur - 0.25 * dur)); g.gain.linearRampToValueAtTime(0, t + dur);
      src.start(t, off, dur + 0.05);
    } else src.start();
    return src;
  };

  // timed one-shot: schedule so the file's loudest moment (manifest peakT) lands `peakIn` seconds from now
  A.playTimed = function (slot, peakIn, opt = {}) {
    if (!ctx || !A.enabled) return; const files = avail(slot); if (!files.length) return synth(AUDIO_SLOTS[slot].synth || 'whoosh', opt);
    const f = files[(Math.random() * files.length) | 0]; const rate = 1 + (Math.random() - 0.5) * 2 * (opt.pitchVar || 0.04);
    const pk = ((AN[f] && AN[f].peakT) || buffers[f].duration / 2) / rate; const d = peakIn - pk;
    const src = ctx.createBufferSource(); src.buffer = buffers[f]; src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = fileGain(slot, f) * (opt.vol === undefined ? 1 : opt.vol);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null; if (p) { p.pan.value = opt.pan || 0; src.connect(g).connect(p).connect(sfxBus); } else src.connect(g).connect(sfxBus);
    if (d >= 0) src.start(ctx.currentTime + d); else src.start(ctx.currentTime, Math.min(-d * rate, buffers[f].duration - 0.05));
  };
  A.allowRate = function (key, minGap) { if (!ctx) return false; const now = ctx.currentTime; if (rl[key] && now - rl[key] < minGap) return false; rl[key] = now; return true; };
  // sliced one-shots (blood): random onset segment, rate-limited + polyphony cap
  const rl = {};
  const voices = {}, times = {};
  A.playSliced = function (slot, opt = {}) {
    if (!ctx || !A.enabled) return; const S = AUDIO_SLOTS[slot];
    const now = ctx.currentTime; const tt = (times[slot] = (times[slot] || []).filter((t) => now - t < 1));
    if (tt.length >= (S.perSec || CONFIG.audio.bloodPerSec) || (voices[slot] || 0) >= (S.poly || CONFIG.audio.bloodPoly)) return;
    const files = avail(slot); if (!files.length) return synth('thud', opt);
    const f = files[(Math.random() * files.length) | 0];
    const segs = (AN[f] && AN[f].segs && AN[f].segs.length) ? AN[f].segs : [[0, Math.min(0.5, buffers[f].duration)]];
    const sg = segs[(Math.random() * segs.length) | 0];
    tt.push(now); voices[slot] = (voices[slot] || 0) + 1;
    const src = A.play(slot, Object.assign({ offset: sg[0], dur: Math.min(0.9, Math.max(0.12, sg[1])), pitchVar: 0.05 }, opt));
    if (src) src.onended = () => voices[slot]--; else voices[slot]--;
  };
  // rate limiter for frequent one-shots
    A.playLimited = function (slot, perSec, opt) {
    if (!ctx) return; const now = ctx.currentTime; const a = (rl[slot] = (rl[slot] || []).filter((t) => now - t < 1));
    if (a.length >= perSec) return; a.push(now); A.play(slot, opt);
  };

  // ---- crossfading loop layers ---------------------------------------------
  class Layer {
    constructor(slot, bus) { this.slot = slot; this.bus = bus; this.target = 0; this.rate = 1; this.cur = null; this.order = []; this.g = ctx.createGain(); this.g.gain.value = 0; this.g.connect(bus); }
    nextFile() {
      const files = avail(this.slot); if (!files.length) return null;
      if (!this.order.length) { this.order = files.slice().sort(() => Math.random() - 0.5); if (this.cur && this.order[0] === this.cur.f && files.length > 1) this.order.push(this.order.shift()); }
      return this.order.shift();
    }
    startVoice() {
      const f = this.nextFile(); if (!f) return;
      const s = AUDIO_SLOTS[this.slot]; const xf = s.xfade || 2;
      const src = ctx.createBufferSource(); src.buffer = buffers[f]; src.playbackRate.value = this.rate;
      const g = ctx.createGain(); const v = fileGain(this.slot, f); const t = ctx.currentTime;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + xf);
      src.connect(g).connect(this.g);
      const off = s.fromStart ? 0 : Math.random() * Math.max(0, buffers[f].duration * 0.5);
      src.start(t, off);
      if (this.cur) { const o = this.cur; o.g.gain.cancelScheduledValues(t); o.g.gain.setValueAtTime(o.g.gain.value, t); o.g.gain.linearRampToValueAtTime(0, t + xf); setTimeout(() => { try { o.src.stop(); } catch (e) {} }, xf * 1000 + 300); }
      this.cur = { f, src, g, t0: t, off, dur: buffers[f].duration, xf };
      this.pos = off;
    }
    update(dt) {
      const live = this.target > 0.002;
      if (live && !this.cur) this.startVoice();
      if (this.cur) {
        this.pos += dt * this.rate;
        this.cur.src.playbackRate.setTargetAtTime(this.rate, ctx.currentTime, 0.3);
        if (this.pos > this.cur.dur - this.cur.xf - 0.2) this.startVoice();
      }
      this.g.gain.setTargetAtTime(this.target, ctx.currentTime, 0.35);
      if (!live && this.cur && this.g.gain.value < 0.003) { try { this.cur.src.stop(); } catch (e) {} this.cur = null; }
    }
  }
  A.layer = function (slot, vol, rate = 1) {
    if (!ctx || !has(slot)) return;
    const l = layers[slot] || (layers[slot] = new Layer(slot, AUDIO_SLOTS[slot].kind === 'music' ? musicBus : slot.startsWith('ambience') ? ambBus : sfxBus));
    l.target = A.enabled ? Math.max(0, vol) : 0; l.rate = rate;
  };
  A.update = function (dt) { if (!ctx) return; for (const k in layers) layers[k].update(dt); };
  A.silenceLayers = function () { for (const k in layers) if (k !== 'menu_music') layers[k].target = 0; };
  A.duckAmbience = function (amount) { if (ambBus) ambBus.gain.setTargetAtTime(1 - amount * CONFIG.audio.ambienceDuck, ctx.currentTime, 0.6); };
  A.setMuted = function (m) { A.enabled = !m; if (master) master.gain.setTargetAtTime(m ? 0 : CONFIG.audio.master, ctx.currentTime, 0.1); };

  // ---- synth placeholders ---------------------------------------------------
  let noiseBuf = null;
  function noise() { if (noiseBuf) return noiseBuf; noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return noiseBuf; }
  function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  function nz(t, f, q, peak, d, type = 'bandpass', out = sfxBus) { const s = ctx.createBufferSource(); s.buffer = noise(); const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ctx.createGain(); env(g, t, 0.004, peak, d); s.connect(fl).connect(g).connect(out); s.start(t, Math.random() * 0.5, d + 0.1); return fl; }
  function osc(t, type, f, peak, d, f2) { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d); const g = ctx.createGain(); env(g, t, 0.01, peak, d); o.connect(g).connect(sfxBus); o.start(t); o.stop(t + d + 0.1); }
  function synth(kind, opt = {}) {
    const t = ctx.currentTime, v = opt.vol === undefined ? 1 : opt.vol, r = opt.rate || 1;
    switch (kind) {
      case 'clank': nz(t, 2600 + Math.random() * 1800, 8, 0.12 * v, 0.09); osc(t, 'triangle', (1900 + Math.random() * 900) * r, 0.03 * v, 0.18); break;
      case 'thud': nz(t, 180 * r, 1.2, 0.25 * v, 0.14, 'lowpass'); break;
      case 'whoosh': { const f = nz(t, 900, 1.5, 0.05 * v, 0.22); f.frequency.exponentialRampToValueAtTime(3500, t + 0.2); break; }
      case 'thunk': nz(t, 500, 3, 0.1 * v, 0.06); break;
      case 'tick': osc(t, 'sine', 900 * r, 0.05 * v, 0.05); break;
      case 'swell': osc(t, 'sine', 330, 0.05 * v, 0.35, 660); osc(t, 'triangle', 495, 0.025 * v, 0.35, 990); break;
      case 'victory': [392, 494, 587, 784].forEach((f, i) => osc(t + i * 0.18, 'triangle', f, 0.08, 0.9)); break;
      case 'defeat': [392, 349, 311, 262].forEach((f, i) => osc(t + i * 0.25, 'triangle', f, 0.07, 1.1)); break;
    }
  }
  window.AudioSys = A;
})();

// ---- haptics (Android/Chrome; graceful no-op on iOS) -------------------------
window.Haptics = (function () {
  const H = { on: localStorage.getItem('bf_haptics') !== '0' };
  let last = 0;
  const vib = (p) => { if (!H.on || !navigator.vibrate || (navigator.userActivation && !navigator.userActivation.hasBeenActive)) return; try { navigator.vibrate(p); } catch (e) {} };
  H.tick = () => vib(8);
  H.select = () => vib([10, 30, 10]);
  H.pulseFull = () => vib([12, 40, 18, 40, 30]);
  H.impact = (s) => { const n = performance.now(); if (n - last < 90) return; last = n; vib(Math.min(80, 10 + s * 60) | 0); };
  H.horn = () => vib([60, 40, 90, 40, 140]);
  // pass 5
  H.ui = () => vib(6);
  H.start = () => vib([30, 50, 30]);
  H.result = (win) => vib(win ? [20, 60, 20, 60, 40] : [90]);
  let lastThrow = 0;
  H.thrown = () => { const n = performance.now(); if (n - lastThrow < 120) return; lastThrow = n; last = n; vib(14); };
  H.broke = () => vib(30);
  H.set = (v) => { H.on = v; localStorage.setItem('bf_haptics', v ? '1' : '0'); if (v) vib(15); };
  return H;
})();
