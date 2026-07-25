/**
 * Boss spawn + entity init invariants.
 *
 * Run with:  node test_bosses.js
 *
 * These are logic assertions only — anything visual needs a real canvas, so it is
 * checked in-browser via the dev panel's VISUAL TEST BENCH instead.
 *
 * Guards two regressions in particular:
 *   1. state.activeBoss must resolve on the frame the boss spawns. It previously
 *      did not, because processGameLogic() computes it before spawnWave() runs and
 *      the announcement's 240-frame hitStop early-returns out of update() before it
 *      can catch up — so every boss announced itself as "THE SPHERE HEAD".
 *   2. Scavenger/Predator/Parasite must get a .phase on init (not just in the
 *      constructor), or pooled reuse hands out a recycled phase and the animation
 *      desync silently stops working for respawned enemies.
 */

import { Game } from './src/core/Game.js';

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

function freshGame() {
    const g = new Game();
    g.init(mockSave);
    g.saveManager = mockSave;
    return g;
}

// ---------------------------------------------------------------------------
console.log('\nBoss type per floor');

const expectedBoss = {
    1: 'BOSS',
    2: 'RORSCHACH',
    3: 'PANOPTICON',
    4: 'AMALGAMATION',
    5: 'ARCHITECT',
    6: 'ARCHITECT'   // 5+ all fall through to the Architect
};

for (const [floor, expected] of Object.entries(expectedBoss)) {
    const game = freshGame();
    const f = Number(floor);

    game.state.floor = f;
    game.state.bossSpawned = false;
    game.state.entities.length = 0;

    game.director.spawnRoom(f, game.state.maxRoomsPerFloor);

    const boss = game.state.entities.find(e => e.type === expected);
    check(`floor ${f} spawns ${expected}`, !!boss,
          `got [${game.state.entities.map(e => e.type).join(', ') || 'nothing'}]`);
}

// ---------------------------------------------------------------------------
console.log('\nactiveBoss resolves on the spawn frame (banner dispatch)');

for (const [floor, expected] of Object.entries(expectedBoss)) {
    const game = freshGame();
    const f = Number(floor);

    game.state.floor = f;
    game.state.bossSpawned = false;
    game.state.entities.length = 0;
    game.state.activeBoss = null;

    game.director.spawnRoom(f, game.state.maxRoomsPerFloor);

    // No update() tick in between — this is exactly the frame the announcement
    // reads activeBoss on, while hitStop is suppressing processGameLogic().
    const ab = game.state.activeBoss;
    check(`floor ${f} activeBoss === ${expected}`,
          !!ab && ab.type === expected,
          `activeBoss is ${ab ? ab.type : 'null'}`);
}

// ---------------------------------------------------------------------------
console.log('\nPer-entity animation phase');

{
    const game = freshGame();
    const cases = [
        ['scavenger', p => p.get().init(Math.random(), 0, 0, 1)],
        ['predator',  p => p.get().init(Math.random(), 0, 0, 1)],
        ['parasite',  p => p.get().init(Math.random(), 0, 0)]
    ];

    for (const [name, make] of cases) {
        const pool = game.director.pools[name];

        const ent = make(pool);
        check(`${name}.phase is a finite number on init`,
              Number.isFinite(ent.phase), `phase = ${ent.phase}`);
        check(`${name}.phase is within [0, 2π)`,
              ent.phase >= 0 && ent.phase < Math.PI * 2, `phase = ${ent.phase}`);
        pool.release(ent);

        // Recycle the same pooled objects repeatedly; phases must not all collapse
        // to one value, or every respawned enemy animates in lockstep again.
        const seen = new Set();
        for (let i = 0; i < 24; i++) {
            const e = make(pool);
            seen.add(e.phase);
            pool.release(e);
        }
        check(`${name}.phase is re-rolled on pool reuse`,
              seen.size > 1, `${seen.size} distinct phase(s) across 24 inits`);
    }
}

// ---------------------------------------------------------------------------
console.log('\nBoss spawn is idempotent (no double-spawn per room)');

{
    const game = freshGame();
    game.state.floor = 1;
    game.state.bossSpawned = false;
    game.state.entities.length = 0;

    game.director.spawnRoom(1, game.state.maxRoomsPerFloor);
    game.director.spawnRoom(1, game.state.maxRoomsPerFloor);

    const bosses = game.state.entities.filter(e => e.type === 'BOSS');
    check('calling spawnRoom twice spawns exactly one boss', bosses.length === 1,
          `spawned ${bosses.length}`);
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
