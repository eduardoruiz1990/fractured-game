// src/data/Manifestations.js
// The JSON dictionary of weapons, upgrades, and Personal Tokens.

export const MANIFESTATIONS = {
    flashlight: { id: 'flashlight', name: 'Rusted Flashlight', desc: 'Pierce the fog. Damages enemies.', maxLvl: 5 },
    static: { id: 'static', name: 'Static Receiver', desc: 'Emits a pulsing aura of white noise.', maxLvl: 5 },
    adrenaline: { id: 'adrenaline', name: 'Adrenaline Spike', desc: 'Increases movement speed & sanity res.', maxLvl: 5 },
    lead_pipe: { id: 'lead_pipe', name: 'Heavy Lead Pipe', desc: 'Crushing 360-degree melee sweep.', maxLvl: 5 },
    spilled_ink: { id: 'spilled_ink', name: 'Spilled Ink', desc: 'Leaves a slowing, toxic trail behind you.', maxLvl: 5 },
    corrosive_battery: { id: 'corrosive_battery', name: 'Corrosive Battery', desc: 'Flashlight applies melting acid over time.', maxLvl: 5 },
    broken_chalk: { id: 'broken_chalk', name: 'Broken Chalk', desc: 'Draws a warding circle. 2x damage inside.', maxLvl: 5 },
    
    // --- EPIC 4: NEW WEAPONS ---
    polaroid_camera: { id: 'polaroid_camera', name: 'Polaroid Camera', desc: 'Fires a blinding, stunning flash in a wide cone every few seconds.', maxLvl: 5 },
    fidget_spinner: { id: 'fidget_spinner', name: 'Weighted Spinner', desc: 'Blades orbit you. Deals shredding damage to enemies that get too close.', maxLvl: 5 }
};

export const SYNERGIES = {
    blinding_signal: {
        id: 'blinding_signal', name: 'The Blinding Signal',
        desc: 'Flashlight strobes violently. Confuses enemies, causing them to attack each other.',
        reqs: ['flashlight', 'static']
    },
    industrial_bleed: {
        id: 'industrial_bleed', name: 'Industrial Bleed',
        desc: 'Pipe hits cause massive ink splatters, dealing AoE damage.',
        reqs: ['lead_pipe', 'spilled_ink']
    },
    scholastic_purge: {
        id: 'scholastic_purge', name: 'Scholastic Purge',
        desc: 'Chalk wards emit acid mist. Instantly kills Parasites.',
        reqs: ['broken_chalk', 'corrosive_battery']
    },

    // Both weapons must reach max level for a synergy to fire (see
    // getActiveSynergies below), so each of these is a deliberate two-weapon
    // commitment rather than something a scattergun build stumbles into.
    overexposure: {
        id: 'overexposure', name: 'Overexposure',
        desc: 'The flash sears. Camera victims are blinded twice as long and take burst flashlight damage.',
        reqs: ['flashlight', 'polaroid_camera']
    },
    chemical_burn: {
        id: 'chemical_burn', name: 'Chemical Burn',
        desc: 'The camera flash bakes acid onto everything it catches.',
        reqs: ['polaroid_camera', 'corrosive_battery']
    },
    centrifuge: {
        id: 'centrifuge', name: 'Centrifuge',
        desc: 'Blades shred three times as fast and fling enemies outward.',
        reqs: ['fidget_spinner', 'lead_pipe']
    },
    kinetic_discharge: {
        id: 'kinetic_discharge', name: 'Kinetic Discharge',
        desc: 'The orbit is live. Blade hits arc static into everything nearby.',
        reqs: ['fidget_spinner', 'static']
    },
    ion_trail: {
        id: 'ion_trail', name: 'Ion Trail',
        desc: 'Ink conducts. Pools electrify, hitting harder and slowing far more.',
        reqs: ['static', 'spilled_ink']
    },
    ritual_focus: {
        id: 'ritual_focus', name: 'Ritual Focus',
        desc: 'Enemies inside your wards are struck by the flashlight no matter where you aim.',
        reqs: ['flashlight', 'broken_chalk']
    },
    consecrated_ground: {
        id: 'consecrated_ground', name: 'Consecrated Ground',
        desc: 'Pipe swings landed inside a ward restore Sanity.',
        reqs: ['lead_pipe', 'broken_chalk']
    }
};

