/**
 * Headless run fuzzer.
 *
 * Run with:  node test_fuzz_runs.js
 * Options (env vars):
 *   FUZZ_RUNS=500            how many runs to simulate (default 200)
 *   FUZZ_SEED=1337           base seed (default 1337)
 *   FUZZ_ONLY_SEED=123456    replay exactly one seed (for reproducing a reported failure)
 *
 * WHAT THIS DOES. Drives Game/Director/Combat/SaveManager directly — no canvas, no
 * DOM rendering, no InputManager — through N randomized "runs": a random floor,
 * room, meta-progression (Synapse Tree nodes, tokens, curses, legacy upgrade
 * levels), weapon levels, boon picks, and entity/effect load, then ticks
 * `game.update()` for a random number of frames with randomized input, occasional
 * direct damage, and occasional extra spawns mid-run.
 *
 * After every tick it asserts, all lifted directly from the golden rules in
 * CLAUDE.md / EXECUTION_HANDOFF.md or from Director's own documented contracts:
 *   1. Every numeric field that would eventually feed a Canvas 2D call (positions,
 *      radii, angles, gradient-adjacent scales) is Number.isFinite. Renderer.js
 *      itself never runs here, but if a NaN/Infinity is already sitting in
 *      `game.state` there is no path that keeps it from reaching `arc()` /
 *      `createRadialGradient()` once a real frame draws it.
 *   2. No pooled object (Director.pools.*) is ever simultaneously "live" in its
 *      state array AND sitting in its pool's free list, and no pool's free list
 *      holds the same reference twice — the two ways of violating "never
 *      array.splice() a pooled entity without pool.release() first".
 *   3. No entity spawned via the normal off-screen ring (Director.spawnEntity with
 *      no forced position) lands inside the drawn viewport rectangle, and none
 *      lands outside the 1550px world-boundary disc. Checked with the player
 *      deliberately displaced from the map origin (see "player displaced from map
 *      origin" below), not just at (0,0) — see instrumentSpawnPlacement for why
 *      that displacement is the entire bug.
 *   4. No entity or the player ever drifts further than a generous 50,000px from
 *      the map origin — a runaway-position guard for "large but still technically
 *      finite" bugs that Number.isFinite alone can't catch.
 *
 * REPRODUCIBILITY. Every run seeds Math.random() with a plain LCG (mulberry32)
 * BEFORE making any random choices — including the game's own internal
 * Math.random() calls (enemy variant rolls, spawn angles, particle scatter, ...).
 * So the entire run, fuzzer decisions and game internals alike, is a pure function
 * of one integer seed. A failure logs that seed; replay it with FUZZ_ONLY_SEED.
 *
 * SPAWN PLACEMENT — FIXED, AND THIS IS THE REGRESSION GUARD.
 *
 * Check 3 above used to fail on ~37% of runs. The world clamp did not CAP distance,
 * it radially PROJECTED the spawn onto the r=1550 circle centred on the map origin.
 * The player stands inside that circle at distance d, so the nearest point the
 * projection could produce was (1550 - d) away from them: a harmless 1550px at d=0,
 * but 50px by d=1500 and ~6px at the boundary. Nothing stops a player reaching those
 * distances — the Void at 1600px is a Sanity drain, not a wall, and the player is
 * never position-clamped during PLAYING — so enemies materialised in plain sight,
 * on every viewport including plain 1080p.
 *
 * It was invisible at d=0 on every device, which is exactly why test_bosses.js's
 * origin-pinned spawn-ring test never caught it. THAT is the thing to preserve here:
 * if this fuzzer is ever changed so the player only ever sits at the map origin, it
 * stops testing the case the bug lived in. See "player displaced from map origin".
 *
 * Director.spawnEntity now CHOOSES an angle satisfying both constraints (inside the
 * arena, outside the visible rectangle) instead of projecting between them, and
 * Director publishes state.viewHalfW/viewHalfH so a caller passing stand-in
 * dimensions can no longer redefine what counts as visible — which is what the
 * boss's old hardcoded 2000x2000 pseudo-viewport was doing.
 *
 * COVERAGE GAP (see the printed report at the end): this cannot exercise
 * Renderer.js, any DOM/UIManager/LevelUpUI/GuideUI/SynapseTree rendering,
 * InputManager's real listeners, or AudioEngine — none of those are constructed
 * or called here. Boon/weapon "instant apply" mutations are reproduced locally
 * (mirroring LevelUpUI.selectCard, which is DOM-coupled) rather than driven
 * through the real UI class; test_content.js / manual play are what actually
 * proves the card text.
 */

import { Game } from './src/core/Game.js';
import { SaveManager } from './src/core/SaveManager.js';
import { BOONS } from './src/ui/LevelUpUI.js';
import {
    TOKENS, TOKEN_SETS, TOKEN_SLOT_TYPES, TOKEN_RARITIES,
    INTRUSIVE_THOUGHTS, PLAYER_WEAPON_IDS, MANIFESTATIONS, getActiveSynergies
} from './src/data/Manifestations.js';
import { SYNAPSE_NODES } from './src/data/SynapseNodes.js';
// Imported to drive the REAL zoom/portrait derivation rather than re-deriving it —
// see DEVICE_PROFILES below. Renderer is imported for updateZoom only; it is never
// constructed here (its constructor needs a live canvas).
import { Renderer } from './src/core/Renderer.js';
import { isPortraitLayout } from './src/core/Layout.js';
import { SPAWN_CLAMP_RADIUS as WORLD_CLAMP_RADIUS } from './src/data/Config.js';

// ---------------------------------------------------------------------------
// Mocks — same shape as test_bosses.js. HubWorld's constructor draws a cached
// floor to an off-screen canvas (CLAUDE.md's "cache static backgrounds" rule),
// so the 2D context stub needs everything generateFloor() calls, not just the
// combat-adjacent subset.
global.CustomEvent = class CustomEvent {
    constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
};

