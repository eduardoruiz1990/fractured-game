// src/ui/StoryUI.js
//
// Patches 143–147 (V2 plan E): the DOM side of the story layer. Everything is built
// here at runtime (no index.html blocks), styled by the `.story-*` rules at the end of
// style.css, and fed by the pure data in data/Story.js and data/Strings.js.
//
//   showColdOpen()   E1 — cards over the tutorial room. It NEVER blocks: the overlay
//                    takes no pointer input, the game keeps running under it, and the
//                    first key, click or touch dismisses it (the input still reaches
//                    the game). Otherwise it advances itself and fades out.
//   playEnding()     E5 — the ending: cards (tap / Enter to continue, SKIP to jump),
//                    the credits, then AWAKEN or RECURSE (or CLOSE FILE on a replay).
//   renderCaseFile() E3 — the RECORDS → CASE FILE pane.
//   installContentNote() E6 — the content note at the top of the Clinical Guide.
//
// All text is inserted as text (textContent), never as HTML.

import { STRINGS, CREDITS } from '../data/Strings.js';
import { CONTENT_NOTE, COLD_OPEN, COLD_OPEN_CARD_MS, CHAPTERS, CASE_PAGES, TOTAL_PAGES, collectedPages, endingCards } from '../data/Story.js';

const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
};

// --- E1: the cold open --------------------------------------------------------------------
let coldOpen = null;

/** Shows the cold-open cards. Returns a handle with dismiss(). Calls onDone once. */
export function showColdOpen({ cards = COLD_OPEN, cardMs = COLD_OPEN_CARD_MS, armMs = 400, onDone } = {}) {
    if (typeof document === 'undefined') return null;
    dismissColdOpen(true);
    const root = el('div', 'story-coldopen');
    root.id = 'story-coldopen';
    root.setAttribute('aria-live', 'polite');
    const card = el('div', 'story-card');
    const stamp = el('div', 'story-stamp');
    const title = el('div', 'story-title');
    const text = el('p', 'story-text');
    const dots = el('div', 'story-dots');
    card.append(stamp, title, text, dots);
    const hint = el('div', 'story-hint', STRINGS.coldOpenSkip);
    root.append(card, hint);
    document.body.appendChild(root);

    const state = { i: -1, timer: null, done: false, root, armedAt: performance.now() + armMs };
    const show = (i) => {
        state.i = i;
        const c = cards[i];
        stamp.textContent = c.stamp || '';
        title.textContent = c.title || '';
        text.textContent = c.text || '';
        dots.textContent = cards.map((_, k) => (k === i ? '●' : '○')).join(' ');
        card.classList.remove('story-in');
        void card.offsetWidth;   // restart the fade
        card.classList.add('story-in');
        root.dataset.card = String(i);
        clearTimeout(state.timer);
        state.timer = setTimeout(() => (i + 1 < cards.length ? show(i + 1) : finish()), cardMs);
    };
    const finish = (immediate = false) => {
        if (state.done) return;
        state.done = true;
        clearTimeout(state.timer);
        window.removeEventListener('keydown', onInput, true);
        window.removeEventListener('pointerdown', onInput, true);
        window.removeEventListener('touchstart', onInput, true);
        root.classList.add('story-out');
        setTimeout(() => root.remove(), immediate ? 0 : 450);
        if (coldOpen === state) coldOpen = null;
        if (typeof onDone === 'function') { try { onDone(); } catch (e) { console.error(e); } }
    };
    // The input is NOT consumed: the key or touch that dismisses the cards is also the
    // player's first move.
    const onInput = (e) => {
        if (e && e.type === 'keydown' && e.repeat) return;
        if (performance.now() < state.armedAt) return;
        finish();
    };
    window.addEventListener('keydown', onInput, true);
    window.addEventListener('pointerdown', onInput, true);
    window.addEventListener('touchstart', onInput, { capture: true, passive: true });
    state.dismiss = finish;
    coldOpen = state;
    show(0);
    return state;
}

