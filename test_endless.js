/**
 * THE RECURSION — endless mode invariants (Patch 93+).
 *
 * Run with:  node test_endless.js
 *
 * WHY THIS FILE EXISTS: endless is meant to be strictly ADDITIVE. Floors 1-5 are the
 * game every existing player has, and the brief for this feature was that they must
 * not change in behaviour, pacing or difficulty in any way. That is a property, not a
 * hope, so it is asserted here rather than reviewed:
 *
 *   1. For every floor 1-5, each function returns exactly what the code it replaced
 *      returned — the same boss, the same palette index, and multipliers of EXACTLY 1
 *      (asserted with ===, not a tolerance, because 1.0000000001 would silently retune
 *      the original game).
 *   2. The set of distinct colours reachable across a thousand floors is FINITE.
 *      Renderer.spriteCache is never cleared and two of its key spaces are keyed on
 *      colour, so an escalation that kept minting new colours would grow that cache
 *      without bound on exactly the devices that cannot afford it.
 *
 * Endless.js is pure — no DOM, no canvas, no state — so the real module is driven
 * directly. Keep it that way; the moment it needs a canvas it stops being runnable.
 */

import {
    CYCLE_LENGTH, FIRST_ENDLESS_FLOOR, BOSS_ORDER, CYCLE_VISUAL_CAP,
    cycleIndex, cycleNumber, endlessTier, isEndless,
    bossTypeForFloor, paletteIndexForFloor, visualCycle,
    enemyScaling, bossScaling, variantChance, cadence,
    weaponLevelCap, BASE_WEAPON_LEVEL_CAP,
    ENDLESS_START_FLOOR, ENDLESS_DRAFT_PICKS, endlessDraftXP, isRecursionUnlocked, cycleLabel
} from './src/core/Endless.js';

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
    if (condition) {
        passed++;
        console.log(`  \x1b[32m✓\x1b[0m ${label}`);
    } else {
        failed++;
        console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
    }
}

// ---------------------------------------------------------------------------
console.log('\nShape of the cycle');

check('CYCLE_LENGTH is 5', CYCLE_LENGTH === 5, String(CYCLE_LENGTH));
check('FIRST_ENDLESS_FLOOR is 6', FIRST_ENDLESS_FLOOR === 6, String(FIRST_ENDLESS_FLOOR));
check('BOSS_ORDER has one entry per floor in a cycle',
      BOSS_ORDER.length === CYCLE_LENGTH, `${BOSS_ORDER.length} entries`);
check('BOSS_ORDER is the original 1-5 order',
      BOSS_ORDER.join(',') === 'BOSS,RORSCHACH,PANOPTICON,AMALGAMATION,ARCHITECT',
      BOSS_ORDER.join(','));

// ---------------------------------------------------------------------------
console.log('\nFloors 1-5 are untouched (the whole point)');

// The exact dispatch Director.spawnRoom's if/else chain performed before Patch 93.
const LEGACY_BOSS = { 1: 'BOSS', 2: 'RORSCHACH', 3: 'PANOPTICON', 4: 'AMALGAMATION', 5: 'ARCHITECT' };

for (let f = 1; f <= 5; f++) {
    check(`floor ${f}: boss is still ${LEGACY_BOSS[f]}`,
          bossTypeForFloor(f) === LEGACY_BOSS[f], bossTypeForFloor(f));
    // Renderer clamped the pattern index to `min(floor-1, 4)` and getAtmosphere to
    // `min(floor, 5) - 1`. Both are floor-1 for every floor 1-5.
    check(`floor ${f}: palette index is still ${f - 1}`,
          paletteIndexForFloor(f) === f - 1, String(paletteIndexForFloor(f)));
    check(`floor ${f}: endlessTier is EXACTLY 0`,
          endlessTier(f) === 0, String(endlessTier(f)));
    check(`floor ${f}: is not endless`, isEndless(f) === false);
    check(`floor ${f}: is Cycle I`, cycleNumber(f) === 1, String(cycleNumber(f)));
}

// ---------------------------------------------------------------------------
console.log('\nThe boss rotation past floor 5');

