// src/core/Input.js
// Handles Keyboard, Mouse, and Mobile Dual-Joystick input.

/** Patch 105: true when keyboard focus is in a field the player is typing into. */
function Input_isTextEntry(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toUpperCase();
    return tag === 'TEXTAREA' || (tag === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(el.type)) || !!el.isContentEditable;
}

// Patch 149 (V2 plan F2): double-tap the movement side to dash. A "tap" is a touch on
// the left half shorter than TAP_MAX_MS that travelled under TAP_MAX_TRAVEL px; a second
// touch starting within DOUBLE_TAP_MS of its end, within DOUBLE_TAP_SLOP px of it, fires
// one dash in the last direction of travel. The second touch then steers as normal.
export const TAP_MAX_MS = 220;
export const TAP_MAX_TRAVEL = 20;
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_SLOP = 80;

/** Pure: does a touch starting at (x, y) at `now` complete a double-tap after `prev`? */
export function isDoubleTap(prev, now, x, y) {
    if (!prev || !prev.wasTap) return false;
    if (!(now - prev.endAt >= 0 && now - prev.endAt < DOUBLE_TAP_MS)) return false;
    return Math.hypot(x - prev.x, y - prev.y) < DOUBLE_TAP_SLOP;
}

/** Pure: was a finished touch a tap (short and still)? */
export function wasTap(durationMs, travelPx) {
    return durationMs < TAP_MAX_MS && travelPx < TAP_MAX_TRAVEL;
}

export class InputManager {
    constructor(canvas) {
        this.canvas = canvas;
        
        // Added 'dash' intent to state
        // Patch 148: aimHeld — the right stick is held AND pulled past its dead zone. Aim
        // assist (systems/AutoAim.js) yields to it.
        this.state = { moveX: 0, moveY: 0, aimAngle: 0, isMoving: false, isAiming: true, dash: false, aimHeld: false, touchHeld: false };
        // Patch 164: touchHeld — a thumb is on either stick (moving or not). Aim assist
        // counts it as playing; with no thumb down for 1.5 s, assist lets go.
        
        this.isTouchDevice = false;
        this.dashBtnShown = false;

        // Patch 65. isTouchDevice only becomes true on the FIRST canvas touch, which is
        // too late for anything that has to be right on frame 1 — the tutorial copy and
        // the dash button both were. coarsePointer is the up-front guess; usedKeyboard
        // is the correction for a touchscreen laptop. Neither replaces isTouchDevice,
        // which still governs actual input routing. matchMedia is wrapped because it is
        // absent in the jsdom-less mocks the test_*.js scripts run under.
        this.coarsePointer = false;
        try {
            this.coarsePointer =
                (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches);   // Patch 190: no maxTouchPoints. CrazyGames' technical requirements forbid using it (or ontouchstart) to detect mobile: touchscreen laptops report it too.
        } catch (e) { this.coarsePointer = false; }
        this.usedKeyboard = false;

        // Track spacebar for dash
        this.keys = { w: false, a: false, s: false, d: false, space: false };
        this.leftTouch = { id: null, ox: 0, oy: 0, cx: 0, cy: 0 };
        // Patch 149: the double-tap dash. doubleTapDash is the player's setting (main.js);
        // onDashGesture is told when one fires (for the haptic).
        this.doubleTapDash = true;
        this.onDashGesture = null;
        this.leftTap = { startAt: 0, travel: 0, prev: null, sx: 0, sy: 0 };
        this.lastMoveAngle = null;
        this.rightTouch = { id: null, ox: 0, oy: 0, cx: 0, cy: 0 };

        this.joyLeft = document.getElementById('joy-left');
        this.knobLeft = document.getElementById('knob-left');
        this.joyRight = document.getElementById('joy-right');
        this.knobRight = document.getElementById('knob-right');
        this.btnDash = document.getElementById('btn-dash');

        this.bindEvents();
    }

