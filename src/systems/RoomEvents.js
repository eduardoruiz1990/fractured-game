// src/systems/RoomEvents.js
//
// Patch 138 (V2 plan D5): room events — a room that changes its rules partway through.
//
//   POWER OUTAGE   When the room is 40% spent, the lights fail for up to 15 s: no
//                  ambient light, a shorter flashlight. A breaker box appears nearby;
//                  hold the light on it (the BREAKER_BOX interactable that was dormant
//                  in Combat.js since the early patches) and the power comes back, with
//                  the box's repelling field as the reward. The Insomniac (Patch 136,
//                  blackoutImmune) keeps their ambient light.
//   LOCKDOWN       The doors seal at the start: survive 30 s. Arrivals never run out
//                  while it holds. When it lifts, the rest dissolve (no XP: the reward
//                  is the chest that drops at the player's feet).
//   SESSION BELL   When the room is half spent, the bell rings and a whole wave arrives
//                  at once, led by a named elite (Patch 133: elites drop chests).
//
// Rolled only in rooms with no room modifier (ELITE/BLACKOUT/SWARM/HAZARD), so the two
// systems never stack and the modifier roll's distribution is unchanged. Never in the
// tutorial, a boss room, or the first two rooms of floor 1; LOCKDOWN from floor 2.
//
// Plain state on `state` (no pooling needed: one object per room):
//   state.roomEvent = { id, phase: 'pending'|'warn'|'active'|'done', trigger, timer }
//   state.powerOut  = steps of outage left (0 = lights on)   — read by the Renderer
//   state.lockdown  = steps of lockdown left (0 = none)      — read by the HUD

import { promoteToElite, dropChest } from './Elites.js';
import { resolveObstacles } from './Arena.js';
import { isBossType, SPAWN_CLAMP_RADIUS } from '../data/Config.js';

export const EVENT_CHANCE = 0.5;          // of rooms with no modifier (~20% of rooms)
export const OUTAGE_STEPS = 900;          // 15 s
export const LOCKDOWN_STEPS = 1800;       // 30 s
export const LOCKDOWN_WARN_STEPS = 90;    // the doors seal: 1.5 s of warning first
export const BREAKER_DISTANCE = 320;
export const BREAKER_FIELD_RADIUS = 200;

export const ROOM_EVENTS = {
    POWER_OUTAGE: {
        id: 'POWER_OUTAGE', name: 'POWER OUTAGE', minFloor: 1, triggerAt: 0.6,
        desc: 'The lights fail. Find the breaker box and hold your light on it.'
    },
    LOCKDOWN: {
        id: 'LOCKDOWN', name: 'LOCKDOWN', minFloor: 2, triggerAt: 1,
        desc: 'The doors seal. Survive 30 seconds; whatever is left dissolves, and something is left for you.'
    },
    SESSION_BELL: {
        id: 'SESSION_BELL', name: 'SESSION BELL', minFloor: 1, triggerAt: 0.5,
        desc: 'The bell rings. They all arrive at once, and one of them has a name.'
    }
};
export const EVENT_ORDER = ['POWER_OUTAGE', 'LOCKDOWN', 'SESSION_BELL'];

/** The event for a room, or null. */
export function eventForRoom(floor, roomNumber, { isBossRoom = false, isTutorial = false, hasModifier = false, rng = Math.random } = {}) {
    if (isTutorial || isBossRoom || hasModifier) return null;
    if (floor === 1 && roomNumber <= 2) return null;
    if (rng() >= EVENT_CHANCE) return null;
    const pool = EVENT_ORDER.filter(id => ROOM_EVENTS[id].minFloor <= floor);
    return pool[Math.floor(rng() * pool.length) % pool.length] || null;
}

/** Arm an event for the room that is starting (or clear it with id = null). */
export function armRoomEvent(state, id) {
    state.powerOut = 0;
    state.lockdown = 0;
    const E = id ? ROOM_EVENTS[id] : null;
    state.roomEvent = E ? {
        id: E.id, phase: 'pending', timer: 0,
        trigger: E.triggerAt >= 1 ? Infinity : Math.floor((state.enemyBudget || 0) * E.triggerAt)
    } : null;
}