export function getActiveSynergies(weapons) {
    if (!weapons) return [];
    const active = [];
    for (const synergyId in SYNERGIES) {
        const synergy = SYNERGIES[synergyId];
        const allReqsMaxed = synergy.reqs.every(reqId => {
            const wep = weapons[reqId];
            const maxLvl = MANIFESTATIONS[reqId] ? MANIFESTATIONS[reqId].maxLvl : 5;
            return wep && wep.level >= maxLvl;
        });
        if (allReqsMaxed) active.push(synergyId);
    }
    return active;
}

export const INTRUSIVE_THOUGHTS = {
    everything_is_target: { id: 'everything_is_target', name: 'Everything is a Target', desc: '+100% Damage, but your flashlight destroys your own XP drops.' },
    manic_episode: { id: 'manic_episode', name: 'Manic Episode', desc: '+50% Fire Rate, but Sanity drains 2x faster.' },
    compulsive_cleaner: { id: 'compulsive_cleaner', name: 'Compulsive Cleaner', desc: 'Janitors drop more XP, but Hall Monitors hunt you at 2x speed.' },
    
    // --- EPIC 4: NEW CURSE ---
    tunnel_vision: { id: 'tunnel_vision', name: 'Tunnel Vision', desc: 'Flashlight damage x3, but the ambient 360-degree safe-glow is removed.' }
};

export const TOKEN_RARITIES = {
    common: { color: '#aaaaaa', costToUpgrade: 100, multiplier: 1.0 },
    rare: { color: '#5555ff', costToUpgrade: 250, multiplier: 1.5 },
    epic: { color: '#aa55ff', costToUpgrade: 500, multiplier: 2.0 },
    legendary: { color: '#ff8c00', costToUpgrade: 1000, multiplier: 3.0 },
    mythic: { color: '#ff5555', costToUpgrade: null, multiplier: 4.0 }
};

// Patch 31: sets gained a machine-readable `bonuses` field alongside the existing
// '2'/'4' display strings (which UIManager reads directly — do not rename them).
// Set bonuses are NOT rarity-scaled; only the per-token effects below are.
//
// NOTE ON THE '2'/'4' TEXT: two of these strings previously described behaviour
// the code did not have. insomniac's 2pc claimed "Move Speed +10%" while
// Game.js:195 actually applies flashlight radius x1.25 — the text has been
// corrected to match the code that really runs, rather than the reverse.
export const TOKEN_SETS = {
    insomniac: {
        name: "The Insomniac",
        2: "Flashlight range +25%",
        4: "Permanent outer safe zone that burns enemies.",
        bonuses: { 2: { light: 25 }, 4: { grant: 'insomniac_burn_zone' } }
    },
    institutionalized: {
        name: "Institutionalized",
        2: "Max Grip +50",
        4: "Taking damage triggers an AoE shockwave, but you cannot dash.",
        bonuses: { 2: { sanity: 50 }, 4: { grant: 'shockwave_no_dash' } }
    },
    medicated: {
        name: "Medicated",
        2: "Damage taken -20%",
        4: "Max Grip +80",
        bonuses: { 2: { grant: 'medicated_mitigation' }, 4: { sanity: 80 } }
    },
    relapse: {
        name: "The Relapse",
        2: "Lucidity gain +20%",
        4: "Melee and kinetic damage +30%, but max Grip -40.",
        bonuses: { 2: { lucidityGain: 20 }, 4: { tagDamage: { melee: 30, kinetic: 30 }, sanity: -40 } }
    }
};

