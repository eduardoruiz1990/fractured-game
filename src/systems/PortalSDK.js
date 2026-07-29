/**
 * PortalSDK — portal-agnostic adapter around a host platform's game SDK.
 *
 * The rest of the codebase talks to THIS module, never to `window.CrazyGames`
 * directly. All portal-specific knowledge lives here, so adding itch.io or a
 * Steam wrapper later is a change to one file rather than an audit of main.js.
 *
 * Hard requirement: when no portal is present — localhost without the script,
 * itch.io, a blocked/failed CDN load, or a domain where the SDK reports itself
 * as `disabled` — every method is a silent no-op and the game behaves exactly
 * as it did before this module existed. Nothing here may ever throw into the
 * caller, because `gameplayStart`/`gameplayStop` are driven from inside the
 * requestAnimationFrame loop.
 *
 * CrazyGames specifics verified against the live docs (docs.crazygames.com):
 *   - script:  https://sdk.crazygames.com/crazygames-sdk-v3.js
 *   - init:    await window.CrazyGames.SDK.init()   (async; SDK unusable before it resolves)
 *   - probe:   window.CrazyGames.SDK.environment -> 'local' | 'crazygames' | 'disabled'
 *   - events:  window.CrazyGames.SDK.game.gameplayStart() / .gameplayStop()
 * `disabled` is the important one: on that environment the SDK object EXISTS
 * but its calls throw, so presence-checking `window.CrazyGames` alone is not
 * enough — the environment must be read too.
 */

const LIVE_ENVIRONMENTS = ['local', 'crazygames'];

// Boot must not be hostage to a slow or hanging portal script. If the SDK has not
// resolved by this point we give up on it PERMANENTLY (see `_timedOut`) and run as
// if no portal existed. Giving up permanently is deliberate: a late arrival would
// mean the save was already read from localStorage while later writes went to the
// cloud, which on a logged-in CrazyGames account would overwrite the real save with
// a near-empty one. No cloud save is recoverable; a clobbered save is not.
const INIT_TIMEOUT_MS = 3000;

// Pure hang-guard for ad playback. If neither adFinished nor adError ever fires we
// would leave the game muted and paused forever, which is worse than cutting an ad
// short. Comfortably longer than any real ad.
const AD_WATCHDOG_MS = 60000;

class PortalSDK {
    constructor() {
        /** True only when a portal SDK is present AND usable. */
        this.available = false;
        /** 'none' until probed; otherwise the portal's reported environment. */
        this.environment = 'none';
        /** Which portal we resolved to, for logging/diagnostics. */
        this.portal = 'none';
        /** Memoized init promise, so concurrent callers share one probe. */
        this._initPromise = null;
        /** Set if init timed out; a late probe must then never enable the portal. */
        this._timedOut = false;
        /** Mirrors the portal's gameplay state so we never send a duplicate event. */
        this.gameplayActive = false;
        /** True while an ad is on screen. */
        this.adPlaying = false;
    }

    /**
     * Detect and initialize the host portal. Safe to call once, at startup.
     * Never rejects — a portal failure resolves to a permanently no-op adapter.
     * @returns {Promise<boolean>} whether a live portal was found.
     */
    async init() {
        // Memoize the PROMISE, not a boolean. A second caller arriving while the
        // first probe is still in flight must wait for the same result rather than
        // seeing a not-yet-populated `available` and concluding "no portal".
        if (!this._initPromise) {
            this._initPromise = Promise.race([
                this._probe(),
                new Promise(resolve => setTimeout(() => {
                    this._timedOut = true;
                    resolve(false);
                }, INIT_TIMEOUT_MS))
            ]);
        }
        return this._initPromise;
    }

    async _probe() {
        const sdk = (typeof window !== 'undefined'
            && window.CrazyGames
            && window.CrazyGames.SDK) ? window.CrazyGames.SDK : null;

        if (!sdk) {
            // No portal script at all: localhost, itch.io, or the CDN was blocked.
            this.portal = 'none';
            this.environment = 'none';
            this.available = false;
            return false;
        }

        try {
            await sdk.init();
            // Lost the race against INIT_TIMEOUT_MS: the game has already booted and
            // read its save locally. Enabling the portal now would risk overwriting a
            // real cloud save with local state, so stay off for the whole session.
            if (this._timedOut) return false;
            // environment is only meaningful once init() has resolved.
            this.environment = sdk.environment || 'unknown';
            this.available = LIVE_ENVIRONMENTS.includes(this.environment);
            this.portal = this.available ? 'crazygames' : 'none';
        } catch (e) {
            // Init failed (offline, blocked, portal-side error). Degrade silently.
            this.environment = 'error';
            this.available = false;
            this.portal = 'none';
        }

        return this.available;
    }

