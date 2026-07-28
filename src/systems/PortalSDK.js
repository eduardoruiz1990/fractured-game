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

class PortalSDK {
    constructor() {
        /** True only when a portal SDK is present AND usable. */
        this.available = false;
        /** 'none' until probed; otherwise the portal's reported environment. */
        this.environment = 'none';
        /** Which portal we resolved to, for logging/diagnostics. */
        this.portal = 'none';
        /** Guards against double-init. */
        this.initialized = false;
        /** Mirrors the portal's gameplay state so we never send a duplicate event. */
        this.gameplayActive = false;
    }

    /**
     * Detect and initialize the host portal. Safe to call once, at startup.
     * Never rejects — a portal failure resolves to a permanently no-op adapter.
     * @returns {Promise<boolean>} whether a live portal was found.
     */
    async init() {
        if (this.initialized) return this.available;
        this.initialized = true;

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
}

export const portalSDK = new PortalSDK();
