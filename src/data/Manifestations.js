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

/**
 * The weapon ids that actually exist on `state.player.weapons` (Patch 56).
 *
 * MANIFESTATIONS above also contains `adrenaline`, which is NOT a real weapon —
 * Game.init() never creates it and no combat code reads it. Any player-facing list
 * built by iterating MANIFESTATIONS would therefore advertise a manifestation that
 * can never be obtained, so the Clinical Guide and the Manifestation Log both use
 * THIS array instead. test_content.js asserts it against a freshly constructed
 * Game, so it cannot silently drift from the real loadout.
 */
export const PLAYER_WEAPON_IDS = [
    'flashlight', 'static', 'polaroid_camera', 'fidget_spinner',
    'lead_pipe', 'spilled_ink', 'broken_chalk', 'corrosive_battery'
];

/**
 * Room-choice mechanics, documented for the Clinical Guide (Patch 55).
 *
 * These MIRROR literals that live inline in Combat.js's ROOM_DOOR branch and
 * Director.spawnRoom()'s modifier roll — neither is exported, and pulling them out
 * would mean restructuring live combat code to serve a documentation feature. The
 * risk is that a tuning change there silently makes this text wrong, so the numbers
 * are quoted exactly and this comment is the flag: CHANGE BOTH.
 */
export const DOOR_REWARDS = [
    { id: 'LUCIDITY',       name: 'LUCIDITY',        effect: '+50 Lucidity and +50 XP, banked into this run.', color: '#ffddaa' },
    { id: 'HEAL',           name: 'RECOVERY',        effect: 'Restores 50 Sanity you have already lost. Does NOT raise your maximum, and cannot take you above it.', color: '#aaffaa' },
    { id: 'WEAPON_UPGRADE', name: 'WEAPON UPGRADE',  effect: 'Levels one random weapon that is not yet at 5. If everything is maxed, pays +50 Lucidity instead.', color: '#c5a059' },
    { id: 'TOKEN_DOOR',     name: 'CONFISCATED ITEM', effect: 'Drops a Token on the spot. Tokens are only kept if you survive or extract.', color: '#ff8c00' },
    { id: 'RISK_REWARD',    name: 'RISK PROTOCOL',   effect: '+150 Lucidity, +150 XP and a Token — at a flat cost of 30 current Sanity. The cost cannot kill you (it floors at 1) and ignores shields and curses.', color: '#ff3333' }
];

export const ROOM_MODIFIERS = [
    { id: 'ELITE',    name: 'ELITE',    chance: '15%', effect: 'Fewer enemies, but each is tougher. Roughly a third fewer spawns.', color: '#6f8fa8' },
    { id: 'BLACKOUT', name: 'BLACKOUT', chance: '15%', effect: 'Enemies arrive noticeably faster, with more ambush pressure from Substitutes.', color: '#5a2a7a' },
    { id: 'SWARM',    name: 'SWARM',    chance: '15%', effect: 'Nearly double the bodies, all Janitors, arriving twice as fast.', color: '#a0522d' },
    { id: 'HAZARD',   name: 'HAZARD',   chance: '15%', effect: 'The room itself leaks ink. Toxic pools keep forming until it is cleared.', color: '#8822cc' }
];

// Patch 78: these describe behaviour, and the behaviour changed — variants now hit
// harder AND move differently (Enemy.applyVariantMotion). Keep these sentences true;
// the guide is the only place the player is told any of it.
export const ENEMY_VARIANTS = [
    { id: 'ARMORED',  name: 'ARMORED',  effect: 'Three times the health and slower — until it charges you without warning. Do not let it pick the moment.', color: '#6f8fa8' },
    { id: 'FAST',     name: 'FAST',     effect: 'Fragile, but it weaves across its own approach and darts. You cannot lead it like a straight runner.', color: '#f0e68c' },
    { id: 'VOLATILE', name: 'VOLATILE', effect: 'Unstable — it lurches, hits hardest of the three, and detonates on death within ~130px. Kill it at range.', color: '#ff7043' }
];

/**
 * How much each manifestation resists being pushed back by the flashlight beam
 * (Patch 63). 1.0 = shoved freely, 0.1 = barely notices.
 *
 * Before this, every enemy inside the cone took an identical flinch regardless of
 * type or of where in the beam it was standing, which made the flashlight a
 * universal crowd-control tool — sweep it around and nothing could ever reach you.
 * Heavier things now push through the light, so choosing WHICH enemy gets the
 * centre of the beam is a real decision.
 *
 * Keyed by entity `type`. Unknown types fall back to 1.0. test_content.js asserts
 * every bestiary entry has a value here.
 */
