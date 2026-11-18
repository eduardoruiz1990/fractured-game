// src/data/Horde.js
//
// Patch 165 (v3, "NIGHT SHIFT"): the horde model.
//
// Until now a room spent a small budget one enemy at a time: about one arrival a
// second, 17 bodies in the whole first room, and a measured 0.5-2.9 enemies alive
// (see data/Difficulty.js). That is a stroll, not a survivors-like. A room now keeps a
// TARGET number of bodies alive until a much larger budget is spent, so the player is
// always cutting through a crowd and the crowd grows with every room and floor.
//
// One table, like Difficulty.js, so the feel of the whole game is tuned in one place.
// Pure module: no imports, no state.

/** Regular adds during a boss fight arrive this often, in frames (was 120). */
export const HORDE_BOSS_ADD_GAP = 45;

/** A brand-new player's very first room: small, slow, impossible to lose quickly. */
export const FIRST_ROOM = { perSec: 2.2, seconds: 26, alive: 10 };

/** Arrivals per second while the room is under its alive target. */
export function hordeSpawnPerSec(floor, roomNumber) {
    const f = Math.max(1, Math.floor(floor) || 1);
    const r = Math.max(1, Math.floor(roomNumber) || 1);
    return 2.7 + Math.min(f, 10) * 0.9 + r * 0.35;   // Patch 168: was 2.4 / 0.3 (first playtest: early floors too easy)
}

/** How long a regular room spawns for, in seconds, at that rate. */
export function hordeRoomSeconds(floor, roomNumber) {
    const r = Math.max(1, Math.floor(roomNumber) || 1);
    return 32 + r * 3;
}

/** The room's budget: what that rate spends in that time. */
export function hordeBudget(floor, roomNumber) {
    return Math.round(hordeSpawnPerSec(floor, roomNumber) * hordeRoomSeconds(floor, roomNumber));
}

/** Bodies kept alive at once in a regular room (the quality tier's cap still wins). */
export function hordeAliveTarget(floor, roomNumber) {
    const f = Math.max(1, Math.floor(floor) || 1);
    const r = Math.max(1, Math.floor(roomNumber) || 1);
    return Math.min(90, 14 + Math.min(f, 8) * 6 + r * 3);   // Patch 168: was 12
}

/**
 * Lucidity (the meta currency) banked per point of XP picked up. A horde drops four
 * to five times the orbs the old rooms did; without this the hub economy inflates by
 * the same factor.
 */
export const LUCIDITY_PER_XP = 0.4;

/** Share of scavengers that still go after XP orbs; the rest simply chase. */
export const THIEF_CHANCE = 0.06;

/**
 * Patch 168: XP a thief can carry before it stops stealing. Thieves used to grow with
 * every orb, outlive the fodder around them and eat a whole room's XP (a test player
 * was still level 1 after 96 kills). Now a thief fills up, and drops all of it on death.
 */
export const THIEF_FULL = 14;