/** Bell wave size: grows with depth, capped. */
export function bellWaveSize(floor) {
    return Math.min(10, 4 + Math.max(1, floor | 0));
}

/** The bell wave's mix, by floor (the floor's own new enemy joins from 2). */
export function bellWaveTypes(floor, n) {
    const extra = floor >= 4 ? 'BURROWER' : floor === 3 ? 'WARDEN' : floor === 2 ? 'SPLITTER' : 'SCAVENGER';
    const cycle = ['PREDATOR', 'SCAVENGER', extra, 'SCAVENGER'];
    const out = [];
    for (let i = 0; i < n; i++) out.push(cycle[i % cycle.length]);
    return out;
}

function announce(game, E, extra = {}) {
    if (typeof game.onRoomEvent === 'function') {
        try { game.onRoomEvent({ id: E.id, name: E.name, desc: E.desc, ...extra }); } catch (e) { console.error(e); }
    }
}

/** A point `dist` from the player, inside the arena and out of any wall. */
function placeNearPlayer(state, dist, rng) {
    const ox = state.mapOriginX || 0, oy = state.mapOriginY || 0;
    // Prefer the bearing toward the arena's centre, so it never lands in the Void.
    const toCentre = Math.atan2(oy - state.player.y, ox - state.player.x);
    const a = toCentre + (rng() * 2 - 1) * 1.2;
    const p = { x: state.player.x + Math.cos(a) * dist, y: state.player.y + Math.sin(a) * dist };
    const d = Math.hypot(p.x - ox, p.y - oy);
    const max = SPAWN_CLAMP_RADIUS - 100;
    if (d > max) { p.x = ox + (p.x - ox) / d * max; p.y = oy + (p.y - oy) / d * max; }
    if (state.obstacles && state.obstacles.length) resolveObstacles(state.obstacles, p, 40);
    return p;
}

/** Remove the regular (non-elite, non-boss) enemies without a kill: the lockdown lifting. */
function dissolveCrowd(game) {
    const state = game.state;
    const pools = game.director && game.director.pools;
    for (let i = state.entities.length - 1; i >= 0; i--) {
        const e = state.entities[i];
        if (!e || isBossType(e.type) || e.elite) continue;
        if (typeof game.spawnParticles === 'function') game.spawnParticles(e.x, e.y, '#9a9aa8', 6);
        e.hp = 0;
        e.active = false;
        const pool = pools && pools[String(e.type || '').toLowerCase()];
        if (pool) pool.release(e);
        state.entities.splice(i, 1);
    }
}

/**
 * Once per sim step while a room is in combat (Director.spawnWave, before spawning):
 * triggers the armed event, runs it, and ends it.
 */
