// src/core/ErrorLog.js
/**
 * ErrorLog — best-effort crash/error capture (Patch 50).
 *
 * WHY THIS EXISTS: the CrazyGames dashboard reports aggregate load (1.49%) and
 * gameplay (0.75%) crash rates with no detail whatsoever — no message, no state,
 * no device. This module records what actually threw, on which screen, on what
 * kind of device, so those numbers stop being unattributable.
 *
 * SCOPE / KNOWN LIMIT (stated plainly rather than implied): the sink is this
 * device's own localStorage. That makes crashes reproducible-and-readable on a
 * dev or QA handset, and gives a player-support path ("open the console and run
 * FRACTURED_ERRORS.dump()"). It does NOT ship anything anywhere — there is no
 * field aggregate to read from here. A real analytics sink is a separate,
 * deliberate decision (see the Patch 50 notes in BASIC_LAUNCH_FIX_QUEUE.md).
 *
 * HARD RULES this module obeys, because it runs inside error handling:
 *   - It must never throw. Every public entry point is wrapped; a failure to log
 *     is silently dropped rather than turned into a second error.
 *   - It must never run per frame. Nothing here is called from the game loop
 *     except capture(), and capture() only runs when something already threw.
 *   - It must never clobber existing handlers. It uses addEventListener rather
 *     than assigning window.onerror, so anything else (e.g. the portal SDK) that
 *     installed a handler keeps working.
 *   - It never calls preventDefault, so the browser console still shows the
 *     error exactly as it did before this module existed.
 */

const STORAGE_KEY = 'fractured_errors';

// Caps. A crash inside the render loop can fire 60x/second, so the log is
// deduplicated by signature (see capture) and hard-capped both ways: by entry
// count and by serialized size, since localStorage quota is per-origin and shared
// with the actual save file. The save must never be the thing that fails to write
// because the error log ate the quota.
const MAX_ENTRIES = 30;
const MAX_BYTES = 24000;
const MAX_MSG_CHARS = 300;
const MAX_STACK_CHARS = 1200;

// Repeats of an already-known signature only bump a counter, and the write is
// throttled to this interval so a per-frame thrower can't turn every frame into a
// synchronous localStorage write. First sighting of a signature always writes
// immediately — that's the one we can least afford to lose to a hard crash.
const PERSIST_THROTTLE_MS = 1000;

function clip(value, max) {
    if (typeof value !== 'string') return undefined;
    return value.length > max ? value.slice(0, max) + '…' : value;
}

class ErrorLogger {
    constructor() {
        this.installed = false;
        this.entries = [];
        this.device = null;
        this._contextFn = null;
        this._lastPersist = 0;
        this._flushTimer = null;
    }

    /**
     * Installs the global handlers. Safe to call more than once. Call this as
     * early in the entry module as possible — anything that throws before it runs
     * is invisible to the log, and boot-path failures are exactly the class of
     * crash the load-time crash rate is made of.
     */
    install() {
        if (this.installed) return;
        this.installed = true;

        // Handlers first, in their own try. Fingerprinting the device and reading
        // the previous log are both nice-to-have; ATTACHING THE LISTENERS is the
        // whole point of this module, so nothing optional is allowed to run ahead
        // of it and take it down on the way.
        try {
            // Capture phase (true) is required: resource-load failures — a blocked
            // SDK script, a 404'd sound file — fire an 'error' event that does NOT
            // bubble, so a listener on window only sees them during capture.
            window.addEventListener('error', (e) => this._onErrorEvent(e), true);
            window.addEventListener('unhandledrejection', (e) => this._onRejection(e));

            // Flush anything the throttle is still holding. pagehide is the reliable
            // one on mobile Safari, where beforeunload frequently never fires.
            window.addEventListener('pagehide', () => this._persist());
        } catch (e) {
            // An error logger that breaks the page it is trying to instrument is
            // strictly worse than no error logger.
        }

        try {
            this.device = this._describeDevice();
            this._load();
        } catch (e) {
            // Log still functions in memory without either of these.
        }
    }

