/**
 * Synapse Tree graph integrity checks (src/data/SynapseNodes.js).
 *
 * Run with:  node test_synapse.js
 *
 * Covers structural correctness of the 31-node graph: no dangling requires, no
 * cycles, full reachability from the four tier-1 roots, no duplicate ids,
 * non-negative costs, every effects key/grant string is one a future resolver
 * will actually recognize, legacy-stat deltas are exact integer multiples of
 * their legacy step (the hard constraint that keeps SaveManager's derived
 * upgrade-level mirror lossless), and the PL-deadlock invariant: you can never
 * be cost-blocked from a node whose own Patient Level gate you can't yet reach.
 *
 * Also covers Patch 29.3's save migration: fixture saves (legacy / fresh /
 * maxed) asserted against the real SaveManager class, not a reimplementation.
 */

import { SYNAPSE_NODES } from './src/data/SynapseNodes.js';
import { SaveManager } from './src/core/SaveManager.js';

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

const byId = SYNAPSE_NODES.reduce((acc, n) => { acc[n.id] = n; return acc; }, {});

// ---------------------------------------------------------------------------
console.log('\nBasic shape');

check('exactly 31 nodes', SYNAPSE_NODES.length === 31, `got ${SYNAPSE_NODES.length}`);

const ids = SYNAPSE_NODES.map(n => n.id);
check('no duplicate ids', new Set(ids).size === ids.length,
    `duplicates: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`);

for (const n of SYNAPSE_NODES) {
    check(`${n.id}.cost is non-negative`, Number.isFinite(n.cost) && n.cost >= 0, `got ${n.cost}`);
}

// ---------------------------------------------------------------------------
console.log('\nEvery requires id resolves to a real node');

for (const n of SYNAPSE_NODES) {
    for (const reqId of n.requires) {
        check(`${n.id} requires '${reqId}' which exists`, !!byId[reqId]);
    }
}

// ---------------------------------------------------------------------------
console.log('\nNo cycles in the requires graph');

{
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = {};
    SYNAPSE_NODES.forEach(n => { color[n.id] = WHITE; });
    let cycleFound = false;
    let cyclePath = '';

    function dfs(id, path) {
        if (cycleFound) return;
        color[id] = GRAY;
        const node = byId[id];
        for (const reqId of (node ? node.requires : [])) {
            if (!byId[reqId]) continue; // already flagged above, don't cascade
            if (color[reqId] === GRAY) {
                cycleFound = true;
                cyclePath = [...path, id, reqId].join(' -> ');
                return;
            }
            if (color[reqId] === WHITE) dfs(reqId, [...path, id]);
        }
        color[id] = BLACK;
    }

    for (const n of SYNAPSE_NODES) {
        if (color[n.id] === WHITE) dfs(n.id, []);
    }

    check('requires graph has no cycles', !cycleFound, cyclePath);
}

// ---------------------------------------------------------------------------
console.log('\nEvery node is reachable from a tier-1 root');

{
    // Forward-fill reachability: a root (requires: []) is reachable immediately.
    // A regular (AND) node is reachable once every one of its requires is
    // reachable. A requireMode:'any' node (the 3 capstones) is reachable once
    // at least requireCount of its requires are reachable.
    const reached = new Set();
    let changed = true;
    while (changed) {
        changed = false;
        for (const n of SYNAPSE_NODES) {
            if (reached.has(n.id)) continue;
            if (n.requires.length === 0) { reached.add(n.id); changed = true; continue; }
            const satisfiedCount = n.requires.filter(r => reached.has(r)).length;
            const needed = n.requireMode === 'any' ? (n.requireCount || 1) : n.requires.length;
            if (satisfiedCount >= needed) { reached.add(n.id); changed = true; }
        }
    }

    for (const n of SYNAPSE_NODES) {
        check(`${n.id} ('${n.name}') is reachable from a root`, reached.has(n.id));
    }
}

// ---------------------------------------------------------------------------
console.log('\nEffects keys and grant strings are all resolver-known');

const KNOWN_EFFECT_KEYS = [
    'sanity', 'speed', 'light', 'magnet',           // legacy-mirrored stats
    'iframes', 'flashlightAngle', 'tagDamage',
    'lucidityGain', 'tokenDropRate',
    'dashCooldown', 'dashDuration', 'rerollCost',
    'grant'
];
const KNOWN_TAGS = ['light', 'focus', 'aura', 'tech', 'melee', 'kinetic', 'hazard', 'dark', 'orbit', 'burst', 'utility', 'passive'];
// Each grant string needs a named future consumer (Patch 29.5 wires these into
// Game.init). Listed here so a typo'd or orphaned grant fails loudly now rather
// than silently doing nothing once the resolver exists.
const KNOWN_GRANTS = {
    'denial_recharge': 'Game.init — recharges the denial shield boon (R6)',
    'dash_charge_2': 'Game.init — grants a second dash charge (M7)',
    'start_boon': 'Game.init — grants a free boon at run start (C1)',
    'start_weapon:<choice>': 'Game.init — grants a chosen starting weapon (C2)'
};

