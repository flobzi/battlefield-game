// BATTLE FIELD GAME — simulation, input, bot, rendering, UI glue.
(function () {
  const C = CONFIG, MV = C.move, CB = C.combat;
  const Q = new URLSearchParams(location.search);
  const AUTO = Q.has('auto');
  const WARP = Math.max(1, Math.min(8, Number(Q.get('warp')) || 1));                       // demo: both sides bot-controlled (screenshots)
  const cv = document.getElementById('game'), ctx = cv.getContext('2d');
  const R3D = window.R3D || null;                   // 3D renderer hook (3d/index.html); null = classic 2D build
  let DPR = Math.min(window.devicePixelRatio || 1, 2.5), SW = 0, SH = 0;
  const rand = Math.random, clamp = (v, a, b) => (v < a ? a : v > b ? b : v), lerp = (a, b, t) => a + (b - a) * t;
  const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 6.283185; while (d < -Math.PI) d += 6.283185; return d; };

  // ---------------------------------------------------------------- world ---
  let WW, WH, COLS, ROWS, MAP, ground, gctx, light, grain, tuftSprites, vignette, grade, shadowSpr;
  let tuft = null, TR = 8, TW, TH, trample, trampleDx, mudGrid;
  function buildWorld(seed) {
    Art.seed(seed);
    COLS = Math.ceil(C.world.w / C.world.cell); ROWS = Math.ceil(C.world.h / C.world.cell);
    WW = COLS * C.world.cell; WH = ROWS * C.world.cell;
    MAP = Art.generateMap(COLS, ROWS);
    ground = Art.paintGround(MAP, COLS, ROWS, C.world.cell, C.world.groundRes); gctx = ground.getContext('2d');
    light = Art.paintLight(WW, WH); if (!grain) grain = Art.paintGrain();
    tuftSprites = Art.makeTufts(10);
    TW = Math.ceil(WW / TR); TH = Math.ceil(WH / TR);
    trample = new Float32Array(TW * TH); trampleDx = new Float32Array(TW * TH); mudGrid = new Float32Array(TW * TH);
    const n = C.grass.tufts, tx = new Float32Array(n), ty = new Float32Array(n), tv = new Uint8Array(n), ts = new Float32Array(n);
    let k = 0, guard = 0;
    while (k < n && guard++ < n * 20) {
      const x = Art.rnd() * WW, y = Art.rnd() * WH; const t = terrainAt(x, y);
      if (t === 'grass' || t === 'clover' || t === 'flowers' || (t === 'bank' && Art.rnd() < 0.3)) { tx[k] = x; ty[k] = y; tv[k] = (Art.rnd() * tuftSprites.length) | 0; ts[k] = 0.7 + Art.rnd() * 0.6; k++; }
    }
    tuft = { n: k, tx, ty, tv, ts };
  }
  const terrainAt = (x, y) => MAP[clamp((y / C.world.cell) | 0, 0, ROWS - 1) * COLS + clamp((x / C.world.cell) | 0, 0, COLS - 1)];
  const speedAt = (x, y) => Art.TERRAIN_SPEED[terrainAt(x, y)] || 1;

  // ---------------------------------------------------------------- teams ---
  const PALETTE = { tunic: ['#a3191b', '#2c5a92', '#2f7a2a', '#c48a12', '#6a2a86', '#147a74', '#e6e0cc', '#26262a'], helmet: ['#a9b0b8', '#8a9098', '#c9b27a', '#5a5e64', '#d8dce0'], shield: ['#8e1214', '#234c80', '#2a6a24', '#b07a10', '#5a2276', '#e8e0c4', '#1e1e22', '#6a4a2a'], field: ['#5d8a4a', '#a5523a', '#b8893a', '#4c6a8c', '#6e4f78', '#e8e0c4', '#2f3a2a', '#8a3a3a'], emblemCol: ['#f2ead2', '#e8c23a', '#2b2218', '#a5523a', '#4c6a8c'] };
  const BOT_NAMES = ['Ochre Host', 'Red Fen Levy', 'Azure Vale Guard', 'Wolfmoor Spears', 'Saltmarsh Company', 'Iron Crow Band', 'Thornwall Militia', 'Duskvale Host'];
  // colour words in a name must agree with the army's tunic (PALETTE.tunic index) -- no blue "Red Fen Levy"
  const NAME_HUE = { red: 0, crimson: 0, scarlet: 0, blue: 1, azure: 1, green: 2, ochre: 3, gold: 3, golden: 3, purple: 4, violet: 4, teal: 5, white: 6, black: 7 };
  const nameFits = (name, tunicIdx) => name.toLowerCase().split(/[^a-z]+/).every((w) => !(w in NAME_HUE) || NAME_HUE[w] === tunicIdx);
  const defaultPlayer = { name: 'Crimson Host', tunic: '#a3191b', helmet: '#a9b0b8', shield: '#8e1214', flag: { field: '#a3191b', emblem: 'boar', emblemCol: '#e8c23a' } };
  let playerCfg = Object.assign({}, defaultPlayer, JSON.parse(localStorage.getItem('bf_army') || 'null') || {});
  function randomBot() {
    // pick a strongly contrasting tunic (one of the 2 most distant colours); shield matches tunic family
    const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)), pc = rgb(playerCfg.tunic);
    const far = PALETTE.tunic.slice(0, 6).map((c, i) => [c, i, rgb(c).reduce((a, v, j) => a + (v - pc[j]) ** 2, 0)]).sort((a, b) => b[2] - a[2]);
    const p = (a) => a[(rand() * a.length) | 0]; const reddish = pc[0] > pc[1] * 1.6 && pc[0] > pc[2] * 1.6;
    const pickT = reddish ? [PALETTE.tunic[1], 1] : far[(rand() * 2) | 0], tunic = pickT[0]; // classic red vs steel-blue
    const names = BOT_NAMES.filter((n) => nameFits(n, pickT[1]) && n !== playerCfg.name);
    return { name: p(names.length ? names : ['Duskvale Host']), tunic, helmet: p(PALETTE.helmet.slice(0, 4)), shield: PALETTE.shield[pickT[1]], flag: { field: tunic, emblem: p(Art.EMBLEMS.filter((e) => e !== playerCfg.flag.emblem)), emblemCol: p(PALETTE.emblemCol) } };
  }
  let teams = [], men = [], groups = [], nextGroupId = 1;
  function makeTeam(i, cfg) {
    const t = Object.assign({ id: i, alive: 0, initial: 0, routed: false, kills: 0 }, cfg);
    t.sprites = {}; for (const k in UNIT_TYPES) if (UNIT_TYPES[k].enabled) t.sprites[k] = Art.buildSprites(t, k);
    t.flagCanvas = Art.makeFlag(t.flag); t.front = i === 0 ? -Math.PI / 2 : Math.PI / 2; return t;
  }
  function newGroup(team) { const g = { id: nextGroupId++, team, dir: { x: 0, y: 0 }, throttle: 0, moving: false, heading: teams[team].front, ax: 0, ay: 0, vx: 0, vy: 0, n: 0, cx: 0, cy: 0, members: [] }; groups.push(g); return g; }
  function spawnArmies() {
    men = []; groups = []; nextGroupId = 1;
    for (let ti = 0; ti < 2; ti++) {
      const t = teams[ti]; const g = newGroup(ti); const sp = C.armies.spacing, cols = C.armies.columns;
      const frontY = WH / 2 + (ti === 0 ? 1 : -1) * C.armies.gapY / 2; const back = ti === 0 ? 1 : -1;
      let row = 0, col = 0; const list = [];
      for (const comp of C.armies.composition) { const T = UNIT_TYPES[comp.type]; if (!T || !T.enabled) continue; for (let k = 0; k < comp.count; k++) list.push(comp.type); }
      for (const type of list) {
        const T = UNIT_TYPES[type];
        const x = WW / 2 + (col - (cols - 1) / 2) * sp + (rand() - 0.5) * 2, y = frontY + back * row * sp + (rand() - 0.5) * 2;
        const m = { id: men.length, team: ti, type, T, x, y, vx: 0, vy: 0, face: t.front, hp: 0, str: lerp(T.str[0], T.str[1], rand()), spd: lerp(T.spd[0], T.spd[1], rand()), stam: 1, cd: rand(), atk: 0, step: rand() * 4, alive: true, group: g, reload: 1 + rand() * 2, engaged: false, flee: false, bearer: false, aim: 0, lastHit: 0 };
        m.hp = m.maxHp = lerp(T.hp[0], T.hp[1], rand());
        men.push(m); g.members.push(m);
        if (++col >= cols) { col = 0; row++; }
      }
      // standard bearer: front-centre spearman
      let best = null, bd = 1e9; for (const m of g.members) { const d = Math.abs(m.x - WW / 2) + Math.abs(m.y - frontY) * 2; if (m.type === 'spearman' && d < bd) { bd = d; best = m; } }
      if (best) { best.bearer = true; best.hp = best.maxHp *= 1.3; }
      t.alive = t.initial = g.members.length; t.routed = false; t.kills = 0;
      reformGroup(g, true);
    }
  }
  // assign formation slots (ranks): spearmen front, archers back; preserves relative positions → no crossing
  function reformGroup(g, keepAnchor) {
    const ms = g.members.filter((m) => m.alive); g.members = ms; if (!ms.length) return;
    let cx = 0, cy = 0; for (const m of ms) { cx += m.x; cy += m.y; } cx /= ms.length; cy /= ms.length;
    const hx = Math.cos(g.heading), hy = Math.sin(g.heading), rx = -hy, ry = hx;
    for (const m of ms) { const dx = m.x - cx, dy = m.y - cy; m._d = -(dx * hx + dy * hy) + (m.type === 'archer' ? 1e4 : 0) + (m.bearer ? -1e4 : 0); m._l = dx * rx + dy * ry; }
    ms.sort((a, b) => a._d - b._d);
    const n = ms.length, sp = C.armies.spacing; const cols = Math.max(1, Math.min(C.armies.columns, Math.round(Math.sqrt(n * 2.4))));
    for (let r = 0; r * cols < n; r++) {
      const row = ms.slice(r * cols, r * cols + cols).sort((a, b) => a._l - b._l); const w = row.length;
      row.forEach((m, i) => { m.sl = (i - (w - 1) / 2) * sp; m.sd = r * sp; });
    }
    const depth = Math.ceil(n / cols) * sp;
    // anchor = formation front-centre
    const ax = cx + hx * depth / 2, ay = cy + hy * depth / 2;
    if (!keepAnchor || !g.ax) { g.ax = ax; g.ay = ay; } else { g.ax = ax; g.ay = ay; }
  }

  // ------------------------------------------------------------- commands ---
  // Single entry point for player input, bot, and (later) network peers.
  const Commands = {
    issue(team, cmd) { // cmd: {type:'move', group, dx, dy, throttle} | {type:'halt', group} | {type:'split', x, y, r} | {type:'splitType', unitType} | {type:'merge'} | {type:'rally'}
      if (window.NetHook) window.NetHook(team, cmd);   // multiplayer: forward to peer here
      apply(team, cmd);
    },
  };
  function apply(team, cmd) {
    const gs = groups.filter((g) => g.team === team && g.members.length);
    if (cmd.type === 'move') {
      const g = groups.find((x) => x.id === cmd.group); if (!g) return;
      const l = Math.hypot(cmd.dx, cmd.dy) || 1; g.dir.x = cmd.dx / l; g.dir.y = cmd.dy / l;
      const prev = g.throttle; g.throttle = clamp(cmd.throttle, 0, 1); g.moving = g.throttle > 0.01;
      if (prev < 0.8 && g.throttle >= 0.8 && g.members.length > 15) onCharge(g);
    } else if (cmd.type === 'halt') { const g = groups.find((x) => x.id === cmd.group); if (g) { g.throttle = 0; g.moving = false; } }
    else if (cmd.type === 'split' || cmd.type === 'splitType') {
      let src = null, picked = [];
      if (cmd.type === 'split') {
        let bd = 1e9; for (const m of men) if (m.alive && m.team === team) { const d = Math.hypot(m.x - cmd.x, m.y - cmd.y); if (d < bd) { bd = d; src = m.group; } }
        if (!src) return null; picked = src.members.filter((m) => m.alive && Math.hypot(m.x - cmd.x, m.y - cmd.y) < (cmd.r || C.control.splitRadius));
      } else { src = gs.find((g) => g.members.some((m) => m.type === cmd.unitType)); if (!src) return null; picked = src.members.filter((m) => m.type === cmd.unitType); }
      if (picked.length < 4 || picked.length >= src.members.length - 2) return src;
      const ng = newGroup(team); ng.heading = src.heading; ng.throttle = 0; ng.dir = { x: src.dir.x, y: src.dir.y };
      const set = new Set(picked); src.members = src.members.filter((m) => !set.has(m)); ng.members = picked; picked.forEach((m) => (m.group = ng));
      reformGroup(src); reformGroup(ng); return ng;
    } else if (cmd.type === 'merge' || cmd.type === 'rally') {
      if (!gs.length) return; const main = gs.reduce((a, b) => (b.members.length > a.members.length ? b : a));
      for (const g of gs) if (g !== main) { g.members.forEach((m) => (m.group = main)); main.members.push(...g.members); g.members = []; }
      if (cmd.type === 'rally') { main.throttle = 0; main.moving = false; main.heading = teams[team].front; }
      reformGroup(main); groups = groups.filter((g) => g.members.length); return main;
    }
  }
  const speedFor = (t) => (t < 0.45 ? lerp(MV.walk * 0.5, MV.walk, t / 0.45) : t < 0.82 ? lerp(MV.walk, MV.run, (t - 0.45) / 0.37) : lerp(MV.run, MV.charge, Math.min(1, (t - 0.82) / 0.18)));

  // ----------------------------------------------------------- spatial grid ---
  const GC = 24; let GWc, GHc, head, nxt;
  function buildGrid() {
    GWc = Math.ceil(WW / GC) + 1; GHc = Math.ceil(WH / GC) + 1;
    if (!head || head.length !== GWc * GHc) head = new Int32Array(GWc * GHc); head.fill(-1);
    if (!nxt || nxt.length < men.length) nxt = new Int32Array(men.length);
    for (let i = 0; i < men.length; i++) { const m = men[i]; if (!m.alive) continue; const c = clamp((m.y / GC) | 0, 0, GHc - 1) * GWc + clamp((m.x / GC) | 0, 0, GWc - 1); nxt[i] = head[c]; head[c] = i; }
  }
  function forNear(x, y, r, fn) {
    const x0 = clamp(((x - r) / GC) | 0, 0, GWc - 1), x1 = clamp(((x + r) / GC) | 0, 0, GWc - 1), y0 = clamp(((y - r) / GC) | 0, 0, GHc - 1), y1 = clamp(((y + r) / GC) | 0, 0, GHc - 1);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) for (let i = head[cy * GWc + cx]; i !== -1; i = nxt[i]) fn(men[i]);
  }

  // ----------------------------------------------------------------- state ---
  let state = 'menu', time = 0, battleT = 0, selected = null, endT = 0;
  const stats = { engaged: 0, walkers: 0, runners: 0, chargers: 0, movers: 0, mudUnder: 0, deathRate: 0, impact: 0 };
  let particles = [], arrows = [], decalQ = [];
  const cam = { x: 500, y: 650, z: 1 };

  // --------------------------------------------------------------- update ---
  function updateGroups(dt) {
    for (const g of groups) {
      g.members = g.members.filter((m) => m.alive); g.n = g.members.length; if (!g.n) continue;
      let cx = 0, cy = 0; for (const m of g.members) { cx += m.x; cy += m.y; } g.cx = cx / g.n; g.cy = cy / g.n;
      const t = teams[g.team]; let sp = g.moving ? speedFor(g.throttle) : 0;
      const fwd = Math.cos(t.front) * g.dir.x + Math.sin(t.front) * g.dir.y;
      if (g.moving && fwd < -0.3) sp = Math.min(sp, MV.run * C.control.retreatSpeedMul);
      // heading wheels toward forward-ish movement; strafing/backing keeps facing
      if (g.moving) { const ma = Math.atan2(g.dir.y, g.dir.x); const fd = Math.cos(g.heading) * g.dir.x + Math.sin(g.heading) * g.dir.y; if (fd > 0.2) g.heading += clamp(angDiff(g.heading, ma), -MV.turnRate * dt * 0.5, MV.turnRate * dt * 0.5); }
      const tvx = g.dir.x * sp, tvy = g.dir.y * sp;
      g.vx = lerp(g.vx, tvx, Math.min(1, dt * 2.5)); g.vy = lerp(g.vy, tvy, Math.min(1, dt * 2.5));
      g.ax += g.vx * dt; g.ay += g.vy * dt;
      // leash the anchor to the men so it never runs away
      const hx = Math.cos(g.heading), hy = Math.sin(g.heading);
      let sx = 0, sy = 0; for (const m of g.members) { sx += m.sd; } const meanD = sx / g.n;
      const fcx = g.cx + hx * meanD, fcy = g.cy + hy * meanD; const lx = g.ax - fcx, ly = g.ay - fcy, ll = Math.hypot(lx, ly), maxL = 26;
      if (ll > maxL) { g.ax = fcx + (lx / ll) * maxL; g.ay = fcy + (ly / ll) * maxL; }
      g.ax = clamp(g.ax, 10, WW - 10); g.ay = clamp(g.ay, 10, WH - 10);
    }
    groups = groups.filter((g) => g.members.length || g === selected);
  }

  function updateMen(dt) {
    buildGrid();
    stats.engaged = stats.walkers = stats.runners = stats.chargers = stats.movers = 0; let mudSum = 0;
    for (const m of men) {
      if (!m.alive) continue; const T = m.T, g = m.group, team = teams[m.team];
      // nearest enemy
      let ne = null, nd = MV.engageRadius;
      forNear(m.x, m.y, MV.engageRadius, (o) => { if (o.team !== m.team) { const d = Math.hypot(o.x - m.x, o.y - m.y); if (d < nd) { nd = d; ne = o; } } });
      const stamMul = C.stamina.minSpeedMul + (1 - C.stamina.minSpeedMul) * m.stam;
      const maxSp = MV.charge * 1.05 * m.spd * stamMul * speedAt(m.x, m.y);
      let dx = 0, dy = 0, faceTo = null;
      m.engaged = false;
      const hx = Math.cos(g.heading), hy = Math.sin(g.heading);
      if (m.flee) { dx = 0; dy = -Math.sin(team.front) * MV.run * 1.1; dx = (m.x - WW / 2) * 0.05; }
      else if (ne && (T.behaviour === 'melee' || nd < MV.engageRadius * 0.55)) {
        m.engaged = true; const ux = (ne.x - m.x) / (nd || 1), uy = (ne.y - m.y) / (nd || 1);
        const gs = Math.hypot(g.vx, g.vy); const push = nd > T.reach * 0.8 ? Math.max(gs, MV.walk * 1.2) : 4;
        dx = ux * push * MV.engageK + g.vx * 0.15; dy = uy * push * MV.engageK + g.vy * 0.15; faceTo = Math.atan2(uy, ux);
      } else {
        const rx = -hy, ry = hx; const tx = g.ax + rx * m.sl - hx * m.sd, ty = g.ay + ry * m.sl - hy * m.sd;
        dx = (tx - m.x) * MV.formationK + g.vx; dy = (ty - m.y) * MV.formationK + g.vy;
        if (T.behaviour === 'ranged') archerThink(m, dt, g);
      }
      if (m.aim > 0) { m.aim -= dt; faceTo = m.aimAng; }
      // separation (allies soft, enemies hard: bodies collide)
      let px = 0, py = 0; const sep = MV.separation;
      forNear(m.x, m.y, sep, (o) => { if (o === m) return; const ox = m.x - o.x, oy = m.y - o.y, d2 = ox * ox + oy * oy; if (d2 > sep * sep || d2 < 1e-4) return; const d = Math.sqrt(d2), f = (sep - d) / sep * (o.team === m.team ? MV.sepK : MV.enemySepK); px += (ox / d) * f; py += (oy / d) * f; });
      // steer
      let dl = Math.hypot(dx, dy); if (dl > maxSp) { dx = dx / dl * maxSp; dy = dy / dl * maxSp; }
      let ex = dx - m.vx, ey = dy - m.vy; const el = Math.hypot(ex, ey), acc = MV.accel * dt * 2;
      if (el > acc) { ex = ex / el * acc; ey = ey / el * acc; }
      m.vx += ex; m.vy += ey;
      m.x = clamp(m.x + (m.vx + px * 0.12) * dt, 3, WW - 3); m.y = clamp(m.y + (m.vy + py * 0.12) * dt, 3, WH - 3);
      const sp = Math.hypot(m.vx, m.vy);
      // facing
      let fa = faceTo;
      if (fa === null) { if (sp > 6 && (m.vx * hx + m.vy * hy > -0.25 * sp || g.throttle > 0.5 || m.flee)) fa = Math.atan2(m.vy, m.vx); else fa = g.heading; }
      m.face += clamp(angDiff(m.face, fa), -8 * dt, 8 * dt);
      // stamina
      const S = C.stamina;
      if (sp > MV.run * 0.95) m.stam -= S.drainCharge * dt; else if (sp > MV.walk * 1.3) m.stam -= S.drainRun * dt; else if (m.engaged) m.stam -= S.drainFight * dt; else if (sp > 3) m.stam += S.recoverWalk * dt; else m.stam += S.recoverIdle * dt;
      m.stam = clamp(m.stam, 0, 1);
      m.step += sp * dt * 0.28; m.cd -= dt; m.atk -= dt; m.reload -= dt;
      // melee
      if (ne && !m.flee && m.cd <= 0 && nd < T.reach + ne.T.radius) attack(m, ne);
      // stats for audio / mud / grass
      if (m.engaged) stats.engaged++;
      if (sp > 3) {
        stats.movers++; if (sp > MV.run * 0.95) stats.chargers++; else if (sp > MV.walk * 1.3) stats.runners++; else if (!m.engaged) stats.walkers++;
        const ti = clamp((m.y / TR) | 0, 0, TH - 1) * TW + clamp((m.x / TR) | 0, 0, TW - 1);
        trample[ti] = Math.min(1, trample[ti] + dt * sp * C.grass.trampleK * 0.06); trampleDx[ti] = lerp(trampleDx[ti], m.vx / sp, 0.2);
        mudGrid[ti] = Math.min(3, mudGrid[ti] + dt * (sp / 60 + (m.engaged ? 0.25 : 0)) * 0.12); mudSum += Math.min(1, mudGrid[ti]);
        const ter = terrainAt(m.x, m.y); if (ter === 'mud' || ter === 'puddle' || ter === 'bank') mudSum += 0.6;
      } else if (m.engaged) { const ti = clamp((m.y / TR) | 0, 0, TH - 1) * TW + clamp((m.x / TR) | 0, 0, TW - 1); mudGrid[ti] = Math.min(3, mudGrid[ti] + dt * 0.04); }
    }
    stats.mudUnder = stats.movers ? mudSum / stats.movers : 0;
  }

  function archerThink(m, dt, g) {
    if (m.reload > 0 || Math.hypot(g.vx, g.vy) > m.T.volleyMoveMax) return;
    const foes = teams[1 - m.team]; let tgt = null;
    for (let k = 0; k < 8; k++) { const o = men[(rand() * men.length) | 0]; if (!o.alive || o.team === m.team) continue; const d = Math.hypot(o.x - m.x, o.y - m.y); if (d > m.T.minRange && d < m.T.range) { tgt = o; break; } }
    if (!tgt) { m.reload = 0.3; return; }
    const d = Math.hypot(tgt.x - m.x, tgt.y - m.y), A = C.arrows; const T = d / A.speed;
    const lx = tgt.x + tgt.vx * T + (rand() - 0.5) * A.spread * 2, ly = tgt.y + tgt.vy * T + (rand() - 0.5) * A.spread * 2;
    arrows.push({ x0: m.x, y0: m.y, x1: lx, y1: ly, t: 0, T, team: m.team, h: d * A.arcK, str: m.str });
    m.reload = lerp(m.T.reload[0], m.T.reload[1], rand()) * (1.4 - 0.4 * m.stam); m.atk = 0.35; m.aim = 0.5; m.aimAng = Math.atan2(ly - m.y, lx - m.x);
    // one volley sound per team every ~0.9s at the firing archers; whoosh timed to peak as arrows descend
    if (onScreen(m.x, m.y) && AudioSys.allowRate('volley' + m.team, 0.9)) AudioSys.play('arrow_loose', { vol: m.team === 0 ? 0.8 : 0.55, pan: panOf(m.x), pitchVar: 0.04 });
    if (AudioSys.allowRate('whoosh' + m.team, 0.8) && (onScreen(lx, ly) || onScreen(m.x, m.y))) AudioSys.playTimed('arrow_whoosh', T * 0.85, { vol: 0.7, pan: panOf(lx) });
  }

  function attack(a, d) {
    const dx = d.x - a.x, dy = d.y - a.y, dist = Math.hypot(dx, dy) || 1, ux = dx / dist, uy = dy / dist;
    a.cd = lerp(CB.cooldown[0], CB.cooldown[1], rand()) * (1.3 - 0.3 * a.stam); a.atk = 0.28; a.stam -= 0.01;
    const closing = Math.max(0, (a.vx - d.vx) * ux + (a.vy - d.vy) * uy);
    let momentum = 1 + CB.momentumK * Math.min(1.5, closing / MV.charge);
    const cosA = Math.cos(d.face) * -ux + Math.sin(d.face) * -uy; // >0: attacker in front of defender
    const angleF = cosA > 0.35 ? CB.angle.front : cosA > -0.35 ? CB.angle.side : CB.angle.rear;
    if (d.T.braceBonus && cosA > 0.35 && Math.hypot(d.vx, d.vy) < 12) momentum = 1 + (momentum - 1) / d.T.braceBonus;   // braced spears blunt charges
    let na = 0, nd = 0; forNear(d.x, d.y, CB.supportRadius, (o) => { if (o === d || o === a) return; if (Math.hypot(o.x - d.x, o.y - d.y) < CB.supportRadius) { if (o.team === a.team) na++; else nd++; } });
    const supF = clamp(1 + CB.supportK * (na - nd) / (na + nd + 1), 0.5, 1.8);
    const stamF = 0.55 + 0.45 * a.stam;
    const hitP = clamp(CB.baseHit * stamF * Math.sqrt(supF) * (angleF > 1 ? 1.3 : 1) * (0.8 + 0.2 * momentum), 0.05, 0.95);
    const vis = onScreen(d.x, d.y);
    if (a.team === 0 || d.team === 0) stats.impact += (momentum - 1) * 2 + (angleF - 1) * 0.6 + 0.15;
    if (rand() > hitP) { if (vis && rand() < 0.3) AudioSys.playLimited('clash', C.audio.clashPerSec, { vol: 0.5, pan: panOf(d.x) }); return; }
    if (d.T.shield && cosA > 0.35 && rand() < CB.shieldBlock * (0.4 + 0.6 * d.stam) / Math.sqrt(momentum)) {
      d.stam -= 0.03 * momentum; d.vx += ux * CB.knockback * 0.3 * momentum; d.vy += uy * CB.knockback * 0.3 * momentum;
      if (vis) AudioSys.playLimited('shield_block', 5, { vol: 0.6, pan: panOf(d.x) }); return;
    }
    const dmg = CB.baseDmg * (a.str / Math.sqrt(d.str)) * momentum * angleF * supF * stamF * (1 + (rand() * 2 - 1) * CB.randomness);
    d.hp -= dmg; d.lastHit = time;
    const kb = CB.knockback * (momentum - 0.7); d.vx += ux * kb; d.vy += uy * kb;
    if (vis) AudioSys.playLimited('clash', C.audio.clashPerSec, { vol: 0.8, pan: panOf(d.x), rate: 0.9 + rand() * 0.2 });
    if (d.hp <= 0) { teams[a.team].kills++; die(d, ux, uy, momentum * angleF); }
    else { decalQ.push(['blood', d.x, d.y, 1.6 + rand(), ux, uy, 0.55]); spawnBlood(d.x, d.y, ux, uy, 3, 0.6); if (vis && rand() < 0.35) AudioSys.playSliced('blood', { vol: 0.45, pan: panOf(d.x) }); }
  }

  function die(m, ux, uy, imp) {
    m.alive = false; teams[m.team].alive--; stats.deathRate += 1;
    const fly = clamp(imp, 1, 5); const vis = onScreen(m.x, m.y); const FM = C.fx.flingMul || 1, hv = 1 + (FM - 1) * clamp((fly - 1.2) / 1.5, 0, 1);   // flingMul: heavy impacts throw bodies further (3D)
    particles.push({ k: 'body', x: m.x, y: m.y, z: 1, vx: m.vx * 0.4 + ux * (14 + fly * 16) * (0.6 + rand()) * hv, vy: m.vy * 0.4 + uy * (14 + fly * 16) * (0.6 + rand()) * hv, vz: (18 + fly * 18 * rand()) * Math.sqrt(hv), heavy: hv > 1.3, r: m.face, vr: (rand() - 0.5) * 3 * fly, team: m.team, type: m.type, helmOff: false });
    const body = particles[particles.length - 1];
    if (rand() < 0.65) { body.helmOff = true; particles.push({ k: 'helmet', x: m.x, y: m.y, z: 4, vx: ux * 30 * fly * rand() + (rand() - 0.5) * 40, vy: uy * 30 * fly * rand() + (rand() - 0.5) * 40, vz: 40 + 50 * rand() * fly / 2, r: 0, vr: (rand() - 0.5) * 20, team: m.team, b: 1 }); }
    const items = m.T.dropItems || [];
    for (const it of items) if (it !== 'helmet' && rand() < 0.6) particles.push({ k: it, x: m.x, y: m.y, z: 4, vx: (rand() - 0.5) * 60 + ux * 20 * fly, vy: (rand() - 0.5) * 60 + uy * 20 * fly, vz: 30 + 60 * rand(), r: rand() * 6.28, vr: (rand() - 0.5) * 18, team: m.team, b: 0 });
    spawnBlood(m.x, m.y, ux, uy, (C.fx.bloodDrops[0] + rand() * (C.fx.bloodDrops[1] - C.fx.bloodDrops[0])) | 0, 1 + fly * 0.3);
    if (m.bearer) particles.push({ k: 'flag', x: m.x, y: m.y, z: 10, vx: ux * 20, vy: uy * 20, vz: 10, r: m.face, vr: 1, team: m.team, b: 0 });
    if (vis) { AudioSys.playSliced('blood', { vol: 0.8, pan: panOf(m.x) }); if (rand() < AUDIO_SLOTS.death_scream.chance) AudioSys.playLimited('death_scream', AUDIO_SLOTS.death_scream.perSec, { vol: 0.75, pan: panOf(m.x), pitchVar: 0.08 }); }
    if (particles.length > C.fx.maxParticles) particles.splice(0, particles.length - C.fx.maxParticles);
  }
  function spawnBlood(x, y, ux, uy, n, f) { for (let i = 0; i < n; i++) particles.push({ k: 'blood', x, y, z: 4 + rand() * 3, vx: ux * (20 + rand() * 50) * f + (rand() - 0.5) * 40, vy: uy * (20 + rand() * 50) * f + (rand() - 0.5) * 40, vz: 15 + rand() * 45 * f, r: 0, vr: 0, s: 0.6 + rand() * 0.9 }); }

  function updateParticles(dt) {
    const R = C.world.groundRes;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.vz -= 170 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.r += p.vr * dt;
      if (p.z <= 0) {
        if (p.k === 'helmet' && p.b > 0) { if (onScreen(p.x, p.y)) AudioSys.playSliced('armor_clank', { vol: 0.35, pan: panOf(p.x), rate: 1.15 });  p.b--; p.z = 0.1; p.vz = -p.vz * 0.35; p.vx *= 0.5; p.vy *= 0.5; continue; }
        p.z = 0; particles.splice(i, 1);
        if ((p.k === 'body' || p.k === 'helmet' || p.k === 'shield') && onScreen(p.x, p.y)) AudioSys.playSliced('armor_clank', { vol: p.k === 'body' ? 0.6 : 0.4, pan: panOf(p.x) });
        if (p.k === 'body') { decalQ.unshift(['bloodpool', p.x, p.y]); if (R3D) R3D.addDead(p); else decalQ.unshift(['body', p.x, p.y, p.r, p.team, p.type, p.helmOff]); }
        else if (R3D && p.k !== 'blood' && p.k !== 'flag') R3D.addItem(p);
        else if (p.k === 'blood') decalQ.push(['blood', p.x, p.y, p.s, 0, 0, 0.8]);
        else decalQ.unshift(['item', p.k, p.x, p.y, p.r, p.team]);
      }
    }
    for (let i = arrows.length - 1; i >= 0; i--) {
      const a = arrows[i]; a.t += dt / a.T; if (a.t < 1) continue; arrows.splice(i, 1);
      let hit = null; forNear(a.x1, a.y1, C.arrows.hitRadius, (o) => { if (!hit && o.team !== a.team && Math.hypot(o.x - a.x1, o.y - a.y1) < C.arrows.hitRadius) hit = o; });
      if (hit) {
        const ux = (a.x1 - a.x0), uy = (a.y1 - a.y0), l = Math.hypot(ux, uy) || 1; const cosA = Math.cos(hit.face) * -ux / l + Math.sin(hit.face) * -uy / l;
        if (hit.T.shield && cosA > 0.3 && rand() < C.arrows.shieldBlock) { if (onScreen(hit.x, hit.y)) AudioSys.playLimited('arrow_hit', 5, { vol: 0.4 }); decalQ.push(['arrow', a.x1, a.y1, Math.atan2(uy, ux)]); continue; }
        hit.hp -= C.arrows.damage * a.str * (0.6 + rand() * 0.8) * (cosA < -0.3 ? 1.5 : 1);
        if (onScreen(hit.x, hit.y)) AudioSys.playLimited('arrow_hit', 5, { vol: 0.6 });
        if (hit.hp <= 0) { teams[a.team].kills++; die(hit, ux / l, uy / l, 1); } else spawnBlood(hit.x, hit.y, ux / l, uy / l, 2, 0.5);
      } else decalQ.push(['arrow', a.x1, a.y1, Math.atan2(a.y1 - a.y0, a.x1 - a.x0)]);
    }
  }

  function flushDecals() {
    const R = C.world.groundRes, g = gctx; let budget = C.fx.decalsPerFrame;
    while (decalQ.length && budget-- > 0) {
      const d = decalQ.shift();
      if (d[0] === 'body') { const US = C.render.unitScale; g.save(); g.translate(d[1] * R, d[2] * R); g.scale(US, US); Art.stampDead(g, 0, 0, d[3], teams[d[4]], d[5], R, d[6]); g.restore(); }
      else if (d[0] === 'bloodpool') Art.stampBlood(g, d[1], d[2], 6 + rand() * 4, R, 0, 0, 0.8);
      else if (d[0] === 'blood') Art.stampBlood(g, d[1], d[2], d[3], R, d[4], d[5], d[6]);
      else if (d[0] === 'arrow') { g.save(); g.translate(d[1] * R, d[2] * R); g.rotate(d[3]); g.globalAlpha = 0.6; g.strokeStyle = '#4a3826'; g.lineWidth = 0.35 * R; g.beginPath(); g.moveTo(-2.5 * R, 0); g.lineTo(0.5 * R, 0); g.stroke(); g.fillStyle = '#efe7d2'; g.fillRect(-2.9 * R, -0.4 * R, 0.9 * R, 0.8 * R); g.globalAlpha = 1; g.restore(); }
      else if (d[0] === 'item') drawItem(g, d[1], d[2] * R, d[3] * R, d[4], teams[d[5]], R * C.render.unitScale, true);
      else if (d[0] === 'mud') Art.stampMud(g, d[1], d[2], d[3], R, d[4]);
      else if (d[0] === 'foot') Art.footprint(g, d[1] * R, d[2] * R, d[3], R * 0.5, 0.25);
    }
    if (decalQ.length > 600) decalQ.splice(0, decalQ.length - 600);
    // mud & footprints from moving / fighting men (gouache stamps, accumulate)
    for (let k = 0; k < 22; k++) {
      const m = men[(rand() * men.length) | 0]; if (!m.alive) continue; const sp = Math.hypot(m.vx, m.vy); if (sp < 8 && !m.engaged) continue;
      const ti = clamp((m.y / TR) | 0, 0, TH - 1) * TW + clamp((m.x / TR) | 0, 0, TW - 1); const mud = mudGrid[ti];
      if (mud > 0.08 + rand() * 0.4) Art.stampMud(g, m.x + (rand() - 0.5) * 6, m.y + (rand() - 0.5) * 6, 3 + rand() * 5, R, 0.1 + Math.min(0.25, mud * 0.1));
      else if (rand() < 0.4) Art.footprint(g, m.x * R, m.y * R, Math.atan2(m.vy, m.vx), R * 0.45, 0.12 + mud * 0.2);
    }
  }

  function updateTrample(dt) { const r = C.grass.recover * dt; for (let i = 0; i < trample.length; i++) if (trample[i] > 0) trample[i] = Math.max(trample[i] > 0.9 ? 0.9 : 0, trample[i] - r * (trample[i] > 0.9 ? 0.05 : 1)); }

  // ------------------------------------------------------------------ bot ---
  // Bot = a Commander that only uses Commands.issue (same API as the player / a network peer).
  function makeBot(team) {
    return { team, t: 0, phase: 0, flankDone: false, archersDone: false, think(dt) {
      if ((this.t -= dt) > 0) return; this.t = C.bot.thinkEvery;
      const mine = groups.filter((g) => g.team === team && g.n); if (!mine.length) return;
      const foe = teams[1 - team]; let ex = 0, ey = 0, n = 0; for (const m of men) if (m.alive && m.team !== team) { ex += m.x; ey += m.y; n++; } if (!n) return; ex /= n; ey /= n;
      if (!this.archersDone && battleT > 0.5) { this.archersDone = true; Commands.issue(team, { type: 'splitType', unitType: 'archer' }); }
      if (!this.flankDone && battleT > C.bot.flankAfter) { this.flankDone = true; const main = mine.reduce((a, b) => (b.n > a.n ? b : a)); const side = rand() < 0.5 ? -1 : 1; const hx = Math.cos(main.heading), hy = Math.sin(main.heading); let wx = main.cx, wy = main.cy, bd = -1e9; for (const m of main.members) { if (m.type !== 'spearman') continue; const l = (m.x - main.cx) * -hy * side + (m.y - main.cy) * hx * side; if (l > bd) { bd = l; wx = m.x; wy = m.y; } } const fg = Commands.issue(team, { type: 'split', x: wx, y: wy, r: 70 }); if (fg) fg.flankSide = side; }
      for (const g of mine) {
        const arch = g.members.every((m) => m.type === 'archer');
        // nearest enemy to group
        let nd = 1e9, nx = ex, ny = ey; for (const m of men) if (m.alive && m.team !== team) { const d = Math.hypot(m.x - g.cx, m.y - g.cy); if (d < nd) { nd = d; nx = m.x; ny = m.y; } }
        let dx = nx - g.cx, dy = ny - g.cy, thr;
        if (arch) { thr = nd > (C.bot.archerHold || 250) ? 0.25 : nd < 120 ? 0.3 : 0; if (nd < 120) { dx = -dx; dy = -dy; } }
        else if (g.flankSide && battleT < C.bot.flankAfter + 7) { const hx = Math.cos(teams[team].front), hy = Math.sin(teams[team].front); dx = -hy * g.flankSide * 1 + hx * 0.5; dy = hx * g.flankSide + hy * 0.5; thr = 0.6; }
        else thr = nd < C.bot.chargeDist ? C.bot.aggression + 0.2 : nd < 260 ? 0.5 : 0.3;
        if (thr <= 0) Commands.issue(team, { type: 'halt', group: g.id }); else Commands.issue(team, { type: 'move', group: g.id, dx, dy, throttle: thr });
      }
    } };
  }
  let bots = [];

  // ---------------------------------------------------------------- input ---
  const inp = { down: false, id: null, sx: 0, sy: 0, x: 0, y: 0, ex: 0, ey: 0, t0: 0, dragging: false, group: null, level: -1, full: false, lastTap: { t: -1e9, x: 0, y: 0 }, tapTimer: null, thr: 0 };
  const toWorld = (sx, sy) => R3D ? R3D.toWorld(sx, sy) : ({ x: (sx - SW / 2) / cam.z + cam.x, y: (sy - SH / 2) / cam.z + cam.y });   // 3D: raycast to ground plane
  const toScreen = (wx, wy) => R3D ? R3D.toScreen(wx, wy) : ({ x: (wx - cam.x) * cam.z + SW / 2, y: (wy - cam.y) * cam.z + SH / 2 });
  const onScreen = (x, y) => { const s = toScreen(x, y); return s.x > -40 && s.y > -40 && s.x < SW + 40 && s.y < SH + 40; };
  const panOf = (x) => clamp((toScreen(x, 0).x / SW) * 2 - 1, -1, 1) * 0.7;
  function pickGroup(sx, sy) {
    const w = toWorld(sx, sy); const r = C.control.pickRadiusPx / (R3D ? R3D.pxPerUnit(w.x, w.y) : cam.z); let best = null, bd = r;
    forNear(w.x, w.y, r, (m) => { if (m.team !== 0) return; const d = Math.hypot(m.x - w.x, m.y - w.y); if (d < bd) { bd = d; best = m.group; } });
    return best;
  }
  function select(g) { if (g && g !== selected) { selected = g; Haptics.tick(); AudioSys.play('ui_tick', { vol: 0.6, rate: 1.2 }); } }
  cv.addEventListener('pointerdown', (e) => {
    AudioSys.unlock(); if (state !== 'battle' || inp.down) return; cv.setPointerCapture(e.pointerId);
    const now = performance.now(); const isDouble = now - inp.lastTap.t < C.control.doubleTapMs && Math.hypot(e.clientX - inp.lastTap.x, e.clientY - inp.lastTap.y) < C.control.doubleTapPx;
    if (isDouble) { clearTimeout(inp.tapTimer); inp.lastTap.t = -1e9; doubleTap(e.clientX, e.clientY); inp.down = true; inp.id = e.pointerId; inp.dbl = true; inp.sx = e.clientX; inp.sy = e.clientY; inp.x = inp.ex = e.clientX; inp.y = inp.ey = e.clientY; inp.group = selected; inp.dragging = false; inp.t0 = now; return; }
    inp.dbl = false; inp.down = true; inp.id = e.pointerId; inp.sx = inp.x = inp.ex = e.clientX; inp.sy = inp.y = inp.ey = e.clientY; inp.t0 = now; inp.dragging = false; inp.level = -1; inp.full = false;
    const g = pickGroup(e.clientX, e.clientY) || (selected && selected.n ? selected : null) || groups.find((x) => x.team === 0 && x.n);
    inp.group = g; inp.onGroup = !!pickGroup(e.clientX, e.clientY); select(g);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!inp.down || e.pointerId !== inp.id) return; inp.x = e.clientX; inp.y = e.clientY;
    const dx = inp.x - inp.sx, dy = inp.y - inp.sy, L = Math.hypot(dx, dy);
    if (L > C.control.deadzonePx) inp.dragging = true;
    if (!inp.dragging || !inp.group) return;
    let thr = clamp((L - C.control.deadzonePx) / C.control.dragMaxPx, 0, 1);
    const lv = C.control.levels; for (const l of lv) if (l.at > 0 && Math.abs(thr - l.at) < C.control.snap) thr = lerp(thr, l.at + 0.005, 0.6);   // subtle magnet
    inp.thr = thr; let level = 0; for (let i = 0; i < lv.length; i++) if (thr >= lv[i].at) level = i;
    if (level !== inp.level) { if (inp.level >= 0) { Haptics.tick(); AudioSys.play('ui_tick', { vol: 0.5, rate: 1 + level * 0.25 }); } inp.level = level; }
    if (thr >= 0.98 && !inp.full) { inp.full = true; Haptics.pulseFull(); AudioSys.play('ui_full', { vol: 0.7 }); } else if (thr < 0.9) inp.full = false;
    if (R3D) { const a = toWorld(inp.sx, inp.sy), b = toWorld(inp.x, inp.y); Commands.issue(0, { type: 'move', group: inp.group.id, dx: b.x - a.x, dy: b.y - a.y, throttle: thr }); }   // tilted view: drag direction measured on the ground
    else Commands.issue(0, { type: 'move', group: inp.group.id, dx, dy, throttle: thr });
  });
  const endPtr = (e) => {
    if (!inp.down || e.pointerId !== inp.id) return; inp.down = false;
    const now = performance.now();
    if (!inp.dragging && !inp.dbl && now - inp.t0 < 260) {
      inp.lastTap = { t: now, x: inp.sx, y: inp.sy }; const g = inp.onGroup ? inp.group : null;
      clearTimeout(inp.tapTimer); inp.tapTimer = setTimeout(() => { if (g) { Commands.issue(0, { type: 'halt', group: g.id }); Haptics.tick(); } }, C.control.doubleTapMs + 10);   // single tap on a group = halt
    }
    inp.dragging = false;
  };
  cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
  function doubleTap(sx, sy) {
    const g = pickGroup(sx, sy); const w = toWorld(sx, sy);
    if (g) { const ng = Commands.issue(0, { type: 'split', x: w.x, y: w.y }); if (ng && ng !== g) { selected = ng; flash('Split! ' + ng.members.length + ' men'); } Haptics.select(); AudioSys.play('ui_select', { vol: 0.8, rate: 1.1 }); }
    else { const m = Commands.issue(0, { type: 'merge' }); if (m) { selected = m; flash('Whole army'); } Haptics.select(); AudioSys.play('ui_select', { vol: 0.8, rate: 0.85 }); }
  }
  window.addEventListener('keydown', (e) => { if (e.key === 'r') rally(); });
  function rally() { if (state !== 'battle') return; const m = Commands.issue(0, { type: 'rally' }); if (m) selected = m; AudioSys.play('rally_horn', { vol: 0.8 }); Haptics.horn(); rallyBoost = 0.3; flash('Rally to the standard!'); }

  // --------------------------------------------------------------- camera ---
  function updateCamera(dt, instant) {
    // always fit EVERY living man of both armies (+ margin); zoom in only as far as that box allows
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const m of men) if (m.alive) { if (m.x < x0) x0 = m.x; if (m.x > x1) x1 = m.x; if (m.y < y0) y0 = m.y; if (m.y > y1) y1 = m.y; }
    if (x0 > x1) { x0 = 0; y0 = 0; x1 = WW; y1 = WH; }
    const M = C.camera.margin; x0 -= M; x1 += M; y0 -= M + 18; y1 += M + 40; // room for HUD / thumb hint
    if (state === 'menu' || state === 'setup') { x0 -= 30; x1 += 30; y0 -= 30; y1 += 30; }
    const mv = C.camera.minViewUnits; if (x1 - x0 < mv) { const c = (x0 + x1) / 2; x0 = c - mv / 2; x1 = c + mv / 2; } if (y1 - y0 < mv) { const c = (y0 + y1) / 2; y0 = c - mv / 2; y1 = c + mv / 2; }
    const z = Math.min(SW / (x1 - x0), SH / (y1 - y0));
    let tx = (x0 + x1) / 2, ty = (y0 + y1) / 2; if (state === 'menu') tx += Math.sin(time * 0.1) * 12;
    // ease: zoom out fast (never lose a unit), zoom in slowly
    const kz = instant ? 1 : Math.min(1, dt * C.camera.lerp * (z < cam.z ? 3 : 0.6)), kp = instant ? 1 : Math.min(1, dt * C.camera.lerp * 1.5);
    cam.z = lerp(cam.z, z, kz); cam.x = lerp(cam.x, tx, kp); cam.y = lerp(cam.y, ty, kp);
  }

  // ---------------------------------------------------------------- audio ---
  let accentT = 8, chargeCD = [0, 0], rallyBoost = 0;
  function onCharge(g) {
    if (state !== 'battle' || chargeCD[g.team] > 0) return; chargeCD[g.team] = 4;
    AudioSys.play('charge_cry', { vol: g.team === 0 ? 0.85 : 0.55, pan: panOf(g.cx) });
  }
  function updateAudio(dt) {
    chargeCD[0] -= dt; chargeCD[1] -= dt;
    if (state !== 'battle') { AudioSys.silenceLayers(); AudioSys.update(dt); return; }
    const s = stats, total = Math.max(1, teams[0].alive + teams[1].alive);
    stats.deathRate *= Math.exp(-dt * 0.8);
    const chargeFrac = clamp(s.chargers / Math.max(1, s.movers), 0, 1);
    const CS = C.audio.crowdScale || 1;   // count thresholds scale with army size (3D: 200/side -> 0.4)
    const fight = clamp(s.engaged / (220 * CS) + s.deathRate / (25 * CS), 0, 1);
    AudioSys.layer('march_bed', clamp(s.walkers / (280 * CS), 0, 1) * 0.85 * (1 - chargeFrac * 0.9));
    AudioSys.layer('steps_walk', clamp(s.walkers / (380 * CS), 0, 1) * 0.6, 0.9 + 0.15 * clamp(s.walkers / (500 * CS), 0, 1));
    AudioSys.layer('steps_run', clamp((s.runners + s.chargers) / (220 * CS), 0, 1) * 0.85, 0.95 + 0.25 * chargeFrac);
    AudioSys.layer('steps_mud', clamp(s.movers / (400 * CS), 0, 1) * clamp(s.mudUnder, 0, 1) * 0.7);
    AudioSys.layer('armor_layer', clamp((s.walkers + s.engaged * 0.5) / (350 * CS), 0, 1) * 0.45);
    AudioSys.layer('melee_cries', fight * 0.75);
    AudioSys.layer('melee_clash', clamp(s.engaged / (180 * CS), 0, 1) * 0.8);
    rallyBoost = Math.max(0, rallyBoost - dt * 0.15);
    AudioSys.layer('battle_music', battleT < 2.5 ? 0 : clamp(0.32 + 0.3 * fight + rallyBoost, 0, 0.85));
    AudioSys.layer('ambience_bed', 0.7);
    AudioSys.duckAmbience(fight);
    if ((accentT -= dt) < 0) { accentT = 8 + rand() * 14; AudioSys.play('ambience_accent', { vol: 0.6, pan: rand() * 1.6 - 0.8, bus: 'amb' }); }
    if (stats.impact > 0.6) { Haptics.impact(clamp(stats.impact / 8, 0, 1)); if (R3D) R3D.impact(clamp(stats.impact / 8, 0, 1)); }
    stats.impact = 0;
    AudioSys.update(dt);
  }

  // ---------------------------------------------------------------- render ---
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5); SW = window.innerWidth; SH = window.innerHeight;
    cv.width = SW * DPR | 0; cv.height = SH * DPR | 0; cv.style.width = SW + 'px'; cv.style.height = SH + 'px';
    vignette = Art.mkCanvas(SW / 2, SH / 2); const v = vignette.getContext('2d'); const gr = v.createRadialGradient(SW / 4, SH / 4, Math.min(SW, SH) * 0.2, SW / 4, SH / 4, Math.max(SW, SH) * 0.42);
    gr.addColorStop(0, 'rgba(8,12,18,0)'); gr.addColorStop(0.7, 'rgba(8,12,18,0.18)'); gr.addColorStop(1, 'rgba(6,10,16,0.62)'); v.fillStyle = gr; v.fillRect(0, 0, SW, SH);
    // colour grade: warm golden highlights top-right, cool blue shadows bottom-left
    grade = Art.mkCanvas(SW / 2, SH / 2); const q = grade.getContext('2d'); const lg = q.createLinearGradient(SW / 2, 0, 0, SH / 2);
    lg.addColorStop(0, 'rgba(255,196,96,0.55)'); lg.addColorStop(0.45, 'rgba(160,140,100,0.0)'); lg.addColorStop(1, 'rgba(40,70,120,0.5)'); q.fillStyle = lg; q.fillRect(0, 0, SW, SH);
  }
  window.addEventListener('resize', resize);
  function drawItem(g, k, x, y, r, team, s, onGround) {
    g.save(); g.translate(x, y); g.rotate(r);
    if (onGround) { g.globalAlpha = 0.25; g.fillStyle = '#111'; g.beginPath(); g.ellipse(s * 0.6, s * 0.6, (k === 'spear' ? 8 : 2.5) * s, 1.6 * s, 0, 0, 6.283); g.fill(); g.globalAlpha = 1; }
    if (k === 'helmet') { g.fillStyle = Art.shade(team.helmet, -0.3); g.beginPath(); g.arc(0, 0, 2.5 * s, 0, 6.283); g.fill(); g.fillStyle = team.helmet; g.beginPath(); g.arc(-0.2 * s, -0.2 * s, 1.9 * s, 0, 6.283); g.fill(); g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.arc(-0.7 * s, -0.7 * s, 0.6 * s, 0, 6.283); g.fill(); }
    else if (k === 'spear' || k === 'sword') { g.strokeStyle = k === 'sword' ? '#b9b9b0' : '#3b2a1c'; g.lineWidth = 0.6 * s; g.beginPath(); g.moveTo(-9 * s, 0); g.lineTo(9 * s, 0); g.stroke(); g.fillStyle = '#c9c9c2'; g.beginPath(); g.moveTo(9 * s, -0.7 * s); g.lineTo(11.4 * s, 0); g.lineTo(9 * s, 0.7 * s); g.fill(); }
    else if (k === 'shield') { g.fillStyle = '#5c4630'; g.beginPath(); g.ellipse(0, 0, 3.4 * s, 2 * s, 0, 0, 6.283); g.fill(); g.fillStyle = team.shield; g.beginPath(); g.ellipse(0, 0, 2.9 * s, 1.6 * s, 0, 0, 6.283); g.fill(); }
    else if (k === 'bow') { g.strokeStyle = '#5a3d22'; g.lineWidth = 0.6 * s; g.beginPath(); g.arc(0, 0, 4 * s, -1, 1); g.stroke(); }
    else if (k === 'flag') { g.drawImage(team.flagCanvas, -6 * s, -4 * s, 12 * s, 8 * s); g.strokeStyle = '#3b2a1c'; g.lineWidth = 0.6 * s; g.beginPath(); g.moveTo(-6 * s, -4 * s); g.lineTo(-6 * s, 14 * s); g.stroke(); }
    g.restore();
  }
  function render() {
    if (R3D) { R3D.render(SIM, time); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, SW, SH); if (state === 'battle') drawControls(); return; }
    const z = cam.z * DPR, ox = SW / 2 * DPR - cam.x * z, oy = SH / 2 * DPR - cam.y * z;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#1c3312'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(z, 0, 0, z, ox, oy); ctx.imageSmoothingEnabled = true;
    ctx.drawImage(ground, 0, 0, WW, WH);
    const vx0 = cam.x - SW / 2 / cam.z - 10, vx1 = cam.x + SW / 2 / cam.z + 10, vy0 = cam.y - SH / 2 / cam.z - 10, vy1 = cam.y + SH / 2 / cam.z + 12;
    // grass tufts (wind sway + trampling)
    const k = z * 7 / 40;
    for (let i = 0; i < tuft.n; i++) {
      const x = tuft.tx[i], y = tuft.ty[i]; if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
      const ti = ((y / TR) | 0) * TW + ((x / TR) | 0); const tr = trample[ti];
      if (tr > 0.97) continue;
      const bend = Math.sin(time * 1.6 + x * 0.045 + y * 0.02) * 0.14 + Math.sin(time * 0.6 + x * 0.01) * 0.06 + trampleDx[ti] * tr * 1.3;
      const sq = (1 - 0.7 * tr) * tuft.ts[i], kk = k * tuft.ts[i], c = Math.cos(bend), s = Math.sin(bend);
      ctx.setTransform(kk * c, kk * s, -k * sq * s, k * sq * c, ox + x * z, oy + y * z);
      ctx.globalAlpha = 0.8 - tr * 0.35; ctx.drawImage(tuftSprites[tuft.tv[i]], -20, -44);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(z, 0, 0, z, ox, oy);
    // selection glow
    if (selected && selected.n && state === 'battle') { ctx.fillStyle = 'rgba(255,240,190,0.22)'; ctx.beginPath(); for (const m of selected.members) { ctx.moveTo(m.x + 7, m.y); ctx.arc(m.x, m.y, 7, 0, 6.283); } ctx.fill(); }
    // world-space cast shadows (sun top-right) under every man
    if (!shadowSpr) { shadowSpr = Art.mkCanvas(64, 64); const q = shadowSpr.getContext('2d'); const rg = q.createRadialGradient(32, 32, 4, 32, 32, 31); rg.addColorStop(0, 'rgba(6,10,4,1)'); rg.addColorStop(0.55, 'rgba(6,10,4,0.75)'); rg.addColorStop(1, 'rgba(6,10,4,0)'); q.fillStyle = rg; q.fillRect(0, 0, 64, 64); }
    const RC = C.render, US = RC.unitScale; ctx.globalAlpha = RC.shadowAlpha;
    for (const m of men) { if (!m.alive || m.x < vx0 - 20 || m.x > vx1 + 20 || m.y < vy0 - 20 || m.y > vy1 + 20) continue; ctx.drawImage(shadowSpr, m.x + RC.shadowDx * US - 7 * US, m.y + RC.shadowDy * US - 6 * US, 14 * US, 12 * US); }
    ctx.globalAlpha = 1;
    // men
    const sc = z / Art.SPR * US;
    for (const m of men) {
      if (!m.alive || m.x < vx0 - 20 || m.x > vx1 + 20 || m.y < vy0 - 20 || m.y > vy1 + 20) continue;
      const S = teams[m.team].sprites[m.type]; const sp = Math.abs(m.vx) + Math.abs(m.vy);
      const img = m.atk > 0 ? S.attack : sp > 5 ? S.walk[(m.step | 0) & 3] : (m.engaged && S.brace ? S.brace : S.idle);
      const c = Math.cos(m.face) * sc, s = Math.sin(m.face) * sc; const half = S.idle.width / 2;
      ctx.setTransform(c, s, -s, c, ox + m.x * z, oy + m.y * z);
      if (time - m.lastHit < 0.12) ctx.globalAlpha = 0.6;
      ctx.drawImage(img, -half, -half); ctx.globalAlpha = 1;
    }
    ctx.setTransform(z, 0, 0, z, ox, oy);
    // standard bearers with waving flags
    for (const m of men) if (m.alive && m.bearer) drawFlag(m);
    // arrows in flight (with ground shadow)
    ctx.lineCap = 'round';
    for (const a of arrows) {
      const x = lerp(a.x0, a.x1, a.t), y = lerp(a.y0, a.y1, a.t), h = a.h * 4 * a.t * (1 - a.t); const ang = Math.atan2(a.y1 - a.y0, a.x1 - a.x0);
      ctx.strokeStyle = 'rgba(20,30,10,0.25)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x - Math.cos(ang) * 4, y - Math.sin(ang) * 4); ctx.lineTo(x + Math.cos(ang) * 4, y + Math.sin(ang) * 4); ctx.stroke();
      const yy = y - h * 0.5, sl = 4 * (1 + h * 0.01); ctx.strokeStyle = '#2b2218'; ctx.lineWidth = 0.7 * (1 + h * 0.01); ctx.beginPath(); ctx.moveTo(x - Math.cos(ang) * sl, yy - Math.sin(ang) * sl); ctx.lineTo(x + Math.cos(ang) * sl, yy + Math.sin(ang) * sl); ctx.stroke();
    }
    // flying particles
    for (const p of particles) {
      if (p.x < vx0 || p.x > vx1 || p.y < vy0 || p.y > vy1) continue;
      const sh = 1 + p.z * 0.012, py = p.y - p.z * 0.55;
      if (p.k === 'blood') { ctx.fillStyle = '#8a1a16'; ctx.beginPath(); ctx.arc(p.x, py, p.s * 0.8, 0, 6.283); ctx.fill(); continue; }
      ctx.fillStyle = 'rgba(20,25,10,0.25)'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 4, 2.6, 0, 0, 6.283); ctx.fill();
      if (p.k === 'body') { const S = teams[p.team].sprites[p.type]; ctx.save(); ctx.translate(p.x, py); ctx.rotate(p.r); ctx.scale(sh * US / Art.SPR, sh * US / Art.SPR); ctx.drawImage(S.idle, -S.idle.width / 2, -S.idle.height / 2); ctx.restore(); }
      else drawItem(ctx, p.k, p.x, py, p.r, teams[p.team], sh * US, false);
    }
    // warm haze + light shafts (gouache sunlight)
    ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = 0.9; ctx.drawImage(light, 0, 0, WW, WH);
    ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.35 + Math.sin(time * 0.3) * 0.05; ctx.drawImage(light, Math.sin(time * 0.05) * 15, 0, WW, WH);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    // screen space: vignette, grain, drag ink
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = 'soft-light'; ctx.drawImage(grade, 0, 0, SW, SH); ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = 'overlay'; ctx.drawImage(grade, 0, 0, SW, SH); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(vignette, 0, 0, SW, SH);
    ctx.globalAlpha = 0.06; ctx.globalCompositeOperation = 'overlay'; ctx.fillStyle = ctx.createPattern(grain, 'repeat'); ctx.fillRect(0, 0, SW, SH); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    if (state === 'battle') drawControls();
  }
  function drawFlag(m) {
    const t = teams[m.team], f = t.flagCanvas; const px = m.x - Math.cos(m.face) * 2, py = m.y - Math.sin(m.face) * 2;
    const topX = px + 3, topY = py - 16; // pole leans to "camera"
    ctx.strokeStyle = 'rgba(20,25,10,0.3)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + 12, py + 6); ctx.stroke();
    ctx.strokeStyle = '#3b2a1c'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(topX, topY); ctx.stroke();
    const W = 14, H = 9, N = 8, wind = -Math.atan2(m.vy, m.vx) ? 1 : 1;
    for (let i = 0; i < N; i++) { const u = i / N, wv = Math.sin(time * 6 - i * 0.9) * 1.2 * u; ctx.globalAlpha = 1; ctx.drawImage(f, u * f.width, 0, f.width / N + 1, f.height, topX + u * W * wind, topY + wv, W / N + 0.3, H); ctx.fillStyle = `rgba(0,0,0,${0.12 + 0.12 * Math.sin(time * 6 - i * 0.9)})`; ctx.fillRect(topX + u * W, topY + wv, W / N + 0.3, H); }
  }
  function inkStroke(x0, y0, x1, y1, w, col, a) {
    const L = Math.hypot(x1 - x0, y1 - y0); if (L < 1) return; const ux = (x1 - x0) / L, uy = (y1 - y0) / L, nx = -uy, ny = ux;
    for (let p = 0; p < 3; p++) {
      const j = (p - 1) * w * 0.18; ctx.globalAlpha = a * (p === 1 ? 1 : 0.45); ctx.fillStyle = col; ctx.beginPath();
      ctx.moveTo(x0 + nx * (w * 0.25 + j), y0 + ny * (w * 0.25 + j));
      ctx.quadraticCurveTo((x0 + x1) / 2 + nx * (w * 0.6 + j), (y0 + y1) / 2 + ny * (w * 0.6 + j), x1 + nx * (w * 0.5), y1 + ny * (w * 0.5));
      ctx.lineTo(x1 - nx * (w * 0.5), y1 - ny * (w * 0.5));
      ctx.quadraticCurveTo((x0 + x1) / 2 - nx * (w * 0.6 - j), (y0 + y1) / 2 - ny * (w * 0.6 - j), x0 - nx * (w * 0.25 - j), y0 - ny * (w * 0.25 - j)); ctx.fill();
    }
    ctx.globalAlpha = a; ctx.beginPath(); ctx.moveTo(x1 + ux * w * 1.6, y1 + uy * w * 1.6); ctx.lineTo(x1 + nx * w * 1.2, y1 + ny * w * 1.2); ctx.lineTo(x1 - nx * w * 1.2, y1 - ny * w * 1.2); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
  }
  function drawControls() {
    // group markers
    for (const g of groups) if (g.team === 0 && g.n) {
      const s = toScreen(g.cx, g.cy); const sel = g === selected;
      ctx.strokeStyle = sel ? 'rgba(255,244,210,0.9)' : 'rgba(255,244,210,0.35)'; ctx.lineWidth = sel ? 2.2 : 1.2; ctx.beginPath(); ctx.arc(s.x, s.y, 9 + (sel ? Math.sin(time * 4) * 1.5 : 0), 0, 6.283); ctx.stroke();
      if (g.moving) { const L = 18 + 40 * g.throttle; inkStroke(s.x, s.y, s.x + g.dir.x * L, s.y + g.dir.y * L, 2 + 3 * g.throttle, 'rgba(255,244,210,1)', sel ? 0.55 : 0.25); }
    }
    if (!inp.down || !inp.dragging || !inp.group) return;
    inp.ex = lerp(inp.ex, inp.x, 0.45); inp.ey = lerp(inp.ey, inp.y, 0.45);
    const thr = inp.thr, full = thr >= 0.98, lvl = C.control.levels[Math.max(0, inp.level)];
    const col = full ? '#e0482a' : thr > 0.82 ? '#e07a2a' : thr > 0.45 ? '#f0c060' : '#fff2d0';
    ctx.strokeStyle = 'rgba(255,244,210,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(inp.sx, inp.sy, 14, 0, 6.283); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(inp.sx, inp.sy, 14, -1.57, -1.57 + 6.283 * thr); ctx.stroke();
    const w = 5 + 9 * thr + (full ? Math.sin(time * 18) * 2.5 : 0);
    if (full) { ctx.shadowColor = '#ff5a2a'; ctx.shadowBlur = 18 + Math.sin(time * 18) * 8; }
    inkStroke(inp.sx, inp.sy, inp.ex, inp.ey, w, '#2b2218', 0.45); inkStroke(inp.sx, inp.sy, inp.ex, inp.ey, w * 0.65, col, 0.85);
    ctx.shadowBlur = 0;
    ctx.font = `italic ${full ? 22 : 16}px Georgia, serif`; ctx.textAlign = 'center'; ctx.fillStyle = col; ctx.strokeStyle = 'rgba(30,25,15,0.7)'; ctx.lineWidth = 3;
    const fwd = (inp.x - inp.sx) * Math.cos(teams[0].front) + (inp.y - inp.sy) * Math.sin(teams[0].front); const L = Math.hypot(inp.x - inp.sx, inp.y - inp.sy) || 1;
    const label = fwd / L < -0.3 ? 'Fall back' : Math.abs(fwd / L) < 0.3 ? (thr > 0.45 ? 'Wheel' : 'Strafe') : lvl.name + (full ? '!' : '');
    ctx.strokeText(label, inp.ex, inp.ey - 30); ctx.fillText(label, inp.ex, inp.ey - 30);
  }

  // ------------------------------------------------------------------- UI ---
  const $ = (id) => document.getElementById(id);
  let flashT = 0; function flash(t) { const f = $('flash'); f.textContent = t; f.style.opacity = 1; flashT = 1.4; }
  function show(id) { ['menu', 'setup', 'army', 'settings', 'end', 'hud'].forEach((x) => $(x).classList.toggle('hidden', x !== id && !(id === 'battle' && x === 'hud'))); }
  function flagImg(t) { return t.flagCanvas.toDataURL(); }
  function refreshBanners() {
    $('pflag').src = $('hpflag').src = flagImg(teams[0]); $('eflag').src = $('heflag').src = flagImg(teams[1]);
    $('pname').textContent = $('hpname').textContent = teams[0].name; $('ename').textContent = $('hename').textContent = teams[1].name;
  }
  function newBattle(seed) {
    buildWorld(seed || ((Math.random() * 1e9) | 0));
    teams = [makeTeam(0, playerCfg), makeTeam(1, randomBot())];
    spawnArmies(); particles = []; arrows = []; decalQ = []; selected = groups.find((g) => g.team === 0); battleT = 0;
    bots = [makeBot(1)]; if (AUTO) bots.push(makeBot(0));
    updateCamera(0, true); refreshBanners(); if (R3D) R3D.newBattle(SIM);
  }
  function startBattle() {
    state = 'battle'; battleT = 0; show('battle');
    AudioSys.stopMusic(); AudioSys.play('battle_horn', { vol: 1 }); Haptics.horn();
    flash('Drag from your army • far = CHARGE');
  }
  function endBattle(win) {
    state = 'end'; endT = 0; AudioSys.silenceLayers(); AudioSys.play(win ? 'victory' : 'defeat'); setTimeout(() => AudioSys.playMusic(0.35), 2500);
    $('endtitle').textContent = win ? 'Victory' : 'Defeat';
    $('endsub').textContent = win ? `${teams[1].name} ${teams[1].routed ? 'routs from the field' : 'is destroyed'}.` : `${teams[0].name} ${teams[0].routed ? 'breaks and flees' : 'has fallen'}.`;
    $('endstats').innerHTML = `<div><img src="${flagImg(teams[0])}"> ${teams[0].name}: <b>${teams[0].alive}</b> standing · ${teams[0].kills} kills</div><div><img src="${flagImg(teams[1])}"> ${teams[1].name}: <b>${teams[1].alive}</b> standing · ${teams[1].kills} kills</div>`;
    setTimeout(() => show('end'), 1600);
  }
  function checkEnd(dt) {
    for (let i = 0; i < 2; i++) {
      const t = teams[i], o = teams[1 - i];
      if (!t.routed && t.alive / t.initial < CB.routAt && o.alive > t.alive * 1.6) { t.routed = true; t.routT = 0; for (const m of men) if (m.team === i) m.flee = true; flash(t.name + ' routs!'); }
      if (t.routed) t.routT += dt;
      if (t.alive <= 0 || (t.routed && t.routT > 5)) { endBattle(i === 1); return; }
    }
  }
  // HUD + menus
  $('btnPlay').onclick = () => { AudioSys.unlock(); AudioSys.playMusic(); newBattle(); state = 'setup'; show('setup'); AudioSys.play('ui_confirm'); };
  $('btnHorn').onclick = () => { AudioSys.unlock(); AudioSys.play('ui_confirm'); startBattle(); };
  $('btnBack').onclick = () => { state = 'menu'; show('menu'); };
  $('btnArmy').onclick = () => { AudioSys.unlock(); AudioSys.playMusic(); openArmy(); };
  $('btnArmy2').onclick = () => openArmy(true);
  $('btnSettings').onclick = () => { AudioSys.unlock(); AudioSys.playMusic(); show('settings'); };
  $('btnRally').onclick = (e) => { e.stopPropagation(); rally(); };
  $('btnMute').onclick = () => { AudioSys.setMuted(AudioSys.enabled); $('btnMute').textContent = AudioSys.enabled ? '🔊' : '🔇'; };
  $('btnRematch').onclick = () => { AudioSys.playMusic(1); newBattle(); state = 'setup'; show('setup'); };
  $('btnMenu').onclick = () => { AudioSys.playMusic(1); newBattle(); state = 'menu'; show('menu'); };
  document.querySelectorAll('button').forEach((b) => b.addEventListener('pointerdown', () => { AudioSys.unlock(); if (!['btnPlay', 'btnHorn', 'btnArmyDone'].includes(b.id) && !b.classList.contains('sw')) AudioSys.play('ui_select', { vol: 0.7 }); }));
  document.addEventListener('pointerdown', () => { AudioSys.unlock(); if (state === 'menu' || state === 'setup') AudioSys.playMusic(1); });
  $('setHaptics').checked = Haptics.on; $('setHaptics').onchange = (e) => Haptics.set(e.target.checked);
  $('setSound').checked = true; $('setSound').onchange = (e) => AudioSys.setMuted(!e.target.checked);
  $('btnSettingsDone').onclick = () => show('menu');
  let armyFromSetup = false;
  function openArmy(fromSetup) {
    armyFromSetup = !!fromSetup; show('army'); $('armyName').value = playerCfg.name;
    const sw = (id, list, get, set) => { const el = $(id); el.innerHTML = ''; list.forEach((c) => { const b = document.createElement('button'); b.className = 'sw' + (get() === c ? ' on' : ''); b.style.background = c; b.onclick = () => { set(c); openArmyRefresh(); Haptics.tick(); AudioSys.play('ui_select'); }; el.appendChild(b); }); };
    window.openArmyRefresh = () => {
      sw('swTunic', PALETTE.tunic, () => playerCfg.tunic, (c) => (playerCfg.tunic = c));
      sw('swHelmet', PALETTE.helmet, () => playerCfg.helmet, (c) => (playerCfg.helmet = c));
      sw('swShield', PALETTE.shield, () => playerCfg.shield, (c) => (playerCfg.shield = c));
      sw('swField', PALETTE.field, () => playerCfg.flag.field, (c) => (playerCfg.flag.field = c));
      sw('swEmblemCol', PALETTE.emblemCol, () => playerCfg.flag.emblemCol, (c) => (playerCfg.flag.emblemCol = c));
      const el = $('swEmblem'); el.innerHTML = '';
      Art.EMBLEMS.forEach((e) => { const c = Art.mkCanvas(36, 36), g = c.getContext('2d'); g.fillStyle = '#3a3428'; g.fillRect(0, 0, 36, 36); Art.drawEmblem(g, e, 18, 18, 26, '#f2ead2'); c.className = 'sw em' + (playerCfg.flag.emblem === e ? ' on' : ''); c.onclick = () => { playerCfg.flag.emblem = e; openArmyRefresh(); Haptics.tick(); AudioSys.play('ui_select'); }; el.appendChild(c); });
      const t = makeTeam(0, playerCfg); const pv = $('armyPreview'), g = pv.getContext('2d'); g.clearRect(0, 0, pv.width, pv.height);
      g.fillStyle = '#6f8c42'; g.fillRect(0, 0, pv.width, pv.height);
      const spr = t.sprites.spearman; [[60, 70, -1.57], [120, 64, -1.57], [180, 70, -1.57]].forEach(([x, y, a], i) => { g.save(); g.translate(x, y); g.rotate(a); g.scale(0.55, 0.55); g.drawImage(i === 1 ? spr.attack : spr.idle, -spr.idle.width / 2, -spr.idle.height / 2); g.restore(); });
      const as = t.sprites.archer; g.save(); g.translate(240, 72); g.rotate(-1.57); g.scale(0.55, 0.55); g.drawImage(as.idle, -as.idle.width / 2, -as.idle.height / 2); g.restore();
      g.drawImage(t.flagCanvas, 280, 22, 90, 60);
    };
    openArmyRefresh();
  }
  $('armyName').oninput = (e) => (playerCfg.name = e.target.value.slice(0, 24) || 'Crimson Host');
  $('btnArmyDone').onclick = () => {
    AudioSys.play('ui_confirm'); localStorage.setItem('bf_army', JSON.stringify(playerCfg));
    if (teams.length) { const t = makeTeam(0, playerCfg); Object.assign(teams[0], { name: t.name, tunic: t.tunic, helmet: t.helmet, shield: t.shield, flag: t.flag, sprites: t.sprites, flagCanvas: t.flagCanvas }); refreshBanners(); }
    show(armyFromSetup ? 'setup' : 'menu');
  };

  // read-only view of the simulation for the 3D renderer (getters: arrays get replaced on new battle)
  const SIM = {
    get men() { return men; }, get particles() { return particles; }, get arrows() { return arrows; }, get groups() { return groups; }, get teams() { return teams; },
    get state() { return state; }, get selected() { return selected; }, get battleT() { return battleT; },
    get ground() { return ground; }, get WW() { return WW; }, get WH() { return WH; }, get MAP() { return MAP; }, get COLS() { return COLS; }, get ROWS() { return ROWS; },
    get trample() { return trample; }, get trampleDx() { return trampleDx; }, get mudGrid() { return mudGrid; }, TR, get TW() { return TW; }, get TH() { return TH; },
    terrainAt: (x, y) => terrainAt(x, y), get SW() { return SW; }, get SH() { return SH; },
  };

  // ------------------------------------------------------------------ loop ---
  let last = performance.now();
  function frame(now) {
    let dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
    if (state === 'battle' || state === 'end') {
      const sdt = R3D ? dt * R3D.timeScale(dt) : dt;   // 3D: hit-stop on big impacts
      for (let w = 0; w < WARP; w++) {                // ?warp=N: N sim steps per frame (headless tests on slow software GL)
        battleT += sdt; for (const b of bots) b.think(sdt);
        updateGroups(sdt); updateMen(sdt); updateParticles(sdt); updateTrample(sdt);
        if (state === 'battle') checkEnd(sdt);
        if (w < WARP - 1) flushDecals();
      }
    } else { for (const m of men) m.step += 0; }
    flushDecals(); updateCamera(dt); updateAudio(dt); render();
    if (flashT > 0 && (flashT -= dt) <= 0) $('flash').style.opacity = 0;
    if (state === 'battle') { $('hpbar').style.width = (100 * teams[0].alive / teams[0].initial) + '%'; $('hebar').style.width = (100 * teams[1].alive / teams[1].initial) + '%'; $('hpcount').textContent = teams[0].alive; $('hecount').textContent = teams[1].alive; }
    requestAnimationFrame(frame);
  }
  resize(); newBattle(Number(Q.get('seed')) || undefined);
  if (AUTO) { state = 'battle'; show('battle'); AudioSys.enabled = false; }
  else show('menu');
  window.BF = { get state() { return state; }, teams: () => teams, men: () => men, Commands, CONFIG, sim: SIM };
  requestAnimationFrame(frame);
})();
