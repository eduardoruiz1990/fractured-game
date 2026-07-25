/**
 * Content-data integrity checks (synergies, tokens, token sets, XP curve).
 *
 * Run with:  node test_content.js
 *
 * KNOWN GAP — boon pool size is NOT asserted here, on purpose:
 * The real level-up boon pool is the local `const BOONS = [...]` array defined
 * inside LevelUpUI.js's show() method. It is NOT exported from anywhere, so a
 * data-only test file has nothing importable to assert against. The `MANIFESTATIONS`
 * export in Manifestations.js looks like it should be the boon pool (it's imported
 * into LevelUpUI.js) but is in fact dead there — grep confirms it is never
 * referenced past the import line. Its only real consumer is getActiveSynergies()'s
 * maxLvl lookup. This means any future "expand the boon pool" patch must edit
 * LevelUpUI.js's BOONS array, not Manifestations.js — flagging here so that
 * doesn't get re-discovered the hard way.
 */

import { Game } from './src/core/Game.js';
import {
    SYNERGIES, TOKENS, TOKEN_SETS, TOKEN_RARITIES, TOKEN_SLOT_TYPES
} from './src/data/Manifestations.js';
import { getXPRequiredForLevel } from './src/data/Config.js';

global.CustomEvent = class CustomEvent {
    constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
};

global.document = {
    addEventListener: () => {},
    dispatchEvent: () => {},
    getElementById: () => null,
    createElement: () => ({
        width: 1920, height: 1080,
        getContext: () => ({
            fillStyle: '', fillRect: () => {}, strokeStyle: '', lineWidth: 0,
            beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
            ellipse: () => {}, fill: () => {}, createPattern: () => {}, createImageData: () => ({ data: [] }),
            putImageData: () => {}, createRadialGradient: () => ({ addColorStop: () => {} }),
            createLinearGradient: () => ({ addColorStop: () => {} }), arc: () => {},
            translate: () => {}, scale: () => {}, restore: () => {}, save: () => {},
            clip: () => {}, rect: () => {}, closePath: () => {}
        })
    })
};
global.window = { addEventListener: () => {} };
global.localStorage = { getItem: () => null, setItem: () => {} };

