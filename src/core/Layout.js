// src/core/Layout.js
//
// Patch 71 — the one decision that separates the desktop layout from the portrait
// phone layout.
//
// It lives in its own pure module for one reason: it is a safety property, not a
// preference. Every portrait-only behaviour in the game (the reserved control band,
// the raised camera centre, the lower zoom floor) hangs off this single boolean, so
// if it can ever return true for a desktop, a desktop player gets a phone layout
// with no way to escape it. A function with no DOM and no state can be driven
// directly by test_viewport.js against the exact viewports that matter, which a
// predicate buried in main.js's resize handler could not be.
//
// Keep it total and keep it boring. Anything that needs to know "are we in portrait
// mode" asks here rather than re-deriving its own version of the answer.

/** Above this CSS width a portrait viewport is a tablet or a desktop, not a phone. */
export const PORTRAIT_MAX_WIDTH = 820;

/**
 * @param {object} v
 * @param {boolean} v.touch   a touch-capable pointer is present
 * @param {number}  v.width   viewport width in CSS px
 * @param {number}  v.height  viewport height in CSS px
 * @returns {boolean} true only for a touch device held taller than wide, at phone size
 *
 * All three conditions are required. In particular the touch check means a mouse
 * user who drags their browser window tall and narrow keeps the desktop layout —
 * the portrait layout exists to get thumbs off the play area, and there are no
 * thumbs on a desktop.
 */
export function isPortraitLayout(v) {
    if (!v || !v.touch) return false;
    const w = Number.isFinite(v.width) ? v.width : 0;
    const h = Number.isFinite(v.height) ? v.height : 0;
    if (w <= 0 || h <= 0) return false;
    return h > w && w <= PORTRAIT_MAX_WIDTH;
}
