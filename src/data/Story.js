// src/data/Story.js
//
// Patch 142 (V2 plan E): the story layer — all narrative text, and the small pure
// rules that decide which piece of it a player sees.
//
// THE STORY. The player is Subject 0, inside a treatment environment built from one
// afternoon they can neither remember nor forget: the day, at twelve, they were called
// out of class during a storm and lockdown drill and told their father had died (a
// heart condition no one knew about). That morning they had argued with him about a
// field-trip form and slammed the door, and they have carried it as their fault ever
// since. Each floor is one defense they built around that day; each boss is that
// defense given a body:
//
//   1 SPHERE HEAD    Denial          the faceless office: "nothing happened"
//   2 RORSCHACH      Projection      every shape has someone else's face
//   3 PANOPTICON     Hypervigilance  if I watch everything, it can't happen again
//   4 AMALGAMATION   Repression      everything swallowed, all at once
//   5 ARCHITECT      Control         the Subject at twelve, who built the walls
//
// TONE (plan E6). Grief and anxiety, told as RECOVERY: the defenses are understood,
// not mocked; nobody is a monster for being unwell. No depiction of self-harm, no gore
// (PEGI-12), and the death itself is never shown — only the waiting around it. The
// clinician, Dr. Marlow, is warm and on the Subject's side.
//
// Text the PLAYER reads is all in this file (narrative) or in Strings.js (interface
// labels), so it can be edited or localised without touching code.
//
// Pure: no DOM, no state beyond the arguments. test_story.js covers the rules.

import { paletteIndexForFloor } from '../core/Endless.js';

export const CLINICIAN = 'Dr. L. Marlow';

// --- E6: the content note (first card of the cold open; also in the Clinical Guide) ---
export const CONTENT_NOTE = {
    stamp: 'CONTENT NOTE',
    title: 'Before the first session',
    text: 'FRACTURED is a story about grief and anxiety, and about getting better. ' +
          'It deals with the death of a parent (from illness, off screen). It contains no self-harm and no gore. ' +
          'If any of it is close to home, talking helps: a friend, family, a doctor, or a local helpline (findahelpline.com).'
};

// --- E1: the cold open — plays over the tutorial room; the first input dismisses it ---
export const COLD_OPEN = [
    CONTENT_NOTE,
    { stamp: 'INTAKE FORM', title: 'Subject 0',
      text: 'Age at incident: 12. Presenting complaint: one afternoon the Subject cannot remember, and cannot forget.' },
    { stamp: 'TREATMENT PLAN', title: 'The construct',
      text: 'An environment rebuilt from that afternoon: a school in a storm, the lights out, the corridors locked down. What waits inside are the Subject\'s own defenses.' },
    { stamp: 'FIRST SESSION', title: 'Stay lucid',
      text: 'Your light keeps the dark back. Find the way down. I\'ll be here when you come up. — ' + CLINICIAN }
];
export const COLD_OPEN_CARD_MS = 3600;

// --- E3: the Case File — 25 pages in five chapters, one chapter per floor ---------------
export const CHAPTERS = [
    { n: 1, title: 'THE OFFICE', defense: 'Denial', boss: 'BOSS' },
    { n: 2, title: 'THE INKBLOTS', defense: 'Projection', boss: 'RORSCHACH' },
    { n: 3, title: 'THE WATCHTOWER', defense: 'Hypervigilance', boss: 'PANOPTICON' },
    { n: 4, title: 'THE PILE', defense: 'Repression', boss: 'AMALGAMATION' },
    { n: 5, title: 'THE BLUEPRINT', defense: 'Control', boss: 'ARCHITECT' }
];