// Floor 6 used to be ARCHITECT — the tail of an if/else chain. It is now the start of
// the second lap. These are spelled out rather than computed, so a change to the
// rotation has to be made deliberately in two places.
const EXPECTED = {
    6: 'BOSS', 7: 'RORSCHACH', 8: 'PANOPTICON', 9: 'AMALGAMATION', 10: 'ARCHITECT',
    11: 'BOSS', 12: 'RORSCHACH', 15: 'ARCHITECT', 16: 'BOSS', 20: 'ARCHITECT'
};
for (const [floor, boss] of Object.entries(EXPECTED)) {
    check(`floor ${floor} -> ${boss}`,
          bossTypeForFloor(Number(floor)) === boss, bossTypeForFloor(Number(floor)));
}

check('every boss appears once per cycle',
      new Set([6, 7, 8, 9, 10].map(bossTypeForFloor)).size === 5);
check('the Architect is no longer every endless boss',
      [6, 7, 8, 9].every(f => bossTypeForFloor(f) !== 'ARCHITECT'));

// ---------------------------------------------------------------------------
console.log('\nCycle and tier boundaries');

check('floor 5 is the last of Cycle I', cycleNumber(5) === 1 && cycleNumber(6) === 2);
check('floor 6 is the first endless floor',
      isEndless(6) === true && isEndless(5) === false);
check('endlessTier starts at 1 on floor 6', endlessTier(6) === 1, String(endlessTier(6)));
check('endlessTier is the floor distance past 5',
      endlessTier(20) === 15 && endlessTier(100) === 95);
check('cycleIndex wraps, never runs off BOSS_ORDER',
      [1, 5, 6, 37, 501, 9999].every(f => {
          const i = cycleIndex(f);
          return Number.isInteger(i) && i >= 0 && i < CYCLE_LENGTH;
      }));
check('cycleNumber counts laps',
      cycleNumber(10) === 2 && cycleNumber(11) === 3 && cycleNumber(26) === 6);

// ---------------------------------------------------------------------------
console.log('\nDegenerate input is total (never NaN into gameplay or Canvas maths)');

// These feed array indices and, downstream, colour lookups and Canvas arguments. A
// NaN here does not merely look wrong — it throws a DOMException out of the render
// loop. Every one of these is a floor value that has genuinely appeared in this
// codebase's history (an old save with no roomNumber poisoned comparisons the same way).
[undefined, null, NaN, 0, -3, '4', 2.7, Infinity, -Infinity, {}].forEach(bad => {
    const label = typeof bad === 'object' ? JSON.stringify(bad) : String(bad);
    const idx = paletteIndexForFloor(bad);
    const tier = endlessTier(bad);
    const cyc = cycleNumber(bad);
    check(`floor ${label}: yields usable values`,
          Number.isInteger(idx) && idx >= 0 && idx < CYCLE_LENGTH &&
          Number.isFinite(tier) && tier >= 0 &&
          Number.isInteger(cyc) && cyc >= 1 &&
          BOSS_ORDER.includes(bossTypeForFloor(bad)),
          JSON.stringify({ idx, tier, cyc, boss: bossTypeForFloor(bad) }));
});

check("'4' and 4 agree (a floor read back from JSON is a string)",
      bossTypeForFloor('4') === bossTypeForFloor(4) &&
      paletteIndexForFloor('4') === paletteIndexForFloor(4));

// ---------------------------------------------------------------------------
console.log('\nVisual escalation is BOUNDED (the spriteCache constraint)');

// Renderer.spriteCache has no eviction and is never cleared. drawGlow keys on
// `glow|${color}|${alpha}`, and the particle glow's colour comes from ent.color, which
// is per-floor. So the property that actually matters is not "how deep does the
// escalation go" but "how many distinct colours can ever exist".
check(`visualCycle is capped at ${CYCLE_VISUAL_CAP}`,
      visualCycle(999) === CYCLE_VISUAL_CAP, String(visualCycle(999)));
check('visualCycle still rises through the capped range',
      visualCycle(1) === 1 && visualCycle(6) === 2 && visualCycle(11) === 3 && visualCycle(16) === 4);
check('visualCycle never exceeds the cap, over 1000 floors',
      Array.from({ length: 1000 }, (_, i) => visualCycle(i + 1))
           .every(v => Number.isInteger(v) && v >= 1 && v <= CYCLE_VISUAL_CAP));

{
    // The real bound: walk a thousand floors and count the distinct (palette, visual
    // tier) pairs any colour table could be keyed on. If this ever grows with depth,
    // the cache grows with depth too.
    const keys = new Set();
    for (let f = 1; f <= 1000; f++) keys.add(`${paletteIndexForFloor(f)}|${visualCycle(f)}`);
    check(`distinct colour keys over 1000 floors is finite and small (${keys.size})`,
          keys.size <= CYCLE_LENGTH * CYCLE_VISUAL_CAP, `${keys.size} keys`);
    check('and floors 1-5 contribute only the five original palettes',
          [1, 2, 3, 4, 5].every(f => visualCycle(f) === 1));
}