function makeCtx() {
    return {
        fillStyle: '', fillRect: () => {}, strokeStyle: '', lineWidth: 0,
        beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
        ellipse: () => {}, fill: () => {}, createPattern: () => {}, createImageData: () => ({ data: [] }),
        putImageData: () => {}, createRadialGradient: () => ({ addColorStop: () => {} }),
        createLinearGradient: () => ({ addColorStop: () => {} }), arc: () => {},
        translate: () => {}, scale: () => {}, rotate: () => {}, restore: () => {}, save: () => {},
        clip: () => {}, rect: () => {}, closePath: () => {}, roundRect: () => {}, strokeRect: () => {}
    };
}

global.document = {
    addEventListener: () => {},
    dispatchEvent: () => {},
    getElementById: () => null,
    createElement: () => ({ width: 1920, height: 1080, getContext: () => makeCtx() })
};
global.window = { addEventListener: () => {} };
global.localStorage = { getItem: () => null, setItem: () => {} };

// ---------------------------------------------------------------------------
// Seeded RNG. Every run points global Math.random at a fresh mulberry32 stream
// BEFORE making any choice, so both our own randomization and every internal
// Math.random() call in Game/Director/Combat/entities draw from one deterministic
// sequence keyed only by the seed.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min, max) { return Math.random() * (max - min) + min; }
function choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function chance(p) { return Math.random() < p; }
function subset(arr, { min = 0, max = arr.length } = {}) {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, randInt(min, Math.min(max, arr.length)));
}

// ---------------------------------------------------------------------------
// Device profiles.
//
// zoom is NOT a free variable — Renderer.updateZoom DERIVES it from the canvas size
// (fit = min(w/900, worldViewHeight/620), clamped to 0.70-1.3, or 0.58 in portrait),
// and main.js publishes exactly that pair every frame: `state.viewZoom = renderer.zoom`
// alongside `viewW/viewH = renderer.worldViewWidth/worldViewHeight`. An earlier version
// of this fuzzer drew viewport and zoom INDEPENDENTLY, which manufactured combinations
// no device can produce (a 3440x1440 canvas at zoom 0.70 — that canvas always yields
// 1.3) and inflated the failure count with unreachable states.
//
// resolveViewport calls the REAL updateZoom rather than re-deriving the formula here.
// It only touches `this.canvas` and `this.portraitMode`, so a bare object is a
// sufficient receiver — no Renderer construction, no canvas, and no mirror to drift.
// portraitMode comes from the real isPortraitLayout predicate for the same reason.
const DEVICE_PROFILES = [
    { name: 'desktop-1080p',   w: 1920, h: 1080, touch: false },
    { name: 'desktop-768p',    w: 1366, h: 768,  touch: false },
    { name: 'qhd-1440p',       w: 2560, h: 1440, touch: false },
    { name: 'ultrawide',       w: 3440, h: 1440, touch: false },
    { name: 'uhd-4k',          w: 3840, h: 2160, touch: false },
    { name: 'phone-portrait',  w: 390,  h: 844,  touch: true  },
    { name: 'tall-portrait',   w: 412,  h: 915,  touch: true  },
    { name: 'phone-landscape', w: 844,  h: 390,  touch: true  },
    { name: 'tablet-portrait', w: 820,  h: 1180, touch: true  },
    { name: 'tiny',            w: 200,  h: 200,  touch: false }
];

function resolveViewport(profile) {
    const receiver = {
        canvas: { width: profile.w, height: profile.h },
        portraitMode: isPortraitLayout({ touch: profile.touch, width: profile.w, height: profile.h })
    };
    Renderer.prototype.updateZoom.call(receiver);
    return {
        name: profile.name,
        zoom: receiver.zoom,
        // main.js passes the WORLD view (canvas minus the portrait thumb band), not
        // the raw canvas — see its Patch 71 note. Matching that is the whole point.
        viewW: receiver.worldViewWidth,
        viewH: receiver.worldViewHeight,
        portraitMode: receiver.portraitMode
    };
}

function buildTemplateWeapons() {
    return {
        flashlight: { level: 1, damage: 15, radius: 250, angle: 0.6, type: 'cone', tags: ['light', 'focus'] },
        static: { level: 0, damage: 5, radius: 100, active: false, pulsePhase: 0, tags: ['aura', 'tech'] },
        polaroid_camera: { level: 0, damage: 30, radius: 300, angle: Math.PI / 3, cooldown: 180, timer: 0, tags: ['burst', 'light'] },
        fidget_spinner: { level: 0, damage: 8, baseRadius: 60, speed: 0.1, tags: ['orbit', 'kinetic'] },
        lead_pipe: { level: 0, damage: 45, radius: 70, cooldown: 90, timer: 0, tags: ['melee', 'kinetic'] },
        spilled_ink: { level: 0, damage: 10, radius: 45, dropRate: 45, timer: 0, tags: ['hazard', 'dark'] },
        broken_chalk: { level: 0, radius: 60, duration: 300, cooldown: 600, timer: 0, tags: ['utility', 'focus'] },
        corrosive_battery: { level: 0, damage: 2, duration: 180, tags: ['passive', 'tech'] }
    };
}

const WEAPON_LEVEL_DELTA = {
    flashlight: w => { w.damage += 5; w.radius += 20; w.angle += 0.05; },
    static: w => { w.damage += 3; w.radius += 15; w.active = true; },
    lead_pipe: w => { w.damage += 20; w.radius += 15; w.cooldown = Math.max(30, w.cooldown - 10); },
    spilled_ink: w => { w.damage += 3; w.radius += 10; w.dropRate = Math.max(10, w.dropRate - 5); },
    corrosive_battery: w => { w.damage += 5; w.duration += 30; },
    broken_chalk: w => { w.radius += 15; w.duration += 30; w.cooldown = Math.max(60, w.cooldown - 15); },
    polaroid_camera: w => { w.damage += 20; w.radius += 40; w.cooldown = Math.max(90, w.cooldown - 30); },
    fidget_spinner: w => { w.damage += 5; w.baseRadius += 10; w.speed += 0.02; }
};