const P = (id, chapter, title, text) => ({ id, chapter, title, text });
export const CASE_PAGES = [
    // 1 — Denial
    P('p01', 1, 'Attendance Slip', 'Period 4, Science. Called to the office, 1:52 PM. Teacher\'s note in the margin: "Bring your coat." I didn\'t understand why I\'d need a coat to walk down one hallway.'),
    P('p02', 1, 'The Chair Outside the Office', 'It had a crack in the seat that pinched. I sat on it for three hours and counted the ceiling tiles. Forty-eight. Then I counted again, in case I\'d got it wrong.'),
    P('p03', 1, 'What the Principal Said', 'He doesn\'t have a face, in the memory. I know he had one. I know he was kind. I just can\'t make the words he said stay in the room.'),
    P('p04', 1, 'Lunch Box', 'Dad packed it. Peanut butter, cut corner to corner, because I\'d said squares were for babies. I didn\'t eat it. I didn\'t throw it away either.'),
    P('p05', 1, 'Clinician\'s Note — Intake', 'The Subject recalls the afternoon in fine detail up to 1:52 PM, and after that only weather. Rain. Thunder. The power going out. "Nothing happened," they say. "It was just a storm."'),
    // 2 — Projection
    P('p06', 2, 'The Nurse\'s Log', '1:40 PM — student\'s mother phoned; asked that student not be told until she arrived. 3:15 PM — mother delayed, roads closed by the storm. Student very quiet. Gave water.'),
    P('p07', 2, 'The List', 'I made a list, after. The nurse, for knowing first. Mom, for being late. The storm, for the roads. The doctors. The school. The list kept getting longer, and it never got any lighter.'),
    P('p08', 2, 'Inkblot, Card Seven', 'The counselor showed me shapes and asked what I saw. Everyone, I said. Every shape had somebody else\'s face in it. Not one of them had mine.'),
    P('p09', 2, 'Report Card, Second Term', '"A capable student who has become withdrawn and argumentative." I argued with that, too.'),
    P('p10', 2, 'Mom', 'She drove four hours through the storm because the highway was closed. I shouted at her for being late, and she let me. Years later she told me she\'d shouted at the rain the whole way.'),
    // 3 — Hypervigilance
    P('p11', 3, 'The Lockdown Drill', 'We had a lockdown drill that same week. Lights off, door locked, stay silent, wait. When the real waiting came, my body already knew exactly how to do it.'),
    P('p12', 3, 'Checking', 'After, I checked things. The stove. The front door. Whether Mom\'s car was in the drive. Whether my phone was charged, in case it rang. Whether it was ringing.'),
    P('p13', 3, 'Hall Monitor\'s Badge', 'In seventh grade I volunteered to be a hall monitor. If I watched every corridor, nothing could happen in one without me knowing.'),
    P('p14', 3, 'Sleep Diary, Age 14', 'Mon: 3 hours. Tue: 2. Wed: 4. I listen for the phone. Nobody calls at night. I listen anyway.'),
    P('p15', 3, 'Clinician\'s Note — On Watch', 'The Subject calls it "keeping watch". It began as a twelve-year-old\'s way of making sure the worst thing could never surprise them again. It has been on duty a very long time. It is tired.'),
    // 4 — Repression
    P('p16', 4, 'The Service', 'Everyone said I was so brave, because I didn\'t cry. I wasn\'t brave. I had just put it somewhere I couldn\'t reach.'),
    P('p17', 4, 'The Box in the Attic', 'Mom packed his things into one box: his reading glasses, a radio, a mug with a chip in the handle. I carried it up to the attic and didn\'t go up there again for nine years.'),
    P('p18', 4, 'The Radio', 'He listened to the same station every morning. It was on that morning. I switched it off on my way out, because I was angry. It\'s the last thing I remember the house sounding like.'),
    P('p19', 4, 'Unsent Letters', '"Dear Dad —" That\'s as far as it gets. I have eleven of these. They all stop in the same place.'),
    P('p20', 4, 'Clinician\'s Note — Pressure', 'What is pushed down does not leave. It gathers, and it presses. The Subject is not falling apart; they are holding a great deal together, all at once, with nothing to put it in.'),
    // 5 — Control
    P('p21', 5, 'Blueprints', 'I started drawing buildings at fifteen. Every room had a purpose, every door had a lock. In my drawings nothing ever happened that I hadn\'t planned.'),
    P('p22', 5, 'The Schedule', '6:00 wake. 6:10 check. 6:20 check again. If I kept to the schedule exactly, the day couldn\'t do anything to me.'),
    P('p23', 5, 'The Argument', 'That morning we argued. He\'d forgotten to sign my field-trip form. I said he never remembered anything. I said it loud, and I slammed the door. That is the part I built every wall around.'),
    P('p24', 5, 'What He Said', 'He came out after me, laughing a little, the way he did when I was being dramatic. He signed the form on the hood of the car and passed it through the window. "See you tonight, kiddo."'),
    P('p25', 5, 'Clinician\'s Note — The Whole Morning', 'Today the Subject remembered the whole morning, not only the shouting. He wasn\'t angry. A heart condition nobody knew about is not caused by a slammed door. It was never their fault. We sat with that for a long time.')
];
export const PAGE_BY_ID = Object.fromEntries(CASE_PAGES.map(p => [p.id, p]));
export const TOTAL_PAGES = CASE_PAGES.length;

