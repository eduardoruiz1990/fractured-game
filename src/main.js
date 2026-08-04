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
import { errorLog } from './core/ErrorLog.js';

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

function resize() {
    if (!canvas) return;
    // Patch 51d: clamped to >= 1. A canvas sized 0 in either axis — which happens
    // when the portal's iframe is laid out at zero (hidden tab, mid-orientation
    // change, some in-app webviews) — makes every drawImage(lightCanvas) throw
    // InvalidStateError, once per frame, freezing the screen while the game keeps
    // running. updateZoom() already guards the same zero case explicitly, so it is
    // known to occur; the render path simply never got the same treatment.
    canvas.width = Math.max(1, window.innerWidth);
    canvas.height = Math.max(1, window.innerHeight);
    // Refit the camera: on small viewports a fixed zoom showed far too little world.
    // Guarded because resize() also runs once before the Renderer exists.
    if (renderer) renderer.updateZoom();
}
window.addEventListener('resize', resize);
resize();

// --- PORTAL SDK (Patch 44) ---
// Start probing as early as possible. init() never rejects, is memoized, and every
// portal method stays a no-op unless it resolves to a live portal. Patch 47 makes
// the bootstrap at the bottom of this file WAIT on this same promise, because
// SaveManager reads the save in its constructor and the portal's cloud-save backend
// is only readable once the SDK has initialized.
portalSDK.init();

