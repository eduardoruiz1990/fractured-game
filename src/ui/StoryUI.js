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
// Patch 179: chapter illustrations for the Case File (inline SVG, one accent each).
const ART_OPEN = (accent) => `<svg viewBox="0 0 320 112" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice"><rect width="320" height="112" fill="#15121d"/><rect width="320" height="112" fill="${accent}" opacity="0.08"/>`;
const CHAPTER_ART = {
    // 1 THE OFFICE: the chair outside the door, the clock stopped at 1:52, rain
    1: ART_OPEN('#ffcf8a') + `<g stroke="#f2d27a" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="M0 92 H320"/><rect x="196" y="18" width="56" height="74" fill="#231d2e"/><rect x="206" y="28" width="36" height="30" fill="#ffcf8a" opacity="0.35"/><circle cx="244" cy="62" r="2.5" fill="#f2d27a"/>
        <circle cx="120" cy="30" r="15" fill="#231d2e"/><path d="M120 30 V20 M120 30 L129 35"/>
        <path d="M60 92 V62 H84 V92 M60 62 V40 H66 V62 M58 76 H86"/></g>
        <g stroke="#bcd6ff" stroke-width="1.2" opacity="0.5"><path d="M20 10 l-5 14 M38 22 l-5 14 M290 12 l-5 14 M304 40 l-5 14 M272 34 l-5 14 M150 60 l-4 12"/></g></svg>`,
    // 2 THE INKBLOTS: three cards, each blot a mirrored face
    2: ART_OPEN('#bcd6ff') + `<g stroke="#f2d27a" stroke-width="2" stroke-linejoin="round">
        <g transform="translate(70 56) rotate(-9)"><rect x="-30" y="-40" width="60" height="80" rx="4" fill="#efe6d6"/><path d="M0 -24 C-26 -30 -24 6 -6 4 C-22 20 -4 30 0 16 C4 30 22 20 6 4 C24 6 26 -30 0 -24Z" fill="#12101a" stroke="none"/></g>
        <g transform="translate(160 54)"><rect x="-30" y="-40" width="60" height="80" rx="4" fill="#efe6d6"/><path d="M0 -28 C-20 -20 -28 0 -12 10 C-20 26 -6 30 0 18 C6 30 20 26 12 10 C28 0 20 -20 0 -28Z" fill="#12101a" stroke="none"/><circle cx="-8" cy="-6" r="3" fill="#efe6d6" stroke="none"/><circle cx="8" cy="-6" r="3" fill="#efe6d6" stroke="none"/></g>
        <g transform="translate(250 58) rotate(8)"><rect x="-30" y="-40" width="60" height="80" rx="4" fill="#efe6d6"/><path d="M0 -20 C-30 -34 -30 20 -4 8 C-10 30 10 30 4 8 C30 20 30 -34 0 -20Z" fill="#12101a" stroke="none"/></g></g></svg>`,
    // 3 THE WATCHTOWER: one eye over a row of lit windows
    3: ART_OPEN('#ff7a86') + `<g stroke="#f2d27a" stroke-width="2" fill="none" stroke-linejoin="round">
        <path d="M150 112 L156 54 H164 L170 112Z" fill="#231d2e"/>
        <path d="M112 40 Q160 4 208 40 Q160 76 112 40Z" fill="#efe6d6"/><circle cx="160" cy="40" r="15" fill="#ff5a6a"/><circle cx="160" cy="40" r="6" fill="#12101a" stroke="none"/>
        <path d="M160 54 L40 112 M160 54 L280 112" stroke="#ff7a86" opacity="0.5"/></g>
        <g fill="#ffcf8a" opacity="0.8">${[20,52,84,224,256,288].map(x => `<rect x="${x}" y="84" width="14" height="18"/>`).join('')}</g></svg>`,
    // 4 THE PILE: everything put away, heaped, one small hand reaching out
    4: ART_OPEN('#b6ff5a') + `<g stroke="#f2d27a" stroke-width="2" stroke-linejoin="round" fill="#231d2e">
        <rect x="96" y="70" width="52" height="34"/><rect x="150" y="62" width="60" height="42"/><rect x="118" y="38" width="46" height="32" transform="rotate(-8 141 54)"/>
        <rect x="170" y="30" width="38" height="32" transform="rotate(10 189 46)"/><rect x="212" y="78" width="40" height="26"/><rect x="60" y="84" width="34" height="20"/>
        <path d="M110 80 h24 M160 74 h40 M128 50 h26" fill="none"/></g>
        <path d="M232 60 q10 -18 22 -22 M254 38 l5 -7 M254 38 l8 -3 M254 38 l7 3" stroke="#b6ff5a" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>`,
    // 5 THE BLUEPRINT: a house in plan, one room left undrawn
    5: ART_OPEN('#ffd24a') + `<g stroke="#ffd24a" stroke-width="1.6" fill="none">
        ${Array.from({ length: 9 }, (_, i) => `<path d="M${i * 40} 0 V112" opacity="0.14"/>`).join('')}${Array.from({ length: 4 }, (_, i) => `<path d="M0 ${i * 32 + 8} H320" opacity="0.14"/>`).join('')}
        <path d="M70 22 H250 V96 H70Z M70 58 H150 M150 22 V96 M150 58 H200" stroke-width="2.2"/>
        <path d="M200 58 H250 V96 H200Z" stroke-dasharray="5 5" opacity="0.9"/><path d="M216 70 l18 14 M234 70 l-18 14" opacity="0.7"/>
        <path d="M96 22 a14 14 0 0 1 14 14" /><path d="M150 76 a12 12 0 0 0 -12 12"/></g></svg>`
};

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
        // Patch 179: each chapter opens on an illustration of its place. It is drawn in
        // full once the chapter's boss has been faced; before that it is a dark outline.
        const art = el('div', `casefile-art${faced ? '' : ' casefile-art--locked'}`);
        art.setAttribute('aria-hidden', 'true');
        art.innerHTML = CHAPTER_ART[ch.n] || '';
        sec.appendChild(art);
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
