import './style.css';
import { SaveManager } from './core/SaveManager.js';
import { UIManager } from './ui/UIManager.js';
import { InputManager } from './core/Input.js';
import { Renderer } from './core/Renderer.js';
import { AudioEngine } from './core/AudioEngine.js';
import { Game } from './core/Game.js';
import { LevelUpUI } from './ui/LevelUpUI.js';
import { TOKENS, TOKEN_RARITIES, SYNERGIES, getActiveSynergies } from './data/Manifestations.js';
import { portalSDK } from './systems/PortalSDK.js';
import { showConfirm } from './ui/Dialog.js';
import { errorLog } from './core/ErrorLog.js';
import { Tutorial } from './systems/Tutorial.js';
import { isPortraitLayout } from './core/Layout.js';
import { Pacing } from './core/Pacing.js';
// Patch 93/97 — THE RECURSION: the endless floors past the Architect, and the mode
// that launches straight into them. See src/core/Endless.js.
import {
    ENDLESS_START_FLOOR, endlessDraftXP, isRecursionUnlocked,
    cycleLabel, isEndless
} from './core/Endless.js';
import { getXPRequiredForLevel, BOSS_TYPE_SET } from './data/Config.js';

// Patch 50: installed before ANYTHING else in this module runs, including the
// canvas lookup below. A throw during boot is invisible to the log unless the
// handlers are already attached, and boot-path throws are precisely what the
// platform's load-time crash rate is made of. errorLog never throws and does no
// per-frame work — see the module header for the rules it holds itself to.
errorLog.install();
window.FRACTURED_ERRORS = errorLog;

console.log("FRACTURED Engine Bootstrapping...");

const canvas = document.getElementById('gameCanvas');
// Patch 51b: getContext CAN return null — under memory pressure, or when a device
// already has too many live contexts. `new Renderer(canvas, ctx)` then throws on
// its very first line (createPattern), which takes the whole boot down and leaves
// the player on a dead title screen with no explanation. Checked at the bootstrap
// below instead, so the failure is reported rather than silent.
const ctx = canvas ? canvas.getContext('2d') : null;

// Declared ABOVE the resize() call below, not after it. These are `let` bindings,
// so they sit in the temporal dead zone until this line is evaluated — and merely
// READING one while it's in the TDZ throws a ReferenceError rather than yielding
// undefined. That made the `if (renderer)` guard inside resize() throw on the
// initial resize() call, which killed the rest of this module at load and meant
// initEngine() never ran at all.
let saveManager, inputManager, renderer, audioEngine, game, levelUpUI, uiManager;
let gameState = 'TITLE';

// Patch 50: registered HERE, immediately after the `let`s above, and deliberately
// not next to errorLog.install(). The provider closes over `game`/`gameState`, and
// per the TDZ note above, reading either before this line throws a ReferenceError
// rather than yielding undefined — so a provider registered earlier would fail on
// exactly the boot-path errors it exists to annotate. It is only ever CALLED at
// capture time (i.e. after something already threw), never per frame.
errorLog.setContext(() => ({
    gameState,
    floor: (game && game.state) ? game.state.floor : undefined,
    room: (game && game.state) ? game.state.roomNumber : undefined
}));

// Patch 71 — portrait layout gate.
//
// Read once at load rather than per call: this is a device property, and matchMedia
// is wrapped because it is absent under the test scripts' mocks. inputManager's own
// live isTouchDevice is folded in when it exists, so a device that only reveals
// itself by touching still gets the layout.
let coarsePointerHint = false;
try {
    coarsePointerHint =
        (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) ||
        (navigator.maxTouchPoints || 0) > 0;
} catch (e) { coarsePointerHint = false; }

/**
 * Reads the live viewport into the pure predicate in core/Layout.js, which is where
 * the desktop/portrait rule itself lives (and where it is tested).
 */
function shouldUsePortraitLayout() {
    return isPortraitLayout({
        touch: coarsePointerHint || !!(inputManager && inputManager.isTouchDevice),
        width: window.innerWidth,
        height: window.innerHeight
    });
}

/** Sizes the DOM control band to whatever the renderer reserved (0 = hidden). */
function applyControlBand() {
    const band = document.getElementById('control-band');
    if (!band) return;
    const bandH = (renderer && Number.isFinite(renderer.controlBandH)) ? renderer.controlBandH : 0;
    if (bandH > 0) {
        band.style.height = `${bandH}px`;
        band.style.display = 'block';
    } else {
        band.style.display = 'none';
    }
}

function resize() {
    if (!canvas) return;
    // Patch 51d: clamped to >= 1. A canvas sized 0 in either axis — which happens
    // when the portal's iframe is laid out at zero (hidden tab, mid-orientation
    // change, some in-app webviews) — makes every drawImage(lightCanvas) throw
    // InvalidStateError, once per frame, freezing the screen while the game keeps
    // running. updateZoom() already guards the same zero case explicitly, so it is
    // known to occur; the render path simply never got the same treatment.
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);

    // Patch 69: bail when nothing actually changed. Mobile fires `resize` for things
    // that do not alter innerWidth/innerHeight at all (visualViewport shifts, the
    // keyboard, some in-app webview chrome), and ASSIGNING canvas.width reallocates
    // the backing store and resets the 2D context even when the value is identical —
    // then drawLightingMasks reallocates the light canvas to match on the next frame.
    // Two full-screen buffer allocations per spurious event, mid-run, on the devices
    // least able to absorb them.
    if (canvas.width === w && canvas.height === h) return;

    canvas.width = w;
    canvas.height = h;

    // Patch 79: pin the container to the SAME height the canvas just took. It is
    // `100dvh` in CSS, but dvh is not honoured everywhere the game runs, and every
    // bottom-anchored control (the dash button, and the joysticks' offset parent) is
    // positioned against this box — if it is taller than the visible viewport those
    // controls sit below the screen edge. Measured, not assumed.
    const container = document.getElementById('game-container');
    if (container) container.style.height = `${h}px`;
    // Refit the camera: on small viewports a fixed zoom showed far too little world.
    // Guarded because resize() also runs once before the Renderer exists.
    if (renderer) {
        // Set BEFORE updateZoom — it reads this to decide whether to reserve a band.
        renderer.portraitMode = shouldUsePortraitLayout();
        renderer.updateZoom();
        applyControlBand();
    }
    // Patch 92: the retention bar's height changes with the viewport (it collapses to
    // a single row under 560px tall), and the title column reserves that height. Both
    // must be recomputed together or the bar starts overlapping the buttons again.
    // Placed after the no-change early-return above deliberately: if the viewport did
    // not move, neither did the bar. Hoisted, so calling it before its definition and
    // before saveManager exists is fine — it null-guards.
    applyStorageNoticeLayout();
}

// Coalesced to one resize per animation frame. A phone hiding or showing its URL bar
// emits a burst of events across a single frame; without this each one paid the full
// reallocation above. rAF rather than a timeout deliberately — the canvas element has
// no CSS size of its own, so it is exactly as large as its backing store, and any
// delay longer than a frame would show as the game visibly not filling the window.
let resizePending = false;
function scheduleResize() {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
        resizePending = false;
        resize();
    });
}
window.addEventListener('resize', scheduleResize);
window.addEventListener('orientationchange', scheduleResize);
resize();

// --- PORTAL SDK (Patch 44) ---
// Start probing as early as possible. init() never rejects, is memoized, and every
// portal method stays a no-op unless it resolves to a live portal. Patch 47 makes
// the bootstrap at the bottom of this file WAIT on this same promise, because
// SaveManager reads the save in its constructor and the portal's cloud-save backend
// is only readable once the SDK has initialized.
portalSDK.init();

// Which gameStates count as "gameplay" for the portal's gameplayStart/Stop events.
//
// DECISION (Patch 44): only an actual run counts. The Mind Palace HUB is canvas-
// rendered and walkable, but it is where the player shops, equips tokens and buys
// tree nodes — menu behaviour — so it is deliberately EXCLUDED, matching the SDK
// docs' guidance that menus are a gameplay break.
//
// AMENDED (Patch 82): LEVEL_UP now counts. The Patch 44 exclusion was aimed at
// MENUS — out-of-run management the player enters on purpose and could stay in
// indefinitely. A level-up card is the opposite: an in-run decision, forced by the
// run itself, that the player cannot reach any other way and leaves in one click.
//
// This is not a neutral reclassification, which is why it ships alone. Patch 65
// deliberately made the tutorial kill drop 75 XP so that EVERY new player reaches a
// level-up card inside their first minute — so the card reliably lands inside the
// platform's 60-second conversion window, and every second spent reading it was
// being reported as not-playing. The cards render at clamp(94px, 28vw, 152px), so a
// 390px phone spends longer on that screen than a desktop does, which means the
// exclusion was subtracting more from mobile than from desktop from the one screen
// the game guarantees both of them see. Some part of the measured desktop/mobile
// conversion gap was an artefact of this line.
//
// PAUSED, DEAD, EXIT_REACHED and HUB stay excluded. The honest edge case: a player
// who walks away with the card open is now counted as playing, where a player who
// walks away on the pause menu is not. That asymmetry is accepted — PAUSED is the
// player declaring they have stopped; a level-up card is a run in progress.
const PORTAL_GAMEPLAY_STATES = new Set(['PLAYING', 'LEVEL_UP']);
let portalLastGameplay = false;

/**
 * Emits portal gameplayStart/gameplayStop by observing `gameState` once per frame.
 * Done here rather than at the ~15 `gameState = ...` assignment sites so the state
 * machine itself is untouched and no transition can be missed or drift out of sync.
 */
function syncPortalGameplayState() {
    const isGameplay = PORTAL_GAMEPLAY_STATES.has(gameState);
    if (isGameplay === portalLastGameplay) return;
    portalLastGameplay = isGameplay;
    if (isGameplay) portalSDK.gameplayStart();
    else portalSDK.gameplayStop();
}

// Patch 119 (V2 plan B11): keeps the portal's feedback-report context current (see
// PortalSDK.setGameContext). Observed once per frame like the gameplay events above,
// but the comparison is on primitives and the payload is only built when one of
// them moved — screen, floor, room, quality tier or the error count — which is a
// handful of times per run, never per frame. Weapons are read at those moments, and
// a level-up always passes through LEVEL_UP and back, so they stay current too.
// Nothing identifying is sent: the coarse device class, never the user agent.
const portalCtx = { state: '', floor: -1, room: -1, tier: '', errors: -1 };
function syncPortalContext() {
    if (!portalSDK.available) return;
    const st = (game && game.state) || null;
    const floor = st ? (st.floor | 0) : 0;
    const room = st ? (st.roomNumber | 0) : 0;
    const tier = currentQualityTier();
    const errCount = errorLog.entries.length;   // the live array: no per-frame copy
    if (portalCtx.state === gameState && portalCtx.floor === floor && portalCtx.room === room &&
        portalCtx.tier === tier && portalCtx.errors === errCount) return;
    portalCtx.state = gameState; portalCtx.floor = floor; portalCtx.room = room;
    portalCtx.tier = tier; portalCtx.errors = errCount;
    const errs = errorLog.getEntries();

    const ctx = { screen: gameState, quality: tier, errors: errs.length };
    if (st && gameState !== 'TITLE' && gameState !== 'MENU') {
        ctx.floor = floor;
        ctx.room = room;
        const w = (st.player && st.player.weapons) || {};
        ctx.weapons = Object.keys(w).filter(k => w[k] && w[k].level > 0).map(k => k + w[k].level).join(',');
        if (st.player && Number.isFinite(st.player.maxHp) && st.player.maxHp > 0 && Number.isFinite(st.sanity)) {
            ctx.sanityPct = Math.round(100 * st.sanity / st.player.maxHp);
        }
    }
    const last = errs[errs.length - 1];
    if (last) ctx.lastError = `${last.src}: ${last.msg}${last.n > 1 ? ' (x' + last.n + ')' : ''}`;
    try {
        ctx.device = (coarsePointerHint || (inputManager && inputManager.isTouchDevice)) ? 'touch' : 'pointer';
    } catch (e) { /* inputManager not built yet */ }
    portalSDK.setGameContext(ctx);
}

/**
 * Shows a midgame ad (when a portal offers one) and then runs `next` (Patch 47b).
 *
 * With no portal, `showMidgameAd` completes synchronously, so this degrades to a
 * direct call of `next()` — identical to the pre-patch behaviour.
 *
 * Audio is muted for the ad's full duration and restored afterwards, which
 * CrazyGames requires. The gameplay events from Patch 44 bracket the ad: gameplay
 * is reported stopped BEFORE it plays, or ad time is counted as play time in the
 * platform's metrics. The stop is routed through `portalLastGameplay` rather than
 * calling `portalSDK.gameplayStop()` alone, so the frame observer stays
 * authoritative — otherwise it would still believe gameplay was running and would
 * never re-emit `gameplayStart`.
 */
// Patch 104 (V2 plan A3, decided 2026-11-15): at most ONE midgame ad per 5 minutes,
// stricter than the SDK's own 3-minute floor. The clock starts at page load, so a new
// player's first five minutes are ad-free — the window the conversion metric judges.
// Any ad (midgame or rewarded) resets it, so a player who just chose to watch a
// rewarded ad is never handed a midgame one straight after.
const MIDGAME_MIN_INTERVAL_MS = 5 * 60 * 1000;
let lastAdAt = (typeof performance !== 'undefined') ? performance.now() : 0;
function noteAdShown() { lastAdAt = performance.now(); }

function showAdThen(next, { allowAd = true } = {}) {
    // Inside the cooldown (or the caller ruled an ad out): behave exactly like the
    // no-portal path — run the transition now, then let gameplay events re-sync.
    if (!allowAd || performance.now() - lastAdAt < MIDGAME_MIN_INTERVAL_MS) {
        try { next(); } catch (e) { console.error("Post-ad transition failed: " + e.message); }
        syncPortalGameplayState();
        return;
    }

    if (portalLastGameplay) {
        portalLastGameplay = false;
        portalSDK.gameplayStop();
    }

    portalSDK.showMidgameAd({
        onStart: () => { noteAdShown(); if (audioEngine) audioEngine.setMuted('ad', true); },
        onComplete: () => {
            if (audioEngine) audioEngine.setMuted('ad', false);
            try {
                next();
            } catch (e) {
                console.error("Post-ad transition failed: " + e.message);
            }
            // Re-emit gameplayStart immediately if we landed back in gameplay,
            // rather than waiting up to a frame for the loop's own observer.
            syncPortalGameplayState();
        }
    });
}

// --- HUD WRITES ONLY ON CHANGE (Patch 117, V2 plan B9) ------------------------------
//
// The HUD block in gameLoop rewrote ~25 inline styles, several innerTexts and #score's
// innerHTML every frame, each an invalidation the browser then had to process, and
// the tutorial banner READ innerText per frame (a forced layout). These compare
// against the element's LIVE value, not a private cache, so a write made elsewhere
// (onDeath zeroing the glitch overlay, the pause menu) is never masked. Inline style
// and textContent reads do not force layout. A value the browser normalises on read
// (a hex colour read back as rgb()) simply writes as before — never worse than it was.
function hudStyle(el, prop, value) {
    if (!el) return;
    const v = String(value);
    if (el.style[prop] !== v) el.style[prop] = v;
}
function hudText(el, value) {
    if (!el) return;
    const v = String(value);
    if (el.textContent !== v) el.textContent = v;
}
let lastScoreHtml = null;
function hudHtml(el, html) {
    if (!el || html === lastScoreHtml) return;   // #score is written only from here
    lastScoreHtml = html;
    el.innerHTML = html;
}
function hudPct(ratio) {
    const r = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
    return (Math.round(r * 1000) / 10) + '%';
}

// --- REWARDED ADS ON THE DEATH SCREEN (Patch 104, V2 plan A3) ---------------------
//
// CrazyGames rules this is built to: reward only on adFinished; never a rewarded
// button on an active gameplay screen (so only here, on DEAD); no chaining (ONE
// rewarded ad per death — a success hides both offers); and never a midgame ad plus
// a "watch to keep playing" offer between the same two levels (a revived run gets no
// end-of-run midgame — see btn-restart). Off-portal and under Basic Launch
// (adsDisabled) canOfferRewarded() is false and the whole block stays hidden.
//
// Revive undoes the death SETTLEMENT, not just the screen: onDeath has already banked
// 50% of the run's Lucidity, so that payout is taken back (removeLucidity) and the run
// banks normally at its real end. Tokens already decrypted stay decrypted and
// runInventory stays empty, so nothing is granted twice. The 'deaths' stat stands —
// the player did break.

/** Run-scoped death bookkeeping, written by onDeath for the reward handlers. */
let deathSettlement = null;   // { recovered, lost, floor }

function setDeathRewardNote(text) {
    const note = document.getElementById('death-rewarded-note');
    if (note) note.innerText = text || '';
}

function setupDeathRewards() {
    const box = document.getElementById('death-rewarded');
    const reviveBtn = document.getElementById('btn-revive');
    const recoverBtn = document.getElementById('btn-recover-lucidity');
    if (!box || !reviveBtn || !recoverBtn) return;

    const canRevive = !(game.state && game.state.reviveUsed);
    const lost = deathSettlement ? deathSettlement.lost : 0;
    const canRecover = lost > 0;

    if (!portalSDK.canOfferRewarded() || (!canRevive && !canRecover)) {
        box.style.display = 'none';
        return;
    }
    reviveBtn.style.display = canRevive ? '' : 'none';
    recoverBtn.style.display = canRecover ? '' : 'none';
    recoverBtn.innerText = `RECOVER ${lost} LUCIDITY (AD)`;
    reviveBtn.disabled = false;
    recoverBtn.disabled = false;
    setDeathRewardNote('');
    box.style.display = 'flex';
}

