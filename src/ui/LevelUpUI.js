// MANIFESTATIONS is NOT the level-up boon pool despite appearing to be — the real
// pool is BOONS, below. Patch 125 imports it (and SYNERGIES) for what it is: the
// weapons' display names and descriptions, and the synergy pairs a card can preview.
import { getActiveSynergies, MANIFESTATIONS, SYNERGIES } from '../data/Manifestations.js';
// Patch 95 — the weapon ceiling comes off in THE RECURSION. See src/core/Endless.js.
import { weaponLevelCap, isEndless } from '../core/Endless.js';
import { haptic } from '../core/Haptics.js';   // Patch 149
import { MAX_WEAPON_SLOTS, ownedWeaponCount } from '../data/Config.js';   // Patch 132
// Patch 134: evolution hints on the cards. (Evolutions.js imports BOONS from here;
// both sides only touch the other inside functions, so the cycle is safe.)
import { evolutionForWeapon, evolutionsForBoon, evolveLevel } from '../systems/Evolutions.js';

/**
 * The level-up boon pool — the real one.
 *
 * Patch 56/57: this used to be a `const BOONS` local to show(), which meant nothing
 * outside that one method could read it. The Clinical Guide needs it to document
 * boons without transcribing them by hand (a copy would drift the first time a
 * value changed), and the history tracker needs it to name a recorded pick. Moving
 * it to a module export changes no behaviour — show() reads the same array.
 *
 * `tags` mirrors the 12-tag vocabulary used by state.player.weapons, so offers can
 * later be weighted toward the build the player is already committing to. Every
 * boon here has a real implementation — see selectCard() below for the
 * instant-apply ones, and the boons.includes() hooks in Game.js / Combat.js for the
 * persistent ones.
 */
export const BOONS = [
    { id: 'kinetic_dash', name: 'Kinetic Routing', desc: 'Dashing damages enemies you pass through.', color: '#00ffcc', icon: '⚡', tags: ['kinetic', 'utility'] },
    { id: 'toxic_blood', name: 'Toxic Blood', desc: 'Taking damage spawns a Spilled Ink hazard at your feet.', color: '#aa00ff', icon: '🩸', tags: ['hazard', 'dark'] },
    { id: 'tunnel_vision', name: 'Hyperfocus', desc: 'Flashlight cone width is halved, but damage is doubled.', color: '#ffcc00', icon: '🔦', tags: ['light', 'focus'] },
    { id: 'adrenaline_surge', name: 'Adrenaline Surge', desc: 'Dropping below 30% Sanity doubles your movement speed.', color: '#ff0033', icon: '💉', tags: ['kinetic', 'passive'] },
    { id: 'iron_will', name: 'Iron Will', desc: 'Max Sanity increased by 50.', color: '#ffffff', icon: '🛡️', tags: ['passive', 'utility'] },
    { id: 'glass_cannon', name: 'Glass Cannon', desc: 'Flashlight and Static damage doubled, but Sanity drains twice as fast.', color: '#ff4444', icon: '💥', tags: ['passive', 'kinetic'] },
    { id: 'vampirism', name: 'Vampirism', desc: 'Melee kills restore 2 Sanity.', color: '#bb0000', icon: '🦇', tags: ['melee', 'dark'] },
    { id: 'static_discharge', name: 'Static Discharge', desc: 'Taking damage triggers a massive Static AoE.', color: '#00ffff', icon: '⚡', tags: ['aura', 'tech'] },
    { id: 'lead_shoes', name: 'Lead Shoes', desc: 'Cannot Dash. Max Sanity +200.', color: '#777777', icon: '🥾', tags: ['passive', 'utility'] },
    { id: 'shadow_step', name: 'Shadow Step', desc: 'Dashing grants 1 second of invisibility (enemies lose tracking).', color: '#555555', icon: '🥷', tags: ['dark', 'utility'] },

    { id: 'steady_hands', name: 'Steady Hands', desc: 'All weapon cooldowns reduced by 20%.', color: '#88ccff', icon: '🤲', tags: ['focus', 'tech'] },
    { id: 'wide_lens', name: 'Wide Lens', desc: 'Flashlight range +40%, but its damage drops by 10%.', color: '#ffdd88', icon: '🔎', tags: ['light', 'burst'] },
    { id: 'overcharge', name: 'Overcharge', desc: 'Static Receiver radius +50% and damage +30%.', color: '#66ffff', icon: '🔌', tags: ['aura', 'tech'] },
    { id: 'heavy_swing', name: 'Heavy Swing', desc: 'Pipe damage +60%, but it swings 20% slower.', color: '#cc8844', icon: '🔨', tags: ['melee', 'kinetic'] },
    { id: 'ink_flood', name: 'Ink Flood', desc: 'Spilled Ink pools are 50% larger and drop far more often.', color: '#8822cc', icon: '🌊', tags: ['hazard', 'dark'] },
    { id: 'sharpened_blades', name: 'Sharpened Blades', desc: 'Spinner damage +50% and it orbits wider.', color: '#dddddd', icon: '🗡️', tags: ['orbit', 'kinetic'] },
    { id: 'long_exposure', name: 'Long Exposure', desc: 'Camera flash reaches 50% further and recharges 25% faster.', color: '#ffffcc', icon: '📷', tags: ['burst', 'light'] },
    { id: 'chalk_dust', name: 'Chalk Dust', desc: 'Warding circles are 30% larger and last 50% longer.', color: '#f0f0e0', icon: '🕯️', tags: ['utility', 'focus'] },
    { id: 'second_wind', name: 'Second Wind', desc: 'Slowly regain Sanity while below 25%.', color: '#88ffaa', icon: '🌬️', tags: ['passive', 'utility'] },
    { id: 'scavenger_instinct', name: "Scavenger's Instinct", desc: 'Greatly increases the range you pull Lucidity from.', color: '#ffcc66', icon: '🧲', tags: ['utility', 'passive'] },
    { id: 'martyr', name: 'Martyr', desc: 'Taking damage leaves a warding circle where you stood.', color: '#ddaaff', icon: '✝️', tags: ['dark', 'hazard'] },
    { id: 'slowing_field', name: 'Slowing Field', desc: 'Enemies caught in your Static aura move at half speed.', color: '#aaddff', icon: '❄️', tags: ['aura', 'focus'] },
    { id: 'last_light', name: 'Last Light', desc: 'Flashlight damage +50% while below half Sanity.', color: '#ffaa33', icon: '🕯️', tags: ['light', 'focus'] },
    { id: 'reinforced_frame', name: 'Reinforced Frame', desc: 'Take 15% less damage from everything.', color: '#99aabb', icon: '🦴', tags: ['passive', 'melee'] }
];