// ---------------------------------------------------------------------------
console.log('\nEscalation is EXACTLY neutral on floors 1-5');

// Asserted with === against 1, not a tolerance. A multiplier of 1.0000000001 would
// silently retune the original game, which is the one thing this feature must not do.
for (let f = 1; f <= 5; f++) {
    const e = enemyScaling(f);
    const b = bossScaling(f);
    check(`floor ${f}: enemy hp/damage/speed multipliers are all exactly 1`,
          e.hp === 1 && e.damage === 1 && e.speed === 1, JSON.stringify(e));
    check(`floor ${f}: boss hp/damage/aggression are all exactly 1`,
          b.hp === 1 && b.damage === 1 && b.aggression === 1, JSON.stringify(b));
}

// The exact table Director.applyEnemyVariant held inline before Patch 94. Floor 3's
// 0.20 in particular is depended on by test_bosses.js's forced-roll variant cases.
const LEGACY_VARIANT = { 1: 0, 2: 0.12, 3: 0.20, 4: 0.28, 5: 0.35 };
for (let f = 1; f <= 5; f++) {
    check(`floor ${f}: variant chance is still ${LEGACY_VARIANT[f]}`,
          variantChance(f) === LEGACY_VARIANT[f], String(variantChance(f)));
}
check('floor 1 stays variant-free', variantChance(1) === 0);

// ---------------------------------------------------------------------------
console.log('\nEscalation past floor 5');

check('enemy HP rises with depth',
      enemyScaling(6).hp > 1 && enemyScaling(10).hp > enemyScaling(6).hp);
{
    // The player's damage grows ADDITIVELY (weapon upgrades are `damage += 5`, and once
    // the boon pool empties level-ups give no damage at all). A geometric HP curve
    // against an additive attacker does not produce a harder fight — it produces a
    // STALEMATE, a boss the build cannot chew through. So equal steps in depth must
    // produce equal steps in HP, for both enemies and bosses.
    const step = f => enemyScaling(f + 5).hp - enemyScaling(f).hp;
    check('enemy HP is LINEAR, not geometric',
          Math.abs(step(10) - step(20)) < 1e-9 && Math.abs(step(20) - step(50)) < 1e-9,
          `steps: ${step(10)} ${step(20)} ${step(50)}`);

    const bstep = f => bossScaling(f + 5).hp - bossScaling(f).hp;
    check('boss HP is LINEAR too',
          Math.abs(bstep(10) - bstep(40)) < 1e-9, `steps: ${bstep(10)} ${bstep(40)}`);
}
check('enemy damage rises more slowly than HP',
      enemyScaling(20).damage < enemyScaling(20).hp);
check('enemy speed is hard-capped (an enemy faster than the player is not difficulty)',
      enemyScaling(500).speed <= 1.20, String(enemyScaling(500).speed));
check('boss HP outpaces a regular enemy at the same depth',
      bossScaling(15).hp > enemyScaling(15).hp);
check('boss aggression is capped', bossScaling(500).aggression <= 2.5, String(bossScaling(500).aggression));
check('variant chance climbs but never reaches certainty',
      variantChance(10) > variantChance(6) && variantChance(500) <= 0.85,
      String(variantChance(500)));
check('every scaling value stays finite at absurd depth',
      [enemyScaling(1e6), bossScaling(1e6)].every(s =>
          Object.values(s).every(v => Number.isFinite(v) && v > 0)));

// ---------------------------------------------------------------------------
console.log('\ncadence(): boss timers');

// PROPERTY 1 — the reason every boss file could be edited without touching floors 1-5.
{
    const everyTimerInTheGame = [15, 24, 30, 45, 60, 80, 90, 120, 180, 240, 600];
    check('cadence(n, 1, min) === n for every timer value in the five boss files',
          everyTimerInTheGame.every(n => cadence(n, 1, 1) === n),
          everyTimerInTheGame.map(n => `${n}->${cadence(n, 1, 1)}`).join(' '));
    check('...and specifically at aggression 1 with each real min floor',
          cadence(60, 1, 24) === 60 && cadence(90, 1, 30) === 90 &&
          cadence(180, 1, 60) === 180 && cadence(240, 1, 80) === 240);
}