for (const n of SYNAPSE_NODES) {
    for (const key of Object.keys(n.effects)) {
        check(`${n.id}.effects key '${key}' is resolver-known`, KNOWN_EFFECT_KEYS.includes(key));
    }
    if (n.effects.grant !== undefined) {
        check(`${n.id}.effects.grant is not mixed with numeric effects`,
            Object.keys(n.effects).length === 1, `keys: ${Object.keys(n.effects).join(', ')}`);
        check(`${n.id}.effects.grant '${n.effects.grant}' has a named consumer`,
            Object.prototype.hasOwnProperty.call(KNOWN_GRANTS, n.effects.grant));
    }
    if (n.effects.tagDamage !== undefined) {
        for (const tag of Object.keys(n.effects.tagDamage)) {
            check(`${n.id}.effects.tagDamage tag '${tag}' is a real weapon tag`, KNOWN_TAGS.includes(tag));
        }
    }
}

// ---------------------------------------------------------------------------
console.log('\nLegacy-stat effects are exact integer multiples of their legacy step');

const LEGACY_STEP = { sanity: 20, speed: 5, light: 10, magnet: 30 };

for (const n of SYNAPSE_NODES) {
    for (const [stat, step] of Object.entries(LEGACY_STEP)) {
        if (n.effects[stat] === undefined) continue;
        check(`${n.id}.effects.${stat} (${n.effects[stat]}) is a multiple of ${step}`,
            n.effects[stat] % step === 0);
    }
}

// ---------------------------------------------------------------------------
console.log('\nPL-deadlock invariant: every node\'s PL gate is reachable via organic spend');

// PL formula (SaveManager.getPatientLevelInfo): floor(sqrt(spent/500)) + 1.
// Inverted: the minimum spend to BE AT PatientLevel P is 500 * (P-1)^2.
function minSpendForPL(pl) {
    return 500 * Math.pow(pl - 1, 2);
}

{
    // Sum of every node's cost whose OWN gate is strictly below `pl` — i.e. every
    // node you could plausibly have already bought before needing this gate.
    function cumulativeCostBelowPL(pl) {
        return SYNAPSE_NODES
            .filter(n => (n.minPatientLevel === null ? 1 : n.minPatientLevel) < pl)
            .reduce((s, n) => s + n.cost, 0);
    }

    for (const n of SYNAPSE_NODES) {
        if (n.minPatientLevel === null) continue; // tier-1 roots have no gate to deadlock on
        const available = cumulativeCostBelowPL(n.minPatientLevel);
        const required = minSpendForPL(n.minPatientLevel);
        check(`${n.id} (PL${n.minPatientLevel} gate): ${available} spendable below it >= ${required} needed to reach PL${n.minPatientLevel}`,
            available >= required);
    }

    // Spot-check the exact milestone numbers called out in the handoff, as a
    // second, human-readable layer over the generic per-node check above.
    const milestones = [
        { throughTier: 1, cumulative: 600, pl: 2 },
        { throughTier: 2, cumulative: 2000, pl: 3 },
        { throughTier: 3, cumulative: 5200, pl: 4 },
        { throughTier: 4, cumulative: 10800, pl: 5 },
        { throughTier: 5, cumulative: 21200, pl: 7 },
        { throughTier: 6, cumulative: 36400, pl: 9 }
    ];
    let runningCum = 0;
    for (const m of milestones) {
        runningCum += SYNAPSE_NODES.filter(n => n.tier === m.throughTier).reduce((s, n) => s + n.cost, 0);
        check(`cumulative cost through tier ${m.throughTier} is ${m.cumulative} (spec milestone)`,
            runningCum === m.cumulative, `got ${runningCum}`);
        const derivedPL = Math.floor(Math.sqrt(runningCum / 500)) + 1;
        check(`...which resolves to PL${m.pl} (spec milestone)`, derivedPL === m.pl, `got PL${derivedPL}`);
    }
}

// ---------------------------------------------------------------------------
console.log('\nTotal tree cost');

const totalCost = SYNAPSE_NODES.reduce((s, n) => s + n.cost, 0);
check('total tree cost is 84,900', totalCost === 84900, `got ${totalCost}`);

// ---------------------------------------------------------------------------
console.log('\nSave migration fixtures (Patch 29.3)');

// Minimal stateful localStorage mock — SaveManager has no other globals to fake.
function mockLocalStorage(initial = {}) {
    const store = { ...initial };
    return {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = v; },
        _store: store
    };
}

{
    console.log('\n  fresh (no localStorage entry at all)');
    global.localStorage = mockLocalStorage();
    const sm = new SaveManager();

    check('treeNodes defaults to []', Array.isArray(sm.metaState.treeNodes) && sm.metaState.treeNodes.length === 0);
    check('legacyUpgrades is defined immediately (not left undefined until first save)',
        sm.metaState.legacyUpgrades !== undefined);
    check('legacyUpgrades is all-zero for a brand-new player',
        JSON.stringify(sm.metaState.legacyUpgrades) === JSON.stringify({ hp: 0, speed: 0, light: 0, magnet: 0 }),
        JSON.stringify(sm.metaState.legacyUpgrades));
    check('spentLucidity defaults to 0', sm.metaState.spentLucidity === 0);
}