/**
 * Patch 95 — THE RECURSION's repeatable cards. Offered ONLY on floors 6+.
 *
 * WHY THESE ARE NEW CARDS RATHER THAN "the existing 24, made repeatable", which was
 * the obvious cheaper answer and is wrong on inspection:
 *
 *   - 11 of the 24 are FLAG boons. Game.js and Combat.js read them with
 *     `boons.includes('shadow_step')`, so taking one a second time does precisely
 *     nothing. A card that visibly does nothing is worse than no card.
 *   - Several are actively degenerate on repeat. `tunnel_vision` HALVES the flashlight
 *     cone each time (three picks and the beam is a line); `wide_lens` multiplies
 *     damage by 0.9 every time; `lead_shoes` permanently disables dashing.
 *
 * These are deliberately plain numbers instead. They are the endgame's "there is always
 * something to take" floor, not a second design space — the interesting choices are
 * still the 24 boons and the now-uncapped weapons, and these should never crowd those
 * out. Every one is safely repeatable by construction: no flags, no division, no
 * one-way switches.
 *
 * Exported for the same reason BOONS is (Patches 55/56): the Clinical Guide renders
 * from live data and must never carry a hand-transcribed copy of a catalogue.
 */
// Patch 125: these five used the alchemical symbols U+1F700–1F77F (🜂🜃🜁🜄🝊), which
// no Android or Windows system font carries — every RECURSION card showed an empty box.
// Inline SVG in currentColor instead (the polaroid slot sets the size via font-size).
const ICON_ACUITY = '<svg class="card-svg" viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="24" cy="24" r="13"/><path d="M24 4v10M24 34v10M4 24h10M34 24h10"/><circle cx="24" cy="24" r="2.5" fill="currentColor"/></svg>';
const ICON_BULWARK = '<svg class="card-svg" viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M24 5l16 6v12c0 10-7 17-16 20C15 40 8 33 8 23V11z"/><path d="M24 16v14M17 23h14"/></svg>';
const ICON_IMPULSE = '<svg class="card-svg" viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 12l12 12-12 12M24 12l12 12-12 12"/></svg>';
const ICON_REFLEX = '<svg class="card-svg" viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M28 4L12 27h11l-4 17 17-24H25z"/></svg>';
const ICON_AVARICE = '<svg class="card-svg" viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8v16a12 12 0 0 0 24 0V8"/><path d="M12 8h7M29 8h7M12 16h7M29 16h7"/></svg>';

export const DEEP_BOONS = [
    { id: 'deep_acuity',    name: 'Acuity',    desc: 'All weapon damage +10%.',      color: '#ffd27f', icon: ICON_ACUITY, tags: ['focus', 'passive'] },
    { id: 'deep_bulwark',   name: 'Bulwark',   desc: 'Max Sanity +25.',              color: '#9fd3c7', icon: ICON_BULWARK, tags: ['passive', 'utility'] },
    { id: 'deep_impulse',   name: 'Impulse',   desc: 'Move speed +4%.',              color: '#8ec5ff', icon: ICON_IMPULSE, tags: ['kinetic', 'passive'] },
    { id: 'deep_reflex',    name: 'Reflex',    desc: 'Dash recharges 4 frames faster.', color: '#c9a0ff', icon: ICON_REFLEX, tags: ['utility', 'kinetic'] },
    { id: 'deep_avarice',   name: 'Avarice',   desc: 'Pull Lucidity from 8% further.', color: '#ffcc66', icon: ICON_AVARICE, tags: ['utility', 'passive'] }
];

