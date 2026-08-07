// src/data/Config.js
// Pure data file holding our engine's constant variables.
export const GAME_CONFIG = {
    BASE_PLAYER_SPEED: 2.5,
    SANITY_DRAIN_RATE: 0.03,
    BREAKDOWN_DELAY_FRAMES: 60, // 1 second lag at 60fps
    BASE_XP_REQ: 50,
    LEVEL_XP_GROWTH_RATE: 1.12
};

export function getXPRequiredForLevel(level) {
    return Math.floor(GAME_CONFIG.BASE_XP_REQ * Math.pow(GAME_CONFIG.LEVEL_XP_GROWTH_RATE, level - 1));
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