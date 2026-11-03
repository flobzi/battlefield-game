// ============================================================================
//  BATTLE FIELD GAME — prototype config. EVERY tweakable lives here.
// ============================================================================
window.CONFIG = {
  world: { w: 1240, h: 1160, cell: 40, groundRes: 2 },   // world units; ground canvas px per unit
  armies: {
    gapY: 300,                  // distance between the two front lines at start
    composition: [              // data-driven: add {type:'cavalry',count:40} once implemented
      { type: 'spearman', count: 400, rows: 'front' },
      { type: 'archer',   count: 100, rows: 'back' },
    ],
    spacing: 12.5, columns: 26,
  },
  control: {
    dragMaxPx: 130,             // drag distance (screen px) for full charge
    deadzonePx: 10,
    levels: [ { at: 0.0, name: 'Walk' }, { at: 0.45, name: 'Run' }, { at: 0.82, name: 'CHARGE' } ],
    snap: 0.06,                 // magnet width around level thresholds (subtle snap)
    pickRadiusPx: 70,           // touch-down this close to a group grabs it
    doubleTapMs: 300, doubleTapPx: 40,
    splitRadius: 75,            // world units: men within this of the double-tap leave as a new group
    retreatSpeedMul: 0.7,
  },
  move: {
    walk: 22, run: 46, charge: 74,      // units / second
    accel: 70, turnRate: 2.2,
    formationK: 2.2,            // spring to formation slot (liquid ↔ rigid)
    separation: 9.5, sepK: 140,
    enemySepK: 260,
    engageRadius: 46,           // men lock onto enemies closer than this
    engageK: 1.0,
  },
  stamina: { drainRun: 0.06, drainCharge: 0.14, drainFight: 0.03, recoverWalk: 0.05, recoverIdle: 0.11, minSpeedMul: 0.45 },
  combat: {
    baseHit: 0.55, baseDmg: 34, cooldown: [0.9, 1.6],
    momentumK: 1.6,             // bonus per (closing speed / charge speed)
    angle: { front: 1.0, side: 1.9, rear: 3.2 },     // flank / rear multipliers
    supportRadius: 26, supportK: 0.55,
    shieldBlock: 0.35,          // frontal block chance (scaled by defender stamina)
    randomness: 0.45,           // damage spread ±
    knockback: 22,
    routAt: 0.22,               // army routs below this fraction alive (if outnumbered)
  },
  arrows: { speed: 230, arcK: 0.32, spread: 14, damage: 55, hitRadius: 5.5, shieldBlock: 0.4,
            // pass 5: aim at the thickest enemy knot (score = foes - friendlyK x friends within knotR, lead by v x lead), never where own spearmen stand within friendlyR of the landing spot;
            // hit chance by target state: still behind a raised shield / still / moving / fleeing
            knotR: 32, friendlyK: 4, lead: 0.8, friendlyR: 16, retarget: 0.8, scatter: [10, 0.1], coverR: 50,
            hitP: { shield: 0.12, still: 0.4, moving: 0.72, flee: 0.85, archer: 0.5 }, dmgStill: [38, 68], dmgMoving: [50, 90] },
  fx: { maxParticles: 1400, bloodDrops: [6, 14], decalsPerFrame: 40 },
  grass: { tufts: 1500, recover: 0.04, trampleK: 0.5 },
  camera: { margin: 34, minViewUnits: 200, lerp: 1.4, holdEase: 0.35 },   // holdEase: camera eases this much slower while a thumb is down (pass 5)   // camera always fits ALL living men + margin; never closer than minViewUnits on the short axis
  render: { unitScale: 1.5, shadowDx: -3.2, shadowDy: 3.6, shadowAlpha: 0.5 },   // soldiers drawn larger than their footprint for readability; sun from top-right,
  audio: {
    master: 0.9, music: 0.55, sfx: 0.9,
    bloodPerSec: 4, bloodPoly: 3, clashPerSec: 7,
    ambienceTargetDb: -30, ambienceDuck: 0.4,
  },
  bot: { thinkEvery: 0.6, chargeDist: 150, flankAfter: 6, aggression: 0.8,
         // pass 5 (Thumb Legions plan): 22% wings each side, centre pins 150 short in bow range, wings flank to halfW+70..90,
         // assault when wings are set / after pinMax s / when > assaultContact x army size men are in contact; archers back off inside archerFlee
         start: 1.4, wingFrac: 0.22, holdDist: 150, pinDist: 190, pinMax: 12, assaultContact: 0.15, flankOut: [70, 90], wingSetDist: 70, archerFlee: 80, archerBehind: 40, foldBelow: 5 },
  // pass 5: per-soldier morale (0..100). Each man ticks every `tick` s from what he sees within `radius`; < breakAt he flees on his own,
  // > rallyAt (and enemy > rallyGap away, hp > rallyHp) he rallies to the nearest group within rallyJoin. Army breaks on the three-part test.
  morale: { tick: 0.25, radius: 28, fleeRadius: 40, start: [78, 100], brave: [0.85, 1.15], breakAt: 5, rallyAt: 35, rallyGap: 70, rallyHp: 0.2, rallyJoin: 250,
            hitK: 0.05, flankK: 1.5, deathRadius: 35, deathFriend: 2.5, deathFoe: 2, arrowHit: 1.5, escapeGap: 300, escapeT: 6, rallyHorn: 20, rallyHornCD: 8,
            armyBreak: { standFrac: 0.15, standMin: 5, totalFrac: 0.3, outnumber: 2.5, spearsLeft: 10 }, endWait: 2.2 },
  // pass 5: wounds — below injAt x maxHp a man is 'inj': slower, recovers stamina slower; luck (-1..1) can turn a lethal blow into a scrape
  wounds: { injAt: 0.55, bigHit: 0.2, bigHitChance: 0.35, speedMul: 0.62, recoverMul: 0.6, luckChance: 0.15 },
  // pass 5: charge impacts — closing speed above `min` hurts / stuns; above `throwAt` men get thrown (and may lose their helmet)
  impact: { min: 30, throwAt: 58, flank: { front: 1.0, side: 1.45, rear: 2.1 }, dmgK: 0.42, cooldown: 0.7, gravity: 300, landStun: 0.9, helmChance: 0.5 },
};