    /**
     * Player has entered genuinely playable gameplay.
     * Idempotent: repeated calls without an intervening stop are ignored.
     */
    gameplayStart() {
        if (!this.available || this.gameplayActive) return;
        this.gameplayActive = true;
        try {
            window.CrazyGames.SDK.game.gameplayStart();
        } catch (e) {
            // A portal event failing must never interrupt the frame.
        }
    }

    /**
     * Gameplay has broken off — death, pause, level-up modal, or a menu.
     * Idempotent: repeated calls without an intervening start are ignored.
     */
    gameplayStop() {
        if (!this.available || !this.gameplayActive) return;
        this.gameplayActive = false;
        try {
            window.CrazyGames.SDK.game.gameplayStop();
        } catch (e) {
            // A portal event failing must never interrupt the frame.
        }
    }

    // ---------------------------------------------------------------------
    // Persistence (Patch 47a)
    //
    // The CrazyGames data module is a SYNCHRONOUS, localStorage-compatible API
    // (getItem/setItem/removeItem/clear) that transparently syncs across devices
    // for logged-in users and falls back to localStorage for guests. That shape
    // lets it slot in as an alternate backend with no async rewrite of
    // SaveManager. When no portal is present these are plain localStorage calls,
    // i.e. byte-for-byte the behaviour that existed before this patch.
    // ---------------------------------------------------------------------

    /** @returns {object|null} the active storage backend, or null if none works. */
    _storage() {
        if (this.available) {
            try {
                const data = window.CrazyGames.SDK.data;
                if (data) return data;
            } catch (e) {
                // Fall through to localStorage.
            }
        }
        try {
            return (typeof localStorage !== 'undefined') ? localStorage : null;
        } catch (e) {
            return null;   // storage disabled/blocked (private mode, embedded frames)
        }
    }

    getItem(key) {
        try {
            const store = this._storage();
            return store ? store.getItem(key) : null;
        } catch (e) {
            return null;
        }
    }

    setItem(key, value) {
        try {
            const store = this._storage();
            if (store) store.setItem(key, value);
        } catch (e) {
            // Caller (SaveManager) already treats persistence as best-effort.
        }
    }

    removeItem(key) {
        try {
            const store = this._storage();
            if (store) store.removeItem(key);
        } catch (e) {
            // Best-effort, as above.
        }
    }

    // ---------------------------------------------------------------------
    // Video ads (Patch 47b)
    // ---------------------------------------------------------------------

    /**
     * Request a midgame interstitial.
     *
     * `onStart` fires when the ad actually appears (mute + pause there), and
     * `onComplete` fires exactly once afterwards on EVERY path — finished,
     * errored, no portal, thrown, or watchdog — because it is what restores
     * audio and resumes the game. Failing to call it would strand the player in
     * a silent, paused game, so the contract is deliberately total.
     *
     * @param {{onStart?: Function, onComplete?: Function}} callbacks
     */
    showMidgameAd({ onStart, onComplete } = {}) {
        let settled = false;
        let watchdog = null;
        const complete = () => {
            if (settled) return;
            settled = true;
            if (watchdog !== null) clearTimeout(watchdog);
            this.adPlaying = false;
            try { if (onComplete) onComplete(); } catch (e) {}
        };

        // No portal (localhost, itch.io, blocked SDK): there is no ad to show, so
        // resolve immediately and let the game carry on exactly as before.
        if (!this.available) {
            complete();
            return;
        }

        try {
            watchdog = setTimeout(complete, AD_WATCHDOG_MS);
            window.CrazyGames.SDK.ad.requestAd('midgame', {
                adStarted: () => {
                    this.adPlaying = true;
                    try { if (onStart) onStart(); } catch (e) {}
                },
                adFinished: () => complete(),
                // Errors include the routine 'adCooldown' (ads are rate-limited to
                // roughly one per 3 minutes). Not exceptional — just continue.
                adError: () => complete()
            });
        } catch (e) {
            complete();
        }
    }
}

export const portalSDK = new PortalSDK();
