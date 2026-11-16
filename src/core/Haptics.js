// src/core/Haptics.js
//
// Patch 149 (V2 plan F6): one place for vibration.
//
// Before this, five call sites each wrote their own `navigator.vibrate(...)` with no
// way to turn it off, and the moments that most need a buzz on a phone — being hit,
// a boss winding up — had none. Every buzz now goes through haptic(kind), which:
//   - respects the player's setting (gameSettings.haptics, default on);
//   - throttles per kind (a crowd landing hits must not become one long drone);
//   - never throws (iOS Safari has no vibrate; some webviews throw on it).
// The game sim never touches navigator: Game emits game.onHaptic(kind) and main.js
// forwards it here, so the Node tests stay free of browser APIs.

export const HAPTIC_PATTERNS = {
    hit: [28],                    // the player takes damage
    telegraph: [45, 35, 45],      // a boss winds up an attack
    bossIntro: [60, 40, 120],     // a boss arrives
    dash: [12],                   // a double-tap dash fired
    levelUp: [50, 50, 50],
    synergy: [30, 40, 80],
    chest: [30, 30, 60],
    evolution: [40, 40, 120],
    page: [15, 30, 15],
    event: [20, 40, 20]
};

// Minimum ms between two buzzes of the same kind.
export const HAPTIC_MIN_GAP = { hit: 350, telegraph: 600, dash: 120 };

let enabled = true;
const lastAt = {};

export function setHapticsEnabled(on) { enabled = !!on; }
export function hapticsEnabled() { return enabled; }

/**
 * Buzzes for `kind` (a HAPTIC_PATTERNS key). Returns true if a vibration was requested.
 * `now` and `nav` are injectable for tests.
 */
export function haptic(kind, now = Date.now(), nav = (typeof navigator !== 'undefined' ? navigator : null)) {
    if (!enabled) return false;
    const pattern = HAPTIC_PATTERNS[kind];
    if (!pattern) return false;
    const gap = HAPTIC_MIN_GAP[kind] || 0;
    if (gap && lastAt[kind] !== undefined && now - lastAt[kind] < gap) return false;
    lastAt[kind] = now;
    try {
        if (nav && typeof nav.vibrate === 'function') return nav.vibrate(pattern) !== false;
    } catch (e) { /* unsupported here */ }
    return false;
}

/** Test helper: forget the throttle. */
export function resetHaptics() { for (const k of Object.keys(lastAt)) delete lastAt[k]; enabled = true; }

/** Whether a boss is in one of its wind-up (telegraph) states. */
export function bossTelegraphing(ent) {
    if (!ent) return false;
    return ent.pulseState === 'charging' || ent.gazeState === 'charging'
        || ent.actionState === 'charging_collapse' || ent.shootState === 'telegraphing';
}
