// src/core/Endless.js
//
// Patch 93 — THE RECURSION: what happens after the Architect falls.
//
// Driven by a direct player request ("it would be really cool to add an infinite mode
// after the architect... it could be like a new game+"). Floors 6+ are a continuation
// of the same run: the five bosses come round again in their original order, the five
// biomes come round again, and everything gets harder each lap. Five floors is one
// CYCLE — floors 1-5 are Cycle I, 6-10 Cycle II, and so on.
//
// This module exists for the same reason src/core/Layout.js does: it is the single
// place a safety property is decided, and it has no DOM, no canvas and no state, so
// test_endless.js can drive the real thing rather than a copy of it.
//
// THE INVARIANT THIS FILE EXISTS TO PROTECT: endless is strictly ADDITIVE. Floors 1-5
// must behave exactly as they did before any of this was written. Every function here
// is therefore built so that `endlessTier(floor) === 0` — true for every floor 1-5 —
// yields the identity: multipliers of exactly 1, the same boss the old if/else chain
// picked, the same palette index the old clamp produced. Consumers get their "floors
// 1-5 unchanged" guarantee from that, and test_endless.js asserts it directly rather
// than trusting it.

/** Floors per cycle. Five bosses, five biomes — the length of the original game. */
export const CYCLE_LENGTH = 5;

/** The first endless floor. Below this, nothing in this module does anything. */
export const FIRST_ENDLESS_FLOOR = CYCLE_LENGTH + 1;

/**
 * Boss dispatch order, indexed by cycleIndex().
 *
 * This is the SAME order Director.spawnRoom's if/else chain produced for floors 1-5
 * (1 BOSS, 2 RORSCHACH, 3 PANOPTICON, 4 AMALGAMATION, 5 ARCHITECT). The only thing
 * that changes past floor 5 is that it wraps instead of falling through to ARCHITECT
 * forever. Repeating the Architect was never a decision — it was the tail of an
 * if/else chain — and it would have left four of the five bosses as dead content for
 * the entire endless mode.
 */
export const BOSS_ORDER = ['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'];

/**
 * Visual escalation stops deepening after this many cycles.
 *
 * This is a MEMORY bound, not a taste one. Renderer.spriteCache is never cleared and
 * has no eviction, and two of its key spaces are keyed on colour: drawGlow's
 * `glow|${color}|${alpha}`, and the particle glow, whose colour comes from ent.color —
 * which is per-floor. A visual escalation that kept deepening forever would mint a new
 * colour string on every cycle and grow that cache without bound, on a device that
 * cannot afford it. Capping the escalation makes the reachable colour set finite and
 * small (5 palettes x CYCLE_VISUAL_CAP tiers), which test_endless.js asserts by
 * walking a thousand floors and counting.
 */
export const CYCLE_VISUAL_CAP = 4;

/** Coerce anything to a sane floor number. Total: never returns NaN. */
function safeFloor(floor) {
    const f = Math.trunc(Number(floor));
    return Number.isFinite(f) && f >= 1 ? f : 1;
}

/**
 * 0-based slot within the current cycle: which boss, which biome palette.
 * Floor 1 -> 0 ... floor 5 -> 4, floor 6 -> 0 again.
 */
export function cycleIndex(floor) {
    return (safeFloor(floor) - 1) % CYCLE_LENGTH;
}

/** 1-based cycle number. Floors 1-5 are Cycle 1, 6-10 Cycle 2, ... */
export function cycleNumber(floor) {
    return Math.floor((safeFloor(floor) - 1) / CYCLE_LENGTH) + 1;
}

/**
 * How deep into the Recursion we are, in floors. ZERO for every floor 1-5.
 *
 * This is the additive guard: every scaling function in this module multiplies by a
 * term built from this, so tier 0 means "multiply by 1" and the original game is
 * untouched by construction rather than by careful editing.
 */
export function endlessTier(floor) {
    return Math.max(0, safeFloor(floor) - CYCLE_LENGTH);
}

