// src/systems/Evolutions.js
//
// Patch 134 (V2 plan D2): weapon evolutions.
//
// A weapon at its maximum level (5) PLUS one specific boon becomes eligible to evolve,
// and the next chest an elite drops evolves it instead of paying out levels
// (Elites.resolveChest asks evolveForChest first). Separate from synergies, which are
// two weapons both at 5: an evolution is one weapon and one boon, so it is the thing a
// boon pick can aim at.
//
// Each evolution is applied ONCE: `apply(wep)` changes the weapon's numbers in place
// (and sets a flag or two that Combat/Arsenal read), and `wep.evolution` records which
// one it became. Every effect is a plain multiplier, addition or flag — nothing here
// needs a new per-frame system.

import { MANIFESTATIONS } from '../data/Manifestations.js';
import { BOONS } from '../ui/LevelUpUI.js';

export const EVOLUTIONS = {
    interrogation_lamp: {
        id: 'interrogation_lamp', weapon: 'flashlight', boon: 'last_light',
        name: 'Interrogation Lamp', desc: 'The beam is hotter, wider and longer: damage x2, cone +30%, range +25%.',
        apply: (w) => { w.damage *= 2; w.angle *= 1.3; w.radius *= 1.25; }
    },
    white_noise_machine: {
        id: 'white_noise_machine', weapon: 'static', boon: 'overcharge',
        name: 'White Noise Machine', desc: 'The aura swells: radius +60%, damage x2.2.',
        apply: (w) => { w.radius *= 1.6; w.damage *= 2.2; w.active = true; }
    },
    wrecking_bar: {
        id: 'wrecking_bar', weapon: 'lead_pipe', boon: 'heavy_swing',
        name: 'Wrecking Bar', desc: 'Damage x2, reach +40%, and it swings a quarter faster.',
        apply: (w) => { w.damage *= 2; w.radius *= 1.4; w.cooldown = Math.max(20, Math.floor(w.cooldown * 0.75)); }
    },
    inkwell_flood: {
        id: 'inkwell_flood', weapon: 'spilled_ink', boon: 'ink_flood',
        name: 'Inkwell Flood', desc: 'Pools are 60% wider, twice as toxic, and fall faster.',
        apply: (w) => { w.radius *= 1.6; w.damage *= 2; w.dropRate = Math.max(8, Math.floor(w.dropRate * 0.7)); }
    },
    car_battery: {
        id: 'car_battery', weapon: 'corrosive_battery', boon: 'toxic_blood',
        name: 'Car Battery', desc: 'Acid hits three times as hard and lasts half as long again.',
        apply: (w) => { w.damage *= 3; w.duration = Math.floor(w.duration * 1.5); }
    },
    chalk_pentagram: {
        id: 'chalk_pentagram', weapon: 'broken_chalk', boon: 'chalk_dust',
        name: 'Chalk Pentagram', desc: 'Wards are 50% larger, last twice as long, and are drawn far more often.',
        apply: (w) => { w.radius *= 1.5; w.duration *= 2; w.cooldown = Math.max(60, Math.floor(w.cooldown * 0.6)); }
    },
    flashbulb_array: {
        id: 'flashbulb_array', weapon: 'polaroid_camera', boon: 'long_exposure',
        name: 'Flashbulb Array', desc: 'The flash goes off in every direction at once, and 50% harder.',
        apply: (w) => { w.angle = Math.PI; w.damage *= 1.5; }
    },
    ceiling_fan: {
        id: 'ceiling_fan', weapon: 'fidget_spinner', boon: 'sharpened_blades',
        name: 'Ceiling Fan', desc: 'Blades hit twice as hard, orbit wider and spin half again as fast.',
        apply: (w) => { w.damage *= 2; w.baseRadius += 30; w.speed *= 1.5; }
    },
    pill_organiser: {
        id: 'pill_organiser', weapon: 'pill_bottle', boon: 'steady_hands',
        name: 'Pill Organiser', desc: 'Two bottles every throw, each with three more ricochets.',
        apply: (w) => { w.volley = 2; w.bounces += 3; }
    },
    grandfather_clock: {
        id: 'grandfather_clock', weapon: 'metronome', boon: 'slowing_field',
        name: 'Grandfather Clock', desc: 'Every pulse reaches 50% further and leaves everything it crosses drowsy.',
        apply: (w) => { w.radius *= 1.5; w.lulls = true; }
    },
    padded_cell: {
        id: 'padded_cell', weapon: 'straitjacket', boon: 'reinforced_frame',
        name: 'Padded Cell', desc: 'Two more straps (up to eight), and each lashes 80% harder.',
        apply: (w) => { w.straps = Math.min(8, w.straps + 2); w.damage *= 1.8; }
    },
    music_box: {
        id: 'music_box', weapon: 'lullaby', boon: 'second_wind',
        name: 'Music Box', desc: 'Two more notes, 60% wider bursts, and each burst restores 1 Sanity.',
        apply: (w) => { w.notes += 2; w.radius *= 1.6; w.heals = 1; }
    }
};

/** The level a weapon must reach before it can evolve (its MANIFESTATIONS maxLvl). */
export const evolveLevel = (weaponId) => (MANIFESTATIONS[weaponId] && MANIFESTATIONS[weaponId].maxLvl) || 5;

/** Display names: "Rusted Flashlight (5) + Last Light". */
export function evolutionRecipe(evo) {
    if (!evo) return '';
    const w = (MANIFESTATIONS[evo.weapon] && MANIFESTATIONS[evo.weapon].name) || evo.weapon;
    const b = (BOONS.find(x => x.id === evo.boon) || {}).name || evo.boon;
    return `${w} (LVL ${evolveLevel(evo.weapon)}) + ${b}`;
}

/** Evolutions this run qualifies for right now (weapon maxed, boon held, not yet evolved). */
export function availableEvolutions(state) {
    const p = state && state.player;
    if (!p || !p.weapons) return [];
    const boons = p.boons || [];
    return Object.values(EVOLUTIONS).filter(evo => {
        const w = p.weapons[evo.weapon];
        return w && !w.evolution && w.level >= evolveLevel(evo.weapon) && boons.includes(evo.boon);
    });
}

/** Applies one evolution to its weapon. Returns false if it does not qualify. */
export function applyEvolution(state, evoId) {
    const evo = EVOLUTIONS[evoId];
    if (!evo) return false;
    if (!availableEvolutions(state).includes(evo)) return false;
    const w = state.player.weapons[evo.weapon];
    evo.apply(w);
    w.evolution = evo.id;
    return true;
}

/**
 * Elites.resolveChest's `evolve` hook: evolves the first qualifying weapon (in
 * EVOLUTIONS order, so it is deterministic) and describes it for the notice.
 */
export function evolveForChest(state) {
    const evo = availableEvolutions(state)[0];
    if (!evo || !applyEvolution(state, evo.id)) return null;
    return { id: evo.id, name: evo.name, desc: evo.desc, recipe: evolutionRecipe(evo), weapon: evo.weapon };
}

/** The evolution a weapon id leads to (for card hints). */
export const evolutionForWeapon = (weaponId) => Object.values(EVOLUTIONS).find(e => e.weapon === weaponId) || null;
/** The evolutions a boon id unlocks (for card hints). */
export const evolutionsForBoon = (boonId) => Object.values(EVOLUTIONS).filter(e => e.boon === boonId);