/**
 * Patch 125 (V2 plan C2) — what one weapon level does, as data.
 *
 * This was an if/else chain inside selectCard(), which meant the card could only say
 * "Upgrade this weapon." — the numbers lived where the card could not read them. Now
 * applyWeaponLevelUp() applies exactly these steps (same order, same Math.max floors,
 * so the result is identical to the old chain — test_content.js holds a golden table)
 * and describeWeaponLevelUp() turns the SAME steps into "Damage 15 → 20" lines.
 *
 * Step shape: { key, add, min?, set?, kind, label }
 *   add/min  wep[key] = min === undefined ? wep[key] + add : Math.max(min, wep[key] + add)
 *   set      wep[key] = set (no card line)
 *   kind     how the line is written: num | px | cone | sec | pct
 */
export const WEAPON_LEVEL_UPS = {
    flashlight: [
        { key: 'damage', add: 5, kind: 'num', label: 'Damage' },
        { key: 'radius', add: 20, kind: 'px', label: 'Range' },
        { key: 'angle', add: 0.05, kind: 'cone', label: 'Beam' }
    ],
    static: [
        { key: 'damage', add: 3, kind: 'num', label: 'Damage' },
        { key: 'radius', add: 15, kind: 'px', label: 'Aura' },
        { key: 'active', set: true }
    ],
    lead_pipe: [
        { key: 'damage', add: 20, kind: 'num', label: 'Damage' },
        { key: 'radius', add: 15, kind: 'px', label: 'Reach' },
        { key: 'cooldown', add: -10, min: 30, kind: 'sec', label: 'Swing every' }
    ],
    spilled_ink: [
        { key: 'damage', add: 3, kind: 'num', label: 'Damage' },
        { key: 'radius', add: 10, kind: 'px', label: 'Pool size' },
        { key: 'dropRate', add: -5, min: 10, kind: 'sec', label: 'Pool every' }
    ],
    corrosive_battery: [
        { key: 'damage', add: 5, kind: 'num', label: 'Acid damage' },
        { key: 'duration', add: 30, kind: 'sec', label: 'Acid lasts' }
    ],
    broken_chalk: [
        { key: 'radius', add: 15, kind: 'px', label: 'Circle size' },
        { key: 'duration', add: 30, kind: 'sec', label: 'Lasts' },
        { key: 'cooldown', add: -15, min: 60, kind: 'sec', label: 'Drawn every' }
    ],
    polaroid_camera: [
        { key: 'damage', add: 20, kind: 'num', label: 'Damage' },
        { key: 'radius', add: 40, kind: 'px', label: 'Flash range' },
        { key: 'cooldown', add: -30, min: 90, kind: 'sec', label: 'Flash every' }
    ],
    fidget_spinner: [
        { key: 'damage', add: 5, kind: 'num', label: 'Damage' },
        { key: 'baseRadius', add: 10, kind: 'px', label: 'Orbit' },
        { key: 'speed', add: 0.02, kind: 'pct', label: 'Spin speed' }
    ],
    // Patch 132 (V2 plan D3). `max` caps a step the way `min` floors one.
    pill_bottle: [
        { key: 'damage', add: 6, kind: 'num', label: 'Damage' },
        { key: 'bounces', add: 1, max: 6, kind: 'count', label: 'Ricochets' },
        { key: 'cooldown', add: -6, min: 40, kind: 'sec', label: 'Thrown every' }
    ],
    metronome: [
        { key: 'damage', add: 6, kind: 'num', label: 'Damage' },
        { key: 'radius', add: 30, kind: 'px', label: 'Pulse reach' },
        { key: 'cooldown', add: -10, min: 50, kind: 'sec', label: 'Beat every' }
    ],
    straitjacket: [
        { key: 'damage', add: 5, kind: 'num', label: 'Damage' },
        { key: 'straps', add: 1, max: 6, kind: 'count', label: 'Straps' },
        { key: 'radius', add: 8, kind: 'px', label: 'Orbit' }
    ],
    lullaby: [
        { key: 'damage', add: 10, kind: 'num', label: 'Damage' },
        { key: 'notes', add: 1, max: 4, kind: 'count', label: 'Notes' },
        { key: 'cooldown', add: -15, min: 60, kind: 'sec', label: 'Sung every' }
    ]
};

/** Widely supported emoji per weapon (Patch 125; was one shared 🔧 for all eight). */
export const WEAPON_ICONS = {
    flashlight: '🔦', static: '📻', lead_pipe: '🔧', spilled_ink: '🖋️',
    corrosive_battery: '🔋', broken_chalk: '🖍️', polaroid_camera: '📷', fidget_spinner: '🌀',
    pill_bottle: '💊', metronome: '⏱️', straitjacket: '🥋', lullaby: '🎵'   // Patch 132
};

const stepResult = (step, cur) => {
    let v = cur + step.add;
    if (step.min !== undefined) v = Math.max(step.min, v);
    if (step.max !== undefined) v = Math.min(step.max, v);   // Patch 132
    return v;
};

