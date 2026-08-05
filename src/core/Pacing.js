// src/core/Pacing.js
//
// Patch 74 — the fixed-timestep clock, extracted so it can be tested.
//
// THE BUG THIS EXISTS TO PREVENT. Before this patch there was no delta time at all:
// `gameLoop(time)` used its timestamp for the menu background and nothing else, while
// the entire simulation counts FRAMES — `state.frame++`, `budgetTimer`, dash timers,
// cooldowns, particle decay, and every velocity is a per-frame add. The game
// therefore ran at whatever rate the display refreshed. On a 120Hz phone that is
// double speed, and when the device cannot hold 120 the frame time varies, so the
// game SPEED varies with it. That inconsistency is what reads as sluggish.
//
// The rules here are small but every one of them is load-bearing, and all three
// failure modes (spiral of death, banked debt, resume-from-background burst) are
// invisible until they happen on someone else's device. Hence a pure module and
// test_pacing.js rather than a few lines inline in the loop.

export const SIM_STEP_MS = 1000 / 60;

/** Below 20fps the game slows down instead of demanding more catch-up work. */
export const MAX_SIM_STEPS = 3;

/** One gap longer than this (backgrounded tab, phone call, breakpoint) is discarded. */
export const MAX_FRAME_DELTA_MS = 100;

export class Pacing {
    constructor() {
        this.accumulator = 0;
        this.lastFrameTime = 0;
    }

    /** Called when a run starts, so menu time is never spent as simulation time. */
    reset() {
        this.accumulator = 0;
        this.lastFrameTime = 0;
    }

    /**
     * Feeds one rAF timestamp in. Total by construction: a non-finite or backwards
     * timestamp (some in-app webviews have both) falls back to one nominal step
     * rather than poisoning the accumulator with NaN, which would freeze the game
     * permanently since NaN >= anything is false.
     */
    addFrame(time) {
        const now = Number.isFinite(time) ? time : 0;
        let delta = this.lastFrameTime > 0 ? now - this.lastFrameTime : SIM_STEP_MS;
        this.lastFrameTime = now;
        if (!Number.isFinite(delta) || delta < 0) delta = SIM_STEP_MS;

        // Bounded at the ceiling rather than left to grow: the menus never drain this,
        // so without the clamp a minute on the title screen banks a minute of
        // simulation debt and spends it the instant a run starts.
        this.accumulator = Math.min(
            this.accumulator + Math.min(delta, MAX_FRAME_DELTA_MS),
            MAX_SIM_STEPS * SIM_STEP_MS
        );
    }

    /** How many fixed steps this frame owes. Consumes them from the accumulator. */
    takeSteps() {
        let steps = Math.floor(this.accumulator / SIM_STEP_MS);
        if (steps > MAX_SIM_STEPS) {
            steps = MAX_SIM_STEPS;
            this.accumulator = 0;   // drop the backlog rather than chase it
        } else {
            this.accumulator -= steps * SIM_STEP_MS;
        }
        return steps;
    }
}
