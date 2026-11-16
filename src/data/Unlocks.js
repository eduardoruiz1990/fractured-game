// src/data/Unlocks.js
//
// Patch 139 (V2 plan D7): unlock tracks for instruments.
//
// The four Phase D weapons (Patch 132) were in every run's level-up pool from the first
// minute, beside the original eight. Three of them now enter the pool on a milestone,
// so a first run is learned with fewer, simpler choices and later runs have something
// new to find. The Pill Bottle is always in the pool (it is the simplest of the four).
//
// Rules, like the Patients' (data/Patients.js), are predicates over the save, chosen
// from progress the game already records, so an existing player with that progress has
// them immediately. A locked weapon is only kept out of NEW-weapon offers (level-up
// cards, the WEAPON_UPGRADE door's new-weapon fallback); a weapon somehow already owned
// keeps levelling.

export const WEAPON_UNLOCKS = {
    metronome: {
        text: 'Reach Floor 2.',
        test: (m) => (Number(m && m.maxFloorReached) || 1) >= 2
    },
    straitjacket: {
        text: 'Defeat a named elite.',
        test: (m) => Number((m && m.killCounts && m.killCounts.ELITE) || 0) >= 1
    },
    lullaby: {
        text: 'Survive a Lockdown, or reach Floor 4.',
        test: (m) => Number((m && m.stats && m.stats.lockdownsSurvived) || 0) >= 1
                  || (Number(m && m.maxFloorReached) || 1) >= 4
    }
};

export function isWeaponUnlocked(id, meta) {
    const u = WEAPON_UNLOCKS[id];
    return !u || !!u.test(meta || {});
}

/** Weapon ids still locked for this save. */
export function lockedWeapons(meta) {
    return Object.keys(WEAPON_UNLOCKS).filter(id => !isWeaponUnlocked(id, meta));
}
