/**
 * Patch 142+ (V2 plan E): the story layer.
 *
 * Run with:  node test_story.js   (assertion-based, exits 1 on failure)
 *
 * Covers src/data/Story.js (the text's shape and limits, chapters, page order and the
 * drop rules, session notes and reactions, boss lines, the ending choice), Strings.js,
 * the SaveManager seams for metaState.story (constructor default, loadGame back-fill,
 * importSave deriving from the file, wipeSave resetting, collectPage/markStory), and
 * the Patients' page-count unlocks.
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

const Story = await import('./src/data/Story.js');
const { STRINGS, CREDITS } = await import('./src/data/Strings.js');
const { SaveManager } = await import('./src/core/SaveManager.js');
const { isPatientUnlocked, PATIENT_PAGE_UNLOCKS } = await import('./src/data/Patients.js');
const {
    CASE_PAGES, PAGE_BY_ID, TOTAL_PAGES, CHAPTERS, COLD_OPEN, CONTENT_NOTE, BOSS_LINES, BOSS_LINE_MAX,
    SESSION_NOTES, REACTIONS, ENDINGS, chapterForFloor, nextPageFor, pageCount, allPagesFound, rollPageDrop,
    bossIntroLines, bossDeathLine, sessionReaction, sessionNoteForFloor, awakenNote, endingCards, endingForClear,
    emptyStory, normalizeStory, REACTION_FAST_STEPS
} = Story;

const pagesMeta = (ids, extra = {}) => ({ story: { ...emptyStory(), pages: Object.fromEntries(ids.map(id => [id, 1])), ...extra } });
const ALL_IDS = CASE_PAGES.map(p => p.id);

// --- the text ----------------------------------------------------------------------------
ok(TOTAL_PAGES === 25, `25 Case File pages (${TOTAL_PAGES})`);
ok(new Set(ALL_IDS).size === 25, 'page ids unique');
ok(CHAPTERS.length === 5 && CHAPTERS.every((c, i) => CASE_PAGES.filter(p => p.chapter === i + 1).length === 5), 'five chapters of five pages');
ok(CASE_PAGES.every(p => p.title && p.text && p.text.length >= 40 && p.text.length <= 320), 'every page has a title and 40–320 characters of text');
ok(CASE_PAGES.every(p => !/[<>]/.test(p.title + p.text)), 'no markup in page text (it is inserted as text)');
ok(COLD_OPEN.length === 4 && COLD_OPEN[0] === CONTENT_NOTE, 'cold open: the content note first, then three cards');
ok(COLD_OPEN.every(c => c.stamp && c.title && c.text), 'every cold-open card has a stamp, title and text');
ok(/no self-harm/i.test(CONTENT_NOTE.text) && /helpline/i.test(CONTENT_NOTE.text), 'the content note says no self-harm and points to help');

// Tone guardrails (E6): words that should never appear in the player-facing story.
// (The content note itself is left out: it names what the game does NOT contain.)
const allText = JSON.stringify([CASE_PAGES, COLD_OPEN.slice(1), BOSS_LINES, SESSION_NOTES, REACTIONS, ENDINGS, CREDITS]);
const banned = ['suicid', 'self-harm', 'kill yourself', 'cutting', 'blood', 'gore', 'insane', 'lunatic', 'psycho', 'crazy'];
ok(banned.every(w => !allText.toLowerCase().includes(w)), `no banned words (${banned.filter(w => allText.toLowerCase().includes(w))})`);

// Boss lines: every boss, two intro lines, a relapse pair, a death line; each short enough for a phone.
const BOSSES = ['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'];
ok(BOSSES.every(b => BOSS_LINES[b] && BOSS_LINES[b].intro.length === 2 && BOSS_LINES[b].relapse.length === 2 && BOSS_LINES[b].death), 'every boss has intro, relapse and death lines');
ok(BOSSES.every(b => [...BOSS_LINES[b].intro, ...BOSS_LINES[b].relapse].every(l => l.length <= BOSS_LINE_MAX)), `banner lines <= ${BOSS_LINE_MAX} characters`);
ok(CHAPTERS.every((c, i) => c.boss === BOSSES[i]), 'chapter n is boss n');
ok(bossIntroLines('BOSS', 1) === BOSS_LINES.BOSS.intro && bossIntroLines('BOSS', 6) === BOSS_LINES.BOSS.relapse, 'relapse lines on floor 6+');
ok(bossIntroLines('NOPE', 1).length === 0 && bossDeathLine('NOPE') === '', 'unknown type: no lines (no throw)');
ok(bossDeathLine('ARCHITECT') === BOSS_LINES.ARCHITECT.death, 'death line');

// Strings and credits.
ok(typeof STRINGS.pageFiled === 'function' && STRINGS.pageFiled(3, 25) === 'PAGE FILED · 3 / 25', 'pageFiled label');
ok(CREDITS.length >= 3 && CREDITS.every(c => typeof c.t === 'string' && c.t), 'credits lines');
ok(!/eduardo|ruiz/i.test(JSON.stringify(CREDITS)), 'credits are generic (no personal names)');

// --- chapters and drops ----------------------------------------------------------------------
ok([1, 2, 3, 4, 5].every(f => chapterForFloor(f) === f), 'floors 1-5 tell chapters 1-5');
ok(chapterForFloor(6) === 1 && chapterForFloor(10) === 5 && chapterForFloor(12) === 2, 'the Recursion cycles the chapters');
ok(nextPageFor({}, 1) === 'p01' && nextPageFor({}, 5) === 'p21', 'first drop is the chapter\'s first page');
ok(nextPageFor(pagesMeta(['p01', 'p02']), 1) === 'p03', 'pages come in order within a chapter');
ok(nextPageFor({}, 1, ['p01']) === 'p02', 'a page already lying on the floor is not dropped twice');
ok(nextPageFor(pagesMeta(['p01', 'p02', 'p03', 'p04', 'p05']), 1) === null, 'chapter 1 complete: floor 1 drops nothing more');
ok(nextPageFor(pagesMeta(['p06', 'p07', 'p08', 'p09', 'p10']), 2) === 'p01', 'a complete chapter backfills an earlier one');
ok(nextPageFor(pagesMeta(['p11', 'p12', 'p13', 'p14', 'p15']), 3) === 'p01', 'backfill picks the earliest missing page');
ok(nextPageFor(pagesMeta(ALL_IDS), 5) === null, 'everything filed: nothing to drop');
ok(nextPageFor(pagesMeta(ALL_IDS.filter(id => id !== 'p25')), 6) === null, 'a later chapter is never pulled forward (floor 6 tells chapter 1)');
ok(rollPageDrop('boss', () => 0.999) === true, 'a boss always drops');
ok(rollPageDrop('elite', () => 0.2) === true && rollPageDrop('elite', () => 0.8) === false, 'an elite drops half the time');
ok(rollPageDrop('scavenger', () => 0) === false, 'ordinary enemies never drop');
ok(pageCount(pagesMeta(['p01', 'zzz'])) === 1, 'pageCount ignores unknown ids');
ok(allPagesFound(pagesMeta(ALL_IDS)) && !allPagesFound(pagesMeta(ALL_IDS.slice(1))), 'allPagesFound');

// --- session notes -------------------------------------------------------------------------
ok([1, 2, 3, 4, 5].every(c => SESSION_NOTES.floor[c] && SESSION_NOTES.relapse[c] && SESSION_NOTES.awaken[c]), 'a floor, relapse and awaken note per chapter');
ok(new Set([1, 2, 3, 4, 5].map(c => SESSION_NOTES.floor[c])).size === 5, 'a different note per floor');
ok(sessionReaction({ sanityRatio: 0.1, floorSteps: 10 }) === 'low', 'low Sanity wins');
ok(sessionReaction({ sanityRatio: 0.9, floorSteps: REACTION_FAST_STEPS - 1 }) === 'fast', 'a fast clear');
ok(sessionReaction({ sanityRatio: 0.9, floorSteps: REACTION_FAST_STEPS * 2, deaths: 7 }) === 'returning', 'many deaths');
ok(sessionReaction({}) === 'steady' && sessionReaction({ sanityRatio: NaN, floorSteps: NaN }) === 'steady', 'defaults and NaN: steady');
const n3 = sessionNoteForFloor(3, { sanityRatio: 0.9, floorSteps: 1e9 });
ok(n3.label === 'SESSION NOTE · FLOOR 3' && n3.text.startsWith(SESSION_NOTES.floor[3]) && n3.text.endsWith(REACTIONS.steady), 'floor note = the floor\'s note + the reaction');
const n7 = sessionNoteForFloor(7, {});
ok(n7.label === 'RELAPSE NOTE · FLOOR 7' && n7.text.startsWith(SESSION_NOTES.relapse[2]), 'the Recursion gets relapse notes');
ok(awakenNote(4).text === SESSION_NOTES.awaken[4] && awakenNote(9).text === SESSION_NOTES.awaken[4], 'awaken note by chapter');

// --- endings ----------------------------------------------------------------------------------
ok(endingForClear({}, 5) === 'first', 'first Architect clear: the first ending');
ok(endingForClear({}, 4) === null && endingForClear({}, 6) === null, 'no ending off an Architect floor');
ok(endingForClear(pagesMeta([], { endingSeen: true }), 5) === null, 'first ending plays once');
ok(endingForClear(pagesMeta(ALL_IDS), 5) === 'true', 'all pages on the first clear: straight to the true ending');
ok(endingForClear(pagesMeta(ALL_IDS, { endingSeen: true }), 10) === 'true', 'all pages later: the true ending at the next Architect (floor 10 too)');
ok(endingForClear(pagesMeta(ALL_IDS, { endingSeen: true, trueEndingSeen: true }), 5) === null, 'true ending plays once');
const fc = endingCards('first', pagesMeta(['p01', 'p02']));
ok(fc.some(c => /2 of 25/.test(c.text)) && !fc.some(c => /\{pages\}/.test(c.text)), 'first ending reports the page count');
ok(endingCards('true', {}).length === ENDINGS.true.length, 'true ending cards');
ok(ENDINGS.true.some(c => /not your fault/i.test(c.text)), 'the true ending says it was not their fault');

// --- the save record -----------------------------------------------------------------------------
{
    const n = normalizeStory({ pages: { p01: 5, bogus: 1, p02: 0 }, endingSeen: 1, junk: true });
    ok(Object.keys(n.pages).join() === 'p01' && n.endingSeen === true && n.coldOpenSeen === false && !('junk' in n), 'normalizeStory filters and defaults');
    ok(JSON.stringify(normalizeStory(null)) === JSON.stringify(emptyStory()), 'normalizeStory(null) is empty');
}
{
    storage = {};
    const sm = new SaveManager();
    ok(JSON.stringify(sm.metaState.story) === JSON.stringify(emptyStory()), 'constructor: story empty');
    ok(sm.collectPage('p01', 1700000000000) === true && sm.collectPage('p01') === false, 'collectPage: first time only');
    ok(sm.collectPage('nope') === false, 'collectPage refuses unknown ids');
    sm.markStory('coldOpenSeen'); sm.markStory('notAFlag');
    ok(sm.metaState.story.coldOpenSeen === true && !('notAFlag' in sm.metaState.story), 'markStory sets known flags only');
    const sm2 = new SaveManager();
    ok(sm2.metaState.story.pages.p01 === 1700000000000 && sm2.metaState.story.coldOpenSeen, 'persisted and reloaded');
}
{
    storage = { fractured_meta: JSON.stringify({ lucidityBank: 5, killCounts: {} }) };
    const sm = new SaveManager();
    ok(JSON.stringify(sm.metaState.story) === JSON.stringify(emptyStory()), 'loadGame back-fills story on an old save');
    storage = { fractured_meta: JSON.stringify({ story: { pages: { p03: 9 } } }) };
    const sm3 = new SaveManager();
    ok(sm3.metaState.story.pages.p03 === 9 && sm3.metaState.story.endingSeen === false, 'a partial story is completed');
}
{
    storage = {};
    const sm = new SaveManager();
    sm.collectPage('p01'); sm.markStory('endingSeen');
    sm.importSave(btoa(JSON.stringify({ lucidityBank: 1, killCounts: {}, maxFloorReached: 1 })));
    ok(pageCount(sm.metaState) === 0 && !sm.metaState.story.endingSeen, 'importSave: story comes from the file, not this profile');
    sm.importSave(btoa(JSON.stringify({ lucidityBank: 1, killCounts: {}, story: { pages: { p05: 1 }, trueEndingSeen: true } })));
    ok(sm.metaState.story.pages.p05 === 1 && sm.metaState.story.trueEndingSeen, 'importSave: an exported story round-trips');
    sm.wipeSave();
    ok(JSON.stringify(sm.metaState.story) === JSON.stringify(emptyStory()), 'wipeSave resets it');
}

// --- Patients unlock by pages too ----------------------------------------------------------------
{
    const base = { killCounts: {}, maxFloorReached: 1 };
    const withPages = (n) => ({ ...base, ...pagesMeta(ALL_IDS.slice(0, n)) });
    ok(!isPatientUnlocked('vandal', base) && isPatientUnlocked('vandal', withPages(PATIENT_PAGE_UNLOCKS.vandal)), 'the Vandal: 3 pages');
    ok(!isPatientUnlocked('artist', withPages(7)) && isPatientUnlocked('artist', withPages(8)), 'the Artist: 8 pages');
    ok(!isPatientUnlocked('photographer', withPages(13)) && isPatientUnlocked('photographer', withPages(14)), 'the Photographer: 14 pages');
    ok(isPatientUnlocked('vandal', { ...base, killCounts: { BOSS: 1 } }), 'the old rule still unlocks (an alternative, not a replacement)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
