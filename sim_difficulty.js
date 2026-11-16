/**
 * Difficulty measurement (V2 difficulty pass). Not a pass/fail suite: it PRINTS how a
 * scripted player fares, so a balance change can be judged by numbers, run to run.
 *
 *   node sim_difficulty.js [--runs 12] [--skill novice|competent|statue|anchored|both]
 *                          [--profile fresh,returning,veteran] [--floors 5] [--seed 7] [--json]
 *                          [--detail] [--sources] [--ttk] [--stuck] [--pressure '{"3":{"hp":1.6}}']
 *
 *   --detail    rooms 1-4 per floor: damage, healing, minutes, level-ups, mean enemies alive
 *   --sources   damage the player took, by floor, regular room (r) or boss room (B), attacker
 *   --ttk       each regular enemy type's mean lifetime and spawn HP, per floor
 *   --pressure  overrides rows of src/data/Difficulty.js for this run only
 *
 * Each run is a real, seeded game through Game/Director/Combat and the real LevelUpUI
 * card roll and selectCard (against a fake DOM): tutorial skipped, floor 1 room 1, every
 * room fought, doors walked into, the boss killed, DESCEND taken, until death or the
 * floor limit. The bot:
 *   - lets aim assist aim (it is on by default for touch, the larger audience);
 *   - steers away from every enemy within its awareness radius (weighted by 1/d^2),
 *     circles to kite, and stays inside the arena;
 *   - picks up XP when nothing is close, then walks to a door / the exit / a chest;
 *   - dashes when an enemy is about to touch it (competent only);
 *   - picks level-up cards at random (novice) or prefers weapons, then boons (competent).
 * "novice" is deliberately weak: small awareness, sluggish steering, no dash. If the
 * novice clears floors 1-3 comfortably, the early game is too easy for real players.
 *
 * Profiles (Synapse Tree nodes owned, cheapest first): "fresh" none; "returning" the
 * first 12 (5,200 Lucidity — a few hours); "veteran" the first 20 (21,200).
 */

import { Game } from './src/core/Game.js';
import { SaveManager } from './src/core/SaveManager.js';
import { LevelUpUI } from './src/ui/LevelUpUI.js';
import { SYNAPSE_NODES } from './src/data/SynapseNodes.js';
import { bossTelegraphing } from './src/core/Haptics.js';
import { FLOOR_PRESSURE } from './src/data/Difficulty.js';
// Experiments: --pressure '{"2":{"orbHeal":2},"3":{"damage":1.2}}' overrides rows of the table.
{
    const i = process.argv.indexOf('--pressure');
    if (i >= 0) for (const [f, row] of Object.entries(JSON.parse(process.argv[i + 1]))) Object.assign(FLOOR_PRESSURE[+f], row);
}

const BOSS_TYPES = new Set(['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT']);
// Synapse Tree purchases, cheapest first (each tier's gate is the tier below, so the
// cheapest-first order is always legal for the first 20).
const NODES_BY_COST = [...SYNAPSE_NODES].sort((a, b) => a.cost - b.cost).map(n => n.id);
const PROFILE_NODES = { fresh: 0, returning: 12, veteran: 20 };

// --- a DOM that accepts anything --------------------------------------------------------
function fakeEl() {
    const store = { style: {}, dataset: {}, children: [] };
    const classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
    return new Proxy(store, {
        get(t, k) {
            if (k in t) return t[k];
            if (k === 'classList') return classList;
            if (k === 'querySelectorAll' || k === 'getElementsByClassName') return () => [];
            if (k === 'getBoundingClientRect') return () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
            if (k === 'getContext') return () => makeCtx();
            if (k === Symbol.toPrimitive) return () => '';
            return (..._a) => fakeEl();
        },
        set(t, k, v) { t[k] = v; return true; }
    });
}
function makeCtx() {
    const noop = () => {};
    return new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === 'createRadialGradient' || k === 'createLinearGradient') ? () => ({ addColorStop: noop }) : noop), set: (t, k, v) => { t[k] = v; return true; } });
}
global.CustomEvent = class { constructor(type, o = {}) { this.type = type; this.detail = o.detail; } };
global.document = {
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    getElementById: () => fakeEl(), querySelector: () => fakeEl(), querySelectorAll: () => [],
    createElement: () => { const e = fakeEl(); e.width = 1200; e.height = 1200; return e; },
    body: fakeEl(), documentElement: fakeEl()
};
global.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 720 };
const mem = {};
global.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
global.setTimeout = global.setTimeout; global.performance = global.performance || { now: () => Date.now() };