    bindEvents() {
        // Keyboard
        window.addEventListener('keydown', (e) => {
            // Patch 105: typing into a text field (the save-import dialog, Patch 103)
            // is not movement. Without this, pasting/typing a save string in the hub
            // walked the player around behind the dialog.
            if (Input_isTextEntry(e.target)) return;
            const key = this.normalizeKey(e);
            if (key) { this.usedKeyboard = true; }
            if (['w', 'a', 's', 'd'].includes(key)) { this.keys[key] = true; this.updateKeyboardInput(); }
            if (key === 'space') { this.keys.space = true; this.updateKeyboardInput(); }
        });

        window.addEventListener('keyup', (e) => {
            const key = this.normalizeKey(e);
            if (['w', 'a', 's', 'd'].includes(key)) { this.keys[key] = false; this.updateKeyboardInput(); }
            if (key === 'space') { this.keys.space = false; this.updateKeyboardInput(); }
        });

        // Mouse Aiming
        this.canvas.addEventListener('mousemove', (e) => {
            if (this.isTouchDevice) return;
            const rect = this.canvas.getBoundingClientRect();
            this.mouseX = e.clientX - rect.left;
            this.mouseY = e.clientY - rect.top;
            this.state.isAiming = true;
            this.state.pointerMoved = true;   // Patch 164: a moving mouse is a player (Game consumes it)
            this.state.mouseAim = true;
        });

        // Mobile Touch
        this.canvas.addEventListener('touchstart', (e) => this.handleTouch(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this.handleTouch(e), { passive: false });
        this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });
        this.canvas.addEventListener('touchcancel', (e) => this.handleTouchEnd(e), { passive: false });
        