/** Is this floor part of the Recursion at all? */
export function isEndless(floor) {
    return safeFloor(floor) >= FIRST_ENDLESS_FLOOR;
}

/**
 * The boss for a floor. Identical to the old if/else chain for floors 1-5.
 * @returns {string} a key of Director.pools / a type spawnEntity understands
 */
export function bossTypeForFloor(floor) {
    return BOSS_ORDER[cycleIndex(floor)];
}

/**
 * Which of the five biome palettes this floor wears.
 *
 * Replaces three separate clamps that all said "floor 5 and beyond looks like the
 * Architect" (Renderer's pattern index, Renderer's void colour, Game's void colour)
 * plus Director's enemy tint table. For floors 1-5 this returns exactly what those
 * clamps returned; past that the biomes come round again with the cycle.
 */
export function paletteIndexForFloor(floor) {
    return cycleIndex(floor);
}

// ---------------------------------------------------------------------------
// Patch 94 — ESCALATION.
//
// Before this, nothing about an enemy's strength keyed off the floor at all. A
// Scavenger is `hp 20` flat, a Parasite `hp 15` flat, and the Predator's `45 * stress`
// reads a stress value that is `1 + roomNumber * 0.1` — which RESETS every floor. So a
// floor-6 enemy was, to the point, a floor-1 enemy; only the head-count grew. Endless
// floors would have got relatively EASIER every lap, because the player's build keeps
// growing across them and the opposition did not.
//
// WHY THESE CURVES ARE LINEAR, which is the non-obvious part. The player's damage is
// capped and, where it grows, grows ADDITIVELY: weapons stop at level 5 (uncapped from
// floor 6 by Patch 95), and every upgrade in LevelUpUI.selectCard is `wep.damage += 5`,
// not `*= 1.15`. Once the boon pool empties, level-ups give `+50 maxHp` and no damage
// at all. Against an additive attacker, a geometric HP curve does not produce a harder
// fight — it produces a STALEMATE, a boss with 74k HP that a maxed build cannot chew
// through before the room's own attrition wins. The run should end because something
// killed the player, not because the numbers stopped meeting. So HP rises linearly to
// stay in step with the player's linear damage, and the thing that actually closes the
// run is lethality: damage per hit, variant density, and boss cadence.
//
// Speed is deliberately the shallowest curve of the three and hard-capped. An enemy
// faster than the player is not difficulty, it is unavoidable damage.

/**
 * Per-enemy multipliers for a floor. EXACTLY 1 for floors 1-5.
 * @returns {{hp:number, damage:number, speed:number}}
 */
export function enemyScaling(floor) {
    const tier = endlessTier(floor);
    if (tier === 0) return { hp: 1, damage: 1, speed: 1 };
    return {
        hp: 1 + 0.30 * tier,
        damage: 1 + 0.15 * tier,
        speed: Math.min(1.20, 1 + 0.02 * tier)
    };
}

/**
 * Chance that a spawned enemy is an ARMORED/FAST/VOLATILE variant.
 *
 * Floors 1-5 return the exact table Director.applyEnemyVariant held inline — floor 1
 * stays variant-free so the three base behaviours are learned before modifiers are
 * layered on, and floor 3 stays at 0.20, which test_bosses.js's forced-roll variant
 * cases depend on. Past that it climbs toward "almost everything is a variant", which
 * is a density increase in KIND rather than in stat: variants already have their own
 * movement signatures (Enemy.applyVariantMotion), so a deep floor reads as a different
 * bestiary rather than the same one with bigger numbers.
 */
export function variantChance(floor) {
    const tier = endlessTier(floor);
    if (tier === 0) {
        // NOT `table[floor] || 0.35`. Floor 1's value is 0, which is falsy, so that
        // idiom hands floor 1 the FLOOR-5 rate — variants from the first room of a new
        // player's first run, which is the one thing this table exists to prevent.
        // (The original inline version got away with `|| 0` because its fallback was
        // also 0.) Caught by test_endless.js the first time it ran.
        const chanceByFloor = { 1: 0, 2: 0.12, 3: 0.20, 4: 0.28, 5: 0.35 };
        const known = chanceByFloor[safeFloor(floor)];
        return Number.isFinite(known) ? known : 0.35;
    }
    return Math.min(0.85, 0.35 + 0.05 * tier);
}

