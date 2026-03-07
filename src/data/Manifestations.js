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
    }
};