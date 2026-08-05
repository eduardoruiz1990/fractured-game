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

import { Tutorial, TUTORIAL_COPY } from './src/systems/Tutorial.js';

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