// Drop rules. A floor's boss always files the next page of that floor's chapter; a
// named elite does half the time. Pages come in order within a chapter, so the
// reveals in chapter 5 arrive in the order they were written.
export const PAGE_DROP_BOSS = 1;
export const PAGE_DROP_ELITE = 0.5;
export const PAGE_MAGNET_RADIUS = 260;

/** Which chapter a floor tells (the Recursion cycles them like the palettes). */
export function chapterForFloor(floor) {
    return paletteIndexForFloor(Math.max(1, floor | 0)) + 1;
}

/** Collected page ids (a save's story.pages map), only real ones. */
export function collectedPages(meta) {
    const pages = (meta && meta.story && meta.story.pages) || {};
    return CASE_PAGES.filter(p => pages[p.id]).map(p => p.id);
}
export function pageCount(meta) { return collectedPages(meta).length; }
export function allPagesFound(meta) { return pageCount(meta) >= TOTAL_PAGES; }

/**
 * The page a drop on this floor would file: the first page of the floor's chapter not
 * yet collected and not already lying on the floor this run (`pending`). Once a chapter
 * is complete it backfills the earliest missing page of an EARLIER chapter, so a player
 * who only ever reaches floor 3 can still finish chapters 1–3. Null when there is none.
 */
export function nextPageFor(meta, floor, pending = []) {
    const have = new Set(collectedPages(meta));
    const skip = new Set(pending || []);
    const ch = chapterForFloor(floor);
    const open = (p) => !have.has(p.id) && !skip.has(p.id);
    const own = CASE_PAGES.find(p => p.chapter === ch && open(p));
    if (own) return own.id;
    const earlier = CASE_PAGES.find(p => p.chapter < ch && open(p));
    return earlier ? earlier.id : null;
}

/** Whether a kill drops a page: bosses always (if one is left), elites PAGE_DROP_ELITE. */
export function rollPageDrop(kind, rng = Math.random) {
    if (kind === 'boss') return rng() < PAGE_DROP_BOSS;
    if (kind === 'elite') return rng() < PAGE_DROP_ELITE;
    return false;
}

// --- E4: boss lines — two on the intro banner, one at the death ------------------------
// Each line is short enough (<= 38 characters) to fit a 384px-wide phone without wrapping.
export const BOSS_LINES = {
    BOSS: {
        intro: ['THERE HAS BEEN A CALL FROM HOME.', 'NOTHING HAPPENED. GO BACK TO CLASS.'],
        relapse: ['YOU AGAIN. NOTHING HAPPENED.', 'IT WAS ONLY A STORM.'],
        death: 'Something did happen. I\'m so sorry.'
    },
    RORSCHACH: {
        intro: ['WHAT DO YOU SEE?', 'SOMEONE ELSE\'S FAULT. ANYONE\'S.'],
        relapse: ['LOOK AGAIN. WHOSE FACE IS IT?', 'IT HAS TO BE SOMEBODY\'S.'],
        death: 'It was only ink. There was never a face in it.'
    },
    PANOPTICON: {
        intro: ['I SEE EVERYTHING NOW.', 'IF I HAD BEEN WATCHING...'],
        relapse: ['I NEVER STOPPED WATCHING.', 'DON\'T YOU DARE BLINK.'],
        death: 'You can close your eyes. Nothing happens when you blink.'
    },
    AMALGAMATION: {
        intro: ['EVERYTHING YOU SWALLOWED.', 'WE ARE WHAT YOU NEVER SAID.'],
        relapse: ['YOU PUT US BACK. WE GREW.', 'THERE IS ALWAYS MORE ROOM.'],
        death: 'Then say it. Someone is listening.'
    },
    ARCHITECT: {
        intro: ['I BUILT THIS SO NOTHING WOULD CHANGE.', 'IF NOTHING CHANGES, NO ONE LEAVES.'],
        relapse: ['I REBUILT IT. I ALWAYS WILL.', 'THE WALLS ARE WHAT HOLD YOU UP.'],
        death: 'I was only trying to keep you safe.'
    }
};
export const BOSS_LINE_MAX = 38;
export const BOSS_DEATH_SUBTITLE_STEPS = 330;   // 5.5 s at 60 Hz