/** Applies one level's stat steps to `wep` in place. Does NOT touch wep.level. */
export function applyWeaponLevelUp(wep, id) {
    const steps = WEAPON_LEVEL_UPS[id];
    if (!wep || !steps) return;
    for (const step of steps) {
        if (step.set !== undefined) wep[step.key] = step.set;
        else if (Number.isFinite(wep[step.key])) wep[step.key] = stepResult(step, wep[step.key]);
    }
}

const trimNum = (v, dp) => String(Number(v.toFixed(dp)));   // 1.50 -> "1.5", 20.0 -> "20"
const fmtSec = (frames) => {
    const s = frames / 60;
    return (s >= 10 ? trimNum(s, 0) : trimNum(s, 2)) + 's';
};

/**
 * One level's steps as card lines, from the weapon's CURRENT values (so Synapse
 * nodes, tokens and boons that already changed them are reflected). Steps that would
 * not change anything (a cooldown already at its floor) are left off.
 */
export function describeWeaponLevelUp(wep, id) {
    const steps = WEAPON_LEVEL_UPS[id];
    if (!wep || !steps) return [];
    const lines = [];
    for (const step of steps) {
        if (step.set !== undefined || !step.kind) continue;
        const cur = wep[step.key];
        if (!Number.isFinite(cur)) continue;
        const next = stepResult(step, cur);
        if (next === cur) continue;
        let text;
        if (step.kind === 'num') text = `${step.label} ${trimNum(cur, 1)} → ${trimNum(next, 1)}`;
        else if (step.kind === 'px') text = `${step.label} ${Math.round(cur)} → ${Math.round(next)}`;
        else if (step.kind === 'cone') text = `${step.label} ${Math.round(cur * 2 * 180 / Math.PI)}° → ${Math.round(next * 2 * 180 / Math.PI)}°`;
        else if (step.kind === 'sec') text = `${step.label} ${fmtSec(cur)} → ${fmtSec(next)}`;
        else if (step.kind === 'count') text = `${step.label} ${cur} → ${next}`;   // Patch 132
        else if (step.kind === 'pct') text = `${step.label} +${Math.round((next / cur - 1) * 100)}%`;
        if (text) lines.push(text);
    }
    return lines;
}

const weaponName = (id) => (MANIFESTATIONS[id] && MANIFESTATIONS[id].name) || id.replace(/_/g, ' ');

/**
 * Synergy hints for a weapon card (Patch 125; V2 plan C1's "pairs with" tag).
 *   pairs — synergies this weapon is in whose OTHER weapons the player already owns
 *   ready — the synergy names this exact pick would complete, computed by running the
 *           real getActiveSynergies() rule on a copy of the levels with this one +1.
 */
export function synergyHintsFor(weapons, id) {
    const pairs = [];
    const ready = [];
    if (!weapons || !weapons[id]) return { pairs, ready };
    const levels = {};
    for (const [k, w] of Object.entries(weapons)) levels[k] = { level: (w && w.level) || 0 };
    const before = new Set(getActiveSynergies(levels));
    levels[id] = { level: levels[id].level + 1 };
    const after = getActiveSynergies(levels);
    for (const sid of after) {
        if (!before.has(sid) && SYNERGIES[sid]) ready.push(SYNERGIES[sid].name);
    }
    for (const syn of Object.values(SYNERGIES)) {
        if (!syn.reqs.includes(id)) continue;
        const others = syn.reqs.filter(r => r !== id);
        if (others.length && others.every(r => weapons[r] && weapons[r].level > 0)) {
            pairs.push(others.map(weaponName).join(' + '));
        }
    }
    return { pairs: [...new Set(pairs)], ready };
}

/** Patch 125: clicks and 1/2/3 are ignored for this long after the cards appear. */
/**
 * Patch 127 (V2 plan C1): while the player carries a single weapon, one of the three
 * cards is always a NEW weapon. A second weapon is what turns the opening into a
 * build (and it is what makes the first "🔗 pairs with" tag appear), but the
 * weighted draw favours the one weapon already owned, so a player could see three
 * flashlight-and-boon offers in a row. Replaces the LAST card, so the draw's own
 * top picks stay; the replacement is the highest-ranked new weapon in `ranked`.
 * Pure: returns a new array, never mutates its inputs.
 */
export function ensureNewWeaponOffer(selected, ranked, weapons) {
    if (!Array.isArray(selected) || !weapons) return selected;
    const owned = Object.values(weapons).filter(w => w && w.level > 0).length;
    if (owned !== 1) return selected;
    if (selected.some(c => c && c.type === 'weapon' && c.isNew)) return selected;
    const fresh = (ranked || []).find(c => c && c.type === 'weapon' && c.isNew && !selected.includes(c));
    if (!fresh) return selected;
    const out = selected.slice();
    if (out.length < 3) out.push(fresh); else out[out.length - 1] = fresh;
    return out;
}

