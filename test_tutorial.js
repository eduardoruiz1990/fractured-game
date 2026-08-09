/**
 * Tutorial step machine (Patches 65 / 66).
 *
 * Run with:  node test_tutorial.js
 *
 * WHY THIS FILE EXISTS: the tutorial is the only part of the game that every single
 * player sees, and it is the part that is hardest to re-test by hand — reaching it
 * again means wiping `tutorialCompleted` and replaying from a cold profile, and its
 * failure mode is not a crash but a player quietly reading the wrong instruction.
 *
 * The things asserted here are the ones that were actually broken before this work
 * and are cheap to break again:
 *   1. the copy matches the DEVICE (mobile players were told to press WASD),
 *   2. no step can trap the player — every one has a fallback that fires, and the
 *      enemy hold has a hard cap,
 *   3. the enemy spawn gate opens, and not before both controls are taught (Director
 *      refuses to spawn until it does, so a gate that never opens is an empty,
 *      unwinnable tutorial room),
 *   4. no instruction can flash past unread.
 *
 * Tutorial.js is deliberately DOM-free so this can drive the real module.
 */

import { Tutorial, TUTORIAL_COPY, EMPTY_ROOM_BUDGET_TOUCH } from './src/systems/Tutorial.js';

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
    if (condition) {
        passed++;
        console.log(`  \x1b[32m✓\x1b[0m ${label}`);
    } else {
        failed++;
        console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
    }
}

const makeGame = () => {
    const state = {
        isTutorial: true,
        level: 1,
        entities: [],
        player: { x: 0, y: 0, dash: { active: false } }
    };
    Tutorial.reset(state);
    return { state };
};

/** Advances n frames without the player doing anything. */
const idle = (game, n) => { for (let i = 0; i < n; i++) Tutorial.update(game); };

/** Advances n frames while the player walks right at `speed` px/frame. */
const walk = (game, n, speed = 3) => {
    for (let i = 0; i < n; i++) { game.state.player.x += speed; Tutorial.update(game); }
};

const dash = (game) => {
    game.state.player.dash.active = true;
    Tutorial.update(game);
    game.state.player.dash.active = false;
};

/** Drives a game to the start of ENGAGE with an enemy on screen, as the real flow does. */
const toEngage = (game) => {
    walk(game, 60);
    dash(game);
    idle(game, 60);
    game.state.entities.push(enemy());
    Tutorial.update(game);
};

const enemy = (hp = 20, maxHp = 20) => ({ hp, maxHp, x: 100, y: 0 });

console.log('\nStep 1 — MOVE');
{
    const g = makeGame();
    Tutorial.update(g);
    check('starts on MOVE', g.state.tutorialStep === 'MOVE');
    check('the enemy spawn gate starts CLOSED', g.state.tutorialCombatReady === false);

    idle(g, 120);
    check('standing still does not advance the step', g.state.tutorialStep === 'MOVE');

    walk(g, 60);   // 180px travelled, past the 140px requirement
    check('walking advances to DASH', g.state.tutorialStep === 'DASH', g.state.tutorialStep);
    check('and the spawn gate is STILL closed — the dash has not been taught yet',
          g.state.tutorialCombatReady === false);
}

console.log('\nStep 2 — DASH, which is what releases the enemy');
{
    const g = makeGame();
    walk(g, 60);
    idle(g, 120);
    check('not dashing holds the step', g.state.tutorialStep === 'DASH');
    check('and holds the enemy back', g.state.tutorialCombatReady === false);

    dash(g);
    check('dashing advances to ENGAGE', g.state.tutorialStep === 'ENGAGE', g.state.tutorialStep);
    check('and opens the spawn gate', g.state.tutorialCombatReady === true);
}

console.log('\nEvery instruction is readable (MIN_READ)');
{
    // A player already holding a direction, who dashes the instant the line appears,
    // must still see each line. Without a minimum, MOVE could pass in ~2 frames.
    const g = makeGame();
    for (let i = 0; i < 30; i++) { g.state.player.x += 20; Tutorial.update(g); }
    check('600px of movement in 30 frames does not skip MOVE early',
          g.state.tutorialStep === 'MOVE', g.state.tutorialStep);

    walk(g, 40);
    check('MOVE passes once it has been on screen long enough', g.state.tutorialStep === 'DASH');

    dash(g);
    check('an instant dash does not skip the DASH line', g.state.tutorialStep === 'DASH');
    idle(g, 60);
    check('DASH passes on the dash it already recorded, once read',
          g.state.tutorialStep === 'ENGAGE', g.state.tutorialStep);
}