    /**
     * Registers a callback returning the current game context, read lazily at
     * capture time so nothing has to push state per frame.
     *
     * IMPORTANT for the caller: register this AFTER the bindings it closes over
     * are initialized. main.js's `game`/`gameState` are `let`s, and merely READING
     * one while it is still in its temporal dead zone throws a ReferenceError —
     * the exact failure documented at the top of main.js. The call inside capture
     * is try/caught anyway, but a context fn that always throws silently costs us
     * every field it was meant to provide.
     *
     * @param {() => object} fn returns e.g. { gameState, floor, room }
     */
    setContext(fn) {
        if (typeof fn === 'function') this._contextFn = fn;
    }

    /**
     * Records one error. Callable directly for errors that never reach a global
     * handler — most importantly main.js's game-loop try/catch, which swallows
     * every gameplay crash it sees and would otherwise leave the gameplay crash
     * rate completely undiagnosable.
     *
     * @param {Error|object|string} err
     * @param {string} source 'window' | 'promise' | 'resource' | 'main-loop' | ...
     * @param {{file?: string, line?: number, col?: number}} [where]
     */
    capture(err, source = 'unknown', where = {}) {
        try {
            const message = clip(
                (err && err.message) ? String(err.message) : String(err),
                MAX_MSG_CHARS
            ) || 'unknown error';
            const stack = clip(err && err.stack ? String(err.stack) : undefined, MAX_STACK_CHARS);

            const signature = [source, message, where.file || '', where.line || '', where.col || ''].join('|');
            const now = new Date().toISOString();

            const existing = this.entries.find(entry => entry.sig === signature);
            if (existing) {
                existing.n++;
                existing.last = now;
                // `state` is the FIRST sighting's context and is never overwritten.
                // An earlier version refreshed it on every repeat, which both
                // destroyed the most diagnostic fact in the record (which floor/room
                // it first broke on) and left the row self-contradictory — the
                // timestamp said one occurrence, the state said another. The latest
                // context is kept alongside instead, and only when it actually
                // differs, so "started in HUB, still happening in PLAYING" is
                // recorded without a redundant copy for the common same-place case.
                const latest = this._readContext();
                if (JSON.stringify(latest) !== JSON.stringify(existing.state)) {
                    existing.lastState = latest;
                }
                this._schedulePersist();
                return;
            }

            this.entries.push({
                sig: signature,
                t: now,
                src: source,
                msg: message,
                stack,
                file: where.file,
                line: where.line,
                col: where.col,
                state: this._readContext(),
                n: 1
            });
            if (this.entries.length > MAX_ENTRIES) this.entries.shift();
            this._persist();
        } catch (e) {
            // See install(): never escalate a logging failure.
        }
    }

    /** @returns {Array} a copy of the recorded entries, oldest first. */
    getEntries() {
        return this.entries.slice();
    }

    /** @returns {string} the whole log as JSON — paste-able out of a console. */
    export() {
        try {
            return JSON.stringify({ device: this.device, entries: this.entries }, null, 2);
        } catch (e) {
            return '{}';
        }
    }

    /** Prints the log to the console in a readable shape. */
    dump() {
        try {
            console.log('%c FRACTURED ERROR LOG ', 'background: #8b0000; color: #fff; font-weight: bold;');
            console.log('device:', this.device);
            if (this.entries.length === 0) {
                console.log('(no errors recorded)');
                return this.entries.length;
            }
            // Columns are explicitly first-vs-last: a repeated crash's value is in
            // knowing both where it started and whether it has moved since.
            const place = (s) => s ? `${s.gameState} F${s.floor} R${s.room}` : '—';
            console.table(this.entries.map(entry => ({
                firstSeen: entry.t,
                src: entry.src,
                message: entry.msg,
                firstAt: place(entry.state),
                count: entry.n,
                lastSeen: entry.last || '—',
                lastAt: entry.lastState ? place(entry.lastState) : '(same)'
            })));
            // Stacks are too long for console.table's columns, so they follow.
            this.entries.forEach((entry, i) => {
                if (entry.stack) console.log(`[${i}] ${entry.msg}\n${entry.stack}`);
            });
            return this.entries.length;
        } catch (e) {
            return 0;
        }
    }

    /** Wipes the log, in memory and on disk. */
    clear() {
        try {
            this.entries = [];
            if (this._flushTimer !== null) {
                clearTimeout(this._flushTimer);
                this._flushTimer = null;
            }
            localStorage.removeItem(STORAGE_KEY);
        } catch (e) {
            // Storage may be unavailable (private mode, embedded frame).
        }
    }

    // --- internals ---------------------------------------------------------