/**
 * Patch 134 (V2 plan D2/C2): what a card means for an evolution.
 *   ready — evolutions this pick makes available (the weapon reaches its max level
 *           while its boon is held, or the boon is taken while its weapon is maxed);
 *           the next elite's chest will evolve it.
 *   lines — a nudge for evolutions this card is a step towards.
 * Pure. `choice` is { type: 'weapon'|'boon', id }.
 */
export function evolutionHintsFor(player, choice) {
    const ready = [];
    const lines = [];
    if (!player || !player.weapons || !choice) return { ready, lines };
    const boons = player.boons || [];
    const boonName = (id) => (BOONS.find(b => b.id === id) || {}).name || id;
    if (choice.type === 'weapon') {
        const evo = evolutionForWeapon(choice.id);
        const w = player.weapons[choice.id];
        if (evo && w && !w.evolution) {
            if (w.level + 1 >= evolveLevel(choice.id) && boons.includes(evo.boon)) ready.push(evo.name);
            else if (w.level >= 1) lines.push(`⬆ evolves with ${boonName(evo.boon)}`);
        }
    } else if (choice.type === 'boon') {
        for (const evo of evolutionsForBoon(choice.id)) {
            const w = player.weapons[evo.weapon];
            if (!w || w.level <= 0 || w.evolution) continue;
            if (w.level >= evolveLevel(evo.weapon)) ready.push(evo.name);
            else lines.push(`⬆ evolves ${weaponName(evo.weapon)} at LVL ${evolveLevel(evo.weapon)}`);
        }
    }
    return { ready, lines };
}

export const LEVEL_UP_ARM_MS = 300;

export class LevelUpUI {
    constructor(audioEngine, saveManager) {
        this.modal = document.getElementById('level-up-modal');
        this.container = document.getElementById('cards-container');
        this.btnReroll = document.getElementById('btn-reroll'); 
        this.audioEngine = audioEngine;
        this.saveManager = saveManager;

        if (import.meta.env.DEV) window.FRACTURED_DEV_MODE = false;
        this.setupDevShortcuts();
        this.attachRerollEvent();
        this.attachKeyPicks();
    }

    /**
     * Patch 125: 1/2/3 pick a card while the modal is open. A UI listener (like
     * main.js's Escape and E), not gameplay input — it is inert unless `isOpen`.
     */
    attachKeyPicks() {
        this.isOpen = false;
        this.armedAt = 0;
        this.currentChoices = [];
        window.addEventListener('keydown', (e) => {
            if (!this.isOpen || e.repeat) return;
            const idx = ['1', '2', '3'].indexOf(e.key);
            if (idx < 0 || idx >= this.currentChoices.length) return;
            e.preventDefault();
            this.tryPick(idx);
        });
    }

    tryPick(idx) {
        // The display check is belt-and-braces: nothing else hides this modal today,
        // but if something ever does without close(), 1/2/3 must not pick mid-run.
        if (!this.isOpen || this.modal.style.display === 'none' || performance.now() < this.armedAt) return;
        const choice = this.currentChoices[idx];
        if (choice) this.selectCard(choice, this.currentGame, this.currentCallback);
    }

    close() {
        this.isOpen = false;
        this.currentChoices = [];
        if (this.armTimer) { clearTimeout(this.armTimer); this.armTimer = null; }
        this.modal.style.display = 'none';
    }

    setupDevShortcuts() {
        // Dev-build only. In production the listener is never registered, so pressing
        // '0' does nothing and FRACTURED_DEV_MODE stays permanently false — which also
        // keeps every `window.FRACTURED_DEV_MODE &&` guard elsewhere permanently closed.
        if (!import.meta.env.DEV) return;
        window.addEventListener('keydown', (e) => {
            if (e.key === '0') {
                window.FRACTURED_DEV_MODE = !window.FRACTURED_DEV_MODE;
                console.log(`%c FRACTURED DEV MODE: ${window.FRACTURED_DEV_MODE ? 'ENABLED' : 'DISABLED'} `,
                            'background: #c5a059; color: #f2eee3; font-weight: bold;');
            }
        });
    }

    // Patch 29.5: C3's rerollCost effect (-10, 20 -> 10 sanity) has no legacy
    // equivalent, so it's read straight off the resolver rather than through
    // Game.init's stat pipeline. Floored at 5 so future stacking can never reach
    // a degenerate free-or-negative reroll.
    getRerollCost() {
        const baseCost = 20;
        if (!this.saveManager || typeof this.saveManager.getResolvedUpgrades !== 'function') return baseCost;
        const { stats } = this.saveManager.getResolvedUpgrades();
        return Math.max(5, baseCost + (stats.rerollCost || 0));
    }

    attachRerollEvent() {
        if (this.btnReroll) {
            this.btnReroll.addEventListener('click', () => {
                const cost = this.getRerollCost();
                if (this.currentGame && this.currentGame.state.sanity > cost) {
                    this.currentGame.state.sanity -= cost;
                    this.currentGame.state.cameraShake = 15;
                    if (this.audioEngine) this.audioEngine.playSFX('damage', 2);

                    this.show(this.currentGame, this.currentCallback);
                }
            });
        }
    }

