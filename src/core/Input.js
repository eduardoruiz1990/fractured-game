// src/core/Input.js
// Handles Keyboard, Mouse, and Mobile Dual-Joystick input.

export class InputManager {
    constructor(canvas) {
        this.canvas = canvas;
        
        // State
        this.state = { moveX: 0, moveY: 0, aimAngle: 0, isMoving: false, isAiming: true };
        
        // Trackers
        this.isTouchDevice = false;
        this.keys = { w: false, a: false, s: false, d: false };
        this.leftTouch = { id: null, ox: 0, oy: 0, cx: 0, cy: 0 };
        this.rightTouch = { id: null, ox: 0, oy: 0, cx: 0, cy: 0 };

        // DOM Elements for Mobile Joysticks
        this.joyLeft = document.getElementById('joy-left');
        this.knobLeft = document.getElementById('knob-left');
        this.joyRight = document.getElementById('joy-right');
        this.knobRight = document.getElementById('knob-right');

        this.bindEvents();
    }

    bindEvents() {
        // Keyboard
        window.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            if (['w', 'a', 's', 'd'].includes(key)) { this.keys[key] = true; this.updateKeyboardInput(); }
        });
        
        window.addEventListener('keyup', (e) => {
            const key = e.key.toLowerCase();
            if (['w', 'a', 's', 'd'].includes(key)) { this.keys[key] = false; this.updateKeyboardInput(); }
        });

        // Mouse Aiming
        this.canvas.addEventListener('mousemove', (e) => {
            if (this.isTouchDevice) return;
            const rect = this.canvas.getBoundingClientRect();
            // Note: We need player position to calculate aim angle. We will inject this externally or 
            // calculate it in the Game loop. For now, we store raw mouse coords.
            this.mouseX = e.clientX - rect.left;
            this.mouseY = e.clientY - rect.top;
            this.state.isAiming = true;
        });

        // Mobile Touch
        this.canvas.addEventListener('touchstart', (e) => this.handleTouch(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this.handleTouch(e), { passive: false });
        this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });
        this.canvas.addEventListener('touchcancel', (e) => this.handleTouchEnd(e), { passive: false });
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
    }

    handleTouch(e) {
        e.preventDefault(); 
        this.isTouchDevice = true;
        const halfWidth = window.innerWidth / 2;

        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.clientX < halfWidth) {
                // Left Joy
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
                // Right Joy
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

    // Called by the game loop to resolve mouse aiming based on current player pos
    updateAimAngle(playerX, playerY) {
        if (!this.isTouchDevice && this.mouseX !== undefined && this.mouseY !== undefined) {
            this.state.aimAngle = Math.atan2(this.mouseY - playerY, this.mouseX - playerX);
        }
    }
    
    hideJoysticks() {
        this.joyLeft.style.display = 'none';
        this.joyRight.style.display = 'none';
    }
}