function setWeaponToLevel(wep, id, targetLevel) {
    if (!wep) return;
    const template = buildTemplateWeapons()[id];
    Object.assign(wep, JSON.parse(JSON.stringify(template)));
    const startLevel = id === 'flashlight' ? 1 : 0;
    const delta = WEAPON_LEVEL_DELTA[id];
    for (let l = startLevel; l < targetLevel; l++) { if (delta) delta(wep); }
    wep.level = targetLevel;
}

const BOON_INSTANT_EFFECTS = {
    tunnel_vision: (w) => { w.flashlight.angle /= 2; w.flashlight.damage *= 2; },
    iron_will: (w, game) => { game.state.player.maxHp += 50; game.state.sanity += 50; },
    lead_shoes: (w, game) => { game.state.player.maxHp += 200; game.state.sanity += 200; },
    steady_hands: (w) => {
        ['lead_pipe', 'broken_chalk', 'polaroid_camera'].forEach(id => {
            if (w[id] && w[id].cooldown) w[id].cooldown = Math.max(20, Math.floor(w[id].cooldown * 0.8));
        });
    },
    wide_lens: (w) => { w.flashlight.radius *= 1.4; w.flashlight.damage *= 0.9; },
    overcharge: (w) => { w.static.radius *= 1.5; w.static.damage *= 1.3; },
    heavy_swing: (w) => { w.lead_pipe.damage *= 1.6; w.lead_pipe.cooldown = Math.floor(w.lead_pipe.cooldown * 1.2); },
    ink_flood: (w) => { w.spilled_ink.radius *= 1.5; w.spilled_ink.dropRate = Math.max(8, Math.floor(w.spilled_ink.dropRate * 0.5)); },
    sharpened_blades: (w) => { w.fidget_spinner.damage *= 1.5; w.fidget_spinner.baseRadius += 20; },
    long_exposure: (w) => { w.polaroid_camera.radius *= 1.5; w.polaroid_camera.cooldown = Math.max(60, Math.floor(w.polaroid_camera.cooldown * 0.75)); },
    chalk_dust: (w) => { w.broken_chalk.radius *= 1.3; w.broken_chalk.duration = Math.floor(w.broken_chalk.duration * 1.5); }
};

function applyBoon(game, boonId) {
    if (game.state.player.boons.includes(boonId)) return;
    game.state.player.boons.push(boonId);
    const fx = BOON_INSTANT_EFFECTS[boonId];
    if (fx) fx(game.state.player.weapons, game);
}

function organicLevelUp(game) {
    const w = game.state.player.weapons;
    const upgradeable = Object.entries(w).filter(([, wep]) => wep.level < 5);
    if (upgradeable.length > 0 && chance(0.5)) {
        const [id, wep] = choice(upgradeable);
        setWeaponToLevel(wep, id, wep.level + 1);
    } else {
        const available = BOONS.map(b => b.id).filter(id => !game.state.player.boons.includes(id));
        if (available.length) applyBoon(game, choice(available));
        else {
            game.state.player.maxHp += 50;
            game.state.sanity = Math.min(game.state.player.maxHp, game.state.sanity + 50);
        }
    }
    game.state.player.synergies = getActiveSynergies(w);
}

function summarizeSets(equipped, inventory) {
    const counts = {};
    Object.values(equipped).forEach(uid => {
        if (!uid) return;
        const item = inventory.find(i => i.uid === uid);
        const set = item && TOKENS[item.id] && TOKENS[item.id].set;
        if (set) counts[set] = (counts[set] || 0) + 1;
    });
    return counts;
}

// ---------------------------------------------------------------------------
// Assertions
class FuzzAssertionError extends Error {
    constructor(message, category = 'unknown') {
        super(message);
        this.category = category;
    }
}

// Fields checked on state.viewZoom are deliberately EXCLUDED here: viewZoom is
// fuzzed with garbage (0, negative, NaN) on purpose to exercise Director's own
// `Number.isFinite(state.viewZoom) && state.viewZoom > 0` fallback — asserting
// it stays finite would just be re-flagging our own injected input. What must
// stay finite is what Director DERIVES from it (viewHalfExtent/viewSafeRadius).
function checkFiniteFields(prefix, obj, fields, violations) {
    if (!obj) return;
    for (const f of fields) {
        const v = obj[f];
        if (v === undefined || v === null) continue;
        if (typeof v === 'number' && !Number.isFinite(v)) {
            violations.push(`${prefix}.${f} = ${v}`);
        }
    }
}