const mockSave = {
    metaState: {
        upgrades: { hp: 0, speed: 0, light: 0, magnet: 0 },
        killCounts: {},
        inventory: [],
        equippedTokens: {},
        selectedCurses: [],
        maxFloorReached: 1,
        tutorialCompleted: true
    },
    saveGame: () => {}
};

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
    if (condition) {
        passed++;
        console.log(`  \x1b[32m✓\x1b[0m ${label}`);
    } else {
        failed++;
        console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `  — ${detail}` : ''}`);
    }
}

// ---------------------------------------------------------------------------
console.log('\nSynergy requirements reference real weapons');

{
    // Real weapon roster comes from an actual Game instance, not MANIFESTATIONS —
    // MANIFESTATIONS contains an orphan 'adrenaline' entry that is not a key in
    // state.player.weapons, so validating against it would pass a broken synergy.
    const game = new Game();
    game.init(mockSave);
    const realWeaponIds = Object.keys(game.state.player.weapons);

    for (const [synergyId, synergy] of Object.entries(SYNERGIES)) {
        check(`SYNERGIES.${synergyId} has a non-empty reqs array`,
              Array.isArray(synergy.reqs) && synergy.reqs.length > 0);

        for (const reqId of synergy.reqs || []) {
            check(`SYNERGIES.${synergyId}.reqs references real weapon '${reqId}'`,
                  realWeaponIds.includes(reqId),
                  `real weapons: [${realWeaponIds.join(', ')}]`);
        }
    }
}

// ---------------------------------------------------------------------------
console.log('\nToken validity');

{
    // Patch 31: reads TOKEN_SLOT_TYPES rather than a local copy, so this test tracks
    // the real source of truth instead of drifting from it (the old hardcoded
    // ['head','body','hands','legs'] would have silently rejected the new
    // 'prescription' slot).
    const validSlotTypes = TOKEN_SLOT_TYPES;
    const tokenSetKeys = Object.keys(TOKEN_SETS);
    const setCounts = {};
    const slotCounts = {};

    // Effect keys a consumer knows how to resolve. Mirrors the stat vocabulary in
    // SaveManager.getResolvedTokenEffects() — a typo'd key here means a token whose
    // effect silently does nothing, which is exactly the class of bug Patch 31 found
    // across the pre-existing token data.
    const KNOWN_EFFECT_KEYS = [
        'sanity', 'speed', 'light', 'magnet', 'iframes', 'flashlightAngle',
        'tagDamage', 'lucidityGain', 'dashCooldown', 'dashDuration', 'grant'
    ];

    for (const [tokenId, token] of Object.entries(TOKENS)) {
        check(`TOKENS.${tokenId}.type is a real slot type`,
              validSlotTypes.includes(token.type), `got '${token.type}'`);

        check(`TOKENS.${tokenId}.set references a real TOKEN_SETS key`,
              tokenSetKeys.includes(token.set), `got '${token.set}'`);

        check(`TOKENS.${tokenId} has a non-empty effects object`,
              !!token.effects && Object.keys(token.effects).length > 0);

        for (const key of Object.keys(token.effects || {})) {
            check(`TOKENS.${tokenId}.effects key '${key}' is one a resolver knows`,
                  KNOWN_EFFECT_KEYS.includes(key));
        }

        if (tokenSetKeys.includes(token.set)) {
            setCounts[token.set] = (setCounts[token.set] || 0) + 1;
        }
        slotCounts[token.type] = (slotCounts[token.type] || 0) + 1;
    }

    console.log('\nTOKEN_SETS coverage (set bonuses trigger at 2 and 4 equipped)');
    for (const setKey of tokenSetKeys) {
        // >= 4, not >= 2: a set whose 4-piece bonus can never be assembled is a
        // bonus the player can read but never earn.
        check(`TOKEN_SETS.${setKey} has >= 4 tokens, so its 4pc bonus is reachable`,
              (setCounts[setKey] || 0) >= 4,
              `referenced by ${setCounts[setKey] || 0}`);

        check(`TOKEN_SETS.${setKey} declares machine-readable bonuses for 2 and 4`,
              !!TOKEN_SETS[setKey].bonuses && !!TOKEN_SETS[setKey].bonuses[2] && !!TOKEN_SETS[setKey].bonuses[4]);

        // The '2'/'4' display strings are what the loadout UI prints; a set that
        // resolves a bonus with no text to show it is invisible to the player.
        check(`TOKEN_SETS.${setKey} keeps its '2' and '4' display strings`,
              typeof TOKEN_SETS[setKey]['2'] === 'string' && typeof TOKEN_SETS[setKey]['4'] === 'string');
    }

    console.log('\nEvery slot type is fillable');
    for (const slot of validSlotTypes) {
        check(`slot '${slot}' has at least one token that fits it`,
              (slotCounts[slot] || 0) >= 1, `got ${slotCounts[slot] || 0}`);
    }
}

// ---------------------------------------------------------------------------
console.log('\nToken rarity progression (bonus check)');

{
    // SaveManager.upgradeToken() hardcodes the rarity chain as string literals
    // (common -> rare -> epic -> legendary -> mythic) rather than deriving it from
    // TOKEN_RARITIES. This just confirms TOKEN_RARITIES hasn't drifted from that
    // hardcoded chain, which would otherwise fail silently at upgrade time.
    const expectedChain = ['common', 'rare', 'epic', 'legendary', 'mythic'];
    const actualKeys = Object.keys(TOKEN_RARITIES);

    check('TOKEN_RARITIES keys match the hardcoded SaveManager upgrade chain',
          expectedChain.length === actualKeys.length &&
          expectedChain.every(k => actualKeys.includes(k)),
          `expected [${expectedChain.join(', ')}], got [${actualKeys.join(', ')}]`);
}

// ---------------------------------------------------------------------------
console.log('\ngetXPRequiredForLevel is monotonically increasing');

{
    let prev = -Infinity;
    let monotonic = true;
    let firstBadLevel = null;

    for (let level = 1; level <= 50; level++) {
        const req = getXPRequiredForLevel(level);
        if (!(req > prev)) {
            monotonic = false;
            if (firstBadLevel === null) firstBadLevel = level;
        }
        prev = req;
    }

    check('getXPRequiredForLevel(1..50) strictly increases every level',
          monotonic, `first non-increasing at level ${firstBadLevel}`);
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