// --- args ---------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const RUNS = Number(arg('runs', 12));
const FLOORS = Number(arg('floors', 5));
const SEED = Number(arg('seed', 7));
const SKILLS = arg('skill', 'both') === 'both' ? ['novice', 'competent'] : [arg('skill')];
const PROFILES = arg('profile', 'all') === 'all' ? ['fresh', 'returning', 'veteran'] : arg('profile').split(',');
const JSON_OUT = argv.includes('--json');
const VIEW_W = 1280, VIEW_H = 720;
const MAX_STEPS_PER_FLOOR = 60 * 60 * 8;   // 8 sim-minutes: a stuck bot ends the run

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// standoff: the distance (as a share of the flashlight's reach) the bot tries to keep;
// it only backs off from enemies closer than that, so they stay inside its light.
const SKILL = {
    novice:    { standoff: 0.45, steer: 0.3, dash: false, kite: 0.4, dodge: false, pick: 'random' },
    competent: { standoff: 0.8,  steer: 0.9, dash: true,  kite: 0.9, dodge: true,  pick: 'weapons' },
    statue:    { standoff: 0,    steer: 0,   dash: false, kite: 0,   dodge: false, pick: 'weapons' },  // sanity check: never moves, never touches
    anchored:  { standoff: 0,    steer: 0,   dash: false, kite: 0,   dodge: false, pick: 'weapons', hold: true }   // Patch 164: never moves, thumb resting on the stick
};