function checkStateFinite(game) {
    const s = game.state;
    const violations = [];
    const p = s.player;

    checkFiniteFields('player', p, [
        'x', 'y', 'angle', 'radius', 'speed', 'maxHp', 'breathPhase', 'flashTime',
        'iframes', 'iframeDuration', 'hitIndicatorTime', 'vacRadiusBonusPx',
        'denialRechargeTimer', 'lastHitAngle'
    ], violations);
    checkFiniteFields('player.dash', p.dash, ['dx', 'dy', 'timer', 'cooldown', 'duration', 'baseCooldown', 'charges', 'maxCharges'], violations);

    for (const [id, w] of Object.entries(p.weapons || {})) {
        checkFiniteFields(`weapon.${id}`, w, ['level', 'damage', 'radius', 'baseRadius', 'angle', 'cooldown', 'timer', 'duration', 'dropRate', 'speed'], violations);
    }

    checkFiniteFields('state', s, [
        'sanity', 'cameraShake', 'cameraFlash', 'hitStop', 'frame', 'convergence',
        'maxConvergence', 'lucidity', 'xp', 'nextLevelXP', 'level', 'roomNumber',
        'floor', 'mapOriginX', 'mapOriginY', 'viewHalfExtent', 'viewSafeRadius',
        'enemyBudget', 'budgetTimer', 'lucidityBonusMultiplier'
    ], violations);

    s.entities.forEach((e, i) => checkFiniteFields(`entities[${i}](${e.type})`, e, [
        'x', 'y', 'vx', 'vy', 'hp', 'maxHp', 'spawnMaxHp', 'speed', 'baseSpeed',
        'damage', 'baseDamage', 'radius', 'phase', 'variantPhase', 'variantTimer',
        'variantSurge', 'knockbackX', 'knockbackY', 'flashTime', 'confused',
        'acidTime', 'acidDmg', 'painCooldown', 'strayTime', 'generation'
    ], violations));

    s.projectiles.forEach((x, i) => checkFiniteFields(`projectiles[${i}]`, x, ['x', 'y', 'vx', 'vy', 'radius', 'damage', 'life'], violations));
    s.particles.forEach((x, i) => checkFiniteFields(`particles[${i}]`, x, ['x', 'y', 'vx', 'vy', 'size', 'rot', 'spin', 'life'], violations));
    s.xpDrops.forEach((x, i) => checkFiniteFields(`xpDrops[${i}]`, x, ['x', 'y', 'value'], violations));
    (s.tokenDrops || []).forEach((x, i) => checkFiniteFields(`tokenDrops[${i}]`, x, ['x', 'y'], violations));
    s.damageTexts.forEach((x, i) => checkFiniteFields(`damageTexts[${i}]`, x, ['x', 'y', 'scale', 'life'], violations));
    s.inkPuddles.forEach((x, i) => checkFiniteFields(`inkPuddles[${i}]`, x, ['x', 'y', 'radius', 'damage', 'life'], violations));
    s.meleeSwings.forEach((x, i) => checkFiniteFields(`meleeSwings[${i}]`, x, ['x', 'y', 'radius', 'maxRadius', 'life'], violations));
    s.safeZones.forEach((x, i) => checkFiniteFields(`safeZones[${i}]`, x, ['x', 'y', 'radius', 'life', 'maxLife'], violations));
    s.interactables.forEach((x, i) => checkFiniteFields(`interactables[${i}]`, x, ['x', 'y', 'radius', 'charge', 'life'], violations));
    (s.playerAfterimages || []).forEach((x, i) => checkFiniteFields(`playerAfterimages[${i}]`, x, ['x', 'y', 'angle', 'life'], violations));

    if (violations.length) {
        throw new FuzzAssertionError(`non-finite value(s) that would feed Canvas math: ${violations.slice(0, 8).join('; ')}${violations.length > 8 ? ` (+${violations.length - 8} more)` : ''}`, 'non-finite');
    }
}

const ARRAY_FIELDS = ['entities', 'projectiles', 'particles', 'xpDrops', 'tokenDrops', 'damageTexts', 'inkPuddles', 'meleeSwings', 'safeZones', 'interactables', 'playerAfterimages'];

function checkNoHoles(game) {
    const s = game.state;
    for (const name of ARRAY_FIELDS) {
        const arr = s[name];
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
            if (arr[i] == null) throw new FuzzAssertionError(`state.${name}[${i}] is null/undefined — array-bounds/splice corruption`, 'array-hole');
        }
    }
}

// Imported, not mirrored: Director and this test now read the same constant, so the
// two can no longer disagree about where the arena ends.

// Generous headroom, not a real game boundary: legitimate per-frame movement (dash,
// leash catch-up, knockback) tops out in the low hundreds of px/frame, so tens of
// thousands of px over a couple hundred frames already means something is runaway
// (an accidental force multiplier, a leash pulling the wrong direction, etc.) rather
// than normal play. Catches "large but technically finite" bugs that Number.isFinite
// alone would miss.
const RUNAWAY_BOUND = 50000;

/**
 * Wraps game.director.spawnEntity to check, at the moment of each ORGANIC (i.e. not
 * forceX/forceY) spawn, where the entity actually landed.
 *
 * This is the fuzz-testing counterpart to test_bosses.js's "Spawn ring clears the
 * view (Patch 70)" check — but that test deliberately pins the player at the map
 * origin ("so the 1550px boundary clamp cannot pull a spawn in", per its own
 * comment). That is exactly the case where the bug CANNOT occur, which is why it
 * went unnoticed: the world clamp does not cap distance, it radially PROJECTS the
 * spawn onto the r=1550 circle, and the player stands inside that circle at
 * distance d from origin — so the nearest reachable spawn is (1550 - d) away.
 * At d=0 that is a harmless 1550px; by d=1500 it is 50px.
 *
 * TWO SEPARATE MEASUREMENTS, deliberately not conflated:
 *
 *   'spawned-on-screen' (HARD FAILURE) — the entity is inside the drawn viewport
 *      rectangle, so a player would literally watch it appear. This is the
 *      player-observable bug and the only thing that fails a run.
 *
 *   'off-screen-contract' (RECORDED, NON-FATAL) — the entity is closer than the
 *      corner radius Director itself targets (hypot(halfW,halfH)+80), but still
 *      outside the rectangle, so nothing is visibly wrong. Director's own contract
 *      is nominally violated; the player cannot tell. Kept as a signal, not a
 *      failure, so the headline number stays player-meaningful.
 *
 * `view` is the RUN'S REAL viewport, closed over rather than read from the
 * arguments. That distinction matters: Director.spawnRoom spawns bosses with a
 * hardcoded 2000x2000 pseudo-viewport that is a "spawn far away" knob, NOT a claim
 * about the screen. An earlier version of this instrumentation judged visibility
 * against whatever dimensions were passed in, so it measured the boss against a
 * fictional 2000x2000 display and reported false violations on phones — where the
 * boss actually spawns at 1550px against a ~336px half-width, i.e. comfortably off
 * screen. Real viewport only.
 *
 * Tutorial spawns and Rorschach split-spawns pass forceX/forceY and are governed by
 * a different, already-tested contract (viewSafeRadius / parent position), so they
 * are skipped rather than checked against the off-screen promise.
 */
