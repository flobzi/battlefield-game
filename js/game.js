// BATTLE FIELD GAME — simulation, input, bot, rendering, UI glue.
(function () {
  const C = CONFIG, MV = C.move, CB = C.combat, MO = C.morale, WD = C.wounds, IM = C.impact, AR = C.arrows;
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
  let teams = [], men = [], groups = [], nextGroupId = 1, fleeG = [];   // fleeG[team]: placeholder group for men who broke and run on their own (not commandable)
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
        const m = { id: men.length, team: ti, type, T, x, y, vx: 0, vy: 0, face: t.front, hp: 0, str: lerp(T.str[0], T.str[1], rand()), spd: lerp(T.spd[0], T.spd[1], rand()), stam: 1, cd: rand(), atk: 0, step: rand() * 4, alive: true, group: g, reload: 1 + rand() * 2, engaged: false, flee: false, bearer: false, aim: 0, lastHit: 0,
                    // pass 5: morale / wounds / impacts
                    mor: 0, brave: lerp(MO.brave[0], MO.brave[1], rand()), luck: rand() * 2 - 1, inj: false, stun: 0, z: 0, vz: 0, tilt: 0, spin: 0, ic: 0, cover: 0, helmOff: false, fleeT: 0, escaped: false };
        m.mor = clamp(lerp(MO.start[0], MO.start[1], rand()) * (0.8 + 0.2 * m.brave), 40, 100);
        m.hp = m.maxHp = lerp(T.hp[0], T.hp[1], rand());
        men.push(m); g.members.push(m);
        if (++col >= cols) { col = 0; row++; }
      }
      // standard bearer: front-centre spearman
      let best = null, bd = 1e9; for (const m of g.members) { const d = Math.abs(m.x - WW / 2) + Math.abs(m.y - frontY) * 2; if (m.type === 'spearman' && d < bd) { bd = d; best = m; } }
      if (best) { best.bearer = true; best.hp = best.maxHp *= 1.3; }
      t.alive = t.initial = g.members.length; t.routed = false; t.kills = 0; t.fled = 0; t.hornT = -99; t.routT = 0;
      fleeG[ti] = { id: -1 - ti, team: ti, flee: true, dir: { x: 0, y: 0 }, throttle: 0, moving: false, heading: t.front, ax: 0, ay: 0, vx: 0, vy: 0, n: 0, cx: 0, cy: 0, members: [] };
      reformGroup(g, true);
    }
  }
  // assign formation slots (ranks): spearmen front, archers back; preserves relative positions → no crossing
  function reformGroup(g, keepAnchor) {
    const ms = g.members.filter((m) => m.alive && m.group === g); g.members = ms; if (!ms.length) return;
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
    } else if (cmd.type === 'splitIds') {          // bot wings: an explicit list of men (serialisable for a network peer)
      const set = new Set(cmd.ids); const picked = men.filter((m) => set.has(m.id) && m.alive && !m.flee && m.team === team); if (!picked.length) return null;
      const src = picked[0].group; const own = picked.filter((m) => m.group === src); if (own.length < 4 || own.length >= src.members.length - 2) return src;
      const ng = newGroup(team); ng.heading = src.heading; ng.dir = { x: src.dir.x, y: src.dir.y }; const os = new Set(own);
      src.members = src.members.filter((m) => !os.has(m)); ng.members = own; own.forEach((m) => (m.group = ng)); reformGroup(src); reformGroup(ng); return ng;
    } else if (cmd.type === 'join') {              // fold one group into another (bot: bands under 5 men)
      const g = groups.find((x) => x.id === cmd.group), into = groups.find((x) => x.id === cmd.into); if (!g || !into || g === into || g.team !== team || into.team !== team) return null;
      g.members.forEach((m) => (m.group = into)); into.members.push(...g.members); g.members = []; reformGroup(into); groups = groups.filter((x) => x.members.length || x === selected); if (selected === g) selected = into; return into;
    } else if (cmd.type === 'merge' || cmd.type === 'rally') {
      if (!gs.length) return; const main = gs.reduce((a, b) => (b.members.length > a.members.length ? b : a));
      for (const g of gs) if (g !== main) { g.members.forEach((m) => (m.group = main)); main.members.push(...g.members); g.members = []; }
      if (cmd.type === 'rally') { main.throttle = 0; main.moving = false; main.heading = teams[team].front;
        // pass 5: the horn steadies the men -- runaways most of all (once per rallyHornCD s)
        const t = teams[team]; if (battleT - t.hornT > MO.rallyHornCD) { t.hornT = battleT; for (const m of men) if (m.alive && m.team === team) m.mor = Math.min(100, m.mor + (m.flee ? MO.rallyHorn : MO.rallyHorn * 0.4)); } }
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
      g.members = g.members.filter((m) => m.alive && m.group === g); g.n = g.members.length; if (!g.n) continue;
      let cx = 0, cy = 0, st = 0, mo = 0; for (const m of g.members) { cx += m.x; cy += m.y; st += m.stam; mo += m.mor; } g.cx = cx / g.n; g.cy = cy / g.n; g.sta = st / g.n; g.mor = mo / g.n;
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
      // pass 5: thrown by a charge -> ballistic until he lands (no steering, can't be targeted)
      if (m.z > 0) {
        m.vz -= IM.gravity * dt; m.z += m.vz * dt; m.tilt += m.spin * dt;
        m.x = clamp(m.x + m.vx * dt, 3, WW - 3); m.y = clamp(m.y + m.vy * dt, 3, WH - 3);
        if (m.z <= 0) land(m); continue;
      }
      if (m.tilt) { m.tilt *= Math.exp(-dt * 4); if (Math.abs(m.tilt) < 0.02) m.tilt = 0; }   // getting back up after a throw
      m.stun -= dt; m.ic -= dt; m.cover -= dt;
      // nearest enemy
      let ne = null, nd = MV.engageRadius;
      forNear(m.x, m.y, MV.engageRadius, (o) => { if (o.team !== m.team && o.alive && o.z < 4) { const d = Math.hypot(o.x - m.x, o.y - m.y); if (d < nd) { nd = d; ne = o; } } });
      const stamMul = C.stamina.minSpeedMul + (1 - C.stamina.minSpeedMul) * m.stam;
      const maxSp = MV.charge * 1.05 * m.spd * stamMul * speedAt(m.x, m.y) * (m.inj ? WD.speedMul : 1);
      let dx = 0, dy = 0, faceTo = null;
      m.engaged = false;
      const hx = Math.cos(g.heading), hy = Math.sin(g.heading);
      if (m.flee) {
        m.fleeT += dt; dy = -Math.sin(team.front) * MV.run * 1.1; dx = (m.x - WW / 2) * 0.05;
        if (ne) { const k = MV.run * 0.8 / (nd || 1); dx += (m.x - ne.x) * k; dy += (m.y - ne.y) * k; }   // veer away from whoever is chasing
      }
      else if (ne && (T.behaviour === 'melee' || nd < MV.engageRadius * 0.55)) {
        m.engaged = true; const ux = (ne.x - m.x) / (nd || 1), uy = (ne.y - m.y) / (nd || 1);
        const gs = Math.hypot(g.vx, g.vy); const push = nd > T.reach * 0.8 ? Math.max(gs, MV.walk * 1.2) : 4;
        dx = ux * push * MV.engageK + g.vx * 0.15; dy = uy * push * MV.engageK + g.vy * 0.15; faceTo = Math.atan2(uy, ux);
      } else {
        const rx = -hy, ry = hx; const tx = g.ax + rx * m.sl - hx * m.sd, ty = g.ay + ry * m.sl - hy * m.sd;
        dx = (tx - m.x) * MV.formationK + g.vx; dy = (ty - m.y) * MV.formationK + g.vy;
        if (T.behaviour === 'ranged') archerThink(m, dt, g);
      }
      if (m.stun > 0) { dx *= 0.15; dy *= 0.15; }
      if (m.aim > 0) { m.aim -= dt; faceTo = m.aimAng; }
      // separation (allies soft, enemies hard: bodies collide) + pass 5 charge impacts on fast contact
      let px = 0, py = 0, imO = null, imC = 0; const sep = MV.separation;
      forNear(m.x, m.y, sep, (o) => {
        if (o === m || o.z > 4) return; const ox = m.x - o.x, oy = m.y - o.y, d2 = ox * ox + oy * oy; if (d2 > sep * sep || d2 < 1e-4) return; const d = Math.sqrt(d2), f = (sep - d) / sep * (o.team === m.team ? MV.sepK : MV.enemySepK); px += (ox / d) * f; py += (oy / d) * f;
        if (o.team !== m.team && o.alive && m.ic <= 0 && o.ic <= 0) { const cl = ((m.vx - o.vx) * -ox + (m.vy - o.vy) * -oy) / d; if (cl > IM.min && cl > imC) { imC = cl; imO = o; } }
      });
      if (imO) impact(m, imO, imC);
      // steer
      let dl = Math.hypot(dx, dy); if (dl > maxSp) { dx = dx / dl * maxSp; dy = dy / dl * maxSp; }
      let ex = dx - m.vx, ey = dy - m.vy; const el = Math.hypot(ex, ey), acc = MV.accel * dt * 2;
      if (el > acc) { ex = ex / el * acc; ey = ey / el * acc; }
      if (m.z > 0) continue;   // thrown by the impact above
      m.vx += ex; m.vy += ey;
      m.x = clamp(m.x + (m.vx + px * 0.12) * dt, 3, WW - 3); m.y = clamp(m.y + (m.vy + py * 0.12) * dt, 3, WH - 3);
      if (m.flee && (m.y <= 6 || m.y >= WH - 6)) { escape(m); continue; }   // ran off the field: lives, but is out of the battle
      const sp = Math.hypot(m.vx, m.vy);
      // facing
      let fa = faceTo;
      if (fa === null) { if (sp > 6 && (m.vx * hx + m.vy * hy > -0.25 * sp || g.throttle > 0.5 || m.flee)) fa = Math.atan2(m.vy, m.vx); else fa = g.heading; }
      m.face += clamp(angDiff(m.face, fa), -8 * dt, 8 * dt);
      // stamina (wounded men get their breath back slower)
      const S = C.stamina, rec = m.inj ? WD.recoverMul : 1;
      if (sp > MV.run * 0.95) m.stam -= S.drainCharge * dt; else if (sp > MV.walk * 1.3) m.stam -= S.drainRun * dt; else if (m.engaged) m.stam -= S.drainFight * dt; else if (sp > 3) m.stam += S.recoverWalk * rec * dt; else m.stam += S.recoverIdle * rec * dt;
      m.stam = clamp(m.stam, 0, 1);
      m.step += sp * dt * 0.28; m.cd -= dt; m.atk -= dt; m.reload -= dt;
      // melee
      if (ne && !m.flee && m.stun <= 0 && m.cd <= 0 && nd < T.reach + ne.T.radius) attack(m, ne);
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

  // ------------------------------------------------------- pass 5: morale ---
  // Every man judges his own spot: enemies vs mates within MO.radius, runaways nearby, wounds, breath, and how the whole army is doing.
  // Below MO.breakAt he breaks and runs for his own edge; once clear of the enemy his nerve comes back and he rallies to the nearest band.
  let moraleAcc = 0;
  function startFlee(m) {
    if (m.flee) return; m.flee = true; m.fleeT = 0; m.engaged = false;
    const g = m.group; m.group = fleeG[m.team]; if (g && g.members) { const i = g.members.indexOf(m); if (i >= 0) g.members.splice(i, 1); }
  }
  function rallyMan(m, dirty) {
    let best = null, bd = MO.rallyJoin * MO.rallyJoin; const arch = m.type === 'archer';
    for (const g of groups) { if (g.team !== m.team || !g.n) continue; const ga = g.members.every((o) => o.type === 'archer'); if (ga !== arch && g.members.length > 3) continue; const d = (g.cx - m.x) ** 2 + (g.cy - m.y) ** 2; if (d < bd) { bd = d; best = g; } }
    m.flee = false; m.fleeT = 0; m.mor = Math.max(m.mor, 45);
    if (!best) { best = newGroup(m.team); best.cx = m.x; best.cy = m.y; best.heading = teams[m.team].front; }
    m.group = best; best.members.push(m); dirty.add(best);
  }
  function escape(m) { m.alive = false; m.escaped = true; m.flee = false; teams[m.team].alive--; teams[m.team].fled++; }
  function moraleTick(dt) {
    if ((moraleAcc += dt) < MO.tick) return; moraleAcc = 0;
    const cnt = [0, 0]; for (const m of men) if (m.alive && !m.flee) cnt[m.team]++;
    const fear = [0, 1].map((t) => { const r = cnt[t] / Math.max(1, cnt[1 - t]); return (r < 0.75 ? (0.75 - r) * 3 : 0) + (1 - cnt[t] / Math.max(1, teams[t].initial)) * 0.6; });
    const R2 = MO.radius * MO.radius, F2 = MO.fleeRadius * MO.fleeRadius, dirty = new Set();
    for (const m of men) {
      if (!m.alive || m.z > 0) continue;
      let nE = 0, nA = 0, nF = 0, ed2 = 1e9;
      forNear(m.x, m.y, 76, (o) => {
        if (o === m || !o.alive) return; const ox = o.x - m.x, oy = o.y - m.y, d2 = ox * ox + oy * oy;
        if (o.team !== m.team) { if (!o.flee) { if (d2 < ed2) ed2 = d2; if (d2 < R2) nE++; } } else if (o.flee) { if (d2 < F2) nF++; } else if (d2 < R2) nA++;
      });
      const ed = Math.sqrt(ed2), hp = 100 * m.hp / m.maxHp;
      if (!m.flee) {
        let dm = 0;
        if (nE > 0) dm -= Math.max(0, nE - nA * 0.8 - 0.5) * 0.6;
        if (hp < 35) dm -= (35 - hp) * 0.02; if (nA >= 3) dm += 0.6;   // shoulder to shoulder with his mates, a man holds
        if (m.stam < 0.2) dm -= 0.5;
        dm -= nF * 0.2 + fear[m.team] * 0.4;
        if (ed > 75) dm += 1.2;
        if (nA >= 5 && nE <= 1) dm += 0.5;
        m.mor = clamp(m.mor + (dm < 0 ? dm / m.brave : dm), 0, 100);
        if (m.mor < MO.breakAt) startFlee(m);
      } else {
        m.mor = Math.min(100, m.mor + (ed > MO.rallyGap ? 3 * m.brave : 0.5));
        if (m.mor > MO.rallyAt && ed > MO.rallyGap && m.hp > MO.rallyHp * m.maxHp && !teams[m.team].routed) rallyMan(m, dirty);
        else if (m.fleeT > MO.escapeT && ed2 === 1e9) { let near = false; forNear(m.x, m.y, MO.escapeGap, (o) => { if (!near && o.alive && o.team !== m.team && !o.flee && Math.hypot(o.x - m.x, o.y - m.y) < MO.escapeGap) near = true; }); if (!near) escape(m); }
      }
    }
    for (const g of dirty) { if (!groups.includes(g)) groups.push(g); reformGroup(g); }
  }

  // ------------------------------------------- pass 5: wounds, impacts, throws ---
  const dbg = { melee: [0, 0], arrow: [0, 0], impact: [0, 0], land: [0, 0] }; let dbgC = 'melee';   // deaths by cause, for the headless tests
  function hurt(d, dmg, a, ux, uy, imp) {
    // now and then a lucky man lives through a blow that should have killed him
    if (d.hp - dmg <= 0 && d.luck > 0 && rand() < d.luck * WD.luckChance) dmg = Math.max(0, d.hp - (3 + rand() * 5) * d.maxHp / 100);
    d.hp -= dmg; d.lastHit = time; d.mor -= dmg * MO.hitK / d.brave;
    if (!d.inj && (d.hp < WD.injAt * d.maxHp || (dmg > WD.bigHit * d.maxHp && rand() < WD.bigHitChance))) d.inj = true;
    if (d.hp <= 0) { if (a) teams[a.team].kills++; dbg[dbgC][d.team]++; die(d, ux, uy, imp); dbgC = 'melee'; return true; }
    dbgC = 'melee';
    if (!d.helmOff && dmg > 0.22 * d.maxHp && rand() < 0.3) knockHelmet(d, ux, uy);
    return false;
  }
  function knockHelmet(m, ux, uy) {
    if (m.helmOff) return; m.helmOff = true;
    particles.push({ k: 'helmet', x: m.x, y: m.y, z: 14, vx: ux * (30 + rand() * 40) + (rand() - 0.5) * 30, vy: uy * (30 + rand() * 40) + (rand() - 0.5) * 30, vz: 50 + rand() * 50, r: rand() * 6.28, vr: (rand() - 0.5) * 20, team: m.team, b: 1 });
  }
  const flankOf = (d, ax, ay) => { const rel = Math.abs(angDiff(d.face, Math.atan2(ay - d.y, ax - d.x))); return d.flee ? IM.flank.rear : rel < 1 ? IM.flank.front : rel < 2.2 ? IM.flank.side : IM.flank.rear; };
  function impact(a, b, closing) {
    const nx = (b.x - a.x), ny = (b.y - a.y), l = Math.hypot(nx, ny) || 1, ux = nx / l, uy = ny / l;
    const pa = a.vx * ux + a.vy * uy, pb = -(b.vx * ux + b.vy * uy);
    let atk = a, def = b, dir = 1; if (pb > pa) { atk = b; def = a; dir = -1; }
    if (atk.flee || atk.stun > 0) return;
    const fl = flankOf(def, atk.x, atk.y), front = fl === IM.flank.front;
    const braced = !!def.T.braceBonus && front && !def.flee && Math.hypot(def.vx, def.vy) < 12;   // braced spears blunt a charge and can't be bowled over
    let power = (closing - IM.min) * (0.55 + 0.45 * atk.stam) * atk.str; if (braced) power /= def.T.braceBonus * 1.6;
    const dmg = power * IM.dmgK * fl / (def.T.shield && front ? 1.2 : 1) * (def.type === 'archer' ? 1.25 : 1);
    a.ic = b.ic = IM.cooldown; atk.stam = Math.max(0, atk.stam - 0.03);
    def.mor -= 2.5 * fl / def.brave; def.stun = Math.max(def.stun, 0.25 + power * 0.006);
    const vis = onScreen(def.x, def.y), mine = atk.team === 0 || def.team === 0;
    if (vis) AudioSys.playLimited('shield_block', 6, { vol: Math.min(0.8, 0.3 + power / 60), pan: panOf(def.x) });
    if (!braced && closing > IM.throwAt && rand() < (closing - IM.throwAt) / 40 + 0.1 * (fl - 1)) {
      def.vz = 50 + closing * 0.6; def.z = 0.1; def.vx = dir * ux * closing * 0.9; def.vy = dir * uy * closing * 0.9; def.spin = (rand() - 0.5) * 8; def.engaged = false;
      if (rand() < IM.helmChance) knockHelmet(def, dir * ux, dir * uy);
      if (mine) { stats.impact += 1.6; Haptics.thrown(); }
    } else if (mine) stats.impact += 0.4;
    dbgC = 'impact'; hurt(def, dmg, atk, dir * ux, dir * uy, 1 + power / 40); dbgC = 'melee';
  }
  function land(m) {
    m.z = 0; m.vz = 0; m.vx *= 0.25; m.vy *= 0.25; m.spin = 0; m.tilt = clamp(m.tilt, -1.45, 1.45); m.stun = Math.max(m.stun, IM.landStun);
    if (R3D && R3D.thud) R3D.thud(m.x, m.y);
    if (onScreen(m.x, m.y)) AudioSys.playSliced('armor_clank', { vol: 0.5, pan: panOf(m.x) });
    const l = Math.hypot(m.vx, m.vy) || 1; dbgC = 'land'; hurt(m, (4 + rand() * 6) * m.maxHp / 100, null, m.vx / l, m.vy / l, 1.2);
  }

  // ---------------------------------------------- pass 5: archers' auto-aim ---
  // Each band of archers picks the thickest knot of enemies in range (foes - 4 x friends within knotR), leads it by its walk, and re-picks every AR.retarget s.
  function autoAim(team, cx, cy, range) {
    const cand = men.filter((s) => s.alive && s.team !== team && !s.flee && s.z < 4 && Math.hypot(s.x - cx, s.y - cy) < range - 15); if (!cand.length) return null;
    let best = null, bs = 0;
    for (let i = 0; i < Math.min(40, cand.length); i++) { const s = cand[(rand() * cand.length) | 0]; let sc = 0; forNear(s.x, s.y, AR.knotR, (o) => { if (o.alive && !o.flee && Math.hypot(o.x - s.x, o.y - s.y) < AR.knotR) sc += o.team !== team ? 1 : -AR.friendlyK; }); if (sc > bs) { bs = sc; best = s; } }
    if (!best || bs < 3) return null;
    let x = 0, y = 0, n = 0; forNear(best.x, best.y, AR.knotR, (o) => { if (o.alive && !o.flee && o.team !== team && Math.hypot(o.x - best.x, o.y - best.y) < AR.knotR) { x += o.x + o.vx * AR.lead; y += o.y + o.vy * AR.lead; n++; } });
    return n ? { x: x / n, y: y / n, n: bs } : null;
  }
  function archerThink(m, dt, g) {
    if (m.reload > 0 || m.stun > 0 || Math.hypot(g.vx, g.vy) > m.T.volleyMoveMax) return;
    if (!(g.aimT > battleT)) {          // (re)pick this band's target
      g.aimT = battleT + AR.retarget; let ax = 0, ay = 0, an = 0; for (const o of g.members) if (o.type === 'archer') { ax += o.x; ay += o.y; an++; }
      g.aim = an ? autoAim(m.team, ax / an, ay / an, m.T.range) : null;
    }
    const tg = g.aim; if (!tg) { m.reload = 0.3; return; }
    const d = Math.hypot(tg.x - m.x, tg.y - m.y); if (d > m.T.range || d < m.T.minRange) { m.reload = 0.3; return; }
    const sc = AR.scatter[0] + d * AR.scatter[1], an = rand() * 6.283, r = Math.sqrt(rand()) * sc, lx = tg.x + Math.cos(an) * r, ly = tg.y + Math.sin(an) * r * 0.8;
    // no archer shoots into a melee where his own spearmen stand
    let friend = false; forNear(lx, ly, AR.friendlyR, (o) => { if (!friend && o.alive && o.team === m.team && !o.flee && o.type !== 'archer' && Math.hypot(o.x - lx, o.y - ly) < AR.friendlyR) friend = true; });
    if (friend) { m.reload = 0.5; return; }
    const T = d / AR.speed;
    arrows.push({ x0: m.x, y0: m.y, x1: lx, y1: ly, t: 0, T, team: m.team, h: d * AR.arcK, str: m.str });
    // the men under the falling arrows see them coming: whoever stands still raises his shield
    forNear(lx, ly, AR.coverR, (o) => { if (o.alive && o.team !== m.team && o.T.shield && !o.flee) o.cover = Math.max(o.cover, T + 0.6); });
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
    const angleF = d.flee ? CB.angle.rear : cosA > 0.35 ? CB.angle.front : cosA > -0.35 ? CB.angle.side : CB.angle.rear;   // a runaway's back is turned
    if (d.T.braceBonus && !d.flee && cosA > 0.35 && Math.hypot(d.vx, d.vy) < 12) momentum = 1 + (momentum - 1) / d.T.braceBonus;   // braced spears blunt charges
    let na = 0, nd = 0; forNear(d.x, d.y, CB.supportRadius, (o) => { if (o === d || o === a) return; if (Math.hypot(o.x - d.x, o.y - d.y) < CB.supportRadius) { if (o.team === a.team) na++; else nd++; } });
    const supF = clamp(1 + CB.supportK * (na - nd) / (na + nd + 1), 0.5, 1.8);
    const stamF = 0.55 + 0.45 * a.stam;
    const hitP = clamp(CB.baseHit * stamF * Math.sqrt(supF) * (angleF > 1 ? 1.3 : 1) * (0.8 + 0.2 * momentum), 0.05, 0.95);
    const vis = onScreen(d.x, d.y);
    if (a.team === 0 || d.team === 0) stats.impact += (momentum - 1) * 2 + (angleF - 1) * 0.6 + 0.15;
    if (rand() > hitP) { if (vis && rand() < 0.3) AudioSys.playLimited('clash', C.audio.clashPerSec, { vol: 0.5, pan: panOf(d.x) }); return; }
    if (d.T.shield && !d.flee && cosA > 0.35 && rand() < CB.shieldBlock * (0.4 + 0.6 * d.stam) / Math.sqrt(momentum)) {
      d.stam -= 0.03 * momentum; d.vx += ux * CB.knockback * 0.3 * momentum; d.vy += uy * CB.knockback * 0.3 * momentum;
      if (vis) AudioSys.playLimited('shield_block', 5, { vol: 0.6, pan: panOf(d.x) }); return;
    }
    const dmg = CB.baseDmg * (a.str / Math.sqrt(d.str)) * momentum * angleF * supF * stamF * (0.65 + 0.35 * a.mor / 100) * (a.inj ? 0.85 : 1) * (1 + (rand() * 2 - 1) * CB.randomness);
    if (angleF > 1) d.mor -= (angleF - 1) * MO.flankK;   // hit from the side or behind: that shakes a man
    const kb = CB.knockback * (momentum - 0.7); d.vx += ux * kb; d.vy += uy * kb;
    if (vis) AudioSys.playLimited('clash', C.audio.clashPerSec, { vol: 0.8, pan: panOf(d.x), rate: 0.9 + rand() * 0.2 });
    if (hurt(d, dmg, a, ux, uy, momentum * angleF)) {}
    else { decalQ.push(['blood', d.x, d.y, 1.6 + rand(), ux, uy, 0.55]); spawnBlood(d.x, d.y, ux, uy, 3, 0.6); if (vis && rand() < 0.35) AudioSys.playSliced('blood', { vol: 0.45, pan: panOf(d.x) }); }
  }

  function die(m, ux, uy, imp) {
    m.alive = false; teams[m.team].alive--; stats.deathRate += 1;
    const fly = clamp(imp, 1, 5); const vis = onScreen(m.x, m.y); const FM = C.fx.flingMul || 1, hv = 1 + (FM - 1) * clamp((fly - 1.2) / 1.5, 0, 1);   // flingMul: heavy impacts throw bodies further (3D)
    // pass 5: a death shakes his mates nearby and heartens the enemy
    forNear(m.x, m.y, MO.deathRadius, (o) => { if (!o.alive || o === m || Math.hypot(o.x - m.x, o.y - m.y) > MO.deathRadius) return; if (o.team === m.team) o.mor -= MO.deathFriend / o.brave; else o.mor = Math.min(100, o.mor + MO.deathFoe); });
    particles.push({ k: 'body', x: m.x, y: m.y, z: Math.max(1, m.z), vx: m.vx * 0.4 + ux * (14 + fly * 16) * (0.6 + rand()) * hv, vy: m.vy * 0.4 + uy * (14 + fly * 16) * (0.6 + rand()) * hv, vz: (18 + fly * 18 * rand()) * Math.sqrt(hv), heavy: hv > 1.3, r: m.face, vr: (rand() - 0.5) * 3 * fly, team: m.team, type: m.type, helmOff: false });
    const body = particles[particles.length - 1];
    if (m.helmOff) body.helmOff = true; else if (rand() < 0.5) { body.helmOff = true; particles.push({ k: 'helmet', x: m.x, y: m.y, z: 4, vx: ux * 30 * fly * rand() + (rand() - 0.5) * 40, vy: uy * 30 * fly * rand() + (rand() - 0.5) * 40, vz: 40 + 50 * rand() * fly / 2, r: 0, vr: (rand() - 0.5) * 20, team: m.team, b: 1 }); }
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
      let hit = null, hd = AR.hitRadius; forNear(a.x1, a.y1, AR.hitRadius, (o) => { if (!o.alive || o.z > 4) return; const d = Math.hypot(o.x - a.x1, o.y - a.y1); if (d < hd) { hd = d; hit = o; } });
      if (hit) {
        // pass 5: moving men are easy marks; still men behind raised shields mostly shrug arrows off (friendly fire possible in a melee)
        const ux = (a.x1 - a.x0), uy = (a.y1 - a.y0), l = Math.hypot(ux, uy) || 1; const cosA = Math.cos(hit.face) * -ux / l + Math.sin(hit.face) * -uy / l;
        const sp = Math.hypot(hit.vx, hit.vy), shield = hit.T.shield && hit.cover > 0 && sp < 12 && !hit.flee, P = AR.hitP;
        const ch = hit.flee ? P.flee : hit.type === 'archer' ? (sp > 12 ? P.moving : P.archer) : sp >= 12 ? P.moving : shield ? P.shield : P.still;
        if (rand() >= ch) { if (shield && onScreen(hit.x, hit.y)) AudioSys.playLimited('arrow_hit', 5, { vol: 0.4 }); decalQ.push(['arrow', a.x1 + (rand() - 0.5) * 4, a.y1 + (rand() - 0.5) * 4, Math.atan2(uy, ux)]); continue; }
        const D = sp >= 12 ? AR.dmgMoving : AR.dmgStill; hit.mor -= MO.arrowHit / hit.brave;
        if (onScreen(hit.x, hit.y)) AudioSys.playLimited('arrow_hit', 5, { vol: 0.6 });
        dbgC = 'arrow'; if (!hurt(hit, lerp(D[0], D[1], rand()) * a.str / 0.8 * (cosA < -0.3 || hit.flee ? 1.5 : 1), { team: a.team }, ux / l, uy / l, 1)) spawnBlood(hit.x, hit.y, ux / l, uy / l, 2, 0.5);
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
  // pass 5: the computer general (ported from the Thumb Legions plan). Archers split off; two 22% wings peel off the sides of the block.
  // advance -> pin (centre halts holdDist short of your line, in its own bow range, while the wings swing round to halfW + 70..90)
  // -> assault when both wings are set, after pinMax s of pinning, or when more than assaultContact of the army is already in contact.
  // Paces walk / run / charge by distance and breath; bands under foldBelow men fold into the nearest bigger one. Works for either side.
  function makeBot(team) {
    const B = C.bot, PACE = [0, 0.4, 0.7, 1.0];
    const centroid = (list) => { let x = 0, y = 0; for (const m of list) { x += m.x; y += m.y; } return [x / list.length, y / list.length]; };
    return { team, t: 0, plan: 'advance', pinT: 0, split: 0, think(dt) {
      if ((this.t -= dt) > 0) return; this.t = B.thinkEvery;
      if (teams[team].routed) return;
      const isArch = (g) => g.members.every((m) => m.type === 'archer');
      let mine = groups.filter((g) => g.team === team && g.n && !isArch(g)); const bows = groups.filter((g) => g.team === team && g.n && isArch(g));
      const foes = groups.filter((g) => g.team !== team && g.n);
      if (this.split === 0 && battleT > 0.5) { this.split = 1; Commands.issue(team, { type: 'splitType', unitType: 'archer' }); return; }
      if (battleT < B.start) return;
      if (!foes.length) { for (const g of groups) if (g.team === team && g.throttle > 0) Commands.issue(team, { type: 'halt', group: g.id }); return; }
      // fold tiny bands into the nearest bigger one
      for (const g of mine) if (g.n < B.foldBelow) { let bb = null, bd = 1e18; for (const o of mine) if (o !== g && o.n >= B.foldBelow) { const d = (o.cx - g.cx) ** 2 + (o.cy - g.cy) ** 2; if (d < bd) { bd = d; bb = o; } } if (bb) Commands.issue(team, { type: 'join', group: g.id, into: bb.id }); }
      for (const g of bows) if (g.n < B.foldBelow) { const o = bows.filter((q) => q !== g && q.n >= B.foldBelow).sort((p, q) => (p.cx - g.cx) ** 2 + (p.cy - g.cy) ** 2 - (q.cx - g.cx) ** 2 - (q.cy - g.cy) ** 2)[0]; if (o) Commands.issue(team, { type: 'join', group: g.id, into: o.id }); }
      mine = groups.filter((g) => g.team === team && g.n && !isArch(g)); if (!mine.length) { this.archers(bows, mine); return; }
      if (this.split === 1) {   // the wings: the outermost 22% of the block on each side
        this.split = 2; const body = mine.reduce((p, q) => (q.n > p.n ? q : p)).members.filter((m) => !m.flee && m.type !== 'archer');
        if (body.length >= 40) {
          const F = teams[team].front, rx = -Math.sin(F), ry = Math.cos(F), [cx, cy] = centroid(body), lat = (m) => (m.x - cx) * rx + (m.y - cy) * ry;
          const sorted = body.slice().sort((p, q) => lat(p) - lat(q)), k = Math.round(body.length * B.wingFrac);
          const L = Commands.issue(team, { type: 'splitIds', ids: sorted.slice(0, k).map((m) => m.id) }); if (L) L.role = 'L';
          const Rg = Commands.issue(team, { type: 'splitIds', ids: sorted.slice(-k).map((m) => m.id) }); if (Rg) Rg.role = 'R';
          return;
        }
      }
      const P = men.filter((m) => m.alive && m.team !== team && !m.flee && m.type !== 'archer'), body = P.length ? P : men.filter((m) => m.alive && m.team !== team && !m.flee); if (!body.length) return;
      const [px, py] = centroid(body);
      let ax = 0, ay = 0, an = 0; for (const g of mine) { ax += g.cx * g.n; ay += g.cy * g.n; an += g.n; } ax /= an; ay /= an;
      const D = Math.hypot(px - ax, py - ay) || 1, ux = (px - ax) / D, uy = (py - ay) / D, lx = -uy, ly = ux;
      let halfW = 30; for (const m of body) halfW = Math.max(halfW, Math.abs((m.x - px) * lx + (m.y - py) * ly));
      let fighting = 0; for (const m of men) if (m.alive && m.team === team && m.engaged) fighting++;
      const wings = mine.filter((g) => g.role === 'L' || g.role === 'R'), cen = mine.filter((g) => g.role !== 'L' && g.role !== 'R');
      let cx0 = ax, cy0 = ay; if (cen.length) { let x = 0, y = 0, n = 0; for (const g of cen) { x += g.cx * g.n; y += g.cy * g.n; n += g.n; } cx0 = x / n; cy0 = y / n; }
      const wingPt = (g) => { let side = Math.sign((g.cx - ax) * lx + (g.cy - ay) * ly); if (!side) side = g.role === 'L' ? -1 : 1;
        if (this.plan === 'advance') return [cx0 + ux * 20 + lx * side * (halfW + B.flankOut[1]), cy0 + uy * 20 + ly * side * (halfW + B.flankOut[1])];
        return [px + lx * side * (halfW + B.flankOut[0]) + ux * 25, py + ly * side * (halfW + B.flankOut[0]) + uy * 25]; };
      if (this.plan === 'advance' && D < B.pinDist) this.plan = 'pin';
      if (this.plan === 'pin') { this.pinT += B.thinkEvery; const set = wings.every((g) => { const [wx, wy] = wingPt(g); return Math.hypot(wx - g.cx, wy - g.cy) < B.wingSetDist + 10; }); if (set || this.pinT > B.pinMax) this.plan = 'assault'; }
      if (fighting > teams[team].initial * B.assaultContact) this.plan = 'assault';   // they came at us: fight it out
      for (const g of mine) {
        let f = null, bd = 1e18; for (const o of foes) { const d = (o.cx - g.cx) ** 2 + (o.cy - g.cy) ** 2 - o.n * 300; if (d < bd) { bd = d; f = o; } }
        const dx = f.cx - g.cx, dy = f.cy - g.cy, d = Math.hypot(dx, dy) || 1, fx = dx / d, fy = dy / d;
        let busy = 0; for (const m of g.members) if (m.engaged) busy++;
        let tx, ty, pace;
        if (this.plan === 'assault' || busy > g.n * 0.25) { tx = f.cx + fx * 30; ty = f.cy + fy * 30; pace = d > 220 ? 1 : d > 90 ? (g.sta > 0.45 ? 2 : 1) : (g.sta > 0.25 ? 3 : 2); }   // walk in to keep the legs fresh, run only for the last stretch
        else if (g.role === 'L' || g.role === 'R') { [tx, ty] = wingPt(g); const wd = Math.hypot(tx - g.cx, ty - g.cy); pace = this.plan === 'pin' && wd > 120 ? 2 : wd > 30 ? 1 : 0; }
        else { tx = px - ux * B.holdDist; ty = py - uy * B.holdDist; pace = Math.hypot(tx - g.cx, ty - g.cy) > 25 ? 1 : 0; }   // the centre stops just out of reach of your spears, in range of its own bows
        if (g.sta < 0.2 && d > 160) pace = 0;
        this.order(g, tx, ty, pace, fx, fy);
      }
      this.archers(bows, mine);
    },
    order(g, tx, ty, pace, fx, fy) {
      tx = clamp(tx, 10, WW - 10); ty = clamp(ty, 10, WH - 10); const dx = tx - g.cx, dy = ty - g.cy;
      if (!pace || Math.hypot(dx, dy) < 25) { if (g.throttle > 0) Commands.issue(this.team, { type: 'halt', group: g.id }); return; }
      Commands.issue(this.team, { type: 'move', group: g.id, dx, dy, throttle: PACE[pace] });
    },
    // archers: shoot the thickest knot in range, halting to do it; with nothing to shoot keep archerBehind behind the spears; back away from anyone within archerFlee
    archers(bows, mine) {
      for (const g of bows) {
        let fx = 0, fy = 0, fn = 0, close = 1e9; for (const m of men) if (m.alive && m.team !== this.team && !m.flee) { fx += m.x; fy += m.y; fn++; close = Math.min(close, Math.hypot(m.x - g.cx, m.y - g.cy)); }
        if (!fn) { this.order(g, g.cx, g.cy, 0); continue; } fx /= fn; fy /= fn;
        const dx = fx - g.cx, dy = fy - g.cy, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
        if (close < B.archerFlee) this.order(g, g.cx - ux * 70, g.cy - uy * 70, 2);
        else if (g.aim) this.order(g, g.cx, g.cy, 0);
        else if (mine.length) { let ix = 0, iy = 0, n = 0; for (const o of mine) { ix += o.cx * o.n; iy += o.cy * o.n; n += o.n; } this.order(g, ix / n - ux * B.archerBehind, iy / n - uy * B.archerBehind, 1); }
        else this.order(g, g.cx + ux * (d - 330 * 0.75), g.cy + uy * (d - 330 * 0.75), 1);
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
    forNear(w.x, w.y, r, (m) => { if (m.team !== 0 || !m.alive || m.flee) return; const d = Math.hypot(m.x - w.x, m.y - w.y); if (d < bd) { bd = d; best = m.group; } });
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
    // pass 5: while a thumb is down the view eases much slower (the ground doesn't slide away under the drag) -- unless someone is about to leave the screen
    const hw = SW / (2 * cam.z), hh = SH / (2 * cam.z), inView = x0 >= cam.x - hw && x1 <= cam.x + hw && y0 >= cam.y - hh && y1 <= cam.y + hh;
    const he = inp.down && inView ? C.camera.holdEase || 1 : 1;
    const kz = instant ? 1 : Math.min(1, dt * C.camera.lerp * (z < cam.z ? 3 : 0.6 * he)), kp = instant ? 1 : Math.min(1, dt * C.camera.lerp * 1.5 * he);
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
      const img = m.atk > 0 ? S.attack : sp > 5 ? S.walk[(m.step | 0) & 3] : ((m.engaged || m.cover > 0) && S.brace ? S.brace : S.idle);
      const lift = m.z > 0 ? 1 + m.z * 0.025 : 1, c = Math.cos(m.face + m.tilt * 0.6) * sc * lift, s = Math.sin(m.face + m.tilt * 0.6) * sc * lift; const half = S.idle.width / 2;   // pass 5: thrown men loom up and spin
      ctx.setTransform(c, s, -s, c, ox + m.x * z, oy + (m.y - Math.max(0, m.z) * 0.6) * z);
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
  // pass 5: how many men stand in each band, written over their heads (Roman serif, parchment for yours, the enemy's tunic for theirs),
  // runaways counted at their centroid, and an arrow on the screen edge for any band the camera can't show (a safety net: the fit keeps everyone in view)
  const lighten = (hex, k) => { const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * k)); return `rgb(${c[0]},${c[1]},${c[2]})`; };
  function teamUI(t) { const T = teams[t]; return T._ui || (T._ui = t === 0 ? '#f4e8c8' : lighten(T.tunic || '#c04030', 0.45)); }
  function drawBadges() {
    const marks = [];
    for (const g of groups) if (g.n) {
      let top = 1e9, sx = 0, n = 0; const arch = g.members.every((m) => m.type === 'archer');
      for (const m of g.members) { const p = R3D ? R3D.toScreenH(m.x, m.y, 20 * (C.r3d.manHeight || 1)) : toScreen(m.x, m.y - 9); if (p.y < top) top = p.y; sx += p.x; n++; }
      marks.push({ x: sx / n, y: top - 7, wx: g.cx, wy: g.cy, t: g.team, txt: arch ? `${g.n} bows` : String(g.n), a: 1 });
    }
    for (const t of [0, 1]) { let x = 0, y = 0, n = 0; for (const m of men) if (m.alive && m.flee && m.team === t) { x += m.x; y += m.y; n++; }
      if (n) { const p = R3D ? R3D.toScreenH(x / n, y / n, 24 * (C.r3d.manHeight || 1)) : toScreen(x / n, y / n - 12); marks.push({ x: p.x, y: p.y, wx: x / n, wy: y / n, t, txt: `${n} fleeing`, a: 0.7, it: true }); } }
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
    const top = R3D ? (C.r3d.safePx || {}).top || 50 : 48, bot = SH - 66, l = 18, r = SW - 18;
    const placed = [];
    for (const k of marks) {
      const col = teamUI(k.t); ctx.globalAlpha = k.a;
      const c = toScreen(k.wx, k.wy), off = c.x < 4 || c.x > SW - 4 || c.y < 4 || c.y > SH - 4;
      if (!off) {
        let y = Math.max(top + 10, k.y); const w = k.txt.length * 7 + 4;
        for (let it = 0; it < 4; it++) { const hit = placed.find((q) => Math.abs(q.x - k.x) < (q.w + w) / 2 && Math.abs(q.y - y) < 13); if (!hit) break; y = hit.y - 13; }   // stacked bands in a melee: lift the label clear
        placed.push({ x: k.x, y, w });
        ctx.font = `${k.it ? 'italic ' : ''}600 12px Georgia, 'Times New Roman', serif`; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(20,16,10,0.62)'; ctx.strokeText(k.txt, k.x, y); ctx.fillStyle = col; ctx.fillText(k.txt, k.x, y);
      } else {
        const cx = SW / 2, cy = (top + bot) / 2, dx = c.x - cx, dy = c.y - cy, f = Math.min((r - l) / 2 / Math.max(1e-6, Math.abs(dx)), (bot - top) / 2 / Math.max(1e-6, Math.abs(dy)));
        const ex = cx + dx * f, ey = cy + dy * f, ang = Math.atan2(dy, dx), ux = Math.cos(ang), uy = Math.sin(ang);
        ctx.save(); ctx.translate(ex, ey); ctx.rotate(ang); ctx.fillStyle = 'rgba(20,16,10,0.55)'; ctx.beginPath(); ctx.arc(-8, 0, 13, 0, 6.283); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(-10, -7); ctx.lineTo(-6, 0); ctx.lineTo(-10, 7); ctx.closePath(); ctx.fill(); ctx.restore();
        ctx.font = `600 11px Georgia, serif`; ctx.textBaseline = 'middle'; const lx = ex - ux * 34, ly = ey - uy * 26; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(20,16,10,0.6)'; ctx.strokeText(k.txt, lx, ly); ctx.fillStyle = col; ctx.fillText(k.txt, lx, ly); ctx.textBaseline = 'alphabetic';
      }
    }
    ctx.globalAlpha = 1;
  }
  function drawControls() {
    drawBadges();
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
    AudioSys.stopMusic(); AudioSys.play('battle_horn', { vol: 1 }); Haptics.start(); endT = 0; moraleAcc = 0; hudT = 0;
    flash('Drag from your army • far = CHARGE');
  }
  const standing = (t) => { let n = 0; for (const m of men) if (m.alive && m.team === t && !m.flee) n++; return n; };
  const fledN = (t) => { let n = teams[t].fled; for (const m of men) if (m.alive && m.flee && m.team === t) n++; return n; };   // escaped + still running
  function endBattle(win) {
    $('flash').style.opacity = 0; flashT = 0;   // the end card carries the news; don't stack the rout banner over it
    Haptics.result && Haptics.result(win);
    state = 'end'; endT = 0; AudioSys.silenceLayers(); AudioSys.play(win ? 'victory' : 'defeat'); setTimeout(() => AudioSys.playMusic(0.35), 2500);
    $('endtitle').textContent = win ? 'Victory' : 'Defeat';
    $('endsub').textContent = win ? `${teams[1].name} ${teams[1].routed ? 'routs from the field' : 'is destroyed'}.` : `${teams[0].name} ${teams[0].routed ? 'breaks and flees' : 'has fallen'}.`;
    $('endstats').innerHTML = `<div><img src="${flagImg(teams[0])}"> ${teams[0].name}: <b>${standing(0)}</b> standing · ${teams[0].kills} kills · ${fledN(0)} fled</div><div><img src="${flagImg(teams[1])}"> ${teams[1].name}: <b>${standing(1)}</b> standing · ${teams[1].kills} kills · ${fledN(1)} fled</div>`;
    setTimeout(() => show('end'), 1600);
  }
  // pass 5: an army only breaks for good when it is truly beaten -- few left on their feet even counting the men who might still rally,
  // and those few heavily outnumbered (or no spearmen left while the enemy still has some). Then they all run. Otherwise runaways get a moment to rally.
  function checkEnd(dt) {
    const a = [0, 0], f = [0, 0], sp = [0, 0], AB = MO.armyBreak;
    for (const m of men) if (m.alive) { if (m.flee) f[m.team]++; else { a[m.team]++; if (m.type !== 'archer') sp[m.team]++; } }
    for (let k = 0; k < 2; k++) {
      const t = teams[k], tot = t.initial;
      if (!t.routed && a[k] > 0 && ((a[k] <= Math.max(AB.standMin, tot * AB.standFrac) && a[k] + f[k] <= tot * AB.totalFrac && a[1 - k] >= a[k] * AB.outnumber) || (!sp[k] && sp[1 - k] >= AB.spearsLeft))) {
        t.routed = true; t.routT = 0; for (const m of men) if (m.alive && m.team === k) { startFlee(m); m.mor = 0; } a[k] = 0;
        flash(k ? `${t.name} breaks and runs!` : `${t.name} breaks!`); Haptics.broke && Haptics.broke();
      }
      if (t.routed) t.routT += dt;
    }
    const wait = (k) => (teams[k].routed || f[k] < 3 ? MO.endWait : 6);
    if (a[0] === 0 || a[1] === 0) { endT += dt; const k = a[0] === 0 ? 0 : 1; if (endT > wait(k) || (teams[k].routed && teams[k].routT > 3)) endBattle(a[0] > 0); } else endT = 0;
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
  document.querySelectorAll('button').forEach((b) => b.addEventListener('pointerdown', () => { AudioSys.unlock(); Haptics.ui(); if (!['btnPlay', 'btnHorn', 'btnArmyDone'].includes(b.id) && !b.classList.contains('sw')) AudioSys.play('ui_select', { vol: 0.7 }); }));
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
    get state() { return state; }, get selected() { return selected; }, get battleT() { return battleT; }, get inputDown() { return !!inp.down; }, get fleeGroups() { return fleeG; }, dbg,
    get ground() { return ground; }, get WW() { return WW; }, get WH() { return WH; }, get MAP() { return MAP; }, get COLS() { return COLS; }, get ROWS() { return ROWS; },
    get trample() { return trample; }, get trampleDx() { return trampleDx; }, get mudGrid() { return mudGrid; }, TR, get TW() { return TW; }, get TH() { return TH; },
    terrainAt: (x, y) => terrainAt(x, y), get SW() { return SW; }, get SH() { return SH; },
  };

  // ------------------------------------------------------------------ loop ---
  let last = performance.now();
  // pass 5 HUD: per side, the average morale and breath of the men still standing, and how many stand
  let hudT = 0; const hudEl = {};
  function updateHUD() {
    const mo = [0, 0], st = [0, 0], n = [0, 0];
    for (const m of men) if (m.alive && !m.flee) { n[m.team]++; mo[m.team] += m.mor; st[m.team] += m.stam; }
    ['hp', 'he'].forEach((k, t) => {
      const el = hudEl[k] || (hudEl[k] = { mor: $(k + 'mor'), sta: $(k + 'sta'), cnt: $(k + 'count'), bar: $(k + 'bar') });
      const M = n[t] ? mo[t] / n[t] : 0, S = n[t] ? st[t] / n[t] : 0;
      if (el.mor) { el.mor.style.width = M.toFixed(1) + '%'; el.mor.parentNode.classList.toggle('low', M < 30); }
      if (el.sta) { el.sta.style.width = (100 * S).toFixed(1) + '%'; el.sta.parentNode.classList.toggle('low', S < 0.25); }
      if (el.bar) el.bar.style.width = (100 * n[t] / teams[t].initial) + '%';
      if (el.cnt) el.cnt.textContent = n[t];
    });
  }
  function frame(now) {
    let dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
    if (state === 'battle' || state === 'end') {
      const sdt = R3D ? dt * R3D.timeScale(dt) : dt;   // 3D: hit-stop on big impacts
      for (let w = 0; w < WARP; w++) {                // ?warp=N: N sim steps per frame (headless tests on slow software GL)
        battleT += sdt; for (const b of bots) b.think(sdt);
        updateGroups(sdt); updateMen(sdt); if (state === 'battle') moraleTick(sdt); updateParticles(sdt); updateTrample(sdt);
        if (state === 'battle') checkEnd(sdt);
        if (w < WARP - 1) flushDecals();
      }
    } else { for (const m of men) m.step += 0; }
    flushDecals(); updateCamera(dt); updateAudio(dt); render();
    if (flashT > 0 && (flashT -= dt) <= 0) $('flash').style.opacity = 0;
    if (state === 'battle' && (hudT -= dt) <= 0) { hudT = 0.2; updateHUD(); }
    requestAnimationFrame(frame);
  }
  resize(); newBattle(Number(Q.get('seed')) || undefined);
  if (AUTO) { state = 'battle'; show('battle'); AudioSys.enabled = false; }
  else show('menu');
  window.BF = { get state() { return state; }, teams: () => teams, men: () => men, Commands, CONFIG, sim: SIM };
  requestAnimationFrame(frame);
})();