{
    console.log('\n  legacy (pre-Patch-29 save: real upgrade levels, no treeNodes/legacyUpgrades fields)');
    const legacyUpgradesInSave = { hp: 5, speed: 3, light: 2, magnet: 1 };
    global.localStorage = mockLocalStorage({
        fractured_meta: JSON.stringify({
            lucidityBank: 100,
            spentLucidity: 9450, // real invested progress predating the tree
            upgrades: legacyUpgradesInSave
            // no treeNodes, no legacyUpgrades — exactly what a pre-Patch-29 save looks like
        })
    });
    const sm = new SaveManager();

    check('treeNodes back-filled to []', Array.isArray(sm.metaState.treeNodes) && sm.metaState.treeNodes.length === 0);
    check('legacyUpgrades snapshots the REAL prior upgrade levels, not zero',
        JSON.stringify(sm.metaState.legacyUpgrades) === JSON.stringify(legacyUpgradesInSave),
        JSON.stringify(sm.metaState.legacyUpgrades));
    check('spentLucidity is untouched by migration', sm.metaState.spentLucidity === 9450, `got ${sm.metaState.spentLucidity}`);
    check('upgrades (the future derived mirror) is untouched by this patch',
        JSON.stringify(sm.metaState.upgrades) === JSON.stringify(legacyUpgradesInSave));
}

{
    console.log('\n  maxed (already migrated once: legacyUpgrades pre-existing and DIFFERENT from upgrades)');
    // Simulates a save from AFTER 29.4 exists: upgrades has since become a derived
    // mirror that includes tree contributions, so it now differs from the frozen
    // legacyUpgrades snapshot. Re-loading must NOT re-snapshot from upgrades —
    // that would silently erase the distinction and corrupt the future resolver.
    const frozenLegacy = { hp: 5, speed: 3, light: 2, magnet: 1 };
    const derivedMirror = { hp: 11, speed: 3, light: 4, magnet: 3 }; // legacy + tree, hypothetically
    global.localStorage = mockLocalStorage({
        fractured_meta: JSON.stringify({
            spentLucidity: 20000,
            upgrades: derivedMirror,
            legacyUpgrades: frozenLegacy,
            treeNodes: ['R1', 'R2', 'F1']
        })
    });
    const sm = new SaveManager();

    check('treeNodes round-trips unchanged', JSON.stringify(sm.metaState.treeNodes) === JSON.stringify(['R1', 'R2', 'F1']));
    check('legacyUpgrades is NOT re-snapshotted from upgrades (idempotency)',
        JSON.stringify(sm.metaState.legacyUpgrades) === JSON.stringify(frozenLegacy),
        `expected frozen ${JSON.stringify(frozenLegacy)}, got ${JSON.stringify(sm.metaState.legacyUpgrades)}`);
    check('upgrades mirror is left as-is, not collapsed back to legacyUpgrades',
        JSON.stringify(sm.metaState.upgrades) === JSON.stringify(derivedMirror));
}

{
    console.log('\n  importSave() applies the same migration to an old-format export');
    global.localStorage = mockLocalStorage(); // fresh instance, nothing loaded locally
    const sm = new SaveManager();
    const legacyUpgradesInExport = { hp: 8, speed: 0, light: 4, magnet: 2 };
    const oldExport = btoa(JSON.stringify({
        spentLucidity: 5000,
        upgrades: legacyUpgradesInExport
        // no treeNodes, no legacyUpgrades — an export taken before Patch 29
    }));

    const ok = sm.importSave(oldExport);
    check('importSave succeeds on an old-format export', ok === true);
    check('importSave back-fills treeNodes to []', Array.isArray(sm.metaState.treeNodes) && sm.metaState.treeNodes.length === 0);
    check('importSave snapshots legacyUpgrades from the imported real upgrades',
        JSON.stringify(sm.metaState.legacyUpgrades) === JSON.stringify(legacyUpgradesInExport),
        JSON.stringify(sm.metaState.legacyUpgrades));
    check('importSave leaves spentLucidity untouched', sm.metaState.spentLucidity === 5000, `got ${sm.metaState.spentLucidity}`);
}

{
    console.log('\n  importSave() of an ALREADY-migrated export uses its real legacyUpgrades as-is');
    global.localStorage = mockLocalStorage();
    const sm = new SaveManager(); // fresh instance, legacyUpgrades defaults to all-zero
    const realFrozenLegacy = { hp: 5, speed: 3, light: 2, magnet: 1 };
    const newExport = btoa(JSON.stringify({
        spentLucidity: 9450,
        upgrades: { hp: 11, speed: 3, light: 4, magnet: 3 }, // derived mirror, tree-inflated
        legacyUpgrades: realFrozenLegacy,
        treeNodes: ['R1', 'R2']
    }));

    sm.importSave(newExport);
    check('imported legacyUpgrades is used directly, not re-derived from upgrades',
        JSON.stringify(sm.metaState.legacyUpgrades) === JSON.stringify(realFrozenLegacy),
        JSON.stringify(sm.metaState.legacyUpgrades));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