/**
 * Boss multipliers for a floor. EXACTLY 1 (and aggression 1) for floors 1-5.
 *
 * HP climbs faster than a regular enemy's because a boss is the wall each cycle is
 * measured against, and `aggression` is the interesting one: it divides the boss's own
 * attack cadence (see cadence() below) so a deep-cycle Sphere Head does not merely
 * survive longer, it acts more often. That is what stops the rotation from feeling
 * like a lap of honour when Cycle III hands the player an 800hp boss they last saw on
 * floor 1.
 *
 * @returns {{hp:number, damage:number, aggression:number}}
 */
export function bossScaling(floor) {
    const tier = endlessTier(floor);
    if (tier === 0) return { hp: 1, damage: 1, aggression: 1 };
    return {
        hp: 1 + 0.45 * tier,
        damage: 1 + 0.12 * tier,
        aggression: Math.min(2.5, 1 + 0.10 * tier)
    };
}

/**
 * Compress a boss's attack-timer value by its aggression.
 *
 * The bosses re-arm their own timers inside update() (`this.gazeTimer = 45`), so
 * scaling the value set in init() would only ever affect the first swing. Every such
 * assignment routes through here instead.
 *
 * TWO PROPERTIES THIS MUST HAVE, both asserted:
 *   1. cadence(n, 1, min) === n for integer n. That is what makes floors 1-5
 *      bit-identical while every boss file is edited — aggression is 1 there, and
 *      Math.round of an integer is that integer.
 *   2. minFrames is a hard floor. Telegraphs are the contract a boss fight is played
 *      against (Patch 40 spent a whole patch making them honest); compressing one
 *      below the time it takes to read makes the fight unfair rather than hard. Hitbox
 *      and telegraph GEOMETRY are untouched by this — only how often the attack comes.
 */
export function cadence(frames, aggression, minFrames = 1) {
    const f = Number(frames);
    if (!Number.isFinite(f)) return minFrames;
    const a = (Number.isFinite(aggression) && aggression > 0) ? aggression : 1;
    return Math.max(minFrames, Math.round(f / a));
}

// ---------------------------------------------------------------------------
// Patch 95 — the player uncaps too.
//
// Endless scaling on the enemy side alone would be a slow strangulation: weapons stop
// at level 5, every boon is takeable once, and after that level-ups pay out `+50 maxHp`
// and nothing else. The player would get tankier forever and never hit harder, which
// against a rising HP curve is exactly the stalemate this design is built to avoid.
//
// So the ceiling comes off at the same floor the enemies' does. Note this is safe
// precisely BECAUSE LevelUpUI.selectCard's weapon upgrades are additive (`damage += 5`)
// with Math.max floors on every cooldown — an uncapped weapon grows linearly and its
// cooldown bottoms out, rather than compounding away into nonsense.

/** Base weapon level cap — the ceiling every run below the Recursion plays against. */
export const BASE_WEAPON_LEVEL_CAP = 5;

/**
 * The weapon level ceiling for a floor: 5 through Cycle I, uncapped in the Recursion.
 *
 * Callers use it as `wep.level < weaponLevelCap(floor)`, which is exactly what the two
 * hardcoded `wep.level < 5` sites (LevelUpUI's card pool, Combat's WEAPON_UPGRADE door)
 * already said — so floors 1-5 keep their ceiling to the letter.
 */
export function weaponLevelCap(floor) {
    return isEndless(floor) ? Infinity : BASE_WEAPON_LEVEL_CAP;
}

