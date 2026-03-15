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
    }
};

export const INTRUSIVE_THOUGHTS = {
    everything_is_target: { id: 'everything_is_target', name: 'Everything is a Target', desc: '+100% Damage, but your flashlight destroys your own XP drops.' },
    manic_episode: { id: 'manic_episode', name: 'Manic Episode', desc: '+50% Fire Rate, but Sanity drains 2x faster.' },
    compulsive_cleaner: { id: 'compulsive_cleaner', name: 'Compulsive Cleaner', desc: 'Janitors drop more XP, but Hall Monitors hunt you at 2x speed.' },
    
    // --- EPIC 4: NEW CURSE ---
    tunnel_vision: { id: 'tunnel_vision', name: 'Tunnel Vision', desc: 'Flashlight damage x3, but the ambient 360-degree safe-glow is removed.' }
};

export const TOKEN_RARITIES = {
    COMMON: { color: '#aaaaaa', costToUpgrade: 100, multiplier: 1.0 },
    RARE: { color: '#5555ff', costToUpgrade: 300, multiplier: 1.5 },
    EPIC: { color: '#aa55ff', costToUpgrade: 1000, multiplier: 2.0 },
    ANOMALOUS: { color: '#ff5555', costToUpgrade: null, multiplier: 3.0 }
};

export const TOKEN_SETS = {
    insomniac: { name: "The Insomniac", 2: "Move Speed +10%", 4: "Permanent outer safe zone that burns enemies." },
    institutionalized: { name: "Institutionalized", 2: "Max Sanity +50", 4: "Damage triggers AoE shockwave, but you cannot dash." }
};

export const TOKENS = {
    head_paranoia: { 
        id: 'head_paranoia', type: 'head', set: 'insomniac', 
        name: 'Paranoid Gaze', desc: 'Flashlight range +50%, angle -20%.' 
    },
    body_denial: { 
        id: 'body_denial', type: 'body', set: 'institutionalized', 
        name: 'Straitjacket of Denial', desc: 'Ignore the first instance of damage per floor.' 
    },
    hands_twitch: { 
        id: 'hands_twitch', type: 'hands', set: 'insomniac', 
        name: 'Twitching Fingers', desc: 'Weapon cooldowns decrease as Sanity drops.' 
    },
    legs_panic: { 
        id: 'legs_panic', type: 'legs', set: 'institutionalized', 
        name: 'Panic Sprint', desc: 'Dash cooldown halved, dash distance reduced.' 
    }
};