export function dismissColdOpen(immediate = false) {
    if (coldOpen && coldOpen.dismiss) coldOpen.dismiss(immediate);
}

export function coldOpenShowing() { return !!coldOpen; }

// --- E6: the content note in the Clinical Guide ---------------------------------------------
export function installContentNote() {
    if (typeof document === 'undefined') return;
    const guide = document.getElementById('tab-guide');
    if (!guide || document.getElementById('guide-content-note')) return;
    const box = el('div', 'story-guide-note');
    box.id = 'guide-content-note';
    box.append(el('strong', '', STRINGS.contentNoteHeading), el('p', '', CONTENT_NOTE.text));
    guide.insertBefore(box, guide.firstChild);
}

// --- E5: the ending sequence -------------------------------------------------------------------
let ending = null;

/**
 * Plays an ending. kind: 'first' | 'true'. meta: the save (for the page count).
 * choice: true offers AWAKEN / RECURSE at the end (onAwaken / onRecurse); false (a
 * replay) offers CLOSE FILE (onClose).
 */
export function playEnding(kind, meta, { choice = true, onAwaken, onRecurse, onClose } = {}) {
    if (typeof document === 'undefined') return null;
    closeEnding();
    const cards = endingCards(kind, meta);
    const root = el('div', `story-ending story-ending-${kind}`);
    root.id = 'story-ending';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    const panel = el('div', 'story-ending-panel medical-folder');
    const stamp = el('div', 'story-stamp');
    const text = el('p', 'story-ending-text');
    const body = el('div', 'story-ending-body');
    body.append(stamp, text);
    const actions = el('div', 'story-ending-actions');
    const btnNext = el('button', 'file-btn primary story-btn', STRINGS.endingContinue);
    const btnSkip = el('button', 'file-btn story-btn story-btn-quiet', STRINGS.endingSkip);
    btnNext.type = btnSkip.type = 'button';
    actions.append(btnSkip, btnNext);
    panel.append(body, actions);
    root.appendChild(panel);
    document.body.appendChild(root);

    const st = { kind, step: 'cards', i: 0, root };
    const renderCard = () => {
        const c = cards[st.i];
        stamp.textContent = c.stamp;
        text.textContent = c.text;
        root.dataset.step = `card-${st.i}`;
        text.classList.remove('story-in'); void text.offsetWidth; text.classList.add('story-in');
    };
    const renderCredits = () => {
        st.step = 'credits';
        root.dataset.step = 'credits';
        body.textContent = '';
        const list = el('div', 'story-credits');
        CREDITS.forEach(c => {
            const row = el('div', 'story-credit');
            if (c.h) row.appendChild(el('div', 'story-credit-h', c.h));
            row.appendChild(el('div', 'story-credit-t', c.t));
            list.appendChild(row);
        });
        body.appendChild(list);
        btnSkip.style.display = 'none';
        btnNext.textContent = STRINGS.endingContinue;
    };
    const renderChoice = () => {
        st.step = 'choice';
        root.dataset.step = 'choice';
        body.textContent = '';
        actions.textContent = '';
        if (choice) {
            const mk = (label, desc, cls, fn) => {
                const wrap = el('div', 'story-choice');
                const b = el('button', `file-btn story-btn ${cls}`, label);
                b.type = 'button';
                b.addEventListener('click', () => { closeEnding(); if (typeof fn === 'function') fn(); });
                wrap.append(b, el('p', 'story-choice-desc', desc));
                return wrap;
            };
            body.append(
                mk(STRINGS.endingAwaken, STRINGS.endingAwakenDesc, 'story-btn-awaken', onAwaken),
                mk(STRINGS.endingRecurse, STRINGS.endingRecurseDesc, 'story-btn-recurse', onRecurse)
            );
            const first = body.querySelector('button');
            if (first) first.focus();
        } else {
            const b = el('button', 'file-btn story-btn', STRINGS.endingClose);
            b.type = 'button';
            b.addEventListener('click', () => { closeEnding(); if (typeof onClose === 'function') onClose(); });
            actions.appendChild(b);
            b.focus();
        }
    };
    const advance = () => {
        if (st.step === 'cards') {
            if (st.i + 1 < cards.length) { st.i++; renderCard(); } else renderCredits();
        } else if (st.step === 'credits') renderChoice();
    };
    btnNext.addEventListener('click', advance);
    btnSkip.addEventListener('click', () => { if (st.step === 'cards') renderCredits(); });
    // Keys stay inside the dialog: Enter/Space continue, Escape skips. Nothing reaches
    // the pause handler or the game while it is open.
    st.onKey = (e) => {
        if (!document.getElementById('story-ending')) return;
        const k = e.key;
        if (st.step !== 'choice' && (k === 'Enter' || k === ' ' || k === 'ArrowRight')) { e.preventDefault(); advance(); }
        else if (st.step === 'cards' && k === 'Escape') { e.preventDefault(); renderCredits(); }
        else if (k === 'Escape') e.preventDefault();
        e.stopPropagation();
    };
    window.addEventListener('keydown', st.onKey, true);
    ending = st;
    renderCard();
    btnNext.focus();
    return st;
}

