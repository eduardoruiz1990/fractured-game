// src/data/Achievements.js
//
// Patch 139 (V2 plan D7): achievements — reasons to come back.
//
// The Mind Palace had one kind of trophy (kill counts). These are 31 goals across the
// whole game: the five fears faced, depth into the Recursion, the codexes, the
// Patients, the room events. Every one is a PREDICATE OVER THE SAVE (metaState), never
// over a live run, so:
//   - an existing player with the progress is credited the first time it is checked;
//   - nothing can be earned twice or lost; checking is idempotent and cheap (31 tests);
//   - the only new data are a few lifetime counters in metaState.stats (chests opened,
//     outages restored, lockdowns survived, cursed floor clears) and the unlock dates
//     in metaState.achievements (id -> ms timestamp).
//
// SaveManager.claimAchievements() records any newly true ones and returns them; main.js
// announces them (the notice card in play, a line on the death screen).

import { SYNERGIES } from './Manifestations.js';
import { PATIENT_ORDER, isPatientUnlocked } from './Patients.js';

const kc = (m, k) => Number((m && m.killCounts && m.killCounts[k]) || 0);
const st = (m, k) => Number((m && m.stats && m.stats[k]) || 0);
const keysWith = (o) => Object.keys(o || {}).filter(k => (Number(o[k]) || 0) > 0).length;

const REGULAR_KILL_TYPES = ['SCAVENGER', 'PREDATOR', 'PARASITE', 'SPLITTER', 'WARDEN', 'BURROWER'];
const BOSS_KILL_TYPES = ['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'];

/** Nightmares banished, lifetime (regular types plus bosses; elites are counted under their own type too). */
export function totalKills(m) {
    return REGULAR_KILL_TYPES.concat(BOSS_KILL_TYPES).reduce((n, k) => n + kc(m, k), 0);
}

export function patientLevel(m) {
    const spent = Number((m && m.spentLucidity) || 0);
    return Math.floor(Math.sqrt(Math.max(0, spent) / 500)) + 1;
}

// `goal` + `value` give a progress readout for counters; plain predicates use `test`.
const counter = (value, goal) => ({ value, goal, test: (m) => value(m) >= goal });

