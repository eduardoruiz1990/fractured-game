// src/ui/Juice.js
//
// Patch 130 (V2 plan C8): screen-space feedback that is DOM, not canvas — a radial
// flash over the play area for moments the whole screen should acknowledge (a
// level-up). Canvas-side juice (slow motion, impact freeze, fragment bursts) lives in
// Combat/Game through state.hitStop / state.slowMo and Director's particles.
//
// The flash is skipped entirely in photosensitivity mode, and is a single CSS
// animation on one lazily created element (pointer-events: none), so it costs
// nothing when idle and cannot take input.

export const FLASH_MS = 450;

const FLASH_KINDS = {
    levelup: 'radial-gradient(circle at 50% 50%, rgba(255, 221, 140, 0.55) 0%, rgba(197, 160, 89, 0.22) 35%, rgba(0, 0, 0, 0) 70%)'
};

let flashEl = null;
let flashTimer = null;

/**
 * @param {'levelup'} kind
 * @param {{calm?: boolean}} opts  calm = photosensitivity setting: no flash at all
 * @returns {boolean} whether a flash was shown
 */
export function screenFlash(kind, opts = {}) {
    if (opts.calm) return false;
    if (typeof document === 'undefined') return false;
    const bg = FLASH_KINDS[kind];
    if (!bg) return false;
    if (!flashEl) {
        const host = document.getElementById('game-container') || document.body;
        if (!host) return false;
        flashEl = document.createElement('div');
        flashEl.id = 'juice-flash';
        host.appendChild(flashEl);
    }
    flashEl.style.background = bg;
    flashEl.classList.remove('juice-flash-on');
    void flashEl.offsetWidth;   // restart the animation on back-to-back flashes
    flashEl.classList.add('juice-flash-on');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { if (flashEl) flashEl.classList.remove('juice-flash-on'); }, FLASH_MS);
    return true;
}
