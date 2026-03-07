// src/entities/Parasite.js
import { Enemy } from './Enemy.js';

export class Parasite extends Enemy {
    constructor(id, x, y) {
        super(id, 'PARASITE', x, y, 15, 3.0, 0, '#a0522d');
    }

    update(state, game) {
        let target = null; 
        let minDist = 500;
        
        state.entities.forEach(other => {
            if (other.type === 'PREDATOR' && !other.buffed) {
                let d = Math.max(Math.hypot(other.x - this.x, other.y - this.y), 0.001);
                if (d < minDist) { minDist = d; target = other; }
            }
        });

        if (target) {
            this.vx = (target.x - this.x) / minDist * this.speed;
            this.vy = (target.y - this.y) / minDist * this.speed;
            
            if (minDist < 15) {
                target.buffed = true; 
                target.speed *= 1.5; 
                target.damage *= 2; 
                target.color = '#ff0000'; 
                this.hp = 0; // Kills the parasite
                game.spawnParticles(target.x, target.y, '#ff0000', 15);
            }
        } else {
            // Orbit Player
            const angleToPlayer = Math.atan2(state.player.y - this.y, state.player.x - this.x);
            this.vx = Math.cos(angleToPlayer + Math.PI/2) * this.speed;
            this.vy = Math.sin(angleToPlayer + Math.PI/2) * this.speed;
        }

        this.applyMovement();
    }
}