// src/systems/AutoAim.js
//
// Patch 148 (V2 plan F1): aim assist.
//
// On a phone the right thumb had two jobs — aiming and pressing DASH — and could not do
// both. With aim assist on, the flashlight (and every weapon that reads the player's
// angle) turns towards the nearest threat by itself, and the right stick becomes an
// OVERRIDE: while it is held, the player aims; when it is let go, assist takes over
// again from wherever it was left. With nothing in range, the light follows the
// direction of travel, so it is never left pointing at a wall behind you.
//
// Rules (pure; tested in test_input.js):
//   - targets: live, visible enemies (not dead, not burrowed) within AUTO_AIM_RANGE;
//   - the nearest wins, but the CURRENT target is kept while it is no more than
//     AUTO_AIM_STICKY times further than the nearest — so the light does not flick
//     between two enemies at almost the same distance;
//   - the angle turns at most AUTO_AIM_TURN radians a sim step (about 0.3 s for a half
//     turn), so the cone sweeps rather than snaps.
//
// Whether it is on is the player's setting: 'auto' (on for touch, off with a mouse),
// 'on' or 'off' (autoAimEnabled). State lives on state.autoAim = { targetId }.

export const AUTO_AIM_RANGE = 520;
export const AUTO_AIM_STICKY = 1.25;
export const AUTO_AIM_TURN = 0.2;
export const AUTO_AIM_MODES = ['auto', 'on', 'off'];

/** Whether assist is on for this setting and control scheme ('touch' | 'keyboard'). */
export function autoAimEnabled(setting, inputMode) {
    if (setting === 'on') return true;
    if (setting === 'off') return false;
    return inputMode === 'touch';
}

function aimable(e) {
    return !!e && !e.dead && !(e.hp <= 0) && !e.burrowed && Number.isFinite(e.x) && Number.isFinite(e.y);
}

/** The enemy to aim at (or null), keeping `prevId` when it is close enough to the nearest. */
export function pickTarget(entities, px, py, prevId = null, range = AUTO_AIM_RANGE) {
    let best = null, bestD = Infinity, prev = null, prevD = Infinity;
    const r2 = range * range;
    for (const e of entities || []) {
        if (!aimable(e)) continue;
        const dx = e.x - px, dy = e.y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        if (d2 < bestD) { bestD = d2; best = e; }
        if (prevId !== null && e.id === prevId) { prev = e; prevD = d2; }
    }
    if (prev && Math.sqrt(prevD) <= Math.sqrt(bestD) * AUTO_AIM_STICKY) return prev;
    return best;
}

/** Turns `from` towards `to` by at most `maxTurn`, the short way round. */
export function turnTowards(from, to, maxTurn = AUTO_AIM_TURN) {
    if (!Number.isFinite(from)) return Number.isFinite(to) ? to : 0;
    if (!Number.isFinite(to)) return from;
    let diff = to - from;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) <= maxTurn) return to;
    return from + Math.sign(diff) * maxTurn;
}

/**
 * One sim step of assist. Returns the angle to aim at this step and records the
 * target on state.autoAim. `input` is the move input ({ moveX, moveY, isMoving }).
 */
export function autoAimStep(state, input = {}) {
    const p = state.player;
    if (!state.autoAim) state.autoAim = { targetId: null };
    const cur = Number.isFinite(p.angle) ? p.angle : 0;
    const t = pickTarget(state.entities, p.x, p.y, state.autoAim.targetId);
    state.autoAim.targetId = t ? t.id : null;
    let goal = cur;
    if (t) goal = Math.atan2(t.y - p.y, t.x - p.x);
    else if (input.isMoving && (input.moveX || input.moveY)) goal = Math.atan2(input.moveY, input.moveX);
    return turnTowards(cur, goal, AUTO_AIM_TURN);
}