console.log('\nMovement accumulator');
{
    // A dash or a leash teleport is a single huge delta. It must not satisfy a gate
    // that exists to prove the player found the movement control.
    const g = makeGame();
    g.state.player.x = 5000;
    Tutorial.update(g);
    g.state.player.x = 10000;
    Tutorial.update(g);
    idle(g, 120);
    check('a single large jump does not satisfy the MOVE gate', g.state.tutorialStep === 'MOVE');
}

console.log('\nStep 3 — ENGAGE, and the hold');
{
    const g = makeGame();
    toEngage(g);
    check('the enemy is held still while the instruction is pending',
          g.state.tutorialFreeze === true);

    idle(g, 200);
    check('an undamaged enemy does not advance the step', g.state.tutorialStep === 'ENGAGE');
    check('and stays held', g.state.tutorialFreeze === true);

    g.state.entities[0].hp = 12;
    Tutorial.update(g);
    check('first damage advances to FIGHT', g.state.tutorialStep === 'FIGHT', g.state.tutorialStep);
    check('and releases the hold', g.state.tutorialFreeze === false);
    check('FIGHT shows no banner at all', Tutorial.bannerCopy(g.state, 'keyboard') === null);
}

console.log('\nThe hold can never be a soft lock');
{
    const g = makeGame();
    toEngage(g);
    idle(g, 430);   // past FREEZE_CAP, still no damage dealt
    check('the enemy wakes up on its own', g.state.tutorialFreeze === false);
    check('and the step is still ENGAGE until the player connects or times out',
          g.state.tutorialStep === 'ENGAGE', g.state.tutorialStep);
}

console.log('\nThe kill, the card, the door');
{
    const g = makeGame();
    toEngage(g);
    g.state.entities.length = 0;          // killed during the ENGAGE prompt
    Tutorial.update(g);
    check('a kill jumps straight to COLLECT', g.state.tutorialStep === 'COLLECT', g.state.tutorialStep);
    check('and cannot leave the world frozen', g.state.tutorialFreeze === false);

    g.state.level = 2;                     // the boon card fired and closed
    Tutorial.update(g);
    check('levelling advances to ASCEND', g.state.tutorialStep === 'ASCEND', g.state.tutorialStep);

    idle(g, 400);
    check('ASCEND releases to BANK', g.state.tutorialStep === 'BANK', g.state.tutorialStep);

    idle(g, 500);
    check('BANK releases to DOOR', g.state.tutorialStep === 'DOOR', g.state.tutorialStep);

    idle(g, 2000);
    check('DOOR is terminal', g.state.tutorialStep === 'DOOR');
}

console.log('\nThe late level-up (orbs left out of vacuum range)');
{
    const g = makeGame();
    toEngage(g);
    g.state.entities.length = 0;
    idle(g, 1000);                         // COLLECT times out first
    check('COLLECT falls through to DOOR without a level-up', g.state.tutorialStep === 'DOOR');

    g.state.level = 2;                     // player finally walks over the orbs
    Tutorial.update(g);
    check('the Lucidity lesson still fires, interrupting DOOR',
          g.state.tutorialStep === 'ASCEND', g.state.tutorialStep);

    idle(g, 900);
    g.state.level = 3;
    idle(g, 60);
    check('but only once — a second level-up does not re-interrupt',
          g.state.tutorialStep === 'DOOR', g.state.tutorialStep);
}

console.log('\nNo step can trap the player');
{
    // Every gate is also satisfiable by waiting. A player who never presses the key
    // being taught must still reach combat, the kill and the exit.
    const g = makeGame();
    idle(g, 1000);
    check('MOVE times out', g.state.tutorialStep === 'DASH', g.state.tutorialStep);

    idle(g, 1000);
    check('DASH times out and opens the spawn gate',
          g.state.tutorialStep === 'ENGAGE' && g.state.tutorialCombatReady === true);

    g.state.entities.push(enemy());
    idle(g, 1300);
    check('ENGAGE times out into silence', g.state.tutorialStep === 'FIGHT', g.state.tutorialStep);
    check('with nothing left frozen', g.state.tutorialFreeze === false);
}

