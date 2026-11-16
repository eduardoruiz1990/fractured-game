/**
 * Patch 139+ (V2 plan D7): reasons to return — achievements, instrument unlocks.
 *
 * Run with:  node test_progress.js   (assertion-based, exits 1 on failure)
 *
 * Covers src/data/Achievements.js, src/data/Unlocks.js, and their SaveManager seams
 * (constructor default, loadGame back-fill of an old save, importSave deriving from the
 * file, wipeSave resetting, claimAchievements being idempotent), and Game.init carrying
 * the locked instruments onto the run.
 */

let storage = {};
global.localStorage = { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); }, removeItem: (k) => { delete storage[k]; } };
global.window = { location: { reload: () => {} }, addEventListener: () => {} };
global.CustomEvent = class CustomEvent { constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; } };
global.document = {
    addEventListener: () => {}, dispatchEvent: () => {}, getElementById: () => null,
    createElement: () => ({ width: 1920, height: 1080, getContext: () => new Proxy({}, { get: () => () => ({ addColorStop: () => {}, data: [] }) }) })
};
global.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
global.atob = (s) => Buffer.from(s, 'base64').toString('binary');

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.log('FAIL ' + m); } };

const { ACHIEVEMENTS, ACHIEVEMENT_BY_ID, earnedAchievements, achievementProgress, totalKills, patientLevel, STAT_KEYS } =
    await import('./src/data/Achievements.js');
const { WEAPON_UNLOCKS, lockedWeapons, isWeaponUnlocked } = await import('./src/data/Unlocks.js');
const { SYNERGIES } = await import('./src/data/Manifestations.js');
const { EVOLUTIONS } = await import('./src/systems/Evolutions.js');
const { SaveManager } = await import('./src/core/SaveManager.js');

// --- the data ----------------------------------------------------------------------
ok(ACHIEVEMENTS.length >= 30, `about 30 achievements (${ACHIEVEMENTS.length})`);
ok(new Set(ACHIEVEMENTS.map(a => a.id)).size === ACHIEVEMENTS.length, 'ids unique');
ok(ACHIEVEMENTS.every(a => a.icon && a.name && a.desc && typeof a.test === 'function'), 'every achievement has icon, name, desc, test');
ok(ACHIEVEMENTS.every(a => ![...a.icon].some(ch => { const c = ch.codePointAt(0); return c >= 0x1F700 && c <= 0x1F77F; })), 'no alchemical glyphs (blank on Android/Windows)');
ok(earnedAchievements({}).length === 0, 'an empty save has none');
ok(earnedAchievements(undefined).length === 0, 'an undefined save has none (no throw)');

const maxed = {
    killCounts: { SCAVENGER: 9000, PREDATOR: 600, PARASITE: 400, BOSS: 3, RORSCHACH: 3, PANOPTICON: 3, AMALGAMATION: 3, ARCHITECT: 3, ELITE: 25 },
    maxFloorReached: 16, runsStarted: 50, runsCompleted: 3, spentLucidity: 500 * 81,
    discoveredSynergies: Object.fromEntries(Object.keys(SYNERGIES).map(k => [k, 1])),
    discoveredEvolutions: Object.fromEntries(Object.keys(EVOLUTIONS).slice(0, 6).map(k => [k, 1])),
    stats: { chestsOpened: 10, outagesRestored: 1, lockdownsSurvived: 1, cursedFloorClears: 1 }
};
ok(totalKills(maxed) === 10015, `totalKills sums every type (${totalKills(maxed)})`);
ok(patientLevel({ spentLucidity: 500 * 81 }) === 10 && patientLevel({}) === 1, 'patientLevel matches SaveManager.getPatientLevelInfo');
const all = earnedAchievements(maxed);
ok(all.length === ACHIEVEMENTS.length, `a complete save earns all of them (missing: ${ACHIEVEMENTS.filter(a => !all.includes(a.id)).map(a => a.id)})`);
ok(earnedAchievements({ killCounts: { SCAVENGER: 1 } }).join() === 'first_contact', 'one kill earns First Contact only');
ok(earnedAchievements({ maxFloorReached: 6 }).sort().join() === ['going_down', 'the_recursion'].sort().join(), 'Floor 6 earns the depth achievements up to it');
const p = achievementProgress(ACHIEVEMENT_BY_ID.caseload, { killCounts: { SCAVENGER: 37 } });
ok(p.value === 37 && p.goal === 100, 'progress readout for a counter');
ok(achievementProgress(ACHIEVEMENT_BY_ID.caseload, { killCounts: { SCAVENGER: 500 } }).value === 100, 'progress is capped at the goal');
ok(ACHIEVEMENT_BY_ID.total_recall.goal === Object.keys(SYNERGIES).length, 'Total Recall needs every synergy there is');
ok(earnedAchievements({ killCounts: { BOSS: 1, PANOPTICON: 1 }, maxFloorReached: 3 }).includes('full_ward'), 'Full Ward follows the Patients\' unlock rules');

