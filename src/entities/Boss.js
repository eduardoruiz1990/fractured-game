import { Enemy } from './Enemy.js';

export class Boss extends Enemy {
    constructor() {
        super('BOSS', 30, '#b87333');
        this.pulseState = 'hunting'; // hunting, charging, pulsing
        this.pulseTimer = 0;
        this.pulseRadius = 0;
        this.maxPulseRadius = 150;
    }

    init(id, x, y) {
        this.phase = 0;
        this.pulseState = 'hunting';
        this.pulseTimer = 180; // Initial delay before first pulse chance
        return this.initBase(id, x, y, 800, 0.8);
    }

    update(state, game) {
        this.phase += 0.02;
        let distToTarget = Math.max(Math.hypot(state.player.x - this.x, state.player.y - this.y), 0.001);
        
        if (this.pulseState === 'charging') {
            // Stop moving, charge the pulse
            this.vx = 0;
            this.vy = 0;
            this.pulseTimer--;
            
            // Pulse radius telegraph grows
            this.pulseRadius = this.maxPulseRadius * (1 - (this.pulseTimer / 60));

            if (this.pulseTimer <= 0) {
                this.pulseState = 'pulsing';
                this.pulseTimer = 15; // Brief actual detonation
                if (game.audioEngine) game.audioEngine.playSFX('death', 0.8); // Boom sound
                
                // Apply Damage if in radius
                if (distToTarget <= this.maxPulseRadius && (!state.player.dash || !state.player.dash.active)) {
                     game.takeDamage(this.damage * 1.5); // Heavy damage
                }
            }
        } else if (this.pulseState === 'pulsing') {
             this.vx = 0;
             this.vy = 0;
             this.pulseTimer--;
             if (this.pulseTimer <= 0) {
                 this.pulseState = 'hunting';
                 this.pulseTimer = 180 + Math.random() * 120; // 3-5 seconds between pulses
                 this.pulseRadius = 0;
             }
        } else {
            // Normal Hunting
            if (state.sanity <= 0) {
                this.speed = this.baseSpeed * 0.3; 
            } else {
                this.speed = this.baseSpeed;
            }

            this.vx = (state.player.x - this.x) / distToTarget * this.speed;
            this.vy = (state.player.y - this.y) / distToTarget * this.speed;

            // Try to trigger pulse
            this.pulseTimer--;
            if (this.pulseTimer <= 0 && distToTarget < this.maxPulseRadius * 1.5) {
                this.pulseState = 'charging';
                this.pulseTimer = 60; // 1 second charge up
            }

            if (distToTarget < 40) { 
                if (!state.player.dash || !state.player.dash.active) {
                    game.takeDamage(this.damage); 
                    this.x -= this.vx * 5; 
                    this.y -= this.vy * 5; 
                }
            }
        }

        this.applyMovement(state);
    }
}