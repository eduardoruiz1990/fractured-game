// src/systems/Elites.js
//
// Patch 133 (V2 plan D4): named elites and the chests they drop.
//
// ELITES. Most rooms after the first now promote ONE of their regular enemies, once
// half the room's budget is spent, into a named elite: larger, much tougher, with a
// name tag and its own health bar. It is the room's mid-fight event — something worth
// turning towards — and it is the only thing that drops a chest.
//
// CHESTS. A chest is an interactable (state.interactables, type 'CHEST'). Walking
// into it starts a short opening beat (the lid rattles, the screen tightens), then it
// bursts and pays out:
//   1. an EVOLUTION, if any weapon qualifies (Patch 134 — see Evolutions.js);
//   2. otherwise 1–3 levels spread over the weapons the player OWNS, through the same
//      level-up table the cards use (applyWeaponLevelUp), so a chest level is exactly a
//      card level;
//   3. if nothing owned can level, Lucidity and Sanity instead.
// The result is handed to game.onChestOpened (main.js) for the DOM notice.
//
// Pure helpers are exported for test_content.js.

import { applyWeaponLevelUp } from '../ui/LevelUpUI.js';
import { MANIFESTATIONS } from '../data/Manifestations.js';
import { weaponLevelCap } from '../core/Endless.js';

export const ELITE_HP_MULT = 6;
export const ELITE_DAMAGE_MULT = 1.35;
export const ELITE_SCALE = 1.45;          // drawn size (Renderer) and hit radius
export const ELITE_RADIUS = 22;
export const CHEST_OPEN_STEPS = 26;       // the anticipation beat before the burst

/** Display names, by the enemy type that was promoted. */
export const ELITE_NAMES = {
    SCAVENGER: ['THE HEAD JANITOR', 'CUSTODIAN ZERO', 'THE NIGHT SHIFT'],
    PREDATOR:  ['THE TRUANT OFFICER', 'HALL MONITOR PRIME', 'THE PREFECT'],
    PARASITE:  ['THE PERMANENT SUBSTITUTE', 'THE GUIDANCE COUNSELOR', 'THE DEPUTY HEAD'],
    // Patch 135's enemies. Listed here so their elites are named from day one.
    SPLITTER:  ['THE CLASS PHOTO', 'THE TWINS'],
    WARDEN:    ['THE FIRE MARSHAL', 'THE ATTENDANCE OFFICER'],
    BURROWER:  ['THE GROUNDSKEEPER', 'THE BOILER MAN']
};

/**
 * Chance that a room gets an elite. Never the tutorial room, never the boss room,
 * never floor 1 room 1 (the first real room a new player sees is plain), and a
 * little more often deeper down.
 */
export function eliteChanceForRoom(floor, roomNumber, isBossRoom, isTutorial) {
    if (isTutorial || isBossRoom) return 0;
    if (floor === 1 && roomNumber <= 1) return 0;
    if (floor === 1) return 0.45;
    return Math.min(0.75, 0.55 + (floor - 2) * 0.05);
}

/** Picks a name for an elite of `type`. `rng` is injectable for tests. */
export function eliteNameFor(type, rng = Math.random) {
    const pool = ELITE_NAMES[type] || ['THE PROCTOR'];
    return pool[Math.floor(rng() * pool.length) % pool.length];
}

/**
 * Promotes a freshly spawned, already-scaled regular enemy in place. Bosses are
 * refused. Enemy.initBase resets `elite`, `eliteName` and the radius, so a pooled
 * body never comes back still promoted.
 */
export function promoteToElite(ent, rng = Math.random) {
    if (!ent || ent.elite) return ent;
    ent.elite = true;
    ent.eliteName = eliteNameFor(ent.type, rng);
    ent.hp *= ELITE_HP_MULT;
    ent.maxHp = ent.hp;
    ent.spawnMaxHp = ent.maxHp;
    ent.damage *= ELITE_DAMAGE_MULT;
    ent.radius = ELITE_RADIUS;
    return ent;
}

/** Drops a chest where an elite died. */
export function dropChest(state, x, y) {
    if (!Array.isArray(state.interactables)) state.interactables = [];
    const chest = { type: 'CHEST', x, y, radius: 26, active: true, dead: false, opening: 0, life: 99999 };
    state.interactables.push(chest);
    return chest;
}

/** How many weapon levels a chest pays: 1 (70%), 2 (25%), 3 (5%). */
export function chestLevelCount(rng = Math.random) {
    const r = rng();
    return r < 0.05 ? 3 : (r < 0.30 ? 2 : 1);
}

/**
 * Resolves a chest's reward against the run state. Pure apart from mutating `state`
 * (weapon levels, lucidity, sanity) — no audio, DOM or particles; Combat and main.js
 * do those from the returned summary.
 *
 * @param {object} state  game.state
 * @param {{rng?:Function, evolve?:Function}} opts
 *        evolve(state) -> {id,name,desc,from}|null  — Patch 134 plugs evolutions in here.
 * @returns {{kind:'evolution'|'levels'|'lucidity', title:string, lines:string[], evolution?:object}}
 */
export function resolveChest(state, opts = {}) {
    const rng = opts.rng || Math.random;
    if (typeof opts.evolve === 'function') {
        const evo = opts.evolve(state);
        if (evo) return { kind: 'evolution', title: evo.name, lines: [evo.desc], evolution: evo };
    }

    const W = state.player.weapons;
    const cap = weaponLevelCap(state.floor);
    const lines = [];
    const n = chestLevelCount(rng);
    for (let i = 0; i < n; i++) {
        const owned = Object.entries(W).filter(([, w]) => w && w.level > 0 && w.level < cap);
        if (!owned.length) break;
        const [id, wep] = owned[Math.floor(rng() * owned.length) % owned.length];
        wep.level++;
        applyWeaponLevelUp(wep, id);
        const name = (MANIFESTATIONS[id] && MANIFESTATIONS[id].name) || id;
        lines.push(`${name} → LVL ${wep.level}`);
    }
    if (lines.length) {
        return { kind: 'levels', title: n > 1 && lines.length > 1 ? `${lines.length} WEAPON LEVELS` : 'WEAPON LEVEL', lines };
    }
    state.lucidity = (state.lucidity || 0) + 100;
    state.sanity = Math.min(state.player.maxHp, state.sanity + 30);
    return { kind: 'lucidity', title: 'HOARDED LUCIDITY', lines: ['+100 Lucidity', '+30 Sanity restored'] };
}