function instrumentSpawnPlacement(game, view) {
    const violations = [];
    const contractOnly = [];
    const original = game.director.spawnEntity.bind(game.director);

    // The world-space half-extents the player can actually see. Uses the run's real
    // viewport and the zoom Director itself would fall back to for a degenerate value,
    // so the "what is visible" question is answered identically to the renderer.
    const zoom = (Number.isFinite(game.state.viewZoom) && game.state.viewZoom > 0)
        ? game.state.viewZoom : 1.3;
    const halfW = (view.viewW / 2) / zoom;
    const halfH = (view.viewH / 2) / zoom;
    const cornerRadius = Math.hypot(halfW, halfH) + 80;

    // Forwards with ...args rather than a fixed parameter list. An earlier version
    // named six parameters explicitly and silently dropped anything beyond them, so
    // when spawnEntity gained a 7th (minSpawnRadius) every boss spawn came through
    // this wrapper with that argument missing and appeared to regress. A transparent
    // wrapper must never restate the signature it is wrapping.
    game.director.spawnEntity = function (...args) {
        const [type, canvasWidth, canvasHeight, forceX = null, forceY = null] = args;
        const before = game.state.entities.length;
        const playerX = game.state.player.x, playerY = game.state.player.y;
        const mapOriginX = game.state.mapOriginX, mapOriginY = game.state.mapOriginY;

        const result = original(...args);

        if (game.state.entities.length > before) {
            const ent = game.state.entities[game.state.entities.length - 1];
            const distFromOrigin = (Number.isFinite(mapOriginX) && Number.isFinite(mapOriginY))
                ? Math.hypot(ent.x - mapOriginX, ent.y - mapOriginY) : 0;

            if (distFromOrigin > WORLD_CLAMP_RADIUS + 1) {
                violations.push({
                    kind: 'outside-world-clamp', entType: ent.type,
                    distFromOrigin, mapOriginX, mapOriginY, entX: ent.x, entY: ent.y
                });
            }

            if (forceX === null && forceY === null && !game.state.isTutorial) {
                const dx = Math.abs(ent.x - playerX);
                const dy = Math.abs(ent.y - playerY);
                const distFromPlayer = Math.hypot(dx, dy);
                const record = {
                    entType: ent.type, distFromPlayer, cornerRadius,
                    playerX, playerY, entX: ent.x, entY: ent.y,
                    playerDistFromOrigin: Math.hypot(playerX - (mapOriginX || 0), playerY - (mapOriginY || 0)),
                    mapOriginX, mapOriginY,
                    viewport: `${Math.round(view.viewW)}x${Math.round(view.viewH)}`, zoom
                };
                if (dx < halfW && dy < halfH) {
                    violations.push({ kind: 'spawned-on-screen', ...record });
                } else if (distFromPlayer < cornerRadius - 1) {
                    contractOnly.push({ kind: 'off-screen-contract', ...record });
                }
            }
        }
        return result;
    };
    return { violations, contractOnly };
}

/** Runaway-position guard — see RUNAWAY_BOUND for why 50000 and not something tighter. */
function checkPositionsBounded(game) {
    const s = game.state;
    const ox = Number.isFinite(s.mapOriginX) ? s.mapOriginX : 0;
    const oy = Number.isFinite(s.mapOriginY) ? s.mapOriginY : 0;
    const overBound = [];

    const playerDist = Math.hypot(s.player.x - ox, s.player.y - oy);
    if (playerDist > RUNAWAY_BOUND) overBound.push(`player @ ${playerDist.toFixed(0)}px from map origin`);

    s.entities.forEach((e, i) => {
        const d = Math.hypot(e.x - ox, e.y - oy);
        if (d > RUNAWAY_BOUND) overBound.push(`entities[${i}](${e.type}) @ ${d.toFixed(0)}px from map origin`);
    });

    if (overBound.length) {
        throw new FuzzAssertionError(`position(s) blew past the ${RUNAWAY_BOUND}px runaway bound: ${overBound.slice(0, 5).join('; ')}${overBound.length > 5 ? ` (+${overBound.length - 5} more)` : ''}`, 'runaway-position');
    }
}

// Maps each Director pool to the live state array it's supposed to mirror.
// `null` means "a filtered subset of state.entities" (the entity-type pools all
// share that one array, keyed by ent.type.toLowerCase()).
const POOL_STATE_MAP = {
    scavenger: null, predator: null, parasite: null, boss: null,
    rorschach: null, panopticon: null, amalgamation: null, architect: null,
    particle: 'particles', xpDrop: 'xpDrops', tokenDrop: 'tokenDrops',
    damageText: 'damageTexts', inkPuddle: 'inkPuddles', meleeSwing: 'meleeSwings',
    safeZone: 'safeZones', projectile: 'projectiles'
};

function checkPoolIntegrity(game) {
    const state = game.state;
    for (const [poolName, arrKey] of Object.entries(POOL_STATE_MAP)) {
        const pool = game.director.pools[poolName];
        if (!pool) continue;
        const freeList = pool.pool;

        for (const item of freeList) {
            if (item == null) throw new FuzzAssertionError(`pool '${poolName}' free list contains a null/undefined entry`, 'pool-integrity');
        }
        const freeSet = new Set(freeList);
        if (freeSet.size !== freeList.length) {
            throw new FuzzAssertionError(`pool '${poolName}' free list has a duplicate object reference (double-release)`, 'pool-integrity');
        }

        const liveArr = arrKey ? state[arrKey] : state.entities.filter(e => e.type.toLowerCase() === poolName);
        for (const item of liveArr) {
            if (freeSet.has(item)) {
                throw new FuzzAssertionError(`pool '${poolName}': an object is BOTH live in state.${arrKey || 'entities'} and sitting in the pool's free list — release()/splice() are out of sync`, 'pool-integrity');
            }
        }
        const liveSet = new Set(liveArr);
        if (liveSet.size !== liveArr.length) {
            throw new FuzzAssertionError(`pool '${poolName}': the same pooled object appears twice in state.${arrKey || 'entities'} — the pool handed out a live object`, 'pool-integrity');
        }
    }
}