export const ACHIEVEMENTS = [
    // --- the work itself --------------------------------------------------------
    { id: 'first_contact', icon: '👁️', name: 'First Contact', desc: 'Banish your first nightmare.', ...counter(totalKills, 1) },
    { id: 'caseload', icon: '🗂️', name: 'Caseload', desc: 'Banish 100 nightmares.', ...counter(totalKills, 100) },
    { id: 'backlog', icon: '📚', name: 'Case Backlog', desc: 'Banish 1,000 nightmares.', ...counter(totalKills, 1000) },
    { id: 'archive', icon: '🏛️', name: 'The Archive', desc: 'Banish 10,000 nightmares.', ...counter(totalKills, 10000) },

    // --- the five fears ---------------------------------------------------------
    { id: 'faced_denial', icon: '⚪', name: 'Denial, Faced', desc: 'Defeat the Sphere Head.', ...counter(m => kc(m, 'BOSS'), 1) },
    { id: 'faced_projection', icon: '🦋', name: 'Projection, Faced', desc: 'Defeat the Rorschach.', ...counter(m => kc(m, 'RORSCHACH'), 1) },
    { id: 'faced_vigilance', icon: '🗼', name: 'Hypervigilance, Faced', desc: 'Defeat the Panopticon.', ...counter(m => kc(m, 'PANOPTICON'), 1) },
    { id: 'faced_repression', icon: '🧩', name: 'Repression, Faced', desc: 'Defeat the Amalgamation.', ...counter(m => kc(m, 'AMALGAMATION'), 1) },
    { id: 'faced_control', icon: '📐', name: 'Control, Faced', desc: 'Defeat the Architect.', ...counter(m => kc(m, 'ARCHITECT'), 1) },
    { id: 'recurring_themes', icon: '🔁', name: 'Recurring Themes', desc: 'Defeat each of the five at least three times.',
      ...counter(m => Math.min(...BOSS_KILL_TYPES.map(k => kc(m, k))), 3) },

    // --- named ones ---------------------------------------------------------------
    { id: 'named', icon: '🏷️', name: 'Named and Faced', desc: 'Defeat a named elite.', ...counter(m => kc(m, 'ELITE'), 1) },
    { id: 'roll_call', icon: '📋', name: 'Roll Call', desc: 'Defeat 25 named elites.', ...counter(m => kc(m, 'ELITE'), 25) },

    // --- depth --------------------------------------------------------------------
    { id: 'going_down', icon: '🪜', name: 'Going Down', desc: 'Reach Floor 3.', ...counter(m => Number(m.maxFloorReached) || 1, 3) },
    { id: 'the_recursion', icon: '♾️', name: 'The Recursion', desc: 'Reach Floor 6, past the Architect.', ...counter(m => Number(m.maxFloorReached) || 1, 6) },
    { id: 'cycle_three', icon: '🔂', name: 'Cycle III', desc: 'Reach Floor 11.', ...counter(m => Number(m.maxFloorReached) || 1, 11) },
    { id: 'bottomless', icon: '🕳️', name: 'Bottomless', desc: 'Reach Floor 16.', ...counter(m => Number(m.maxFloorReached) || 1, 16) },

    // --- coming back ----------------------------------------------------------------
    { id: 'admitted', icon: '🏥', name: 'Admitted', desc: 'Begin your first descent.', ...counter(m => Number(m.runsStarted) || 0, 1) },
    { id: 'regular', icon: '🗓️', name: 'Regular Appointments', desc: 'Begin 10 descents.', ...counter(m => Number(m.runsStarted) || 0, 10) },
    { id: 'long_term', icon: '🛏️', name: 'Long-Term Patient', desc: 'Begin 50 descents.', ...counter(m => Number(m.runsStarted) || 0, 50) },
    { id: 'discharge', icon: '🚪', name: 'Discharge Papers', desc: 'Clear Floor 5 three times.', ...counter(m => Number(m.runsCompleted) || 0, 3) },
    { id: 'patient_ten', icon: '📈', name: 'Patient Level 10', desc: 'Reach Patient Level 10.', ...counter(patientLevel, 10) },

    // --- the codexes ------------------------------------------------------------------
    { id: 'connections', icon: '🔗', name: 'Connections', desc: 'Form a synergy.', ...counter(m => keysWith(m.discoveredSynergies), 1) },
    { id: 'associations', icon: '🕸️', name: 'Associations', desc: 'Form 5 different synergies.', ...counter(m => keysWith(m.discoveredSynergies), 5) },
    { id: 'total_recall', icon: '🧠', name: 'Total Recall', desc: 'Form every synergy.',
      ...counter(m => Object.keys(SYNERGIES).filter(k => (Number((m.discoveredSynergies || {})[k]) || 0) > 0).length, Object.keys(SYNERGIES).length) },
    { id: 'growth', icon: '⬆️', name: 'Growth', desc: 'Evolve a weapon.', ...counter(m => keysWith(m.discoveredEvolutions), 1) },
    { id: 'transformation', icon: '🌱', name: 'Transformation', desc: 'Discover 6 different evolutions.', ...counter(m => keysWith(m.discoveredEvolutions), 6) },

    // --- the ward and the rooms -----------------------------------------------------------
    { id: 'full_ward', icon: '👥', name: 'Full Ward', desc: 'Admit all four Patients.',
      ...counter(m => PATIENT_ORDER.filter(id => isPatientUnlocked(id, m)).length, PATIENT_ORDER.length) },
    { id: 'lights_on', icon: '💡', name: 'Lights On', desc: 'Restore the power during an outage.', ...counter(m => st(m, 'outagesRestored'), 1) },
    { id: 'held', icon: '🔒', name: 'Held', desc: 'Survive a Lockdown.', ...counter(m => st(m, 'lockdownsSurvived'), 1) },
    { id: 'care_packages', icon: '🎁', name: 'Care Packages', desc: 'Open 10 chests.', ...counter(m => st(m, 'chestsOpened'), 10) },
    // Patch 140: the Daily Session.
    { id: 'same_time_tomorrow', icon: '📅', name: 'Same Time Tomorrow', desc: 'Play a Daily Session.', ...counter(m => st(m, 'dailiesPlayed'), 1) },
    { id: 'routine', icon: '⏰', name: 'Routine', desc: 'Play the Daily Session three days in a row.', ...counter(m => Number((m && m.daily && m.daily.streak) || 0), 3) },
    { id: 'living_with_it', icon: '💭', name: 'Living With It', desc: 'Clear a floor with an Intrusive Thought adopted.', ...counter(m => st(m, 'cursedFloorClears'), 1) }
];

export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));

/** Lifetime counters that only exist for achievements (metaState.stats). */
export const STAT_KEYS = ['chestsOpened', 'outagesRestored', 'lockdownsSurvived', 'cursedFloorClears', 'dailiesPlayed'];

export function emptyStats() {
    return Object.fromEntries(STAT_KEYS.map(k => [k, 0]));
}

/** Ids whose predicate holds for this save. */
export function earnedAchievements(meta) {
    return ACHIEVEMENTS.filter(a => { try { return !!a.test(meta || {}); } catch (e) { return false; } }).map(a => a.id);
}

/** Progress for a counter achievement: { value, goal } with value capped at goal. */
export function achievementProgress(a, meta) {
    if (!a || typeof a.value !== 'function') return null;
    let v = 0;
    try { v = Number(a.value(meta || {})) || 0; } catch (e) { v = 0; }
    return { value: Math.min(v, a.goal), goal: a.goal };
}
