// Procedural gouache-style art: WFC map, brush painting, sprites, flags, decals.
(function () {
  const Art = {};
  let seed = 1;
  const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  Art.seed = (s) => { seed = s; };
  Art.rnd = rnd;
  const R = (a, b) => a + rnd() * (b - a);
  const pick = (a) => a[(rnd() * a.length) | 0];
  Art.mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };

  // ---- colour helpers --------------------------------------------------------
  function hex2rgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const rgb2hex = (r) => '#' + r.map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');
  Art.shade = (h, k) => { const c = hex2rgb(h); return rgb2hex(k < 0 ? c.map((v) => v * (1 + k)) : c.map((v) => v + (255 - v) * k)); };
  Art.mix = (a, b, t) => { const x = hex2rgb(a), y = hex2rgb(b); return rgb2hex(x.map((v, i) => v + (y[i] - v) * t)); };
  Art.jitter = (h, j) => { const c = hex2rgb(h); const d = (rnd() - 0.5) * 2 * j; return rgb2hex(c.map((v) => v * (1 + d) + (rnd() - 0.5) * j * 40)); };
  Art.rgba = (h, a) => { const c = hex2rgb(h); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
  const shade = Art.shade, jit = Art.jitter;

  // ---- brush primitives (gouache dabs) --------------------------------------
  // irregular blob with soft opacity + a couple of bristle streaks
  function dab(g, x, y, r, col, a, ang, el = 1, streaks = true) {
    ang = ang === undefined ? rnd() * 6.283 : ang;
    const n = 9; g.save(); g.translate(x, y); g.rotate(ang); g.scale(1, el);
    g.globalAlpha = a; g.fillStyle = col; g.beginPath();
    for (let i = 0; i < n; i++) { const t = (i / n) * 6.283; const rr = r * (0.72 + rnd() * 0.42); i ? g.lineTo(Math.cos(t) * rr, Math.sin(t) * rr) : g.moveTo(Math.cos(t) * rr, Math.sin(t) * rr); }
    g.closePath(); g.fill();
    if (streaks && r > 2.5) {
      g.globalAlpha = a * 0.5; g.strokeStyle = shade(col, rnd() < 0.5 ? 0.18 : -0.18); g.lineWidth = Math.max(0.6, r * 0.12);
      for (let k = 0; k < 3; k++) { const yy = (rnd() - 0.5) * r; g.beginPath(); g.moveTo(-r * 0.8, yy); g.quadraticCurveTo(0, yy + (rnd() - 0.5) * r * 0.3, r * 0.8, yy + (rnd() - 0.5) * r * 0.2); g.stroke(); }
    }
    g.restore();
  }
  function stroke(g, x, y, len, w, ang, col, a, bend = 0) {
    g.save(); g.globalAlpha = a; g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, y); const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
    g.quadraticCurveTo((x + ex) / 2 + bend, (y + ey) / 2, ex, ey); g.stroke(); g.restore();
  }
  Art.dab = dab; Art.stroke = stroke;

  // ---- palette (from refs) ---------------------------------------------------
  const P = {
    grass: ['#2f5a1c', '#3a6a22', '#46782a', '#2a4e1a', '#527f2e', '#3d6624', '#5a8a30', '#335e20'],
    deep: ['#15290d', '#1b3512', '#12240b', '#20401a'],
    clover: ['#4e7a34', '#5d8c3c', '#6a9a44'],
    dirt: ['#6e5636', '#5e4a2e', '#7d6440', '#6a5234', '#54442a'],
    mud: ['#4a3420', '#3a2816', '#5a3f26', '#43301c'],
    water: ['#3d5a5e', '#2f4a50', '#4a6a6a', '#557a78'],
    rock: ['#8c8f86', '#a5a89d', '#777a72', '#999c90'],
    moss: ['#6d8a45', '#7d9a4f'],
    flowers: ['#e8c23a', '#f0d050', '#f4f1e4', '#e9e6d6', '#6e8fd0', '#8aa6e0'],
  };
  Art.P = P;

  // ---- WFC map generation ----------------------------------------------------
  const T = ['grass', 'clover', 'flowers', 'shrub', 'rocks', 'dirt', 'trail', 'mud', 'puddle', 'bank', 'water', 'reeds', 'forest'];
  const ADJ = {
    grass: 'grass clover flowers shrub rocks dirt trail forest bank',
    clover: 'grass clover flowers shrub dirt',
    flowers: 'grass clover flowers shrub rocks forest',
    shrub: 'grass clover flowers shrub rocks forest',
    rocks: 'grass flowers shrub rocks dirt bank',
    dirt: 'grass clover rocks dirt trail mud',
    trail: 'grass dirt trail mud',
    mud: 'dirt trail mud puddle bank reeds',
    puddle: 'mud puddle',
    bank: 'grass rocks mud bank water reeds',
    water: 'bank water reeds',
    reeds: 'bank water reeds mud',
    forest: 'grass flowers shrub forest',
  };
  const W0 = { grass: 10, clover: 3, flowers: 3, shrub: 1.3, rocks: 0.8, dirt: 2, trail: 1.2, mud: 1, puddle: 0.5, bank: 0.7, water: 1.5, reeds: 0.7, forest: 1.2 }
  const W = Object.assign({}, W0, (window.CONFIG && window.CONFIG.world.terrainWeights) || {});   // 3D build overrides for a lusher meadow
  const idx = {}; T.forEach((t, i) => (idx[t] = i));
  const adjMask = T.map((t) => ADJ[t].split(' ').reduce((m, n) => m | (1 << idx[n]), 0));
  const ALL = (1 << T.length) - 1;
  const BATTLE_OK = ['grass', 'clover', 'flowers', 'dirt', 'trail', 'mud', 'puddle', 'rocks'].reduce((m, n) => m | (1 << idx[n]), 0);

  Art.generateMap = function (cols, rows) {
    const pondCorner = [rnd() < 0.5 ? 0 : 1, rnd() < 0.5 ? 0.25 : 0.75];
    const posW = (t, x, y) => {
      const u = x / cols, v = y / rows; const edge = Math.min(u, 1 - u, v, 1 - v);
      const dc = Math.hypot(u - 0.5, (v - 0.5) * 0.8);
      const dp = Math.hypot(u - pondCorner[0], v - pondCorner[1]);
      let w = W[t];
      if (t === 'forest') w *= edge < 0.06 ? 12 : edge < 0.12 ? 1 : 0.02;
      if (t === 'water' || t === 'reeds' || t === 'bank') w *= dp < 0.22 ? 6 : 0.05;
      if (t === 'dirt' || t === 'trail') w *= dc < 0.2 ? 4 : 0.6;
      if (t === 'shrub') w *= edge < 0.15 ? 2.5 : 0.6;
      return w;
    };
    for (let attempt = 0; attempt < 30; attempt++) {
      const cell = new Array(cols * rows).fill(ALL);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const u = x / cols, v = y / rows;
        if (u > 0.14 && u < 0.86 && v > 0.12 && v < 0.88) cell[y * cols + x] &= BATTLE_OK;
      }
      cell[((rows / 2) | 0) * cols + ((cols / 2) | 0)] = 1 << idx.dirt;
      const stack = []; for (let i = 0; i < cell.length; i++) stack.push(i);
      let ok = true;
      const propagate = () => {
        while (stack.length) {
          const i = stack.pop(); const x = i % cols, y = (i / cols) | 0;
          let allow = 0; for (let t = 0; t < T.length; t++) if (cell[i] & (1 << t)) allow |= adjMask[t];
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const j = ny * cols + nx; const nv = cell[j] & allow;
            if (nv !== cell[j]) { if (!nv) return false; cell[j] = nv; stack.push(j); }
          }
        }
        return true;
      };
      if (!propagate()) continue;
      while (true) {
        let best = -1, be = 1e9;
        for (let i = 0; i < cell.length; i++) { const c = cell[i]; if ((c & (c - 1)) === 0) continue; let n = 0; for (let t = 0; t < T.length; t++) if (c & (1 << t)) n++; const e = n + rnd() * 0.5; if (e < be) { be = e; best = i; } }
        if (best < 0) break;
        const x = best % cols, y = (best / cols) | 0; let tot = 0; const opts = [];
        for (let t = 0; t < T.length; t++) if (cell[best] & (1 << t)) { let w = posW(T[t], x, y);
          // neighbour affinity for blobby regions
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const j = (y + dy) * cols + x + dx; if (x + dx >= 0 && y + dy >= 0 && x + dx < cols && y + dy < rows && cell[j] === 1 << t) w *= 2.2; }
          opts.push([t, w]); tot += w; }
        let r = rnd() * tot, ch = opts[0][0]; for (const [t, w] of opts) { if ((r -= w) <= 0) { ch = t; break; } }
        cell[best] = 1 << ch; stack.push(best);
        if (!propagate()) { ok = false; break; }
      }
      if (ok) return cell.map((c) => T[31 - Math.clz32(c)]);
    }
    return new Array(cols * rows).fill('grass');
  };
  Art.TERRAIN_SPEED = { grass: 1, clover: 1, flowers: 1, shrub: 0.6, rocks: 0.8, dirt: 1.02, trail: 1.02, mud: 0.78, puddle: 0.66, bank: 0.75, water: 0.42, reeds: 0.5, forest: 0.5 };

  // ---- ground painting -------------------------------------------------------
  Art.paintGround = function (map, cols, rows, cellW, res) {
    const Wd = cols * cellW, Ht = rows * cellW;
    const c = Art.mkCanvas(Wd * res, Ht * res), g = c.getContext('2d');
    const S = cellW * res;
    g.fillStyle = '#34601e'; g.fillRect(0, 0, c.width, c.height);
    const cells = (type) => { const out = []; for (let i = 0; i < map.length; i++) if (map[i] === type) out.push([(i % cols) * S, ((i / cols) | 0) * S]); return out; };
    const scatter = (type, n, fn, spread = 1.25) => { for (const [cx, cy] of cells(type)) for (let k = 0; k < n; k++) fn(cx + S / 2 + (rnd() - 0.5) * S * spread, cy + S / 2 + (rnd() - 0.5) * S * spread); };
    // 1. base meadow: big soft sweeps then medium dabs
    for (let k = 0; k < (c.width * c.height) / 900; k++) dab(g, rnd() * c.width, rnd() * c.height, R(14, 34) * res, jit(pick(P.grass), 0.1), 0.18, R(-0.6, 0.6) - 0.9, 0.5);
    for (let k = 0; k < (c.width * c.height) / 260; k++) dab(g, rnd() * c.width, rnd() * c.height, R(3, 8) * res, jit(pick(P.grass), 0.12), 0.25, R(-0.8, 0.8) - 1.2, 0.45);
    // darker undertone noise patches
    for (let k = 0; k < 140; k++) dab(g, rnd() * c.width, rnd() * c.height, R(30, 80) * res, pick(P.deep), 0.06, undefined, 0.7, false);
    // 2. ground types (soft blended overlays extending past cell bounds)
    scatter('forest', 26, (x, y) => dab(g, x, y, R(10, 22) * res, jit(pick(P.deep), 0.1), 0.5), 1.5);
    scatter('dirt', 26, (x, y) => dab(g, x, y, R(6, 16) * res, jit(pick(P.dirt), 0.08), 0.32, undefined, 0.7), 1.4);
    scatter('trail', 20, (x, y) => dab(g, x, y, R(5, 12) * res, jit(pick(P.dirt), 0.08), 0.35, undefined, 0.6), 1.3);
    scatter('trail', 26, (x, y) => footprint(g, x, y, R(0, 6.28), res, 0.35));
    scatter('mud', 24, (x, y) => dab(g, x, y, R(6, 15) * res, jit(pick(P.mud), 0.08), 0.42, undefined, 0.7), 1.35);
    scatter('mud', 14, (x, y) => footprint(g, x, y, R(0, 6.28), res, 0.4));
    scatter('bank', 22, (x, y) => dab(g, x, y, R(6, 14) * res, jit(pick(P.mud), 0.06), 0.4, undefined, 0.7), 1.4);
    scatter('puddle', 10, (x, y) => dab(g, x, y, R(6, 14) * res, jit(pick(P.mud), 0.05), 0.5), 1.2);
    scatter('puddle', 3, (x, y) => puddle(g, x, y, R(5, 10) * res), 0.6);
    scatter('water', 30, (x, y) => dab(g, x, y, R(10, 20) * res, jit(pick(P.water), 0.06), 0.55, undefined, 0.8, false), 1.15);
    scatter('reeds', 22, (x, y) => dab(g, x, y, R(8, 16) * res, jit(pick(P.water), 0.06), 0.5, undefined, 0.8, false), 1.1);
    scatter('water', 4, (x, y) => { stroke(g, x, y, R(8, 20) * res, 1.2 * res, R(-0.3, 0.3), '#9fb8b0', 0.25, 3); });
    scatter('water', 2, (x, y) => lily(g, x, y, res), 0.9);
    scatter('reeds', 10, (x, y) => reed(g, x, y, res), 1.0);
    scatter('bank', 10, (x, y) => reed(g, x, y, res), 1.2);
    const SM = (window.CONFIG && window.CONFIG.world.scatterMul != null) ? window.CONFIG.world.scatterMul : 1;   // 3D: fewer painted flowers/rocks (real grass covers it)
    scatter('clover', 6 * SM, (x, y) => clover(g, x, y, res), 1.3);
    scatter('flowers', 7 * SM, (x, y) => flower(g, x, y, res), 1.3);
    scatter('grass', 0.2 * SM, (x, y) => flower(g, x, y, res), 1.0);
    scatter('grass', 0.4 * SM, (x, y) => clover(g, x, y, res), 1.0);
    scatter('rocks', 3 * SM, (x, y) => rock(g, x, y, R(4, 9) * res, res), 1.0);
    scatter('dirt', 0.15 * SM, (x, y) => rock(g, x, y, R(2, 4) * res, res), 1.0);
    scatter('dirt', 0.25 * SM, (x, y) => rock(g, x, y, R(1.2, 2.2) * res, res), 1.0);
    scatter('shrub', 0.7, (x, y) => shrub(g, x, y, R(9, 16) * res, res), 0.8);
    scatter('forest', 3, (x, y) => shrub(g, x, y, R(14, 24) * res, res, true), 1.1);
    scatter('grass', 0.005 * SM, (x, y) => shrub(g, x, y, R(6, 10) * res, res), 1.0);
    scatter('forest', 0.3, (x, y) => log(g, x, y, res), 0.6);
    // 3. dense blade texture: dark undergrowth, mid blades, sunlit tips (light from top-right)
    const N = (c.width * c.height) / 55;
    for (let k = 0; k < N; k++) {
      const x = rnd() * c.width, y = rnd() * c.height, r = rnd();
      const col = r < 0.38 ? '#173010' : r < 0.75 ? pick(['#3f7024', '#4a7d2a', '#355f1e']) : r < 0.93 ? '#7aa83a' : '#b9c860';
      stroke(g, x, y, R(3, 8) * res, R(0.5, 1.0) * res, -1.25 + R(-0.55, 0.55), col, r < 0.38 ? 0.35 : 0.3, R(-1.5, 1.5) * res);
    }
    return c;
  };
  function footprint(g, x, y, ang, res, a) { g.save(); g.translate(x, y); g.rotate(ang); g.globalAlpha = a; g.fillStyle = '#3e2f22'; g.beginPath(); g.ellipse(0, 0, 2.2 * res, 1.1 * res, 0, 0, 6.283); g.fill(); g.beginPath(); g.ellipse(4 * res, 2.6 * res, 2.2 * res, 1.1 * res, 0, 0, 6.283); g.fill(); g.restore(); }
  Art.footprint = footprint;
  function puddle(g, x, y, r) { dab(g, x, y, r, '#5d7478', 0.75, undefined, 0.6, false); dab(g, x - r * 0.2, y - r * 0.15, r * 0.6, '#a9bdbb', 0.45, undefined, 0.5, false); }
  function lily(g, x, y, res) { const r = R(2, 3.5) * res; g.save(); g.globalAlpha = 0.85; g.fillStyle = jit('#5f8a3e', 0.1); g.beginPath(); g.arc(x, y, r, 0.3, 6.0); g.lineTo(x, y); g.fill(); if (rnd() < 0.3) { g.fillStyle = '#f2e6ea'; g.beginPath(); g.arc(x + r * 0.3, y, r * 0.35, 0, 6.283); g.fill(); } g.restore(); }
  function reed(g, x, y, res) { for (let k = 0; k < 5; k++) { const a = -1.57 + R(-0.5, 0.5); stroke(g, x, y, R(5, 10) * res, 0.8 * res, a, jit('#6d8a3c', 0.1), 0.8, R(-2, 2)); if (rnd() < 0.3) { g.save(); g.fillStyle = '#6b4a2a'; g.globalAlpha = 0.9; g.beginPath(); g.ellipse(x + Math.cos(a) * 8 * res, y + Math.sin(a) * 8 * res, 0.9 * res, 2 * res, a + 1.57, 0, 6.283); g.fill(); g.restore(); } } }
  function clover(g, x, y, res) { const col = jit(pick(P.clover), 0.12); for (let k = 0; k < 3; k++) { const a = k * 2.09 + rnd(); dab(g, x + Math.cos(a) * 1.4 * res, y + Math.sin(a) * 1.4 * res, 1.4 * res, col, 0.8, a, 0.9, false); } }
  function flower(g, x, y, res) { const col = pick(P.flowers); for (let k = 0; k < 4; k++) { g.globalAlpha = 0.9; g.fillStyle = jit(col, 0.06); g.beginPath(); g.arc(x + R(-3, 3) * res, y + R(-3, 3) * res, R(0.6, 1.2) * res, 0, 6.283); g.fill(); } g.globalAlpha = 1; }
  function rock(g, x, y, r, res) {
    dab(g, x + r * 0.35, y + r * 0.35, r * 1.05, '#1f2a1a', 0.35, undefined, 0.8, false);
    const base = jit(pick(P.rock), 0.06); dab(g, x, y, r, base, 0.95, undefined, 0.78, false);
    dab(g, x - r * 0.25, y - r * 0.25, r * 0.6, shade(base, 0.22), 0.6, undefined, 0.7, false);
    if (r > 3 * res) dab(g, x - r * 0.1, y - r * 0.45, r * 0.5, pick(P.moss), 0.7, undefined, 0.5, false);
  }
  function shrub(g, x, y, r, res, dark) {
    dab(g, x + r * 0.3, y + r * 0.35, r * 1.1, '#15200f', 0.45, undefined, 0.85, false);
    const base = dark ? pick(P.deep) : jit(pick(['#3f6030', '#4b6d33', '#365528']), 0.08);
    for (let k = 0; k < 18; k++) { const a = rnd() * 6.283, d = rnd() * r * 0.75; dab(g, x + Math.cos(a) * d, y + Math.sin(a) * d, r * R(0.25, 0.45), jit(base, 0.12), 0.9, undefined, 0.85, false); }
    for (let k = 0; k < 14; k++) { const a = rnd() * 6.283, d = rnd() * r * 0.55; dab(g, x + Math.cos(a) * d - r * 0.2, y + Math.sin(a) * d - r * 0.2, r * R(0.12, 0.25), shade(base, 0.3), 0.75, undefined, 0.9, false); }
    if (!dark && rnd() < 0.4) for (let k = 0; k < 6; k++) { g.fillStyle = pick(P.flowers); g.globalAlpha = 0.9; g.beginPath(); g.arc(x + R(-r, r) * 0.6, y + R(-r, r) * 0.6, 0.8 * res, 0, 6.283); g.fill(); }
    g.globalAlpha = 1;
  }
  function log(g, x, y, res) { const a = rnd() * 3.14, L = R(22, 36) * res; g.save(); g.translate(x, y); g.rotate(a); g.globalAlpha = 0.4; g.fillStyle = '#111'; g.fillRect(-L / 2 + 3 * res, -2 * res, L, 7 * res); g.globalAlpha = 1; g.fillStyle = '#5a4630'; g.fillRect(-L / 2, -3.5 * res, L, 7 * res); g.fillStyle = '#6d8a45'; g.globalAlpha = 0.8; for (let k = 0; k < 6; k++) dab(g, R(-L / 2, L / 2), R(-3, 0) * res, 2.5 * res, pick(P.moss), 0.8, undefined, 0.6, false); g.restore(); }

  // overlays: sun haze + light shafts (world-sized, low-res)
  Art.paintLight = function (w, h) {
    const c = Art.mkCanvas(w / 4, h / 4), g = c.getContext('2d');
    const gr = g.createRadialGradient(c.width * 0.9, -c.height * 0.05, 10, c.width * 0.9, 0, c.width * 1.3);
    gr.addColorStop(0, 'rgba(255,236,170,0.55)'); gr.addColorStop(0.5, 'rgba(255,226,150,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
    g.save(); g.rotate(-0.5);
    for (let k = 0; k < 7; k++) { const x = R(-0.2, 1.1) * c.width, wd = R(12, 40); const lg = g.createLinearGradient(x, 0, x + wd, 0); lg.addColorStop(0, 'rgba(255,240,190,0)'); lg.addColorStop(0.5, `rgba(255,240,190,${R(0.07, 0.16)})`); lg.addColorStop(1, 'rgba(255,240,190,0)'); g.fillStyle = lg; g.fillRect(x, -c.height, wd, c.height * 3); }
    g.restore(); return c;
  };
  Art.paintGrain = function () { const c = Art.mkCanvas(256, 256), g = c.getContext('2d'); const d = g.createImageData(256, 256); for (let i = 0; i < d.data.length; i += 4) { const v = 128 + (rnd() - 0.5) * 60; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } g.putImageData(d, 0, 0); return c; };

  // grass tuft sprites (drawn live, bend with wind & trampling)
  Art.makeTufts = function (n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = Art.mkCanvas(40, 48), g = c.getContext('2d'); const base = jit(pick(P.grass), 0.1);
      for (let k = 0; k < 7; k++) { const a = -1.57 + R(-0.7, 0.7); stroke(g, 20 + R(-6, 6), 44, R(18, 40), R(1.4, 2.6), a, rnd() < 0.45 ? shade(base, 0.3) : rnd() < 0.5 ? shade(base, -0.12) : shade(base, 0.12), 0.9, R(-7, 7)); }
      if (rnd() < 0.25) { g.fillStyle = pick(P.flowers); g.beginPath(); g.arc(20 + R(-8, 8), R(8, 18), 2.6, 0, 6.283); g.fill(); }
      out.push(c);
    }
    return out;
  };

  // ---- flags & emblems ---------------------------------------------------------
  Art.EMBLEMS = ['tree', 'cross', 'saltire', 'star', 'sun', 'chevron', 'crescent', 'boar'];
  Art.drawEmblem = function (g, kind, cx, cy, s, col) {
    g.save(); g.translate(cx, cy); g.fillStyle = col; g.strokeStyle = col; g.lineWidth = s * 0.18; g.lineCap = 'round';
    switch (kind) {
      case 'cross': g.fillRect(-s * 0.12, -s * 0.5, s * 0.24, s); g.fillRect(-s * 0.5, -s * 0.12, s, s * 0.24); break;
      case 'saltire': g.rotate(0.785); g.fillRect(-s * 0.1, -s * 0.62, s * 0.2, s * 1.24); g.fillRect(-s * 0.62, -s * 0.1, s * 1.24, s * 0.2); break;
      case 'star': g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.2 : s * 0.48, a = -1.57 + (i * Math.PI) / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.fill(); break;
      case 'sun': g.beginPath(); g.arc(0, 0, s * 0.22, 0, 6.283); g.fill(); for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.283; g.beginPath(); g.moveTo(Math.cos(a) * s * 0.3, Math.sin(a) * s * 0.3); g.lineTo(Math.cos(a) * s * 0.48, Math.sin(a) * s * 0.48); g.stroke(); } break;
      case 'chevron': g.lineWidth = s * 0.22; g.beginPath(); g.moveTo(-s * 0.45, s * 0.25); g.lineTo(0, -s * 0.2); g.lineTo(s * 0.45, s * 0.25); g.stroke(); break;
      case 'crescent': g.beginPath(); g.arc(0, 0, s * 0.4, 0, 6.283); g.fill(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(s * 0.16, -s * 0.06, s * 0.33, 0, 6.283); g.fill(); break;
      case 'tree': g.fillRect(-s * 0.06, 0, s * 0.12, s * 0.45); g.beginPath(); g.moveTo(0, -s * 0.5); g.lineTo(s * 0.34, 0.05 * s); g.lineTo(-s * 0.34, 0.05 * s); g.fill(); g.beginPath(); g.moveTo(0, -s * 0.25); g.lineTo(s * 0.4, s * 0.25); g.lineTo(-s * 0.4, s * 0.25); g.fill(); break;
      case 'boar': g.beginPath(); g.ellipse(0, s * 0.05, s * 0.4, s * 0.22, 0, 0, 6.283); g.fill(); g.fillRect(-s * 0.3, s * 0.15, s * 0.08, s * 0.25); g.fillRect(s * 0.2, s * 0.15, s * 0.08, s * 0.25); g.beginPath(); g.moveTo(s * 0.35, -s * 0.05); g.lineTo(s * 0.5, s * 0.02); g.lineTo(s * 0.36, s * 0.15); g.fill(); g.beginPath(); g.moveTo(-s * 0.2, -s * 0.15); g.lineTo(-s * 0.05, -s * 0.3); g.lineTo(s * 0.1, -s * 0.15); g.fill(); break;
    }
    g.restore();
  };
  // flag cloth texture (w x h px) — used for in-world waving flag and UI
  Art.makeFlag = function (f, w = 120, h = 80) {
    const c = Art.mkCanvas(w, h), g = c.getContext('2d');
    g.fillStyle = f.field; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 60; k++) dab(g, rnd() * w, rnd() * h, R(4, 12), jit(f.field, 0.08), 0.25, 0, 0.5);
    g.fillStyle = shade(f.field, -0.25); g.fillRect(0, h - 6, w, 6);
    Art.drawEmblem(g, f.emblem, w * 0.52, h * 0.5, h * 0.72, f.emblemCol);
    for (let k = 0; k < 18; k++) stroke(g, rnd() * w, rnd() * h, R(6, 16), 1.5, R(-0.2, 0.2), '#ffffff', 0.08);
    return c;
  };

  // ---- soldier sprites (top-down, facing +x). px per world unit = SPR --------
  const SPR = 5; Art.SPR = SPR;
  const BOX = 44; // world units
  function body(g, team, o) {
    const s = SPR;
    // soft drop shadow
    // boots peeking (walk anim)
    if (o.step !== undefined) { g.fillStyle = '#3a2c22'; g.beginPath(); g.ellipse((o.step * 2.6) * s, -1.7 * s, 1.6 * s, 1.0 * s, 0, 0, 6.283); g.fill(); g.beginPath(); g.ellipse((-o.step * 2.6) * s, 1.7 * s, 1.6 * s, 1.0 * s, 0, 0, 6.283); g.fill(); }
    // shoulders / tunic
    const tun = team.tunic;
    g.fillStyle = '#120c08'; g.beginPath(); g.ellipse(0, 0, 3.75 * s, 5.05 * s, 0, 0, 6.283); g.fill();
    g.fillStyle = shade(tun, -0.45); g.beginPath(); g.ellipse(0, 0, 3.3 * s, 4.6 * s, 0, 0, 6.283); g.fill();
    g.fillStyle = tun; g.beginPath(); g.ellipse(-0.2 * s, -0.2 * s, 3.0 * s, 4.2 * s, 0, 0, 6.283); g.fill();
    g.globalAlpha = 0.5; g.fillStyle = shade(tun, 0.25); g.beginPath(); g.ellipse(-0.8 * s, -1.4 * s, 1.5 * s, 2.2 * s, 0.3, 0, 6.283); g.fill(); g.globalAlpha = 1;
    // brown belt hint / mail collar
    g.fillStyle = '#6b6a66'; g.beginPath(); g.ellipse(0.4 * s, 0, 1.9 * s, 2.3 * s, 0, 0, 6.283); g.fill();
  }
  function helmet(g, team) {
    const s = SPR, h = team.helmet;
    g.save(); g.translate(0.5 * s, 0); g.scale(0.78, 0.78); g.translate(-0.5 * s, 0);
    g.fillStyle = '#100c0a'; g.beginPath(); g.arc(0.5 * s, 0, 2.85 * s, 0, 6.283); g.fill();
    g.fillStyle = shade(h, -0.35); g.beginPath(); g.arc(0.5 * s, 0, 2.5 * s, 0, 6.283); g.fill(); // brim
    const gr = g.createRadialGradient(-0.3 * s, -0.7 * s, 0.1 * s, 0.4 * s, 0, 2.1 * s);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.25, shade(h, 0.35)); gr.addColorStop(0.7, h); gr.addColorStop(1, shade(h, -0.4));
    g.fillStyle = gr; g.beginPath(); g.arc(0.4 * s, -0.1 * s, 1.95 * s, 0, 6.283); g.fill(); g.restore();
  }
  function shield(g, team, x, y, ang) {
    const s = SPR; g.save(); g.translate(x * s, y * s); g.rotate(ang);
    g.scale(1.15, 1.25); g.fillStyle = '#140e0a'; g.beginPath(); g.moveTo(-2.8 * s, -1.3 * s); g.quadraticCurveTo(0, -1.9 * s, 3.4 * s, -0.2 * s); g.lineTo(3.4 * s, 0.6 * s); g.quadraticCurveTo(0, 1.0 * s, -2.8 * s, 0.4 * s); g.closePath(); g.fill();
    g.fillStyle = team.shield; g.beginPath(); g.moveTo(-2.4 * s, -1.0 * s); g.quadraticCurveTo(0, -1.5 * s, 3.0 * s, -0.2 * s); g.lineTo(3.0 * s, 0.3 * s); g.quadraticCurveTo(0, 0.6 * s, -2.4 * s, 0.1 * s); g.closePath(); g.fill();
    g.strokeStyle = '#d6d2c4'; g.lineWidth = 0.3 * s; g.stroke(); g.restore();
  }
  function spear(g, x0, x1, y) { const s = SPR; g.strokeStyle = '#3b2a1c'; g.lineWidth = 0.55 * s; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0 * s, y * s); g.lineTo(x1 * s, y * s); g.stroke(); g.fillStyle = '#c9c9c2'; g.beginPath(); g.moveTo(x1 * s, (y - 0.7) * s); g.lineTo((x1 + 2.4) * s, y * s); g.lineTo(x1 * s, (y + 0.7) * s); g.fill(); }
  function bow(g, x, y, drawn) { const s = SPR; g.strokeStyle = '#5a3d22'; g.lineWidth = 0.6 * s; g.beginPath(); g.arc((x - 2.2) * s, y * s, 3.6 * s, -1.0, 1.0); g.stroke(); g.strokeStyle = '#ddd8c6'; g.lineWidth = 0.18 * s; const bx = (x - 2.2) * s + Math.cos(1) * 3.6 * s; g.beginPath(); g.moveTo(bx, (y - 3.0) * s); g.lineTo((x - (drawn ? 3.6 : 0.3)) * s, y * s); g.lineTo(bx, (y + 3.0) * s); g.stroke(); if (drawn) { g.strokeStyle = '#d8cfb8'; g.lineWidth = 0.25 * s; g.beginPath(); g.moveTo((x - 3.6) * s, y * s); g.lineTo((x + 2.2) * s, y * s); g.stroke(); } }
  function quiver(g) { const s = SPR; g.fillStyle = '#6a4a2c'; g.save(); g.rotate(0.5); g.fillRect(-3.6 * s, -0.8 * s, 3.4 * s, 1.6 * s); g.fillStyle = '#e9e2cf'; g.fillRect(-4.2 * s, -0.6 * s, 0.8 * s, 1.2 * s); g.restore(); }

  const BUILDERS = {
    spearman(team, pose, step) {
      const c = Art.mkCanvas(BOX * SPR, BOX * SPR), g = c.getContext('2d'); g.translate(c.width / 2, c.height / 2);
      body(g, team, { step });
      const thrust = pose === 'attack' ? 4 : pose === 'brace' ? 1.5 : 0;
      // arms
      g.fillStyle = shade(team.tunic, -0.15); g.beginPath(); g.ellipse((1.6 + thrust * 0.3) * SPR, 2.6 * SPR, 1.6 * SPR, 0.9 * SPR, 0.2, 0, 6.283); g.fill();
      spear(g, -7 + thrust, 13 + thrust, 2.9);
      shield(g, team, 1.9, -3.2, pose === 'brace' ? 0.15 : 0.35);
      helmet(g, team); return c;
    },
    archer(team, pose, step) {
      const c = Art.mkCanvas(BOX * SPR, BOX * SPR), g = c.getContext('2d'); g.translate(c.width / 2, c.height / 2);
      body(g, team, { step }); quiver(g);
      g.fillStyle = shade(team.tunic, -0.15); g.beginPath(); g.ellipse(2.4 * SPR, -0.4 * SPR, 2.0 * SPR, 0.9 * SPR, 0, 0, 6.283); g.fill();
      bow(g, 5.2, -0.2, pose === 'attack');
      // archers: soft cap/hood instead of kettle helm (slightly darker helmet colour)
      helmet(g, { helmet: Art.mix(team.helmet, team.tunic, 0.35) }); return c;
    },
  };
  Art.buildSprites = function (team, typeId) {
    const t = UNIT_TYPES[typeId]; const b = BUILDERS[t.sprite] || BUILDERS.spearman;
    return { idle: b(team, 'idle'), walk: [b(team, 'walk', 1), b(team, 'walk', 0), b(team, 'walk', -1), b(team, 'walk', 0)], attack: b(team, 'attack'), brace: b(team, 'brace'), box: BOX };
  };

  // dead body stamped onto the ground (like ref 5: lying, spear & shield beside)
  Art.stampDead = function (g, x, y, ang, team, typeId, res, helmetOff) {
    const s = res; g.save(); g.translate(x * res, y * res); g.rotate(ang);
    g.globalAlpha = 0.5; g.fillStyle = '#0c0a06'; g.beginPath(); g.ellipse(0, 0, 7.6 * s, 3.9 * s, 0, 0, 6.283); g.fill(); g.globalAlpha = 1;
    g.fillStyle = '#3a2c22'; g.beginPath(); g.ellipse(-6 * s, -1.1 * s, 1.6 * s, 0.9 * s, 0.2, 0, 6.283); g.fill(); g.beginPath(); g.ellipse(-5.6 * s, 1.4 * s, 1.6 * s, 0.9 * s, -0.3, 0, 6.283); g.fill();
    g.fillStyle = shade(team.tunic, -0.3); g.beginPath(); g.ellipse(-0.5 * s, 0, 5.3 * s, 2.9 * s, 0, 0, 6.283); g.fill();
    g.fillStyle = shade(team.tunic, -0.08); g.beginPath(); g.ellipse(-0.3 * s, -0.3 * s, 4.6 * s, 2.4 * s, 0, 0, 6.283); g.fill();
    g.fillStyle = shade(team.tunic, -0.15); g.beginPath(); g.ellipse(2.5 * s, 3 * s, 2.2 * s, 0.8 * s, 0.9, 0, 6.283); g.fill();
    g.fillStyle = '#d8b494'; g.beginPath(); g.arc(5 * s, 0, 1.4 * s, 0, 6.283); g.fill();
    if (!helmetOff) { g.fillStyle = shade(team.helmet, -0.15); g.beginPath(); g.arc(5.3 * s, 0, 1.9 * s, 0, 6.283); g.fill(); }
    if (typeId === 'archer') { g.strokeStyle = '#5a3d22'; g.lineWidth = 0.6 * s; g.beginPath(); g.arc(1 * s, -5 * s, 4 * s, 0.2, 2.6); g.stroke(); }
    else { g.strokeStyle = '#3b2a1c'; g.lineWidth = 0.55 * s; g.beginPath(); g.moveTo(-8 * s, 4.5 * s); g.lineTo(10 * s, 3.2 * s); g.stroke(); g.fillStyle = '#c9c9c2'; g.beginPath(); g.moveTo(10 * s, 2.6 * s); g.lineTo(12.4 * s, 3.1 * s); g.lineTo(10 * s, 3.8 * s); g.fill();
      g.fillStyle = '#5c4630'; g.beginPath(); g.ellipse(-1 * s, -4.6 * s, 3.2 * s, 1.9 * s, 0.4, 0, 6.283); g.fill(); g.fillStyle = team.shield; g.beginPath(); g.ellipse(-1 * s, -4.6 * s, 2.7 * s, 1.5 * s, 0.4, 0, 6.283); g.fill(); }
    g.restore();
  };
  // gouache blood splat
  Art.stampBlood = function (g, x, y, r, res, dirx = 0, diry = 0, a = 0.75) {
    const DM = (CONFIG.world.decalMul || 1); x *= res; y *= res; r *= res * DM; a = Math.min(1, a * (CONFIG.world.decalAlphaMul || 1));
    const cols = CONFIG.world.darkBlood ? ['#2e0303', '#3d0605', '#220202', '#4a0807'] : ['#4a0606', '#5e0c0a', '#3a0404', '#6e120e'];
    dab(g, x, y, r, pick(cols), a * 0.8, undefined, R(0.5, 0.9), false);
    for (let k = 0; k < 5; k++) { const d = R(0.6, 2.2) * r; dab(g, x + dirx * d + R(-r, r) * 0.6, y + diry * d + R(-r, r) * 0.6, r * R(0.15, 0.4), pick(cols), a, undefined, 0.8, false); }
  };
  Art.stampMud = function (g, x, y, r, res, a) { const DM = (CONFIG.world.decalMul || 1); dab(g, x * res, y * res, r * res * DM, CONFIG.world.darkBlood ? jit(pick(['#2e2010', '#24180c', '#3a2a16']), 0.08) : jit(pick(P.mud), 0.1), Math.min(1, a * (CONFIG.world.decalAlphaMul || 1)), undefined, 0.7, false); };
  window.Art = Art;
})();
