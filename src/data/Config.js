// src/data/Config.js
// Pure data file holding our engine's constant variables.
export const GAME_CONFIG = {
    BASE_PLAYER_SPEED: 2.5,
    SANITY_DRAIN_RATE: 0.03,
    BREAKDOWN_DELAY_FRAMES: 60, // 1 second lag at 60fps
    BASE_XP_REQ: 50,
    LEVEL_XP_GROWTH_RATE: 1.12,   // unused since Patch 165, kept for old references
    LEVEL_XP_SCALE: 25,
    LEVEL_XP_POWER: 1.25
};

/**
 * Patch 117 (V2 plan B9): the boss types, as ONE shared Set. Eleven call sites used to
 * build `['BOSS', 'RORSCHACH', ...].includes(type)` inline — a fresh array per entity
 * per check, several times per entity per simulation step, on the hottest paths in the
 * game (weapon hit resolution, the leash, the HP-bar pass). Keep in step with
 * Endless.BOSS_ORDER, which is the dispatch ORDER and must stay an array.
 */
export const BOSS_TYPE_SET = new Set(['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT']);

/**
 * Patch 123 (V2 plan C5): rooms per floor, boss room included. Was 10; v1's Basic
 * Launch averaged 1m36s of play, and a 10-room floor kept the first boss — the
 * first real payoff — out of reach of almost every session.
 *
 * ROOM_PACE compresses the within-floor ramp so a short floor still builds: every
 * formula that used to scale by `roomNumber` (room budget, stress, spawn rate)
 * scales by `roomNumber * ROOM_PACE`, so room 4 of 5 plays like room 8 of 10 did.
 * A regular kill orb is worth ROOM_PACE XP (and Lucidity) instead of 1, so XP and
 * Lucidity per floor stay at ~89% of the 10-room floor without putting more orbs
 * on screen. Door rewards are NOT scaled: 4 doors a floor instead of 9 is a
 * deliberate trim that comes with the shorter floor.
 */
export const ROOMS_PER_FLOOR = 5;
export const ROOM_PACE = 10 / ROOMS_PER_FLOOR;
export function isBossType(type) { return BOSS_TYPE_SET.has(type); }

/**
 * Patch 127 (V2 plan C1): the onboarding ramp. The first two level-ups cost 24 and
 * 40 XP instead of 50 and 56; level 3 onward is the unchanged curve (62, 70, ...),
 * so the curve stays strictly increasing and everything past the first minute is
 * exactly as before. Measured with a headless bot on a returning player's room 1
 * (no tutorial), the median first card moved from ~32 s to ~20-25 s (the bot is a
 * poor orb collector; room 1 is kill-speed bound, not XP bound). The tutorial's
 * guaranteed kill (75 XP) now pays for both of the first two cards.
 */
export const ONBOARDING_XP = [24, 40];

export function getXPRequiredForLevel(level) {
    if (level >= 1 && level <= ONBOARDING_XP.length) return ONBOARDING_XP[level - 1];
    // Patch 165: a horde pays four to five times the XP, so the curve is a power law
    // fitted to that income: about 7 level-ups on floor 1, then 4-5 a floor
    // (cumulative ~12 * L^2.1). The old exponential (50 * 1.12^L) gave 15 on floor 1.
    return Math.floor(GAME_CONFIG.LEVEL_XP_SCALE * Math.pow(Math.max(1, level), GAME_CONFIG.LEVEL_XP_POWER));
}

/**
 * The arena.
 *
 * These three numbers used to be literals in three different files that had to agree
 * and had no way of saying so:
 *   - Game.js's `voidRadius` (where the Void's sanity drain begins)
 *   - Renderer.js's `mapRadius` (where the arena wall is actually DRAWN)
 *   - Director.js's spawn clamp (how far out an enemy may be placed)
 *
 * The relationship is the load-bearing part: the spawn clamp sits INSIDE the void
 * radius by ARENA_SPAWN_MARGIN, so enemies are always placed within the playable
 * disc rather than out in the Void — a zone that drains the player's Sanity and that
 * Renderer paints over with the black void fill. Raising the clamp past the void
 * radius would put enemies in both, which reads as broken rather than as difficult.
 *
 * Derived, not repeated: change ARENA_VOID_RADIUS and the clamp follows it.
 */
export const ARENA_VOID_RADIUS = 1600;

/** How far inside the void boundary an enemy may still be spawned. */
export const ARENA_SPAWN_MARGIN = 50;

/** Hard ceiling on an enemy's distance from the map origin at spawn time. */
export const SPAWN_CLAMP_RADIUS = ARENA_VOID_RADIUS - ARENA_SPAWN_MARGIN;

/**
 * How far a boss spawns from the player, at minimum.
 *
 * A boss is not just another spawn — it is announced, and it should arrive from the
 * far edge of the room rather than appearing at whatever distance the current screen
 * happens to require. Director.spawnRoom used to express that by passing a fake
 * 2000x2000 "viewport" to spawnEntity, which is a distance knob wearing a viewport's
 * clothes: it sized the off-screen ring for a 2000x2000 display regardless of the
 * real one, so on any canvas wider than that (ultrawide, 4K) the boss materialised
 * in plain sight, while on a phone it silently became a clamp to the arena rim.
 *
 * Stated directly instead. The value preserves what phones and tablets already do
 * (they clamp to the rim today); desktop bosses now arrive from further out than the
 * ~1168px they used to, which is the intended reading of the original 2000x2000.
 * This is the number to tune if boss approach time feels wrong.
 */
export const BOSS_MIN_SPAWN_DISTANCE = SPAWN_CLAMP_RADIUS;
/**
 * Patch 132 (V2 plan D3): how many weapons a run may carry at once.
 *
 * With twelve weapons and no ceiling, a run spread its level-ups across everything it
 * was offered and rarely took two weapons to level 5 — which is what every synergy
 * (and, from Phase D, every evolution) asks for. Six is the genre's usual number and
 * still leaves half the arsenal unchosen each run. Once six are owned, no NEW weapon
 * is offered (level-up cards and the WEAPON UPGRADE door); owned ones keep levelling.
 */
export const MAX_WEAPON_SLOTS = 6;

/** Number of weapons a run currently owns (level > 0). */
export function ownedWeaponCount(weapons) {
    if (!weapons) return 0;
    let n = 0;
    for (const id in weapons) if (weapons[id] && weapons[id].level > 0) n++;
    return n;
}
