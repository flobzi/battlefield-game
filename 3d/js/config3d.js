// 3D build overrides — controls and combat rules are the 2D ones; a few tuning knobs below are 3D-only (marked).
CONFIG.world.groundRes = 1.25;
CONFIG.world.terrainWeights = { grass: 16, clover: 1, flowers: 0.5, rocks: 0.15, dirt: 0.5, trail: 0.3, mud: 0.4, puddle: 0.1, water: 0.8, shrub: 0.3, forest: 0, bank: 0.4, reeds: 0.4 };   // lusher meadow (3D grass covers it)
CONFIG.world.scatterMul = 0;
CONFIG.world.w = 1400; CONFIG.world.h = 1360;         // roomy field: open flanks and alternative routes
// Army size: ARMY_SIZE men per side (both player and bot; ?men=N overrides for testing). 80% spearmen, 20% archers.
CONFIG.armies.size = +(new URLSearchParams(location.search).get('men')) || 200;
CONFIG.armies.composition = [
  { type: 'spearman', count: Math.round(CONFIG.armies.size * 0.8), rows: 'front' },
  { type: 'archer',   count: CONFIG.armies.size - Math.round(CONFIG.armies.size * 0.8), rows: 'back' },
];
CONFIG.armies.columns = 12; CONFIG.armies.spacing = 12.5;  // compact blocks (~150 wide) leave open ground on both flanks
CONFIG.move.separation = 9.5;                         // bigger figures need a touch more personal space
CONFIG.armies.gapY = 220;
CONFIG.bot.chargeDist = 150;                          // 3D-only: shorter field -> bot charges a little later (2D: 150)
CONFIG.combat.knockback = 34;                         // 3D-only: stronger, visible shove when a charge lands (2D: 22)
CONFIG.fx.flingMul = 1.8;                             // 3D-only: bodies flung further on heavy (charge / flank) kills
CONFIG.bot.archerHold = 175;                          // 3D-only: bot archers hold closer behind their own line -> tighter fit-all view (2D: 250)
CONFIG.world.decalMul = 1.7; CONFIG.world.decalAlphaMul = 1.25; CONFIG.world.darkBlood = true;   // blood/mud read darker & larger from the high camera
            // no painted flowers / pebbles under real 3D grass          // ground decal canvas px / unit (uploaded as a texture; smaller = cheaper uploads)
CONFIG.r3d = {
  fov: 36, pitchDeg: 50,                // tilted high-angle cinematic camera
  manHeight: 1.9,                       // soldier mesh scale (mesh is ~19 units tall -> ~38 world units)
  fitMargin: 12,                        // world units around the bounding box of every living man (covers shield + shoulders at manHeight 2)
  safePx: { top: 64, bottom: 66, side: 8 },   // pass 5: top +14 for the soldier-count badges over the far army    // CSS px kept clear of the HUD bar (top) and rally/mute row (bottom); converted to an NDC rectangle on resize
  ndc: { x: 0.95, top: 0.84, bottom: -0.83 },   // fallback safe rectangle
  minDist: 200, holdEase: 0.35, fitPad: { x: 0.06, z: 0.08 },   // fitPad: extra margin as a fraction of the army extent (room to flank)
                          // never closer than this (keeps context even when few men remain)
  zoomOutRate: 4.0, zoomInRate: 1.3, panRate: 2.8,
  lod: { pxIn: 26, pxOut: 20, few: 220, triBudget: { med: 1.7e6, high: 2.4e6 } },   // soldier LOD: hi-detail when a man is taller than pxIn px (drops below pxOut) or < `few` figures, and only if figures x hi-tris fit triBudget
  sunDir: [0.62, 0.52, -0.58],          // sun from the right / far side, low and golden
  shake: 1.0, hitStop: true,
};
CONFIG.audio.crowdScale = CONFIG.armies.size / 500;          // 3D-only: crowd-sound thresholds follow army size