export function tickRoomEvent(game, { rng = Math.random } = {}) {
    const state = game.state;
    const ev = state.roomEvent;
    if (!ev || ev.phase === 'done') return;
    const E = ROOM_EVENTS[ev.id];
    const director = game.director;

    if (ev.phase === 'pending') {
        if (!((state.enemyBudget || 0) <= ev.trigger)) return;
        if (E.id === 'POWER_OUTAGE') {
            ev.phase = 'active';
            state.powerOut = OUTAGE_STEPS;
            const p = placeNearPlayer(state, BREAKER_DISTANCE, rng);
            if (!Array.isArray(state.interactables)) state.interactables = [];
            ev.box = { type: 'BREAKER_BOX', x: p.x, y: p.y, radius: BREAKER_FIELD_RADIUS, charge: 0, active: false, dead: false, life: 0, roomEvent: true };
            state.interactables.push(ev.box);
            state.cameraShake = Math.max(state.cameraShake || 0, 12);
            if (game.audioEngine) game.audioEngine.playSFX('breaker_box', 0.5);
            announce(game, E);
        } else if (E.id === 'LOCKDOWN') {
            ev.phase = 'warn';
            ev.timer = LOCKDOWN_WARN_STEPS;
            state.lockdown = LOCKDOWN_STEPS + LOCKDOWN_WARN_STEPS;
            if (game.audioEngine) game.audioEngine.playSFX('boss_static', 0.5);
            announce(game, E);
        } else if (E.id === 'SESSION_BELL') {
            ev.phase = 'done';
            const types = bellWaveTypes(state.floor, bellWaveSize(state.floor));
            const w = director && Number.isFinite(director.lastViewW) ? director.lastViewW : 1280;
            const h = director && Number.isFinite(director.lastViewH) ? director.lastViewH : 720;
            let first = null, spawned = 0;
            for (const t of types) {
                if (director && typeof director.hasRoomForEnemy === 'function' && !director.hasRoomForEnemy()) break;
                const ent = director && director.spawnEntity(t, w, h);
                if (ent) { spawned++; if (!first) first = ent; }
            }
            if (first && !first.elite) { promoteToElite(first, rng); state.eliteSpawned = true; }
            ev.spawned = spawned;
            state.cameraShake = Math.max(state.cameraShake || 0, 10);
            if (game.audioEngine) game.audioEngine.playSFX('boss_intro', 0.55);
            announce(game, E, { count: spawned });
        }
        return;
    }

    if (E.id === 'POWER_OUTAGE' && ev.phase === 'active') {
        const restored = ev.box && ev.box.active;
        if (state.powerOut > 0) state.powerOut--;
        if (restored || state.powerOut <= 0) {
            state.powerOut = 0;
            ev.phase = 'done';
            ev.restored = !!restored;
            if (!restored && ev.box) ev.box.dead = true;   // the lights came back on their own
            if (typeof game.onRoomEvent === 'function') {
                try { game.onRoomEvent({ id: E.id, name: restored ? 'POWER RESTORED' : 'THE LIGHTS RETURN', desc: restored ? 'The breaker holds them back for a while.' : '', end: true }); } catch (e) { console.error(e); }
            }
        }
        return;
    }

    if (E.id === 'LOCKDOWN') {
        if (state.lockdown > 0) state.lockdown--;
        if (ev.phase === 'warn') {
            if (--ev.timer <= 0) ev.phase = 'active';
            return;
        }
        // While it holds, the arrivals never run out.
        if (state.lockdown > 0) {
            state.enemyBudget = Math.max(state.enemyBudget || 0, 4);
            return;
        }
        ev.phase = 'done';
        state.enemyBudget = 0;
        dissolveCrowd(game);
        const p = placeNearPlayer(state, 90, rng);
        dropChest(state, p.x, p.y);
        state.cameraShake = Math.max(state.cameraShake || 0, 14);
        if (game.audioEngine) game.audioEngine.playSFX('ui_upgrade', 0.8);
        if (typeof game.onRoomEvent === 'function') {
            try { game.onRoomEvent({ id: E.id, name: 'LOCKDOWN LIFTED', desc: 'You held. Something was left for you.', end: true }); } catch (e) { console.error(e); }
        }
    }
}

/** The room has cleared (or is being left): nothing of the event survives it. */
export function endRoomEvent(state) {
    const ev = state.roomEvent;
    if (ev && ev.box && !ev.box.active) ev.box.dead = true;
    state.powerOut = 0;
    state.lockdown = 0;
    if (ev) ev.phase = 'done';
}

/** A short HUD line for the event in progress, or null. */
export function roomEventHud(state) {
    const ev = state.roomEvent;
    if (!ev) return null;
    if (ev.id === 'LOCKDOWN' && state.lockdown > 0) return `LOCKDOWN · SURVIVE ${Math.ceil(state.lockdown / 60)}s`;
    if (ev.id === 'POWER_OUTAGE' && state.powerOut > 0) return 'POWER OUT · FIND THE BREAKER';
    return null;
}
