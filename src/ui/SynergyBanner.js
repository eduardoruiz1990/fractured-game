// src/ui/SynergyBanner.js
//
// Patch 126 (V2 plan C3): the synergy-formed moment.
//
// Before this patch a synergy activated in complete silence: the player picked a
// card, the flashlight started strobing, and nothing on screen said why. Synergies
// are the build-defining reward of a run, so forming one now gets a stamped notice
// over the game naming it, saying which two instruments made it and what it does,
// and — the first time this profile ever forms it — "NEW CODEX ENTRY · n / 10".
//
// DOM, not canvas: it is text over the game like #tutorial-banner, it never takes
// input (pointer-events: none), and it is created lazily so index.html is untouched.
// Two synergies can form from one pick (or one WEAPON_UPGRADE door), so notices are
// queued and shown one after another rather than overwriting each other.

import { SYNERGIES, MANIFESTATIONS } from '../data/Manifestations.js';

export const SYNERGY_BANNER_MS = 3600;

const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "Rusted Flashlight + Static Receiver" — display names, never raw ids. */
export function synergyRecipe(synergy) {
    if (!synergy || !Array.isArray(synergy.reqs)) return '';
    return synergy.reqs.map(id => (MANIFESTATIONS[id] && MANIFESTATIONS[id].name) || id).join(' + ');
}

export class SynergyBanner {
    constructor(parent = null) {
        this.parent = parent;
        this.el = null;
        this.queue = [];
        this.timer = null;
        this.showing = false;
    }

    ensureEl() {
        if (this.el) return this.el;
        if (typeof document === 'undefined') return null;
        const host = this.parent || document.getElementById('game-container') || document.body;
        if (!host) return null;
        const el = document.createElement('div');
        el.id = 'synergy-banner';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        host.appendChild(el);
        this.el = el;
        return el;
    }

    /**
     * @param {string} id          SYNERGIES key
     * @param {object} opts
     * @param {boolean} opts.isNew       first time this profile formed it
     * @param {number}  opts.discovered  codex count AFTER recording this one
     * @param {boolean} opts.calm        photosensitivity: fade only, no stamp slam
     */
    push(id, opts = {}) {
        const syn = SYNERGIES[id];
        if (!syn) return;
        this.queue.push({ syn, opts });
        if (!this.showing) this.next();
    }

    next() {
        const item = this.queue.shift();
        const el = this.ensureEl();
        if (!item || !el) { this.showing = false; this.hide(); return; }
        this.showing = true;
        const { syn, opts } = item;
        const total = Object.keys(SYNERGIES).length;
        el.innerHTML = `
            <div class="syn-stamp">SYNERGY FORMED</div>
            <div class="syn-name">${esc(syn.name)}</div>
            <div class="syn-recipe">${esc(synergyRecipe(syn))}</div>
            <div class="syn-desc">${esc(syn.desc)}</div>
            ${opts.isNew ? `<div class="syn-new">NEW CODEX ENTRY · ${Number(opts.discovered) || 1} / ${total}</div>` : ''}`;
        el.classList.toggle('calm', !!opts.calm);
        // Restart the CSS animation for back-to-back notices.
        el.classList.remove('syn-in');
        void el.offsetWidth;
        el.classList.add('syn-in');
        el.style.display = 'block';
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.next(), SYNERGY_BANNER_MS);
    }

    hide() {
        if (this.el) { this.el.style.display = 'none'; this.el.classList.remove('syn-in'); }
    }

    /** Drop anything pending — a run ended, or a new one started. */
    clear() {
        clearTimeout(this.timer);
        this.timer = null;
        this.queue = [];
        this.showing = false;
        this.hide();
    }
}
