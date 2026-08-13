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

function freshGame() {
    const g = new Game();
    g.init(mockSave);
    g.saveManager = mockSave;
    return g;
}

// ---------------------------------------------------------------------------
console.log('\nBoss type per floor');

// Patch 93: floors 1-5 are unchanged and MUST stay so. Floor 6 used to assert
// 'ARCHITECT' with the note "5+ all fall through to the Architect" — that was the
// tail of an if/else chain, not a design decision, and THE RECURSION replaces it with
// a real rotation. The five original floors are listed explicitly here precisely so a
// future change to the cycle cannot quietly move them.
const expectedBoss = {
    1: 'BOSS',
    2: 'RORSCHACH',
    3: 'PANOPTICON',
    4: 'AMALGAMATION',
    5: 'ARCHITECT',
    // Cycle II: the five come round again in their original order.
    6: 'BOSS',
    7: 'RORSCHACH',
    8: 'PANOPTICON',
    9: 'AMALGAMATION',
    10: 'ARCHITECT',
    // Cycle III begins.
    11: 'BOSS',
    12: 'RORSCHACH'
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
// Predator feeding cap (Patch 62). Predators kill and absorb nearby Scavengers.
// That gain used to be unbounded, so a slowly-cleared room produced 300-400hp
// Floor 1 enemies — reported from live play as "the last two took forever to kill".
console.log('\nPredator feeding is capped');

{
    const game = freshGame();
    game.state.floor = 1;
    game.state.entities.length = 0;
    // stress is normally set by spawnWave; entities spawned directly need it, or
    // their hp comes out as 45 * undefined = NaN.
    game.state.stress = 1.0;

    // spawnEntity pushes onto state.entities and returns nothing, so read it back.
    game.director.spawnEntity('PREDATOR', 1920, 1080, 0, 0);
    const predator = game.state.entities[game.state.entities.length - 1];
    const base = predator.spawnMaxHp;
    check('a predator records the pool it spawned with', Number.isFinite(base) && base > 0, `got ${base}`);

    // Close enough that the predator prefers the scavenger over the player
    // (it needs d < distToPlayer - 50), but not so far that the leash teleports it.
    game.state.player.x = 300;
    game.state.player.y = 0;

    // Feed it far more scavengers than the cap could ever allow.
    for (let i = 0; i < 60; i++) {
        game.director.spawnEntity('SCAVENGER', 1920, 1080, 0, 0);
        const scav = game.state.entities[game.state.entities.length - 1];
        scav.x = predator.x + 5;
        scav.y = predator.y;
        predator.update(game.state, game);
        // Clear the corpse the way Combat would, so the next one can be eaten.
        game.state.entities = game.state.entities.filter(e => e.hp > 0);
    }

    check('feeding never exceeds 2x the spawn pool',
          predator.hp <= base * 2 + 0.001, `hp ${predator.hp.toFixed(0)} vs cap ${(base * 2).toFixed(0)}`);
    check('feeding still grants something (the mechanic is intact)',
          predator.hp > base, `hp ${predator.hp.toFixed(0)} vs base ${base.toFixed(0)}`);
    check('maxHp tracks the gain, so the health bar never exceeds 100%',
          predator.hp <= predator.maxHp, `hp ${predator.hp.toFixed(0)} > maxHp ${predator.maxHp.toFixed(0)}`);
}

{
    // An ARMORED variant is scaled AFTER init, so its cap must be based on the
    // inflated pool — otherwise the cap sits below its starting hp and it can
    // never feed at all (or worse, gets clamped downward).
    const game = freshGame();
    game.state.floor = 3;
    game.state.entities.length = 0;
    game.state.stress = 1.0;
    game.director.spawnEntity('PREDATOR', 1920, 1080, 0, 0);
    const predator = game.state.entities[game.state.entities.length - 1];
    const preVariant = predator.spawnMaxHp;

    // applyEnemyVariant is chance-gated (20% on floor 3), so the roll is forced
    // rather than scaling the entity by hand — the point of this check is that the
    // REAL function re-stamps spawnMaxHp, which a hand-scaled fake would not test.
    // random() === 0 passes the chance gate and selects ARMORED.
    const realRandom = Math.random;
    Math.random = () => 0;
    try {
        game.director.applyEnemyVariant(predator, game.state);
    } finally {
        Math.random = realRandom;
    }

    check('the forced variant actually scaled the predator up',
          predator.variant === 'ARMORED' && predator.hp > preVariant,
          `variant ${predator.variant}, hp ${predator.hp.toFixed(0)} vs ${preVariant.toFixed(0)}`);
    check('spawnMaxHp is re-stamped after variant scaling, so the feed cap tracks the real pool',
          Math.abs(predator.spawnMaxHp - predator.maxHp) < 0.001 && predator.spawnMaxHp > preVariant,
          `spawnMaxHp ${predator.spawnMaxHp.toFixed(0)} vs maxHp ${predator.maxHp.toFixed(0)}`);
}

// ---------------------------------------------------------------------------
console.log('\nEnemy variants (Patch 78)');
{
    const game = new Game();
    game.init(mockSave);
    game.state.floor = 3;
    game.state.stress = 1.0;

    // applyEnemyVariant draws TWICE: once against the per-floor chance gate (20% on
    // floor 3) and once to pick which variant. A single fixed Math.random cannot do
    // both — anything above 0.20 fails the gate and returns before selecting — so the
    // draws are queued. Spawning happens with real randomness first, because
    // spawnEntity applies its own variant roll and would otherwise contaminate the
    // pre-variant baseline this compares against.
    const forceVariant = (variantRoll) => {
        game.state.entities.length = 0;
        game.director.spawnEntity('SCAVENGER', 1920, 1080, 0, 0);
        const e = game.state.entities[game.state.entities.length - 1];
        // Undo whatever spawnEntity's own roll may have applied, so `base` is a plain
        // enemy in every run of this test rather than in 80% of them.
        e.init(Math.random(), 0, 0, 1.0);
        const base = { hp: e.hp, speed: e.speed, damage: e.damage };

        const realRandom = Math.random;
        const queue = [0, variantRoll];        // [passes the gate, selects the variant]
        Math.random = () => (queue.length ? queue.shift() : 0.5);
        try {
            game.director.applyEnemyVariant(e, game.state);
        } finally { Math.random = realRandom; }
        return { e, base };
    };

    // roll 0 -> ARMORED, 0.5 -> FAST, 0.9 -> VOLATILE (and all pass the chance gate).
    const armored = forceVariant(0);
    check('ARMORED is a genuine wall, not a stat nudge',
          armored.e.variant === 'ARMORED' && armored.e.hp >= armored.base.hp * 3,
          `${armored.base.hp} -> ${armored.e.hp}`);
    check('ARMORED hits harder than its plain counterpart',
          armored.e.damage > armored.base.damage,
          `${armored.base.damage} -> ${armored.e.damage}`);

    const fast = forceVariant(0.5);
    check('FAST is meaningfully faster', fast.e.variant === 'FAST' && fast.e.speed >= fast.base.speed * 2,
          `${fast.base.speed.toFixed(2)} -> ${fast.e.speed.toFixed(2)}`);

    const volatile_ = forceVariant(0.9);
    check('VOLATILE hits hardest of the three',
          volatile_.e.variant === 'VOLATILE' &&
          volatile_.e.damage / volatile_.base.damage > armored.e.damage / armored.base.damage,
          `x${(volatile_.e.damage / volatile_.base.damage).toFixed(2)}`);

    // The pooling trap. `damage` is scaled by the variant, so without initBase
    // restoring baseDamage first, every reuse of a recycled body would multiply an
    // already-multiplied number and enemies would quietly get deadlier all run.
    const ent = armored.e;
    const scaled = ent.damage;
    ent.init(Math.random(), 0, 0, 1.0);
    check('damage resets to base on pool reuse (no compounding across lives)',
          ent.damage === ent.baseDamage && ent.damage < scaled,
          `base ${ent.baseDamage}, after reuse ${ent.damage}, was ${scaled}`);
    check('variant motion timers reset on pool reuse too',
          ent.variantSurge === 0 && Number.isFinite(ent.variantTimer),
          `surge ${ent.variantSurge}, timer ${ent.variantTimer}`);

    // applyVariantMotion runs for every enemy every frame and feeds position directly.
    const state = {
        player: { x: 0, y: 0, angle: 0, radius: 12 },
        entities: [], xpDrops: [], viewHalfExtent: 415, viewSafeRadius: 270
    };
    const moved = forceVariant(0.5).e;
    moved.x = 300; moved.y = 0;
    let finite = true;
    for (let i = 0; i < 600; i++) {
        moved.update(state, null);
        if (!Number.isFinite(moved.x) || !Number.isFinite(moved.y)) { finite = false; break; }
    }
    check('600 frames of variant motion never produces NaN coordinates', finite,
          `${moved.x}, ${moved.y}`);
    check('and it still ends up hunting the player rather than wandering off',
          Math.hypot(moved.x, moved.y) < 300,
          `${Math.hypot(moved.x, moved.y).toFixed(0)}px away`);

    // A plain enemy must be untouched by any of this. Spawned on FLOOR 1, where the
    // variant chance is 0 — spawning on floor 3 gave this a real 20% chance of
    // handing back a variant and failing at random.
    game.state.floor = 1;
    game.state.entities.length = 0;
    game.director.spawnEntity('SCAVENGER', 1920, 1080, 200, 0);
    const plain = game.state.entities[0];
    const beforeV = { x: plain.x, y: plain.y };
    plain.applyVariantMotion();
    check('a non-variant enemy is not perturbed at all',
          !plain.variant && plain.x === beforeV.x && plain.y === beforeV.y);
}

// ---------------------------------------------------------------------------
console.log('\nSpawn ring clears the view (Patch 70)');
{
    // An enemy must never appear inside the visible area. The old radius used canvas
    // pixels against the LARGER axis with no zoom term, which held on a 1080p desktop
    // and failed on every phone — in portrait the ring sat well inside the top and
    // bottom edges, so enemies popped into existence mid-screen.
    //
    // Driven through the real Director.spawnEntity rather than re-deriving the
    // formula here, because the bug was in the formula.
    const viewports = [
        { name: 'desktop 1920x1080', w: 1920, h: 1080, zoom: 1.3 },
        { name: 'desktop 1366x768',  w: 1366, h: 768,  zoom: 1.24 },
        { name: 'phone landscape',   w: 844,  h: 390,  zoom: 0.70 },
        { name: 'phone portrait',    w: 390,  h: 844,  zoom: 0.70 },
        { name: 'tall portrait',     w: 412,  h: 915,  zoom: 0.70 }
    ];

    viewports.forEach(v => {
        const game = new Game();
        game.init(mockSave);
        game.state.floor = 1;
        game.state.stress = 1.0;
        game.state.viewZoom = v.zoom;
        game.state.player.x = 0;
        game.state.player.y = 0;
        // Well inside the room so the 1550px boundary clamp cannot pull a spawn in.
        game.state.mapOriginX = 0;
        game.state.mapOriginY = 0;

        // The furthest point on screen from the player, in world units.
        const cornerDist = Math.hypot((v.w / 2) / v.zoom, (v.h / 2) / v.zoom);

        let worst = Infinity;
        for (let i = 0; i < 200; i++) {
            game.state.entities.length = 0;
            game.director.spawnEntity('SCAVENGER', v.w, v.h);
            const e = game.state.entities[0];
            worst = Math.min(worst, Math.hypot(e.x, e.y));
        }

        check(`${v.name}: every spawn lands off screen`,
              worst > cornerDist,
              `closest spawn ${worst.toFixed(0)}px vs a ${cornerDist.toFixed(0)}px corner`);
    });

    // Desktop pacing must not move: the legacy radius is kept as a floor precisely so
    // this refactor cannot retune the game for players who never had the bug.
    const game = new Game();
    game.init(mockSave);
    game.state.viewZoom = 1.3;
    game.state.player.x = 0; game.state.player.y = 0;
    game.state.mapOriginX = 0; game.state.mapOriginY = 0;
    game.state.stress = 1.0;
    let maxSeen = 0;
    for (let i = 0; i < 200; i++) {
        game.state.entities.length = 0;
        game.director.spawnEntity('SCAVENGER', 1920, 1080);
        maxSeen = Math.max(maxSeen, Math.hypot(game.state.entities[0].x, game.state.entities[0].y));
    }
    check('1080p desktop still spawns on the legacy 1010px ring, unchanged',
          Math.abs(maxSeen - 1010) < 1, `got ${maxSeen.toFixed(1)}px`);
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