/** Intro lines for a boss on a floor: the relapse pair in the Recursion (floor 6+). */
export function bossIntroLines(type, floor = 1) {
    const b = BOSS_LINES[type];
    if (!b) return [];
    return (floor > 5 && b.relapse) ? b.relapse : b.intro;
}
export function bossDeathLine(type) {
    const b = BOSS_LINES[type];
    return b ? b.death : '';
}

// --- E2: session notes — the clinician's note on a cleared floor, and on AWAKEN --------
export const SESSION_NOTES = {
    // keyed by chapter (floor 1-5)
    floor: {
        1: 'Session 1. The Subject reached the office door today and opened it. They insist nothing happened that afternoon. I didn\'t argue. Denial is a door held shut from the inside; it opens when the one holding it is ready.',
        2: 'Session 2. Today it was the nurse\'s fault, then the roads\', then the weather\'s. Anger has to land somewhere. I told them it can land here. This room can take it.',
        3: 'Session 3. They checked the window four times while we talked. Watching everything is exhausting — and it is also how a twelve-year-old tries to make sure the phone never rings like that again.',
        4: 'Session 4. Very quiet today. A great deal has been kept down for a long time, and it all came up at once. Next time I\'d like us to take out just one thing and look at it together.',
        5: 'Session 5. The Subject drew me the building — every wall, every lock. They built it, they said, so nothing could change. We looked at the drawing together. There is no door in it. Next week we draw one.'
    },
    // THE RECURSION (floor 6+), reframed as relapse — cycled by chapter
    relapse: {
        1: 'Relapse note. Back at the office door. This is not starting over: the Subject knows this hallway now, and knows it ends.',
        2: 'Relapse note. The blame came back today, loud. It passed faster than before. That counts.',
        3: 'Relapse note. A bad week for sleep, and the watching returned. We named it together. Naming it is half the work.',
        4: 'Relapse note. Old things surfaced. The Subject let one of them stay up long enough to say it out loud.',
        5: 'Relapse note. They rebuilt the walls, as people do under stress. This time they knew where the door was.'
    },
    // AWAKEN: the end of a session, keyed by chapter
    awaken: {
        1: 'End of session. Stopping is allowed. We\'ll start again from the office whenever you\'re ready.',
        2: 'End of session. You let some anger out today without it hurting anyone. Rest now.',
        3: 'End of session. You can stop watching for tonight. I\'ll keep the lights on.',
        4: 'End of session. You carried a lot up out of there. Put it down for a while.',
        5: 'End of session. Good work. The building will still be there; so will I.'
    }
};

// A line reacting to how the floor went, chosen by sessionReaction().
export const REACTIONS = {
    low: 'They finished on almost nothing left. I want them to notice they kept going — and that next time they are allowed to ask for help sooner.',
    fast: 'That went quickly. Sometimes speed is confidence, sometimes it\'s not wanting to stay in a room too long. Both are allowed.',
    returning: 'This isn\'t the first time they\'ve walked these halls. Coming back is the treatment working, not failing.',
    steady: 'A steady session. Nothing dramatic. Most of the work looks like this.'
};
export const REACTION_LOW_SANITY = 0.25;      // Sanity ratio at the clear
export const REACTION_FAST_STEPS = 150 * 60;  // a floor cleared inside 2.5 minutes
export const REACTION_RETURNING_DEATHS = 5;   // lifetime deaths

/** Which reaction a floor clear gets: low Sanity, a fast clear, many returns, or steady. */
export function sessionReaction({ sanityRatio = 1, floorSteps = Infinity, deaths = 0 } = {}) {
    if (Number.isFinite(sanityRatio) && sanityRatio < REACTION_LOW_SANITY) return 'low';
    if (Number.isFinite(floorSteps) && floorSteps > 0 && floorSteps < REACTION_FAST_STEPS) return 'fast';
    if ((Number(deaths) || 0) >= REACTION_RETURNING_DEATHS) return 'returning';
    return 'steady';
}

