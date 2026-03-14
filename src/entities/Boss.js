import { Enemy } from './Enemy.js';

export class Boss extends Enemy {
    constructor() {
        super('BOSS', 30, '#b87333');
    }

    init(id, x, y) {
        this.phase = 0;
        return this.initBase(id, x, y, 800, 0.8);
    }

    update(state, game) {
        this.phase += 0.02;
        let distToTarget = Math.max(Math.hypot(state.player.x - this.x, state.player.y - this.y), 0.001);
        
        if (state.sanity <= 0) {
            this.speed = this.baseSpeed * 0.3; 
        } else {
            this.speed = this.baseSpeed;
        }

        this.vx = (state.player.x - this.x) / distToTarget * this.speed;
        this.vy = (state.player.y - this.y) / distToTarget * this.speed;

        if (distToTarget < 40) { 
            // Dash I-Frames implementation!
            if (!state.player.dash || !state.player.dash.active) {
                game.takeDamage(this.damage); 
                this.x -= this.vx * 5; 
                this.y -= this.vy * 5; 
            }
        }

        this.applyMovement(state);
    }
}