function runDeathReward(kind) {
    const box = document.getElementById('death-rewarded');
    const reviveBtn = document.getElementById('btn-revive');
    const recoverBtn = document.getElementById('btn-recover-lucidity');
    const restartBtn = document.getElementById('btn-restart');
    if (gameState !== 'DEAD' || !deathSettlement) return;
    // Lock every exit while the ad request is in flight, so a double tap cannot
    // request twice and RECONSTRUCT cannot tear the run down under a pending revive.
    [reviveBtn, recoverBtn, restartBtn].forEach(b => { if (b) b.disabled = true; });

    portalSDK.showRewardedAd({
        onStart: () => { noteAdShown(); if (audioEngine) audioEngine.setMuted('ad', true); },
        onRewarded: () => {
            if (kind === 'revive') performRevive();
            else performLucidityRecovery();
        },
        onComplete: ({ rewarded, errorCode }) => {
            if (audioEngine) audioEngine.setMuted('ad', false);
            if (restartBtn) restartBtn.disabled = false;
            if (rewarded) {
                noteAdShown();
                if (box) box.style.display = 'none';   // one rewarded ad per death
                return;
            }
            // Not rewarded: say so plainly, and offer again only if it can work.
            setDeathRewardNote(errorCode === 'unfilled' || errorCode === 'adCooldown'
                ? 'No transmission available right now. Try again in a moment.'
                : 'Transmission unavailable.');
            if (!portalSDK.canOfferRewarded()) {
                if (box) box.style.display = 'none';
            } else {
                if (reviveBtn) reviveBtn.disabled = false;
                if (recoverBtn) recoverBtn.disabled = false;
            }
        }
    });
}

function performLucidityRecovery() {
    if (!deathSettlement || deathSettlement.lost <= 0) return;
    saveManager.addLucidity(deathSettlement.lost);
    const stats = document.getElementById('final-stats');
    if (stats) {
        stats.insertAdjacentHTML('afterbegin',
            `<span style="color:var(--ui-gold);">Recovered <strong>${deathSettlement.lost}</strong> Lucidity from the Void. ` +
            `Total Banked: <strong>${saveManager.metaState.lucidityBank}</strong></span><br><br>`);
    }
    deathSettlement.lost = 0;
}

function performRevive() {
    if (!game.state || !deathSettlement) return;
    saveManager.removeLucidity(deathSettlement.recovered);
    deathSettlement = null;

    const st = game.state;
    st.reviveUsed = true;
    const maxHp = Number.isFinite(st.player.maxHp) ? st.player.maxHp : 100;
    st.sanity = Math.ceil(maxHp * 0.5);
    // 3 s of invulnerability (the existing i-frame mechanism) and a shove that clears
    // the space around the player; bosses hold their ground. Knockback decays x0.8 per
    // frame in Enemy.update, so a force of 40 travels about 200px.
    st.player.iframes = Math.max(st.player.iframes || 0, 180);
    for (const ent of st.entities) {
        if (!ent || BOSS_TYPE_SET.has(ent.type)) continue;
        const dx = ent.x - st.player.x, dy = ent.y - st.player.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 320) continue;
        const d = Math.max(dist, 0.001);
        ent.knockbackX = (ent.knockbackX || 0) + (dx / d) * 40;
        ent.knockbackY = (ent.knockbackY || 0) + (dy / d) * 40;
    }

    document.getElementById('death-screen').style.display = 'none';
    document.getElementById('ui-layer').style.display = 'flex';
    if (inputManager && typeof inputManager.revealTouchControls === 'function') {
        inputManager.revealTouchControls();
    }
    if (audioEngine) audioEngine.startGameDrone();   // onDeath faded the master out
    pacing.reset();
    lastBreakdown = false;
    gameState = 'PLAYING';
    syncPortalGameplayState();   // gameplayStart on revive, as the SDK docs list
}

// BOSS_TYPE_SET now lives in data/Config.js (Patch 117).

// happytime() (Patch 104): CrazyGames asks for it "sparingly", on achievements such
// as beating a boss — not on ordinary level completion. We fire it when a boss falls
// on the player's deepest floor so far, once per floor per session, so farming floor
// 1 does not spam it.
const happyFloorsThisSession = new Set();
function maybeHappytimeForBossKill(floor) {
    if (!saveManager || !Number.isFinite(floor)) return;
    if (floor < (saveManager.metaState.maxFloorReached || 1)) return;
    if (happyFloorsThisSession.has(floor)) return;
    happyFloorsThisSession.add(floor);
    portalSDK.happytime();
}

// --- NEW: GLOBAL ACCESSIBILITY SETTINGS ---
//
// musicVolume / sfxVolume (Patch 80) default to 1 — the exact pre-patch mix. This
// has to be opt-OUT: an existing player who has never opened this panel must hear
// what they heard yesterday, and a saved settings blob written before this patch
// simply lacks the keys, so the spread below leaves the defaults in place.
//
// Patch 106: this import-time read is raw localStorage because it runs before
// portalSDK.init(); reloadSettingsFromPortal() re-reads through the portal once init
// has resolved, and saveSettings() writes through it. Try/caught, so a SecurityError
// degrades to default settings rather than killing boot.
let gameSettings = { screenShake: true, photosensitive: false, musicVolume: 1, sfxVolume: 1,
                     // Patch 115: 'auto' | 'high' | 'low'; autoQuality is what AUTO settled on.
                     quality: 'auto', autoQuality: 'high' };
try {
    const savedSettings = localStorage.getItem('fractured_settings');
    if (savedSettings) gameSettings = { ...gameSettings, ...JSON.parse(savedSettings) };
} catch(e) { console.warn("Could not load settings."); }

/** Clamp a persisted volume back into 0..1. Old/hand-edited/corrupt saves reach
 *  a GainNode from here, and a NaN there silences the bus for the session. */
function safeVolume(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
}

function saveSettings() {
    // Patch 106 (V2 plan A6): through portalSDK, so on CrazyGames settings follow the
    // player's account like the rest of the save (the data module is the save of
    // record there). Off-portal portalSDK.setItem IS localStorage.setItem on the same
    // key, so itch/self-hosted storage is byte-for-byte unchanged. Never throws.
    portalSDK.setItem('fractured_settings', JSON.stringify(gameSettings));
}

/**
 * Patch 106: the module-level read above runs at import time, BEFORE portalSDK.init()
 * resolves, so it can only see raw localStorage. Called first thing in initEngine()
 * (after init), it re-reads through the portal and merges over the defaults.
 *
 * Migration: a player whose settings only exist in raw localStorage (every v1 player
 * on the portal) has them copied into the portal store once, so a volume they turned
 * down yesterday is not reset to full by the move. Off-portal both reads hit the same
 * key and this is a no-op.
 */
// --- GRAPHICS QUALITY TIER (Patch 115, V2 plan B7) --------------------------------
//
// HIGH is the game as it was. LOW: darkness mask at half resolution, 12 fog clouds
// instead of 30, no film grain, and lower simulation ceilings (45 live enemies, 200
// particles). AUTO starts at whatever it last settled on and steps DOWN once per
// session if live gameplay is slow; it never steps back up on its own (that would
// flap), but choosing AUTO again in Settings re-evaluates from HIGH.
const QUALITY_CAPS = {
    high: { liveEntityCap: 60, particleCap: 450 },
    low:  { liveEntityCap: 45, particleCap: 200 }
};
function currentQualityTier() {
    const q = gameSettings.quality;
    if (q === 'high' || q === 'low') return q;
    return gameSettings.autoQuality === 'low' ? 'low' : 'high';
}
function applyQualityTier() {
    const tier = currentQualityTier();
    if (renderer && typeof renderer.setQuality === 'function') renderer.setQuality(tier);
    if (game && game.director) Object.assign(game.director, QUALITY_CAPS[tier]);
}

// AUTO's probe (Patch 115, corrected in Patch 120): mean interval between DRAWN
// frames over 2 s of live PLAYING (at least 30 draws), after a 2 s warm-up (asset decode and first-room
// spawns are not representative). Above 25 ms (under ~40 drawn fps) it drops to LOW
// and remembers it for the next session, so a weak phone does not pay the slow first
// minute again.
//
// Patch 120 fixed two ways the first version missed exactly the phones it was for
// (reported from a Samsung A56): it timed rAF callbacks, and on a 120 Hz screen the
// Patch 114 draw-skip interleaves ~8 ms empty callbacks that pulled the mean under
// the threshold however slow the real draws were; and it DISCARDED intervals over
// 100 ms as "gaps", so a device running at under 10 fps never accumulated a sample.
// Called from the draw branch only, and the clock advances on every draw (menus
// included), so only intervals between consecutive draws count. Intervals over 1 s
// are still skipped: a backgrounded tab or a one-off hitch is not the steady state.
const qualityProbe = { lastDraw: 0, playingMs: 0, sum: 0, n: 0, done: false };
function probeQualityOnDraw(time) {
    const dt = time - qualityProbe.lastDraw;
    qualityProbe.lastDraw = time;
    if (qualityProbe.done || gameSettings.quality !== 'auto' || currentQualityTier() === 'low') return;
    if (gameState !== 'PLAYING' || !(dt > 0) || dt > 1000) return;
    qualityProbe.playingMs += dt;
    if (qualityProbe.playingMs < 2000) return;
    qualityProbe.sum += dt; qualityProbe.n++;
    // Decide after 2 s of sampled play, not after N draws: a fixed count takes 2 s at
    // 60 fps but 12+ s at 10 fps, so the slowest phones would wait longest for help.
    if (qualityProbe.sum < 2000 || qualityProbe.n < 30) return;
    const mean = qualityProbe.sum / qualityProbe.n;
    qualityProbe.done = true;
    if (mean > 25) {
        gameSettings.autoQuality = 'low';
        applyQualityTier();
        saveSettings();
    }
}

function reloadSettingsFromPortal() {
    if (!portalSDK.available) return;
    try {
        const fromPortal = portalSDK.getItem('fractured_settings');
        if (fromPortal) {
            gameSettings = { ...gameSettings, ...JSON.parse(fromPortal) };
        } else {
            saveSettings();   // migrate whatever the import-time localStorage read found
        }
    } catch (e) {
        errorLog.capture(e, 'settings-portal-load');
    }
}

/** Pushes the persisted volumes into the audio graph. Safe to call before the
 *  AudioContext exists — AudioEngine stores the value and applies it when the
 *  graph is built, which is the normal case on a cold load. */
function applyAudioSettings() {
    if (!audioEngine) return;
    audioEngine.setMusicVolume(safeVolume(gameSettings.musicVolume));
    audioEngine.setSfxVolume(safeVolume(gameSettings.sfxVolume));
}

// --- SUSPENDED-RUN STORAGE (Patch 51a) ---------------------------------------
//
// Every read/write of the mid-floor save used to be a RAW `localStorage` call.
// That is not safe here: this game runs inside the portal's iframe, and where
// storage is partitioned or blocked (Safari ITP, third-party-cookie blocking,
// in-app webviews) merely TOUCHING `window.localStorage` throws SecurityError.
// One of those calls sat on the boot path inside initEngine(), so that throw
// killed the entire launch — no game loop, no title button, dead screen. The
// portal's own SDK ships a "SafeLocalStorage" wrapper for exactly this reason.
//
// portalSDK.getItem/setItem/removeItem are already fully try/caught and fall
// back to plain localStorage off-portal, so routing through them is both the
// fix and a free upgrade to cloud-synced suspension for signed-in players.
const SUSPENDED_RUN_KEY = 'fractured_suspended_run';

function readSuspendedRun() {
    const viaPortal = portalSDK.getItem(SUSPENDED_RUN_KEY);
    if (viaPortal) return viaPortal;
    // Migration path: a run suspended BEFORE this patch lives in raw localStorage,
    // which for a signed-in player is a different store than the one above. Without
    // this fallback those players would silently lose an in-progress run exactly
    // once, on the update that was supposed to make storage more reliable.
    try {
        return localStorage.getItem(SUSPENDED_RUN_KEY);
    } catch (e) {
        return null;
    }
}

function writeSuspendedRun(value) {
    portalSDK.setItem(SUSPENDED_RUN_KEY, value);
}

function clearSuspendedRun() {
    portalSDK.removeItem(SUSPENDED_RUN_KEY);
    // Clear the pre-patch copy too, or the migration read above would keep
    // resurrecting a run the player already finished or abandoned.
    try { localStorage.removeItem(SUSPENDED_RUN_KEY); } catch (e) {}
}

/**
 * Parsed suspended run, or null when there isn't one.
 *
 * The JSON.parse this replaces was unguarded (Patch 51, finding F5): a value
 * truncated by an interrupted write or an exhausted quota threw SyntaxError
 * inside the RESUME click handler, leaving a button that silently did nothing
 * forever with no way for the player to clear it. A corrupt run is now dropped
 * on read, so the UI returns to the honest "no suspended run" state.
 */
function loadSuspendedRun() {
    const raw = readSuspendedRun();
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
        throw new Error('suspended run was not an object');
    } catch (e) {
        errorLog.capture(e, 'suspended-run-parse');
        clearSuspendedRun();
        return null;
    }
}

// DEV: build-diversity snapshot (Patch 14). Captures the shape of a completed
// build so 10 runs can be diffed to see whether builds actually diverge.
// synergies is recomputed here rather than trusted from state.player.synergies,
// which Game.init() computes once from floor-1 (mostly level-0) weapons and
// never updates as weapons level up during the run.
function buildDiversitySnapshot(game) {
    const weapons = {};
    if (game.state.player.weapons) {
        Object.entries(game.state.player.weapons).forEach(([id, w]) => {
            if (w && w.level > 0) weapons[id] = w.level;
        });
    }
    return {
        weapons,
        levels: game.state.level,
        boons: game.state.player.boons || [],
        synergies: getActiveSynergies(game.state.player.weapons),
        tokens: game.state.runInventory || [],
        curses: game.state.player.curses || [],
        floor: game.state.floor
    };
}

// DEV note turned player-facing (Patch 28): "what you built" reuses
// buildDiversitySnapshot() (Patch 14) so both stay in sync. "What killed you" is
// deliberately NOT included — there is no cause-of-death tracking anywhere in the
// codebase (Game.takeDamage() only ever receives a bare amount, never a source),
// and adding it would mean touching Game.js/Combat.js, which are outside this
// patch's file scope. Boon ids are prettified from their raw id (kinetic_dash ->
// Kinetic Dash) rather than looked up against a real name table, because that
// table — BOONS in LevelUpUI.js — is a local const, not exported (same gap
// Patch 15 hit for the same array). Synergies DO have a real name table
// (SYNERGIES, imported above) since that one is actually exported.
function buildRunSummaryHtml(game) {
    const snap = buildDiversitySnapshot(game);
    const tel = game.state.telemetry;

    const prettify = (id) => id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    const weaponList = Object.entries(snap.weapons)
        .map(([id, lvl]) => `${prettify(id)} L${lvl}`)
        .join(', ') || 'none';

    const boonList = snap.boons.length
        ? snap.boons.map(prettify).join(', ')
        : 'none';

    const synergyList = snap.synergies.length
        ? snap.synergies.map(id => (SYNERGIES[id] && SYNERGIES[id].name) || prettify(id)).join(', ')
        : 'none active';

    const curseLine = snap.curses.length
        ? `<span style="color:var(--ui-red);">CURSES:</span> ${snap.curses.map(prettify).join(', ')}<br>`
        : '';

    const roomsCleared = tel ? tel.roomClearTimes.length : 0;
    const sanityLow = tel && Number.isFinite(tel.sanityLowWater) ? Math.floor(tel.sanityLowWater) : '—';

    return `
        <div class="run-summary">
            <span style="color:var(--ui-gold);">PATIENT FILE — THIS ATTEMPT</span><br>
            Character Level: <strong>${snap.levels}</strong> &nbsp; Rooms Cleared: <strong>${roomsCleared}</strong> &nbsp; Lowest Sanity: <strong>${sanityLow}</strong><br><br>
            <span style="color:var(--ui-gold);">WEAPONS:</span> ${weaponList}<br>
            <span style="color:var(--ui-gold);">BOONS:</span> ${boonList}<br>
            <span style="color:var(--ui-gold);">SYNERGIES:</span> ${synergyList}<br>
            ${curseLine}<br>
            <span style="color:var(--ui-gold);">NEXT STEP:</span> Spend your Lucidity in SYNAPSE RECORDS to grow stronger before your next descent.
        </div>
    `;
}

/**
 * Last-resort boot failure notice (Patch 51b). Built in JS rather than added to
 * index.html because it must render when the canvas pipeline is the thing that
 * failed, and because index.html is under the "small patches only" rule. Kept in
 * the clinical-file voice the rest of the UI uses.
 */
function showFatalBootError() {
    try {
        const container = document.getElementById('game-container') || document.body;
        const notice = document.createElement('div');
        notice.className = 'fullscreen-menu';
        notice.style.cssText = 'display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:30px; z-index:10001;';
        notice.innerHTML = `
            <div class="title-glitch" style="font-size:2.5rem; margin-bottom:20px;">SESSION REFUSED</div>
            <p class="typewriter-text" style="color:#888; max-width:420px; line-height:1.5;">
                This device would not open a rendering surface for the evaluation.<br><br>
                Close some other tabs or applications and reload. If it persists, try a different browser.
            </p>
        `;
        container.appendChild(notice);
    } catch (e) {
        // If even this fails there is nothing further to try.
    }
}