// ----------------------------------------------------------------------------
//  UNIT TYPES — data-driven. sprite: builder id in art.js; behaviour: sim id.
// ----------------------------------------------------------------------------
window.UNIT_TYPES = {
  spearman: {
    label: 'Spearman', enabled: true, behaviour: 'melee', sprite: 'spearman',
    hp: [90, 110], str: [0.9, 1.15], spd: [0.92, 1.08], radius: 4.4,
    reach: 13, shield: true, braceBonus: 1.3,  // bonus vs charging enemies hitting their front
    dropItems: ['helmet', 'spear', 'shield'],
    sounds: { hit: 'clash', die: 'blood' },
  },
  archer: {
    label: 'Archer', enabled: true, behaviour: 'ranged', sprite: 'archer',
    hp: [65, 80], str: [0.7, 0.9], spd: [1.0, 1.1], radius: 4.0,
    reach: 9, shield: false, range: 330, minRange: 30, reload: [2.4, 3.6], volleyMoveMax: 26,
    dropItems: ['helmet', 'bow'],
    sounds: { shoot: 'arrow_loose', hit: 'clash', die: 'blood' },
  },
  // ---- STUBS: define stats + sprite + behaviour to enable ---------------------
  swordsman: {
    label: 'Swordsman', enabled: false, behaviour: 'melee', sprite: 'spearman', // TODO sprite 'swordsman'
    hp: [100, 120], str: [1.05, 1.25], spd: [0.95, 1.05], radius: 4.4, reach: 8, shield: true,
    dropItems: ['helmet', 'sword', 'shield'], sounds: { hit: 'clash', die: 'blood' },
  },
  cavalry: {
    label: 'Cavalry', enabled: false, behaviour: 'melee', sprite: 'spearman', // TODO sprite 'horse', behaviour 'cavalry' (turn radius, trample)
    hp: [180, 220], str: [1.3, 1.5], spd: [1.8, 2.0], radius: 7.5, reach: 12, shield: true, massMul: 3.0,
    dropItems: ['helmet', 'spear'], sounds: { hit: 'clash', die: 'blood', move: 'hooves' },
  },
};

