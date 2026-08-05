/**
 * Fixed-timestep clock (Patch 74).
 *
 * Run with:  node test_pacing.js
 *
 * WHY THIS FILE EXISTS: before this patch the simulation ran at the display's refresh
 * rate — double speed on a 120Hz phone, and varying with the framerate whenever such a
 * device could not hold it. The accumulator that fixes it has three classic failure
 * modes, and every one of them is invisible on the machine you develop on:
 *
 *   1. spiral of death — a slow device is asked for more catch-up work each frame,
 *      which makes it slower, forever;
 *   2. banked debt — time accumulated while nothing is stepping (menus) gets spent in
 *      one burst the moment a run starts;
 *   3. resume burst — a backgrounded tab returns with a multi-second gap and the game
 *      fast-forwards through it.
 *
 * The properties asserted here are "60Hz is 60Hz on every panel" and "no burst is ever
 * larger than the cap", which is the whole contract the rest of the game's per-frame
 * tuning now rests on.
 */

import { Pacing, SIM_STEP_MS, MAX_SIM_STEPS, MAX_FRAME_DELTA_MS } from './src/core/Pacing.js';

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

/** Runs `seconds` of wall clock at a given refresh rate, returning total sim steps. */
function simulate(hz, seconds) {
    const p = new Pacing();
    const frameMs = 1000 / hz;
    const frames = Math.round(hz * seconds);
    let steps = 0;
    let t = 0;
    for (let i = 0; i < frames; i++) {
        t += frameMs;
        p.addFrame(t);
        steps += p.takeSteps();
    }
    return steps;
}

console.log('\nOne second of wall clock is 60 steps on every panel');
{
    // The actual bug: at 120Hz the old loop ran 120 simulation frames per second, so
    // enemies moved, timers ran and spawns fired at double the tuned rate.
    [[30, 'a struggling phone'], [60, 'a normal panel'], [75, 'an odd refresh rate'],
     [90, 'a gaming phone'], [120, 'the Samsung A56'], [144, 'a desktop monitor'],
     [165, 'a high-refresh monitor']].forEach(([hz, name]) => {
        const steps = simulate(hz, 1);
        check(`${String(hz).padStart(3)}Hz (${name}): ${steps} steps/sec`,
              Math.abs(steps - 60) <= 1, `expected ~60, got ${steps}`);
    });
}

console.log('\nOver a longer run the clock does not drift');
{
    [30, 60, 120, 144].forEach(hz => {
        const steps = simulate(hz, 10);
        check(`${String(hz).padStart(3)}Hz: 10s of play is ~600 steps`,
              Math.abs(steps - 600) <= 2, `got ${steps}`);
    });
}

console.log('\nNo spiral of death below the cap');
{
    // 10fps: real time would need 6 steps per frame. It must clamp and let the game
    // run slow instead of demanding ever more work from a device already failing.
    const p = new Pacing();
    let t = 0, worst = 0;
    for (let i = 0; i < 100; i++) {
        t += 100;             // 10fps
        p.addFrame(t);
        worst = Math.max(worst, p.takeSteps());
    }
    check('a 10fps device never gets asked for more than the cap',
          worst <= MAX_SIM_STEPS, `worst frame asked for ${worst}`);

    const steps = simulate(10, 1);
    check('and it degrades to slow motion rather than stalling',
          steps > 0 && steps < 60, `${steps} steps in a second`);
}

console.log('\nBanked debt (the menus never step)');
{
    // A minute on the title screen accumulates without ever draining. Without the
    // ceiling that is a minute of simulation spent in one frame when the run starts.
    const p = new Pacing();
    let t = 0;
    for (let i = 0; i < 3600; i++) { t += 16.7; p.addFrame(t); }  // 60s, no takeSteps
    const burst = p.takeSteps();
    check('a minute of unspent menu time cannot burst into the first frame of a run',
          burst <= MAX_SIM_STEPS, `first frame asked for ${burst} steps`);
}

console.log('\nResume from background');
{
    const p = new Pacing();
    p.addFrame(1000);
    p.takeSteps();
    p.addFrame(1000 + 30000);   // 30 seconds backgrounded
    const burst = p.takeSteps();
    check('a 30s gap does not fast-forward the game',
          burst <= MAX_SIM_STEPS, `asked for ${burst} steps`);
    check(`single-gap clamp is ${MAX_FRAME_DELTA_MS}ms`, MAX_FRAME_DELTA_MS <= 250);
}

console.log('\nDegenerate timestamps');
{
    // Some in-app webviews hand rAF a non-monotonic or missing timestamp. NaN in the
    // accumulator would freeze the game permanently — NaN >= x is false, so takeSteps
    // would return 0 for the rest of the session.
    const p = new Pacing();
    p.addFrame(undefined);
    p.addFrame(NaN);
    p.addFrame(100);
    p.addFrame(50);             // clock went backwards
    p.addFrame(60);
    const steps = p.takeSteps();
    check('never poisons the accumulator with NaN',
          Number.isFinite(p.accumulator) && Number.isFinite(steps),
          `accumulator ${p.accumulator}, steps ${steps}`);
    check('and still produces steps afterwards', steps >= 1, `${steps}`);

    const p2 = new Pacing();
    p2.addFrame(0);
    check('the very first frame yields exactly one step',
          p2.takeSteps() === 1);
}

console.log('\nreset()');
{
    const p = new Pacing();
    let t = 0;
    for (let i = 0; i < 100; i++) { t += 16.7; p.addFrame(t); }
    p.reset();
    check('drops banked time', p.accumulator === 0);
    p.addFrame(99999);
    check('and treats the next frame as the first one, not as a 99s gap',
          p.takeSteps() === 1);
}

console.log('\nStep size');
{
    check('the simulation step is 60Hz', Math.abs(SIM_STEP_MS - 16.666) < 0.01, `${SIM_STEP_MS}`);
    check('the cap keeps real time down to 20fps',
          MAX_SIM_STEPS * SIM_STEP_MS >= 1000 / 20 - 0.01,
          `${MAX_SIM_STEPS} steps covers ${(MAX_SIM_STEPS * SIM_STEP_MS).toFixed(1)}ms`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