function botInput(state, skill, mem) {
    const p = state.player;
    const fl = p.weapons && p.weapons.flashlight;
    const reach = (fl && Number.isFinite(fl.radius)) ? fl.radius : 250;
    const pref = reach * skill.standoff;
    let fx = 0, fy = 0, nearest = Infinity, near = 0, cx = 0, cy = 0, dodge = null;
    for (const e of state.entities) {
        if (!e || e.dead || e.hp <= 0 || e.burrowed) continue;
        const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
        if (d < nearest) nearest = d;
        const boss = BOSS_TYPES.has(e.type);
        const keep = boss ? pref + (e.radius || 60) : pref;
        if (d < keep) { const w = (keep - d) / keep * (boss ? 2 : 1); fx += dx / d * w; fy += dy / d * w; }
        if (d < reach + 150) { near++; cx += dx / d; cy += dy / d; }
        if (skill.dodge && boss && bossTelegraphing(e)) dodge = { x: -dy / d, y: dx / d };   // sidestep the wind-up
    }
    const threatened = fx !== 0 || fy !== 0 || near > 0;
    let tx = 0, ty = 0;
    if (threatened) {
        tx = fx * 2; ty = fy * 2;
        // circle the crowd so it stays in the light and the bot is not backed into a wall
        const cm = Math.hypot(cx, cy) || 1;
        tx += (-cy / cm) * skill.kite * mem.spin; ty += (cx / cm) * skill.kite * mem.spin;
        if (dodge) { tx += dodge.x * 2.5 * mem.spin; ty += dodge.y * 2.5 * mem.spin; }
    }
    mem.goingOut = false;
    if (!threatened || (fx === 0 && fy === 0 && !dodge && near < 3)) {
        // goals: XP orb, then chest / door / exit, else drift to the room centre
        let goal = null, gd = Infinity;
        const ox0 = state.mapOriginX || 0, oy0 = state.mapOriginY || 0;
        for (const o of state.xpDrops || []) {
            if (Math.hypot(o.x - ox0, o.y - oy0) > 1500) continue;   // out by the Void: not worth it
            const d = Math.hypot(o.x - p.x, o.y - p.y); if (d < gd && d < 700) { gd = d; goal = o; }
        }
        if (!goal) for (const o of state.interactables || []) {
            if (o.dead || !(o.type === 'CHEST' || o.type === 'ROOM_DOOR' || o.type === 'EXIT_ELEVATOR' || o.type === 'CASE_PAGE')) continue;
            const d = Math.hypot(o.x - p.x, o.y - p.y); if (d < gd) { gd = d; goal = o; }
        }
        mem.goingOut = !!goal;
        if (goal) { const gm = Math.hypot(goal.x - p.x, goal.y - p.y) || 1; tx += (goal.x - p.x) / gm; ty += (goal.y - p.y) / gm; }
        else { tx = (state.mapOriginX || 0) - p.x; ty = (state.mapOriginY || 0) - p.y; if (Math.hypot(tx, ty) < 80) { tx = Math.cos(mem.wander); ty = Math.sin(mem.wander); mem.wander += 0.02; } }
    }
    // stay off the arena edge — except on the way to a door or the exit, which sit out there
    const ox = (state.mapOriginX || 0) - p.x, oy = (state.mapOriginY || 0) - p.y, od = Math.hypot(ox, oy);
    // (doors are placed around wherever the room was cleared, so they can sit out there)
    if (od > 1450 && !mem.goingOut) { tx += ox / od * 2; ty += oy / od * 2; }   // the Void starts at 1600
    // sluggish steering for the novice
    const m = Math.hypot(tx, ty) || 1;
    mem.mx += (tx / m - mem.mx) * skill.steer; mem.my += (ty / m - mem.my) * skill.steer;
    const mm = Math.hypot(mem.mx, mem.my);
    const moving = mm > 0.05;
    const dash = skill.dash && nearest < 70 && p.dash && p.dash.charges > 0 && !p.dash.active;
    return {
        moveX: moving ? mem.mx / mm : 0, moveY: moving ? mem.my / mm : 0, isMoving: moving,
        aimAngle: Math.atan2(-mem.my, -mem.mx), aimHeld: false,
        isDashing: dash, dashPulse: false,
        touchHeld: !!skill.hold || moving   // Patch 164: a moving bot has a thumb on the stick
    };
}

function pickCard(ui, skill, rnd) {
    const ch = ui.currentChoices || [];
    if (!ch.length) return null;
    if (skill.pick === 'random') return ch[Math.floor(rnd() * ch.length)];
    return ch.find(c => c.type === 'weapon' && c.isNew) || ch.find(c => c.type === 'weapon') || ch[0];
}