// ---------------------------------------------------------------------------
// Patch 97 — THE RECURSION as a mode you can launch directly.
//
// The continuation route (clear floor 5, press DESCEND DEEPER) arrives on floor 6 with
// a full build behind it. A direct launch does not, and floor 6 against a level-1
// player holding one flashlight is not a fight — it is a formality. So the launch pays
// out a burst of XP, which cascades through the existing level-up machinery and lets
// the player DRAFT a build before descending. That reuses LevelUpUI wholesale and makes
// the opening a series of choices rather than a handout.

/** Where a directly-launched Recursion run begins. */
export const ENDLESS_START_FLOOR = FIRST_ENDLESS_FLOOR;

/**
 * How many level-up cards the opening draft is worth.
 *
 * THE tuning knob for the direct-launch opening, and deliberately expressed in CARDS
 * rather than in XP: cards are the unit the player experiences, and the XP number that
 * produces them is a consequence of the level curve, which is free to change. Too high
 * and the mode opens with a dozen clicks before any play; too low and floor 6 is a wall.
 */
export const ENDLESS_DRAFT_PICKS = 8;

/**
 * XP required to grant exactly ENDLESS_DRAFT_PICKS level-ups from a standing start.
 *
 * Derived from the real curve rather than hardcoded, so retuning BASE_XP_REQ or
 * LEVEL_XP_GROWTH_RATE in Config.js cannot silently change how many cards the opening
 * draft is worth. Takes the curve function as an argument to keep this module free of
 * imports — it is depended on by Renderer, Director, Game, Combat and LevelUpUI, and a
 * dependency of its own would put it in the middle of that graph for no benefit.
 *
 * @param {(level:number)=>number} xpForLevel  Config.js's getXPRequiredForLevel
 */
export function endlessDraftXP(xpForLevel, picks = ENDLESS_DRAFT_PICKS) {
    let total = 0;
    for (let level = 1; level <= picks; level++) total += xpForLevel(level);
    return total;
}

/**
 * Has this profile earned the right to skip straight to the Recursion?
 *
 * The gate is a first Architect kill, and it reads TWO fields on purpose.
 * `runsCompleted` is the natural signal but only exists since Patch 59, so a player who
 * beat the Architect before that patch has 0 there and a real ARCHITECT kill count —
 * gating on the counter alone would silently revoke something they had already earned.
 *
 * Defensive throughout: this is called on the title screen every refresh, and a save
 * shape it does not recognise must read as "locked", never throw.
 */
export function isRecursionUnlocked(metaState) {
    if (!metaState || typeof metaState !== 'object') return false;
    const kills = metaState.killCounts && Number(metaState.killCounts.ARCHITECT);
    if (Number.isFinite(kills) && kills > 0) return true;
    const completed = Number(metaState.runsCompleted);
    return Number.isFinite(completed) && completed > 0;
}

/**
 * Patch 98 — the cycle as a Roman numeral, for player-facing copy.
 *
 * The game's own voice is clinical-file: floors are numbered, phases are numbered, and
 * the roadmap already numbers its stages. Roman numerals separate "which lap" from
 * "which floor" at a glance, so `CYCLE III · FLOOR 13` reads as two facts rather than
 * two numbers that might be the same thing.
 *
 * Falls back to the plain digits past the point where numerals stop being readable —
 * nobody parses MMMCCXLVII, and a player who gets that deep has earned a number.
 */
export function cycleLabel(floor) {
    const n = cycleNumber(floor);
    const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
                      'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
    return NUMERALS[n - 1] || String(n);
}

/**
 * Cycle number for VISUAL purposes, clamped at CYCLE_VISUAL_CAP.
 *
 * Anything that turns depth into a colour, an alpha or a tint must read this rather
 * than cycleNumber(), or it re-opens the unbounded-cache problem CYCLE_VISUAL_CAP
 * exists to close. Gameplay scaling is free to keep using the uncapped tier.
 */
export function visualCycle(floor) {
    return Math.min(cycleNumber(floor), CYCLE_VISUAL_CAP);
}
