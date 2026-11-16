// src/systems/Arena.js
//
// Patch 137 (V2 plan D5): room shapes.
//
// Every room used to be the same open disc, so the only thing that changed from room
// to room was the crowd. Each floor now has its own arrangement of the memory's
// furniture, raised around the player when a combat room starts and lowered again the
// moment the room is cleared:
//
//   floor 1  LOCKERS   two broken rows of lockers: a corridor, enemies down both ends
//   floor 2  PILLARS   a mirrored gallery of ink-black posts (the Rorschach's floor)
//   floor 3  YARD      a ring wall with four gates, the arrivals come through the gates
//   floor 4  WARDS     four wards on the diagonals leave a cross of corridors
//   floor 5  BLUEPRINT a grid of blocks the Architect keeps rearranging: blocks sink
//                      and others rise (each rise is telegraphed, and never on the player)
//
// The Recursion cycles them with the biomes (paletteIndexForFloor).
//
// Rules that keep this from changing anything it should not:
//   - Never in the tutorial, never in a boss room, never on floor 1 room 1, and only in
//     SHAPED_ROOM_CHANCE of the other rooms, so open rooms stay common.
//   - Obstacles exist only while the room is in combat. The clear lowers them (a short
//     fade with collision already off), so reward doors, the exit elevator and the
//     post-room walk are never blocked.
//   - They block bodies only: the player and regular enemies. Bosses are never in a
//     shaped room; a burrowed Crawlspace travels under them; weapons, projectiles and
//     XP pass through (they are memories, not physics, and this keeps every weapon's
//     behaviour unchanged).
//   - The layout is centred on the player when the room starts, with a clear radius of
//     at least CLEAR_RADIUS, so nobody starts inside a wall.
//   - Data-driven spawning: a layout may name spawn SECTORS (world bearings from the
//     player). Director.spawnEntity prefers them, so enemies come down the corridor or
//     through the gates. With no sectors the angle is drawn exactly as before (one
//     Math.random call), so open rooms keep their old spawn sequence.
//
// Pure module: no DOM, no canvas. Plain objects, built once per room (a few dozen at
// most), so nothing here is pooled.

import { paletteIndexForFloor } from '../core/Endless.js';
import { isBossType } from '../data/Config.js';

export const SHAPED_ROOM_CHANCE = 0.7;
export const CLEAR_RADIUS = 150;
export const ARENA_RISE_STEPS = 30;
export const ARENA_FADE_STEPS = 40;
/** BLUEPRINT: how often the Architect rearranges, and how long a rise is telegraphed. */
export const GRID_SHIFT_STEPS = 300;
export const GRID_TELEGRAPH_STEPS = 75;
export const GRID_SHIFT_COUNT = 3;

const TAU = Math.PI * 2;

// --- layout data --------------------------------------------------------------------
// Coordinates are relative to the room origin (the player's position at room start).
//   block: axis-aligned box, centre (x, y), half sizes (hw, hh)
//   post:  circle, centre (x, y), radius r
//   arc:   ring wall around the origin, radius r, thickness w, from a0 to a1 (radians)

function lockers() {
    const s = [];
    for (const y of [-150, 150]) {
        for (const x of [-550, -260, 260, 550]) s.push({ kind: 'block', x, y, hw: 115, hh: 20 });
    }
    return s;
}

function pillars() {
    const s = [];
    const half = [[220, -180], [220, 180], [430, 0], [520, -330], [520, 330]];
    for (const [x, y] of half) { s.push({ kind: 'post', x, y, r: 38 }); s.push({ kind: 'post', x: -x, y, r: 38 }); }
    s.push({ kind: 'post', x: 0, y: -390, r: 44 });
    s.push({ kind: 'post', x: 0, y: 390, r: 44 });
    return s;
}

const GATE = 0.24;
function yard() {
    const s = [];
    for (let q = 0; q < 4; q++) {
        const a0 = q * Math.PI / 2 + GATE, a1 = (q + 1) * Math.PI / 2 - GATE;
        s.push({ kind: 'arc', x: 0, y: 0, r: 430, w: 36, a0, a1 });
        // Round caps at both ends, so nothing snags on a square corner.
        for (const a of [a0, a1]) s.push({ kind: 'post', x: Math.cos(a) * 430, y: Math.sin(a) * 430, r: 18, cap: true });
    }
    return s;
}

function wards() {
    const s = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) s.push({ kind: 'block', x: sx * 330, y: sy * 330, hw: 165, hh: 165 });
    return s;
}