function runOne(seed, skillName, profile) {
    Math.random = mulberry32(seed);
    for (const k of Object.keys(mem)) delete mem[k];
    const sm = new SaveManager();
    sm.metaState.tutorialCompleted = true;
    sm.metaState.treeNodes = NODES_BY_COST.slice(0, PROFILE_NODES[profile] || 0);
    const game = new Game();
    // The constructor reads import.meta.env (Vite-only); build the same object without it.
    const ui = Object.create(LevelUpUI.prototype);
    Object.assign(ui, { modal: fakeEl(), container: fakeEl(), btnReroll: null, audioEngine: null, saveManager: sm });
    const skill = SKILL[skillName];
    const rnd = mulberry32(seed ^ 0x9e3779b9);
    const bot = { mx: 0, my: 0, spin: rnd() < 0.5 ? 1 : -1, wander: rnd() * 6 };
    const out = { seed, skill: skillName, profile, floors: [], died: false, deathFloor: null, deathRoom: null, levelUps: 0, steps: 0 };
    let floorDone = false, dead = false;
    game.onDeath = () => { dead = true; };
    game.onFloorComplete = () => { floorDone = true; };
    game.onLevelUp = () => {
        out.levelUps++;
        ui.show(game, () => {});
        const c = pickCard(ui, skill, rnd);
        if (c) ui.selectCard(c, game, () => {});
    };
    game.autoAimOn = true;
    if (argv.includes('--sources')) {
        const orig = game.takeDamage.bind(game);
        game.takeDamage = (amt, src) => {
            const before = game.state.sanity;
            orig(amt, src);
            const k = `f${game.state.floor}${game.state.roomNumber < (game.state.maxRoomsPerFloor || 5) ? 'r' : 'B'} ${src}${game.state.activeBoss ? '(boss up)' : ''}`;
            SOURCES[k] = (SOURCES[k] || 0) + (before - game.state.sanity);
        };
    }
    game.init(sm);
    const place = () => { game.state.player.x = VIEW_W / 2; game.state.player.y = VIEW_H / 2; game.state.mapOriginX = game.state.player.x; game.state.mapOriginY = game.state.player.y; };
    place();
    game.state.isTutorial = false;

    for (let floor = 1; floor <= FLOORS; floor++) {
        const f = { floor, steps: 0, low: game.state.sanity, lowRegular: game.state.sanity, maxHp: game.state.player.maxHp, startSanity: game.state.sanity, roomsCleared: 0, damage: 0, regDamage: 0, regHeal: 0, regSteps: 0, lvl0: out.levelUps };
        let lastRoom = game.state.roomNumber;
        floorDone = false;
        let s0 = game.state.sanity;
        while (!floorDone && !dead && f.steps < MAX_STEPS_PER_FLOOR) {
            game.state.viewZoom = 1;
            game.update(botInput(game.state, skill, bot), VIEW_W, VIEW_H, 'PLAYING');
            f.steps++;
            const sn = game.state.sanity;
            if (sn < s0) f.damage += s0 - sn;
            if (TTK && game.state.roomNumber < (game.state.maxRoomsPerFloor || 5)) {
                const seen = new Set();
                for (const e of game.state.entities) {
                    seen.add(e);
                    if (!ttkBorn.has(e)) ttkBorn.set(e, { t: f.steps, hp0: e.maxHp, type: e.type });
                }
                for (const [e, b] of ttkBorn) if (!seen.has(e)) {
                    const k = `f${floor} ${b.type}`;
                    const r = TTK[k] || (TTK[k] = { n: 0, life: 0, hp0: 0, deadHp: 0 });
                    r.n++; r.life += f.steps - b.t; r.hp0 += b.hp0; if (e.hp <= 0) r.deadHp++;
                    ttkBorn.delete(e);
                }
            }
            if (game.state.roomNumber < (game.state.maxRoomsPerFloor || 5)) {
                f.regSteps++;
                f.regAlive = (f.regAlive || 0) + game.state.entities.length;
                if (sn < s0) f.regDamage += s0 - sn; else f.regHeal += sn - s0;
            }
            s0 = sn;
            if (sn < f.low) f.low = sn;
            if (sn < f.lowRegular && game.state.roomNumber < (game.state.maxRoomsPerFloor || 5)) f.lowRegular = sn;
            if (game.state.roomNumber !== lastRoom) { f.roomsCleared++; lastRoom = game.state.roomNumber; }
        }
        f.lowPct = Math.round(100 * Math.max(0, f.low) / f.maxHp);
        f.lowRegPct = Math.round(100 * Math.max(0, f.lowRegular) / f.maxHp);
        f.minutes = +(f.steps / 3600).toFixed(1);
        f.levelUps = out.levelUps - f.lvl0;
        f.level = game.state.level || game.state.playerLevel || null;
        out.floors.push(f);
        out.steps += f.steps;
        if (dead) { out.died = true; out.deathFloor = floor; out.deathRoom = game.state.roomNumber; out.killedBy = game.state.lastDamageSource; break; }
        if (!floorDone) {
            const st = game.state, pl = st.player;
            out.stuck = floor;
            out.stuckInfo = { room: st.roomNumber, entities: st.entities.filter(e => !e.dead && e.hp > 0).length, types: [...new Set(st.entities.filter(e => !e.dead && e.hp > 0).map(e => e.type))].join(','),
                inter: (st.interactables || []).filter(o => !o.dead).map(o => o.type).join(','), budget: st.enemyBudget, cleared: st.roomCleared, arena: st.arena && st.arena.shape,
                dist: Math.round(Math.hypot(pl.x - (st.mapOriginX || 0), pl.y - (st.mapOriginY || 0))), sanity: Math.round(st.sanity),
                origin: [Math.round(st.mapOriginX), Math.round(st.mapOriginY)], player: [Math.round(pl.x), Math.round(pl.y)],
                doors: (st.interactables || []).filter(o => !o.dead && (o.type === 'ROOM_DOOR' || o.type === 'EXIT_ELEVATOR')).map(o => [Math.round(o.x), Math.round(o.y), o.radius, Math.round(Math.hypot(o.x - pl.x, o.y - pl.y))]),
                arenaKeys: st.arena ? Object.keys(st.arena).join(',') : null };
            break;
        }
        if (floor < FLOORS) {
            const carry = game.getCarriedState();
            carry.floor += 1; carry.roomNumber = 1;
            game.init(sm, carry);
            place();
            game.state.isTutorial = false;
        }
    }
    return out;
}