// ---------------------------------------------------------------------------
function runOne(seed) {
    Math.random = mulberry32(seed);
    const params = { seed };

    try {
        // --- meta progression -------------------------------------------------
        const save = new SaveManager();
        const freshSave = chance(0.15);
        params.freshSave = freshSave;

        if (!freshSave) {
            const upgLevelPool = [0, 1, 5, 20, 50, 100];
            save.metaState.legacyUpgrades = {
                hp: choice(upgLevelPool), speed: choice(upgLevelPool),
                light: choice(upgLevelPool), magnet: choice(upgLevelPool)
            };

            const allNodeIds = SYNAPSE_NODES.map(n => n.id);
            const treeMode = choice(['none', 'full', 'random']);
            save.metaState.treeNodes =
                treeMode === 'full' ? [...allNodeIds] :
                treeMode === 'none' ? [] : subset(allNodeIds);
            // Occasionally simulate a stale/corrupt save: an id that no longer
            // resolves. getResolvedUpgrades() must skip it, not throw.
            if (chance(0.1)) save.metaState.treeNodes.push('STALE_NODE_ID');

            const tokenIds = Object.keys(TOKENS);
            const rarityIds = Object.keys(TOKEN_RARITIES);
            const invCount = randInt(0, 16);
            const inventory = [];
            for (let i = 0; i < invCount; i++) {
                inventory.push({ uid: `t${i}`, id: choice(tokenIds), rarity: choice(rarityIds), level: randInt(1, 5) });
            }

            const equipped = {};
            TOKEN_SLOT_TYPES.forEach(slot => {
                const candidates = inventory.filter(it => TOKENS[it.id].type === slot);
                equipped[slot] = (candidates.length && chance(0.7)) ? choice(candidates).uid : null;
            });
            // Force at least one full 4pc set some of the time — the only way to
            // reliably exercise the set-bonus branches (shockwave_no_dash,
            // medicated_mitigation, insomniac's burn-zone grant, relapse tagDamage).
            if (chance(0.25)) {
                const setKey = choice(Object.keys(TOKEN_SETS));
                tokenIds.filter(id => TOKENS[id].set === setKey).forEach(id => {
                    const uid = `forced_${id}`;
                    inventory.push({ uid, id, rarity: choice(rarityIds), level: 1 });
                    equipped[TOKENS[id].type] = uid;
                });
            }
            // Stale equip pointer — same defensive-fallback rationale as treeNodes.
            if (chance(0.1)) equipped[choice(TOKEN_SLOT_TYPES)] = 'STALE_UID';

            save.metaState.inventory = inventory;
            save.metaState.equippedTokens = equipped;
            params.equippedTokenSets = summarizeSets(equipped, inventory);

            const curseIds = Object.keys(INTRUSIVE_THOUGHTS);
            save.metaState.selectedCurses = subset(curseIds);
            if (chance(0.1)) save.metaState.selectedCurses.push('STALE_CURSE_ID');

            save.metaState.spentLucidity = randInt(0, 60000);
            save.metaState.lucidityBank = randInt(0, 20000);
            save._recomputeUpgradeMirror();

            params.legacyUpgrades = { ...save.metaState.legacyUpgrades };
            params.treeNodes = [...save.metaState.treeNodes];
            params.curses = [...save.metaState.selectedCurses];
        } else {
            params.legacyUpgrades = { hp: 0, speed: 0, light: 0, magnet: 0 };
            params.treeNodes = [];
            params.curses = [];
        }
        save.metaState.tutorialCompleted = chance(0.85);
        save.metaState.killCounts.BOSS = randInt(0, 5);

        // --- floor / room / carried-state --------------------------------------
        // Patch 94: was randInt(1, 5). THE RECURSION means floors 6+ are real, and
        // they are where the scaling multipliers, the boss rotation and the cadence
        // compression all actually run — so the fuzz has to reach them or it stops
        // covering the code it claims to. 12 spans two full cycles plus a partial,
        // which puts every boss into both a Cycle I and a scaled appearance.
        const floor = randInt(1, 12);
        const roomNumber = randInt(1, 12); // > maxRoomsPerFloor(10) is an intentional edge case
        params.floor = floor;
        params.roomNumber = roomNumber;

        let carriedState = null;
        if (chance(0.4)) {
            carriedState = {
                floor, roomNumber,
                sanity: randFloat(-20, 600), // negative/over-cap on purpose
                weapons: buildTemplateWeapons(),
                xp: randFloat(0, 5000),
                level: randInt(1, 60),
                lucidity: randFloat(0, 20000),
                runInventory: Array.from({ length: randInt(0, 10) }, () => choice(Object.keys(TOKEN_RARITIES))),
                telemetry: null
            };
        }
        params.usedCarriedState = !!carriedState;

        const game = new Game();
        let deaths = 0, levelUps = 0;
        game.onDeath = () => { deaths++; };
        game.onLevelUp = () => { levelUps++; organicLevelUp(game); };
        game.onFloorComplete = () => {};

        game.init(save, carriedState);

        // --- viewport / zoom ---------------------------------------------------
        // Resolved together from one device profile via the real updateZoom, so the
        // pair is always one a device can actually produce. Set BEFORE the spawn
        // instrumentation, which closes over the resolved viewport.
        const viewport = resolveViewport(choice(DEVICE_PROFILES));
        game.state.viewZoom = viewport.zoom;
        params.viewport = viewport.name;
        params.viewZoom = String(viewport.zoom);
        params.viewWH = `${Math.round(viewport.viewW)}x${Math.round(viewport.viewH)}`;
        params.portraitMode = viewport.portraitMode;

        // Degenerate zoom is still worth covering — Director and Renderer both carry
        // explicit `Number.isFinite(zoom) && zoom > 0` fallbacks and those branches
        // should stay exercised — but it is NOT a state any device reaches, so it is
        // opt-in, rare, and flagged in params. Anything failing only under this flag
        // is a fallback-path finding, not a real-device one; keeping the two apart is
        // the whole reason the previous viewport/zoom pairing was misleading.
        params.degenerateZoom = false;
        if (chance(0.08)) {
            const bad = choice([0, -1, NaN]);
            game.state.viewZoom = bad;
            params.degenerateZoom = true;
            params.viewZoom = String(bad);
        }

        const { violations: spawnViolations, contractOnly: spawnContractOnly } =
            instrumentSpawnPlacement(game, viewport);

        // --- weapon levels (overrides whatever init/carriedState produced) -----
        const weaponLevels = {};
        for (const id of PLAYER_WEAPON_IDS) {
            const maxLvl = MANIFESTATIONS[id] ? MANIFESTATIONS[id].maxLvl : 5;
            const minLvl = id === 'flashlight' ? 1 : 0;
            const target = randInt(minLvl, maxLvl);
            weaponLevels[id] = target;
            setWeaponToLevel(game.state.player.weapons[id], id, target);
        }
        params.weaponLevels = weaponLevels;

        // --- boons ---------------------------------------------------------------
        const boonPool = BOONS.map(b => b.id);
        const boonMode = choice(['none', 'few', 'many', 'all']);
        const chosenBoons =
            boonMode === 'none' ? [] :
            boonMode === 'all' ? [...boonPool] :
            subset(boonPool, { max: boonMode === 'few' ? 4 : boonPool.length });
        game.state.player.boons = [];
        chosenBoons.forEach(id => applyBoon(game, id));
        game.state.player.synergies = getActiveSynergies(game.state.player.weapons);
        params.boons = chosenBoons;
        params.synergies = game.state.player.synergies;

        // --- player displaced from map origin ---------------------------------
        // Nothing stops a real player from walking well away from wherever the room
        // started before more enemies spawn in — the Void doesn't even begin until
        // 1600px out. state.mapOriginX/Y is fixed at wherever the player was on this
        // room's first tick and does not follow them afterward, so this is a normal,
        // reachable mid-room state, not a contrived one. Explicitly forcing it (rather
        // than relying on this fuzzer's own random-walk input to organically wander
        // there over ~200 frames, which it rarely does) is what actually exercises the
        // spawn-ring/world-clamp interaction instrumentSpawnPlacement checks below.
        if (chance(0.5)) {
            game.state.mapOriginX = 0;
            game.state.mapOriginY = 0;
            const wanderAngle = randFloat(-Math.PI, Math.PI);
            const wanderDist = choice([0, 200, 800, 1400, WORLD_CLAMP_RADIUS, 1600, 2200]);
            game.state.player.x = Math.cos(wanderAngle) * wanderDist;
            game.state.player.y = Math.sin(wanderAngle) * wanderDist;
            params.playerWanderDist = wanderDist;
        } else {
            params.playerWanderDist = 0;
        }

        // --- room + entity/effect load ----------------------------------------
        // One spawnWave tick first, because that is the order the real game runs in:
        // spawnRoom is only ever reached from inside spawnWave (Director.js) or from
        // the room-door handler mid-run (Combat.js), never before a frame has
        // published the viewport. Calling spawnRoom cold here made the boss size
        // itself against Director's 1920x1080 fallback instead of this run's actual
        // screen — a harness artifact, not a game state any player reaches.
        game.director.spawnWave(viewport.viewW, viewport.viewH);
        game.director.spawnRoom(floor, roomNumber);
        // spawnRoom() does NOT set state.stress — only spawnWave() does, once combat
        // is actually ticking (see test_bosses.js's predator-feeding test for the same
        // gotcha). Spawning directly here, before any tick, needs the same value
        // spawnWave would have published, or hp comes out as 45 * undefined = NaN.
        game.state.stress = game.state.isTutorial ? 0 : 1.0 + roomNumber * 0.1;
        const spawnTypes = ['SCAVENGER', 'PREDATOR', 'PARASITE'];
        const extraSpawns = randInt(0, 150); // deliberately beyond a normal enemyBudget
        for (let i = 0; i < extraSpawns; i++) game.director.spawnEntity(choice(spawnTypes), viewport.viewW, viewport.viewH);
        params.extraSpawns = extraSpawns;

        const fxCount = randInt(0, 40);
        for (let i = 0; i < fxCount; i++) {
            const x = randFloat(-3000, 3000), y = randFloat(-3000, 3000);
            game.director.spawnParticles(x, y, '#ff00ff', randInt(1, 20));
            game.director.spawnXP(x, y, randInt(1, 25), chance(0.3));
            game.director.spawnDamageText(x, y, String(randInt(-999, 999)), '#fff', randFloat(0.5, 2), randFloat(0.1, 3));
            if (chance(0.3)) game.director.spawnInkPuddle(x, y, randFloat(10, 100), randFloat(1, 20));
            if (chance(0.3)) game.director.spawnMeleeSwing(x, y, randFloat(10, 150));
            if (chance(0.3)) game.director.spawnSafeZone(x, y, randFloat(10, 300), randInt(10, 600));
            if (chance(0.3)) game.director.spawnToken(x, y, { type: choice(Object.keys(TOKEN_RARITIES)), color: '#fff' });
            if (chance(0.3)) game.director.spawnProjectile(x, y, randFloat(-10, 10), randFloat(-10, 10), randFloat(1, 20), randFloat(1, 50), '#fff', randInt(10, 300));
        }
        params.fxCount = fxCount;

        if (chance(0.15)) {
            game.state.interactables.push({ type: 'BREAKER_BOX', x: randFloat(-500, 500), y: randFloat(-500, 500), radius: 40, active: chance(0.5), charge: randInt(0, 80), life: randInt(0, 500), dead: false });
        }
        if (chance(0.15)) {
            game.state.interactables.push({ type: 'OBJECTIVE_BACKPACK', x: randFloat(-500, 500), y: randFloat(-500, 500), radius: 40, life: randInt(0, 300), dead: false });
        }

        checkStateFinite(game);
        checkNoHoles(game);
        checkPoolIntegrity(game);
        checkPositionsBounded(game);

        // --- tick the sim ---------------------------------------------------------
        const frameCount = randInt(20, 220);
        params.frameCount = frameCount;
        let currentFrame = -1;
        for (let f = 0; f < frameCount; f++) {
            currentFrame = f;
            const input = {
                moveX: randFloat(-1, 1), moveY: randFloat(-1, 1),
                aimAngle: randFloat(-Math.PI, Math.PI),
                isMoving: chance(0.7), isDashing: chance(0.1)
            };
            game.update(input, viewport.viewW, viewport.viewH, 'PLAYING');

            if (chance(0.1)) game.takeDamage(randFloat(-20, 400));
            if (chance(0.02)) game.director.spawnEntity(choice(spawnTypes), viewport.viewW, viewport.viewH);

            checkStateFinite(game);
            checkNoHoles(game);
            checkPositionsBounded(game);
            if (f % 5 === 0) checkPoolIntegrity(game);
        }
        checkPoolIntegrity(game);

        params.offScreenContractOnly = spawnContractOnly.length;
        if (spawnViolations.length) {
            const v = spawnViolations[0];
            const detail = v.kind === 'spawned-on-screen'
                ? `${v.entType} spawned ON SCREEN, ${v.distFromPlayer.toFixed(1)}px from the player at (${v.playerX.toFixed(0)},${v.playerY.toFixed(0)}) — which is ${v.playerDistFromOrigin.toFixed(0)}px from map origin, so the r=${WORLD_CLAMP_RADIUS} clamp circle passes ${(WORLD_CLAMP_RADIUS - v.playerDistFromOrigin).toFixed(0)}px away from them; viewport ${v.viewport} @ zoom ${v.zoom.toFixed(2)}`
                : `${v.entType} spawned ${v.distFromOrigin.toFixed(1)}px from map origin, past the ${WORLD_CLAMP_RADIUS}px world clamp`;
            throw new FuzzAssertionError(`${spawnViolations.length} spawn-placement violation(s), first: ${detail}`, 'spawn-placement');
        }

        params.finalFrame = currentFrame;
        params.deaths = deaths;
        params.levelUps = levelUps;
        params.finalEntityCount = game.state.entities.length;
        return { ok: true, params };
    } catch (err) {
        return { ok: false, params, error: err };
    }
}

