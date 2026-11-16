/**
 * Patch 137 (V2 plan D5): room shapes and spawn sectors.
 *
 * Run with:  node test_arena.js   (assertion-based, exits 1 on failure)
 *
 * Covers src/systems/Arena.js directly (layout choice, collision for each shape kind,
 * the clear radius, spawn sectors, the clear-time fade, the Blueprint's rearranging)
 * and the Director/Game seams (spawnRoom raises it, the clear lowers it, a ring spawn
 * never lands in a wall, the player and enemies are pushed out each step).
 */

import {
    ARENA_LAYOUTS, FLOOR_LAYOUTS, SHAPED_ROOM_CHANCE, CLEAR_RADIUS, ARENA_FADE_STEPS,
    GRID_SHIFT_STEPS, GRID_TELEGRAPH_STEPS,
    layoutForRoom, buildObstacles, raiseArena, lowerArena, arenaSolid, pushOutOf,
    resolveObstacles, overlaps, spawnAngle, updateArena
} from './src/systems/Arena.js';

global.CustomEvent = class CustomEvent { constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; } };
global.document = {
    addEventListener: () => {}, dispatchEvent: () => {}, getElementById: () => null,
    createElement: () => ({ width: 1920, height: 1080, getContext: () => new Proxy({}, { get: () => () => ({ addColorStop: () => {}, data: [] }) }) })
};
global.window = { addEventListener: () => {} };
global.localStorage = { getItem: () => null, setItem: () => {} };

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.log('FAIL ' + m); } };

// A seeded rng, so the fuzz below is repeatable.
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// --- layout choice --------------------------------------------------------------
ok(layoutForRoom(2, 2, { isTutorial: true, rng: () => 0 }) === null, 'never in the tutorial');
ok(layoutForRoom(2, 5, { isBossRoom: true, rng: () => 0 }) === null, 'never in a boss room');
ok(layoutForRoom(1, 1, { rng: () => 0 }) === null, 'never on floor 1 room 1');
ok(layoutForRoom(3, 2, { rng: () => 0.999 }) === null, 'an open room past SHAPED_ROOM_CHANCE');
ok(layoutForRoom(3, 2, { rng: () => SHAPED_ROOM_CHANCE - 0.01 }) === 'YARD', 'a shaped room under the chance');
const expect = ['LOCKERS', 'PILLARS', 'YARD', 'WARDS', 'BLUEPRINT'];
for (let f = 1; f <= 10; f++) {
    ok(layoutForRoom(f, 2, { rng: () => 0 }) === expect[(f - 1) % 5], `floor ${f} uses ${expect[(f - 1) % 5]}`);
}
ok(FLOOR_LAYOUTS.every(id => ARENA_LAYOUTS[id]), 'every floor layout exists');

// --- shapes ---------------------------------------------------------------------
for (const id of Object.keys(ARENA_LAYOUTS)) {
    const obs = buildObstacles(id, 1000, -500);
    ok(obs.length > 0 && obs.length <= 40, `${id}: ${obs.length} obstacles`);
    ok(obs.every(o => !overlaps(o, 1000, -500, CLEAR_RADIUS)), `${id}: nothing inside the ${CLEAR_RADIUS}px clear radius`);
    ok(obs.every(o => ['block', 'post', 'arc'].includes(o.kind) && Number.isFinite(o.x) && Number.isFinite(o.y)), `${id}: well-formed`);
    // Fuzz: wherever a body starts, after resolving it is out of every solid wall.
    const rng = mulberry(id.length * 97);
    let stuck = 0;
    for (let i = 0; i < 3000; i++) {
        const b = { x: 1000 + (rng() * 2 - 1) * 900, y: -500 + (rng() * 2 - 1) * 900 };
        resolveObstacles(obs, b, 15);
        if (obs.some(o => o.solid && overlaps(o, b.x, b.y, 14.9))) stuck++;
        if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) stuck++;
    }
    ok(stuck === 0, `${id}: 3000 random bodies all resolve out of the walls (${stuck} stuck)`);
}

