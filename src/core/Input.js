// src/core/Input.js
// Handles Keyboard, Mouse, and Mobile Dual-Joystick input.

export class InputManager {
    constructor(canvas) {
        this.canvas = canvas;
        
        // Added 'dash' intent to state
        this.state = { moveX: 0, moveY: 0, aimAngle: 0, isMoving: false, isAiming: true, dash: false };
        
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
                (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) ||
                (navigator.maxTouchPoints || 0) > 0;
        } catch (e) { this.coarsePointer = false; }
        this.usedKeyboard = false;

        // Track spacebar for dash
        this.keys = { w: false, a: false, s: false, d: false, space: false };
        this.leftTouch = { id: null, ox: 0, oy: 0, cx: 0, cy: 0 };
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

        const halfWidth = window.innerWidth / 2;

        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.clientX < halfWidth) {
                if (this.leftTouch.id === null) {
                    this.leftTouch.id = t.identifier; 
                    this.leftTouch.ox = t.clientX; this.leftTouch.oy = t.clientY;
                    this.joyLeft.style.display = 'block'; 
                    this.joyLeft.style.left = (t.clientX - 60) + 'px'; 
                    this.joyLeft.style.top = (t.clientY - 60) + 'px';
                }
                if (this.leftTouch.id === t.identifier) { 
                    this.leftTouch.cx = t.clientX; this.leftTouch.cy = t.clientY; 
                }
            } else {
                if (this.rightTouch.id === null) {
                    this.rightTouch.id = t.identifier; 
                    this.rightTouch.ox = t.clientX; this.rightTouch.oy = t.clientY;
                    this.joyRight.style.display = 'block'; 
                    this.joyRight.style.left = (t.clientX - 60) + 'px'; 
                    this.joyRight.style.top = (t.clientY - 60) + 'px';
                }
                if (this.rightTouch.id === t.identifier) { 
                    this.rightTouch.cx = t.clientX; this.rightTouch.cy = t.clientY; 
                }
            }
        }
        this.processJoysticks();
    }

    handleTouchEnd(e) {
        if (e.target.id === 'btn-dash') return;

        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.identifier === this.leftTouch.id) {
                this.leftTouch.id = null; this.joyLeft.style.display = 'none';
                this.state.moveX = 0; this.state.moveY = 0; this.state.isMoving = false; 
                this.knobLeft.style.transform = `translate(-50%, -50%)`;
            } else if (t.identifier === this.rightTouch.id) {
                this.rightTouch.id = null; this.joyRight.style.display = 'none'; 
                this.knobRight.style.transform = `translate(-50%, -50%)`;
            }
        }
    }

    processJoysticks() {
        const MAX_PULL = 50;
        if (this.leftTouch.id !== null) {
            let dx = this.leftTouch.cx - this.leftTouch.ox, dy = this.leftTouch.cy - this.leftTouch.oy;
            let dist = Math.max(Math.hypot(dx, dy), 0.001);
            if (dist > MAX_PULL) { dx = (dx/dist)*MAX_PULL; dy = (dy/dist)*MAX_PULL; dist = MAX_PULL; }
            this.knobLeft.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            
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