import { Enemy } from './Enemy.js';

export class Predator extends Enemy {
    constructor() {
        super('PREDATOR', 15, '#8b0000');
    }

    init(id, x, y, stress) {
        return this.initBase(id, x, y, 45 * stress, 1.8 * stress);
    }

    update(state, game) {
        let bossExists = false;
        state.entities.forEach(e => { if(e.type === 'BOSS') bossExists = true; });

        let targetX = state.player.x; 
        let targetY = state.player.y;
        let distToTarget = Math.max(Math.hypot(targetX - this.x, targetY - this.y), 0.001);

        if (!bossExists) { 
            state.entities.forEach(other => {
                if (other.type === 'SCAVENGER') {
                    let d = Math.max(Math.hypot(other.x - this.x, other.y - this.y), 0.001);
                    if (d < distToTarget - 50) {
                        targetX = other.x; 
                        targetY = other.y; 
                        distToTarget = d;
                        if (d < 20) { 
                            other.hp = 0; 
                            this.hp += 20; 
                            game.spawnParticles(this.x, this.y, '#8b0000', 10); 
                        }
                    }
                }
            });
        }
        
        this.vx = (targetX - this.x) / distToTarget * this.speed;
        this.vy = (targetY - this.y) / distToTarget * this.speed;

        if (distToTarget < 20 && targetX === state.player.x) { 
            // Dash I-Frames implementation!
            // The Predator will only deal damage and bounce off the player IF the player is NOT actively dashing.
            if (!state.player.dash || !state.player.dash.active) {
                game.takeDamage(this.damage); 
                this.x -= this.vx * 10; 
                this.y -= this.vy * 10; 
            }
        }

        this.applyMovement(state);
    }
}