// ----------------------------------------------------------------------------
//  AUDIO SLOTS — files in audio/. Missing slot → synthesized placeholder.
//  gainDb is added on top of auto-normalisation to normDb (from manifest.js).
// ----------------------------------------------------------------------------
window.AUDIO_SLOTS = {
  menu_music:   { files: ['menu_music', 'menu_music_2'], kind: 'music', normDb: -20, gainDb: 0, xfade: 5, fromStart: true }, // rotates tracks with crossfade
  battle_music: { files: ['battle_music'], kind: 'music', normDb: -20, gainDb: -4, xfade: 4, fromStart: true }, // low bed under the fight
  battle_horn:  { files: ['battle_start_horn'], kind: 'oneshot', normDb: -18, gainDb: 0 },
  rally_horn:   { files: ['battle_start_horn'], kind: 'oneshot', normDb: -18, gainDb: -6, rate: 1.18 }, // placeholder reuse
  march_bed:    { files: ['march_walk_1', 'march_walk_2', 'march_walk_3'], kind: 'layer', normDb: -20, gainDb: -2, xfade: 2.5 },
  ambience_bed: { files: ['ambience_1', 'ambience_3', 'ambience_4', 'ambience_5', 'ambience_6'], kind: 'layer', normDb: -30, gainDb: 0, xfade: 4 },
  ambience_accent: { files: ['ambience_2'], kind: 'oneshot', normDb: -30, gainDb: 0 },
  // footsteps classified by onset density (tools/analyze_audio.py): sparse distinct steps = walk, dense = run, continuous = mud/crowd churn
  steps_walk:   { files: ['footsteps_5', 'footsteps_7', 'footsteps_8', 'footsteps_10'], kind: 'layer', normDb: -24, gainDb: 0, xfade: 1.5 },
  steps_run:    { files: ['footsteps_4', 'footsteps_6', 'footsteps_9', 'footsteps_11'], kind: 'layer', normDb: -24, gainDb: 0, xfade: 1.2 },
  steps_mud:    { files: ['footsteps_1', 'footsteps_2', 'footsteps_3'], kind: 'layer', normDb: -26, gainDb: 0, xfade: 2 },
  charge_cry:   { files: ['battle_cries_1', 'battle_cries_2', 'battle_cries_3', 'battle_cries_4'], kind: 'oneshot', normDb: -20, gainDb: 0, maxDur: 5 },
  melee_cries:  { files: ['battle_cries_1', 'battle_cries_2', 'battle_cries_3', 'battle_cries_4'], kind: 'layer', normDb: -21, gainDb: 0, xfade: 2 },
  melee_clash:  { files: ['sword_fight_1', 'sword_fight_2', 'sword_fight_3', 'sword_fight_4'], kind: 'layer', normDb: -22, gainDb: 0, xfade: 1.5 },
  blood:        { files: ['blood_1', 'blood_2', 'blood_3', 'blood_4', 'blood_5', 'blood_6'], kind: 'sliced', normDb: -18, gainDb: -2, perSec: 4, poly: 3 },
  death_scream: { files: ['death_scream_1', 'death_scream_2', 'death_scream_3', 'death_scream_4'], kind: 'oneshot', normDb: -20, gainDb: -3, chance: 0.3, perSec: 1.5 },
  armor_clank:  { files: ['armor_clank_1', 'armor_clank_2', 'armor_clank_3', 'armor_clank_4', 'armor_clank_5', 'armor_clank_6'], kind: 'sliced', normDb: -20, gainDb: -2, perSec: 6, poly: 4 }, // helmet hits/landings, body falls
  armor_layer:  { files: ['armor_clank_1', 'armor_clank_2', 'armor_clank_3', 'armor_clank_4', 'armor_clank_5', 'armor_clank_6'], kind: 'layer', normDb: -22, gainDb: -6, xfade: 1 },  // soft kit jingle while formations march/brace
  // ---- synthesized placeholders (drop a file with this name list to replace) ----
  clash:        { files: [], kind: 'synth', synth: 'clank' },
  shield_block: { files: [], kind: 'synth', synth: 'thud' },
  arrow_loose:  { files: ['arrow_volley_1', 'arrow_volley_2', 'arrow_volley_3', 'arrow_volley_4'], kind: 'oneshot', normDb: -22, gainDb: 0, synth: 'whoosh' },
  arrow_whoosh: { files: ['arrow_whoosh_1', 'arrow_whoosh_2', 'arrow_whoosh_3', 'arrow_whoosh_4'], kind: 'timed', normDb: -22, gainDb: -2, synth: 'whoosh' }, // aligned so manifest peakT hits as arrows descend
  arrow_hit:    { files: [], kind: 'synth', synth: 'thunk' },
  // ui_click_* measured: 2 softest (-50 dB mean), 1/4 medium, 3 firmest (-32 dB)
  ui_tick:      { files: ['ui_click_2'], kind: 'oneshot', gainDb: 6, synth: 'tick' },          // hover / in-game select / drag level ticks
  ui_select:    { files: ['ui_click_1', 'ui_click_4'], kind: 'oneshot', gainDb: 3, synth: 'tick' }, // menu taps, swatches, split / regroup
  ui_confirm:   { files: ['ui_click_3'], kind: 'oneshot', gainDb: -2, synth: 'tick' },        // Play, Sound the Horn, Done
  ui_full:      { files: [], kind: 'synth', synth: 'swell' },
  victory:      { files: [], kind: 'synth', synth: 'victory' },
  defeat:       { files: [], kind: 'synth', synth: 'defeat' },
};