// Each kind pushes to its surface.
{
    const post = { kind: 'post', x: 0, y: 0, r: 40, solid: true };
    const b = { x: 10, y: 0 }; pushOutOf(post, b, 15);
    ok(Math.abs(Math.hypot(b.x, b.y) - 55) < 1e-6, 'post: pushed to r + radius');
    const block = { kind: 'block', x: 0, y: 0, hw: 50, hh: 20, solid: true };
    const c = { x: 5, y: 15 }; pushOutOf(block, c, 10);
    ok(c.y === 30 && c.x === 5, `block: centre inside leaves by the nearest face (${c.x},${c.y})`);
    const d = { x: 60, y: 0 }; pushOutOf(block, d, 15);
    ok(Math.abs(d.x - 65) < 1e-6, 'block: outside the face, pushed to radius');
    const arc = { kind: 'arc', x: 0, y: 0, r: 430, w: 36, a0: 0.24, a1: Math.PI / 2 - 0.24, solid: true };
    const e = { x: Math.cos(0.7) * 420, y: Math.sin(0.7) * 420 }; pushOutOf(arc, e, 15);
    ok(Math.abs(Math.hypot(e.x, e.y) - (430 - 18 - 15)) < 1e-6, 'arc: inside the ring, pushed inward');
    const g = { x: 425, y: 0 }; ok(!pushOutOf(arc, g, 15), 'arc: the gate is open');
    const sunk = { kind: 'block', x: 0, y: 0, hw: 50, hh: 50, solid: false };
    ok(!pushOutOf(sunk, { x: 0, y: 0 }, 10), 'a sunk block does not collide');
}

// The Yard: walking out through a gate is never blocked, between gates it is.
{
    const obs = buildObstacles('YARD', 0, 0);
    for (const gate of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
        const b = { x: 0, y: 0 };
        let blocked = false;
        for (let r = 0; r < 600; r += 3) {
            b.x = Math.cos(gate) * r; b.y = Math.sin(gate) * r;
            if (resolveObstacles(obs, b, 15)) blocked = true;
        }
        ok(!blocked, `the Yard's gate at ${gate.toFixed(2)} is walkable`);
    }
    const b = { x: 0, y: 0 };
    for (let k = 0; k < 200; k++) { b.x += Math.cos(Math.PI / 4) * 3; b.y += Math.sin(Math.PI / 4) * 3; resolveObstacles(obs, b, 15); }
    ok(Math.hypot(b.x, b.y) < 430, 'between the gates the wall holds');
}

// --- spawn sectors --------------------------------------------------------------
{
    let calls = 0;
    const rng = () => { calls++; return 0.25; };
    const a = spawnAngle({ spawnSectors: null }, rng);
    ok(calls === 1 && Math.abs(a - Math.PI / 2) < 1e-9, 'no sectors: exactly one rng call, the same angle as before');
    const st = { spawnSectors: ARENA_LAYOUTS.LOCKERS.spawn };
    const r2 = mulberry(5);
    let inside = true;
    for (let i = 0; i < 500; i++) {
        let x = spawnAngle(st, r2);
        x = Math.atan2(Math.sin(x), Math.cos(x));
        const nearE = Math.abs(x) <= 0.32 + 1e-9, nearW = Math.abs(Math.abs(x) - Math.PI) <= 0.32 + 1e-9;
        if (!nearE && !nearW) inside = false;
    }
    ok(inside, 'LOCKERS: every spawn bearing is down one of the corridor ends');
}

// --- raise / lower / update -----------------------------------------------------
{
    const st = { player: { x: 0, y: 0, radius: 15 }, entities: [] };
    raiseArena(st, 'LOCKERS', 0, 0);
    ok(st.arenaLayout === 'LOCKERS' && st.obstacles.length === 8 && st.spawnSectors && arenaSolid(st), 'raised: 8 lockers, spawn sectors set');
    // A body walked into a locker row is pushed back out by updateArena.
    st.player.y = -150; st.player.x = 260;
    const enemy = { type: 'SCAVENGER', x: -260, y: 150, radius: 12 };
    const boss = { type: 'BOSS', x: 550, y: 150, radius: 60 };
    const burrowed = { type: 'BURROWER', x: -550, y: -150, radius: 14, burrowState: 'burrowed' };
    st.entities.push(enemy, boss, burrowed);
    updateArena(st);
    ok(Math.abs(st.player.y + 150) >= 20 + 15 - 1e-6, `the player is pushed out of the lockers (${st.player.y})`);
    ok(Math.abs(enemy.y - 150) >= 20 + 12 - 1e-6, 'a regular enemy is pushed out');
    ok(boss.x === 550 && boss.y === 150, 'a boss is never moved');
    ok(burrowed.x === -550 && burrowed.y === -150, 'a burrowed Crawlspace passes under');
    lowerArena(st);
    ok(!arenaSolid(st) && st.spawnSectors === null, 'lowered: collision off at once, spawn sectors cleared');
    const p0 = { ...st.player };
    st.player.y = -150; st.player.x = 260;
    updateArena(st);
    ok(st.player.y === -150, 'a fading wall does not push');
    for (let i = 0; i < ARENA_FADE_STEPS; i++) updateArena(st);
    ok(st.obstacles.length === 0 && st.arenaLayout === null, 'after the fade the walls are gone');
    raiseArena(st, null);
    ok(st.obstacles.length === 0 && !st.spawnSectors, 'an open room has no walls');
}

