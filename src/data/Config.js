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