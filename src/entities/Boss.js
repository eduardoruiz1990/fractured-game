// src/entities/Boss.js
import { Enemy } from './Enemy.js';

export class Boss extends Enemy {
    constructor(id, x, y) {
        super(id, 'BOSS', x, y, 800, 0.8, 30, '#b87333');
        this.phase = 0;
    }

    update(state, game) {
        this.phase += 0.02;
        let distToTarget = Math.max(Math.hypot(state.player.x - this.x, state.player.y - this.y), 0.001);
        
        // Quantum State during player Breakdown
        if (state.sanity <= 0) {
            this.speed = this.baseSpeed * 0.3; 
        } else {
            this.speed = this.baseSpeed;
        }

        this.vx = (state.player.x - this.x) / distToTarget * this.speed;
        this.vy = (state.player.y - this.y) / distToTarget * this.speed;

        if (distToTarget < 40) { 
            game.takeDamage(this.damage); 
            this.x -= this.vx * 5; 
            this.y -= this.vy * 5; 
        }

        this.applyMovement(state);
    }
}