export function closeEnding() {
    if (!ending) return;
    window.removeEventListener('keydown', ending.onKey, true);
    if (ending.root) ending.root.remove();
    ending = null;
}

export function endingShowing() { return !!ending; }

// --- E3: the Case File pane ---------------------------------------------------------------------
/**
 * Renders the Case File into `container`. opts.onReplay(kind) — shown for endings seen.
 * Each collected page is a <details> (tap to read); missing ones are blank slips.
 */
export function renderCaseFile(container, meta, { onReplay } = {}) {
    if (!container) return;
    container.textContent = '';
    const have = new Set(collectedPages(meta));
    const story = (meta && meta.story) || {};
    const kills = (meta && meta.killCounts) || {};

    const head = el('div', 'casefile-head');
    head.append(el('h2', 'casefile-title', STRINGS.caseFileTitle),
        el('p', 'casefile-intro', STRINGS.caseFileIntro),
        el('p', 'casefile-count', STRINGS.trueEndingHint(have.size, TOTAL_PAGES)));
    container.appendChild(head);

    if (typeof onReplay === 'function' && (story.endingSeen || story.trueEndingSeen)) {
        const row = el('div', 'casefile-replays');
        const mk = (label, kind) => {
            const b = el('button', 'file-btn casefile-replay', label);
            b.type = 'button';
            b.dataset.ending = kind;
            b.addEventListener('click', () => onReplay(kind));
            row.appendChild(b);
        };
        if (story.endingSeen) mk(STRINGS.replayFirst, 'first');
        if (story.trueEndingSeen) mk(STRINGS.replayTrue, 'true');
        container.appendChild(row);
    }

    CHAPTERS.forEach(ch => {
        const pages = CASE_PAGES.filter(p => p.chapter === ch.n);
        const got = pages.filter(p => have.has(p.id)).length;
        const faced = (Number(kills[ch.boss]) || 0) > 0 || got > 0;
        const sec = el('section', 'casefile-chapter');
        sec.dataset.chapter = String(ch.n);
        sec.appendChild(el('h3', 'casefile-chapter-h', `${ch.n}. ${ch.title} — ${faced ? ch.defense.toUpperCase() : '???'} · ${got} / ${pages.length}`));
        if (!faced) sec.appendChild(el('p', 'casefile-locked', STRINGS.caseFileChapterLocked));
        pages.forEach(p => {
            if (have.has(p.id)) {
                const d = el('details', 'casefile-page');
                d.dataset.page = p.id;
                d.append(el('summary', 'casefile-page-title', p.title), el('p', 'casefile-page-text', p.text));
                sec.appendChild(d);
            } else {
                const s = el('div', 'casefile-page casefile-missing', STRINGS.caseFileLocked);
                s.dataset.page = p.id;
                sec.appendChild(s);
            }
        });
        container.appendChild(sec);
    });
}