        // Dedicated Mobile Dash Button
        if (this.btnDash) {
            this.btnDash.addEventListener('touchstart', (e) => {
                e.preventDefault(); // Stop canvas from grabbing it
                this.state.isDashing = true;
            }, { passive: false });

            // Patch 68: touchcancel was missing here. The canvas has bound it since
            // the joysticks were written (see above) — this button never did, so any
            // touch the SYSTEM took away mid-press (an incoming call, a notification
            // shade, an edge-swipe gesture, the app being backgrounded) left
            // isDashing latched true for the rest of the session. The player would
            // then dash continuously, burning every charge the instant it recharged,
            // with no way to stop it short of a reload.
            const releaseDash = (e) => {
                e.preventDefault();
                this.state.isDashing = false;
            };
            this.btnDash.addEventListener('touchend', releaseDash, { passive: false });
            this.btnDash.addEventListener('touchcancel', releaseDash, { passive: false });
        }
    }

    /**
     * Maps a keydown/keyup to one of 'w'|'a'|'s'|'d'|'space', or '' for keys this
     * manager does not own.
     *
     * Patch 65 adds the arrow keys, which were simply never bound — a desktop player
     * who reached for them got a character that does not respond, on the very first
     * screen of the game. No preventDefault: the window listener is live inside the
     * folder menus too, and swallowing arrows there would break scrolling the guide.
     */
    normalizeKey(e) {
        if (!e) return '';
        if (e.code === 'Space') return 'space';
        switch (e.key) {
            case 'ArrowUp': return 'w';
            case 'ArrowDown': return 's';
            case 'ArrowLeft': return 'a';
            case 'ArrowRight': return 'd';
            default: break;
        }
        const key = (e.key || '').toLowerCase();
        return ['w', 'a', 's', 'd'].includes(key) ? key : '';
    }

    /**
     * 'touch' | 'keyboard' — which control scheme to SPEAK to the player about.
     * Deliberately distinct from isTouchDevice (which routes input and can only be
     * known after a touch has happened): this has to be answerable on frame 1.
     */
    getInputMode() {
        if (this.isTouchDevice) return 'touch';
        if (this.coarsePointer && !this.usedKeyboard) return 'touch';
        return 'keyboard';
    }

    /**
     * Show the touch controls BEFORE the first touch on a touch device. Previously
     * the dash button appeared only once the player had already touched the canvas,
     * so a new mobile player's first frame had wrong instructions and no visible
     * controls at the same time. The joysticks stay floating — they materialise under
     * the thumb, and parking a fake one somewhere arbitrary would teach the wrong
     * gesture.
     */
    revealTouchControls() {
        if (!this.coarsePointer && !this.isTouchDevice) return;
        if (this.btnDash && !this.dashBtnShown) {
            this.btnDash.style.display = 'flex';
            this.dashBtnShown = true;
        }
    }

    updateKeyboardInput() {
        if (this.isTouchDevice) return;
        let mx = 0, my = 0;
        if (this.keys.w) my -= 1; if (this.keys.s) my += 1; 
        if (this.keys.a) mx -= 1; if (this.keys.d) mx += 1;
        
        if (mx !== 0 || my !== 0) {
            let len = Math.max(Math.hypot(mx, my), 0.001); 
            this.state.moveX = mx / len; 
            this.state.moveY = my / len; 
            this.state.isMoving = true;
        } else {
            this.state.moveX = 0; this.state.moveY = 0; this.state.isMoving = false;
        }
        
        // Map spacebar to dash
        this.state.isDashing = this.keys.space;
    }

    handleTouch(e) {
        if (e.target.id === 'btn-dash') return; // Ignore dash button touches
        
        e.preventDefault(); 
        this.isTouchDevice = true;
        if (!this.dashBtnShown && this.btnDash) {
            this.btnDash.style.display = 'flex'; // Reveal dash button on first touch
            this.dashBtnShown = true;
        }

        // Patch 79: the joystick rings are absolutely positioned inside
        // #game-container, but were placed using raw clientX/clientY — which are
        // VISUAL-viewport coordinates. The two spaces are identical only while the
        // page is unzoomed and unscrolled; pinch-zoom or a URL bar appearing shifts
        // them apart, and the ring then draws offset from the thumb that summoned it.
        // Subtracting the container's own client rect converts to its coordinate
        // space, which is what an absolutely positioned child needs, and costs one
        // rect read per touchstart.
        const parent = this.joyLeft && this.joyLeft.offsetParent;
        const originRect = parent && typeof parent.getBoundingClientRect === 'function'
            ? parent.getBoundingClientRect()
            : { left: 0, top: 0, width: window.innerWidth };
        const localX = (clientX) => clientX - originRect.left;
        const localY = (clientY) => clientY - originRect.top;

        // Split the control zones down the middle of the PLAY AREA, not of the window.
        // Same reason: with the container correctly sized these agree, but deriving
        // both from the same box means they cannot drift apart again.
        const halfWidth = originRect.left + (originRect.width || window.innerWidth) / 2;

        // Patch 161: route by FINGER, not by screen half. Only a touchstart picks a stick;
        // a touchmove updates whichever stick that finger already owns. Before, every
        // touchmove was re-sorted by which half it was on, so a move thumb drifting past
        // the midline (easy in portrait, where both thumbs sit near the middle) was
        // adopted by the free aim stick: the move stick stopped updating and the player
        // walked on, or stood, at the last value while the same thumb turned the light.
        // And a second thumb landing on an occupied half was ignored outright.
        if (e.type === 'touchstart') {
            this.reclaimLostTouches(e.touches);
            const geo = { halfWidth, localX, localY };
            for (let i = 0; i < e.changedTouches.length; i++) this.startTouch(e.changedTouches[i], geo);
        } else {
            for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                if (this.leftTouch.id === t.identifier) {
                    this.leftTouch.cx = t.clientX; this.leftTouch.cy = t.clientY;
                    this.leftTap.travel = Math.max(this.leftTap.travel, Math.hypot(t.clientX - this.leftTap.sx, t.clientY - this.leftTap.sy));
                } else if (this.rightTouch.id === t.identifier) {
                    this.rightTouch.cx = t.clientX; this.rightTouch.cy = t.clientY;
                }
            }
        }
        this._geo = { localX, localY };
        this.processJoysticks();
    }

    /**
     * Patch 161: a new finger picks its stick. Its half of the screen is only the
     * preference. With one stick already held, the two thumbs are sorted by position
     * instead: the LEFTMOST finger moves, the other aims. So any two thumbs anywhere on
     * the glass give one of each, the same way round, and a thumb that lands on the
     * "wrong" half still gets the free stick instead of being ignored. If the new
     * finger lands on the far side of the held one, the held finger swaps sticks,
     * re-centred where it is now. A third finger is ignored.
     */
    startTouch(t, geo) {
        const L = this.leftTouch, R = this.rightTouch, x = t.clientX;
        if (L.id !== null && R.id !== null) return;
        let side;
        if (L.id === null && R.id === null) side = x < geo.halfWidth ? 'left' : 'right';
        else if (L.id === null) {               // aim held: the new finger moves if it is left of it
            if (x <= R.cx) side = 'left';
            else { this.claimStick('left', R.id, R.cx, R.cy, geo, false); this.releaseStick('rightSlotOnly'); side = 'right'; }
        } else {                                // move held: the new finger aims if it is right of it
            if (x >= L.cx) side = 'right';
            else { this.claimStick('right', L.id, L.cx, L.cy, geo, false); this.releaseStick('leftSlotOnly'); side = 'left'; }
        }
        this.claimStick(side, t.identifier, t.clientX, t.clientY, geo, true);
    }

    /** Patch 161: give stick `side` to finger `id`, centred at (x, y). */
    claimStick(side, id, x, y, geo, isNewFinger) {
        const slot = side === 'left' ? this.leftTouch : this.rightTouch;
        const ring = side === 'left' ? this.joyLeft : this.joyRight;
        if (side === 'left' && isNewFinger) {
            // Patch 149: a second quick touch after a tap is a dash.
            const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            if (this.doubleTapDash && isDoubleTap(this.leftTap.prev, now, x, y)) {
                this.state.dashPulse = true;
                this.state.dashAngle = this.lastMoveAngle;
                this.leftTap.prev = null;
                if (typeof this.onDashGesture === 'function') { try { this.onDashGesture(); } catch (err) { /* cosmetic */ } }
            }
            this.leftTap.startAt = now;
        }
        // A finger swapped onto the move stick mid-touch is never the first half of a tap.
        if (side === 'left') { this.leftTap.travel = 0; this.leftTap.sx = x; this.leftTap.sy = y; if (!isNewFinger) this.leftTap.startAt = -1e9; }
        slot.id = id; slot.ox = x; slot.oy = y; slot.cx = x; slot.cy = y;
        this.state.touchHeld = true;   // Patch 164
        if (ring) {
            ring.style.display = 'block';
            ring.style.left = (geo.localX(x) - 60) + 'px';
            ring.style.top = (geo.localY(y) - 60) + 'px';
        }
    }

    /** Patch 161: free a stick and zero what it drove (no stale movement or aim). */
    releaseStick(which) {
        if (which === 'left' || which === 'leftSlotOnly') {
            this.leftTouch.id = null;
            this.state.moveX = 0; this.state.moveY = 0; this.state.isMoving = false;
            if (which === 'left' && this.joyLeft) this.joyLeft.style.display = 'none';
            if (this.knobLeft) this.knobLeft.style.transform = 'translate(-50%, -50%)';
        } else {
            this.rightTouch.id = null;
            this.state.aimHeld = false;
            if (which === 'right' && this.joyRight) this.joyRight.style.display = 'none';
            if (this.knobRight) this.knobRight.style.transform = 'translate(-50%, -50%)';
        }
        this.state.touchHeld = this.leftTouch.id !== null || this.rightTouch.id !== null;   // Patch 164
    }

    /**
     * Patch 161: a stick whose finger is no longer on the glass (its touchend went to
     * a menu, or the system took the touch) is freed on the next touchstart, so it can
     * never stay claimed by a finger that has lifted. `touches` is every current touch.
     */
    reclaimLostTouches(touches) {
        if (!touches) return;
        const live = new Set();
        for (let i = 0; i < touches.length; i++) live.add(touches[i].identifier);
        if (this.leftTouch.id !== null && !live.has(this.leftTouch.id)) this.releaseStick('left');
        if (this.rightTouch.id !== null && !live.has(this.rightTouch.id)) this.releaseStick('right');
    }

    handleTouchEnd(e) {
        if (e.target.id === 'btn-dash') return;

        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.identifier === this.leftTouch.id) {
                // Patch 149: remember whether this was a tap, for a double-tap dash.
                const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
                this.leftTap.prev = { wasTap: wasTap(now - this.leftTap.startAt, this.leftTap.travel), endAt: now, x: this.leftTap.sx, y: this.leftTap.sy };
                this.releaseStick('left');
            } else if (t.identifier === this.rightTouch.id) {
                this.releaseStick('right');   // Patch 148: aimHeld off, assist takes over again
            }
        }
    }

    /**
     * Patch 161: past full pull the stick's base trails the thumb (it is dragged along,
     * staying MAX_PULL behind). A thumb that creeps keeps a stick that answers at once
     * when it reverses, instead of a base left far behind, and the two rings stay under
     * their thumbs instead of drifting into each other.
     */
    followThumb(slot, ring, MAX_PULL) {
        const dx = slot.cx - slot.ox, dy = slot.cy - slot.oy, d = Math.hypot(dx, dy);
        if (!(d > MAX_PULL)) return;
        const k = (d - MAX_PULL) / d;
        slot.ox += dx * k; slot.oy += dy * k;
        if (ring && this._geo) {
            ring.style.left = (this._geo.localX(slot.ox) - 60) + 'px';
            ring.style.top = (this._geo.localY(slot.oy) - 60) + 'px';
        }
    }

    processJoysticks() {
        const MAX_PULL = 50;
        if (this.leftTouch.id !== null) this.followThumb(this.leftTouch, this.joyLeft, MAX_PULL);
        if (this.rightTouch.id !== null) this.followThumb(this.rightTouch, this.joyRight, MAX_PULL);
        if (this.leftTouch.id !== null) {
            let dx = this.leftTouch.cx - this.leftTouch.ox, dy = this.leftTouch.cy - this.leftTouch.oy;
            let dist = Math.max(Math.hypot(dx, dy), 0.001);
            if (dist > MAX_PULL) { dx = (dx/dist)*MAX_PULL; dy = (dy/dist)*MAX_PULL; dist = MAX_PULL; }
            this.knobLeft.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            
            if (dist > 25) this.lastMoveAngle = Math.atan2(dy, dx);   // Patch 149: a real heading, not tap jitter
            if (dist > 10) { 
                this.state.moveX = dx / MAX_PULL; this.state.moveY = dy / MAX_PULL; this.state.isMoving = true; 
            } else { 
                this.state.moveX = 0; this.state.moveY = 0; this.state.isMoving = false; 
            }
        }
        
        if (this.rightTouch.id !== null) {
            let dx = this.rightTouch.cx - this.rightTouch.ox, dy = this.rightTouch.cy - this.rightTouch.oy;
            let dist = Math.max(Math.hypot(dx, dy), 0.001);
            if (dist > MAX_PULL) { dx = (dx/dist)*MAX_PULL; dy = (dy/dist)*MAX_PULL; dist = MAX_PULL; }
            this.knobRight.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            
            if (dist > 10) { 
                this.state.aimAngle = Math.atan2(dy, dx); 
                this.state.isAiming = true; 
                this.state.aimHeld = true;   // Patch 148
            } else {
                this.state.aimHeld = false;
            }
        }
    }

    updateAimAngle(playerX, playerY) {
        if (!this.isTouchDevice && this.mouseX !== undefined && this.mouseY !== undefined) {
            const screenCenterX = this.canvas.width / 2;
            const screenCenterY = this.canvas.height / 2;
            this.state.aimAngle = Math.atan2(this.mouseY - screenCenterY, this.mouseX - screenCenterX);
        }
    }
    
    hideJoysticks() {
        this.joyLeft.style.display = 'none';
        this.joyRight.style.display = 'none';
        if (this.btnDash) this.btnDash.style.display = 'none';

        // Patch 68: release the input state too, not just the visuals. This is called
        // when a menu opens, which routinely happens WITH A FINGER STILL DOWN — the
        // player taps PAUSE with one thumb while the other is on the move stick. The
        // held slot kept its touch identifier, and handleTouch only ever adopts a new
        // finger when the slot reads null, so if that finger's touchend never reached
        // the canvas (it is hidden behind the menu), the stick stayed claimed by a
        // finger that was no longer on the glass — dead for the rest of the run.
        // Zeroing the movement matters for the same reason: moveX/moveY persist, so a
        // stale value would walk the player off on resume without any input.
        this.leftTouch.id = null;
        this.rightTouch.id = null;
        this.state.moveX = 0;
        this.state.moveY = 0;
        this.state.isMoving = false;
        this.state.isDashing = false;
        this.state.aimHeld = false;   // Patch 148
        this.state.touchHeld = false;   // Patch 164
        this.state.dashPulse = false;   // Patch 149: no stale gesture across a menu
        this.leftTap.prev = null;
        if (this.knobLeft) this.knobLeft.style.transform = 'translate(-50%, -50%)';
        if (this.knobRight) this.knobRight.style.transform = 'translate(-50%, -50%)';
        // Clear the reveal latch too. handleTouch only shows the dash button while
        // `!dashBtnShown`, so hiding it here without resetting the flag meant the
        // button was gone PERMANENTLY after the first menu open — losing dash, and
        // with it the i-frames it grants, for the rest of the session on touch.
        // The next canvas touch now re-reveals it, matching how the floating
        // joysticks already re-appear under the player's thumb.
        this.dashBtnShown = false;
    }
}