console.log('\nDevice-appropriate copy');
{
    const g = makeGame();
    Tutorial.update(g);

    const kb = Tutorial.bannerCopy(g.state, 'keyboard');
    const touch = Tutorial.bannerCopy(g.state, 'touch');
    check('keyboard players are told about keys', /W A S D/.test(kb), kb);
    check('touch players are NOT told about keys', !/WASD|W A S D|SPACE|mouse/i.test(touch), touch);
    check('touch players are told about their thumb', /thumb/i.test(touch), touch);

    // The failure this guards against is a new step added with keyboard copy only,
    // silently showing "press SPACE" to a phone.
    const controlSteps = ['MOVE', 'DASH', 'ENGAGE'];
    let leaks = [];
    for (const step of controlSteps) {
        g.state.tutorialStep = step;
        const line = Tutorial.bannerCopy(g.state, 'touch');
        if (/WASD|W A S D|\bSPACE\b|mouse/i.test(line)) leaks.push(step);
    }
    check('no control-teaching step leaks keyboard copy to touch',
          leaks.length === 0, `leaked: ${leaks.join(', ')}`);

    // Readability is the point of the copy rewrite, and it is easy to undo by
    // "improving" a line. Anything much past a tweet is not read mid-fight.
    let longest = null;
    for (const [id, line] of Object.entries(TUTORIAL_COPY)) {
        check(`${id} has keyboard copy`, typeof line.keyboard === 'string' && line.keyboard.length > 0);
        for (const variant of [line.keyboard, line.touch]) {
            if (variant && (!longest || variant.length > longest.text.length)) longest = { id, text: variant };
        }
    }
    check('no line runs long enough to be skipped', longest.text.length <= 110,
          `${longest.id} is ${longest.text.length} chars`);
}

console.log('\nDevice-aware give-up budgets (Patch 84)');
{
    // WHY: MOVE and DASH are the EMPTY-ROOM phase — Director refuses to spawn while
    // !tutorialCombatReady, so nothing is on screen until DASH clears. At the old flat
    // 900+900 a player who never found the controls sat in an empty room for 30
    // seconds against a 60-second conversion threshold, and on touch that is the whole
    // failing cohort. These assert the budget, not the machine, so a retune of either
    // step cannot quietly re-open the hole.

    const kbMove = Tutorial.fallbackFor('MOVE', 'keyboard');
    const kbDash = Tutorial.fallbackFor('DASH', 'keyboard');
    const tMove = Tutorial.fallbackFor('MOVE', 'touch');
    const tDash = Tutorial.fallbackFor('DASH', 'touch');

    check('touch MOVE is shorter than keyboard MOVE', tMove < kbMove, `${tMove} vs ${kbMove}`);
    check('touch DASH is shorter than keyboard DASH', tDash < kbDash, `${tDash} vs ${kbDash}`);
    check(`the touch empty-room phase fits the ${EMPTY_ROOM_BUDGET_TOUCH}-frame ceiling`,
          tMove + tDash <= EMPTY_ROOM_BUDGET_TOUCH, `${tMove} + ${tDash} = ${tMove + tDash}`);
    check('the keyboard budget is UNCHANGED — desktop pacing is not retuned here',
          kbMove === 900 && kbDash === 900, `${kbMove}, ${kbDash}`);

    // Keep clause 17, restated as a property: every step the player can be PARKED on
    // has a finite budget, in both modes. FIGHT and DOOR are excluded by design —
    // FIGHT is the silence during combat and is left by the kill override, DOOR is
    // terminal — and those are asserted to be the only two.
    for (const mode of ['keyboard', 'touch']) {
        for (const step of ['MOVE', 'DASH', 'ENGAGE', 'COLLECT', 'ASCEND', 'BANK']) {
            const b = Tutorial.fallbackFor(step, mode);
            check(`${mode}/${step} has a finite budget`,
                  Number.isFinite(b) && b > 0, `${b}`);
        }
        check(`${mode}: FIGHT is deliberately untimed`, Tutorial.fallbackFor('FIGHT', mode) === null);
        check(`${mode}: DOOR is deliberately untimed`, Tutorial.fallbackFor('DOOR', mode) === null);
    }

    // Only MOVE and DASH may differ by device. If a future patch makes ENGAGE or
    // COLLECT device-aware it should be a deliberate decision, not a side effect.
    for (const step of ['ENGAGE', 'COLLECT', 'ASCEND', 'BANK']) {
        check(`${step} is the same on both devices`,
              Tutorial.fallbackFor(step, 'keyboard') === Tutorial.fallbackFor(step, 'touch'));
    }

    // An unpublished or junk inputMode must yield the KEYBOARD budget — the safe
    // direction. The failure this guards is a desktop player being given a 6-second
    // timeout because main.js stopped publishing the field.
    check('unset inputMode reads as keyboard', Tutorial.modeOf({}) === 'keyboard');
    check('undefined state reads as keyboard', Tutorial.modeOf(undefined) === 'keyboard');
    check('junk inputMode reads as keyboard', Tutorial.modeOf({ inputMode: 'gamepad' }) === 'keyboard');
    check('touch inputMode reads as touch', Tutorial.modeOf({ inputMode: 'touch' }) === 'touch');
}