export const LIGHT_RECOIL_RESIST = {
    SCAVENGER: 1.0,      // shoved freely — the beam is genuine crowd control on these
    PARASITE: 0.7,
    PREDATOR: 0.45,      // leans into it; a direct beam slows a lunge but will not stop it
    BOSS: 0.20,
    RORSCHACH: 0.25,
    PANOPTICON: 0.15,
    AMALGAMATION: 0.15,
    ARCHITECT: 0.10      // effectively immovable
};

export const ENEMY_BESTIARY = [
    { id: 'SCAVENGER', name: 'JANITORS',      icon: '♙', color: '#555555', desc: 'The baseline manifestation. Slow, numerous, and happy to swarm. They vacuum up Lucidity you leave lying around.' },
    { id: 'PREDATOR',  name: 'HALL MONITORS', icon: '♘', color: '#8b0000', desc: 'Telegraphs, then lunges in a straight line. The tell is the pause — move sideways, not backwards.' },
    { id: 'PARASITE',  name: 'SUBSTITUTES',   icon: '♗', color: '#a0522d', desc: 'Hangs back and lashes at range, and will buff other manifestations if left alone. Priority target.' },
    { id: 'BOSS',        name: 'SPHERE HEAD',     icon: '🌑',  color: '#b87333', desc: 'Floor 1. Charges, then releases an expanding pulse. The safe place is behind it.', boss: true },
    { id: 'RORSCHACH',   name: 'THE RORSCHACH',   icon: '🦋',  color: '#800080', desc: 'Floor 2. Splits into smaller copies of itself when killed, three generations deep.', boss: true },
    { id: 'PANOPTICON',  name: 'THE PANOPTICON',  icon: '👁️', color: '#ff0055', desc: 'Floor 3. Sweeps a gaze beam across the arena. Break line of sight or outrun the sweep.', boss: true },
    { id: 'AMALGAMATION',name: 'THE AMALGAMATION',icon: '🦠',  color: '#55ff55', desc: 'Floor 4. Pulls you toward it and spawns lesser manifestations continuously.', boss: true },
    { id: 'ARCHITECT',   name: 'THE ARCHITECT',   icon: '🕋',  color: '#c5a059', desc: 'Floor 5. The source of the construct. Collapses the arena in phases.', boss: true }
];

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