// --- RUN LAUNCH (Patch 52) ---------------------------------------------------
//
// Before this patch there was exactly one way into gameplay — the hub's AUTHORIZE
// DESCENT button — and its logic lived inline in UIManager's callback. The title
// screen can now launch a run directly, so that logic is extracted here and every
// entry point routes through it. One code path, so the title and the hub can never
// drift into launching runs that differ in setup.

/**
 * Dev-only floor/boss overrides. Body is unchanged from the inline version; the
 * `import.meta.env.DEV` gate means Vite strips the whole thing from production,
 * which is what stops a hidden <select> from silently starting players on Floor 5
 * (see the shipping bug this guard was originally written for).
 */
function applyDevOverrides() {
    if (import.meta.env.DEV) {
        const devSelect = window.FRACTURED_DEV_MODE ? document.getElementById('dev-floor-select') : null;
        if (devSelect && devSelect.value !== "1") {
            const chosenFloor = parseInt(devSelect.value);
            game.init(saveManager); // Re-initialize to lock in floor scalings properly
            game.state.floor = chosenFloor;
            game.state.maxConvergence = Math.floor(100 * Math.pow(1.3, chosenFloor - 1));
            game.state.xp += (chosenFloor - 1) * 1500;
            console.log(`%c DEV OVERRIDE: Starting on Floor ${chosenFloor}. Free XP granted. `, 'background: #c5a059; color: #000;');

            if (chosenFloor > saveManager.metaState.maxFloorReached) {
                saveManager.metaState.maxFloorReached = chosenFloor;
                saveManager.saveGame();
            }
        }

        // DEV: jump straight to the boss encounter. Director.spawnRoom() spawns the
        // floor's boss whenever roomNumber >= maxRoomsPerFloor, and spawnWave() calls
        // spawnRoom() on the first frame (enemyBudget is still undefined), so parking
        // roomNumber at the cap is enough — no separate "spawn boss now" path needed.
        // The announcement banner keys off state.bossSpawned, so it still plays.
        const devSkipBoss = window.FRACTURED_DEV_MODE ? document.getElementById('dev-skip-to-boss') : null;
        if (devSkipBoss && devSkipBoss.checked) {
            game.state.roomNumber = game.state.maxRoomsPerFloor;
            // Compensate for the rooms' worth of XP that got skipped, otherwise the
            // boss is fought at level 1 with no weapons and kills you before you can
            // look at it.
            game.state.xp += 1200;
            console.log(`%c DEV OVERRIDE: Skipping to boss room on Floor ${game.state.floor}. `, 'background: #c5a059; color: #000;');
        }
    }
}

/**
 * Unlocks audio for a run launched straight from the title screen.
 *
 * Deliberately audioEngine.unlock() and NOT init(): init() ends by starting the
 * menu theme, which would then have to be faded out over a full second on top of
 * the opening room. Game.init() starts the gameplay drone on its own, and a source
 * started while the context is still suspended simply begins when the resume
 * lands — so the ordering here needs no coordination.
 */
function resumeAudioForGameplay() {
    if (!audioEngine) return;
    try {
        const ready = audioEngine.unlock();
        if (ready && typeof ready.catch === 'function') ready.catch(() => {});
    } catch (e) {
        errorLog.capture(e, 'audio-launch');
    }
}

// showConfirm moved to src/ui/Dialog.js (Patch 103) — imported at the top of this file.

/** Shared final step for every launch: show the HUD, place the player, start play. */
function enterPlayingState() {
    const titleScreen = document.getElementById('title-screen');
    if (titleScreen) titleScreen.style.display = 'none';
    hideStorageNotice();   // Patch 92: never let the bar sit over live gameplay.
    document.getElementById('clinical-folder-menu').style.display = 'none';
    document.getElementById('ui-layer').style.display = 'flex';

    game.state.player.x = canvas.width / 2;
    game.state.player.y = canvas.height / 2;
    game.state.mapOriginX = game.state.player.x;
    game.state.mapOriginY = game.state.player.y;

    const resumeBtn = document.getElementById('btn-resume-run');
    if (resumeBtn) resumeBtn.style.display = 'none';

    // Patch 65: on a touch device the controls are now visible from the first frame of
    // play rather than from the first touch. Called here, after every menu close, so it
    // also undoes hideJoysticks()' latch reset on the way back into a run.
    if (inputManager && typeof inputManager.revealTouchControls === 'function') {
        inputManager.revealTouchControls();
    }

    // Patch 74: start the run's clock clean. Menu frames accumulate without ever
    // stepping, and a stale breakdown flag would leave the glitch overlay from the
    // previous death sitting over the first frame of the new run.
    pacing.reset();
    lastBreakdown = false;

    gameState = 'PLAYING';
}

/**
 * Starts a fresh run at floor 1, room 1.
 *
 * game.init() is called unconditionally, which also fixes a real bug in the old
 * path: it re-read meta only when ENTERING the hub, so Synapse nodes or tokens
 * bought during that hub visit were not applied to the run launched from it. A
 * fresh run must be built from the meta state as it is at launch.
 */
function startNewRun() {
    game.init(saveManager);
    applyDevOverrides();
    // Patch 59: counted here rather than in enterPlayingState(), which RESUMING also
    // goes through — picking a suspended run back up is the same descent continuing,
    // not a new one.
    if (saveManager && typeof saveManager.recordRunStat === 'function') {
        saveManager.recordRunStat('runsStarted');
    }
    enterPlayingState();
}

/**
 * Patch 97 — starts a fresh run directly in THE RECURSION, at floor 6.
 *
 * CALLS startNewRun() rather than reimplementing it. That is the whole design of this
 * function: Patch 52 collapsed every route into gameplay onto one code path precisely
 * so two entry points could not drift apart in their setup, and this is a third route.
 * Everything shared — reading meta at launch, dev overrides, `runsStarted`, audio,
 * revealing touch controls, the portal gameplay state — happens in there, once. Only
 * the seed is applied here.
 *
 * DELIBERATELY NOT ROUTED THROUGH carriedState, which would have been the obvious way
 * to set a starting floor: Game.init treats a non-null carriedState as "this is a floor
 * descent, not a new run", and skips the C1/C2 capstone grants (start_boon,
 * start_weapon) on that basis. A player who has bought those nodes must receive them
 * here — this IS a fresh run, it just does not begin at the top.
 */
function startEndlessRun() {
    startNewRun();

    game.state.floor = ENDLESS_START_FLOOR;
    // Same expression Game.init uses, so the two cannot disagree about what this
    // derived value means.
    game.state.maxConvergence = Math.floor(100 * Math.pow(1.3, ENDLESS_START_FLOOR - 1));

    // The opening draft. Granting XP rather than handing over a pre-built loadout means
    // the player CHOOSES the build they take in, through the level-up cards that
    // already exist — and it costs no new UI at all.
    game.state.xp += endlessDraftXP(getXPRequiredForLevel);

    if (saveManager && saveManager.metaState &&
        ENDLESS_START_FLOOR > (saveManager.metaState.maxFloorReached || 1)) {
        saveManager.metaState.maxFloorReached = ENDLESS_START_FLOOR;
        saveManager.saveGame();
    }
}

/**
 * Resumes the suspended run. Returns false (leaving the player where they are)
 * when there is nothing to resume or the saved run was corrupt — loadSuspendedRun
 * discards a corrupt one, so the UI is refreshed to match.
 */
function resumeSuspendedRun() {
    const carried = loadSuspendedRun();
    if (!carried) {
        refreshTitleActions();
        return false;
    }
    game.init(saveManager, carried);
    // Consumed on resume, exactly as the pre-patch flow did: the run is live again,
    // so the suspended copy must not linger and offer a second, stale resume.
    clearSuspendedRun();
    enterPlayingState();
    return true;
}

/**
 * Persists the live run so a tab closed, backgrounded or killed mid-floor can be
 * picked up again (Patch 54).
 *
 * DELIBERATELY DOES NOT BANK LUCIDITY, unlike the Awaken button. Awaken is a
 * deliberate trade — you bank your Lucidity and the run ends. An unclean exit is
 * not that trade, and paying it out here would be exploitable: the carried state
 * keeps `lucidity`, so banking on every autosave would let a player background the
 * tab repeatedly and be paid for the same Lucidity each time. Nothing is lost by
 * holding it — it is still in the run when they resume.
 *
 * The gameState guard is what keeps this from clobbering a legitimate save: at
 * EXIT_REACHED (floor cleared) and DEAD the run is already resolved, and writing a
 * resumable copy then would hand the player a way to undo either outcome.
 */
function autoSaveRun() {
    if (gameState !== 'PLAYING' && gameState !== 'PAUSED') return;
    if (!game || !game.state || typeof game.getCarriedState !== 'function') return;
    try {
        writeSuspendedRun(JSON.stringify(game.getCarriedState()));
    } catch (e) {
        errorLog.capture(e, 'autosave');
    }
}

/** The walkable Mind Hub — the old INITIALIZE destination, now opt-in. */
function enterMindHub() {
    const titleScreen = document.getElementById('title-screen');
    if (titleScreen) titleScreen.style.display = 'none';
    hideStorageNotice();   // Patch 92: title-screen furniture, not a hub element.
    game.init(saveManager);
    game.state.player.x = 0;
    game.state.player.y = 0;
    gameState = 'HUB';
}

/**
 * Reveals RESUME DESCENT only when there is genuinely something to resume, and
 * names the floor/room so the player knows what they would be returning to (and,
 * on the BEGIN DESCENT confirm, what they would be giving up).
 */
/**
 * Patch 97/99 — puts BOTH Recursion entries into the right state for this save.
 *
 * One function for the two surfaces, so the title screen and the clinical folder can
 * never disagree. Called on every title refresh and on every folder open rather than
 * once at injection: those blocks run at boot, and the Architect can fall during the
 * session that follows — awakening after a first clear must promote the entry
 * immediately, not on the next reload.
 *
 * PATCH 99 — SHOWN WHEN LOCKED, not hidden. Patch 97 hid it, reasoning that a button
 * naming an endless mode after the final boss spoils the ending. On play, that was the
 * wrong trade: the mode was invisible to exactly the players who had not yet reached it,
 * so it could not do the one thing an unreached goal is for — give a reason to go back
 * down. It now reads as SEALED and states its requirement, which is a hint rather than
 * a spoiler: it names FLOOR 5, never the Architect, so what is waiting there is still a
 * surprise. That is the same line the Descent Roadmap already draws — it seals unvisited
 * floors while still showing they exist.
 *
 * PATCH 101 — the locked state got LOUDER, and got a click.
 *
 * Patch 99 rendered it in the roadmap's muted `#9a917f` at 0.6 opacity, over a dark red
 * title screen. It was legible but it read as chrome — a disabled row you scan past —
 * which is the opposite of a goal. It now wears the same gold as the live entries, with
 * a dashed border and a stamped SEALED tag carrying the "unavailable" meaning instead of
 * the colour doing it. Sealed, not switched off.
 *
 * It is also no longer a `disabled` button, so it can be clicked: locked, a click opens
 * the notice below rather than launching anything. A goal you can interrogate is worth
 * more than one you can only look at, and the two-line label cannot hold the tease that
 * the notice can.
 */
function refreshRecursionEntries() {
    if (!saveManager) return;
    const unlocked = isRecursionUnlocked(saveManager.metaState);

    ['btn-title-endless', 'btn-start-endless'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;

        btn.style.display = 'block';
        // NOT `disabled` — the locked button is clickable and answers with a notice.
        // (It also has to stay enabled for UIManager.attachEvents' hover/click SFX,
        // which skip disabled buttons.)
        btn.disabled = false;

        if (unlocked) {
            btn.innerHTML = 'THE RECURSION';
            btn.style.color = 'var(--ui-gold)';
            btn.style.opacity = '0.85';
            btn.style.borderStyle = '';
            btn.style.borderColor = '';
            btn.style.cursor = '';
            btn.title = 'Endless descent. The construct rebuilds itself.';
        } else {
            // Gold, like the live entries — a locked goal has to look like something you
            // WANT, not like a greyed-out control. The dashed border and the stamped tag
            // carry "not yet", so the colour does not have to.
            btn.innerHTML =
                'THE RECURSION' +
                '<span style="display:inline-block; margin-left:8px; padding:1px 6px; border:1px dashed currentColor; font-size:0.58rem; letter-spacing:2px; vertical-align:middle; opacity:0.85;">SEALED</span>' +
                '<span style="display:block; font-size:0.62rem; letter-spacing:2px; margin-top:4px; opacity:0.75;">SUBDUE THE SUBJECT ON FLOOR 5</span>';
            btn.style.color = 'var(--ui-gold)';
            btn.style.opacity = '0.8';
            btn.style.borderStyle = 'dashed';
            btn.style.borderColor = 'rgba(197, 160, 89, 0.55)';
            btn.style.cursor = 'pointer';
            btn.title = 'Clear Floor 5 to unlock the endless descent.';
        }
    });
}

/**
 * Patch 101 — the notice behind a SEALED Recursion entry.
 *
 * Written to tease rather than to instruct. It states the requirement plainly (reach
 * Floor 5, subdue what is there) and then declines to say what follows, because what
 * follows is the reward for doing it. It never names the Architect — same line the
 * Descent Roadmap draws, and the reason showing this at all is a hint and not a spoiler.
 *
 * Reuses the `#confirm-modal` folder chrome via showConfirm's noticeOnly mode, so it is
 * the same torn-paper dialog as every other interruption in the game rather than a
 * second thing that has to be kept looking like the first.
 */
function showRecursionSealedNotice() {
    showConfirm({
        title: 'PROTOCOL SEALED',
        body: 'Clearance for this procedure requires a completed evaluation. Descend to FLOOR 5. Subdue whatever it is that keeps the construct standing.',
        note: 'What happens after that is not recorded in this file.',
        confirmLabel: 'UNDERSTOOD',
        danger: false,
        noticeOnly: true,
        onConfirm: () => {}
    });
}

function refreshTitleActions() {
    const resumeBtn = document.getElementById('btn-title-resume');
    const note = document.getElementById('title-suspended-note');
    const raw = readSuspendedRun();

    // Patch 60: case record for a returning player. Shown only once there is a
    // history to show — a brand-new player gets a clean title screen rather than a
    // row of zeroes, and the line reads as something they earned when it does appear.
    const record = document.getElementById('title-case-record');
    if (record && saveManager && typeof saveManager.getRunStats === 'function') {
        const stats = saveManager.getRunStats();
        if (stats.runsStarted > 0) {
            const parts = [`${stats.runsStarted} DESCENT${stats.runsStarted === 1 ? '' : 'S'}`];
            if (stats.runsCompleted > 0) {
                parts.push(`${stats.runsCompleted} ESCAPED`);
            }
            record.innerText = `CASE FILE — ${parts.join('  ·  ')}`;
            record.style.display = 'block';
        } else {
            record.style.display = 'none';
        }
    }

    refreshRecursionEntries();

    let summary = null;
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                summary = `FLOOR ${parsed.floor || 1}, ROOM ${parsed.roomNumber || 1}`;
            }
        } catch (e) {
            // Corrupt payload: treated as "no suspended run" here. It is cleared for
            // real by loadSuspendedRun() if the player ever tries to resume it.
            summary = null;
        }
    }

    if (resumeBtn) resumeBtn.style.display = summary ? 'block' : 'none';
    if (note) {
        note.style.display = summary ? 'block' : 'none';
        note.innerText = summary ? `SUSPENDED PROTOCOL ON FILE — ${summary}` : '';
    }
    return summary;
}

// --- RECORDS RETENTION NOTICE (Patch 92) -------------------------------------
//
// One-time, first-load notice that progress lives in this browser and can be lost.
// It exists because on itch.io the save is exposed three ways at once: a shared CDN
// origin (clearing site data for any itch game clears ours), iframes where iOS and
// Safari routinely block persistence outright, and itch's own history of migrating
// CDN domains — which they have said loses saves, recommending exactly this pairing
// of a download/upload feature plus advance warning.
//
// The acknowledgement flag lives in SaveManager.metaState, NOT raw localStorage, per
// Keep clause 1: a direct localStorage read throws in the blocked iframe this notice
// is warning about, which would make the warning itself the thing that breaks. When
// storage is entirely unavailable nothing persists and the notice shows every load —
// deliberate, and arguably correct, since that player really does have no save.

/**
 * Makes the title column reserve exactly the bar's height, so the bar can never
 * cover a title button.
 *
 * This is not cosmetic. `.fullscreen-menu` centres a flex column with no overflow
 * handling, so a bottom-anchored bar simply lands on top of whatever the column's
 * bottom happens to be. Measured before this existed: on an 844x390 landscape phone
 * the bar covered MIND HUB and SYSTEM SETTINGS — the exact route to the export
 * feature the notice tells the player to use — and on desktop the clearance was
 * 25px, which a returning player's RESUME DESCENT button would have eaten.
 *
 * Height is MEASURED, never assumed: the copy wraps differently at every width and
 * the bar collapses to a single row under 560px tall, so any hardcoded reservation
 * would be wrong on some viewport. Same reasoning as Patch 71 sizing #control-band
 * from Renderer.controlBandH rather than from CSS — two places describing one
 * boundary must not be able to disagree.
 */
function applyStorageNoticeLayout() {
    const el = document.getElementById('storage-notice');
    const title = document.getElementById('title-screen');
    if (!el || !title) return;
    if (!el.classList.contains('is-visible') || !el.offsetHeight) {
        title.style.paddingBottom = '';
        return;
    }
    // The clearance gap comes from the stylesheet (--notice-gap on #storage-notice),
    // not from a constant here, so it stays next to the bar's own sizing rules and
    // shrinks with them on a short viewport. Falls back to 12px if the property is
    // missing or unparseable, which is the desktop value.
    const raw = parseFloat(getComputedStyle(el).getPropertyValue('--notice-gap'));
    const gap = Number.isFinite(raw) ? raw : 12;
    title.style.paddingBottom = `${el.offsetHeight + gap}px`;
}