// PROPERTY 2 — the min floor is hard. A telegraph compressed below the time it takes
// to read makes a fight unfair rather than hard.
check('cadence never returns below its minimum',
      cadence(60, 100, 24) === 24 && cadence(1, 2.5, 30) === 30);
check('cadence shortens as aggression rises',
      cadence(240, 2, 80) === 120 && cadence(240, 2.5, 80) === 96);
check('cadence is total against degenerate input',
      [undefined, null, NaN, Infinity, 'x'].every(bad =>
          Number.isFinite(cadence(bad, 2, 30)) && cadence(bad, 2, 30) >= 30) &&
      [undefined, null, NaN, 0, -1].every(bad => cadence(120, bad, 30) === 120),
      'a NaN here would freeze a boss mid-attack forever');

// ---------------------------------------------------------------------------
console.log('\nThe player uncaps at the same floor the enemies do');

check('the weapon ceiling is still exactly 5 through Cycle I',
      [1, 2, 3, 4, 5].every(f => weaponLevelCap(f) === BASE_WEAPON_LEVEL_CAP) &&
      BASE_WEAPON_LEVEL_CAP === 5);
check('a level-4 weapon is offerable on floor 3, a level-5 one is not',
      4 < weaponLevelCap(3) && !(5 < weaponLevelCap(3)));
check('the ceiling is gone from floor 6',
      [6, 7, 20, 500].every(f => weaponLevelCap(f) === Infinity));
check('a level-40 weapon is still offerable deep in the Recursion',
      40 < weaponLevelCap(30));

// ---------------------------------------------------------------------------
console.log('\nDEEP cards are safe to take repeatedly (the property they exist for)');
{
    const { DEEP_BOONS, BOONS } = await import('./src/ui/LevelUpUI.js');

    check('the DEEP pool is non-empty and exported',
          Array.isArray(DEEP_BOONS) && DEEP_BOONS.length > 0, String(DEEP_BOONS.length));
    check('every DEEP card has the fields show() renders',
          DEEP_BOONS.every(b => b.id && b.name && b.desc && b.color && b.icon && Array.isArray(b.tags)));
    check('DEEP ids do not collide with the 24 one-shot boons',
          DEEP_BOONS.every(d => !BOONS.some(b => b.id === d.id)));
    check('DEEP ids are namespaced so they are recognisable in a save/history record',
          DEEP_BOONS.every(b => b.id.startsWith('deep_')));
    check('DEEP ids are unique among themselves',
          new Set(DEEP_BOONS.map(b => b.id)).size === DEEP_BOONS.length);

    // The actual hazard these replaced: 11 of the 24 boons are FLAG boons read with
    // `boons.includes(...)`, and several others are degenerate on repeat —
    // tunnel_vision HALVES the flashlight cone every time it is taken. Assert that no
    // DEEP card describes a division or a one-way switch.
    check('no DEEP card promises something a repeat cannot deliver',
          DEEP_BOONS.every(b => !/halve|cannot|disable|instead|but /i.test(b.desc)),
          DEEP_BOONS.map(b => b.desc).join(' | '));
}

// ---------------------------------------------------------------------------
console.log('\nDirect launch: the unlock gate');

// The gate reads TWO fields deliberately. runsCompleted only exists since Patch 59, so
// a player who beat the Architect before that patch has 0 there and a real kill count —
// gating on the counter alone would silently revoke something already earned.
check('a fresh profile is locked',
      isRecursionUnlocked({ killCounts: { ARCHITECT: 0 }, runsCompleted: 0 }) === false);
check('an Architect kill unlocks it',
      isRecursionUnlocked({ killCounts: { ARCHITECT: 1 }, runsCompleted: 0 }) === true);
check('a recorded completion unlocks it',
      isRecursionUnlocked({ killCounts: { ARCHITECT: 0 }, runsCompleted: 1 }) === true);
check('a PRE-PATCH-59 save (kills, but no counter) still unlocks it',
      isRecursionUnlocked({ killCounts: { ARCHITECT: 3 } }) === true,
      'this is the case a single-field gate would silently revoke');
check('killing other bosses does NOT unlock it',
      isRecursionUnlocked({ killCounts: { BOSS: 40, RORSCHACH: 12, PANOPTICON: 5, AMALGAMATION: 2 } }) === false);
check('a save shape it does not recognise reads as locked, never throws',
      [undefined, null, {}, { killCounts: null }, { killCounts: 'x' },
       { runsCompleted: 'many' }, { killCounts: { ARCHITECT: NaN } }, 42, 'save']
          .every(m => isRecursionUnlocked(m) === false),
      'this runs on every title-screen refresh');

