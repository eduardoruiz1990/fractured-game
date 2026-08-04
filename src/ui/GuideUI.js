// src/ui/GuideUI.js
//
// Patches 55 + 56: the data-driven half of the Clinical Guide.
//
// The nine hand-written flashcards in index.html cover the core verbs (move, aim,
// Grip, Lucidity, the Void, synergies, tokens, Patient Level, Intrusive Thoughts)
// and are deliberately left alone — they are prose, and prose is fine hardcoded.
// Everything BELOW them is a catalogue: every enemy, every variant, every door
// reward, every room modifier, every weapon, every boon, every token, every curse.
// Transcribing all of that into markup would guarantee it goes stale the first time
// a value is tuned, so it renders from the same objects the game itself reads.
//
// The one unavoidable exception is documented on DOOR_REWARDS/ROOM_MODIFIERS in
// Manifestations.js: those numbers live inline in Combat.js and Director.js and are
// not exported, so they are mirrored by hand there and flagged as CHANGE BOTH.

import {
    MANIFESTATIONS, PLAYER_WEAPON_IDS, TOKENS, TOKEN_SETS, TOKEN_RARITIES,
    INTRUSIVE_THOUGHTS, SYNERGIES, DOOR_REWARDS, ROOM_MODIFIERS,
    ENEMY_VARIANTS, ENEMY_BESTIARY
} from '../data/Manifestations.js';
import { BOONS } from './LevelUpUI.js';

