// src/entities/Scavenger.js
import { Enemy } from './Enemy.js';

export class Scavenger extends Enemy {
    constructor(id, x, y, stress) {
        super(id, 'SCAVENGER', x, y, 20, 1.2 * stress, 2, '#555');
    }

    update(state, game) {
        let bossExists = false; 
        let bossX = 0, bossY = 0;
        
        state.entities.forEach(e => { 
            if(e.type === 'BOSS') { bossExists = true; bossX = e.x; bossY = e.y; } 
        });

        // Flee boss mechanic
        if (bossExists && Math.hypot(bossX - this.x, bossY - this.y) < 300) {
            let bDist = Math.max(Math.hypot(bossX - this.x, bossY - this.y), 0.001);
            this.vx = (this.x - bossX) / bDist * this.speed * 2;
            this.vy = (this.y - bossY) / bDist * this.speed * 2;
        } else {
            // Seek Lucidity (XP)
            let nearestXP = null; 
            let minDist = 300; 
            
            state.xpDrops.forEach(xp => {
                let d = Math.max(Math.hypot(xp.x - this.x, xp.y - this.y), 0.001);
                if (d < minDist) { minDist = d; nearestXP = xp; }
            });

            if (nearestXP) {
                this.vx = (nearestXP.x - this.x) / minDist * this.speed;
                this.vy = (nearestXP.y - this.y) / minDist * this.speed;
                if (minDist < 15) { 
                    nearestXP.collected = true; 
                    this.hp += 10; 
                    this.maxHp += 10; 
                    this.speed += 0.1; 
                }
            } else {
                // Wander
                this.vx = Math.cos(state.frame * 0.05 + this.id) * (this.speed * 0.5);
                this.vy = Math.sin(state.frame * 0.05 + this.id) * (this.speed * 0.5);
            }
        }
        
        this.applyMovement(state);
    }
}