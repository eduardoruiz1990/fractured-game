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

// --- Patch 149: the double-tap dash ----------------------------------------------------------------------
{
    const { isDoubleTap, wasTap, DOUBLE_TAP_MS, DOUBLE_TAP_SLOP, TAP_MAX_MS, TAP_MAX_TRAVEL } = await import('./src/core/Input.js');
    ok(wasTap(TAP_MAX_MS - 1, TAP_MAX_TRAVEL - 1) && !wasTap(TAP_MAX_MS + 1, 0) && !wasTap(50, TAP_MAX_TRAVEL + 1), 'a tap is short and still');
    const prev = { wasTap: true, endAt: 1000, x: 100, y: 500 };
    ok(isDoubleTap(prev, 1000 + DOUBLE_TAP_MS - 1, 110, 505), 'a second touch soon and near: double-tap');
    ok(!isDoubleTap(prev, 1000 + DOUBLE_TAP_MS + 1, 110, 505), 'too late: not');
    ok(!isDoubleTap(prev, 1100, 100 + DOUBLE_TAP_SLOP + 1, 500), 'too far: not');
    ok(!isDoubleTap({ ...prev, wasTap: false }, 1100, 100, 500), 'after a hold (steering), not a tap: not');
    ok(!isDoubleTap(null, 1100, 100, 500), 'no previous touch: not');
}

// --- Patch 149: haptics ------------------------------------------------------------------------------------
{
    const H = await import('./src/core/Haptics.js');
    const calls = [];
    const nav = { vibrate: (p) => { calls.push(p); return true; } };
    H.resetHaptics();
    ok(H.haptic('hit', 1000, nav) === true && calls.length === 1, 'a hit buzzes');
    ok(H.haptic('hit', 1100, nav) === false && calls.length === 1, 'a second hit inside the gap does not');
    ok(H.haptic('hit', 1000 + H.HAPTIC_MIN_GAP.hit, nav) === true, 'after the gap it does again');
    ok(H.haptic('nope', 5000, nav) === false, 'unknown kinds do nothing');
    H.setHapticsEnabled(false);
    ok(H.haptic('levelUp', 9000, nav) === false && !H.hapticsEnabled(), 'off: nothing');
    H.resetHaptics();
    ok(H.haptic('levelUp', 9000, null) === false, 'no navigator: no throw');
    ok(H.haptic('levelUp', 9000, { vibrate: () => { throw new Error('x'); } }) === false, 'a throwing vibrate is contained');
    ok(H.bossTelegraphing({ pulseState: 'charging' }) && H.bossTelegraphing({ gazeState: 'charging' }) && H.bossTelegraphing({ actionState: 'charging_collapse' })
       && H.bossTelegraphing({ shootState: 'telegraphing' }) && !H.bossTelegraphing({ pulseState: 'idle' }) && !H.bossTelegraphing(null), 'bossTelegraphing');
}

// --- Patch 149: the Game side (dash pulse, hit and boss haptics) -------------------------------------------
{
    const { Game } = await import('./src/core/Game.js');
    const meta = { upgrades: { hp: 0, speed: 0, light: 0, magnet: 0 }, killCounts: {}, inventory: [], equippedTokens: {}, selectedCurses: [],
        maxFloorReached: 1, tutorialCompleted: true, story: { coldOpenSeen: true, pages: {} } };
    const g = new Game();
    g.onDeath = () => {}; g.onLevelUp = () => {}; g.onFloorComplete = () => {};
    const buzz = [];
    g.onHaptic = (k) => buzz.push(k);
    g.init({ metaState: meta, saveGame: () => {} });
    const idle = { moveX: 0, moveY: 0, aimAngle: 0, isMoving: false };
    g.update(idle, 1280, 720, 'PLAYING');
    g.director.spawnWave = () => {};
    g.state.hitStop = 0; g.state.slowMo = 0;
    const p = g.state.player;
    const charges = p.dash.charges;
    const input = { ...idle, dashPulse: true, dashAngle: Math.PI / 2 };
    g.update(input, 1280, 720, 'PLAYING');
    ok(p.dash.active && p.dash.charges === charges - 1, 'a dash pulse dashes');
    ok(near(p.dash.dx, 0, 1e-9) && near(p.dash.dy, 1, 1e-9), 'standing still, it dashes along dashAngle (the last heading)');
    ok(input.dashPulse === false, 'the pulse is consumed');
    p.iframes = 0;
    g.takeDamage(5, 'test');
    ok(buzz.includes('hit'), 'taking damage asks for a hit buzz');
    g.director.releaseRoomState(g.state);
    const boss = g.director.spawnEntity('BOSS', null, null, p.x + 300, p.y);
    g.state.bossSpawned = true;
    boss.update = () => {}; boss.pulseState = 'charging';
    g.state.hitStop = 0;
    g.update(idle, 1280, 720, 'PLAYING');
    g.state.hitStop = 0;
    g.update(idle, 1280, 720, 'PLAYING');
    ok(buzz.filter(k => k === 'bossIntro').length === 1, 'a boss arriving buzzes once');
    ok(buzz.filter(k => k === 'telegraph').length === 1, `a held wind-up buzzes once (${buzz})`);
}