console.log('\nThe budgets actually drive the machine, in both modes');
{
    // The constants above are only worth asserting if update() reads them. Replays the
    // stuck-player path end to end and checks WHEN the room stops being empty.
    const framesToSpawnGate = (mode) => {
        const g = makeGame();
        if (mode) g.state.inputMode = mode;
        for (let f = 1; f <= 3000; f++) {
            Tutorial.update(g);                       // never moves, never dashes
            if (g.state.tutorialCombatReady) return f;
        }
        return Infinity;
    };

    const touchFrames = framesToSpawnGate('touch');
    const kbFrames = framesToSpawnGate('keyboard');
    const defaultFrames = framesToSpawnGate(undefined);

    check('a stuck TOUCH player reaches the spawn gate inside the budget',
          touchFrames <= EMPTY_ROOM_BUDGET_TOUCH + 4, `${touchFrames} frames`);
    check('a stuck KEYBOARD player keeps the original long budget',
          kbFrames > 1700 && kbFrames < 1830, `${kbFrames} frames`);
    check('an unpublished inputMode behaves exactly like keyboard',
          defaultFrames === kbFrames, `${defaultFrames} vs ${kbFrames}`);

    // Gate SEMANTICS are untouched: a touch player who demonstrates both controls
    // still advances on the action, not on the clock, and still cannot open the gate
    // by moving alone.
    const g = makeGame();
    g.state.inputMode = 'touch';
    walk(g, 60);
    check('touch: walking still advances MOVE on the action', g.state.tutorialStep === 'DASH');
    check('touch: and the gate is still closed until the dash is taught',
          g.state.tutorialCombatReady === false);
    dash(g);
    check('touch: an instant dash still cannot skip the DASH line — MIN_READ holds',
          g.state.tutorialCombatReady === false);
    idle(g, 60);
    check('touch: the recorded dash opens the gate as soon as the line has been read',
          g.state.tutorialCombatReady === true);
}

console.log('\nGuards');
{
    check('a non-tutorial state shows no banner',
          Tutorial.bannerCopy({ isTutorial: false, tutorialStep: 'MOVE' }, 'keyboard') === null);
    check('an undefined state shows no banner', Tutorial.bannerCopy(undefined, 'keyboard') === null);

    // Tutorial.update runs every frame of the tutorial; it must never be the thing
    // that throws inside the game loop's try/catch.
    let threw = false;
    try {
        Tutorial.update(undefined);
        Tutorial.update({ state: null });
        Tutorial.update({ state: { isTutorial: true } });              // no player
        Tutorial.update({ state: { isTutorial: true, player: {} } });  // no coords
    } catch (e) { threw = true; }
    check('update() survives degenerate state', threw === false);

    const g = makeGame();
    g.state.player.x = NaN;
    Tutorial.update(g);
    check('a NaN player position does not poison the movement accumulator',
          Number.isFinite(g.state.tutorialMoved), `${g.state.tutorialMoved}`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
