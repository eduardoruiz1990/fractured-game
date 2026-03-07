// src/data/Manifestations.js
// The JSON dictionary of weapons and upgrades. 
// Note: We removed the functions from here to keep data and logic separated.
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
    }
};