function blueprint() {
    const s = [];
    for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
            if (i === 0 && j === 0) continue;
            // The inner ring starts sunk, so the player is not boxed in at the start.
            const inner = Math.abs(i) <= 1 && Math.abs(j) <= 1;
            s.push({ kind: 'block', x: i * 290, y: j * 290, hw: 62, hh: 62, grid: true, solid: !inner });
        }
    }
    return s;
}

const Q = Math.PI / 2;
export const ARENA_LAYOUTS = {
    LOCKERS:   { id: 'LOCKERS',   name: 'LOCKER CORRIDOR', build: lockers,   style: 'locker',
                 spawn: [[0, 0.32], [Math.PI, 0.32]] },
    PILLARS:   { id: 'PILLARS',   name: 'INKBLOT GALLERY', build: pillars,   style: 'ink',    spawn: null },
    YARD:      { id: 'YARD',      name: 'THE YARD',        build: yard,      style: 'brick',
                 spawn: [[0, 0.16], [Q, 0.16], [Math.PI, 0.16], [3 * Q, 0.16]] },
    WARDS:     { id: 'WARDS',     name: 'THE WARD WINGS',  build: wards,     style: 'ward',
                 spawn: [[0, 0.2], [Q, 0.2], [Math.PI, 0.2], [3 * Q, 0.2]] },
    BLUEPRINT: { id: 'BLUEPRINT', name: 'THE BLUEPRINT',   build: blueprint, style: 'blueprint', spawn: null, shifting: true }
};

/** One shape per biome, in floor order; the Recursion cycles them. */
export const FLOOR_LAYOUTS = ['LOCKERS', 'PILLARS', 'YARD', 'WARDS', 'BLUEPRINT'];

/** The layout for a room, or null for an open room. */
export function layoutForRoom(floor, roomNumber, { isBossRoom = false, isTutorial = false, rng = Math.random } = {}) {
    if (isTutorial || isBossRoom) return null;
    if (floor === 1 && roomNumber <= 1) return null;
    if (rng() >= SHAPED_ROOM_CHANCE) return null;
    return FLOOR_LAYOUTS[paletteIndexForFloor(floor)] || null;
}

/** World-space obstacles for a layout around (ox, oy). */
export function buildObstacles(layoutId, ox, oy) {
    const L = ARENA_LAYOUTS[layoutId];
    if (!L) return [];
    return L.build().map(o => ({
        ...o, x: ox + o.x, y: oy + o.y,
        solid: o.solid !== false, telegraph: 0, phase: Math.random() * TAU
    }));
}

/** Raise a layout for the room (or clear the room's shape when id is null). */
export function raiseArena(state, layoutId, ox, oy) {
    const L = layoutId ? ARENA_LAYOUTS[layoutId] : null;
    state.arenaLayout = L ? L.id : null;
    state.obstacles = L ? buildObstacles(L.id, ox, oy) : [];
    state.arenaOrigin = L ? { x: ox, y: oy } : null;
    state.spawnSectors = L && L.spawn ? L.spawn : null;
    state.arenaRise = L ? ARENA_RISE_STEPS : 0;
    state.arenaFade = 0;
    state.arenaShiftTimer = 0;
}

/** The room is cleared: collision off now, the shapes fade, then they are gone. */
export function lowerArena(state) {
    if (!state.obstacles || !state.obstacles.length || state.arenaFade > 0) return;
    state.arenaFade = ARENA_FADE_STEPS;
    state.spawnSectors = null;
}

export function arenaSolid(state) {
    return !!(state.obstacles && state.obstacles.length && !(state.arenaFade > 0));
}

/**
 * Push a circle (obj.x, obj.y, radius) out of one obstacle. Returns true if moved.
 * Only `solid` obstacles collide.
 */