    show(game, onCompleteCallback) {
        this.currentGame = game;
        this.currentCallback = onCompleteCallback;
        
        this.modal.style.display = 'flex';
        this.container.innerHTML = '';
        // Patch 125: arm after a beat. The modal opens mid-fight; on touch the right
        // thumb is usually still on the aim stick, under the cards.
        this.isOpen = true;
        this.currentChoices = [];
        this.armedAt = performance.now() + LEVEL_UP_ARM_MS;
        this.container.classList.add('cards-arming');
        if (this.armTimer) clearTimeout(this.armTimer);
        this.armTimer = setTimeout(() => {
            this.armTimer = null;
            this.container.classList.remove('cards-arming');
        }, LEVEL_UP_ARM_MS);
        
        if (!game.state.player.synergies) game.state.player.synergies = [];
        if (!game.state.player.curses) game.state.player.curses = [];
        if (!game.state.banished) game.state.banished = []; 
        if (!game.state.player.boons) game.state.player.boons = [];

        const patLvlInfo = this.saveManager ? this.saveManager.getPatientLevelInfo() : { level: 1 };
        const patLvl = patLvlInfo.level;

        if (this.btnReroll) {
            if (patLvl >= 3) {
                this.btnReroll.style.display = 'block';
                const cost = this.getRerollCost();
                const canAfford = game.state.sanity > cost;
                this.btnReroll.disabled = !canAfford;
                this.btnReroll.innerText = canAfford ? `Reroll Choices (-${cost} Sanity)` : "Insufficient Sanity";
            } else {
                this.btnReroll.style.display = 'none';
            }
        }

        let availableBoons = BOONS.filter(b => !game.state.player.boons.includes(b.id)).map(b => ({ ...b, type: 'boon' }));

        // Patch 95: repeatable, so deliberately NOT filtered against player.boons —
        // and given their own `type` so selectCard cannot mistake one for a one-shot
        // boon and push it into that array, which would make it un-offerable again.
        if (isEndless(game.state.floor)) {
            availableBoons = availableBoons.concat(DEEP_BOONS.map(b => ({ ...b, type: 'deep' })));
        }

        let availableWeapons = [];
        const levelCap = weaponLevelCap(game.state.floor);
        // Patch 132: no new weapon once every slot is full.
        const slotsFull = ownedWeaponCount(game.state.player.weapons) >= MAX_WEAPON_SLOTS;
        for (const [weaponKey, wep] of Object.entries(game.state.player.weapons)) {
            // Patch 95: was a hardcoded `wep.level < 5`. weaponLevelCap returns exactly
            // 5 for floors 1-5, so Cycle I keeps its ceiling to the letter.
            // Patch 139: a locked instrument (data/Unlocks.js) is never offered NEW.
            const locked = wep.level === 0 && Array.isArray(game.state.player.lockedWeapons)
                && game.state.player.lockedWeapons.includes(weaponKey);
            if (wep.level < levelCap && !(slotsFull && wep.level === 0) && !locked) {
                // Patch 125: the real name, and what the level actually does. A new
                // weapon also says what it IS (its MANIFESTATIONS description).
                const isNew = wep.level === 0;
                availableWeapons.push({
                    type: 'weapon',
                    id: weaponKey,
                    name: weaponName(weaponKey),
                    desc: isNew && MANIFESTATIONS[weaponKey] ? MANIFESTATIONS[weaponKey].desc : '',
                    stats: describeWeaponLevelUp(wep, weaponKey),
                    hints: synergyHintsFor(game.state.player.weapons, weaponKey),
                    isNew,
                    isMax: wep.level + 1 >= levelCap && Number.isFinite(levelCap),
                    color: '#c5a059',
                    icon: WEAPON_ICONS[weaponKey] || '🔧',
                    currentLevel: wep.level,
                    tags: wep.tags || []
                });
            }
        }

        let combinedPool = [...availableBoons, ...availableWeapons];

        if (combinedPool.length === 0) {
            game.state.player.maxHp += 50;
            game.state.sanity = Math.min(game.state.player.maxHp, game.state.sanity + 50);
            if (this.audioEngine) this.audioEngine.playSFX('pickup', 5);
            this.close();
            if (onCompleteCallback) onCompleteCallback();
            return;
        }

        // Tag affinity: weight offers toward the build the player is already committing
        // to, so a run converges on an identity instead of drifting into a grab-bag.
        // Levelled weapons contribute by level (a level-4 weapon is a stronger
        // commitment than a level-1); already-taken boons contribute a flat 1.
        const affinity = {};
        const addAffinity = (tags, weight) => {
            (tags || []).forEach(t => { affinity[t] = (affinity[t] || 0) + weight; });
        };
        Object.values(game.state.player.weapons).forEach(wep => {
            if (wep && wep.level > 0) addAffinity(wep.tags, wep.level);
        });
        game.state.player.boons.forEach(id => {
            const taken = BOONS.find(b => b.id === id);
            if (taken) addAffinity(taken.tags, 1);
        });

        // Floor of 1 keeps every card reachable and the per-tag cap stops one maxed
        // weapon from dominating — weighting must stay a nudge, never a lock, or the
        // 24-boon pool collapses back to the same handful of cards every run.
        const weightOf = (item) => {
            let w = 1;
            (item.tags || []).forEach(t => { w += Math.min(affinity[t] || 0, 6) * 0.4; });
            return w;
        };

        // Weighted shuffle: repeated weighted draw WITHOUT replacement, so the three
        // cards rendered below are always distinct. Ordering the whole pool rather than
        // picking 3 directly leaves slice(0, 3) as the single source of "how many".
        const weightedPool = [...combinedPool];
        const shuffled = [];
        while (weightedPool.length > 0) {
            const weights = weightedPool.map(weightOf);
            const total = weights.reduce((a, b) => a + b, 0);
            let r = Math.random() * total;
            let idx = 0;
            for (; idx < weightedPool.length - 1; idx++) {
                r -= weights[idx];
                if (r <= 0) break;
            }
            shuffled.push(weightedPool.splice(idx, 1)[0]);
        }

        let selected = ensureNewWeaponOffer(shuffled.slice(0, 3), shuffled, game.state.player.weapons);
        this.currentChoices = selected;

        selected.forEach((choice, idx) => {
            const card = document.createElement('div'); 
            card.className = 'card';
            const rot = (Math.random() - 0.5) * 6;
            card.style.transform = `rotate(${rot}deg)`;
            card.style.background = '#111';
            card.style.border = '2px solid #555';
            
            // Patch 95: 'deep' needs its own arm. Without it a DEEP card falls into the
            // weapon branch and renders "WEAPON LVL NaN" — those cards carry no
            // currentLevel because they have no level to carry.
            let label;
            const badges = [];
            const evoHints = evolutionHintsFor(game.state.player, choice);   // Patch 134
            if (choice.type === 'boon') { label = 'CLINICAL BREAKTHROUGH'; badges.push(['BOON', 'boon']); }
            else if (choice.type === 'deep') label = 'RECURSIVE ADAPTATION';
            else {
                // Patch 125: "LVL 2 → 3", and the badges that make a pick legible.
                label = choice.isNew ? 'NEW WEAPON' : `LVL ${choice.currentLevel} → ${choice.currentLevel + 1}`;
                if (choice.isNew) badges.push(['NEW', 'new']);
                if (choice.isMax && !choice.isNew) badges.push(['MAX', 'max']);
                (choice.hints ? choice.hints.ready : []).forEach(n => badges.push([`SYNERGY READY: ${n}`, 'synergy']));
            }
            evoHints.ready.forEach(n => badges.push([`EVOLUTION READY: ${n}`, 'evolution']));
            const badgeHtml = badges.length
                ? `<div class="card-badges">${badges.map(([t, c]) => `<span class="card-badge card-badge-${c}">${t}</span>`).join('')}</div>`
                : '';
            const statsHtml = (choice.stats && choice.stats.length)
                ? `<ul class="card-stats">${choice.stats.map(l => `<li>${l}</li>`).join('')}</ul>` : '';
            const pairs = choice.hints && !choice.hints.ready.length ? choice.hints.pairs.slice(0, 2) : [];
            const pairHtml = pairs.map(n => `<div class="card-pair">🔗 pairs with ${n}</div>`).join('')
                + evoHints.lines.slice(0, 1).map(l => `<div class="card-pair card-evo">${l}</div>`).join('');

            card.innerHTML = `
                <div class="card-key">${idx + 1}</div>
                <div class="polaroid-photo" style="background: #111; color: ${choice.color};">
                    <div style="text-shadow: 0 0 15px rgba(255,255,255,0.5);">${choice.icon}</div>
                </div>
                <div class="card-body">
                    ${badgeHtml}
                    <h3 style="color: ${choice.color}">${choice.name}</h3>
                    ${choice.desc ? `<p class="card-desc" style="color: #e2e8f0;">${choice.desc}</p>` : ''}
                    ${statsHtml}
                    ${pairHtml}
                    <div class="lvl" style="color: ${choice.color}">${label}</div>
                </div>
            `;

            card.onclick = () => this.tryPick(idx);
            this.container.appendChild(card);
        });
    }