// ---------------------------------------------------------------------------
console.log('\nDirect launch: the opening draft');
{
    const { getXPRequiredForLevel } = await import('./src/data/Config.js');

    check('a direct launch starts on floor 6',
          ENDLESS_START_FLOOR === 6 && isEndless(ENDLESS_START_FLOOR),
          String(ENDLESS_START_FLOOR));

    const xp = endlessDraftXP(getXPRequiredForLevel);
    check('the draft grant is a finite, positive XP total',
          Number.isFinite(xp) && xp > 0, String(xp));

    // The grant is specified in CARDS, not XP — assert it actually buys that many
    // level-ups against the real curve, and not one more.
    let spent = 0, levels = 0, level = 1;
    while (spent + getXPRequiredForLevel(level) <= xp) {
        spent += getXPRequiredForLevel(level);
        level++; levels++;
    }
    check(`the grant buys exactly ${ENDLESS_DRAFT_PICKS} level-ups (${xp} XP)`,
          levels === ENDLESS_DRAFT_PICKS, `bought ${levels}`);
    check('and leaves no leftover XP banked toward a ninth',
          spent === xp, `${spent} spent of ${xp}`);
    check('the grant tracks the curve rather than a hardcoded number',
          endlessDraftXP(l => 100, 3) === 300, String(endlessDraftXP(l => 100, 3)));
}

// ---------------------------------------------------------------------------
console.log('\nCycle labels (player-facing copy)');

check('Cycle I covers floors 1-5', [1, 2, 3, 4, 5].every(f => cycleLabel(f) === 'I'));
check('floor 6 opens Cycle II', cycleLabel(6) === 'II');
check('floor 10 closes Cycle II, floor 11 opens Cycle III',
      cycleLabel(10) === 'II' && cycleLabel(11) === 'III');
check('the Architect closes every cycle',
      [5, 10, 15, 20].every(f => bossTypeForFloor(f) === 'ARCHITECT' && f % 5 === 0),
      'the floor-complete copy keys its cycle-closed line on floor % 5 === 0');
check('labels stay readable, then fall back to digits',
      cycleLabel(96) === 'XX' && cycleLabel(101) === '21',
      `${cycleLabel(96)} / ${cycleLabel(101)}`);
check('a label always exists, for any floor, without throwing',
      [1, 500, 5000, NaN, undefined].every(f => typeof cycleLabel(f) === 'string' && cycleLabel(f).length > 0));

// ---------------------------------------------------------------------------
console.log('\nThe run-completion latch survives a floor boundary');

