/**
 * Content-data integrity checks (synergies, tokens, token sets, XP curve).
 *
 * Run with:  node test_content.js
 *
 * GAP NOW CLOSED (Patch 56/57): the boon pool used to be a `const BOONS` local to
 * LevelUpUI.js's show(), unreachable from a data-only test. It is now exported, and
 * asserted below. The `MANIFESTATIONS` export in Manifestations.js still looks like
 * it should be the boon pool (it is imported into LevelUpUI.js) but remains dead
 * there — its only real consumer is getActiveSynergies()'s maxLvl lookup. Any
 * "expand the boon pool" patch must still edit LevelUpUI.js's BOONS array, not
 * MANIFESTATIONS.
 */

import { Game } from './src/core/Game.js';
import {
    SYNERGIES, TOKENS, TOKEN_SETS, TOKEN_RARITIES, TOKEN_SLOT_TYPES, INTRUSIVE_THOUGHTS
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
            translate: () => {}, scale: () => {}, rotate: () => {}, restore: () => {}, save: () => {},
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
console.log('\nCurse risk ladder (Patch 32)');

{
    const VALID_WEIGHTS = [10, 15, 20, 30]; // MILD / MODERATE / SEVERE / EXTREME
    const REVIVED_IDS = ['hemophilia', 'nyctophobia', 'fragile_mind']; // previously orphaned Game.js checks

    const curseIds = Object.keys(INTRUSIVE_THOUGHTS);
    check('at least 7 curses (4 original + 3 revived)', curseIds.length >= 7, `got ${curseIds.length}`);
    check('no duplicate curse ids', new Set(curseIds).size === curseIds.length);

    for (const [curseId, curse] of Object.entries(INTRUSIVE_THOUGHTS)) {
        check(`INTRUSIVE_THOUGHTS.${curseId}.id matches its key`, curse.id === curseId);
        check(`INTRUSIVE_THOUGHTS.${curseId}.lucidityWeight is a real ladder tier`,
              VALID_WEIGHTS.includes(curse.lucidityWeight), `got ${curse.lucidityWeight}`);
        check(`INTRUSIVE_THOUGHTS.${curseId} has a non-empty desc`,
              typeof curse.desc === 'string' && curse.desc.length > 0);
    }

    for (const id of REVIVED_IDS) {
        check(`revived curse '${id}' is present in the selectable pool`, curseIds.includes(id));
    }
}

// ---------------------------------------------------------------------------
console.log('\nSaveManager.getResolvedCurseBonus / toggleCurse gate (Patch 32)');

{
    // Real SaveManager instance, isolated localStorage mock — same pattern as
    // test_synapse.js's fixture tests.
    const store = {};
    global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
    const { SaveManager } = await import('./src/core/SaveManager.js');

    const sm = new SaveManager();
    sm.metaState.spentLucidity = 20000; // PL5+
    sm.metaState.killCounts.BOSS = 0;   // but no boss kill yet

    check('toggleCurse REJECTS adoption before the gate (no boss kill)',
          sm.toggleCurse('manic_episode') === false);
    check('selectedCurses stays empty on a rejected adopt', sm.metaState.selectedCurses.length === 0);

    sm.metaState.killCounts.BOSS = 1;
    check('toggleCurse ACCEPTS adoption once the gate is met', sm.toggleCurse('manic_episode') === true);
    check('selectedCurses now contains it', sm.metaState.selectedCurses.includes('manic_episode'));

    check('toggleCurse REJECTS an unknown curse id', sm.toggleCurse('not_a_real_curse') === false);

    sm.toggleCurse('hemophilia'); // extreme, weight 30
    const { totalPct, weights } = sm.getResolvedCurseBonus();
    check('getResolvedCurseBonus sums real per-curse weights (20 + 30 = 50)',
          totalPct === 50, `got ${totalPct}`);
    check('weights breakdown is per-curse, not just a total',
          weights.manic_episode === 20 && weights.hemophilia === 30);

    check('revoking an adopted curse is always allowed, gate or not',
          sm.toggleCurse('manic_episode') === true && !sm.metaState.selectedCurses.includes('manic_episode'));
}

// ---------------------------------------------------------------------------
// Audio asset integrity.
//
// Guards two bugs that both reached CrazyGames QA:
//   1. A referenced sound file that doesn't exist on disk (player_breath.mp3),
//      which 404s on every single load.
//   2. An ABSOLUTE "/sounds/..." path, which resolves against the domain root and
//      so breaks on any host serving the game from a subdirectory — CrazyGames
//      does exactly that. Vite's `base: './'` cannot help here: it only rewrites
//      paths Vite itself emits, never URLs built at runtime in JS.
// Parsed from source rather than imported, because instantiating AudioEngine
// needs a real AudioContext this environment doesn't have.
{
    const fs = await import('node:fs');
    const src = fs.readFileSync('./src/core/AudioEngine.js', 'utf8');
    const block = src.slice(src.indexOf('this.assetUrls'), src.indexOf('};', src.indexOf('this.assetUrls')));
    const paths = [...block.matchAll(/["'`]([^"'`]+\.mp3)["'`]/g)].map(m => m[1]);

    check('AudioEngine declares at least one sound asset', paths.length > 0, `found ${paths.length}`);

    const absolute = paths.filter(p => p.startsWith('/'));
    check('no sound path is absolute (breaks on subdirectory hosts like CrazyGames)',
          absolute.length === 0, absolute.join(', '));

    const missing = paths.filter(p => !fs.existsSync(`./public/${p}`));
    check('every referenced sound file exists in public/',
          missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : '');
}

// ---------------------------------------------------------------------------
// PLAYER_WEAPON_IDS must match the real loadout (Patch 56). The Clinical Guide and
// the Manifestation Log both iterate it, so drift here either advertises a weapon
// that cannot be obtained or silently omits a real one.
console.log('\nPLAYER_WEAPON_IDS matches state.player.weapons');
{
    const { PLAYER_WEAPON_IDS, MANIFESTATIONS: MANI } = await import('./src/data/Manifestations.js');
    const { SaveManager } = await import('./src/core/SaveManager.js');
    const g = new Game();
    g.init(new SaveManager());
    const realKeys = Object.keys(g.state.player.weapons).sort();
    const declared = [...PLAYER_WEAPON_IDS].sort();

    check('declares exactly the weapons the player actually has',
          JSON.stringify(realKeys) === JSON.stringify(declared),
          `real: ${realKeys.join(',')} | declared: ${declared.join(',')}`);

    const unnamed = PLAYER_WEAPON_IDS.filter(id => !MANI[id]);
    check('every declared weapon has a MANIFESTATIONS entry to render from',
          unnamed.length === 0, unnamed.join(', '));

    // Guards the reason PLAYER_WEAPON_IDS exists at all: if `adrenaline` ever becomes
    // a real weapon, this fails and the declared list should then include it.
    check('`adrenaline` is still a phantom (not a real weapon)',
          !realKeys.includes('adrenaline'));
}

// ---------------------------------------------------------------------------
// Flashlight cone falloff + light recoil resistance (Patch 63).
console.log('\nFlashlight cone falloff');
{
    const { coneFalloff } = await import('./src/systems/Combat.js');
    const { LIGHT_RECOIL_RESIST, ENEMY_BESTIARY } = await import('./src/data/Manifestations.js');

    const HIT = 0.6;                       // the flashlight's default half-angle
    const centre = coneFalloff(0, HIT);
    const edge = coneFalloff(HIT * 0.999, HIT);
    const mid = coneFalloff(HIT * 0.5, HIT);

    check('dead centre takes full damage and full recoil',
          Math.abs(centre.damageScale - 1) < 0.001 && Math.abs(centre.recoilScale - 1) < 0.001,
          `dmg ${centre.damageScale}, recoil ${centre.recoilScale}`);

    check('the edge still deals meaningful damage (gentle falloff)',
          edge.damageScale > 0.5 && edge.damageScale < 0.65, `got ${edge.damageScale.toFixed(3)}`);

    check('the edge barely pushes (steep falloff)',
          edge.recoilScale < 0.15, `got ${edge.recoilScale.toFixed(3)}`);

    check('recoil falls off faster than damage — the reason aiming matters',
          (1 - mid.recoilScale) > (1 - mid.damageScale) * 2,
          `mid dmg ${mid.damageScale.toFixed(3)}, mid recoil ${mid.recoilScale.toFixed(3)}`);

    check('both curves are monotonic from centre to edge',
          centre.damageScale > mid.damageScale && mid.damageScale > edge.damageScale &&
          centre.recoilScale > mid.recoilScale && mid.recoilScale > edge.recoilScale);

    // Called every frame for every lit enemy — a NaN here would silently teleport
    // entities via the flinch, so degenerate input must be inert, not poisonous.
    [[NaN, HIT], [0, NaN], [0, 0], [0, -1], [undefined, undefined]].forEach(([a, b]) => {
        const r = coneFalloff(a, b);
        check(`coneFalloff(${a}, ${b}) returns finite scales`,
              Number.isFinite(r.damageScale) && Number.isFinite(r.recoilScale),
              JSON.stringify(r));
    });

    const missing = ENEMY_BESTIARY.filter(e => !Number.isFinite(LIGHT_RECOIL_RESIST[e.id]));
    check('every bestiary manifestation has a light-recoil resistance',
          missing.length === 0, missing.map(e => e.id).join(', '));

    const outOfRange = Object.entries(LIGHT_RECOIL_RESIST).filter(([, v]) => v < 0 || v > 1);
    check('every resistance is within 0..1', outOfRange.length === 0,
          outOfRange.map(([k, v]) => `${k}=${v}`).join(', '));

    check('apex manifestations resist the beam far more than basic ones',
          LIGHT_RECOIL_RESIST.ARCHITECT < LIGHT_RECOIL_RESIST.PREDATOR &&
          LIGHT_RECOIL_RESIST.PREDATOR < LIGHT_RECOIL_RESIST.SCAVENGER);
}

// ---------------------------------------------------------------------------
// Boon pool integrity (Patch 56/57 — see the GAP NOW CLOSED note in the header).
// The Clinical Guide renders straight from this array and the history tracker keys
// on its ids, so a duplicate or malformed entry silently corrupts both.
console.log('\nBoon pool (LevelUpUI.BOONS)');
{
    const { BOONS } = await import('./src/ui/LevelUpUI.js');

    check('boon pool is a non-empty array', Array.isArray(BOONS) && BOONS.length > 0, `${BOONS.length} boons`);

    const ids = BOONS.map(b => b.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    check('every boon id is unique', dupes.length === 0, dupes.join(', '));

    const malformed = BOONS.filter(b => !b.id || !b.name || !b.desc || !Array.isArray(b.tags) || b.tags.length === 0);
    check('every boon has id, name, desc and at least one tag',
          malformed.length === 0, malformed.map(b => b.id || '(no id)').join(', '));

    // The guide groups boons by tag, so an unknown tag would render into a section
    // that does not exist and quietly disappear from the glossary.
    const KNOWN_TAGS = ['light', 'focus', 'aura', 'tech', 'melee', 'kinetic', 'hazard', 'dark', 'orbit', 'burst', 'utility', 'passive'];
    const strayTags = [...new Set(BOONS.flatMap(b => b.tags))].filter(t => !KNOWN_TAGS.includes(t));
    check('every boon tag is in the 12-tag vocabulary', strayTags.length === 0, strayTags.join(', '));
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