    renderSurgeCard(game, onCompleteCallback) {
        const card = document.createElement('div');
        card.className = 'card';
        card.style.width = '300px';
        card.innerHTML = `
            <h3>LUCIDITY SURGE</h3>
            <p>Your mind has stabilized. All systems at peak performance.</p>
            <div class="lvl" style="color: var(--ui-red)">Recover +50% Sanity</div>
        `;
        card.onclick = () => {
            game.state.sanity = Math.min(game.state.player.maxHp, game.state.sanity + (game.state.player.maxHp * 0.5));
            this.close();
            if (this.audioEngine) this.audioEngine.playSFX('pickup', 5);
            onCompleteCallback();
        };
        this.container.appendChild(card);
    }

    selectCard(choice, game, onCompleteCallback) {
        // Patch 57: recorded here rather than at the two branch tails below, so the
        // record cannot miss a pick if a future branch gains an early return. Weapons
        // report the level they just reached; boons pass null (they are one-shot).
        if (this.saveManager && typeof this.saveManager.recordBoonPick === 'function') {
            const wepForLevel = choice.type === 'weapon' ? game.state.player.weapons[choice.id] : null;
            this.saveManager.recordBoonPick(choice.id, wepForLevel ? wepForLevel.level + 1 : null);
        }

        if (choice.type === 'weapon') {
            const wep = game.state.player.weapons[choice.id];
            if (wep) {
                wep.level++;
                applyWeaponLevelUp(wep, choice.id);   // Patch 125: was an if/else chain
            }
        } else if (choice.type === 'deep') {
            // Patch 95 — repeatable. Deliberately NOT pushed into player.boons: that
            // array is the one-shot ledger the BOONS pool filters against, and adding
            // to it would make each of these offerable exactly once, which is the whole
            // thing they exist not to be.
            //
            // Every effect below is safe to apply an unbounded number of times — plain
            // addition or a multiplier above 1, no flags, no division, no one-way
            // switches. That constraint is what the pool was designed around; keep it
            // if any card is ever added here.
            const p = game.state.player;
            if (choice.id === 'deep_acuity') {
                Object.values(p.weapons).forEach(wep => {
                    if (wep && Number.isFinite(wep.damage)) wep.damage *= 1.10;
                });
            } else if (choice.id === 'deep_bulwark') {
                p.maxHp += 25;
                game.state.sanity += 25;
            } else if (choice.id === 'deep_impulse') {
                p.speed *= 1.04;
            } else if (choice.id === 'deep_reflex') {
                // Same clamp Game.init applies to the Synapse Tree's dashCooldown node,
                // so stacking this can never reach a degenerate near-zero cooldown.
                p.dash.baseCooldown = Math.max(20, p.dash.baseCooldown - 4);
            } else if (choice.id === 'deep_avarice') {
                // Combat.collectXP reads `70 + vacRadiusBonusPx`, so an 8% increase in
                // reach means 8% of that total, not 8% of the bonus alone.
                const current = 70 + (p.vacRadiusBonusPx || 0);
                p.vacRadiusBonusPx = (p.vacRadiusBonusPx || 0) + Math.round(current * 0.08);
            }
        } else {
            game.state.player.boons.push(choice.id);

            const w = game.state.player.weapons;

            if (choice.id === 'tunnel_vision') {
                w.flashlight.angle /= 2;
                w.flashlight.damage *= 2;
            } else if (choice.id === 'iron_will') {
                game.state.player.maxHp += 50;
                game.state.sanity += 50;
            } else if (choice.id === 'lead_shoes') {
                game.state.player.maxHp += 200;
                game.state.sanity += 200;
            } else if (choice.id === 'steady_hands') {
                // Applies to every weapon that actually has a cooldown field.
                // Patch 132: and the three Phase D weapons that run on a timer.
                ['lead_pipe', 'broken_chalk', 'polaroid_camera', 'pill_bottle', 'metronome', 'lullaby'].forEach(id => {
                    if (w[id] && w[id].cooldown) w[id].cooldown = Math.max(20, Math.floor(w[id].cooldown * 0.8));
                });
            } else if (choice.id === 'wide_lens') {
                w.flashlight.radius *= 1.4;
                w.flashlight.damage *= 0.9;
            } else if (choice.id === 'overcharge') {
                w.static.radius *= 1.5;
                w.static.damage *= 1.3;
            } else if (choice.id === 'heavy_swing') {
                w.lead_pipe.damage *= 1.6;
                w.lead_pipe.cooldown = Math.floor(w.lead_pipe.cooldown * 1.2);
            } else if (choice.id === 'ink_flood') {
                w.spilled_ink.radius *= 1.5;
                w.spilled_ink.dropRate = Math.max(8, Math.floor(w.spilled_ink.dropRate * 0.5));
            } else if (choice.id === 'sharpened_blades') {
                w.fidget_spinner.damage *= 1.5;
                w.fidget_spinner.baseRadius += 20;
            } else if (choice.id === 'long_exposure') {
                w.polaroid_camera.radius *= 1.5;
                w.polaroid_camera.cooldown = Math.max(60, Math.floor(w.polaroid_camera.cooldown * 0.75));
            } else if (choice.id === 'chalk_dust') {
                w.broken_chalk.radius *= 1.3;
                w.broken_chalk.duration = Math.floor(w.broken_chalk.duration * 1.5);
            }
        }

        // Patch 126: through Game so a synergy this pick completes is announced.
        if (typeof game.refreshSynergies === 'function') game.refreshSynergies();
        else game.state.player.synergies = getActiveSynergies(game.state.player.weapons);

        if (this.audioEngine) this.audioEngine.playSFX('levelup', 5);
        
        game.state.sanity = Math.min(game.state.player.maxHp, game.state.sanity + 20);
        this.close();
        haptic('levelUp');   // Patch 149: through the setting
        onCompleteCallback();
    }
}  