// This is the one thing that was outright BROKEN by opening the seam, rather than
// merely absent. main.js records `runsCompleted` behind a latch on game.state — and
// Game.init() rebuilds game.state from scratch on every descent. That was harmless
// only because floor 5 was terminal, so the latch was never asked to cross a floor
// boundary. The moment DESCEND DEEPER works past floor 5, clearing floor 6 re-enters
// the same `floor >= 5` branch with a fresh false latch and banks a second escape.
//
// Driving the real Game here (rather than asserting the field exists) is the point:
// the failure mode is specifically that init() drops it.
{
    global.CustomEvent = class CustomEvent {
        constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
    };
    const stubCtx = new Proxy({}, { get: () => () => ({ addColorStop: () => {} }) });
    global.document = {
        addEventListener: () => {}, dispatchEvent: () => {}, getElementById: () => null,
        createElement: () => ({ width: 1920, height: 1080, getContext: () => stubCtx })
    };
    global.window = { addEventListener: () => {} };
    global.localStorage = { getItem: () => null, setItem: () => {} };

    const { Game } = await import('./src/core/Game.js');
    const mockSave = {
        metaState: {
            upgrades: { hp: 0, speed: 0, light: 0, magnet: 0 },
            killCounts: {}, inventory: [], equippedTokens: {}, selectedCurses: [],
            maxFloorReached: 1, tutorialCompleted: true
        },
        saveGame: () => {}
    };

    const game = new Game();
    game.init(mockSave);

    check('a fresh run starts with the latch down',
          game.state.runCompletionRecorded === false, String(game.state.runCompletionRecorded));

    // Clear floor 5: main.js sets the latch and banks the escape.
    game.state.floor = 5;
    game.state.runCompletionRecorded = true;

    // DESCEND DEEPER — exactly what main.js's handler does.
    const carry = game.getCarriedState();
    check('getCarriedState carries the latch',
          carry.runCompletionRecorded === true, JSON.stringify(carry.runCompletionRecorded));

    carry.floor += 1;
    carry.roomNumber = 1;
    game.init(mockSave, carry);

    check('floor 6: the latch survived init()',
          game.state.runCompletionRecorded === true,
          'a second "construct escaped" would be banked on every endless floor');
    check('floor 6: main.js would NOT re-record',
          game.state.floor >= 5 && game.state.runCompletionRecorded === true);

    // And once more, because the bug compounds — floor 7, 8, 9 would each bank one.
    // -----------------------------------------------------------------------
    // Patch 96 — the colour bound, asserted against the REAL Director rather than
    // against the helper. This is the assertion that actually protects the
    // spriteCache: drawGlow keys on `glow|${color}|${alpha}` and never evicts, and
    // enemy colours reach it through spawnParticles on death.
    console.log('\nEnemy tints: floors 1-5 unchanged, and the colour set is finite');

    const LEGACY_TINTS = {
        1: ['#8b5a2b', '#a0522d'], 2: ['#888888', '#333333'], 3: ['#800020', '#4b0000'],
        4: ['#2e8b57', '#004d00'], 5: ['#daa520', '#b8860b']
    };
    const colourAt = (floor, type) => {
        const g = new Game();
        g.init(mockSave);
        g.saveManager = mockSave;
        g.state.floor = floor;
        g.state.entities.length = 0;
        g.state.roomModifier = null;
        g.director.spawnEntity(type, 1920, 1080, 0, 0);
        const e = g.state.entities[g.state.entities.length - 1];
        return e ? e.originalColor : null;
    };

    for (let f = 1; f <= 5; f++) {
        check(`floor ${f}: scavenger tint is still ${LEGACY_TINTS[f][0]}`,
              colourAt(f, 'SCAVENGER') === LEGACY_TINTS[f][0], String(colourAt(f, 'SCAVENGER')));
        check(`floor ${f}: predator tint is still ${LEGACY_TINTS[f][1]}`,
              colourAt(f, 'PREDATOR') === LEGACY_TINTS[f][1], String(colourAt(f, 'PREDATOR')));
    }

    check('floor 6 returns to the Wastes palette, visibly darkened',
          colourAt(6, 'SCAVENGER') !== colourAt(1, 'SCAVENGER') &&
          colourAt(6, 'SCAVENGER') !== LEGACY_TINTS[5][0],
          String(colourAt(6, 'SCAVENGER')));

    {
        // Walk 120 floors — 24 cycles — and count every distinct colour that can ever
        // be handed to drawGlow. If this grows with depth, so does the cache.
        const seen = new Set();
        for (let f = 1; f <= 120; f++) {
            seen.add(colourAt(f, 'SCAVENGER'));
            seen.add(colourAt(f, 'PREDATOR'));
        }
        check(`distinct enemy colours over 120 floors is bounded (${seen.size})`,
              seen.size <= CYCLE_LENGTH * 2 * CYCLE_VISUAL_CAP, `${seen.size} colours`);
        check('every one is a valid hex string (drawGlow returns WHITE for non-hex)',
              [...seen].every(c => /^#[0-9a-f]{6}$/i.test(c)), [...seen].join(' '));
        check('deep floors add no further colours once the cap is reached',
              colourAt(21, 'SCAVENGER') === colourAt(101, 'SCAVENGER'),
              `${colourAt(21, 'SCAVENGER')} vs ${colourAt(101, 'SCAVENGER')}`);
    }

    const carry2 = game.getCarriedState();
    carry2.floor += 1;
    carry2.roomNumber = 1;
    game.init(mockSave, carry2);
    check('floor 7: still latched',
          game.state.floor === 7 && game.state.runCompletionRecorded === true);

    // A run suspended by a pre-Recursion build has no such key. It must degrade to
    // false (the safe direction), not to undefined — which would be falsy anyway, but
    // would also serialise back out as a missing key forever.
    const legacyCarry = { floor: 3, roomNumber: 4, sanity: 80, weapons: {}, xp: 0, level: 1, lucidity: 0, runInventory: [], boons: [] };
    game.init(mockSave, legacyCarry);
    check('an old suspended run degrades to a strict false',
          game.state.runCompletionRecorded === false,
          String(game.state.runCompletionRecorded));
    check('and re-carries as a strict boolean, not undefined',
          game.getCarriedState().runCompletionRecorded === false);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