// Patch 32: curse risk ladder. Every curse now carries `lucidityWeight` (percent
// Lucidity bonus while it's active), replacing the flat 15%-per-curse rate that
// used to be hardcoded directly in Game.js's lucidityBonusMultiplier line. Weights
// are tiered by how much real, currently-CODED risk each curse actually adds —
// not by its flavor text — because two of the four original curses turned out to
// promise an effect the code never implemented (see the note on
// everything_is_target below). Tiers: MILD 10 / MODERATE 15 / SEVERE 20 / EXTREME 30.
//
// NOTE — everything_is_target's description has always claimed "+100% Damage".
// Grepping Combat.js confirms that half was never implemented — the ONLY coded
// effect is the flashlight destroying its own XP drops. Rather than silently
// dropping the claim or fabricating the missing damage buff here (this patch's
// file scope is data + SaveManager, not Combat.js), the description is corrected
// to what actually runs, weighted MILD to match its real (not promised) cost, and
// the missing buff is flagged in this patch's report as a Combat.js follow-up —
// same shape as the token effects revived in Patch 31b.
//
// hemophilia / nyctophobia / fragile_mind existed as dead `.includes()` checks in
// Game.js (real, working effect code) with NO entry in this pool — orphaned
// exactly like the token ids fixed in Patch 31b, just never surfaced as choices.
// Revived here as pure-downside curses: the system's actual "payout" for adopting
// any curse is the Lucidity weight itself, not a mandatory in-run buff — tunnel_
// vision/manic_episode/compulsive_cleaner happen to also carry a buff, but that
// was never a hard requirement, and inventing one for these three would be the
// same mistake as the original everything_is_target text.
export const INTRUSIVE_THOUGHTS = {
    everything_is_target: {
        id: 'everything_is_target', name: 'Everything is a Target',
        desc: 'Your flashlight destroys any XP drop caught in its beam.',
        lucidityWeight: 10
    },
    manic_episode: {
        id: 'manic_episode', name: 'Manic Episode',
        desc: '+50% Fire Rate, but Sanity drains twice as fast.',
        lucidityWeight: 20
    },
    compulsive_cleaner: {
        id: 'compulsive_cleaner', name: 'Compulsive Cleaner',
        desc: 'Scavengers drop more XP, but every Predator hunts at 2x speed for the whole run.',
        lucidityWeight: 15
    },

    // --- EPIC 4: NEW CURSE ---
    tunnel_vision: {
        id: 'tunnel_vision', name: 'Tunnel Vision',
        desc: 'Flashlight damage x3, but the ambient 360-degree safe-glow is removed.',
        lucidityWeight: 20
    },

    // --- PATCH 32: revived from orphaned Game.js checks ---
    hemophilia: {
        id: 'hemophilia', name: 'Hemophilia',
        desc: 'Every hit you take deals 50% more damage. No exceptions.',
        lucidityWeight: 30
    },
    nyctophobia: {
        id: 'nyctophobia', name: 'Nyctophobia',
        desc: 'Sanity drains 2.5x faster whenever you stand outside light or a ward.',
        lucidityWeight: 20
    },
    fragile_mind: {
        id: 'fragile_mind', name: 'Fragile Mind',
        desc: 'Your maximum Sanity is halved for the entire descent.',
        lucidityWeight: 30
    }
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
        2: "Max Sanity +50",
        4: "Taking damage triggers an AoE shockwave, but you cannot dash.",
        bonuses: { 2: { sanity: 50 }, 4: { grant: 'shockwave_no_dash' } }
    },
    medicated: {
        name: "Medicated",
        2: "Damage taken -20%",
        4: "Max Sanity +80",
        bonuses: { 2: { grant: 'medicated_mitigation' }, 4: { sanity: 80 } }
    },
    relapse: {
        name: "The Relapse",
        2: "Lucidity gain +20%",
        4: "Melee and kinetic damage +30%, but max Sanity -40.",
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
        name: 'Twitching Fingers', desc: 'Weapon cooldowns accelerate as Sanity drops.',
        effects: { grant: 'twitch_cooldown' }
    },
    legs_pacing: {
        id: 'legs_pacing', type: 'legs', set: 'insomniac',
        name: 'Pacing Gait', desc: 'Move speed +8%.',
        effects: { speed: 8 }
    },
    presc_stimulant: {
        id: 'presc_stimulant', type: 'prescription', set: 'insomniac',
        name: 'Amphetamine Script', desc: 'Move speed +5%, but max Sanity -20.',
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
        name: 'Compliance Cap', desc: 'Max Sanity +40, flashlight range -10%.',
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
        name: 'Dosage Regimen', desc: 'Max Sanity +30.',
        effects: { sanity: 30 }
    },
    hands_tremor: {
        id: 'hands_tremor', type: 'hands', set: 'medicated',
        name: 'Lithium Tremor', desc: 'Tech weapon damage +15%.',
        effects: { tagDamage: { tech: 15 } }
    },
    presc_antipsychotic: {
        id: 'presc_antipsychotic', type: 'prescription', set: 'medicated',
        name: 'Antipsychotic Script', desc: 'Max Sanity +40, but Lucidity gain -10%.',
        effects: { sanity: 40, lucidityGain: -10 }
    },

    // --- THE RELAPSE: raw damage and greed, paid for in Sanity. ---
    body_scars: {
        id: 'body_scars', type: 'body', set: 'relapse',
        name: 'Old Scars', desc: 'Melee and kinetic damage +20%, but max Sanity -20.',
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
        name: 'Withdrawal', desc: 'Lucidity gain +25%, but max Sanity -30.',
        effects: { lucidityGain: 25, sanity: -30 }
    }
};

// Slot types, in display order. Single source of truth — SaveManager's
// equippedTokens shape, UIManager's render loop, and index.html's .token-slot divs
// must all agree with this list (§2 called out five hardcoded copies of the old
// 4-slot shape; this constant exists so a 6th slot never needs five more edits).
export const TOKEN_SLOT_TYPES = ['head', 'body', 'hands', 'legs', 'prescription'];