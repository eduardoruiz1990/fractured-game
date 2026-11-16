// src/data/Difficulty.js
//
// Patch 156 (the V2 difficulty pass): how much pressure each floor of Cycle I puts on
// the player in its regular rooms. One table, so a balance change is one edit, and
// sim_difficulty.js measures it (`node sim_difficulty.js --detail --sources`, and
// `--pressure '{"3":{"hp":1.6}}'` to try a row without editing this file).
//
// What the measurement found (a scripted player, 16 runs per profile and skill):
//  - Regular rooms were spawn-rate bound: enemies arrived one at a time and died on
//    the way in. Floors 2-5 averaged 0.5-1.0 enemies alive. Even 4x HP only made a
//    scavenger live 3 s instead of 0.5 s, because the player's damage outgrows every
//    regular enemy by floor 2.
//  - So almost every point of Sanity lost in a regular room was the passive drain,
//    and the +3 per XP orb refilled it. Lowest Sanity in rooms 1-4 was a median of
//    81-97% on floors 2-5. Nearly every death was a boss.
// The fix is crowds, not sponges: arrivals come in packs, so several enemies close
// in together from different sides, each a little tougher and faster, and each hit
// lands a little harder. Measured with this table, enemies alive in a regular room
// went from 0.5-1.0 to 1.5-2.9, and damage from regular enemies on floors 2-3 went
// up 2-3x.
//
// Floor 1 is a new player's first session. It is already the hardest regular floor
// on a fresh save (one weapon, a 39% median low), so it is left exactly as it was.
// Boss fights are untouched: every knob below is off while a boss is alive, so the
// bosses, their projectiles, their escort and the Amalgamation's minions keep the
// numbers they were balanced with.
//
//   orbHeal  Sanity restored per XP orb picked up (Combat.collectXP)
//   damage   multiplier on each hit the player takes in a regular room
//            (Game.takeDamage), before curses and damage reduction
//   budget   multiplier on a regular room's enemy budget (Director.spawnRoom)
//   pack     enemies per arrival: the rest of a pack follows 6 frames after the first,
//            then the usual gap (Director.spawnWave)
//   hp       multiplier on a regular enemy's HP at spawn (Director.spawnEntity)
//   speed    multiplier on a regular enemy's speed at spawn
//   density  divides the gap between arrivals (1 = the room's usual rate)
//
// Floors past 5 (THE RECURSION) read the floor-5 row; Endless.js scales on top of
// it as before.
export const FLOOR_PRESSURE = [
    null,
    { orbHeal: 3,    damage: 1,    budget: 1,    pack: 1, hp: 1,    speed: 1,    density: 1 },   // floor 1: unchanged
    { orbHeal: 2.25, damage: 1.15, budget: 1.25, pack: 2, hp: 1.3,  speed: 1.1,  density: 1 },
    { orbHeal: 2,    damage: 1.2,  budget: 1.35, pack: 3, hp: 1.45, speed: 1.12, density: 1 },
    { orbHeal: 1.75, damage: 1.25, budget: 1.4,  pack: 3, hp: 1.6,  speed: 1.15, density: 1 },
    { orbHeal: 1.5,  damage: 1.3,  budget: 1.5,  pack: 3, hp: 1.75, speed: 1.18, density: 1 }
];

/** The pressure row for a floor (floors < 1 read floor 1, floors > 5 read floor 5). */
export function floorPressure(floor) {
    const f = Number.isFinite(floor) ? Math.floor(floor) : 1;
    return FLOOR_PRESSURE[Math.max(1, Math.min(5, f))];
}