// --- unlocks -----------------------------------------------------------------------
ok(lockedWeapons({}).sort().join() === 'lullaby,metronome,straitjacket', 'a new save has three instruments locked');
ok(isWeaponUnlocked('pill_bottle', {}) && isWeaponUnlocked('flashlight', {}), 'the Pill Bottle and the original eight are never locked');
ok(isWeaponUnlocked('metronome', { maxFloorReached: 2 }), 'the Metronome on Floor 2');
ok(isWeaponUnlocked('straitjacket', { killCounts: { ELITE: 1 } }), 'the Straps on a named elite');
ok(isWeaponUnlocked('lullaby', { stats: { lockdownsSurvived: 1 } }) && isWeaponUnlocked('lullaby', { maxFloorReached: 4 }), 'the Lullaby on a lockdown, or Floor 4');
ok(lockedWeapons(maxed).length === 0, 'a progressed save has none locked');

// --- SaveManager seams ---------------------------------------------------------------
{
    storage = {};
    const sm = new SaveManager();
    ok(sm.metaState.achievements && Object.keys(sm.metaState.achievements).length === 0, 'constructor: achievements {}');
    ok(STAT_KEYS.every(k => sm.metaState.stats[k] === 0), 'constructor: every stat 0');
    ok(sm.claimAchievements().length === 0, 'nothing to claim on a new save');
    sm.recordStat('chestsOpened', 3);
    sm.recordStat('notAStat', 5);
    ok(sm.metaState.stats.chestsOpened === 3 && !('notAStat' in sm.metaState.stats), 'recordStat counts known keys only');
    sm.metaState.killCounts.SCAVENGER = 120;
    const fresh = sm.claimAchievements(1700000000000);
    ok(fresh.map(a => a.id).sort().join() === 'caseload,first_contact', `claim: First Contact and Caseload (${fresh.map(a => a.id)})`);
    ok(sm.metaState.achievements.caseload === 1700000000000, 'the date is recorded');
    ok(sm.claimAchievements().length === 0, 'claiming again returns nothing (idempotent)');
    ok(sm.achievementCount() === 2, 'achievementCount');
    const sm2 = new SaveManager();
    ok(sm2.metaState.achievements.caseload === 1700000000000 && sm2.metaState.stats.chestsOpened === 3, 'persisted and reloaded');
}
{
    // An old save (before Patch 139) loads with both back-filled, and its progress is credited.
    storage = { fractured_meta: JSON.stringify({ lucidityBank: 5, maxFloorReached: 6, killCounts: { BOSS: 2 } }) };
    const sm = new SaveManager();
    ok(sm.metaState.achievements && typeof sm.metaState.achievements === 'object', 'loadGame back-fills achievements');
    ok(STAT_KEYS.every(k => sm.metaState.stats[k] === 0), 'loadGame back-fills every stat');
    const got = sm.claimAchievements().map(a => a.id);
    ok(got.includes('the_recursion') && got.includes('faced_denial') && got.includes('first_contact'), `an old save is credited (${got})`);
    ok(lockedWeapons(sm.metaState).join() === 'straitjacket', `an old Floor-6 save has only the Straps locked (${lockedWeapons(sm.metaState)})`);
    // A partial stats object is completed, not replaced.
    storage = { fractured_meta: JSON.stringify({ stats: { chestsOpened: 4 } }) };
    const sm3 = new SaveManager();
    ok(sm3.metaState.stats.chestsOpened === 4 && sm3.metaState.stats.lockdownsSurvived === 0, 'a partial stats object is completed');
}
{
    // importSave derives from the FILE; this profile's achievements do not leak in.
    storage = {};
    const sm = new SaveManager();
    sm.metaState.killCounts.SCAVENGER = 5; sm.claimAchievements();
    sm.recordStat('chestsOpened', 9);
    const other = btoa(JSON.stringify({ lucidityBank: 1, killCounts: {}, maxFloorReached: 1 }));
    sm.importSave(other);
    ok(Object.keys(sm.metaState.achievements).length === 0, 'importSave: achievements come from the file, not this profile');
    ok(sm.metaState.stats.chestsOpened === 0, 'importSave: stats come from the file');
    sm.metaState.achievements.x = 1; sm.metaState.stats.chestsOpened = 2;
    sm.wipeSave();
    ok(Object.keys(sm.metaState.achievements).length === 0 && sm.metaState.stats.chestsOpened === 0, 'wipeSave resets both');
}

// --- Game.init carries the locked instruments -------------------------------------------
{
    const { Game } = await import('./src/core/Game.js');
    const mk = (meta) => { const g = new Game(); g.init({ metaState: { upgrades: { hp: 0, speed: 0, light: 0, magnet: 0 }, killCounts: {}, inventory: [], equippedTokens: {}, selectedCurses: [], maxFloorReached: 1, tutorialCompleted: true, ...meta }, saveGame: () => {} }); return g; };
    ok(mk({}).state.player.lockedWeapons.sort().join() === 'lullaby,metronome,straitjacket', 'a new save\'s run has three locked');
    ok(mk({ maxFloorReached: 4, killCounts: { ELITE: 1 } }).state.player.lockedWeapons.length === 0, 'a progressed save\'s run has none');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