// --- the Blueprint rearranges, telegraphs, and never rises on the player ---------
{
    const st = { player: { x: 0, y: 0, radius: 15 }, entities: [] };
    raiseArena(st, 'BLUEPRINT', 0, 0);
    const solid0 = st.obstacles.filter(o => o.solid).length;
    ok(solid0 === 16, `the Blueprint starts with the outer 16 blocks up (${solid0})`);
    const rng = mulberry(11);
    for (let i = 0; i < GRID_SHIFT_STEPS; i++) updateArena(st, rng);
    const tele = st.obstacles.filter(o => o.telegraph > 0);
    ok(tele.length === 3 && st.obstacles.filter(o => o.solid).length === 13, `a shift sinks 3 and telegraphs 3 (${tele.length})`);
    // Stand on one of the telegraphed blocks: it waits.
    const t = tele[0];
    st.player.x = t.x; st.player.y = t.y;
    for (let i = 0; i < GRID_TELEGRAPH_STEPS + 30; i++) { updateArena(st, rng); st.player.x = t.x; st.player.y = t.y; }
    ok(!t.solid && t.telegraph === 1, 'a block never rises under the player');
    st.player.x = 0; st.player.y = 0;
    updateArena(st, rng);
    ok(t.solid, 'it rises once they step off');
    ok(tele.slice(1).every(o => o.solid), 'the other telegraphed blocks rose on time');
}

// --- Director / Game seams ------------------------------------------------------
{
    const { Game } = await import('./src/core/Game.js');
    const meta = { upgrades: { hp: 0, speed: 0, light: 0, magnet: 0 }, killCounts: {}, inventory: [], equippedTokens: {},
                   selectedCurses: [], maxFloorReached: 1, tutorialCompleted: true };
    const g = new Game();
    g.init({ metaState: meta, saveGame: () => {} });
    const s = g.state;
    s.floor = 3; s.stress = 1;
    s.mapOriginX = 0; s.mapOriginY = 0; s.player.x = 0; s.player.y = 0;
    s.viewHalfW = 400; s.viewHalfH = 300; s.viewZoom = 1;
    const real = Math.random;
    Math.random = () => 0.05;
    g.director.spawnRoom(3, 2);
    Math.random = real;
    ok(s.arenaLayout === 'YARD' && s.obstacles.length === 12, `spawnRoom raised the Yard (${s.arenaLayout}, ${s.obstacles.length})`);
    let inWall = 0;
    for (let i = 0; i < 60; i++) {
        const e = g.director.spawnEntity('SCAVENGER', 800, 600);
        if (e && s.obstacles.some(o => o.solid && overlaps(o, e.x, e.y, (e.radius || 12) - 0.1))) inWall++;
    }
    ok(inWall === 0, 'no ring spawn lands in a wall');
    s.player.x = Math.cos(Math.PI / 4) * 430; s.player.y = Math.sin(Math.PI / 4) * 430;
    g.update({ moveX: 0, moveY: 0, isMoving: false, aimAngle: 0 }, 800, 600, 'PLAYING');
    ok(!s.obstacles.some(o => o.solid && overlaps(o, s.player.x, s.player.y, (s.player.radius || 15) - 0.1)), 'Game.update pushes the player out of the ring');
    for (const e of s.entities) g.director.pools.scavenger.release(e);
    s.entities.length = 0;
    s.enemyBudget = 0;
    g.director.spawnWave(800, 600);
    ok(s.roomCleared && !arenaSolid(s), 'the room clear lowers the walls');
    const doors = s.interactables.filter(o => o.type === 'ROOM_DOOR');
    ok(doors.length === 2, 'and the reward doors appear');
    Math.random = () => 0.05;
    g.director.spawnRoom(3, 5);
    Math.random = real;
    ok(s.arenaLayout === null && s.obstacles.length === 0, 'the boss room is open');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