// Patch 31: 4 -> 16 tokens across 5 slot types (head/body/hands/legs/prescription),
// 4 tokens per set so every set can actually reach its 4-piece bonus with one slot
// still free.
//
// `effects` is machine-readable and deliberately reuses the SAME stat vocabulary as
// the Synapse Tree resolver (sanity/speed/light/magnet/iframes/flashlightAngle/
// tagDamage/lucidityGain/dashCooldown), so both bundles merge without translation.
// `grant` names a discrete unlock, never summed as a number.
//
// The four original ids (head_paranoia, body_denial, hands_twitch, legs_panic) are
// preserved EXACTLY — they are referenced by uid->id in existing player inventories,
// so renaming one would orphan every save that owns it.
export const TOKENS = {
    // --- THE INSOMNIAC: sleepless hyper-awareness. Light, speed, tempo. ---
    head_paranoia: {
        id: 'head_paranoia', type: 'head', set: 'insomniac',
        name: 'Paranoid Gaze', desc: 'Flashlight range +50%, cone angle -20%.',
        effects: { light: 50, flashlightAngle: -20 }
    },
    hands_twitch: {
        id: 'hands_twitch', type: 'hands', set: 'insomniac',
        name: 'Twitching Fingers', desc: 'Weapon cooldowns accelerate as Grip drops.',
        effects: { grant: 'twitch_cooldown' }
    },
    legs_pacing: {
        id: 'legs_pacing', type: 'legs', set: 'insomniac',
        name: 'Pacing Gait', desc: 'Move speed +8%.',
        effects: { speed: 8 }
    },
    presc_stimulant: {
        id: 'presc_stimulant', type: 'prescription', set: 'insomniac',
        name: 'Amphetamine Script', desc: 'Move speed +5%, but max Grip -20.',
        effects: { speed: 5, sanity: -20 }
    },

    // --- INSTITUTIONALIZED: confinement, endurance, surviving the process. ---
    body_denial: {
        id: 'body_denial', type: 'body', set: 'institutionalized',
        name: 'Straitjacket of Denial', desc: 'Begin each floor with a shield that ignores one hit.',
        effects: { grant: 'denial_shield' }
    },
    legs_panic: {
        id: 'legs_panic', type: 'legs', set: 'institutionalized',
        name: 'Panic Sprint', desc: 'Dash recharges far faster, but covers less ground.',
        effects: { dashCooldown: -45, grant: 'panic_dash' }
    },
    head_compliance: {
        id: 'head_compliance', type: 'head', set: 'institutionalized',
        name: 'Compliance Cap', desc: 'Max Grip +40, flashlight range -10%.',
        effects: { sanity: 40, light: -10 }
    },
    presc_sedative: {
        id: 'presc_sedative', type: 'prescription', set: 'institutionalized',
        name: 'Sedative Script', desc: 'Invulnerability after a hit +15f, move speed -5%.',
        effects: { iframes: 15, speed: -5 }
    },

    // --- MEDICATED: dulled senses traded for durability. ---
    head_haze: {
        id: 'head_haze', type: 'head', set: 'medicated',
        name: 'Medicated Haze', desc: 'Invulnerability after a hit +10f, vacuum radius +30px.',
        effects: { iframes: 10, magnet: 30 }
    },
    body_regimen: {
        id: 'body_regimen', type: 'body', set: 'medicated',
        name: 'Dosage Regimen', desc: 'Max Grip +30.',
        effects: { sanity: 30 }
    },
    hands_tremor: {
        id: 'hands_tremor', type: 'hands', set: 'medicated',
        name: 'Lithium Tremor', desc: 'Tech weapon damage +15%.',
        effects: { tagDamage: { tech: 15 } }
    },
    presc_antipsychotic: {
        id: 'presc_antipsychotic', type: 'prescription', set: 'medicated',
        name: 'Antipsychotic Script', desc: 'Max Grip +40, but Lucidity gain -10%.',
        effects: { sanity: 40, lucidityGain: -10 }
    },

    // --- THE RELAPSE: raw damage and greed, paid for in Grip. ---
    body_scars: {
        id: 'body_scars', type: 'body', set: 'relapse',
        name: 'Old Scars', desc: 'Melee and kinetic damage +20%, but max Grip -20.',
        effects: { tagDamage: { melee: 20, kinetic: 20 }, sanity: -20 }
    },
    hands_grip: {
        id: 'hands_grip', type: 'hands', set: 'relapse',
        name: 'White-Knuckle Grip', desc: 'Kinetic weapon damage +15%.',
        effects: { tagDamage: { kinetic: 15 } }
    },
    legs_flight: {
        id: 'legs_flight', type: 'legs', set: 'relapse',
        name: 'Flight Instinct', desc: 'Dash cooldown -20f, move speed +5%.',
        effects: { dashCooldown: -20, speed: 5 }
    },
    presc_withdrawal: {
        id: 'presc_withdrawal', type: 'prescription', set: 'relapse',
        name: 'Withdrawal', desc: 'Lucidity gain +25%, but max Grip -30.',
        effects: { lucidityGain: 25, sanity: -30 }
    }
};

// Slot types, in display order. Single source of truth — SaveManager's
// equippedTokens shape, UIManager's render loop, and index.html's .token-slot divs
// must all agree with this list (§2 called out five hardcoded copies of the old
// 4-slot shape; this constant exists so a 6th slot never needs five more edits).
export const TOKEN_SLOT_TYPES = ['head', 'body', 'hands', 'legs', 'prescription'];