// src/data/Strings.js
//
// Patch 142 (V2 plan E): interface text for the story layer — labels, buttons, hints
// and the credits. Narrative lives in Story.js; this file is the words around it.
// Kept apart so a later localisation pass can swap one table without touching code.
//
// CREDITS are deliberately generic. Edit the CREDITS lines to put real names in.

export const STRINGS = {
    coldOpenSkip: 'TAP OR PRESS ANY KEY TO BEGIN',
    caseFileTab: 'CASE FILE',
    caseFileTitle: 'CASE FILE · SUBJECT 0',
    caseFileIntro: 'Pages of the Subject\'s file turn up in the construct: every boss files one, and named elites often drop one. Each floor holds its own chapter.',
    caseFileLocked: 'Not yet recovered.',
    caseFileChapterLocked: 'This chapter\'s defense has not been faced yet.',
    pageStamp: 'CASE FILE',
    pageFiled: (n, total) => `PAGE FILED · ${n} / ${total}`,
    pageTapHint: 'tap to read',
    pageWorldLabel: 'PAGE',
    sessionNoteLabel: 'SESSION NOTE',
    endingContinue: 'CONTINUE',
    endingSkip: 'SKIP',
    endingAwaken: 'AWAKEN',
    endingAwakenDesc: 'Leave the construct and wake up. This is a good place to stop.',
    endingRecurse: 'RECURSE',
    endingRecurseDesc: 'Go back down. Relapse is not failure; some rooms need visiting more than once.',
    endingClose: 'CLOSE FILE',
    replayFirst: 'REPLAY: THE DOOR IN THE DRAWING',
    replayTrue: 'REPLAY: THE WHOLE MORNING',
    contentNoteHeading: 'CONTENT NOTE',
    trueEndingHint: (n, total) => `${n} / ${total} pages. Every page filed unlocks the full memory at the Architect.`
};

export const CREDITS = [
    { h: 'FRACTURED: SURVIVORS', t: 'A game about grief, and about getting better.' },
    { h: 'MADE BY', t: 'The FRACTURED team' },
    { h: 'BUILT WITH', t: 'HTML5 Canvas, the Web Audio API and Vite. Every sprite is drawn in code.' },
    { h: 'TITLE LETTERING', t: 'Special Elite by Astigmatic, used under the Apache License 2.0.' },   // Patch 162 (licence ships in licenses/)
    { h: 'THANK YOU', t: 'For playing, and for staying with it.' },
    { h: '', t: 'If any of this was close to home: talking helps. findahelpline.com' }
];