/** Shows the retention notice unless it has already been acknowledged. */
function showStorageNoticeIfNeeded() {
    const el = document.getElementById('storage-notice');
    if (!el || !saveManager) return;
    // Patch 102: itch-only. On a live portal the save goes through the portal's data
    // module (PortalSDK storage backend), so "this browser only" would be false, and
    // a backup nag is the portal's account prompt's job, not ours. Not acknowledged
    // here: if the same player later opens the itch build, they still see it once.
    if (portalSDK.available) return;
    if (saveManager.metaState.storageNoticeAcknowledged === true) return;
    el.classList.add('is-visible');
    applyStorageNoticeLayout();
}

/** Hides the bar WITHOUT acknowledging — used when leaving the title screen. */
function hideStorageNotice() {
    const el = document.getElementById('storage-notice');
    if (el) el.classList.remove('is-visible');
    applyStorageNoticeLayout();   // releases the reserved space
}

// --- MILESTONE BACKUP PROMPT (Patch 92) --------------------------------------
//
// The retention notice above warns a brand-new player, who has nothing to lose yet
// and no reason to care. This is the second half: catch them ONCE, at the first
// moment the save is genuinely worth protecting, and hand them the export directly
// rather than describing where it lives.
//
// TRIGGER: Patient Level 2 (SaveManager.isBackupWorthPrompting), i.e. 500 spent
// Lucidity. Chosen over "first boss kill" because Patient Level only moves when
// Lucidity is SPENT on permanent upgrades or Synapse nodes — that spending is what
// metaState holds and what a cleared browser destroys. A boss kill is a run
// achievement, and a run is not persistent progress. It also lands earlier for most
// players, which is the whole point when the goal is to warn before loss.

/**
 * Offers the export once, on a non-gameplay screen.
 *
 * Call sites are deliberately the death summary and the return-to-hub from the
 * clinical folder — never mid-run. The folder-close site is what catches the player
 * in the same sitting as the purchase that crossed the threshold; the death site
 * catches anyone who got there another way.
 */
function maybeShowBackupPrompt() {
    if (!saveManager || !uiManager) return;
    // Patch 102: itch-only, same reasoning as showStorageNoticeIfNeeded. Returns
    // BEFORE markBackupPromptShown(), so the one-time offer is not spent on a portal.
    if (portalSDK.available) return;
    if (saveManager.metaState.backupPromptShown === true) return;
    if (!saveManager.isBackupWorthPrompting()) return;

    // Marked BEFORE the dialog opens, not in a callback. The prompt is a one-time
    // offer, and this way it is spent however the player disposes of it — export,
    // decline, or Escape. A flag set only in onConfirm would re-ask every single
    // death until they exported, which is nagging, not helping.
    saveManager.markBackupPromptShown();

    showConfirm({
        danger: false,
        title: 'RECORDS RETENTION',
        body: 'Your case file now holds real progress.',
        note: 'It is stored in this browser only — clearing your browser data, or '
            + 'switching browser or device, erases it. Copy the file now and keep it '
            + 'somewhere safe. You can do this again any time from EVALUATION.',
        confirmLabel: 'BACK UP FILE NOW',
        cancelLabel: 'NOT NOW',
        onConfirm: () => uiManager.runExportSave()
    });
}