// --- Patch 161: twin sticks route by finger, not by screen half --------------------------------
{
    const { InputManager } = await import('./src/core/Input.js');
    const el = () => ({ style: {}, offsetParent: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 384 }) }, addEventListener: () => {} });
    const els = { 'joy-left': el(), 'knob-left': el(), 'joy-right': el(), 'knob-right': el(), 'btn-dash': el() };
    const savedGet = document.getElementById;
    const mk = () => { document.getElementById = id => els[id] || null; const m = new InputManager({ addEventListener: () => {} }); document.getElementById = savedGet; m.doubleTapDash = false; return m; };
    // a 384 px-wide portrait screen: the midline is x = 192
    const live = new Map();
    const T = (id, x, y) => ({ identifier: id, clientX: x, clientY: y });
    const ev = (m, type, ...ts) => {
        for (const t of ts) { if (type === 'touchend') live.delete(t.identifier); else live.set(t.identifier, t); }
        const e = { type, target: { id: 'game' }, preventDefault: () => {}, changedTouches: ts, touches: [...live.values()] };
        if (type === 'touchend') m.handleTouchEnd(e); else m.handleTouch(e);
    };

    // 1. the move thumb drifts across the midline: it keeps moving, the aim stick is not stolen
    let m = mk(); live.clear();
    ev(m, 'touchstart', T(1, 150, 600));
    ev(m, 'touchmove', T(1, 230, 600));                 // 80 px right, now past the midline
    ok(m.leftTouch.id === 1 && m.rightTouch.id === null, 'a move thumb crossing the midline keeps the move stick (aim not stolen)');
    ok(m.state.isMoving && m.state.moveX > 0.9, `...and keeps steering (moveX ${m.state.moveX.toFixed(2)})`);
    ev(m, 'touchmove', T(1, 230, 680));
    ok(m.state.moveY > 0.3, 'it still answers a new direction after crossing');

    // 2. the aim thumb drifts left across the midline: it keeps aiming, movement is not hijacked
    m = mk(); live.clear();
    ev(m, 'touchstart', T(2, 260, 600));
    ev(m, 'touchmove', T(2, 160, 600));
    ok(m.rightTouch.id === 2 && m.leftTouch.id === null && !m.state.isMoving, 'an aim thumb crossing left keeps aiming; the player does not start walking');
    ok(near(Math.abs(m.state.aimAngle), Math.PI, 1e-6), 'and the aim follows it');

    // 3. both thumbs on the same half: the leftmost moves, the other aims (none ignored)
    m = mk(); live.clear();
    ev(m, 'touchstart', T(3, 120, 620));
    ev(m, 'touchstart', T(4, 180, 600));                // also left of the midline
    ok(m.leftTouch.id === 3 && m.rightTouch.id === 4, 'two thumbs left of the midline: one moves, one aims');
    m = mk(); live.clear();
    ev(m, 'touchstart', T(5, 300, 620));
    ev(m, 'touchstart', T(6, 220, 600));                // both on the right half
    ok(m.leftTouch.id === 6 && m.rightTouch.id === 5, 'two thumbs right of the midline: the leftmost moves');

    // 4. the second thumb lands on the far side of the first: they sort by position (swap)
    m = mk(); live.clear();
    ev(m, 'touchstart', T(7, 170, 620));                // lands left: move
    ev(m, 'touchstart', T(8, 100, 600));                // further left still
    ok(m.leftTouch.id === 8 && m.rightTouch.id === 7, 'a thumb landing left of the move thumb takes movement; the other becomes aim');
    ok(!m.state.isMoving && m.rightTouch.ox === 170, 'the swapped thumb is re-centred where it is (no jump)');
    ev(m, 'touchmove', T(8, 100, 660));
    ok(m.state.isMoving && m.state.moveY > 0.9, 'the new move thumb steers');

    // 5. a third finger is ignored; lifting one thumb frees only its stick
    ev(m, 'touchstart', T(9, 200, 500));
    ok(m.leftTouch.id === 8 && m.rightTouch.id === 7, 'a third finger changes nothing');
    ev(m, 'touchend', T(8, 100, 660));
    ok(m.leftTouch.id === null && !m.state.isMoving && m.rightTouch.id === 7, 'lifting the move thumb stops movement and leaves aim held');

    // 6. a stick whose finger vanished (touchend lost behind a menu) is freed by the next touch
    m = mk(); live.clear();
    ev(m, 'touchstart', T(10, 100, 600));
    ev(m, 'touchmove', T(10, 100, 660));
    live.delete(10);                                    // its touchend never reached the canvas
    ev(m, 'touchstart', T(11, 120, 600));
    ok(m.leftTouch.id === 11 && m.rightTouch.id === null, 'a lost touch is reclaimed: the new thumb gets the move stick');
    ok(!m.state.isMoving, '...and the old movement is not left running');

    // 7. past full pull the base trails the thumb, so reversing answers at once
    m = mk(); live.clear();
    ev(m, 'touchstart', T(12, 100, 600));
    ev(m, 'touchmove', T(12, 100, 760));                // 160 px down: base dragged to 50 px behind
    ok(near(m.leftTouch.oy, 710, 1e-6), `the base trails the thumb at full pull (oy ${m.leftTouch.oy})`);
    ev(m, 'touchmove', T(12, 100, 680));                // 80 px back up
    ok(m.state.moveY < -0.5, `reversing moves the other way at once (moveY ${m.state.moveY.toFixed(2)})`);

    // 8. the double-tap dash still works on the move stick
    m = mk(); m.doubleTapDash = true; live.clear();
    ev(m, 'touchstart', T(13, 100, 600)); ev(m, 'touchend', T(13, 100, 600));
    ev(m, 'touchstart', T(14, 104, 602));
    ok(m.state.dashPulse === true, 'a double tap on the move side still dashes');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
