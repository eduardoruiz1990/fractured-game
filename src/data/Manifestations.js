// src/data/Manifestations.js
// The JSON dictionary of weapons and upgrades. 
export const MANIFESTATIONS = {
    flashlight: { 
        id: 'flashlight', 
        name: 'Rusted Flashlight', 
        desc: 'Pierce the fog. Damages enemies.', 
        maxLvl: 5 
    },
    static: { 
        id: 'static', 
        name: 'Static Receiver', 
        desc: 'Emits a pulsing aura of white noise.', 
        maxLvl: 5 
    },
    adrenaline: { 
        id: 'adrenaline', 
        name: 'Adrenaline Spike', 
        desc: 'Increases movement speed & sanity res.', 
        maxLvl: 5 
    },
    lead_pipe: { 
        id: 'lead_pipe', 
        name: 'Heavy Lead Pipe', 
        desc: 'Crushing 360-degree melee sweep.', 
        maxLvl: 5 
    },
    spilled_ink: { 
        id: 'spilled_ink', 
        name: 'Spilled Ink', 
        desc: 'Leaves a slowing, toxic trail behind you.', 
        maxLvl: 5 
    },
    corrosive_battery: {
        id: 'corrosive_battery',
        name: 'Corrosive Battery',
        desc: 'Flashlight applies melting acid over time.',
        maxLvl: 5
    },
    broken_chalk: {
        id: 'broken_chalk',
        name: 'Broken Chalk',
        desc: 'Draws a warding circle. 2x damage inside.',
        maxLvl: 5
    }
};

export const SYNERGIES = {
    blinding_signal: {
        id: 'blinding_signal',
        name: 'The Blinding Signal',
        desc: 'Flashlight strobes violently. Confuses enemies, causing them to attack each other.',
        reqs: ['flashlight', 'static']
    },
    industrial_bleed: {
        id: 'industrial_bleed',
        name: 'Industrial Bleed',
        desc: 'Pipe hits cause massive ink splatters, dealing AoE damage.',
        reqs: ['lead_pipe', 'spilled_ink']
    },
    scholastic_purge: {
        id: 'scholastic_purge',
        name: 'Scholastic Purge',
        desc: 'Chalk wards emit acid mist. Instantly kills Parasites.',
        reqs: ['broken_chalk', 'corrosive_battery']
    }
};

export const INTRUSIVE_THOUGHTS = {
    everything_is_target: {
        id: 'everything_is_target',
        name: 'Everything is a Target',
        desc: '+100% Damage, but your flashlight destroys your own XP drops.'
    },
    manic_episode: {
        id: 'manic_episode',
        name: 'Manic Episode',
        desc: '+50% Fire Rate, but Sanity drains 2x faster.'
    },
    compulsive_cleaner: {
        id: 'compulsive_cleaner',
        name: 'Compulsive Cleaner',
        desc: 'Janitors drop more XP, but Hall Monitors hunt you at 2x speed.'
    }
};