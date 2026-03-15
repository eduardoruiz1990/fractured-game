import { Enemy } from './Enemy.js';

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
        return this.initBase(id, x, y, 800, 0.8);
    }

    update(state, game) {
        this.phase += 0.02;
        let distToTarget = Math.max(Math.hypot(state.player.x - this.x, state.player.y - this.y), 0.001);
        
        if (this.pulseState === 'charging') {
            this.vx = 0;
            this.vy = 0;
            this.pulseTimer--;
            
            this.pulseRadius = this.maxPulseRadius * (1 - (this.pulseTimer / 60));

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
                 this.pulseTimer = 180 + Math.random() * 120; 
                 this.pulseRadius = 0;
             }
        } else {
            if (state.sanity <= 0) {
                this.speed = this.baseSpeed * 0.3; 
            } else {
                this.speed = this.baseSpeed;
            }

            this.vx = (state.player.x - this.x) / distToTarget * this.speed;
            this.vy = (state.player.y - this.y) / distToTarget * this.speed;

            this.pulseTimer--;
            if (this.pulseTimer <= 0 && distToTarget < this.maxPulseRadius * 1.5) {
                this.pulseState = 'charging';
                this.pulseTimer = 60; 
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