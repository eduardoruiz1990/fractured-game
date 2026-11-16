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
/** Patch 141: how long a notice the player opened stays open (a tap closes it sooner). */
export const NOTICE_EXPANDED_MS = 8000;

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
        // Patch 141: a notice arrives as a compact strip; tapping it opens the full
        // card, tapping the card closes it (and moves the queue on).
        el.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
        el.addEventListener('pointerdown', (e) => e.stopPropagation());
        el.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
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
        const total = Object.keys(SYNERGIES).length;
        this.pushNotice({
            stamp: 'SYNERGY FORMED', name: syn.name, recipe: synergyRecipe(syn), desc: syn.desc,
            foot: opts.isNew ? `NEW CODEX ENTRY · ${Number(opts.discovered) || 1} / ${total}` : '',
            calm: opts.calm
        });
    }

    /**
     * Patch 133: any stamped notice in the same card and the same queue — chests
     * (and, from Patch 134, evolutions) reuse it, so two rewards landing together are
     * shown one after the other instead of on top of each other.
     * @param {{stamp:string, name:string, recipe?:string, desc?:string, lines?:string[],
     *          foot?:string, calm?:boolean, tone?:string}} n
     */
    pushNotice(n) {
        if (!n || !n.name) return;
        // Patch 139: achievement notices are LOW priority. Anything else (a synergy,
        // a chest, an evolution, a room event) goes ahead of every queued low one, and
        // cuts a low one that is showing short (it goes back to the end of the queue),
        // so "Caseload" never delays the news that matters mid-fight.
        if (n.low) {
            this.queue.push(n);
        } else {
            const at = this.queue.findIndex(q => q.low);
            if (at < 0) this.queue.push(n); else this.queue.splice(at, 0, n);
            if (this.showing && this.current && this.current.low) {
                this.queue.push(this.current);
                this.current = null;
                this.next();
                return;
            }
        }
        if (!this.showing) this.next();
    }

    next() {
        const item = this.queue.shift();
        const el = this.ensureEl();
        if (!item || !el) { this.showing = false; this.current = null; this.hide(); return; }
        this.showing = true;
        this.current = item;
        const n = item;
        const lines = Array.isArray(n.lines) && n.lines.length
            ? `<ul class="syn-lines">${n.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '';
        // Patch 141: the compact strip (stamp + name + "open" hint) and the full card.
        // Both are in the DOM; CSS shows one. Something with nothing more to say than
        // its name has no "open" hint.
        const more = !!(n.recipe || n.desc || lines || n.foot || n.body);
        el.innerHTML = `
            <div class="syn-compact"><span class="syn-chip-stamp">${esc(n.stamp || '')}</span><span class="syn-chip-name">${esc(n.name)}</span>${more ? '<span class="syn-chip-more" aria-hidden="true">▾</span>' : ''}</div>
            <div class="syn-full">
            <div class="syn-stamp">${esc(n.stamp || '')}</div>
            <div class="syn-name">${esc(n.name)}</div>
            ${n.recipe ? `<div class="syn-recipe">${esc(n.recipe)}</div>` : ''}
            ${n.desc ? `<div class="syn-desc">${esc(n.desc)}</div>` : ''}
            ${n.body ? `<div class="syn-body">${n.body}</div>` : ''}
            ${lines}
            ${n.foot ? `<div class="syn-new">${esc(n.foot)}</div>` : ''}
            <div class="syn-close">TAP TO CLOSE</div>
            </div>`;
        el.classList.toggle('has-more', more);
        el.classList.toggle('expanded', !!n.expanded);
        el.title = more ? 'Open' : '';
        el.classList.toggle('calm', !!n.calm);
        el.dataset.tone = n.tone || 'synergy';
        // Restart the CSS animation for back-to-back notices.
        el.classList.remove('syn-in');
        void el.offsetWidth;
        el.classList.add('syn-in');
        el.style.display = 'block';
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.next(), n.expanded ? NOTICE_EXPANDED_MS : SYNERGY_BANNER_MS);
    }

    /** Patch 141: opens the showing notice's full card, or closes an open one. */
    toggle() {
        if (!this.showing || !this.el) return;
        if (this.el.classList.contains('expanded')) {
            clearTimeout(this.timer);
            this.next();
            return;
        }
        if (!this.el.classList.contains('has-more')) return;
        this.el.classList.add('expanded');
        if (this.current) this.current.expanded = true;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.next(), NOTICE_EXPANDED_MS);
    }

    /** Whether the full card is open (the game keeps running either way). */
    isExpanded() {
        return !!(this.el && this.showing && this.el.classList.contains('expanded'));
    }

    hide() {
        if (this.el) { this.el.style.display = 'none'; this.el.classList.remove('syn-in', 'expanded'); }
    }

    /** Drop anything pending — a run ended, or a new one started. */
    clear() {
        clearTimeout(this.timer);
        this.timer = null;
        this.queue = [];
        this.showing = false;
        this.current = null;
        this.hide();
    }
}
