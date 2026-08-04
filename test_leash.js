/**
 * Enemy leash behaviour (Patches 58 / 60 / 61).
 *
 * Run with:  node test_leash.js
 *
 * WHY THIS FILE EXISTS: a player reported dying repeatedly because the last one or
 * two enemies in a room never arrived. The cause was not that they were too far —
 * it was that the leash used a FIXED 520px soft threshold while the visible
 * half-height at 1080p is only ~415px. An enemy that stopped moving in that band
 * (a Scavenger in its 'vacuuming' state does exactly that) was simultaneously off
 * screen and ignored by the correction, permanently. The pull also released the
 * instant an enemy crossed the threshold, so its resting place WAS the threshold —
 * i.e. just out of sight even when the leash "worked".
 *
 * Both are cheap to reintroduce by tuning a constant, so they are asserted here
 * against the real entity code rather than left to manual playtesting.
 */

import { Scavenger } from './src/entities/Scavenger.js';
import { Boss } from './src/entities/Boss.js';

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

// A 1920x1080 viewport at Renderer's MAX zoom (1.3) — the tightest view the player
// can have, and therefore the one the leash must be correct for.
const W = 1920, H = 1080, MAX_ZOOM = 1.3;
const VISIBLE_HALF_H = (H / 2) / MAX_ZOOM;          // ~415
const VIEW_SAFE = Math.min(W, H) * 0.25;            // 270, Director's tutorial radius

const makeState = (isTutorial = false) => ({
    isTutorial,
    viewSafeRadius: VIEW_SAFE,
    viewHalfExtent: VISIBLE_HALF_H,
    player: { x: 0, y: 0, angle: 0, radius: 12 },
    entities: [],
    xpDrops: []
});

const dist = (e) => Math.hypot(e.x, e.y);

/** Spawns a Scavenger and holds its own AI intent at zero, as 'vacuuming' does. */
const inertScavengerAt = (x, y) => {
    const e = new Scavenger();
    e.init(Math.random(), x, y, 1.0);
    return e;
};
const tick = (e, state, frames) => {
    for (let i = 0; i < frames; i++) { e.vx = 0; e.vy = 0; e.applyMovement(state, null); }
};

console.log('\nPooling hygiene');
{
    const e = inertScavengerAt(100, 0);
    e.strayTime = 999;
    e.init(Math.random(), 50, 0, 1.0);
    check('strayTime resets on pool reuse (a recycled straggler must not spawn sprinting)',
          e.strayTime === 0, `got ${e.strayTime}`);
}

console.log('\nOff-screen dead zone (the reported bug)');
{
    // The exact band that used to be invisible AND uncorrected.
    [430, 470, 515].forEach(start => {
        const state = makeState();
        const e = inertScavengerAt(0, start);
        tick(e, state, 600);
        check(`a motionless enemy at ${start}px (off screen) is pulled back in`,
              dist(e) < start - 50, `still at ${dist(e).toFixed(0)}px after 10s`);
    });

    const state = makeState();
    const e = inertScavengerAt(0, 800);
    tick(e, state, 900);
    check('a recalled enemy settles ON screen, not resting on the threshold',
          dist(e) < VISIBLE_HALF_H, `settled at ${dist(e).toFixed(0)}px, visible limit ${VISIBLE_HALF_H.toFixed(0)}px`);
}

console.log('\nThe leash leaves visible enemies alone');
{
    const state = makeState();
    const e = inertScavengerAt(0, VISIBLE_HALF_H * 0.9);
    tick(e, state, 600);
    check('an enemy already on screen is never dragged around',
          e.strayTime === 0 && Math.abs(dist(e) - VISIBLE_HALF_H * 0.9) < 1,
          `strayTime ${e.strayTime}, dist ${dist(e).toFixed(0)}`);
}

console.log('\nHard recall');
{
    const state = makeState();
    const e = inertScavengerAt(4000, 0);
    e.applyMovement(state, null);
    check('a genuinely lost enemy is teleported back into view',
          dist(e) < VISIBLE_HALF_H, `recalled to ${dist(e).toFixed(0)}px`);
    check('the catch-up boost is cleared after a teleport', e.strayTime === 0);

    const b = new Boss();
    b.init(Math.random(), 5000, 0, 1.0);
    b.vx = 0; b.vy = 0;
    b.applyMovement(makeState(), null);
    check('bosses are never leashed or teleported', dist(b) > 4000, `boss moved to ${dist(b).toFixed(0)}px`);
}

console.log('\nTutorial (single enemy — must stay findable)');
{
    const state = makeState(true);
    const e = inertScavengerAt(4000, 0);
    e.applyMovement(state, null);
    check('the tutorial enemy is returned to the on-screen spawn radius, not 700px',
          dist(e) <= VIEW_SAFE + 1 && dist(e) < VISIBLE_HALF_H,
          `returned to ${dist(e).toFixed(0)}px`);

    const tut = makeState(true);
    const normal = makeState(false);
    const a = inertScavengerAt(650, 0);
    const b = inertScavengerAt(650, 0);
    a.applyMovement(tut, null);
    b.applyMovement(normal, null);
    check('the tutorial recalls far sooner than an ordinary room',
          dist(a) <= VIEW_SAFE + 1 && dist(b) > 600,
          `tutorial ${dist(a).toFixed(0)}px, normal ${dist(b).toFixed(0)}px`);
}

console.log('\nDegraded input');
{
    const state = makeState(true);
    delete state.viewHalfExtent;
    delete state.viewSafeRadius;
    const e = inertScavengerAt(4000, 0);
    e.applyMovement(state, null);
    check('still recalls sanely before Director has published viewport metrics',
          Number.isFinite(dist(e)) && dist(e) <= 221, `got ${dist(e).toFixed(0)}px`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