/** The full note for a cleared floor: { label, text, reaction }. */
export function sessionNoteForFloor(floor, ctx = {}) {
    const ch = chapterForFloor(floor);
    const relapse = floor > 5;
    const reaction = sessionReaction(ctx);
    return {
        label: relapse ? `RELAPSE NOTE · FLOOR ${floor}` : `SESSION NOTE · FLOOR ${floor}`,
        text: (relapse ? SESSION_NOTES.relapse[ch] : SESSION_NOTES.floor[ch]) + ' ' + REACTIONS[reaction],
        reaction
    };
}

/** The note on the AWAKEN screen. */
export function awakenNote(floor) {
    return { label: `END OF SESSION · ${CLINICIAN}`, text: SESSION_NOTES.awaken[chapterForFloor(floor)] };
}

// --- E5: endings ------------------------------------------------------------------------
// FIRST: the first time the Architect falls. TRUE: an Architect clear with every page
// filed. Each card is { stamp, text }. {pages} is filled in by endingCards().
export const ENDINGS = {
    first: [
        { stamp: 'THE ARCHITECT', text: 'It falls, and for the first time you see its face. It is yours, at twelve, holding a pencil.' },
        { stamp: 'THE ARCHITECT', text: '"I built it so nothing could change," it says. "If nothing changes, nobody leaves."' },
        { stamp: 'THE CONSTRUCT', text: 'The walls don\'t come down. But in the drawing, for the first time, there is a door.' },
        { stamp: 'SESSION REPORT', text: 'Subject has faced all five defenses. Memory of the incident remains incomplete: {pages} of 25 Case File pages recovered. Recommend continued sessions.' }
    ],
    true: [
        { stamp: 'THE WHOLE MORNING', text: 'You remember all of it now. The argument. The door. And then his voice behind you: "See you tonight, kiddo."' },
        { stamp: 'THE WHOLE MORNING', text: 'He didn\'t leave angry. He left the way he always did — a little late, laughing, the radio on.' },
        { stamp: 'THE WHOLE MORNING', text: 'It was not your fault. It never was. You were twelve, and you loved him, and you were angry about a form.' },
        { stamp: 'THE CONSTRUCT', text: 'The lights come on in every room. Not the hard white of the corridors: morning light.' },
        { stamp: 'DISCHARGE SUMMARY', text: 'Subject 0. Prognosis: good. Grief isn\'t something you finish; it\'s something you learn to carry. You are carrying it.' }
    ]
};

/** The cards for an ending, with the page count filled in. */
export function endingCards(kind, meta) {
    const cards = ENDINGS[kind] || ENDINGS.first;
    const n = pageCount(meta);
    return cards.map(c => ({ stamp: c.stamp, text: c.text.replace('{pages}', String(n)) }));
}

/**
 * Which ending (if any) an Architect clear should play: 'true' once every page is
 * filed and it has not been seen, else 'first' if no ending has been seen, else null.
 * Only floors that end a cycle (5, 10, ...) are Architect clears.
 */
export function endingForClear(meta, floor) {
    if (!(floor >= 5 && floor % 5 === 0)) return null;
    const s = (meta && meta.story) || {};
    if (allPagesFound(meta) && !s.trueEndingSeen) return 'true';
    if (!s.endingSeen) return 'first';
    return null;
}

// --- the save record --------------------------------------------------------------------
export function emptyStory() {
    return { coldOpenSeen: false, pages: {}, endingSeen: false, trueEndingSeen: false };
}

/** A story record from anything (old saves, imports): defaults filled, pages sanitised. */
export function normalizeStory(s) {
    const src = (s && typeof s === 'object') ? s : {};
    const pages = {};
    const inPages = (src.pages && typeof src.pages === 'object') ? src.pages : {};
    for (const p of CASE_PAGES) if (inPages[p.id]) pages[p.id] = Number(inPages[p.id]) || 1;
    return {
        coldOpenSeen: !!src.coldOpenSeen,
        pages,
        endingSeen: !!src.endingSeen,
        trueEndingSeen: !!src.trueEndingSeen
    };
}