// Which gameStates count as "gameplay" for the portal's gameplayStart/Stop events.
// DECISION (Patch 44): only an actual run counts. The Mind Palace HUB is canvas-
// rendered and walkable, but it is where the player shops, equips tokens and buys
// tree nodes — menu behaviour — so it is deliberately EXCLUDED, matching the SDK
// docs' guidance that menus are a gameplay break.
const PORTAL_GAMEPLAY_STATES = new Set(['PLAYING']);
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
function showAdThen(next) {
    if (portalLastGameplay) {
        portalLastGameplay = false;
        portalSDK.gameplayStop();
    }

    portalSDK.showMidgameAd({
        onStart: () => { if (audioEngine) audioEngine.setMuted('ad', true); },
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

// --- NEW: GLOBAL ACCESSIBILITY SETTINGS ---
let gameSettings = { screenShake: true, photosensitive: false };
try {
    const savedSettings = localStorage.getItem('fractured_settings');
    if (savedSettings) gameSettings = { ...gameSettings, ...JSON.parse(savedSettings) };
} catch(e) { console.warn("Could not load settings."); }

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
            Character Level: <strong>${snap.levels}</strong> &nbsp; Rooms Cleared: <strong>${roomsCleared}</strong> &nbsp; Lowest Grip: <strong>${sanityLow}</strong><br><br>
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

/**
 * In-world confirmation dialog (Patch 52b), replacing window.confirm() for
 * destructive choices. Callback-based rather than a returned promise, because the
 * caller has to be able to simply do nothing on cancel.
 *
 * Falls back to the native confirm() if the markup is somehow absent — losing the
 * dialog entirely would mean silently destroying a run without asking, which is
 * far worse than an ugly prompt.
 */
function showConfirm({ title, body, note, confirmLabel, cancelLabel, onConfirm }) {
    const modal = document.getElementById('confirm-modal');
    const acceptBtn = document.getElementById('btn-confirm-accept');
    const cancelBtn = document.getElementById('btn-confirm-cancel');

    if (!modal || !acceptBtn || !cancelBtn) {
        if (window.confirm(`${body}\n\n${note || ''}`)) onConfirm();
        return;
    }

    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-body').innerText = body;
    document.getElementById('confirm-note').innerText = note || '';
    acceptBtn.innerText = confirmLabel;
    cancelBtn.innerText = cancelLabel;

    const onKey = (e) => {
        // Escape cancels. Safe to bind globally: main.js's own Escape handler only
        // acts on PLAYING/PAUSED, and this dialog is only reachable from TITLE.
        if (e.key === 'Escape') close();
    };
    function close() {
        modal.style.display = 'none';
        window.removeEventListener('keydown', onKey);
    }

    // Assigned with onclick rather than addEventListener so reopening the dialog
    // replaces the handlers instead of stacking a second copy that would fire the
    // destructive action twice. Click SFX comes free — UIManager wires every
    // .file-btn on construction, and these buttons exist in the markup by then.
    acceptBtn.onclick = () => { close(); onConfirm(); };
    cancelBtn.onclick = () => { close(); };
    window.addEventListener('keydown', onKey);

    modal.style.display = 'flex';
}

/** Shared final step for every launch: show the HUD, place the player, start play. */
function enterPlayingState() {
    const titleScreen = document.getElementById('title-screen');
    if (titleScreen) titleScreen.style.display = 'none';
    document.getElementById('clinical-folder-menu').style.display = 'none';
    document.getElementById('ui-layer').style.display = 'flex';

    game.state.player.x = canvas.width / 2;
    game.state.player.y = canvas.height / 2;
    game.state.mapOriginX = game.state.player.x;
    game.state.mapOriginY = game.state.player.y;

    const resumeBtn = document.getElementById('btn-resume-run');
    if (resumeBtn) resumeBtn.style.display = 'none';

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
    enterPlayingState();
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

/** The walkable Mind Hub — the old INITIALIZE destination, now opt-in. */
function enterMindHub() {
    const titleScreen = document.getElementById('title-screen');
    if (titleScreen) titleScreen.style.display = 'none';
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
function refreshTitleActions() {
    const resumeBtn = document.getElementById('btn-title-resume');
    const note = document.getElementById('title-suspended-note');
    const raw = readSuspendedRun();

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

function initEngine() {
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
            <div class="medical-folder" style="height: auto; max-width: 500px; border-color: var(--ink-black);">
                <div class="folder-header" style="justify-content: center; border-bottom-color: var(--ink-black);">
                    <div class="title-typewriter" style="font-size: 2rem;">SYSTEM SETTINGS</div>
                </div>
                <div class="folder-content" style="display: flex; flex-direction: column; gap: 20px; align-items: flex-start;">
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

        const toggleShake = document.getElementById('toggle-shake');
        const togglePhoto = document.getElementById('toggle-photo');
        
        toggleShake.checked = gameSettings.screenShake;
        togglePhoto.checked = gameSettings.photosensitive;

        document.getElementById('btn-close-settings').addEventListener('click', () => {
            gameSettings.screenShake = toggleShake.checked;
            gameSettings.photosensitive = togglePhoto.checked;
            try { localStorage.setItem('fractured_settings', JSON.stringify(gameSettings)); } catch(e) {}
            settingsUI.style.display = 'none';
        });

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
            });
        }
    }

    saveManager = new SaveManager();
    inputManager = new InputManager(canvas);
    renderer = new Renderer(canvas, ctx);
    audioEngine = new AudioEngine();
    game = new Game();
    levelUpUI = new LevelUpUI(audioEngine, saveManager);

    game.audioEngine = audioEngine;

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
        showAdThen(() => {
            game.init(saveManager);
            game.state.player.x = 0;
            game.state.player.y = 0;
            if (audioEngine) audioEngine.playMenuTheme();
            gameState = 'HUB';
        });
    });
    
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
    document.getElementById('btn-unpause').addEventListener('click', togglePause);

    document.getElementById('btn-awaken').addEventListener('click', () => {
        const isMidFloor = (gameState === 'PAUSED');
        const isExitReached = (gameState === 'EXIT_REACHED');

        let earnedLucidity = 0;
        let retainedTokens = [];

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
            saveManager.addLucidity(Math.floor(game.state.lucidity * (game.state.lucidityBonusMultiplier || 1)));
            const stateToSave = game.getCarriedState();
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
                title.innerText = 'PROTOCOL ABORTED';
            }
            if (btn) btn.innerText = 'RETURN TO WARD';

            document.getElementById('final-stats').innerHTML = `
                Cowardice detected on <strong>Floor ${game.state.floor}</strong>.<br><br>
                Earned <strong>0</strong> Lucidity (Aborted).<br>
                Retained <strong>0%</strong> of gathered resources.<br>
                Total Banked: <strong>${saveManager.metaState.lucidityBank}</strong>
                ${buildRunSummaryHtml(game)}
            `;
        }

        inputManager.hideJoysticks();
        if (audioEngine) audioEngine.stop();
        gameState = 'DEAD'; 
    });

    document.getElementById('btn-descend').addEventListener('click', () => {
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

    game.onDeath = () => {
        gameState = 'DEAD';
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

        document.getElementById('final-stats').innerHTML = `
            Died on <strong>Floor ${game.state.floor}</strong>.<br><br>
            Earned <strong>${game.state.lucidity}</strong> Lucidity.<br>
            Lost to the Void: <strong>${game.state.lucidity - recovered}</strong>.<br>
            Total Banked: <strong>${saveManager.metaState.lucidityBank}</strong>
            ${tokenHtml}
            ${buildRunSummaryHtml(game)}
        `;
        inputManager.hideJoysticks();

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
        pauseTitle.innerText = "THE DESCENT CALLS";
        pauseTitle.style.color = "var(--ui-red)";
        
        if (game.state.floor >= 5) {
            document.getElementById('pause-desc').innerText = `You have conquered the nightmare. The Architect has fallen.`;
            btnDescend.style.display = 'none'; // No floor 6 yet!
        } else {
            document.getElementById('pause-desc').innerText = `You survived Floor ${game.state.floor}. Awaken with your Lucidity, or risk descending deeper into the nightmare?`;
            btnDescend.style.display = 'block'; 
        }
        
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

function gameLoop(time) {
    try {
        syncPortalGameplayState();

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
            const isBreakdown = game.update(inputManager.state, canvas.width, canvas.height, gameState);
            
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
                sanityBar.style.width = Math.max(0, ratio) * 100 + '%';
                
                if (isBreakdown) { sanityBar.style.backgroundColor = 'var(--ui-red)'; sanityBar.style.boxShadow = '0 0 15px var(--ui-red)'; }
                else if (ratio < 0.3) { sanityBar.style.backgroundColor = '#ffaa00'; sanityBar.style.boxShadow = '0 0 10px #ffaa00'; }
                else { sanityBar.style.backgroundColor = 'var(--hud-green)'; sanityBar.style.boxShadow = '0 0 10px var(--hud-green)'; }
                
                const dashBar = document.getElementById('dash-bar');
                if (dashBar && game.state.player.dash) {
                    const dashReady = game.state.player.dash.cooldown <= 0;
                    dashBar.style.width = dashReady ? '100%' : ((1 - (game.state.player.dash.cooldown / 90)) * 100) + '%';
                    dashBar.style.background = dashReady ? '#88aaff' : '#555';
                }

                const conBar = document.getElementById('convergence-bar');
                const conText = document.getElementById('convergence-text');
                const conContainer = document.querySelector('.convergence-section');
                
                const activeBoss = game.state.activeBoss;

                if (activeBoss) {
                    let hpRatio = Math.max(0, activeBoss.hp / activeBoss.maxHp);
                    conBar.style.width = (hpRatio * 100) + '%';
                    
                    let bossName = 'SUBJECT: SPHERE HEAD';
                    if (activeBoss.type === 'RORSCHACH') bossName = 'SUBJECT: RORSCHACH';
                    if (activeBoss.type === 'PANOPTICON') bossName = 'SUBJECT: THE PANOPTICON';
                    if (activeBoss.type === 'AMALGAMATION') bossName = 'SUBJECT: THE AMALGAMATION';
                    if (activeBoss.type === 'ARCHITECT') bossName = 'SUBJECT: THE ARCHITECT';

                    conText.innerText = `${bossName} - VITAL SIGNS: ${Math.ceil(hpRatio * 100)}%`;
                    conBar.style.background = 'linear-gradient(90deg, #8b0000, #ff0000)';
                    conText.style.color = 'var(--ui-red)';
                    conContainer.style.borderColor = 'var(--ui-red)';
                    conContainer.style.boxShadow = '0 0 20px rgba(139, 0, 0, 0.8)';
                } else if (conBar && game.state.maxRoomsPerFloor) {
                    let bossRatio = Math.min(1, game.state.roomNumber / game.state.maxRoomsPerFloor);
                    conBar.style.width = (bossRatio * 100) + '%';
                    conText.innerText = bossRatio >= 1 ? "ANOMALY DETECTED" : `NIGHTMARE PROGRESS: ${Math.floor(bossRatio * 100)}%`;
                    
                    if (bossRatio >= 1) {
                        conBar.style.background = 'var(--ui-gold)';
                        conText.style.color = 'var(--ui-gold)';
                        conText.style.textShadow = '0 0 10px var(--ui-gold)';
                        conContainer.style.borderColor = 'var(--ui-gold)';
                        conContainer.style.boxShadow = '0 0 15px var(--ui-gold)';
                    } else {
                        conBar.style.background = 'linear-gradient(90deg, #555, #aaa)';
                        conText.style.color = 'rgba(255,255,255,0.7)';
                        conText.style.textShadow = '1px 1px 0 #000';
                        conContainer.style.borderColor = '#555';
                        conContainer.style.boxShadow = '0 0 15px rgba(0, 0, 0, 0.5)';
                    }
                }

                const enemyCounter = document.getElementById('enemy-counter');
                if (enemyCounter) {
                    if (game.state.combatActive && !activeBoss) {
                        let totalRemaining = game.state.enemyBudget + game.state.entities.length;
                        enemyCounter.innerText = `NIGHTMARES LEFT: ${totalRemaining}`;
                        enemyCounter.style.display = 'block';
                    } else {
                        enemyCounter.style.display = 'none';
                    }
                }

                // Smoothly dim glitch overlay if photosensitive mode is active
                let targetGlitchOpacity = isBreakdown ? '1' : '0';
                if (isBreakdown && gameSettings.photosensitive) targetGlitchOpacity = '0.3'; 
                document.getElementById('glitch-overlay').style.opacity = targetGlitchOpacity;
                
                document.getElementById('score').innerHTML = `LUCIDITY: ${game.state.lucidity} <br> FLOOR: ${game.state.floor} - ROOM: ${game.state.roomNumber}`;

                // Patch 25: screen-fixed tutorial banner, driven off the same
                // state.isTutorial gate Director.spawnRoom/Combat.js already use.
                // Purely presentational — doesn't touch the tutorialCompleted flow.
                const tutorialBanner = document.getElementById('tutorial-banner');
                const tutorialBannerText = document.getElementById('tutorial-banner-text');
                if (tutorialBanner && tutorialBannerText) {
                    if (game.state.isTutorial) {
                        tutorialBanner.style.display = 'block';
                        if (game.state.roomCleared) {
                            tutorialBannerText.innerText = 'Manifestation eliminated. Step through a door to descend — each door tells you what it holds before you enter.';
                        } else if (game.state.entities && game.state.entities.length > 0) {
                            tutorialBannerText.innerText = 'A Manifestation, given form by your own mind. Defeat it to proceed.';
                        } else {
                            tutorialBannerText.innerText = 'Move with WASD. Aim with your mouse. Press SPACE to dash.';
                        }
                    } else {
                        tutorialBanner.style.display = 'none';
                    }
                }
            }
            
            // Send the gameState so the renderer knows to bypass the Void code!
            renderer.drawGame(game.state, audioEngine, gameState);
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