const SOURCES = {};
const TTK = argv.includes('--ttk') ? {} : null;
const ttkBorn = new Map();
const results = [];
for (const profile of PROFILES) for (const skill of SKILLS) {
    const rows = [];
    for (let r = 0; r < RUNS; r++) rows.push(runOne(SEED * 1000 + r, skill, profile));
    results.push(...rows);
    const died = rows.filter(r => r.died);
    const byFloor = {};
    rows.forEach(r => { if (r.died) { const k = `${r.deathFloor}-${r.deathRoom}`; byFloor[k] = (byFloor[k] || 0) + 1; } });
    const causes = {};
    died.forEach(r => { causes[r.killedBy] = (causes[r.killedBy] || 0) + 1; });
    const lows = f => rows.map(r => r.floors[f - 1]).filter(Boolean);
    console.log(`\n== ${profile} (maxHp ${rows[0].floors[0] && rows[0].floors[0].maxHp}) / ${skill}: ${rows.length} runs, ${died.length} died (floor-room ${JSON.stringify(byFloor)}; by ${JSON.stringify(causes)}), ${rows.filter(r => r.stuck).length} stuck, cleared all ${FLOORS}: ${rows.filter(r => !r.died && !r.stuck).length}`);
    for (let fl = 1; fl <= FLOORS; fl++) {
        const fs = lows(fl);
        if (!fs.length) break;
        const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
        console.log(`   floor ${fl}: reached ${String(fs.length).padStart(2)}  rooms 1-4 low median ${String(med(fs.map(f => f.lowRegPct))).padStart(3)}% (min ${String(Math.min(...fs.map(f => f.lowRegPct))).padStart(3)}%)  whole floor low median ${med(fs.map(f => f.lowPct))}%  damage taken median ${Math.round(med(fs.map(f => f.damage)))} / maxHp ${fs[0].maxHp}  minutes median ${med(fs.map(f => f.minutes))}`);
        if (argv.includes('--detail')) console.log(`            rooms 1-4: damage ${Math.round(med(fs.map(f => f.regDamage)))}  healed ${Math.round(med(fs.map(f => f.regHeal)))}  minutes ${(med(fs.map(f => f.regSteps)) / 3600).toFixed(1)}  level-ups (floor) ${med(fs.map(f => f.levelUps))}  alive mean ${med(fs.map(f => (f.regAlive || 0) / Math.max(1, f.regSteps))).toFixed(1)}`);
    }
}
if (argv.includes('--stuck')) results.filter(r => r.stuck).forEach(r => console.log('stuck', r.profile, r.skill, 'floor', r.stuck, JSON.stringify(r.stuckInfo)));
if (argv.includes('--sources')) console.log(Object.entries(SOURCES).sort().map(([k, v]) => `${k}: ${Math.round(v)}`).join('\n'));
if (TTK) console.log(Object.entries(TTK).sort().map(([k, r]) => `${k}: n ${r.n}  life ${(r.life / r.n / 60).toFixed(1)}s  maxHp ${Math.round(r.hp0 / r.n)}  hp<=0 ${Math.round(100 * r.deadHp / r.n)}%`).join('\n'));
if (JSON_OUT) console.log(JSON.stringify(results));