const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class GuideUI {
    /**
     * @param {HTMLElement} container  #guide-dynamic — receives one pane per category
     * @param {HTMLElement} navEl      #guide-nav — receives the category buttons
     * @param {HTMLElement} basicsEl   #guide-cat-basics — the hand-written prose pane,
     *                                 owned by index.html but switched like any other
     */
    constructor(container, navEl = null, basicsEl = null) {
        this.container = container;
        this.navEl = navEl || document.getElementById('guide-nav');
        this.basicsEl = basicsEl || document.getElementById('guide-cat-basics');
        this.activeId = 'basics';
    }

    /** Grid used by every generated pane — matches the basics pane's own layout. */
    static get PANE_STYLE() {
        return 'grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; overflow-y: auto; padding-right: 10px; padding-bottom: 20px;';
    }

    /**
     * Shows one category and hides the rest.
     *
     * Panes are display:grid when shown — NOT just a visibility toggle — so a hidden
     * category's cards are out of the layout entirely and cannot contribute scroll
     * height to the category actually being read.
     */
    select(id) {
        this.activeId = id;
        const panes = [this.basicsEl, ...Array.from(this.container.children)].filter(Boolean);
        panes.forEach(pane => {
            const isActive = pane.dataset && pane.dataset.category === id;
            // The basics pane comes from index.html without a dataset marker.
            const matches = pane === this.basicsEl ? (id === 'basics') : isActive;
            pane.style.display = matches ? 'grid' : 'none';
        });

        if (this.navEl) {
            Array.from(this.navEl.children).forEach(btn => {
                const on = btn.dataset.category === id;
                btn.style.background = on ? 'var(--ink-black)' : 'transparent';
                btn.style.color = on ? 'var(--paper-bg)' : 'var(--ink-black)';
                btn.style.opacity = on ? '1' : '0.75';
            });
        }
    }

    /** Section heading with a rule under it, matching the tab headings above. */
    section(title, blurb) {
        return `
            <div style="grid-column: 1 / -1; margin-top: 26px;">
                <h3 style="color: var(--ink-black); border-bottom: 2px solid var(--ink-black); padding-bottom: 6px; margin: 0 0 6px 0; letter-spacing: 2px; font-family: var(--ui-font); font-size: 1rem;">${esc(title)}</h3>
                ${blurb ? `<p class="typewriter-text" style="color:#666; font-size:0.8rem; margin:0;">${esc(blurb)}</p>` : ''}
            </div>`;
    }

    /** One catalogue entry, styled like the hand-written flashcards above it. */
    card(accent, icon, title, body, footnote) {
        return `
            <div style="background:#fdfaf3; border:2px solid ${accent}; box-shadow:4px 4px 0 rgba(0,0,0,0.12); padding:12px; display:flex; flex-direction:column; gap:6px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    ${icon ? `<span style="font-size:1.4rem; line-height:1;">${icon}</span>` : ''}
                    <strong style="color:${accent}; font-size:0.9rem; letter-spacing:1px;">${esc(title)}</strong>
                </div>
                <p class="typewriter-text" style="margin:0; font-size:0.78rem; color:#333; line-height:1.35;">${esc(body)}</p>
                ${footnote ? `<div style="font-size:0.68rem; color:#8a8172; letter-spacing:1px;">${esc(footnote)}</div>` : ''}
            </div>`;
    }

    /** Every generated category, in the order they appear in the selector. */
    buildCategories() {
        const cat = (id, label, body) => ({ id, label, body });

        return [
            cat('rooms', 'ROOMS', () => {
                let h = this.section('THE CHOICE OF DOORS',
                    'Clearing a room opens two doors. Each is marked with what it holds — the choice is always yours, and always a trade.');
                DOOR_REWARDS.forEach(r => { h += this.card(r.color, '🚪', r.name, r.effect); });

                h += this.section('ROOM CONDITIONS',
                    'Rooms past the first can carry a condition. You are told nothing in advance; read the room by what walks into it.');
                h += this.card('#777777', '◻️', 'STANDARD', 'No condition. Roughly two rooms in five.', '40%');
                ROOM_MODIFIERS.forEach(m => { h += this.card(m.color, '⚠️', m.name, m.effect, m.chance); });
                return h;
            }),

            cat('enemies', 'ENEMIES', () => {
                let h = this.section('MANIFESTATION REGISTRY',
                    'Everything the ward can produce, and what each one wants from you.');
                ENEMY_BESTIARY.forEach(e => {
                    h += this.card(e.color, e.icon, e.name, e.desc, e.boss ? 'APEX — drops a Token' : null);
                });

                h += this.section('ABERRANT STRAINS',
                    'From Floor 2 onward, ordinary manifestations can present with a strain. Floor 1 never does — learn the plain forms first.');
                ENEMY_VARIANTS.forEach(v => { h += this.card(v.color, '🧬', v.name, v.effect); });
                return h;
            }),

            cat('arsenal', 'INSTRUMENTS', () => {
                let h = this.section('INSTRUMENTS',
                    'Weapons fire on their own. Every one caps at level 5, and reaching that cap is what unlocks synergies.');
                PLAYER_WEAPON_IDS.forEach(id => {
                    const w = MANIFESTATIONS[id];
                    if (!w) return;
                    h += this.card('#4466aa', '🛠️', w.name, w.desc, `MAX LEVEL ${w.maxLvl}`);
                });

                h += this.section('SYNERGIES',
                    'Reached automatically when the required instruments are carried together at sufficient level.');
                Object.values(SYNERGIES).forEach(s => {
                    // `reqs`, not `req` — SYNERGIES uses the plural key.
                    const reqs = Array.isArray(s.reqs) ? s.reqs.join(' + ') : '';
                    h += this.card('#1a1a1a', '💀', s.name, s.desc || '', reqs ? `REQUIRES: ${reqs}` : null);
                });
                return h;
            }),

            cat('boons', 'TRAITS', () => {
                let h = this.section('MANIFESTATIONS OF SELF',
                    `The ${BOONS.length} traits offered on level-up. One-time, permanent for the run, and never offered twice.`);
                BOONS.forEach(b => {
                    h += this.card(b.color, b.icon, b.name, b.desc, b.tags.join(' · ').toUpperCase());
                });
                return h;
            }),

            cat('tokens', 'TOKENS', () => {
                let h = this.section('TOKENS',
                    'Dropped by Apex manifestations, prescribed in THERAPY REGIMEN. Rarity multiplies their positive effects.');
                h += this.card('#8a8172', '💠', 'RARITY LADDER',
                    Object.entries(TOKEN_RARITIES).map(([k, v]) => `${k} ×${v.multiplier}`).join('   ·   '),
                    'FORGE COSTS RISE WITH EACH TIER');
                Object.values(TOKENS).forEach(t => {
                    const set = TOKEN_SETS[t.set];
                    h += this.card('#aa55ff', '🎭', t.name, t.desc, `${t.type.toUpperCase()}${set ? ` · ${set.name}` : ''}`);
                });

                h += this.section('SET BONUSES',
                    'Prescribe matching pieces to unlock these. Counted across all equipped slots.');
                Object.values(TOKEN_SETS).forEach(s => {
                    h += this.card('#8b0000', '🧩', s.name, `(2) ${s['2']}\n(4) ${s['4']}`);
                });
                return h;
            }),

            cat('curses', 'THOUGHTS', () => {
                let h = this.section('INTRUSIVE THOUGHTS',
                    'Optional permanent handicaps. Each raises the Lucidity you earn — the worse the thought, the better the payout.');
                Object.values(INTRUSIVE_THOUGHTS).forEach(c => {
                    h += this.card('#5a2a7a', '🧠', c.name, c.desc, `+${c.lucidityWeight}% LUCIDITY`);
                });
                return h;
            })
        ];
    }

    render() {
        if (!this.container) return;

        const categories = this.buildCategories();

        this.container.innerHTML = categories.map(c =>
            `<div class="guide-pane" data-category="${c.id}" style="display:none; ${GuideUI.PANE_STYLE}">${c.body()}</div>`
        ).join('');

        // BASICS first — it is the only category a first-time player actually needs,
        // and the one the old single-scroll guide buried everything else under.
        if (this.navEl) {
            const all = [{ id: 'basics', label: 'CONTROLS' }, ...categories.map(c => ({ id: c.id, label: c.label }))];
            this.navEl.innerHTML = all.map(c =>
                `<button type="button" class="file-btn small" data-category="${c.id}" style="padding:6px 14px; font-size:0.7rem; letter-spacing:1px; width:auto;">${c.label}</button>`
            ).join('');
            Array.from(this.navEl.children).forEach(btn => {
                btn.addEventListener('click', () => this.select(btn.dataset.category));
            });
        }

        this.select('basics');
    }
}
