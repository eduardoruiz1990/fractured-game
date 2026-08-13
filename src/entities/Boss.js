import { Enemy } from './Enemy.js';
// Patch 94 — THE RECURSION's boss aggression. cadence(n, 1, min) === n for integer n,
// so floors 1-5 are bit-identical despite every timer below routing through it.
import { cadence } from '../core/Endless.js';

export class Boss extends Enemy {
    constructor() {
        super('BOSS', 30, '#b87333', 'boss_hurt'); 
        this.pulseState = 'hunting'; 
        this.pulseTimer = 0;
        this.pulseRadius = 0;
        this.maxPulseRadius = 150;
    }

    init(id, x, y) {
        this.phase = 0;
        this.pulseState = 'hunting';
        this.pulseTimer = 180;
        // Patch 94: MUST be reset here, and this is the pooling trap, not decoration.
        // Director.applyEndlessScaling writes this field AFTER init() — and on floors
        // 1-5 it early-returns and never writes it at all. A pooled Boss last used on
        // floor 16 would otherwise walk into a floor-2 fight still carrying that
        // aggression. Same rule as `variant = null` on the small enemies.
        this.aggression = 1;
        return this.initBase(id, x, y, 800, 1.2); // Base speed boosted to 1.2
    }

    update(state, game) {
        this.phase += 0.02;
        let distToTarget = Math.max(Math.hypot(state.player.x - this.x, state.player.y - this.y), 0.001);
        
        if (this.pulseState === 'charging') {
            this.vx = 0;
            this.vy = 0;
            this.pulseTimer--;
            
            this.pulseRadius = this.maxPulseRadius * (1 - (this.pulseTimer / 45));

            if (this.pulseTimer <= 0) {
                this.pulseState = 'pulsing';
                this.pulseTimer = 15; 
                if (game.audioEngine) game.audioEngine.playSFX('boss_intro', 0.8); 
                
                if (distToTarget <= this.maxPulseRadius && (!state.player.dash || !state.player.dash.active)) {
                     game.takeDamage(this.damage * 1.5); 
                }
            }
        } else if (this.pulseState === 'pulsing') {
             this.vx = 0;
             this.vy = 0;
             this.pulseTimer--;
             if (this.pulseTimer <= 0) {
                 this.pulseState = 'hunting';
                 // Pulse much more frequently after getting close
                 // Patch 94: the COOLDOWN between pulses, so this is the honest place
                 // to spend aggression. The 45-frame charge above is deliberately NOT
                 // compressed — it is the telegraph, and line 28 derives the warning
                 // ring's radius from it (`1 - pulseTimer/45`).
                 this.pulseTimer = cadence(60 + Math.random() * 60, this.aggression, 24);
                 this.pulseRadius = 0;
             }
        } else {
            // --- NEW: EXPONENTIAL RUBBER-BANDING SPEED ---
            let targetSpeed = this.baseSpeed;
            
            if (distToTarget > this.maxPulseRadius) {
                // Accelerates relentlessly the further away the player gets
                targetSpeed = this.baseSpeed * (1 + (distToTarget / 150)); 
            } else {
                // Sticks aggressively close when in range
                targetSpeed = this.baseSpeed * 1.5;
            }

            if (state.sanity <= 0) {
                this.speed = targetSpeed * 0.3; 
            } else {
                this.speed = targetSpeed;
            }

            this.vx = (state.player.x - this.x) / distToTarget * this.speed;
            this.vy = (state.player.y - this.y) / distToTarget * this.speed;

            this.pulseTimer--;
            if (this.pulseTimer <= 0 && distToTarget < this.maxPulseRadius * 1.2) {
                this.pulseState = 'charging';
                this.pulseTimer = 45; // Charges the attack much faster now
            }

            if (distToTarget < 40) { 
                if (!state.player.dash || !state.player.dash.active) {
                    game.takeDamage(this.damage); 
                    this.x -= this.vx * 5; 
                    this.y -= this.vy * 5; 
                }
            }
        }

        this.applyMovement(state, game);
    }
}