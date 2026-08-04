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
    constructor(container) {
        this.container = container;
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

    render() {
        if (!this.container) return;

        let html = '';

        // --- Patch 55: room choice ------------------------------------------
        html += this.section('X. THE CHOICE OF DOORS',
            'Clearing a room opens two doors. Each is marked with what it holds — the choice is always yours, and always a trade.');
        DOOR_REWARDS.forEach(r => {
            html += this.card(r.color, '🚪', r.name, r.effect);
        });

        html += this.section('XI. ROOM CONDITIONS',
            'Rooms past the first can carry a condition. You are told nothing in advance; read the room by what walks into it.');
        html += this.card('#777777', '◻️', 'STANDARD', 'No condition. Roughly two rooms in five.', '40%');
        ROOM_MODIFIERS.forEach(m => {
            html += this.card(m.color, '⚠️', m.name, m.effect, m.chance);
        });

        // --- Patch 56: bestiary ---------------------------------------------
        html += this.section('XII. MANIFESTATION REGISTRY',
            'Everything the ward can produce, and what each one wants from you.');
        ENEMY_BESTIARY.forEach(e => {
            html += this.card(e.color, e.icon, e.name, e.desc, e.boss ? 'APEX — drops a Token' : null);
        });

        html += this.section('XIII. ABERRANT STRAINS',
            'From Floor 2 onward, ordinary manifestations can present with a strain. Floor 1 never does — learn the plain forms first.');
        ENEMY_VARIANTS.forEach(v => {
            html += this.card(v.color, '🧬', v.name, v.effect);
        });

        // --- Patch 56: weapons ----------------------------------------------
        html += this.section('XIV. INSTRUMENTS',
            'Weapons fire on their own. Every one caps at level 5, and reaching that cap is what unlocks synergies.');
        PLAYER_WEAPON_IDS.forEach(id => {
            const w = MANIFESTATIONS[id];
            if (!w) return;
            html += this.card('#4466aa', '🛠️', w.name, w.desc, `MAX LEVEL ${w.maxLvl}`);
        });

        // --- Patch 56: synergies --------------------------------------------
        html += this.section('XV. SYNERGIES',
            'Reached automatically when the required instruments are carried together at sufficient level.');
        Object.values(SYNERGIES).forEach(s => {
            // `reqs`, not `req` — SYNERGIES uses the plural key.
            const reqs = Array.isArray(s.reqs) ? s.reqs.join(' + ') : '';
            html += this.card('#1a1a1a', '💀', s.name, s.desc || '', reqs ? `REQUIRES: ${reqs}` : null);
        });

        // --- Patch 56: boons ------------------------------------------------
        html += this.section('XVI. MANIFESTATIONS OF SELF',
            `The ${BOONS.length} boons offered on level-up. One-time, permanent for the run, and never offered twice.`);
        BOONS.forEach(b => {
            html += this.card(b.color, b.icon, b.name, b.desc, b.tags.join(' · ').toUpperCase());
        });

        // --- Patch 56: tokens -----------------------------------------------
        html += this.section('XVII. TOKENS',
            'Dropped by Apex manifestations, prescribed in THERAPY REGIMEN. Rarity multiplies their positive effects.');
        html += this.card('#8a8172', '💠', 'RARITY LADDER',
            Object.entries(TOKEN_RARITIES)
                .map(([k, v]) => `${k} ×${v.multiplier}`).join('   ·   '),
            'FORGE COSTS RISE WITH EACH TIER');
        Object.values(TOKENS).forEach(t => {
            const set = TOKEN_SETS[t.set];
            html += this.card('#aa55ff', '🎭', t.name, t.desc,
                `${t.type.toUpperCase()}${set ? ` · ${set.name}` : ''}`);
        });

        html += this.section('XVIII. SET BONUSES',
            'Prescribe matching pieces to unlock these. Counted across all equipped slots.');
        Object.values(TOKEN_SETS).forEach(s => {
            html += this.card('#8b0000', '🧩', s.name, `(2) ${s['2']}\n(4) ${s['4']}`);
        });

        // --- Patch 56: curses -----------------------------------------------
        html += this.section('XIX. INTRUSIVE THOUGHTS',
            'Optional permanent handicaps. Each raises the Lucidity you earn — the worse the thought, the better the payout.');
        Object.values(INTRUSIVE_THOUGHTS).forEach(c => {
            html += this.card('#5a2a7a', '🧠', c.name, c.desc, `+${c.lucidityWeight}% LUCIDITY`);
        });

        this.container.innerHTML = html;
    }
}
