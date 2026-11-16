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
    stats: { chestsOpened: 10, outagesRestored: 1, lockdownsSurvived: 1, cursedFloorClears: 1, dailiesPlayed: 1 },
    daily: { streak: 3 },
    // Patch 142: every Case File page filed, both endings seen.
    story: { pages: Object.fromEntries(Array.from({ length: 25 }, (_, i) => ['p' + String(i + 1).padStart(2, '0'), 1])), endingSeen: true, trueEndingSeen: true }
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

// ============================================================================
// Patch 140: the Daily Session.
// ============================================================================
{
    const D = await import('./src/systems/Daily.js');
    const { PATIENT_ORDER } = await import('./src/data/Patients.js');
    const { INTRUSIVE_THOUGHTS } = await import('./src/data/Manifestations.js');
    ok(D.dailyKey(new Date(2026, 10, 6)) === '2026-11-06', 'dailyKey is local YYYY-MM-DD');
    ok(D.nextKey('2026-12-31') === '2027-01-01' && D.nextKey('2028-02-28') === '2028-02-29', 'nextKey crosses months, years, leap days');
    const a = D.dailySetup('2026-11-16'), b = D.dailySetup('2026-11-16');
    ok(a.seed === b.seed && a.patient === b.patient && a.curse === b.curse, 'the same day gives the same session');
    ok(PATIENT_ORDER.includes(a.patient) && INTRUSIVE_THOUGHTS[a.curse], `a real Patient and Intrusive Thought (${a.patient}, ${a.curse})`);
    const pats = new Set(), curses = new Set();
    for (let i = 0; i < 60; i++) { const s = D.dailySetup(D.dailyKey(new Date(2026, 0, 1 + i))); pats.add(s.patient); curses.add(s.curse); }
    ok(pats.size === PATIENT_ORDER.length && curses.size >= 5, `sessions vary by day (${pats.size} Patients, ${curses.size} thoughts over 60 days)`);
    const r1 = D.roomRng(a, 2, 3), r2 = D.roomRng(a, 2, 3), r3 = D.roomRng(a, 2, 4);
    const s1 = [r1(), r1(), r1()], s2 = [r2(), r2(), r2()], s3 = [r3(), r3(), r3()];
    ok(s1.join() === s2.join() && s1.join() !== s3.join(), 'roomRng: same room same rolls, another room different');
    const real = Math.random;
    try { D.withRandom(() => 0.5, () => { throw new Error('x'); }); } catch (e) {}
    ok(Math.random === real, 'withRandom restores Math.random even when fn throws');

    // The record: one attempt a day, a streak, the best kept.
    let rec = D.emptyDaily();
    ok(D.canStartDaily(rec, '2026-11-16'), 'a fresh record can start');
    rec = D.startDailyAttempt(rec, '2026-11-16');
    ok(!D.canStartDaily(rec, '2026-11-16') && rec.streak === 1 && rec.played === 1, 'started: no second attempt today, streak 1');
    let fin = D.finishDailyAttempt(rec, '2026-11-16', 830);
    ok(fin.isBest && fin.record.best === 830 && fin.record.lastScore === 830, 'first score is the best');
    ok(D.finishDailyAttempt(fin.record, '2026-11-15', 99999).record.best === 830, "a score for another day's run is ignored");
    rec = D.startDailyAttempt(fin.record, '2026-11-17');
    ok(D.canStartDaily(fin.record, '2026-11-17') && rec.streak === 2, 'the next day: available, streak 2');
    fin = D.finishDailyAttempt(rec, '2026-11-17', 500);
    ok(!fin.isBest && fin.record.best === 830 && fin.record.lastScore === 500, 'a lower score keeps the best');
    rec = D.startDailyAttempt(fin.record, '2026-11-20');
    ok(rec.streak === 1, 'a missed day resets the streak');
    ok(D.dailyScore({ floor: 2, roomNumber: 3, maxRoomsPerFloor: 5, roomCleared: true, runKills: 47 }) === (5 + 2 + 1) * 100 + 47, 'score: 100 per room cleared + kills');
    ok(D.dailyScore({ floor: 1, roomNumber: 1, runKills: 0 }) === 0, 'nothing cleared scores 0');

    // SaveManager.
    storage = {};
    const sm = new SaveManager();
    ok(sm.metaState.daily && sm.metaState.daily.best === 0 && sm.canStartDaily('2026-11-16'), 'constructor: an empty daily record');
    sm.beginDaily('2026-11-16');
    ok(!sm.canStartDaily('2026-11-16') && sm.metaState.stats.dailiesPlayed === 1, 'beginDaily records the attempt and the stat');
    const res = sm.finishDaily('2026-11-16', 1234);
    ok(res.score === 1234 && res.best === 1234 && res.isBest, 'finishDaily');
    ok(sm.claimAchievements().some(x => x.id === 'same_time_tomorrow'), 'Same Time Tomorrow');
    const sm2 = new SaveManager();
    ok(sm2.metaState.daily.best === 1234 && !sm2.canStartDaily('2026-11-16'), 'persisted: no retry after a reload');
    storage = { fractured_meta: JSON.stringify({ lucidityBank: 1 }) };
    ok(new SaveManager().metaState.daily.best === 0, 'loadGame back-fills the daily record');
    sm2.importSave(btoa(JSON.stringify({ lucidityBank: 1 })));
    ok(sm2.metaState.daily.best === 0 && sm2.canStartDaily('2026-11-16'), 'importSave: the daily record comes from the file');
    sm2.metaState.daily.best = 5; sm2.wipeSave();
    ok(sm2.metaState.daily.best === 0, 'wipeSave resets it');

    // Game.init and the shared rooms.
    const { Game } = await import('./src/core/Game.js');
    const baseMeta = () => ({ upgrades: { hp: 0, speed: 0, light: 0, magnet: 0 }, killCounts: {}, inventory: [], equippedTokens: {}, selectedCurses: ['nyctophobia'], maxFloorReached: 1, tutorialCompleted: true });
    const setup = { ...D.dailySetup('2026-11-16'), patient: 'photographer', curse: 'tunnel_vision' };
    const g = new Game(); g.init({ metaState: baseMeta(), saveGame: () => {} }, null, { daily: setup });
    ok(g.state.player.character === 'photographer', 'the daily Patient, even locked');
    ok(g.state.player.curses.join() === 'tunnel_vision', "the daily's thought replaces the adopted ones");
    ok(g.state.player.weapons.polaroid_camera.level === 1, "with that Patient's instrument");
    const carried = g.getCarriedState();
    ok(carried.daily && carried.daily.key === '2026-11-16', 'the daily rides the carried state');
    const g2 = new Game(); g2.init({ metaState: baseMeta(), saveGame: () => {} }, { ...carried, floor: 2 });
    ok(g2.state.daily && g2.state.daily.seed === setup.seed && g2.state.player.curses.join() === 'tunnel_vision', 'a descent keeps the daily');
    const rooms = (noise) => {
        const gg = new Game(); gg.init({ metaState: baseMeta(), saveGame: () => {} }, null, { daily: setup });
        const out = [];
        for (const [f, r] of [[2, 2], [2, 3], [3, 2], [3, 4], [4, 3]]) {
            for (let i = 0; i < noise; i++) Math.random();
            gg.state.floor = f; gg.state.player.x = 0; gg.state.player.y = 0;
            gg.director.spawnRoom(f, r);
            out.push([gg.state.roomModifier, gg.state.arenaLayout, gg.state.roomEvent && gg.state.roomEvent.id, gg.state.eliteAt, gg.state.enemyBudget].join('/'));
        }
        return out.join(' | ');
    };
    const ra = rooms(0), rb = rooms(37);
    ok(ra === rb, `the daily's rooms do not depend on anything else's randomness`);
    ok(Math.random === real, 'Math.random is restored after spawnRoom');
    const plain = new Game(); plain.init({ metaState: baseMeta(), saveGame: () => {} });
    ok(plain.state.daily === null && plain.state.player.curses.join() === 'nyctophobia', 'a normal run is unchanged');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