function initEngine() {
    reloadSettingsFromPortal();   // Patch 106: before anything reads gameSettings.

    // The ENTIRE dev toolkit (floor override, skip-to-boss, lucidity/patient-level
    // grants, unlock forcing, build-log dump, visual test bench, telemetry overlay)
    // is gated on import.meta.env.DEV. Vite substitutes that with a literal `false`
    // in `npm run build`, so this whole block is dead-code-eliminated and never
    // reaches players — while `npm run dev` keeps every tool intact.
    // Gating at CREATION is what matters: the old code built these controls in all
    // builds and merely hid them with CSS, which is how a hidden <select> defaulting
    // to "5" silently started every player on Floor 5.
    if (import.meta.env.DEV && !document.getElementById('dev-floor-select')) {
        const devUI = document.createElement('div');
        devUI.id = 'dev-mode-container';
        devUI.style.cssText = "position:absolute; bottom:10px; left:10px; z-index:9999; background:rgba(0,0,0,0.8); border:1px solid var(--ui-gold); padding:8px; color:var(--ui-gold); font-family:monospace; font-size:12px;";
        devUI.innerHTML = `
            DEV OVERRIDE - STARTING FLOOR: 
            <select id="dev-floor-select" style="background:#111; color:var(--ui-gold); border:1px solid #333; outline:none; font-family:inherit; margin-left:10px; padding:2px;">
                <option value="1" selected>1 - SPHERE HEAD</option>
                <option value="2">2 - RORSCHACH</option>
                <option value="3">3 - PANOPTICON</option>
                <option value="4">4 - AMALGAMATION</option>
                <option value="5">5 - ARCHITECT</option>
                <option value="6">6 - RECURSION II: SPHERE HEAD</option>
                <option value="7">7 - RECURSION II: RORSCHACH</option>
                <option value="10">10 - RECURSION II: ARCHITECT</option>
                <option value="16">16 - RECURSION IV (visual cap)</option>
            </select>
            <label for="dev-skip-to-boss" style="display:block; margin-top:8px; cursor:pointer; user-select:none;">
                <input type="checkbox" id="dev-skip-to-boss" style="vertical-align:middle; margin-right:6px;">
                SKIP TO BOSS ROOM
            </label>
            <div style="margin-top:8px; display:flex; flex-direction:column; gap:4px;">
                <button id="dev-btn-add-lucidity" style="background:#111; color:var(--ui-gold); border:1px solid #333; cursor:pointer; font-family:inherit; padding:4px;">+1000 LUCIDITY (BANK)</button>
                <button id="dev-btn-add-patient-xp" style="background:#111; color:var(--ui-gold); border:1px solid #333; cursor:pointer; font-family:inherit; padding:4px;">+5000 SPENT (PATIENT LVL)</button>
                <button id="dev-btn-force-escape" style="background:#111; color:var(--ui-gold); border:1px solid #333; cursor:pointer; font-family:inherit; padding:4px;">FORCE UNLOCK: FIRST ESCAPE</button>
                <button id="dev-btn-force-boss-kill" style="background:#111; color:var(--ui-gold); border:1px solid #333; cursor:pointer; font-family:inherit; padding:4px;">FORCE UNLOCK: FIRST BOSS KILL</button>
                <button id="dev-btn-force-recursion" style="background:#111; color:var(--ui-gold); border:1px solid #333; cursor:pointer; font-family:inherit; padding:4px;">FORCE UNLOCK: THE RECURSION</button>
                <button id="dev-btn-dump-builds" style="background:#111; color:var(--ui-gold); border:1px solid #333; cursor:pointer; font-family:inherit; padding:4px;">DUMP BUILD LOG (CONSOLE)</button>
                <button id="dev-btn-dump-errors" style="background:#111; color:var(--ui-gold); border:1px solid #333; cursor:pointer; font-family:inherit; padding:4px;">DUMP ERROR LOG (CONSOLE)</button>
                <button id="dev-btn-force-error" style="background:#111; color:var(--ui-red); border:1px solid #333; cursor:pointer; font-family:inherit; padding:4px;">FORCE TEST ERROR (3 PATHS)</button>
            </div>
            <div style="margin-top:10px; border-top:1px solid #333; padding-top:8px; display:flex; flex-direction:column; gap:4px;">
                LOADOUT TESTING (Patch 33)
                <button id="dev-btn-add-one-of-each-token" style="background:#111; color:var(--ui-gold); border:1px solid #333; cursor:pointer; font-family:inherit; padding:4px;">ADD ONE OF EACH TOKEN (16)</button>
                <button id="dev-btn-add-random-token" style="background:#111; color:var(--ui-gold); border:1px solid #333; cursor:pointer; font-family:inherit; padding:4px;">ADD RANDOM TOKEN (RANDOM RARITY)</button>
            </div>
            <div style="margin-top:10px; border-top:1px solid #333; padding-top:8px;">
                VISUAL TEST BENCH (in-run)
                <label for="dev-freeze-entities" style="display:block; margin-top:6px; cursor:pointer; user-select:none;">
                    <input type="checkbox" id="dev-freeze-entities" style="vertical-align:middle; margin-right:6px;">
                    FREEZE ENEMY AI
                </label>
                <label for="dev-telemetry-enabled" style="display:block; margin-top:6px; cursor:pointer; user-select:none;">
                    <input type="checkbox" id="dev-telemetry-enabled" style="vertical-align:middle; margin-right:6px;">
                    RUN TELEMETRY OVERLAY
                </label>
                <div style="margin-top:6px; display:flex; flex-direction:column; gap:4px;">
                    <button id="dev-btn-spawn-enemies" style="background:#111; color:var(--ui-gold); border:1px solid #333; cursor:pointer; font-family:inherit; padding:4px;">SPAWN ONE OF EACH ENEMY</button>
                    <button id="dev-btn-spawn-bosses" style="background:#111; color:var(--ui-gold); border:1px solid #333; cursor:pointer; font-family:inherit; padding:4px;">SPAWN ALL 5 BOSSES</button>
                    <button id="dev-btn-clear-entities" style="background:#111; color:var(--ui-gold); border:1px solid #333; cursor:pointer; font-family:inherit; padding:4px;">CLEAR ALL ENTITIES</button>
                    <div style="display:flex; gap:4px; align-items:center;">
                        <select id="dev-scenario-select" style="flex:1; background:#111; color:var(--ui-gold); border:1px solid #333; outline:none; font-family:inherit; padding:2px;">
                            <option value="IDLE">IDLE</option>
                            <option value="TELEGRAPH">TELEGRAPH / CHARGE</option>
                            <option value="ATTACK">ATTACK / ACTIVE</option>
                            <option value="FLASH">HIT FLASH</option>
                        </select>
                        <button id="dev-btn-apply-scenario" style="background:#111; color:var(--ui-gold); border:1px solid #333; cursor:pointer; font-family:inherit; padding:4px;">APPLY</button>
                    </div>
                </div>
            </div>
        `;
        document.getElementById('game-container').appendChild(devUI);

        // DEV: run telemetry overlay (Patch 13). Plain text panel, shown/updated
        // per frame from gameLoop only while dev mode + the checkbox above are
        // both on and a run is in progress. Looked up by id in gameLoop rather
        // than closed over here, matching how dev-mode-container itself is read.
        const telemetryOverlay = document.createElement('div');
        telemetryOverlay.id = 'dev-telemetry-overlay';
        telemetryOverlay.style.cssText = "position:absolute; top:10px; right:10px; z-index:9999; background:rgba(0,0,0,0.8); border:1px solid var(--ui-gold); padding:8px; color:var(--ui-gold); font-family:monospace; font-size:12px; white-space:pre; display:none; pointer-events:none;";
        document.getElementById('game-container').appendChild(telemetryOverlay);

        document.getElementById('dev-btn-add-lucidity').addEventListener('click', () => {
            saveManager.addLucidity(1000);
            console.log(`%c DEV: +1000 Lucidity banked. Total: ${saveManager.metaState.lucidityBank} `, 'background: #c5a059; color: #000; font-weight: bold;');
        });
        document.getElementById('dev-btn-add-patient-xp').addEventListener('click', () => {
            saveManager.metaState.spentLucidity = (saveManager.metaState.spentLucidity || 0) + 5000;
            saveManager.saveGame();
            console.log(`%c DEV: +5000 spent Lucidity. Patient Level now: ${saveManager.getPatientLevelInfo().level} `, 'background: #c5a059; color: #000; font-weight: bold;');
        });
        document.getElementById('dev-btn-force-escape').addEventListener('click', () => {
            saveManager.markFirstEscape();
            console.log('%c DEV: hasEscapedFloor1 forced TRUE. ', 'background: #c5a059; color: #000; font-weight: bold;');
        });
        document.getElementById('dev-btn-force-boss-kill').addEventListener('click', () => {
            saveManager.metaState.killCounts.BOSS = Math.max(1, saveManager.metaState.killCounts.BOSS || 0);
            saveManager.saveGame();
            console.log(`%c DEV: killCounts.BOSS forced to ${saveManager.metaState.killCounts.BOSS}. `, 'background: #c5a059; color: #000; font-weight: bold;');
        });
        // Patch 98: the endless mode's entry points are gated on a first Architect kill,
        // which is a ~40-minute prerequisite to reproduce by hand. Sets the same field
        // the real kill sets, so this exercises the genuine gate rather than bypassing
        // it — and refreshes both entry points immediately, which is also a live check
        // that the refresh is wired to something.
        document.getElementById('dev-btn-force-recursion').addEventListener('click', () => {
            saveManager.metaState.killCounts.ARCHITECT = Math.max(1, saveManager.metaState.killCounts.ARCHITECT || 0);
            saveManager.saveGame();
            refreshRecursionEntries();
            console.log(`%c DEV: killCounts.ARCHITECT forced to ${saveManager.metaState.killCounts.ARCHITECT} — THE RECURSION unlocked. `, 'background: #c5a059; color: #000; font-weight: bold;');
        });
        document.getElementById('dev-btn-dump-builds').addEventListener('click', () => {
            const log = saveManager.getRunBuildLog();
            console.log(`%c DEV: ${log.length} logged run build(s). `, 'background: #c5a059; color: #000; font-weight: bold;');
            console.table(log.map(entry => ({
                floor: entry.floor,
                level: entry.levels,
                weapons: Object.entries(entry.weapons).map(([id, lvl]) => `${id} L${lvl}`).join(', '),
                boons: entry.boons.join(', '),
                synergies: entry.synergies.join(', '),
                curses: entry.curses.join(', '),
                tokens: entry.tokens.join(', ')
            })));
        });

        // DEV: crash telemetry inspection (Patch 50). The log itself is live in
        // production too — these are just the dev-side readers. In a shipped build
        // the same data is reachable from any console via FRACTURED_ERRORS.dump()
        // / .export(), which is the only way to get it off a real player's device.
        document.getElementById('dev-btn-dump-errors').addEventListener('click', () => {
            const count = errorLog.dump();
            console.log(`%c DEV: ${count} error(s) recorded. FRACTURED_ERRORS.export() for JSON. `, 'background: #c5a059; color: #000; font-weight: bold;');
        });

        // DEV: fires all three capture paths at once so the handlers can be verified
        // end-to-end. Each is deliberately raised the way a REAL one would be —
        // an uncaught async throw, a rejected promise with no .catch, and a throw
        // from inside the game loop's own try/catch — rather than by calling
        // errorLog.capture() directly, which would test nothing but the logger.
        document.getElementById('dev-btn-force-error').addEventListener('click', () => {
            console.log('%c DEV: raising 3 test errors (window / promise / main-loop). ', 'background: #8b0000; color: #fff; font-weight: bold;');
            setTimeout(() => { throw new Error('TEST: uncaught window error'); }, 0);
            Promise.reject(new Error('TEST: unhandled promise rejection'));
            // Consumed by the guard in gameLoop() on the next frame, then cleared,
            // so this throws exactly once rather than wedging the loop.
            window.FRACTURED_FORCE_LOOP_ERROR = true;
            // Auto-dump once all three have landed (the loop throw needs a frame,
            // the rejection a microtask turn), so one click gives a complete,
            // self-contained verification instead of a manual second step.
            setTimeout(() => errorLog.dump(), 500);
        });

        // DEV: loadout testing (Patch 33 follow-up). Reuses addTokenToInventory()
        // exactly as a real drop would (Combat.js's spawnTokenDrop path) — no
        // separate dev-only insertion logic to keep in sync with the real one.
        // Calls uiManager.renderLoadoutUI() directly afterward since neither
        // button naturally triggers a re-render otherwise (same gap the existing
        // +1000 LUCIDITY etc. buttons already have — only fixed here because an
        // inventory tool that doesn't visibly update the grid isn't useful for
        // what it's for).
        document.getElementById('dev-btn-add-one-of-each-token').addEventListener('click', () => {
            const rarities = Object.keys(TOKEN_RARITIES);
            Object.keys(TOKENS).forEach(tokenId => {
                saveManager.addTokenToInventory(tokenId, rarities[Math.floor(Math.random() * rarities.length)]);
            });
            if (uiManager) uiManager.renderLoadoutUI();
            console.log(`%c DEV: added all ${Object.keys(TOKENS).length} tokens to inventory (random rarity each). `, 'background: #c5a059; color: #000; font-weight: bold;');
        });

        document.getElementById('dev-btn-add-random-token').addEventListener('click', () => {
            const tokenIds = Object.keys(TOKENS);
            const rarities = Object.keys(TOKEN_RARITIES);
            const tokenId = tokenIds[Math.floor(Math.random() * tokenIds.length)];
            const rarity = rarities[Math.floor(Math.random() * rarities.length)];
            saveManager.addTokenToInventory(tokenId, rarity);
            if (uiManager) uiManager.renderLoadoutUI();
            console.log(`%c DEV: added ${rarity} ${TOKENS[tokenId].name}. `, 'background: #c5a059; color: #000; font-weight: bold;');
        });

        // --- VISUAL TEST BENCH -------------------------------------------------
        // Spawns entities on demand and pins them into a chosen state, so a visual
        // can be checked without playing until the condition naturally occurs.
        const devSpawnRing = (types, radius) => {
            if (!game || !game.state || !game.director) return;
            const px = game.state.player.x;
            const py = game.state.player.y;
            types.forEach((type, i) => {
                const a = (i / types.length) * Math.PI * 2 - Math.PI / 2;
                game.director.spawnEntity(
                    type, canvas.width, canvas.height,
                    px + Math.cos(a) * radius,
                    py + Math.sin(a) * radius
                );
            });
            console.log(`%c DEV: spawned ${types.join(', ')}. `, 'background: #c5a059; color: #000;');
        };

        document.getElementById('dev-btn-spawn-enemies').addEventListener('click', () => {
            devSpawnRing(['SCAVENGER', 'PREDATOR', 'PARASITE'], 150);
        });

        document.getElementById('dev-btn-spawn-bosses').addEventListener('click', () => {
            devSpawnRing(['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'], 340);
        });

        document.getElementById('dev-btn-clear-entities').addEventListener('click', () => {
            if (!game || !game.state) return;
            // Release back to the pools rather than plain-splicing, or the pools leak.
            for (let i = game.state.entities.length - 1; i >= 0; i--) {
                const ent = game.state.entities[i];
                const pool = game.director && game.director.pools
                    ? game.director.pools[ent.type.toLowerCase()]
                    : null;
                if (pool && typeof pool.release === 'function') pool.release(ent);
                game.state.entities.splice(i, 1);
            }
            game.state.activeBoss = null;
            game.state.bossSpawned = false;
            console.log('%c DEV: cleared all entities. ', 'background: #c5a059; color: #000;');
        });

        document.getElementById('dev-freeze-entities').addEventListener('change', (e) => {
            if (!game || !game.state) return;
            game.state.devFreezeEntities = e.target.checked;
            console.log(`%c DEV: enemy AI ${e.target.checked ? 'FROZEN' : 'RUNNING'}. `, 'background: #c5a059; color: #000;');
        });

        document.getElementById('dev-telemetry-enabled').addEventListener('change', (e) => {
            if (!game || !game.state) return;
            game.state.devTelemetryEnabled = e.target.checked;
            console.log(`%c DEV: telemetry overlay ${e.target.checked ? 'ON' : 'OFF'}. `, 'background: #c5a059; color: #000;');
        });

        document.getElementById('dev-btn-apply-scenario').addEventListener('click', () => {
            if (!game || !game.state || !game.state.entities) return;
            const scenario = document.getElementById('dev-scenario-select').value;

            game.state.entities.forEach(ent => {
                if (scenario === 'FLASH') {
                    ent.flashTime = 999;
                    return;
                }
                ent.flashTime = 0;

                const pick = (idle, telegraph, attack) =>
                    scenario === 'TELEGRAPH' ? telegraph : (scenario === 'ATTACK' ? attack : idle);

                switch (ent.type) {
                    case 'SCAVENGER':
                        ent.vacuumState = pick('hunting', 'hunting', 'vacuuming');
                        break;
                    case 'PREDATOR':
                        ent.attackState = pick('hunting', 'telegraphing', 'lunging');
                        ent.attackTimer = 30;
                        ent.lungeVx = 1; ent.lungeVy = 0;
                        break;
                    case 'PARASITE':
                        ent.lashingState = pick('searching', 'searching', 'lashing');
                        ent.lashTimer = 15;
                        ent.lashTarget = scenario === 'ATTACK'
                            ? { x: ent.x + 90, y: ent.y - 40, hp: 100, buffed: false }
                            : null;
                        break;
                    case 'BOSS':
                        ent.pulseState = pick('hunting', 'charging', 'pulsing');
                        ent.pulseTimer = 30;
                        ent.pulseRadius = ent.maxPulseRadius * 0.6;
                        break;
                    case 'RORSCHACH':
                        ent.shootState = pick('hunting', 'telegraphing', 'telegraphing');
                        ent.shootTimer = 20;
                        ent.shootAngle = 0;
                        break;
                    case 'PANOPTICON':
                        ent.gazeState = pick('moving', 'charging', 'sweeping');
                        ent.gazeAngle = 0;
                        break;
                    case 'AMALGAMATION':
                        ent.actionState = pick('resting', 'pulling', 'spawning');
                        break;
                    case 'ARCHITECT':
                        ent.actionState = pick('hovering', 'charging_collapse', 'collapse_active');
                        break;
                }
            });
            console.log(`%c DEV: applied scenario ${scenario} to ${game.state.entities.length} entities. `, 'background: #c5a059; color: #000;');
        });
    }
    // --- NEW: SETTINGS MENU INJECTION (THEME ALIGNED) ---
    if (!document.getElementById('settings-modal')) {
        // The Settings Modal
        const settingsUI = document.createElement('div');
        settingsUI.id = 'settings-modal';
        settingsUI.className = 'fullscreen-menu';
        settingsUI.style.display = 'none';
        settingsUI.style.zIndex = '10000';
        settingsUI.innerHTML = `
            <!-- max-height + the scrolling folder-content below: the two volume rows
                 added in Patch 80 push this panel past a landscape phone's 390px of
                 height, and .medical-folder has no overflow rule of its own — the same
                 way the level-up modal clipped its cards off screen before Patch 67. -->
            <div class="medical-folder" style="height: auto; max-height: 90vh; max-width: 500px; border-color: var(--ink-black);">
                <div class="folder-header" style="justify-content: center; border-bottom-color: var(--ink-black);">
                    <div class="title-typewriter" style="font-size: 2rem;">SYSTEM SETTINGS</div>
                </div>
                <div class="folder-content" style="display: flex; flex-direction: column; gap: 20px; align-items: flex-start; overflow-y: auto;">
                    <label for="slider-music" style="color: var(--ink-black); font-weight: bold; font-size: 1.2rem;">Music &amp; Ambience Volume</label>
                    <div class="setting-row" style="margin-top: -12px;">
                        <input type="range" class="setting-slider" id="slider-music" min="0" max="100" step="1" value="100">
                        <span class="setting-value" id="value-music">100%</span>
                    </div>
                    <p class="typewriter-text" style="color: #666; font-size: 0.9rem; margin-top: -15px;">The menu theme, the room drone, and the constant hum. Set to 0% for silence.</p>

                    <label for="slider-sfx" style="color: var(--ink-black); font-weight: bold; font-size: 1.2rem;">Sound Effects Volume</label>
                    <div class="setting-row" style="margin-top: -12px;">
                        <input type="range" class="setting-slider" id="slider-sfx" min="0" max="100" step="1" value="100">
                        <span class="setting-value" id="value-sfx">100%</span>
                    </div>
                    <p class="typewriter-text" style="color: #666; font-size: 0.9rem; margin-top: -15px;">Impacts, footsteps, screams, and the heartbeat. Set to 0% for silence.</p>

                    <label style="color: var(--ink-black); font-weight: bold; font-size: 1.2rem; cursor: pointer; display: flex; align-items: center; gap: 10px;">
                        <input type="checkbox" id="toggle-shake" style="width: 20px; height: 20px; cursor: pointer;">
                        Enable Screen Shake
                    </label>
                    <p class="typewriter-text" style="color: #666; font-size: 0.9rem; margin-top: -15px; margin-left: 30px;">Toggle visual impact vibrations.</p>
                    
                    <label style="color: var(--ink-black); font-weight: bold; font-size: 1.2rem; cursor: pointer; display: flex; align-items: center; gap: 10px;">
                        <input type="checkbox" id="toggle-photo" style="width: 20px; height: 20px; cursor: pointer;"> 
                        Photosensitivity Mode
                    </label>
                    <p class="typewriter-text" style="color: #666; font-size: 0.9rem; margin-top: -15px; margin-left: 30px;">Disables strobing lights, camera flashes, and softens glitch overlays.</p>

                    <label for="select-quality" style="color: var(--ink-black); font-weight: bold; font-size: 1.2rem;">Graphics Quality</label>
                    <select id="select-quality" style="margin-top: -12px; font-family: inherit; font-size: 1rem; padding: 8px; min-height: 44px; background: var(--paper-bg); color: var(--ink-black); border: 1px solid var(--ink-black);">
                        <option value="auto">AUTO (recommended)</option>
                        <option value="high">HIGH</option>
                        <option value="low">LOW (smoother on older devices)</option>
                    </select>
                    <p class="typewriter-text" id="quality-note" style="color: #666; font-size: 0.9rem; margin-top: -15px;">AUTO lowers detail by itself if the game runs slowly.</p>

                    <button class="file-btn primary" id="btn-close-settings" style="margin-top: 20px;">APPLY & CLOSE</button>
                </div>
            </div>
        `;
        document.getElementById('game-container').appendChild(settingsUI);

        // Inject Settings Button into Pause Menu
        const pauseBtnContainer = document.getElementById('btn-awaken').parentNode;
        if (pauseBtnContainer && !document.getElementById('btn-pause-settings')) {
            const pauseSettingsBtn = document.createElement('button');
            pauseSettingsBtn.id = 'btn-pause-settings';
            pauseSettingsBtn.className = 'file-btn';
            pauseSettingsBtn.innerText = 'SYSTEM SETTINGS';
            pauseBtnContainer.appendChild(pauseSettingsBtn);
            
            pauseSettingsBtn.addEventListener('click', () => {
                settingsUI.style.display = 'flex';
            });
        }

        // Inject Settings Button into Main Menu (Clinical Folder)
        const clinicalBtnContainer = document.getElementById('btn-start').parentNode;
        if (clinicalBtnContainer && !document.getElementById('btn-clinical-settings')) {
            const clinicalSettingsBtn = document.createElement('button');
            clinicalSettingsBtn.id = 'btn-clinical-settings';
            clinicalSettingsBtn.className = 'file-btn';
            clinicalSettingsBtn.innerText = 'SYSTEM SETTINGS';
            clinicalBtnContainer.appendChild(clinicalSettingsBtn);
            
            clinicalSettingsBtn.addEventListener('click', () => {
                settingsUI.style.display = 'flex';
            });
        }

        // Inject Settings Button into the Title Screen (Patch 83)
        //
        // The third and final entry point to this same panel, and the one that was
        // missing where it mattered most: playMenuTheme() runs ON the title screen, so
        // the music behind two player complaints in two days — one reporting a headache
        // — was playing on the only screen with no way to adjust it. The player's
        // choices were to start a run they did not want, or to go into the clinical
        // folder to escape the sound.
        //
        // Built by injection here rather than as static markup in index.html so all
        // three entry points are constructed identically and all three open THIS
        // settingsUI element. A fourth button written into index.html would have needed
        // its own listener wiring — a second way of opening one panel, which is how the
        // two copies drift apart later.
        //
        // Appended AFTER btn-title-hub, so the reading order stays
        // (RESUME) -> BEGIN DESCENT -> MIND HUB -> SYSTEM SETTINGS: BEGIN DESCENT keeps
        // its position as the obvious primary action, and the two secondary entries sit
        // together beneath it. Patch 52 collapsed this screen to one tap on purpose and
        // that is not disturbed.
        const titleHubBtn = document.getElementById('btn-title-hub');
        const titleBtnContainer = titleHubBtn ? titleHubBtn.parentNode : null;
        if (titleBtnContainer && !document.getElementById('btn-title-settings')) {
            const titleSettingsBtn = document.createElement('button');
            titleSettingsBtn.id = 'btn-title-settings';
            titleSettingsBtn.className = 'file-btn';
            titleSettingsBtn.innerText = 'SYSTEM SETTINGS';
            // Matches MIND HUB's secondary convention (the title screen styles its
            // buttons inline, unlike the pause/folder containers where a bare .file-btn
            // is already the local convention) — same width/padding/size/opacity, so it
            // reads as the same tier and neither competes with BEGIN DESCENT.
            titleSettingsBtn.style.width = 'auto';
            titleSettingsBtn.style.padding = '10px 34px';
            titleSettingsBtn.style.fontSize = '0.95rem';
            titleSettingsBtn.style.opacity = '0.85';
            // The one deliberate deviation from MIND HUB. Those inline values compute to
            // roughly 41px tall, just under the 44px touch-target floor, and this button
            // exists FOR the player who is uncomfortable and wants out — it must not be
            // fiddly to hit. min-height rather than more padding so the visual weight
            // stays identical to its sibling on desktop, where it already clears 44px.
            titleSettingsBtn.style.minHeight = '44px';
            titleBtnContainer.appendChild(titleSettingsBtn);

            titleSettingsBtn.addEventListener('click', () => {
                settingsUI.style.display = 'flex';
            });
        }

        // Patch 97 — THE RECURSION, on the title screen.
        //
        // Same injection convention as SYSTEM SETTINGS directly above, and for the same
        // reason: built here rather than written into index.html so there is one
        // construction site and one handler, and it lands before `new UIManager` so
        // attachEvents()'s .file-btn sweep gives it hover/click SFX for free.
        //
        // Inserted BEFORE MIND HUB so the reading order is
        // (RESUME) -> BEGIN DESCENT -> THE RECURSION -> MIND HUB -> SYSTEM SETTINGS:
        // it belongs with the things that start a run, not with the management screens.
        // Styled to the same secondary convention as its two neighbours, so BEGIN
        // DESCENT keeps its position as the obvious primary action — Patch 52 collapsed
        // this screen to one tap deliberately and that is not disturbed.
        //
        // Visibility is decided in refreshTitleActions(), not here: this block runs once
        // at boot, and the Architect can fall during the session that follows.
        if (titleBtnContainer && titleHubBtn && !document.getElementById('btn-title-endless')) {
            const titleEndlessBtn = document.createElement('button');
            titleEndlessBtn.id = 'btn-title-endless';
            titleEndlessBtn.className = 'file-btn';
            titleEndlessBtn.innerText = 'THE RECURSION';
            titleEndlessBtn.style.width = 'auto';
            titleEndlessBtn.style.padding = '10px 34px';
            titleEndlessBtn.style.fontSize = '0.95rem';
            titleEndlessBtn.style.opacity = '0.85';
            titleEndlessBtn.style.minHeight = '44px';   // touch-target floor, as above
            // Label, colour, border and disabled state are all decided by
            // refreshRecursionEntries — it runs at boot and again on every title
            // refresh, so this starts hidden and is never left in a stale state.
            titleEndlessBtn.style.display = 'none';
            titleBtnContainer.insertBefore(titleEndlessBtn, titleHubBtn);

            titleEndlessBtn.addEventListener('click', () => {
                // Patch 101: locked, this is the tease rather than a dead click. This is
                // also the real gate on launching a run — the button is deliberately not
                // `disabled`, so nothing else stops a locked player getting through.
                if (!isRecursionUnlocked(saveManager.metaState)) {
                    showRecursionSealedNotice();
                    return;
                }
                // A suspended run is real progress and this button starts a NEW one, so
                // it asks first — the same rule and the same dialog BEGIN DESCENT uses.
                const suspended = refreshTitleActions();
                const launch = () => {
                    if (audioEngine) audioEngine.stopMenuTheme();
                    resumeAudioForGameplay();
                    clearSuspendedRun();
                    startEndlessRun();
                };
                if (suspended) {
                    showConfirm({
                        title: 'ABANDON PROTOCOL?',
                        body: `A suspended protocol is on file — ${suspended}.`,
                        note: 'Entering the Recursion discards it. Banked Lucidity and all meta-progression are untouched.',
                        confirmLabel: 'ENTER THE RECURSION',
                        cancelLabel: 'KEEP IT',
                        onConfirm: launch
                    });
                } else {
                    launch();
                }
            });
        }

        const toggleShake = document.getElementById('toggle-shake');
        const togglePhoto = document.getElementById('toggle-photo');

        toggleShake.checked = gameSettings.screenShake;
        togglePhoto.checked = gameSettings.photosensitive;

        // Patch 115: graphics tier. Applied immediately on change (like the sliders), so
        // the player can see the difference without closing the panel.
        const selectQuality = document.getElementById('select-quality');
        const qualityNote = document.getElementById('quality-note');
        const paintQualityNote = () => {
            if (!qualityNote) return;
            qualityNote.innerText = gameSettings.quality === 'auto'
                ? `AUTO lowers detail by itself if the game runs slowly. Currently: ${(gameSettings.autoQuality || 'high').toUpperCase()}.`
                : 'Fixed by you. AUTO lets the game choose.';
        };
        if (selectQuality) {
            selectQuality.value = ['auto', 'high', 'low'].includes(gameSettings.quality) ? gameSettings.quality : 'auto';
            paintQualityNote();
            selectQuality.addEventListener('change', () => {
                gameSettings.quality = selectQuality.value;
                // Choosing AUTO again gives the device a fresh evaluation.
                if (gameSettings.quality === 'auto') { gameSettings.autoQuality = 'high'; qualityProbe.done = false; }
                applyQualityTier();
                saveSettings();
                paintQualityNote();
            });
        }

        // --- VOLUME SLIDERS (Patch 80) ---
        // Applied and persisted on 'input', not on APPLY & CLOSE like the toggles.
        // Both are deliberate. A player reaching this panel because the audio is
        // hurting them needs the change to take effect while they are still dragging,
        // otherwise they cannot tell what they are choosing; and persisting live means
        // closing the tab from a painful screen still keeps the setting, rather than
        // greeting them with full volume next session.
        const sliderMusic = document.getElementById('slider-music');
        const sliderSfx = document.getElementById('slider-sfx');
        const valueMusic = document.getElementById('value-music');
        const valueSfx = document.getElementById('value-sfx');

        if (sliderMusic && sliderSfx) {
            const paint = () => {
                valueMusic.innerText = `${Math.round(safeVolume(gameSettings.musicVolume) * 100)}%`;
                valueSfx.innerText = `${Math.round(safeVolume(gameSettings.sfxVolume) * 100)}%`;
            };
            sliderMusic.value = String(Math.round(safeVolume(gameSettings.musicVolume) * 100));
            sliderSfx.value = String(Math.round(safeVolume(gameSettings.sfxVolume) * 100));
            paint();

            sliderMusic.addEventListener('input', () => {
                gameSettings.musicVolume = safeVolume(Number(sliderMusic.value) / 100);
                applyAudioSettings();
                paint();
                saveSettings();
            });

            sliderSfx.addEventListener('input', () => {
                gameSettings.sfxVolume = safeVolume(Number(sliderSfx.value) / 100);
                applyAudioSettings();
                paint();
                saveSettings();
            });

            // An audible reference for the SFX slider once the drag ends. On 'change'
            // rather than 'input' so dragging does not machine-gun the sample, and
            // skipped at 0 where the point is that nothing plays.
            sliderSfx.addEventListener('change', () => {
                if (audioEngine && gameSettings.sfxVolume > 0) audioEngine.playSFX('ui_click');
            });
        }

        document.getElementById('btn-close-settings').addEventListener('click', () => {
            gameSettings.screenShake = toggleShake.checked;
            gameSettings.photosensitive = togglePhoto.checked;
            saveSettings();
            settingsUI.style.display = 'none';
        });

        // Patch 97 — THE RECURSION, in the clinical folder beside AUTHORIZE DESCENT.
        //
        // The second of the two surfaces the mode is reachable from, covering "goes back
        // to the mind hub" the same way the title button covers "awakens". Injected next
        // to #btn-start rather than written into index.html, for the same reasons as the
        // title button — one construction site, free .file-btn SFX, and index.html stays
        // shut (it is on the fragile-file list).
        //
        // It calls the SAME startEndlessRun() the title button does, so the two routes
        // cannot produce differently-set-up runs. Visibility is refreshed on every
        // folder open, not decided here, because the Architect can fall mid-session.
        const hubStartBtn = document.getElementById('btn-start');
        if (hubStartBtn && hubStartBtn.parentNode && !document.getElementById('btn-start-endless')) {
            const hubEndlessBtn = document.createElement('button');
            hubEndlessBtn.id = 'btn-start-endless';
            hubEndlessBtn.className = 'file-btn';
            hubEndlessBtn.style.minHeight = '44px';
            // As on the title screen: refreshRecursionEntries owns the label and state,
            // and runs on every folder open.
            hubEndlessBtn.style.display = 'none';
            // After AUTHORIZE DESCENT: the normal descent stays the primary action.
            hubStartBtn.parentNode.insertBefore(hubEndlessBtn, hubStartBtn.nextSibling);

            hubEndlessBtn.addEventListener('click', () => {
                // Same as the title entry — see the note there.
                if (!isRecursionUnlocked(saveManager.metaState)) {
                    showRecursionSealedNotice();
                    return;
                }
                const suspended = refreshTitleActions();
                const launch = () => {
                    if (audioEngine) audioEngine.stopMenuTheme();
                    clearSuspendedRun();
                    startEndlessRun();
                };
                if (suspended) {
                    showConfirm({
                        title: 'ABANDON PROTOCOL?',
                        body: `A suspended protocol is on file — ${suspended}.`,
                        note: 'Entering the Recursion discards it. Banked Lucidity and all meta-progression are untouched.',
                        confirmLabel: 'ENTER THE RECURSION',
                        cancelLabel: 'KEEP IT',
                        onConfirm: launch
                    });
                } else {
                    launch();
                }
            });
        }

        // --- PHASE 2: HUB INTERACTION EVENT LISTENERS ---
        const interactionPrompt = document.getElementById('interaction-prompt');
        const interactionText = document.getElementById('prompt-text');
        const btnCloseFolder = document.getElementById('btn-close-folder');

        if (interactionPrompt) {
            const triggerInteraction = () => {
                if (gameState === 'HUB' && game.hubWorld && game.hubWorld.activeZone) {
                    const zone = game.hubWorld.activeZone;
                    
                    // Switch to the correct HTML tab based on which desk/bed you interacted with!
                    const tabBtns = document.querySelectorAll('.tab-btn');
                    const tabPanes = document.querySelectorAll('.tab-pane');
                    tabBtns.forEach(b => b.classList.remove('active'));
                    tabPanes.forEach(p => p.classList.remove('active'));
                    
                    const targetBtn = document.querySelector(`.tab-btn[data-target="${zone.action}"]`);
                    const targetPane = document.getElementById(zone.action);
                    
                    if (targetBtn) targetBtn.classList.add('active');
                    if (targetPane) targetPane.classList.add('active');

                    if (zone.action === 'tab-loadout' && uiManager) uiManager.renderLoadoutUI();
                    
                    document.getElementById('clinical-folder-menu').style.display = 'flex';

                    // Patch 97: re-checked on every open, so a first Architect kill
                    // reveals ENTER THE RECURSION on the very next visit to the hub
                    // rather than on the next page load.
                    refreshRecursionEntries();

                    // Patch 87: bring the activated tab into view. The strip scrolls
                    // horizontally on a phone (8 tabs, ~1000px of them against a 390px
                    // screen), so a tab opened from a hub zone can be entirely off
                    // screen — the trophies desk activates tab-trophies, SIXTH of eight,
                    // which left the player looking at a strip of three other tabs with
                    // none of them highlighted.
                    //
                    // Must run AFTER the folder is displayed: scrollIntoView is a no-op
                    // on an element inside a `display: none` ancestor, so doing this up
                    // with the classList work above would silently do nothing.
                    // `inline: 'center'` rather than 'nearest' so the neighbouring tabs
                    // show too — that is also what tells the player the strip scrolls.
                    // `block: 'nearest'` keeps it from scrolling anything vertically.
                    if (targetBtn && typeof targetBtn.scrollIntoView === 'function') {
                        try {
                            targetBtn.scrollIntoView({ inline: 'center', block: 'nearest' });
                        } catch (e) { /* pre-options implementations; the tab is still active */ }
                    }

                    interactionPrompt.style.display = 'none';
                    if (audioEngine) audioEngine.playSFX('ui_click');
                    inputManager.hideJoysticks();
                    gameState = 'MENU';
                }
            };

            window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'e') triggerInteraction(); });
            interactionPrompt.addEventListener('click', triggerInteraction);
            interactionPrompt.addEventListener('touchstart', (e) => { e.preventDefault(); triggerInteraction(); });
        }

        if (btnCloseFolder) {
            btnCloseFolder.addEventListener('click', () => {
                document.getElementById('clinical-folder-menu').style.display = 'none';
                if (audioEngine) audioEngine.playSFX('ui_click');
                gameState = 'HUB';
                // Patch 92: the folder is where Lucidity gets spent, so this is the
                // first non-gameplay moment after the purchase that can cross the
                // Patient Level 2 threshold. Fires at most once, ever.
                maybeShowBackupPrompt();
            });
        }
    }

    saveManager = new SaveManager();
    inputManager = new InputManager(canvas);
    renderer = new Renderer(canvas, ctx);
    audioEngine = new AudioEngine();
    // Push the persisted volumes in BEFORE preload() builds the graph, so the buses
    // are created at the player's level. Doing it after would open every session at
    // full volume for the moments until this ran — which for the players this patch
    // is for is the entire problem.
    applyAudioSettings();
    game = new Game();
    levelUpUI = new LevelUpUI(audioEngine, saveManager);

    game.audioEngine = audioEngine;
    applyQualityTier();   // Patch 115: renderer + Director caps from the saved tier

    // V2 plan G1: a DEV-ONLY inspection hook for the headless Playwright checks
    // (entity/orb counts, sprite-cache size, driving a death). `import.meta.env.DEV` is
    // statically false in `vite build`, so this whole block is dropped from every
    // shipped bundle — same guarantee as the dev panel.
    if ((import.meta.env.DEV || import.meta.env.MODE === 'playtest')) {
        window.__fractured = {
            get game() { return game; },
            get renderer() { return renderer; },
            get saveManager() { return saveManager; },
            get gameState() { return gameState; },
            setQuality(q) { gameSettings.quality = q; applyQualityTier(); },   // Patch 115
            get qualityTier() { return currentQualityTier(); },
            get qualitySetting() { return gameSettings.quality; }   // Patch 120
        };
        // Patch 120: the on-screen perf panel, playtest builds only. MODE is a string
        // literal after Vite's replacement, so every other build drops this branch and
        // never emits the chunk.
        if (import.meta.env.MODE === 'playtest') {
            import('./dev/PerfOverlay.js').then(m => m.installPerfOverlay()).catch(() => {});
        }
    }

    // Patch 49: respect the platform's own mute setting (distinct from Patch 47's
    // ad-muting — see AudioEngine.setMuted's reason-tracking). No-ops off-portal.
    portalSDK.onPlatformMuteChange((muted) => {
        audioEngine.setMuted('platform', muted);
    });

    // Patch 50: show the signed-in portal player as the case file's subject. Fires
    // once now and again if they sign in mid-session. Guests and off-portal builds
    // simply never get a user, and the markup's default "UNIDENTIFIED" stands — which
    // is deliberately in-theme rather than an empty or broken-looking field.
    portalSDK.onUserChange((user) => {
        const nameEl = document.getElementById('patient-name');
        const avatarEl = document.getElementById('patient-avatar');
        if (!nameEl) return;
        if (user && user.username) {
            nameEl.textContent = user.username;
            if (avatarEl && user.profilePictureUrl) {
                // Only reveal the avatar once it has actually decoded, so a blocked or
                // 404'd portrait leaves no broken-image glyph on the folder.
                avatarEl.onload = () => { avatarEl.style.display = 'block'; };
                avatarEl.onerror = () => { avatarEl.style.display = 'none'; };
                avatarEl.src = user.profilePictureUrl;
            }
        } else {
            nameEl.textContent = 'UNIDENTIFIED';
            if (avatarEl) { avatarEl.style.display = 'none'; avatarEl.removeAttribute('src'); }
        }
    });

    // Start downloading audio IMMEDIATELY, not on the INITIALIZE click. The platform
    // measures load time from page load until loadingStop(), so kicking the download
    // off from the click made the player's own idle time on the title screen count as
    // loading. preload() only builds the graph and decodes (legal on a suspended
    // context); playback still waits for the gesture in audioEngine.init().
    // The deferred ~4.3MB drone starts only after the window closes.
    portalSDK.loadingStart();
    audioEngine.preload().then(() => {
        portalSDK.loadingStop();
        audioEngine.loadDeferredAssets();
    });

    // Patch 52: the hub's AUTHORIZE DESCENT and the title screen's BEGIN DESCENT are
    // now literally the same code path (see startNewRun). The menu theme is already
    // running on this route, so it is stopped directly rather than through
    // resumeAudioForGameplay's init-then-stop chain, which exists for the title
    // screen's cold start where the AudioContext has never been resumed.
    uiManager = new UIManager(saveManager, audioEngine, () => {
        if (audioEngine) audioEngine.stopMenuTheme();
        startNewRun();
    });

    game.init(saveManager); // Initialize everything silently in the background

    const resumeBtn = document.getElementById('btn-resume-run');
    if (resumeBtn) {
        // Patch 52: shares resumeSuspendedRun() with the title screen's RESUME
        // DESCENT, so the two resume buttons cannot diverge. A false return means the
        // saved run was missing or corrupt (and has been discarded), so the button
        // hides rather than sitting there doing nothing when clicked.
        resumeBtn.addEventListener('click', () => {
            if (audioEngine) audioEngine.stopMenuTheme();
            if (!resumeSuspendedRun()) resumeBtn.style.display = 'none';
        });
    }

    if (readSuspendedRun() && resumeBtn) {
        resumeBtn.style.display = 'block';
    }

    document.getElementById('btn-restart').addEventListener('click', () => {
        document.getElementById('death-screen').style.display = 'none';
        // Patch 47b: interstitial on the death -> summary -> hub transition. The
        // player has already stopped here, which is the pacing CrazyGames asks for.
        // NEVER mid-run. Off-portal showMidgameAd() invokes its completion callback
        // synchronously, so this is a plain function call with no ad and no delay.
        //
        // Patch 104: a run that was revived by a rewarded ad ends WITHOUT a midgame ad
        // (CrazyGames: never a midgame plus a "watch to keep playing" offer between the
        // same two levels). The 5-minute cooldown in showAdThen applies on top.
        const revived = !!(game.state && game.state.reviveUsed);
        deathSettlement = null;
        const rewardBox = document.getElementById('death-rewarded');
        if (rewardBox) rewardBox.style.display = 'none';
        showAdThen(() => {
            game.init(saveManager);
            game.state.player.x = 0;
            game.state.player.y = 0;
            if (audioEngine) audioEngine.playMenuTheme();
            gameState = 'HUB';
        }, { allowAd: !revived });
    });

    // Patch 104: rewarded offers on the death screen.
    const btnRevive = document.getElementById('btn-revive');
    const btnRecover = document.getElementById('btn-recover-lucidity');
    if (btnRevive) btnRevive.addEventListener('click', () => runDeathReward('revive'));
    if (btnRecover) btnRecover.addEventListener('click', () => runDeathReward('recover'));
    
    // --- TITLE SCREEN ACTIONS (Patch 52) ---
    //
    // Assets are already downloading/decoded from page load (see the preload call
    // above), so these handlers only resume the suspended AudioContext on a real
    // user gesture. No loading happens here, and time spent sitting on the title
    // screen is not counted as load time.
    const btnTitleBegin = document.getElementById('btn-title-begin');
    const btnTitleResume = document.getElementById('btn-title-resume');
    const btnTitleHub = document.getElementById('btn-title-hub');

    if (btnTitleBegin) {
        btnTitleBegin.addEventListener('click', () => {
            // A suspended run is real progress, and on mobile this button sits directly
            // under RESUME DESCENT — so starting fresh asks first, naming exactly what
            // would be lost. Matches the existing WIPE CLINICAL FILE confirm convention.
            // Meta-progression is never touched by either answer.
            const suspended = refreshTitleActions();
            if (suspended) {
                showConfirm({
                    title: 'ABANDON PROTOCOL?',
                    body: `A suspended protocol is on file — ${suspended}.`,
                    note: 'Beginning a new descent abandons that session permanently. Your banked Lucidity, tokens, Patient Level and Synapse records are NOT affected.',
                    confirmLabel: 'ABANDON & BEGIN ANEW',
                    cancelLabel: 'RETURN',
                    onConfirm: () => {
                        clearSuspendedRun();
                        refreshTitleActions();
                        resumeAudioForGameplay();
                        startNewRun();
                    }
                });
                return;
            }
            resumeAudioForGameplay();
            startNewRun();
        });
    }

    if (btnTitleResume) {
        btnTitleResume.addEventListener('click', () => {
            resumeAudioForGameplay();
            // Returns false when the saved run turned out to be corrupt; it has been
            // discarded and the title actions refreshed, so the player is left on a
            // title screen that now honestly shows no resume option.
            resumeSuspendedRun();
        });
    }

    if (btnTitleHub) {
        btnTitleHub.addEventListener('click', () => {
            // The hub keeps the menu theme — it IS a menu, so unlike the two buttons
            // above, init()'s own playMenuTheme() is exactly what is wanted here.
            if (audioEngine) audioEngine.init();
            enterMindHub();
        });
    }

    refreshTitleActions();

    // Patch 92: first-run retention notice. Wired here with the other title-screen
    // actions, and shown immediately — it is a bar at the bottom of the viewport, so
    // it neither gates nor delays anything above it.
    const btnStorageAck = document.getElementById('btn-storage-notice-ack');
    if (btnStorageAck) {
        btnStorageAck.addEventListener('click', () => {
            // Acknowledged only on this explicit tap. Starting a run without reading
            // it leaves the flag unset, so it returns next cold load — see
            // SaveManager.acknowledgeStorageNotice for why that is the right default.
            saveManager.acknowledgeStorageNotice();
            hideStorageNotice();
            if (audioEngine) audioEngine.playSFX('ui_click');
        });
    }
    showStorageNoticeIfNeeded();

    // --- AUTO-SAVE ON UNCLEAN EXIT (Patch 54) ---
    //
    // Three listeners, because no single one is reliable where it matters. On mobile
    // — the majority of this game's traffic — a tab is very often never "unloaded"
    // at all: the OS backgrounds and later discards it, and `beforeunload` simply
    // never fires. `pagehide` is the dependable signal there, and `visibilitychange`
    // catches the earlier moment the player switches away, which is the last point
    // we are guaranteed to still be running. beforeunload is kept for desktop.
    //
    // Re-firing is harmless: autoSaveRun() writes the same key with current state
    // and is a no-op outside PLAYING/PAUSED, so there is no double-save to avoid.
    window.addEventListener('pagehide', autoSaveRun);
    window.addEventListener('beforeunload', autoSaveRun);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') autoSaveRun();
    });

    // Patch 105 (V2 plan A4): a hidden tab is silent. Uses AudioEngine.setMuted's
    // reason tracking ('hidden'), so it composes with the 'ad' and 'platform' mutes —
    // coming back never un-mutes audio that the portal or an ad still holds muted.
    //
    // Auto-pause is OFF-PORTAL ONLY. CrazyGames: "Don't call [gameplayStop] when the
    // user switches focus or leaves the game area (we handle this on our side)", and
    // our PAUSED state emits gameplayStop through syncPortalGameplayState. Off-portal
    // (itch.io / self-hosted) a returning player would otherwise land mid-combat; the
    // simulation itself already stops while hidden (no rAF), so on the portal they
    // resume exactly where they left, just with sound restored.
    document.addEventListener('visibilitychange', () => {
        const hidden = document.visibilityState === 'hidden';
        if (audioEngine) audioEngine.setMuted('hidden', hidden);
        if (hidden && !portalSDK.available && gameState === 'PLAYING') togglePause();
    });

    const pauseMenu = document.getElementById('pause-menu');
    const pauseTitle = document.getElementById('pause-title');
    const btnDescend = document.getElementById('btn-descend');

    function togglePause() {
        if (gameState === 'PLAYING') {
            gameState = 'PAUSED';
            pauseTitle.innerText = "PROTOCOL SUSPENDED";
            pauseTitle.style.color = "var(--ink-black)";
            document.getElementById('pause-desc').innerText = "The nightmare pauses, but it does not end.";
            btnDescend.style.display = 'none';
            pauseMenu.style.display = 'flex';
            inputManager.hideJoysticks();
        } else if (gameState === 'PAUSED') {
            gameState = 'PLAYING';
            pauseMenu.style.display = 'none';
        }
    }

    document.getElementById('btn-pause').addEventListener('click', togglePause);
    // Escape also exits browser fullscreen, so the player can get both effects
    // at once there. P is offered as a fullscreen-safe alternate; Escape stays
    // bound because players expect it (Patch 45).
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key.toLowerCase() === 'p') togglePause(); });

    // Patch 105 (V2 plan A5): during live play, keys the game owns must not also do
    // their browser default. Space would "press" whatever button still holds focus
    // (e.g. a mouse-clicked PAUSE button: dash -> pause), and Space/arrows scroll the
    // host page around an iframe embed. Scoped to PLAYING so menus keep native
    // keyboard navigation (Tab/Space/Enter on buttons).
    const GAMEPLAY_OWNED_KEYS = new Set([' ', 'Spacebar', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    window.addEventListener('keydown', (e) => {
        if (gameState === 'PLAYING' && GAMEPLAY_OWNED_KEYS.has(e.key)) e.preventDefault();
    });
    // A pointer-activated button gives focus back immediately, so it cannot be
    // re-triggered by the next Space/Enter. `e.detail > 0` means a real mouse/touch
    // click; keyboard activation (detail 0) keeps focus, preserving keyboard
    // navigation and the :focus-visible ring.
    document.addEventListener('click', (e) => {
        if (e.detail > 0 && e.target && typeof e.target.closest === 'function') {
            const btn = e.target.closest('button');
            if (btn && typeof btn.blur === 'function') btn.blur();
        }
    }, true);
    document.getElementById('btn-unpause').addEventListener('click', togglePause);

    document.getElementById('btn-awaken').addEventListener('click', () => {
        const isMidFloor = (gameState === 'PAUSED');
        const isExitReached = (gameState === 'EXIT_REACHED');

        let earnedLucidity = 0;
        let retainedTokens = [];
        let suspendBanked = 0;   // Patch 108: what a mid-floor Awaken actually banked

        if (isExitReached) {
            saveManager.logRunBuild(buildDiversitySnapshot(game));

            earnedLucidity = Math.floor(game.state.lucidity * (game.state.lucidityBonusMultiplier || 1));
            retainedTokens = game.state.runInventory || [];
            saveManager.addLucidity(earnedLucidity);
            saveManager.markFirstEscape();

            if (retainedTokens.length > 0) {
                const tokenKeys = Object.keys(TOKENS);
                retainedTokens = retainedTokens.map(rarity => {
                    const randomTokenKey = tokenKeys[Math.floor(Math.random() * tokenKeys.length)];
                    saveManager.addTokenToInventory(randomTokenKey, rarity);
                    return { name: TOKENS[randomTokenKey].name, rarity: rarity };
                });
            }
        } else if (isMidFloor) {
            suspendBanked = Math.floor(game.state.lucidity * (game.state.lucidityBonusMultiplier || 1));
            saveManager.addLucidity(suspendBanked);
            const stateToSave = game.getCarriedState();
            // Patch 108 (V2 plan A8): the Lucidity double-bank. That Lucidity is now in
            // the bank, so the suspended run carries none of it — otherwise suspend ->
            // resume -> Awaken paid the same Lucidity out again on every cycle (a known
            // issue since Patch 54). XP, level, weapons, floor and room still carry, so
            // the run itself resumes exactly as it was; only the already-paid currency
            // is spent. Death (50%) and extraction (100%) after a resume therefore pay
            // out only what was earned SINCE the resume.
            stateToSave.lucidity = 0;
            writeSuspendedRun(JSON.stringify(stateToSave));

            const resumeBtn = document.getElementById('btn-resume-run');
            if (resumeBtn) resumeBtn.style.display = 'block';
        }

        let tokenHtml = "";
        if (retainedTokens.length > 0) {             
            tokenHtml = `<br><br><span style="color:var(--ui-gold);">DECRYPTED TOKENS:</span><br>` + 
                        retainedTokens.map(t => `<span class="rarity-${t.rarity}">${t.name} (${t.rarity})</span>`).join('<br>');
        }

        if (isExitReached) {
            clearSuspendedRun();
            const resumeBtn = document.getElementById('btn-resume-run');
            if (resumeBtn) resumeBtn.style.display = 'none';
        }

        pauseMenu.style.display = 'none';
        document.getElementById('ui-layer').style.display = 'none';
        // Patch 104: AWAKEN reuses the death screen; its rewarded offers are death-only.
        const awakenRewardBox = document.getElementById('death-rewarded');
        if (awakenRewardBox) awakenRewardBox.style.display = 'none';
        deathSettlement = null;
        document.getElementById('death-screen').style.display = 'flex';
        
        const deathScreen = document.getElementById('death-screen');
        const folder = deathScreen.querySelector('.medical-folder');
        const header = deathScreen.querySelector('.folder-header');
        const title = deathScreen.querySelector('.title-typewriter');
        const btn = document.getElementById('btn-restart');

        if (isExitReached) {
            if (folder) folder.style.borderColor = 'var(--ui-gold)';
            if (header) header.style.borderBottomColor = 'var(--ui-gold)';
            if (title) {
                title.style.color = 'var(--ui-gold)';
                title.innerText = 'CONSCIOUSNESS RETAINED';
            }
            if (btn) btn.innerText = 'REVIEW CLINICAL FILE';

            document.getElementById('final-stats').innerHTML = `
                Safely extracted from <strong>Floor ${game.state.floor}</strong>.<br><br>
                Earned <strong>${earnedLucidity}</strong> Lucidity.<br>
                Retained <strong>100%</strong> of gathered resources.<br>
                Total Banked: <strong>${saveManager.metaState.lucidityBank}</strong>
                ${tokenHtml}
                ${buildRunSummaryHtml(game)}
            `;
        } else {
            if (folder) folder.style.borderColor = 'var(--ui-red)';
            if (header) header.style.borderBottomColor = 'var(--ui-red)';
            if (title) {
                title.style.color = 'var(--ui-red)';
                title.innerText = 'SESSION SUSPENDED';
            }
            if (btn) btn.innerText = 'RETURN TO WARD';

            // Patch 108: this screen used to say "Earned 0 Lucidity (Aborted) /
            // Retained 0%", while the handler above had in fact banked all of it and
            // saved the run for RESUME DESCENT. Say what actually happened.
            document.getElementById('final-stats').innerHTML = `
                Session suspended on <strong>Floor ${game.state.floor}</strong>.<br><br>
                Banked <strong>${suspendBanked}</strong> Lucidity.<br>
                Your descent is saved: <strong>RESUME DESCENT</strong> picks it up from this room.<br>
                Total Banked: <strong>${saveManager.metaState.lucidityBank}</strong>
                ${buildRunSummaryHtml(game)}
            `;
        }

        inputManager.hideJoysticks();
        if (audioEngine) audioEngine.stop();
        gameState = 'DEAD'; 
    });

    document.getElementById('btn-descend').addEventListener('click', () => {
      // Patch 104: a floor transition is a CrazyGames-sanctioned midgame slot. Gated by
      // the 5-minute cooldown in showAdThen, so most descents still show nothing.
      showAdThen(() => {
        const carryData = game.getCarriedState();
        carryData.floor += 1;
        // Patch 53: a NEW floor always starts at room 1. getCarriedState() now
        // carries the current roomNumber (so suspend/resume keeps your place), and
        // you only ever reach this button by clearing the boss in the LAST room —
        // so without this reset the next floor would inherit roomNumber 10, and
        // Director.spawnRoom would see `roomNumber >= maxRoomsPerFloor` and drop its
        // boss on the player in what should have been the opening room.
        carryData.roomNumber = 1;

        if (carryData.floor > saveManager.metaState.maxFloorReached) {
            saveManager.metaState.maxFloorReached = carryData.floor;
            saveManager.saveGame();
        }

        game.init(saveManager, carryData);
        game.state.player.x = canvas.width / 2;
        game.state.player.y = canvas.height / 2;
        pauseMenu.style.display = 'none';
        gameState = 'PLAYING';
      });
    });

    game.onDeath = () => {
        gameState = 'DEAD';
        // Patch 54: the run is over, so its autosave must go with it. Before this
        // patch nothing wrote a suspended run mid-floor, so death had nothing to
        // clean up; now that autoSaveRun() persists one continuously, leaving it
        // behind would let a player die and then RESUME DESCENT straight back into
        // the run they just lost — death would cost nothing at all.
        clearSuspendedRun();
        saveManager.recordRunStat('deaths');   // Patch 59
        document.getElementById('ui-layer').style.display = 'none';
        document.getElementById('death-screen').style.display = 'flex';
        document.getElementById('glitch-overlay').style.opacity = '0';
        
        saveManager.logRunBuild(buildDiversitySnapshot(game));

        const recovered = Math.floor(game.state.lucidity * 0.5 * (game.state.lucidityBonusMultiplier || 1));
        saveManager.addLucidity(recovered);
        if (audioEngine) audioEngine.stop(); 

        let tokenHtml = "";
        if (game.state.runInventory && game.state.runInventory.length > 0) {
            const tokenKeys = Object.keys(TOKENS);
            const decrypted = game.state.runInventory.map(rarity => {
                const randomTokenKey = tokenKeys[Math.floor(Math.random() * tokenKeys.length)];
                saveManager.addTokenToInventory(randomTokenKey, rarity);
                return { name: TOKENS[randomTokenKey].name, rarity: rarity };
            });
            tokenHtml = `<br><br><span style="color:var(--ui-gold);">DECRYPTED TOKENS:</span><br>` + 
                        decrypted.map(t => `<span class="rarity-${t.rarity}">${t.name} (${t.rarity})</span>`).join('<br>');
            game.state.runInventory = []; 
        }

        const deathScreen = document.getElementById('death-screen');
        const folder = deathScreen.querySelector('.medical-folder');
        const header = deathScreen.querySelector('.folder-header');
        const title = deathScreen.querySelector('.title-typewriter');
        const btn = document.getElementById('btn-restart');

        if (folder) folder.style.borderColor = 'var(--ui-red)';
        if (header) header.style.borderBottomColor = 'var(--ui-red)';
        if (title) {
            title.style.color = 'var(--ui-red)';
            title.innerText = 'MIND BROKEN';
        }
        if (btn) btn.innerText = 'RECONSTRUCT FILE';

        // Patch 104: what this death banked and lost, for the rewarded offers.
        deathSettlement = {
            recovered,
            lost: Math.max(0, Math.floor(game.state.lucidity - recovered)),
            floor: game.state.floor
        };
        setupDeathRewards();

        document.getElementById('final-stats').innerHTML = `
            Died on <strong>Floor ${game.state.floor}</strong>.<br><br>
            Earned <strong>${game.state.lucidity}</strong> Lucidity.<br>
            Lost to the Void: <strong>${game.state.lucidity - recovered}</strong>.<br>
            Total Banked: <strong>${saveManager.metaState.lucidityBank}</strong>
            ${tokenHtml}
            ${buildRunSummaryHtml(game)}
        `;
        inputManager.hideJoysticks();

        // Patch 92: the run is resolved and the summary is on screen — a genuine
        // stopping point, and the second of the two safe moments to offer a backup.
        // After the stats are written so the dialog sits over a complete summary.
        maybeShowBackupPrompt();

        if (import.meta.env.DEV && window.FRACTURED_DEV_MODE && game.state.devTelemetryEnabled && game.state.telemetry) {
            const tel = game.state.telemetry;
            console.log('%c DEV: RUN TELEMETRY (death) ', 'background: #c5a059; color: #000; font-weight: bold;');
            console.log({
                firstBoonAt_s: tel.firstBoonAt === null ? null : +(tel.firstBoonAt / 1000).toFixed(1),
                firstBossAt_s: tel.firstBossAt === null ? null : +(tel.firstBossAt / 1000).toFixed(1),
                sanityLowWater: Math.floor(tel.sanityLowWater),
                roomClearTimes_s: tel.roomClearTimes.map(ms => +(ms / 1000).toFixed(1)),
                damagePerRoom: tel.damagePerRoom.map(d => Math.floor(d))
            });
        }
    };

    game.onLevelUp = () => {
        if (gameState === 'DEAD') return;
        gameState = 'LEVEL_UP';
        inputManager.keys = { w: false, a: false, s: false, d: false, space: false }; 
        inputManager.updateKeyboardInput();
        audioEngine.playSFX('levelup');
        levelUpUI.show(game, () => {
            if (game.state && game.state.telemetry && game.state.telemetry.firstBoonAt === null) {
                game.state.telemetry.firstBoonAt = performance.now() - game.state.telemetry.runStartWallClock;
            }
            gameState = 'PLAYING';
        });
    };

    game.onFloorComplete = () => {
        gameState = 'EXIT_REACHED';
        maybeHappytimeForBossKill(game.state.floor);   // Patch 104
        pauseTitle.innerText = "THE DESCENT CALLS";
        pauseTitle.style.color = "var(--ui-red)";
        
        if (game.state.floor >= 5) {
            // Patch 59: a full clear. Recorded the moment the Architect falls rather
            // than at the Awaken that follows, because the run IS completed here —
            // the player could close the tab on this screen and it would still be a
            // finished run. Latched on state so a re-entry into EXIT_REACHED (the
            // handler is a callback, not a one-shot) cannot count the same clear twice.
            //
            // Patch 93: that latch now also has to survive a FLOOR BOUNDARY, because
            // there is one past floor 5 for the first time. It rides getCarriedState()
            // through game.init() — see the note there. Without that, every endless
            // floor cleared would bank another "construct escaped".
            if (!game.state.runCompletionRecorded) {
                game.state.runCompletionRecorded = true;
                saveManager.recordRunStat('runsCompleted');
                // The first clear. Still the victory it always was — the Recursion is
                // offered, never imposed, and AWAKEN banks everything exactly as before.
                document.getElementById('pause-desc').innerText =
                    `You have conquered the nightmare. The Architect has fallen — and the construct begins to rebuild itself around you. Awaken with your Lucidity, or follow it down?`;
            } else if (game.state.floor % 5 === 0) {
                // A cycle closed: the Architect has fallen again, deeper down.
                document.getElementById('pause-desc').innerText =
                    `Cycle ${cycleLabel(game.state.floor)} is complete. The Architect falls again, and again the construct rebuilds. Awaken, or continue into Cycle ${cycleLabel(game.state.floor + 1)}?`;
            } else {
                document.getElementById('pause-desc').innerText =
                    `You survived Floor ${game.state.floor}, deep in Cycle ${cycleLabel(game.state.floor)}. Awaken with your Lucidity, or descend further?`;
            }
        } else {
            document.getElementById('pause-desc').innerText = `You survived Floor ${game.state.floor}. Awaken with your Lucidity, or risk descending deeper into the nightmare?`;
        }

        // Patch 93: THE seam this feature opens. This used to be
        // `btnDescend.style.display = 'none'; // No floor 6 yet!` on the floor-5
        // branch. There is a floor 6 now, and every floor after it.
        btnDescend.style.display = 'block';

        document.getElementById('btn-unpause').style.display = 'none'; 
        pauseMenu.style.display = 'flex';
        inputManager.hideJoysticks();
    };

    requestAnimationFrame(gameLoop);
}

// Patch 50: distinct main-loop crash messages already printed to the console this
// session. Bounded so a crash whose message embeds varying data (a coordinate, a
// frame number) can't grow this without limit. Console-only — ErrorLog does its own
// independent, capped bookkeeping.
const loggedLoopCrashes = new Set();
const MAX_LOGGED_LOOP_CRASHES = 20;

/**
 * Patch 74 — fixed timestep. The rules live in src/core/Pacing.js (and are tested in
 * test_pacing.js); this is just the instance the loop drives.
 *
 * Simulation runs at a fixed 60Hz while rendering stays at the display's rate, so
 * every existing per-frame constant in the game remains valid and nothing needed
 * retuning. Before this, the whole simulation ran at whatever rate the panel
 * refreshed — double speed on a 120Hz phone, and varying with the framerate whenever
 * such a device could not hold it.
 */
const pacing = new Pacing();
let lastBreakdown = false;
// Patch 114: what the last drawn frame was drawn for (see the draw skip in gameLoop).
let lastDrawSizeKey = '';
let lastDrawState = '';

// Patch 120: the inspection hook and loop timing exist in dev AND in the `playtest`
// build (npm run build:playtest), which ships the on-screen perf panel for testing on
// real phones. The condition is written out INLINE at each site, deliberately not
// hoisted into a const: Vite replaces `import.meta.env.*` with literals and the
// minifier folds the inline form to `false` and drops the branch, but it does not
// fold through a module-level const, which shipped the (inert) hook to players.

function gameLoop(time) {
    // G2 instrumentation (dev only, stripped from builds): CPU time spent inside one
    // loop iteration — simulation + render — independent of vsync quantisation, for
    // qa/soak_check.cjs. Frame-to-frame intervals only move in 16.7 ms steps.
    const loopT0 = (import.meta.env.DEV || import.meta.env.MODE === 'playtest') ? performance.now() : 0;
    try {
        // Accumulate before anything else, so a slow branch below cannot lose time.
        pacing.addFrame(time);

        syncPortalGameplayState();
        syncPortalContext();   // Patch 119

        if (import.meta.env.DEV) {
        // Patch 50: one-shot in-loop throw for the FORCE TEST ERROR button. Cleared
        // before throwing, so the loop's catch records it once and the next frame
        // runs normally. Stripped entirely from production builds with this block.
        if (window.FRACTURED_FORCE_LOOP_ERROR) {
            window.FRACTURED_FORCE_LOOP_ERROR = false;
            throw new Error('TEST: main-loop crash');
        }

        const devModeContainer = document.getElementById('dev-mode-container');
        if (devModeContainer) {
            // PLAYING included so the visual test bench (spawn / freeze / scenario)
            // is reachable mid-run, which is the only place entities actually exist.
            const shouldShowDevPanel = window.FRACTURED_DEV_MODE && (gameState === 'TITLE' || gameState === 'MENU' || gameState === 'HUB' || gameState === 'PLAYING');
            devModeContainer.style.display = shouldShowDevPanel ? 'block' : 'none';
        }

        // DEV: run telemetry overlay (Patch 13).
        const telemetryOverlayEl = document.getElementById('dev-telemetry-overlay');
        if (telemetryOverlayEl) {
            const showTelemetry = window.FRACTURED_DEV_MODE && gameState === 'PLAYING'
                && game.state && game.state.devTelemetryEnabled && game.state.telemetry;
            telemetryOverlayEl.style.display = showTelemetry ? 'block' : 'none';
            if (showTelemetry) {
                const tel = game.state.telemetry;
                const fmt = (ms) => ms === null ? '—' : (ms / 1000).toFixed(1) + 's';
                const clears = tel.roomClearTimes.map(ms => (ms / 1000).toFixed(1)).join(', ') || '—';
                const dmg = tel.damagePerRoom.map(d => Math.floor(d)).join(', ') || '—';
                telemetryOverlayEl.innerText =
                    `RUN TELEMETRY\n` +
                    `first boon: ${fmt(tel.firstBoonAt)}\n` +
                    `first boss: ${fmt(tel.firstBossAt)}\n` +
                    `sanity low: ${Math.floor(tel.sanityLowWater)}\n` +
                    `room clears (s): ${clears}\n` +
                    `dmg/room: ${dmg}`;
            }
        }
        }

        if (gameState === 'MENU' || gameState === 'TITLE') {
            renderer.drawMenuBackground(time, gameState);
        } 
        else if (gameState === 'PLAYING' || gameState === 'LEVEL_UP' || gameState === 'PAUSED' || gameState === 'EXIT_REACHED' || gameState === 'HUB') {
            
            inputManager.updateAimAngle(game.state.player.x, game.state.player.y);

            // Patch 69: hand the simulation the camera's real zoom before it runs.
            // Director derives viewHalfExtent/viewSafeRadius from it, and those drive
            // the enemy leash and the tutorial's spawn distance — all of which were
            // computing against a hardcoded 1.3 that only desktop ever uses. Written
            // here rather than inside Renderer because the renderer does not own
            // simulation state, and re-written every frame because Game.init rebuilds
            // state from scratch on every run and floor descent.
            game.state.viewZoom = renderer.zoom;

            // Patch 84: published the same way and for the same reason as viewZoom
            // above — Tutorial.js is a pure reducer over game.state with no
            // InputManager reference, which is what lets test_tutorial.js drive the
            // real module without a canvas. Its MOVE/DASH give-up budgets are
            // device-aware, so it needs the mode on state.
            //
            // Written every frame, not once: getInputMode() is itself live (a
            // touchscreen laptop flips to 'keyboard' the moment a real key is pressed),
            // and Game.init rebuilds state from scratch on every run and floor descent.
            // It must land BEFORE the simulation steps below, which is where
            // Tutorial.update runs.
            game.state.inputMode = inputManager.getInputMode();

            // Patch 71: the WORLD viewport, not the canvas. Identical to canvas
            // width/height on every layout except portrait, where the bottom band is
            // reserved for the player's thumbs and shows no world — so spawn rings and
            // leash thresholds must not count it as visible space.
            const viewW = Number.isFinite(renderer.worldViewWidth) ? renderer.worldViewWidth : canvas.width;
            const viewH = Number.isFinite(renderer.worldViewHeight) ? renderer.worldViewHeight : canvas.height;

            // Patch 74 — fixed timestep. Rules and rationale in src/core/Pacing.js.
            const simSteps = pacing.takeSteps();
            renderer.simStepsThisFrame = simSteps;

            for (let s = 0; s < simSteps; s++) {
                // gameState is READ FRESH each iteration on purpose: onLevelUp and
                // onDeath fire from inside update() and change it, and Game.update
                // early-returns for any state that is not PLAYING or HUB. Capturing it
                // once would run a second step of a run that has already ended.
                lastBreakdown = game.update(inputManager.state, viewW, viewH, gameState);
            }
            const isBreakdown = lastBreakdown;
            
            // --- PHASE 2: HUB INTERACTION & PLAYER ROTATION ---
            if (gameState === 'HUB') {
                if (game.hubWorld) {
                    const interactionPrompt = document.getElementById('interaction-prompt');
                    const promptText = document.getElementById('prompt-text');
                    if (game.hubWorld.activeZone) {
                        interactionPrompt.style.display = 'block';
                        promptText.innerText = game.hubWorld.activeZone.prompt;
                        interactionPrompt.style.borderColor = game.hubWorld.activeZone.color;
                        interactionPrompt.style.color = game.hubWorld.activeZone.color;
                    } else {
                        interactionPrompt.style.display = 'none';
                    }
                }
                
                // Unify player rotation inside the Hub World based on mouse aim angle
                if (game.state && game.state.player) {
                    let diff = inputManager.state.aimAngle - game.state.player.angle;
                    if (Number.isFinite(diff)) {
                        while (diff < -Math.PI) diff += Math.PI * 2;
                        while (diff > Math.PI) diff -= Math.PI * 2;
                        game.state.player.angle += diff * 0.25;
                    }
                }
            }

            if (gameState === 'PLAYING') {
                // --- APPLY ACCESSIBILITY CLAMPS BEFORE RENDERING ---
                if (game.state) {
                    if (!gameSettings.screenShake && game.state.cameraShake > 0) {
                        game.state.cameraShake = 0; // Hard clamp shake
                    }
                    if (gameSettings.photosensitive) {
                        game.state.cameraFlash = 0; // Disable full screen strobes (e.g. Polaroid)
                        if (game.state.player) game.state.player.flashTime = 0; // Disable player hit flashing
                        if (game.state.entities) {
                            game.state.entities.forEach(e => e.flashTime = 0); // Disable enemy hit flashing
                        }
                    }
                }

                const sanityBar = document.getElementById('sanity-bar');
                let ratio = game.state.sanity / game.state.player.maxHp;
                if (!Number.isFinite(ratio)) ratio = 0;
                hudStyle(sanityBar, 'width', hudPct(Math.max(0, ratio)));
                
                if (isBreakdown) { hudStyle(sanityBar, 'backgroundColor', 'var(--ui-red)'); hudStyle(sanityBar, 'boxShadow', '0 0 15px var(--ui-red)'); }
                else if (ratio < 0.3) { hudStyle(sanityBar, 'backgroundColor', '#ffaa00'); hudStyle(sanityBar, 'boxShadow', '0 0 10px #ffaa00'); }
                else { hudStyle(sanityBar, 'backgroundColor', 'var(--hud-green)'); hudStyle(sanityBar, 'boxShadow', '0 0 10px var(--hud-green)'); }
                
                const dashBar = document.getElementById('dash-bar');
                if (dashBar && game.state.player.dash) {
                    const dashReady = game.state.player.dash.cooldown <= 0;
                    hudStyle(dashBar, 'width', dashReady ? '100%' : hudPct(1 - (game.state.player.dash.cooldown / 90)));
                    hudStyle(dashBar, 'background', dashReady ? '#88aaff' : '#555');
                }

                const conBar = document.getElementById('convergence-bar');
                const conText = document.getElementById('convergence-text');
                const conContainer = document.querySelector('.convergence-section');
                
                const activeBoss = game.state.activeBoss;

                if (activeBoss) {
                    let hpRatio = Math.max(0, activeBoss.hp / activeBoss.maxHp);
                    hudStyle(conBar, 'width', hudPct(hpRatio));
                    
                    let bossName = 'SUBJECT: SPHERE HEAD';
                    if (activeBoss.type === 'RORSCHACH') bossName = 'SUBJECT: RORSCHACH';
                    if (activeBoss.type === 'PANOPTICON') bossName = 'SUBJECT: THE PANOPTICON';
                    if (activeBoss.type === 'AMALGAMATION') bossName = 'SUBJECT: THE AMALGAMATION';
                    if (activeBoss.type === 'ARCHITECT') bossName = 'SUBJECT: THE ARCHITECT';

                    hudText(conText, `${bossName} - VITAL SIGNS: ${Math.ceil(hpRatio * 100)}%`);
                    hudStyle(conBar, 'background', 'linear-gradient(90deg, #8b0000, #ff0000)');
                    hudStyle(conText, 'color', 'var(--ui-red)');
                    hudStyle(conContainer, 'borderColor', 'var(--ui-red)');
                    hudStyle(conContainer, 'boxShadow', '0 0 20px rgba(139, 0, 0, 0.8)');
                } else if (conBar && game.state.maxRoomsPerFloor) {
                    let bossRatio = Math.min(1, game.state.roomNumber / game.state.maxRoomsPerFloor);
                    hudStyle(conBar, 'width', hudPct(bossRatio));
                    hudText(conText, bossRatio >= 1 ? "ANOMALY DETECTED" : `NIGHTMARE PROGRESS: ${Math.floor(bossRatio * 100)}%`);
                    
                    if (bossRatio >= 1) {
                        hudStyle(conBar, 'background', 'var(--ui-gold)');
                        hudStyle(conText, 'color', 'var(--ui-gold)');
                        hudStyle(conText, 'textShadow', '0 0 10px var(--ui-gold)');
                        hudStyle(conContainer, 'borderColor', 'var(--ui-gold)');
                        hudStyle(conContainer, 'boxShadow', '0 0 15px var(--ui-gold)');
                    } else {
                        hudStyle(conBar, 'background', 'linear-gradient(90deg, #555, #aaa)');
                        hudStyle(conText, 'color', 'rgba(255,255,255,0.7)');
                        hudStyle(conText, 'textShadow', '1px 1px 0 #000');
                        hudStyle(conContainer, 'borderColor', '#555');
                        hudStyle(conContainer, 'boxShadow', '0 0 15px rgba(0, 0, 0, 0.5)');
                    }
                }

                const enemyCounter = document.getElementById('enemy-counter');
                if (enemyCounter) {
                    if (game.state.combatActive && !activeBoss) {
                        let totalRemaining = game.state.enemyBudget + game.state.entities.length;
                        hudText(enemyCounter, `NIGHTMARES LEFT: ${totalRemaining}`);
                        hudStyle(enemyCounter, 'display', 'block');
                    } else {
                        hudStyle(enemyCounter, 'display', 'none');
                    }
                }

                // Smoothly dim glitch overlay if photosensitive mode is active
                let targetGlitchOpacity = isBreakdown ? '1' : '0';
                if (isBreakdown && gameSettings.photosensitive) targetGlitchOpacity = '0.3'; 
                hudStyle(document.getElementById('glitch-overlay'), 'opacity', targetGlitchOpacity);
                
                // Patch 98: the cycle is named on floors 6+ only, so the Cycle I HUD is
                // byte-identical to before. Without it the readout says FLOOR 13 with
                // the Wastes on screen and nothing connects the two.
                const floorReadout = isEndless(game.state.floor)
                    ? `CYCLE ${cycleLabel(game.state.floor)} - FLOOR: ${game.state.floor} - ROOM: ${game.state.roomNumber}`
                    : `FLOOR: ${game.state.floor} - ROOM: ${game.state.roomNumber}`;
                hudHtml(document.getElementById('score'), `LUCIDITY: ${game.state.lucidity} <br> ${floorReadout}`);

                // Patch 25: screen-fixed tutorial banner, driven off the same
                // state.isTutorial gate Director.spawnRoom/Combat.js already use.
                // Purely presentational — doesn't touch the tutorialCompleted flow.
                //
                // Patch 65: the three inline strings (all of them WASD/mouse/SPACE, all
                // shown by inspecting state here) are gone. The banner now renders one
                // line chosen by the Tutorial step machine, in the control scheme the
                // player is actually using — resolved every frame, so a laptop with a
                // touchscreen follows whichever input was last touched.
                const tutorialBanner = document.getElementById('tutorial-banner');
                const tutorialBannerText = document.getElementById('tutorial-banner-text');
                if (tutorialBanner && tutorialBannerText) {
                    const tutorialLine = Tutorial.bannerCopy(game.state, inputManager.getInputMode());
                    if (tutorialLine) {
                        // Patch 66: restart the fade whenever the line changes, so a new
                        // instruction is visibly new. The class has to be removed and a
                        // reflow forced before re-adding, or the animation never
                        // re-triggers. It runs at most once per tutorial step.
                        if (tutorialBannerText.textContent !== tutorialLine) {   // Patch 117: textContent, no forced layout
                            tutorialBannerText.textContent = tutorialLine;
                            tutorialBanner.classList.remove('tut-in');
                            void tutorialBanner.offsetWidth;
                            tutorialBanner.classList.add('tut-in');
                        }
                        hudStyle(tutorialBanner, 'display', 'block');
                    } else {
                        hudStyle(tutorialBanner, 'display', 'none');
                    }
                }
            }
            
            // Patch 114 (V2 plan B6): skip the draw on a frame where no simulation step
            // ran. The sim is a fixed 60 Hz (Patch 74) with no interpolation, so on a
            // 120/144 Hz screen roughly half the frames would redraw an identical world
            // — full-screen fills, fog, the light mask — for nothing, costing battery
            // and heat on exactly the phones that have such screens. The canvas keeps
            // its last image. Always drawn when the canvas was resized (which clears
            // it) or the game state changed, so a transition never shows a stale frame.
            const sizeKey = canvas.width + 'x' + canvas.height;
            const mustDraw = simSteps > 0 || sizeKey !== lastDrawSizeKey || gameState !== lastDrawState;
            if (mustDraw) {
                lastDrawSizeKey = sizeKey;
                lastDrawState = gameState;
                // Send the gameState so the renderer knows to bypass the Void code!
                renderer.drawGame(game.state, audioEngine, gameState);
                probeQualityOnDraw(time);   // Patch 115/120
            }
        }
    } catch (e) {
        // Patch 50: this catch is why the platform's gameplay crash rate has been
        // undiagnosable — it swallows every in-run throw and lets the loop keep
        // running, so nothing ever reaches window.onerror. Recording it here is the
        // single highest-value capture point in the codebase. Repeats of the same
        // throw collapse into one counted entry (see ErrorLog.capture), so a
        // per-frame failure logs once with a count rather than 60 times a second.
        // Recorded BEFORE anything is printed, so a failure in the console call
        // itself can't cost us the record.
        errorLog.capture(e, 'main-loop');

        // The console side is deliberately NOT console.error any more. Called from
        // inside the rAF chain, console.error makes Chrome print its full async
        // causality stack — hundreds of "requestAnimationFrame / gameLoop" frames
        // for a SINGLE crash, and at 60fps that buries devtools completely (it
        // also swamped the Patch 50 verification pass). console.log carries no
        // async stack, so the real synchronous stack — where it actually threw —
        // is printed explicitly instead, once per distinct message. Later repeats
        // are silent here but still counted in the log; FRACTURED_ERRORS.dump()
        // is the complete picture.
        const key = (e && e.message) ? String(e.message) : String(e);
        if (!loggedLoopCrashes.has(key) && loggedLoopCrashes.size < MAX_LOGGED_LOOP_CRASHES) {
            loggedLoopCrashes.add(key);
            console.log(
                '%c MAIN LOOP CRASH %c ' + key + '\n' + ((e && e.stack) ? e.stack : '(no stack)') +
                '\n(repeats of this one are silenced — FRACTURED_ERRORS.dump() for the full log)',
                'background:#8b0000; color:#fff; font-weight:bold;', 'color:#ff8888;'
            );
        }
    }
    if ((import.meta.env.DEV || import.meta.env.MODE === 'playtest') && window.__fractured) {
        const ring = window.__fractured.loopMs || (window.__fractured.loopMs = []);
        ring.push(performance.now() - loopT0);
        if (ring.length > 4000) ring.splice(0, ring.length - 4000);
    }
    requestAnimationFrame(gameLoop);
}

// Patch 47: boot AFTER the portal has resolved, so SaveManager's constructor reads
// from the cloud backend when one exists rather than racing it and reading a stale
// local copy. The promise is memoized (the probe started at the top of this file),
// never rejects, and self-limits to INIT_TIMEOUT_MS, so an absent or hanging SDK
// delays boot by at most that timeout and then runs exactly as before.
portalSDK.init().then(() => {
    // Patch 51b: without a 2D context there is no game to boot — Renderer's
    // constructor would throw and every later symptom (dead title button, blank
    // canvas) would look like an unexplained hang. Fail loudly and in-voice
    // instead, and record it so the load-path crash rate has a name attached.
    if (!canvas || !ctx) {
        errorLog.capture(
            { message: 'boot aborted: 2D canvas context unavailable' },
            'boot'
        );
        showFatalBootError();
        return;
    }
    initEngine();
    console.log("FRACTURED Engine Online.");
});