export function pushOutOf(o, obj, radius) {
    if (!o.solid) return false;
    if (o.kind === 'post') {
        const dx = obj.x - o.x, dy = obj.y - o.y;
        const min = o.r + radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) return false;
        const d = Math.sqrt(d2);
        if (d < 1e-6) { obj.x = o.x + min; return true; }
        obj.x = o.x + dx / d * min;
        obj.y = o.y + dy / d * min;
        return true;
    }
    if (o.kind === 'block') {
        const cx = Math.max(o.x - o.hw, Math.min(obj.x, o.x + o.hw));
        const cy = Math.max(o.y - o.hh, Math.min(obj.y, o.y + o.hh));
        const dx = obj.x - cx, dy = obj.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= radius * radius) return false;
        if (d2 > 1e-6) {
            const d = Math.sqrt(d2);
            obj.x = cx + dx / d * radius;
            obj.y = cy + dy / d * radius;
            return true;
        }
        // The centre is inside the box: leave by the shortest way out.
        const left = obj.x - (o.x - o.hw), right = (o.x + o.hw) - obj.x;
        const top = obj.y - (o.y - o.hh), bottom = (o.y + o.hh) - obj.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) obj.x = o.x - o.hw - radius;
        else if (m === right) obj.x = o.x + o.hw + radius;
        else if (m === top) obj.y = o.y - o.hh - radius;
        else obj.y = o.y + o.hh + radius;
        return true;
    }
    if (o.kind === 'arc') {
        const dx = obj.x - o.x, dy = obj.y - o.y;
        const d = Math.hypot(dx, dy);
        const half = o.w / 2 + radius;
        if (Math.abs(d - o.r) >= half || d < 1e-6) return false;
        let a = Math.atan2(dy, dx) - o.a0;
        a = ((a % TAU) + TAU) % TAU;
        if (a > o.a1 - o.a0) return false;
        const target = d < o.r ? o.r - half : o.r + half;
        obj.x = o.x + dx / d * target;
        obj.y = o.y + dy / d * target;
        return true;
    }
    return false;
}

/** Push a circle out of every solid obstacle (two passes settle corners). */
export function resolveObstacles(obstacles, obj, radius) {
    if (!obstacles || !obstacles.length || !obj) return false;
    let moved = false;
    for (let pass = 0; pass < 2; pass++) {
        let any = false;
        for (let i = 0; i < obstacles.length; i++) {
            if (pushOutOf(obstacles[i], obj, radius)) any = true;
        }
        if (!any) break;
        moved = true;
    }
    return moved;
}

/** Whether a circle overlaps an obstacle's footprint (solid or not). */
export function overlaps(o, x, y, radius) {
    const probe = { x, y };
    const was = o.solid;
    o.solid = true;
    const hit = pushOutOf(o, probe, radius);
    o.solid = was;
    return hit;
}

/**
 * The spawn bearing for an off-screen ring spawn. With sectors: a random sector, then
 * a random offset inside it. Without: exactly one Math.random call, as before.
 */
export function spawnAngle(state, rng = Math.random) {
    const s = state && state.spawnSectors;
    if (!s || !s.length) return rng() * TAU;
    const [c, hw] = s[Math.floor(rng() * s.length) % s.length];
    return c + (rng() * 2 - 1) * hw;
}

/** Whether an entity is held by the room's walls. */
function blocksEntity(ent) {
    if (!ent || ent.dead) return false;
    if (isBossType(ent.type)) return false;
    if (ent.type === 'BURROWER' && ent.burrowState !== 'exposed' && ent.burrowState !== 'warning') return false;
    return true;
}

/**
 * Once per sim step, after movement: rise/fade timers, the BLUEPRINT's rearranging,
 * and pushing the player and regular enemies out of the walls.
 */
export function updateArena(state, rng = Math.random) {
    if (!state.obstacles || !state.obstacles.length) return;
    if (state.arenaRise > 0) state.arenaRise--;
    if (state.arenaFade > 0) {
        state.arenaFade--;
        if (state.arenaFade <= 0) {
            state.obstacles.length = 0;
            state.arenaLayout = null;
            state.arenaOrigin = null;
        }
        return;
    }

    const L = ARENA_LAYOUTS[state.arenaLayout];
    const p = state.player;
    const pr = p.radius || 15;
    if (L && L.shifting) {
        state.arenaShiftTimer = (state.arenaShiftTimer || 0) + 1;
        if (state.arenaShiftTimer >= GRID_SHIFT_STEPS) {
            state.arenaShiftTimer = 0;
            const solid = state.obstacles.filter(o => o.grid && o.solid);
            const sunk = state.obstacles.filter(o => o.grid && !o.solid && !o.telegraph);
            for (let k = 0; k < GRID_SHIFT_COUNT; k++) {
                if (solid.length) solid.splice(Math.floor(rng() * solid.length), 1)[0].solid = false;
                if (sunk.length) sunk.splice(Math.floor(rng() * sunk.length), 1)[0].telegraph = GRID_TELEGRAPH_STEPS;
            }
        }
        for (const o of state.obstacles) {
            if (!o.telegraph) continue;
            // A block never rises on the player: it waits until they step off.
            if (o.telegraph > 1 || !overlaps(o, p.x, p.y, pr)) o.telegraph--;
            if (o.telegraph === 0) o.solid = true;
        }
    }

    resolveObstacles(state.obstacles, p, pr);
    const ents = state.entities;
    for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        if (blocksEntity(e)) resolveObstacles(state.obstacles, e, e.radius || 12);
    }
}
