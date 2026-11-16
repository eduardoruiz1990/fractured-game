// src/data/Patients.js
//
// Patch 136 (V2 plan D1): playable Patients.
//
// Each Patient is a different way into a run: a starting instrument (on top of the
// flashlight, which is also the player's light and so always carried), one passive,
// and a small stat lean. They also fulfil the Synapse Tree's C2 "starting weapon"
// capstone that was never given a choice (see Game.init).
//
// Unlocks: Phase E's story milestones do not exist yet, so each Patient unlocks on a
// milestone the game already records (a boss killed, a floor reached). Existing
// players with that progress have them immediately. Phase E can swap these predicates
// for story beats without touching anything else.
//
// Every passive is a FLAG on state.player, read at one site each:
//   blackoutImmune  Director.spawnWave   (BLACKOUT rooms do not speed spawns up)
//   meleeLifesteal  Combat (pipe swing), Arsenal (straps)
//   inkMaster       Combat (ink slow, ink damage)
//   critConfused    Enemy.takeDamage     (multiplier on a confused target)

export const DEFAULT_PATIENT = 'insomniac';

export const PATIENTS = {
    insomniac: {
        id: 'insomniac', name: 'THE INSOMNIAC', icon: '🌙', weapon: 'flashlight',
        passive: 'Has not slept in weeks. BLACKOUT rooms do not speed the arrivals up, and the flashlight reaches 10% further.',
        lean: 'No other change.',
        light: 10, flags: { blackoutImmune: true },
        unlock: null, unlockText: 'Admitted.'
    },
    vandal: {
        id: 'vandal', name: 'THE VANDAL', icon: '🔨', weapon: 'lead_pipe',
        passive: 'Starts with the Lead Pipe. Melee hits restore Sanity.',
        lean: 'Max Sanity +20, move speed −5%.',
        sanity: 20, speed: -5, flags: { meleeLifesteal: true },
        unlock: (m) => ((m.killCounts && m.killCounts.BOSS) || 0) >= 1,
        unlockText: 'Defeat the Sphere Head (Floor 1).'
    },
    artist: {
        id: 'artist', name: 'THE ARTIST', icon: '🖋️', weapon: 'spilled_ink',
        passive: 'Starts with Spilled Ink. Pools slow far more, and hit 25% harder.',
        lean: 'Move speed +6%, max Sanity −10.',
        sanity: -10, speed: 6, flags: { inkMaster: true },
        unlock: (m) => (m.maxFloorReached || 1) >= 3,
        unlockText: 'Reach Floor 3.'
    },
    photographer: {
        id: 'photographer', name: 'THE PHOTOGRAPHER', icon: '📷', weapon: 'polaroid_camera',
        passive: 'Starts with the Polaroid Camera. Every hit on a stunned (confused) manifestation is critical: ×1.5.',
        lean: 'Max Sanity −10.',
        sanity: -10, flags: { critConfused: 1.5 },
        unlock: (m) => ((m.killCounts && m.killCounts.PANOPTICON) || 0) >= 1,
        unlockText: 'Defeat the Panopticon (Floor 3).'
    }
};

export const PATIENT_ORDER = ['insomniac', 'vandal', 'artist', 'photographer'];

export function isPatientUnlocked(id, meta) {
    const p = PATIENTS[id];
    if (!p) return false;
    return !p.unlock || !!p.unlock(meta || {});
}

export function unlockedPatients(meta) {
    return PATIENT_ORDER.filter(id => isPatientUnlocked(id, meta));
}

/** The Patient a run should use: the saved choice if it exists and is unlocked. */
export function resolvePatient(id, meta) {
    return (id && PATIENTS[id] && isPatientUnlocked(id, meta)) ? id : DEFAULT_PATIENT;
}

/** Unlocked Patients this profile has not been shown yet (the NEW badge). */
export function newlyAdmitted(meta) {
    const seen = Array.isArray(meta && meta.announcedPatients) ? meta.announcedPatients : [DEFAULT_PATIENT];
    return unlockedPatients(meta).filter(id => !seen.includes(id));
}