    _onErrorEvent(e) {
        try {
            // A resource failure has no Error object; the failing element is the
            // event target instead. Worth keeping distinct from script errors —
            // "the SDK script never loaded" and "a function threw" are different
            // problems with different fixes.
            if (e && e.target && e.target !== window && e.target.tagName) {
                const el = e.target;
                this.capture(
                    { message: `resource failed to load: ${el.currentSrc || el.src || el.href || el.tagName}` },
                    'resource'
                );
                return;
            }
            this.capture(
                (e && e.error) ? e.error : { message: e && e.message },
                'window',
                { file: e && e.filename, line: e && e.lineno, col: e && e.colno }
            );
        } catch (err) {
            // Never escalate.
        }
    }

    _onRejection(e) {
        try {
            const reason = e && e.reason;
            this.capture(reason !== undefined ? reason : { message: 'unhandled rejection' }, 'promise');
        } catch (err) {
            // Never escalate.
        }
    }

    _readContext() {
        try {
            if (!this._contextFn) return {};
            const ctx = this._contextFn();
            return (ctx && typeof ctx === 'object') ? ctx : {};
        } catch (e) {
            // A context provider that throws (see setContext's TDZ note) must not
            // cost us the error record itself.
            return { contextError: true };
        }
    }

    /**
     * A coarse device fingerprint, captured once per session rather than per
     * entry. Enough to answer "is this crash mobile-only?" — which is the
     * question the dashboard's mobile-heavy traffic split actually raises —
     * without collecting anything identifying.
     */
    _describeDevice() {
        const out = {};
        // Its own try, not folded into the one below: Vite replaces this with a
        // string literal at build time, but only when it is doing the building.
        // Read bare (a node script importing this module, a future non-Vite host)
        // `import.meta.env` is undefined and this is a TypeError — which, sharing a
        // try with the rest, would silently cost us every other device field.
        try { out.mode = import.meta.env.MODE; } catch (e) { /* not a Vite build */ }
        try {
            const ua = (navigator && navigator.userAgent) || '';
            out.ua = clip(ua, 250);

            const isTablet = /iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
            const isMobile = /Mobi|Android|iPhone|iPod|IEMobile|BlackBerry|Opera Mini/i.test(ua);
            out.class = isTablet ? 'tablet' : (isMobile ? 'mobile' : 'desktop');

            out.touch = (typeof navigator.maxTouchPoints === 'number') ? navigator.maxTouchPoints > 0 : undefined;
            out.screen = (typeof screen !== 'undefined') ? `${screen.width}x${screen.height}` : undefined;
            out.viewport = `${window.innerWidth}x${window.innerHeight}`;
            out.dpr = window.devicePixelRatio;
            out.cores = navigator.hardwareConcurrency;
            out.memGB = navigator.deviceMemory;
            out.lang = navigator.language;
        } catch (e) {
            // Any of these can be absent or throw in a hardened/embedded context.
        }
        return out;
    }

    _load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.entries)) {
                this.entries = parsed.entries.slice(-MAX_ENTRIES);
            }
        } catch (e) {
            // Corrupt or unreadable log: start clean rather than fail boot.
            this.entries = [];
        }
    }

    _schedulePersist() {
        const now = Date.now();
        if (now - this._lastPersist >= PERSIST_THROTTLE_MS) {
            this._persist();
            return;
        }
        if (this._flushTimer === null) {
            this._flushTimer = setTimeout(() => {
                this._flushTimer = null;
                this._persist();
            }, PERSIST_THROTTLE_MS);
        }
    }

    _persist() {
        try {
            if (this._flushTimer !== null) {
                clearTimeout(this._flushTimer);
                this._flushTimer = null;
            }
            this._lastPersist = Date.now();

            let payload = JSON.stringify({ device: this.device, entries: this.entries });
            // Size cap: drop oldest entries until the serialized log fits. Done on
            // the real serialized string rather than an estimate, since a single
            // long stack can be most of the budget on its own.
            while (payload.length > MAX_BYTES && this.entries.length > 1) {
                this.entries.shift();
                payload = JSON.stringify({ device: this.device, entries: this.entries });
            }
            localStorage.setItem(STORAGE_KEY, payload);
        } catch (e) {
            // Quota exceeded / storage disabled. The in-memory log still works for
            // this session, and the save file's own writes are unaffected.
        }
    }
}

export const errorLog = new ErrorLogger();
