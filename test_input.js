/**
 * Patch 148+ (V2 plan F): mobile and accessibility input.
 *
 * Run with:  node test_input.js   (assertion-based, exits 1 on failure)
 *
 * Covers src/systems/AutoAim.js (the mode, target choice and stickiness, the turn
 * limit, following movement with nothing in range) and its hook in Game.update (on,
 * off, and the held right stick overriding it).
 */

global.CustomEvent = class CustomEvent { constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; } };
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ addColorStop: () => {}, data: [] })), set: (t, k, v) => { t[k] = v; return true; } });
global.document = { addEventListener: () => {}, dispatchEvent: () => {}, getElementById: () => null,
    createElement: () => ({ width: 1920, height: 1080, getContext: () => ctx }) };
global.window = { addEventListener: () => {} };
global.localStorage = { getItem: () => null, setItem: () => {} };

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.log('FAIL ' + m); } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const AA = await import('./src/systems/AutoAim.js');
const { autoAimEnabled, pickTarget, turnTowards, autoAimStep, AUTO_AIM_RANGE, AUTO_AIM_TURN, AUTO_AIM_STICKY } = AA;

// --- the mode -----------------------------------------------------------------------------
ok(autoAimEnabled('auto', 'touch') && !autoAimEnabled('auto', 'keyboard'), 'auto: on for touch, off with a mouse');
ok(autoAimEnabled('on', 'keyboard') && !autoAimEnabled('off', 'touch'), 'on / off override the scheme');
ok(autoAimEnabled(undefined, 'touch') && !autoAimEnabled('nonsense', 'keyboard'), 'a missing or unknown setting behaves as auto');

// --- target choice ----------------------------------------------------------------------------
const E = (id, x, y, extra = {}) => ({ id, x, y, hp: 10, ...extra });
ok(pickTarget([E(1, 300, 0), E(2, 100, 0)], 0, 0).id === 2, 'the nearest wins');
ok(pickTarget([E(1, AUTO_AIM_RANGE + 1, 0)], 0, 0) === null, 'out of range: none');
ok(pickTarget([E(1, 50, 0, { dead: true }), E(2, 60, 0, { burrowed: true }), E(3, 70, 0, { hp: 0 }), E(4, NaN, 0), E(5, 200, 0)], 0, 0).id === 5,
   'dead, burrowed, 0-hp and non-finite enemies are skipped');
ok(pickTarget([E(1, 120, 0), E(2, 100, 0)], 0, 0, 1).id === 1, 'the current target is kept when nearly as close (sticky)');
ok(pickTarget([E(1, 100 * AUTO_AIM_STICKY + 10, 0), E(2, 100, 0)], 0, 0, 1).id === 2, 'but not when clearly further');
ok(pickTarget([], 0, 0) === null && pickTarget(undefined, 0, 0) === null, 'no entities: none (no throw)');

// --- turning ------------------------------------------------------------------------------------
ok(near(turnTowards(0, 0.1), 0.1), 'a small turn lands exactly');
ok(near(turnTowards(0, 1), AUTO_AIM_TURN), 'a big turn is limited');
ok(near(turnTowards(3.0, -3.0), 3.0 + AUTO_AIM_TURN), 'turns the short way round across ±π');
ok(turnTowards(NaN, 1) === 1 && turnTowards(1, NaN) === 1, 'non-finite angles are guarded');

// --- a step -----------------------------------------------------------------------------------------
{
    const st = { player: { x: 0, y: 0, angle: 0 }, entities: [E(7, 0, 200)] };
    let a = 0;
    for (let i = 0; i < 20; i++) { a = autoAimStep(st, {}); st.player.angle = a; }
    ok(near(a, Math.PI / 2) && st.autoAim.targetId === 7, `turns onto the enemy and records it (${a.toFixed(3)})`);
    st.entities = [];
    a = autoAimStep(st, { isMoving: true, moveX: -1, moveY: 0 });
    ok(st.autoAim.targetId === null && near(a, Math.PI / 2 + AUTO_AIM_TURN), 'nothing in range: follows the direction of travel');
    st.player.angle = 1.234;
    ok(near(autoAimStep(st, { isMoving: false }), 1.234), 'standing still with nothing in range: holds the angle');
}

// --- Game.update hook ------------------------------------------------------------------------------
{
    const { Game } = await import('./src/core/Game.js');
    const meta = { upgrades: { hp: 0, speed: 0, light: 0, magnet: 0 }, killCounts: {}, inventory: [], equippedTokens: {}, selectedCurses: [],
        maxFloorReached: 1, tutorialCompleted: true, story: { coldOpenSeen: true, pages: {} } };
    const mk = () => {
        const g = new Game();
        g.onDeath = () => {}; g.onLevelUp = () => {}; g.onFloorComplete = () => {};
        g.init({ metaState: meta, saveGame: () => {} });
        g.update({ moveX: 0, moveY: 0, aimAngle: 0, isMoving: false }, 1280, 720, 'PLAYING');   // spawns the room
        g.state.hitStop = 0; g.state.slowMo = 0;
        const p = g.state.player;
        g.director.releaseRoomState(g.state);
        g.state.budget = 0; g.state.spawnBudget = 0;
        const target = g.director.spawnEntity('SCAVENGER', null, null, p.x, p.y + 150);
        if (target) { target.update = () => {}; target.x = p.x; target.y = p.y + 150; }   // held still
        g.state.entities = target ? [target] : [];
        g.director.spawnWave = () => {};   // nothing else arrives during the check
        return g;
    };
    const run = (g, input, n = 25) => { for (let i = 0; i < n; i++) { g.state.hitStop = 0; g.update(input, 1280, 720, 'PLAYING'); } return g.state.player.angle; };

    const gOn = mk(); gOn.autoAimOn = true;
    const has = gOn.state.entities.length === 1;
    ok(has, 'a test enemy exists');
    if (has) {
        const a = run(gOn, { moveX: 0, moveY: 0, aimAngle: 0, isMoving: false });
        ok(Math.abs(a - Math.PI / 2) < 0.15, `assist on: the player turns to the enemy (${a.toFixed(3)})`);
        const gOff = mk(); gOff.autoAimOn = false;
        ok(near(run(gOff, { moveX: 0, moveY: 0, aimAngle: 0.5, isMoving: false }), 0.5), 'assist off: the input angle is used as before');
        const gHeld = mk(); gHeld.autoAimOn = true;
        ok(near(run(gHeld, { moveX: 0, moveY: 0, aimAngle: -2, isMoving: false, aimHeld: true }), -2), 'a held right stick overrides assist');
        ok(gHeld.state.autoAim === undefined || gHeld.state.autoAim.targetId === null, 'and assist forgets its target while overridden');
    }
}

// --- the tutorial speaks to assist -----------------------------------------------------------------
{
    const { Tutorial } = await import('./src/systems/Tutorial.js');
    const st = { isTutorial: true, tutorialStep: 'ENGAGE' };
    ok(/right thumb/.test(Tutorial.bannerCopy(st, 'touch')), 'ENGAGE without assist: aim with the right thumb');
    ok(/by itself/.test(Tutorial.bannerCopy({ ...st, autoAimOn: true }, 'touch')), 'ENGAGE with assist: no aiming asked for');
    ok(Tutorial.bannerCopy({ isTutorial: true, tutorialStep: 'MOVE', autoAimOn: true }, 'touch') === 'Slide your left thumb to move.', 'other steps unchanged by assist');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