// ---------------------------------------------------------------------------
const TOTAL_RUNS = Number(process.env.FUZZ_RUNS) || 200;
const BASE_SEED = Number(process.env.FUZZ_SEED) || 1337;
const ONLY_SEED = process.env.FUZZ_ONLY_SEED ? Number(process.env.FUZZ_ONLY_SEED) : null;

const realRandom = Math.random;
const seeds = ONLY_SEED !== null
    ? [ONLY_SEED]
    : Array.from({ length: TOTAL_RUNS }, (_, i) => (BASE_SEED + i * 2654435761) >>> 0);

let passedRuns = 0;
const failures = [];

console.log(`\nSimulating ${seeds.length} randomized run(s)...\n`);

for (const seed of seeds) {
    const result = runOne(seed);
    if (result.ok) passedRuns++;
    else failures.push(result);
}
Math.random = realRandom;

console.log(`${passedRuns} / ${seeds.length} runs completed with no invariant violations.\n`);

if (failures.length) {
    console.log(`\x1b[31m${failures.length} FAILURE(S)\x1b[0m\n`);

    const byCategory = new Map();
    for (const f of failures) {
        const cat = (f.error && f.error.category) || 'unknown';
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(f);
    }

    const DETAILED_PER_CATEGORY = Number(process.env.FUZZ_DETAIL) || 3; // full stack + repro params; the rest get one line
    for (const [cat, group] of byCategory) {
        console.log(`=== '${cat}' — ${group.length} failure(s) ===\n`);
        group.slice(0, DETAILED_PER_CATEGORY).forEach((f, idx) => {
            console.log(`--- ${cat} #${idx + 1} (seed ${f.params.seed}) ---`);
            console.log(f.error && f.error.stack ? f.error.stack : String(f.error));
            console.log('Repro params:', JSON.stringify(f.params, null, 2));
            console.log(`Reproduce with:  FUZZ_ONLY_SEED=${f.params.seed} node test_fuzz_runs.js\n`);
        });
        if (group.length > DETAILED_PER_CATEGORY) {
            const rest = group.slice(DETAILED_PER_CATEGORY);
            console.log(`...and ${rest.length} more '${cat}' failure(s), seeds: ${rest.map(f => f.params.seed).join(', ')}\n`);
        }
    }
}

