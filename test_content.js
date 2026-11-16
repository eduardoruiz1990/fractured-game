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
// Patch 125 (V2 plan C2): weapon levels are data (WEAPON_LEVEL_UPS) so the card can
// say what a level does. The table must reproduce the old selectCard() if/else chain
// exactly — the chain is kept below as the oracle, and both are run side by side.
console.log('\nWeapon level-ups (LevelUpUI.WEAPON_LEVEL_UPS)');
{
    const { WEAPON_LEVEL_UPS, WEAPON_ICONS, applyWeaponLevelUp, describeWeaponLevelUp,
            synergyHintsFor, BOONS, DEEP_BOONS } = await import('./src/ui/LevelUpUI.js');
    const { PLAYER_WEAPON_IDS, MANIFESTATIONS } = await import('./src/data/Manifestations.js');

    const legacy = (id, wep) => {   // verbatim from selectCard() before Patch 125
        if (id === 'flashlight') { wep.damage += 5; wep.radius += 20; wep.angle += 0.05; }
        else if (id === 'static') { wep.damage += 3; wep.radius += 15; wep.active = true; }
        else if (id === 'lead_pipe') { wep.damage += 20; wep.radius += 15; wep.cooldown = Math.max(30, wep.cooldown - 10); }
        else if (id === 'spilled_ink') { wep.damage += 3; wep.radius += 10; wep.dropRate = Math.max(10, wep.dropRate - 5); }
        else if (id === 'corrosive_battery') { wep.damage += 5; wep.duration += 30; }
        else if (id === 'broken_chalk') { wep.radius += 15; wep.duration += 30; wep.cooldown = Math.max(60, wep.cooldown - 15); }
        else if (id === 'polaroid_camera') { wep.damage += 20; wep.radius += 40; wep.cooldown = Math.max(90, wep.cooldown - 30); }
        else if (id === 'fidget_spinner') { wep.damage += 5; wep.baseRadius += 10; wep.speed += 0.02; }
        // Patch 132: the Phase D weapons, as designed (no older chain exists for them).
        else if (id === 'pill_bottle') { wep.damage += 6; wep.bounces = Math.min(6, wep.bounces + 1); wep.cooldown = Math.max(40, wep.cooldown - 6); }
        else if (id === 'metronome') { wep.damage += 6; wep.radius += 30; wep.cooldown = Math.max(50, wep.cooldown - 10); }
        else if (id === 'straitjacket') { wep.damage += 5; wep.straps = Math.min(6, wep.straps + 1); wep.radius += 8; }
        else if (id === 'lullaby') { wep.damage += 10; wep.notes = Math.min(4, wep.notes + 1); wep.cooldown = Math.max(60, wep.cooldown - 15); }
    };
    // Game.init's starting values, plus a "modified" variant (boons/Synapse already
    // moved the numbers, cooldowns pushed BELOW their floors as steady_hands can).
    const base = {
        flashlight: { damage: 15, radius: 250, angle: 0.6 },
        static: { damage: 5, radius: 100, active: false },
        polaroid_camera: { damage: 30, radius: 300, angle: Math.PI / 3, cooldown: 180 },
        fidget_spinner: { damage: 8, baseRadius: 60, speed: 0.1 },
        lead_pipe: { damage: 45, radius: 70, cooldown: 90 },
        spilled_ink: { damage: 10, radius: 45, dropRate: 45 },
        broken_chalk: { radius: 60, duration: 300, cooldown: 600 },
        corrosive_battery: { damage: 2, duration: 180 },
        pill_bottle: { damage: 18, bounces: 2, cooldown: 75 },
        metronome: { damage: 14, radius: 200, cooldown: 100 },
        straitjacket: { damage: 12, radius: 85, straps: 2 },
        lullaby: { damage: 26, radius: 70, notes: 1, cooldown: 150 }
    };
    const modified = JSON.parse(JSON.stringify(base));
    modified.lead_pipe.cooldown = 25; modified.broken_chalk.cooldown = 50; modified.polaroid_camera.cooldown = 70;
    modified.pill_bottle.cooldown = 30; modified.straitjacket.straps = 6;
    modified.spilled_ink.dropRate = 8; modified.flashlight.damage = 30.6; modified.fidget_spinner.damage = 12;

    for (const id of PLAYER_WEAPON_IDS) {
        check(`${id} has a WEAPON_LEVEL_UPS entry`, Array.isArray(WEAPON_LEVEL_UPS[id]) && WEAPON_LEVEL_UPS[id].length > 0);
        check(`${id} has a display name and an icon`, !!(MANIFESTATIONS[id] && MANIFESTATIONS[id].name) && !!WEAPON_ICONS[id]);
        for (const [tag, start] of [['init', base], ['modified', modified]]) {
            if (!start[id]) { check(`${id} has a ${tag} fixture`, false); continue; }
            const a = { ...start[id] }, b = { ...start[id] };
            for (let i = 0; i < 8; i++) { legacy(id, a); applyWeaponLevelUp(b, id); }
            check(`${id}: table == legacy chain over 8 levels (${tag})`, JSON.stringify(a) === JSON.stringify(b),
                  `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
        }
        const lines = describeWeaponLevelUp({ ...base[id] }, id);
        check(`${id}: card lines exist and carry no NaN/undefined`,
              lines.length > 0 && lines.every(l => !/NaN|undefined|Infinity/.test(l)), lines.join(' | '));
    }
    check('flashlight card line reads "Damage 15 → 20"',
          describeWeaponLevelUp({ ...base.flashlight }, 'flashlight')[0] === 'Damage 15 → 20');
    check('a cooldown already at its floor is not described as changing',
          !describeWeaponLevelUp({ damage: 45, radius: 70, cooldown: 30 }, 'lead_pipe').some(l => l.startsWith('Swing every')));

    // Synergy hints use the real getActiveSynergies rule (both weapons at level 5).
    const w = {}; PLAYER_WEAPON_IDS.forEach(id => { w[id] = { level: 0 }; });
    w.flashlight.level = 1;
    const h0 = synergyHintsFor(w, 'static');
    check('static card says it pairs with the flashlight', h0.pairs.some(p => /Flashlight/.test(p)) && h0.ready.length === 0, JSON.stringify(h0));
    w.flashlight.level = 5; w.static.level = 4;
    const h1 = synergyHintsFor(w, 'static');
    check('static 4 -> 5 with flashlight 5 is SYNERGY READY', h1.ready.length === 1, JSON.stringify(h1));

    // No alchemical symbols (U+1F700–1F77F): no Android or Windows font has them.
    const alchemical = [...BOONS, ...DEEP_BOONS].filter(b => [...String(b.icon)].some(c => {
        const cp = c.codePointAt(0); return cp >= 0x1F700 && cp <= 0x1F77F;
    }));
    check('no boon icon uses an alchemical symbol', alchemical.length === 0, alchemical.map(b => b.id).join(', '));
}

// ---------------------------------------------------------------------------
// Patch 132 (V2 plan D3): the four Phase D weapons, the six-slot cap, the back-fill.
console.log('\nPhase D weapons (Patch 132)');
{
    const { backfillWeapons } = await import('./src/core/Game.js');
    const { MAX_WEAPON_SLOTS, ownedWeaponCount } = await import('./src/data/Config.js');
    const { ARSENAL_CAPS, DROWSY_SLOW } = await import('./src/systems/Arsenal.js');
    const { Combat } = await import('./src/systems/Combat.js');
    const { SYNERGIES } = await import('./src/data/Manifestations.js');

    const fresh = () => { const g = new Game(); g.init(mockSave); return g; };
    let g = fresh();
    for (const id of ['pill_bottle', 'metronome', 'straitjacket', 'lullaby']) {
        check(`${id} exists at level 0 on a fresh run`, g.state.player.weapons[id] && g.state.player.weapons[id].level === 0);
        check(`${id} is in a synergy`, Object.values(SYNERGIES).some(sy => sy.reqs.includes(id)));
    }
    // A run suspended before Patch 132 carries only the old eight.
    const old = { flashlight: { level: 3, damage: 25 } };
    const filled = backfillWeapons(old, fresh().state.player.weapons);
    check('back-fill keeps the carried weapon untouched', filled.flashlight.level === 3 && filled.flashlight.damage === 25);
    check('back-fill adds the missing weapons at level 0', filled.lullaby && filled.lullaby.level === 0);
    const g2 = new Game(); g2.init(mockSave, { floor: 2, sanity: 50, xp: 0, level: 3, lucidity: 0, runInventory: [], weapons: { flashlight: { level: 2, damage: 20, radius: 250, angle: 0.6, tags: ['light'] } } });
    check('an old carried run resumes with all twelve weapons', Object.keys(g2.state.player.weapons).length >= 12);

    // Six slots.
    const ws = fresh().state.player.weapons;
    check('six slots', MAX_WEAPON_SLOTS === 6 && ownedWeaponCount(ws) === 1);

    // Arsenal behaviour, one weapon at a time, enemies parked in front of the player.
    const park = (g, n, dist = 120) => {
        for (let i = 0; i < n; i++) g.director.spawnEntity('SCAVENGER', null, null, g.state.player.x + dist + i * 40, g.state.player.y);
        g.state.entities.forEach(e => { e.update = () => {}; });
    };
    const tick = (g, steps) => { for (let i = 0; i < steps; i++) { g.state.frame++; Combat.resolveWeapons(g); } };
    const solo = (g, id) => { g.state.player.weapons.flashlight.level = 0; g.state.player.weapons.flashlight.radius = 0; g.state.player.weapons[id].level = 1; };

    g = fresh(); solo(g, 'pill_bottle'); park(g, 3);
    const hp0 = g.state.entities.map(e => e.hp);
    tick(g, 40);
    check('pill bottle is thrown and ricochets through all three', g.state.entities.every((e, i) => e.hp < hp0[i]) || g.state.runKills > 0,
          JSON.stringify(g.state.entities.map(e => e.hp)));

    g = fresh(); solo(g, 'metronome'); park(g, 2, 100);
    const m0 = g.state.entities.map(e => e.hp), x0 = g.state.entities[0].x;
    tick(g, 30);
    check('metronome pulse strikes each enemy once and shoves it outward',
          g.state.entities[0].hp === m0[0] - 14 && g.state.entities[0].x > x0, `${m0[0]} -> ${g.state.entities[0].hp}`);

    g = fresh(); solo(g, 'straitjacket');
    const st = g.state.player.weapons.straitjacket;
    g.director.spawnProjectile(g.state.player.x + st.radius, g.state.player.y, 0, 0, 8, 10, '#fff', 120);
    st.phase = -st.speed;   // lands on angle 0 after this step's advance
    tick(g, 1);
    check('a strap tears an enemy projectile out of the air', g.state.projectiles.length === 0);

    g = fresh(); solo(g, 'lullaby'); park(g, 1, 90);
    g.state.entities[0].hp = g.state.entities[0].maxHp = 1000;   // survive the burst
    const e = g.state.entities[0];
    for (let i = 0; i < 140 && !(e.drowsy > 0); i++) tick(g, 1);
    check('a lullaby note reaches its target and leaves it drowsy', e && e.drowsy > 0, e && `drowsy ${e.drowsy}`);
    tick(g, 1);
    check('drowsy enemies move slower', e.speedModifier <= DROWSY_SLOW);

    g = fresh(); g.state.player.weapons.pill_bottle.level = 1;
    g.director.releaseRoomState(g.state);
    check('room change empties the transient weapon arrays', g.state.playerShots.length === 0 && g.state.pulseRings.length === 0);
    check('transient caps are set', ARSENAL_CAPS.playerShots > 0 && ARSENAL_CAPS.lullabyNotes > 0);
}

// ---------------------------------------------------------------------------
// Patch 133 (V2 plan D4): named elites and chests.
console.log('\nElites and chests (Patch 133)');
{
    const E = await import('./src/systems/Elites.js');
    const { Combat } = await import('./src/systems/Combat.js');

    check('no elite in the tutorial, the boss room, or floor 1 room 1',
          E.eliteChanceForRoom(1, 1, false, true) === 0 && E.eliteChanceForRoom(2, 5, true, false) === 0 && E.eliteChanceForRoom(1, 1, false, false) === 0);
    check('elites become likelier deeper, capped', E.eliteChanceForRoom(1, 2, false, false) > 0
          && E.eliteChanceForRoom(4, 2, false, false) > E.eliteChanceForRoom(2, 2, false, false)
          && E.eliteChanceForRoom(40, 2, false, false) <= 0.75);
    for (const t of ['SCAVENGER', 'PREDATOR', 'PARASITE']) check(`${t} elites have names`, E.ELITE_NAMES[t].length > 0);

    const fresh = () => { const g = new Game(); g.init(mockSave); g.state.isTutorial = false; g.state.stress = 1; return g; };
    let g = fresh();
    const ent = g.director.spawnEntity('PREDATOR', null, null, 300, 0);
    const hp = ent.hp, dmg = ent.damage;
    E.promoteToElite(ent, () => 0);
    check('promotion: x6 hp, harder hits, a name, a bigger radius',
          ent.elite && ent.hp === hp * 6 && ent.maxHp === ent.hp && ent.damage > dmg && ent.eliteName === 'THE TRUANT OFFICER' && ent.radius === E.ELITE_RADIUS, JSON.stringify({hp, h: ent.hp, dmg, d: ent.damage, n: ent.eliteName, r: ent.radius}));
    ent.init(Math.random(), 0, 0, 1);
    check('a pooled elite comes back plain', !ent.elite && !ent.eliteName && ent.radius === undefined);

    // Director promotes the spawn that halves the budget.
    g = fresh();
    g.director.spawnRoom(2, 2);
    g.state.eliteAt = Math.floor(g.state.enemyBudget * 0.5);
    let guard = 0;
    while (!g.state.eliteSpawned && g.state.enemyBudget > 0 && guard++ < 5000) { g.state.budgetTimer = -1; g.director.spawnWave(1280, 720); }
    check('the room promotes exactly one elite at half budget', g.state.eliteSpawned && g.state.entities.filter(e => e.elite).length === 1,
          `budget ${g.state.enemyBudget}, elites ${g.state.entities.filter(e => e.elite).length}`);

    // Killing it drops a chest; walking in opens it after the beat.
    g = fresh();
    g.state.player.weapons.static.level = 2; g.state.player.weapons.static.active = true;
    const el = E.promoteToElite(g.director.spawnEntity('SCAVENGER', null, null, 200, 0));
    el.hp = 0;
    Combat.resolveWeapons(g);
    const chest = g.state.interactables.find(o => o.type === 'CHEST');
    check('a dead elite drops a chest', !!chest && !g.state.entities.includes(el));
    let opened = null;
    g.onChestOpened = (r) => { opened = r; };
    const lv0 = { fl: g.state.player.weapons.flashlight.level, st: g.state.player.weapons.static.level };
    g.state.player.x = chest.x; g.state.player.y = chest.y;
    for (let i = 0; i < E.CHEST_OPEN_STEPS + 2; i++) { g.state.hitStop = 0; Combat.resolveWeapons(g); }
    const lv1 = { fl: g.state.player.weapons.flashlight.level, st: g.state.player.weapons.static.level };
    const gained = (lv1.fl - lv0.fl) + (lv1.st - lv0.st);
    check('walking in opens it after the beat, and it reports', opened && opened.kind === 'levels' && !g.state.interactables.some(o => o.type === 'CHEST'),
          JSON.stringify(opened));
    check('the levels went to owned weapons only', gained === opened.lines.length && gained >= 1
          && Object.entries(g.state.player.weapons).every(([id, w]) => ['flashlight', 'static'].includes(id) || w.level === 0));

    // Nothing owned can level: Lucidity instead.
    g = fresh();
    for (const w of Object.values(g.state.player.weapons)) w.level = 0;
    g.state.player.weapons.flashlight.level = 5;
    const luc = g.state.lucidity;
    const r = E.resolveChest(g.state);
    check('a chest with nothing to level pays Lucidity', r.kind === 'lucidity' && g.state.lucidity === luc + 100);
    // The evolution hook wins when it returns something.
    const r2 = E.resolveChest(g.state, { evolve: () => ({ id: 'x', name: 'X', desc: 'd' }) });
    check('an available evolution takes the chest', r2.kind === 'evolution' && r2.title === 'X');
}

// ---------------------------------------------------------------------------
// Patch 134 (V2 plan D2): weapon evolutions.
console.log('\nEvolutions (Patch 134)');
{
    const EV = await import('./src/systems/Evolutions.js');
    const { resolveChest } = await import('./src/systems/Elites.js');
    const { evolutionHintsFor, BOONS } = await import('./src/ui/LevelUpUI.js');
    const { PLAYER_WEAPON_IDS } = await import('./src/data/Manifestations.js');
    const { SaveManager } = await import('./src/core/SaveManager.js');
    const { Combat } = await import('./src/systems/Combat.js');
    const evos = Object.values(EV.EVOLUTIONS);

    check('one evolution per weapon, all twelve', evos.length === PLAYER_WEAPON_IDS.length
          && PLAYER_WEAPON_IDS.every(id => evos.filter(e => e.weapon === id).length === 1));
    check('every evolution names a real boon, no boon used twice',
          evos.every(e => BOONS.some(b => b.id === e.boon)) && new Set(evos.map(e => e.boon)).size === evos.length);
    check('every evolution has a name and a description', evos.every(e => e.name && e.desc && typeof e.apply === 'function'));

    const fresh = () => { const g = new Game(); g.init(mockSave); g.state.stress = 1; g.state.isTutorial = false; return g; };
    // Each evolution applied to its weapon's level-5 starting numbers stays finite.
    for (const e of evos) {
        const g = fresh(); const w = g.state.player.weapons[e.weapon];
        w.level = 5; g.state.player.boons.push(e.boon);
        const ok1 = EV.applyEvolution(g.state, e.id);
        const finite = Object.entries(w).every(([k, v]) => typeof v !== 'number' || Number.isFinite(v));
        check(`${e.name} applies to ${e.weapon} and leaves finite numbers`, ok1 && w.evolution === e.id && finite);
    }

    let g = fresh();
    g.state.player.weapons.lead_pipe.level = 4;
    g.state.player.boons.push('heavy_swing');
    check('not available below level 5', EV.availableEvolutions(g.state).length === 0);
    check('the card that takes it to 5 says EVOLUTION READY',
          evolutionHintsFor(g.state.player, { type: 'weapon', id: 'lead_pipe' }).ready[0] === 'Wrecking Bar');
    g.state.player.weapons.lead_pipe.level = 5;
    const dmg0 = g.state.player.weapons.lead_pipe.damage;
    const r = resolveChest(g.state, { evolve: EV.evolveForChest });
    check('a chest evolves the qualifying weapon', r.kind === 'evolution' && r.evolution.id === 'wrecking_bar'
          && g.state.player.weapons.lead_pipe.damage === dmg0 * 2 && /Heavy Lead Pipe/.test(r.evolution.recipe));
    const r2 = resolveChest(g.state, { evolve: EV.evolveForChest });
    check('the same weapon never evolves twice', r2.kind !== 'evolution' && !EV.applyEvolution(g.state, 'wrecking_bar'));

    g = fresh(); g.state.player.weapons.static.level = 5;
    check('the boon card says EVOLUTION READY when its weapon is maxed',
          evolutionHintsFor(g.state.player, { type: 'boon', id: 'overcharge' }).ready[0] === 'White Noise Machine');
    g.state.player.weapons.static.level = 2;
    check('...and nudges when the weapon is owned but not maxed',
          /evolves Static Receiver/.test(evolutionHintsFor(g.state.player, { type: 'boon', id: 'overcharge' }).lines[0] || ''));

    // Arsenal-side evolution effects.
    g = fresh(); const pb = g.state.player.weapons.pill_bottle;
    g.state.player.weapons.flashlight.level = 0; g.state.player.weapons.flashlight.radius = 0;
    pb.level = 5; g.state.player.boons.push('steady_hands'); EV.applyEvolution(g.state, 'pill_organiser');
    for (let i = 0; i < 3; i++) { const e = g.director.spawnEntity('SCAVENGER', null, null, 150 + i * 60, 0); e.update = () => {}; e.hp = e.maxHp = 999; }
    g.state.frame++; Combat.resolveWeapons(g);
    check('Pill Organiser throws two bottles at once', g.state.playerShots.length === 2);

    // Save: back-filled, recorded once.
    const sm = new SaveManager();
    delete sm.metaState.discoveredEvolutions;
    sm.saveGame(); sm.loadGame();
    check('an old save gets discoveredEvolutions back-filled', sm.metaState.discoveredEvolutions && typeof sm.metaState.discoveredEvolutions === 'object');
    check('recordEvolution is new once', sm.recordEvolution('ceiling_fan') === true && sm.recordEvolution('ceiling_fan') === false);
}

// ---------------------------------------------------------------------------
// Patch 135 (V2 plan D4): the Photocopy, the Fire Warden, the Crawlspace.
console.log('\nPhase D enemies (Patch 135)');
{
    const { Combat } = await import('./src/systems/Combat.js');
    const { ENEMY_BESTIARY, LIGHT_RECOIL_RESIST } = await import('./src/data/Manifestations.js');
    const { BURROW_STEPS } = await import('./src/entities/Burrower.js');
    const E = await import('./src/systems/Elites.js');
    const fresh = () => { const g = new Game(); g.init(mockSave); g.state.stress = 1; g.state.isTutorial = false; return g; };

    for (const t of ['SPLITTER', 'WARDEN', 'BURROWER']) {
        const g = fresh();
        const e = g.director.spawnEntity(t, null, null, 300, 0);
        check(`${t} spawns from its pool with finite stats`, e && e.type === t && Number.isFinite(e.hp) && e.hp > 0 && Number.isFinite(e.speed));
        check(`${t} has a bestiary entry, a light resistance and elite names`,
              ENEMY_BESTIARY.some(b => b.id === t) && LIGHT_RECOIL_RESIST[t] !== undefined && E.ELITE_NAMES[t].length > 0);
    }

    // Photocopy: splits once.
    let g = fresh();
    g.state.player.weapons.flashlight.radius = 0;
    const sp = g.director.spawnEntity('SPLITTER', null, null, 400, 0);
    sp.hp = 0; Combat.resolveWeapons(g);
    const copies = g.state.entities.filter(e => e.type === 'SPLITTER');
    check('a Photocopy tears into two generation-2 copies', copies.length === 2 && copies.every(c => c.generation === 2 && c.hp < sp.maxHp));
    copies.forEach(c => { c.hp = 0; });
    Combat.resolveWeapons(g);
    check('the copies do not copy again', !g.state.entities.some(e => e.type === 'SPLITTER'));
    {
        const { SaveManager } = await import('./src/core/SaveManager.js');
        const sm = new SaveManager(); const k0 = sm.metaState.killCounts.SPLITTER || 0;
        sm.recordKill('SPLITTER'); sm.recordKill('ELITE');
        check('kills of a new type are counted (recordKill no longer drops them)', sm.metaState.killCounts.SPLITTER === k0 + 1 && sm.metaState.killCounts.ELITE >= 1);
    }

    // Fire Warden: half damage to what is near it, never itself, never a boss.
    g = fresh();
    const w = g.director.spawnEntity('WARDEN', null, null, 500, 0);
    const near = g.director.spawnEntity('SCAVENGER', null, null, 560, 0);
    const far = g.director.spawnEntity('SCAVENGER', null, null, 900, 0);
    w.update(g.state, g);
    const h0 = near.hp, f0 = far.hp;
    near.takeDamage(10, g); far.takeDamage(10, g);
    check('a warded enemy takes half damage', h0 - near.hp === 5 && f0 - far.hp === 10, `${h0 - near.hp} / ${f0 - far.hp}`);
    const wh = w.hp; w.takeDamage(10, g);
    check('the Warden does not ward itself', wh - w.hp === 10);
    for (let i = 0; i < 8; i++) near.applyMovement(g.state, g);
    const h1 = near.hp; near.takeDamage(10, g);
    check('the ward fades once the Warden stops refreshing it', h1 - near.hp === 10);

    // Crawlspace: untouchable underground, warns, erupts where you stood, then exposed.
    g = fresh();
    const b = g.director.spawnEntity('BURROWER', null, null, 300, 0);
    const bh = b.hp; b.takeDamage(50, g);
    check('a burrowed Crawlspace takes no damage', b.burrowed && b.hp === bh);
    g.state.player.x = 0; g.state.player.y = 0;
    let steps = 0;
    while (b.burrowState === 'burrowed' && steps++ < 400) { g.state.frame++; b.update(g.state, g); }
    check('it surfaces under the player with a warning', b.burrowState === 'warning' && Math.hypot(b.x, b.y) < 1);
    const s0 = g.state.sanity; g.state.player.iframes = 0;
    for (let i = 0; i < BURROW_STEPS.warn + 1; i++) { g.state.frame++; b.update(g.state, g); }
    check('standing on the ring when it erupts hurts', g.state.sanity < s0 && b.burrowState === 'exposed' && !b.burrowed);
    const eh = b.hp; b.takeDamage(10, g);
    check('an exposed Crawlspace can be hit', b.hp === eh - 10);
    // Dodging works: surface, step out, no damage.
    g = fresh();
    const b2 = g.director.spawnEntity('BURROWER', null, null, 0, 0);
    b2.burrowState = 'warning'; b2.burrowTimer = 2; b2.burrowed = true;
    g.state.player.x = 200; g.state.player.y = 0;
    const s1 = g.state.sanity;
    for (let i = 0; i < 4; i++) { g.state.frame++; b2.update(g.state, g); g.state.player.x = 200; }
    check('stepping out of the ring dodges the eruption', g.state.sanity === s1);

    // Floor tables: nothing new on floor 1; the Photocopy on 2; all three by 4.
    const seen = (floor) => {
        const gg = fresh(); gg.state.floor = floor; gg.director.spawnRoom(floor, 2);
        // The floor's own table: a SWARM room (15%) forces every spawn to SCAVENGER, and
        // a room event would change the budget, so both are pinned off here.
        gg.state.roomModifier = null; gg.state.roomEvent = null;
        gg.director.hasRoomForEnemy = () => true;
        const types = new Set();
        for (let i = 0; i < 1500; i++) {
            gg.state.enemyBudget = 50; gg.state.budgetTimer = -1;
            gg.director.spawnWave(1280, 720);
            const last = gg.state.entities[gg.state.entities.length - 1];
            if (last) types.add(last.type);
            gg.director.releaseRoomState(gg.state);
        }
        return types;
    };
    const f1 = seen(1), f2 = seen(2), f4 = seen(4);
    check('floor 1 has none of the new three', !['SPLITTER', 'WARDEN', 'BURROWER'].some(t => f1.has(t)), [...f1].join(','));
    check('floor 2 introduces the Photocopy only', f2.has('SPLITTER') && !f2.has('WARDEN') && !f2.has('BURROWER'), [...f2].join(','));
    check('floor 4 has all three', f4.has('SPLITTER') && f4.has('WARDEN') && f4.has('BURROWER'), [...f4].join(','));
}

// ---------------------------------------------------------------------------
// Patch 136 (V2 plan D1): playable Patients.
console.log('\nPatients (Patch 136)');
{
    const P = await import('./src/data/Patients.js');
    const { Combat } = await import('./src/systems/Combat.js');
    const { SaveManager } = await import('./src/core/SaveManager.js');
    const { BOONS } = await import('./src/ui/LevelUpUI.js');
    const meta = (over = {}) => ({ ...JSON.parse(JSON.stringify(mockSave.metaState)), ...over });
    const run = (m, carried = null) => { const g = new Game(); g.init({ metaState: m, saveGame: () => {} }, carried); g.state.stress = 1; g.state.isTutorial = false; return g; };

    check('four Patients, the Insomniac first and always admitted',
          P.PATIENT_ORDER.length === 4 && P.PATIENT_ORDER[0] === 'insomniac' && P.isPatientUnlocked('insomniac', {}));
    check('every Patient names a real starting weapon',
          P.PATIENT_ORDER.every(id => Game && P.PATIENTS[id].weapon && run(meta()).state.player.weapons[P.PATIENTS[id].weapon]));
    check('locked until their milestone', !P.isPatientUnlocked('vandal', meta()) && P.isPatientUnlocked('vandal', meta({ killCounts: { BOSS: 1 } }))
          && P.isPatientUnlocked('artist', meta({ maxFloorReached: 3 })) && P.isPatientUnlocked('photographer', meta({ killCounts: { PANOPTICON: 1 } })));
    check('a locked or unknown choice falls back to the Insomniac',
          P.resolvePatient('vandal', meta()) === 'insomniac' && P.resolvePatient('nobody', meta()) === 'insomniac');

    // The default run is the Insomniac: flashlight only, +10% reach, blackout-immune.
    let g = run(meta());
    check('a default run is the Insomniac', g.state.player.character === 'insomniac' && g.state.player.blackoutImmune
          && Object.values(g.state.player.weapons).filter(w => w.level > 0).length === 1
          && Math.abs(g.state.player.weapons.flashlight.radius - 275) < 1e-9);

    // The Vandal: pipe at 1 (one card-level step applied), +20 Sanity, slower.
    const base = run(meta());
    g = run(meta({ killCounts: { BOSS: 1 }, selectedCharacter: 'vandal' }));
    const pipe = g.state.player.weapons.lead_pipe;
    check('the Vandal starts with the pipe at level 1, exactly as a card would give it',
          g.state.player.character === 'vandal' && pipe.level === 1 && pipe.damage === 65 && pipe.radius === 85);
    check('...with +20 max Sanity and 5% less speed',
          g.state.player.maxHp === base.state.player.maxHp + 20 && g.state.player.speed < base.state.player.speed);
    // Lifesteal on a pipe swing.
    g.state.player.weapons.flashlight.radius = 0; g.state.sanity = 50;
    const e = g.director.spawnEntity('SCAVENGER', null, null, 40, 0); e.update = () => {}; e.hp = e.maxHp = 999;
    pipe.timer = 0; Combat.resolveWeapons(g);
    check('the Vandal\'s pipe hit restores Sanity', g.state.sanity > 50, `${g.state.sanity}`);

    // Carried down a floor: same Patient, no second starting grant.
    const carried = g.getCarriedState();
    carried.weapons.lead_pipe.level = 3;
    const g2 = run(meta({ killCounts: { BOSS: 1 }, selectedCharacter: 'insomniac' }), carried);
    check('a descent keeps the run\'s Patient and its passive', g2.state.player.character === 'vandal' && g2.state.player.meleeLifesteal);
    check('...and does not grant the start weapon again', g2.state.player.weapons.lead_pipe.level === 3);

    // The Artist's ink.
    g = run(meta({ maxFloorReached: 3, selectedCharacter: 'artist' }));
    check('the Artist starts with ink', g.state.player.weapons.spilled_ink.level === 1 && g.state.player.inkMaster);
    g.director.spawnInkPuddle(300, 0, 60, 5);
    const ie = g.director.spawnEntity('SCAVENGER', null, null, 300, 0); ie.update = () => {};
    g.state.player.weapons.flashlight.radius = 0;
    Combat.resolveWeapons(g);
    check('the Artist\'s pools slow to 0.3', ie.speedModifier === 0.3, `${ie.speedModifier}`);

    // The Photographer's crit.
    g = run(meta({ killCounts: { PANOPTICON: 1 }, selectedCharacter: 'photographer' }));
    check('the Photographer starts with the camera', g.state.player.weapons.polaroid_camera.level === 1);
    const pe = g.director.spawnEntity('SCAVENGER', null, null, 300, 0); pe.hp = pe.maxHp = 100;
    pe.confused = 10; pe.takeDamage(10, g);
    check('hits on a confused target are x1.5', pe.hp === 85);
    pe.confused = 0; pe.takeDamage(10, g);
    check('...and normal otherwise', pe.hp === 75);

    // Save field + the NEW badge.
    const sm = new SaveManager();
    delete sm.metaState.selectedCharacter; delete sm.metaState.announcedPatients;
    sm.saveGame(); sm.loadGame();
    check('an old save gets the Patient fields back-filled', sm.metaState.selectedCharacter === 'insomniac' && Array.isArray(sm.metaState.announcedPatients));
    sm.metaState.killCounts.BOSS = 1;
    check('a newly unlocked Patient is NEW until chosen', P.newlyAdmitted(sm.metaState).includes('vandal'));
    sm.setSelectedCharacter('vandal');
    check('...and not after', !P.newlyAdmitted(sm.metaState).includes('vandal') && sm.metaState.selectedCharacter === 'vandal');
}

console.log('\nSynergy discovery (Patch 126)');
{
    const { SaveManager } = await import('./src/core/SaveManager.js');
    const { synergyRecipe } = await import('./src/ui/SynergyBanner.js');

    // refreshSynergies is the one recompute path; it announces each synergy once.
    const g = new Game();
    g.init(new SaveManager());
    const fired = [];
    g.onSynergyFormed = (ids) => fired.push(...ids);
    check('Game.init itself announces nothing', fired.length === 0);
    const w = g.state.player.weapons;
    w.flashlight.level = 5; w.static.level = 4;
    check('no synergy at 5 + 4', g.refreshSynergies().length === 0 && fired.length === 0);
    w.static.level = 5;
    const formed = g.refreshSynergies();
    check('5 + 5 forms The Blinding Signal, announced once',
          formed.length === 1 && formed[0] === 'blinding_signal' && fired.length === 1, JSON.stringify(fired));
    g.refreshSynergies();
    check('a second recompute does not re-announce it', fired.length === 1);
    check('player.synergies holds it', g.state.player.synergies.includes('blinding_signal'));

    // Carried down a floor: init with carried weapons must not re-announce.
    const carried = g.getCarriedState();
    const g2 = new Game();
    g2.onSynergyFormed = (ids) => fired.push(...ids);
    g2.init(new SaveManager(), carried);
    check('a synergy carried down a floor is not announced again',
          fired.length === 1 && g2.state.player.synergies.includes('blinding_signal'));
    check('slowMo starts at 0 each init', g2.state.slowMo === 0);

    // slowMo: half speed — every other PLAYING step skips the sim.
    let steps = 0;
    g2.processGameLogic = () => { steps++; };
    g2.state.hitStop = 0;
    g2.state.slowMo = 8;
    const input = { moveX: 0, moveY: 0, aimAngle: 0, isMoving: false, isDashing: false };
    for (let i = 0; i < 8; i++) g2.update(input, 800, 600, 'PLAYING');
    check('slowMo 8 runs exactly 4 of 8 sim steps', steps === 4 && g2.state.slowMo === 0, `steps=${steps}`);
    for (let i = 0; i < 4; i++) g2.update(input, 800, 600, 'PLAYING');
    check('after slowMo every step runs again', steps === 8, `steps=${steps}`);

    // SaveManager.recordSynergy: true only the first time; back-filled and wiped.
    const store = {};
    global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
    const sm = new SaveManager();
    check('fresh profile has an empty codex', sm.metaState.discoveredSynergies
          && Object.keys(sm.metaState.discoveredSynergies).length === 0);
    check('first recordSynergy is a new entry', sm.recordSynergy('centrifuge') === true);
    check('second recordSynergy is not', sm.recordSynergy('centrifuge') === false
          && sm.metaState.discoveredSynergies.centrifuge === 2);
    // An old save without the field loads with it back-filled.
    const old = JSON.parse(store.fractured_meta || '{}');
    delete old.discoveredSynergies;
    store.fractured_meta = JSON.stringify(old);
    const sm2 = new SaveManager();
    check('an old save is back-filled with an empty codex',
          sm2.metaState.discoveredSynergies && typeof sm2.metaState.discoveredSynergies === 'object'
          && Object.keys(sm2.metaState.discoveredSynergies).length === 0);
    // An import never inherits the current profile's codex.
    const sm3 = new SaveManager();
    sm3.metaState.discoveredSynergies = { overexposure: 3 };
    const exported = Buffer.from(JSON.stringify({ ...old, lucidityBank: 5 })).toString('base64');
    if (typeof sm3.importSave === 'function') {
        try { sm3.importSave(exported); } catch (e) { /* import may reload; state is what we check */ }
        check('an import without a codex does not inherit this profile\'s',
              !sm3.metaState.discoveredSynergies.overexposure, JSON.stringify(sm3.metaState.discoveredSynergies));
    }

    // Recipes read in display names.
    check('recipe uses display names', /Flashlight .*\+ .*Static/.test(synergyRecipe(SYNERGIES.blinding_signal)),
          synergyRecipe(SYNERGIES.blinding_signal));
    check('no recipe contains a raw id', Object.values(SYNERGIES).every(sy => !/_/.test(synergyRecipe(sy))));
}

console.log('\nFirst minute (Patch 127)');
{
    const { ONBOARDING_XP } = await import('./src/data/Config.js');
    const { ensureNewWeaponOffer } = await import('./src/ui/LevelUpUI.js');
    check('levels 1 and 2 use the onboarding ramp',
          getXPRequiredForLevel(1) === ONBOARDING_XP[0] && getXPRequiredForLevel(2) === ONBOARDING_XP[1]);
    check('level 3 onward is the unchanged curve',
          getXPRequiredForLevel(3) === Math.floor(50 * 1.12 ** 2) && getXPRequiredForLevel(10) === Math.floor(50 * 1.12 ** 9));
    check('the tutorial kill (3 massive orbs = 75 XP) pays for both first cards',
          ONBOARDING_XP[0] + ONBOARDING_XP[1] <= 75);

    const W = (lv) => ({ flashlight: { level: lv.f ?? 1 }, static: { level: lv.s ?? 0 }, lead_pipe: { level: 0 } });
    const boon = (id) => ({ type: 'boon', id });
    const wep = (id, isNew) => ({ type: 'weapon', id, isNew });
    const ranked = [boon('a'), wep('flashlight', false), boon('b'), boon('c'), wep('lead_pipe', true), wep('static', true)];
    const sel = ranked.slice(0, 3);
    const out = ensureNewWeaponOffer(sel, ranked, W({}));
    check('one weapon owned and no new-weapon card: the last card becomes the best-ranked new weapon',
          out.length === 3 && out[2].id === 'lead_pipe' && out[0] === sel[0] && out[1] === sel[1], JSON.stringify(out));
    check('the input array is not mutated', sel[2].id === 'b');
    const already = [boon('a'), wep('static', true), boon('b')];
    check('a selection that already offers a new weapon is unchanged',
          ensureNewWeaponOffer(already, ranked, W({})) === already);
    check('two weapons owned: unchanged', ensureNewWeaponOffer(sel, ranked, W({ s: 1 })) === sel);
    check('no new weapon left in the pool: unchanged',
          ensureNewWeaponOffer(sel, ranked.filter(c => !c.isNew), W({})) === sel);
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