console.log('Coverage notes:');
console.log(' - Exercised headlessly: Game.init/update/processGameLogic/takeDamage, Combat.resolveWeapons/collectXP');
console.log('   (flashlight cone falloff, static aura, pipe swing + hitstop, ink trail, chalk ward, camera flash,');
console.log('   spinner orbit incl. centrifuge/kinetic_discharge synergy, all boon/curse/token/set branches),');
console.log('   Director spawnRoom/spawnWave/spawnEntity/applyEnemyVariant/spawnRewardDoors, ObjectPool get/release,');
console.log('   every entity update()/applyMovement()/applyVariantMotion() incl. all 5 bosses, SaveManager\'s');
console.log('   getResolvedUpgrades/getResolvedTokenEffects/getResolvedCurseBonus resolvers, Tutorial.update, and');
console.log('   the ROOM_DOOR/BREAKER_BOX/OBJECTIVE_BACKPACK interactable branches in Combat.js.');
console.log(' - NOT exercisable headlessly (no canvas/DOM here): Renderer.js (all drawing — the actual golden-rule');
console.log('   risk surface for shadowBlur/globalCompositeOperation/gradient calls lives entirely there and needs');
console.log('   the in-game VISUAL TEST BENCH per CLAUDE.md), UIManager.js/LevelUpUI.js/GuideUI.js/SynapseTree.js');
console.log('   DOM rendering (this script reimplements selectCard()\'s non-DOM math directly — see the header');
console.log('   comment), InputManager\'s real mouse/touch/keyboard listeners (inputs here are synthetic), and');
console.log('   AudioEngine (never constructed, so SFX-gated branches run with audioEngine === null throughout).');

process.exit(failures.length > 0 ? 1 : 0);
