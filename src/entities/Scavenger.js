import { Enemy } from './Enemy.js';

export class Scavenger extends Enemy {
    constructor() {
        super('SCAVENGER', 2, '#555', 'scavenger_hurt'); 
        this.vacuumState = 'hunting'; 
        this.vacuumTimer = 0;
    }

    init(id, x, y, stress) {
        this.vacuumState = 'hunting';
        this.vacuumTimer = 0;
        return this.initBase(id, x, y, 20, 1.2 * stress);
    }

    update(state, game) {
        let bossExists = false; 
        let bossX = 0, bossY = 0;
        
        state.entities.forEach(e => { 
            if(e.type === 'BOSS') { bossExists = true; bossX = e.x; bossY = e.y; } 
        });

        if (bossExists && Math.hypot(bossX - this.x, bossY - this.y) < 300) {
            let bDist = Math.max(Math.hypot(bossX - this.x, bossY - this.y), 0.001);
            this.vx = (this.x - bossX) / bDist * this.speed * 2.5;
            this.vy = (this.y - bossY) / bDist * this.speed * 2.5;
            this.vacuumState = 'fleeing';
        } else {
            if (this.vacuumState === 'fleeing') this.vacuumState = 'hunting'; 

            if (this.vacuumState === 'vacuuming') {
                this.vx = 0;
                this.vy = 0;
                this.vacuumTimer--;

                state.xpDrops.forEach(xp => {
                    let d = Math.max(Math.hypot(xp.x - this.x, xp.y - this.y), 0.001);
                    if (d < 80) { 
                        xp.x += (this.x - xp.x) * 0.1;
                        xp.y += (this.y - xp.y) * 0.1;
                        if (d < 15) {
                            xp.collected = true; 
                            this.hp += 5; 
                            this.maxHp += 5; 
                            this.speed += 0.05;
                            game.spawnParticles(this.x, this.y, '#ffffff', 2);
                        }
                    }
                });

                if (this.vacuumTimer <= 0) {
                    this.vacuumState = 'fleeing';
                    this.vacuumTimer = 180; 
                }
            } else if (this.vacuumState === 'fleeing') {
                let distToPlayer = Math.max(Math.hypot(state.player.x - this.x, state.player.y - this.y), 0.001);
                this.vx = (this.x - state.player.x) / distToPlayer * this.speed * 1.5;
                this.vy = (this.y - state.player.y) / distToPlayer * this.speed * 1.5;
                
                this.vacuumTimer--;
                if (this.vacuumTimer <= 0) {
                    this.vacuumState = 'hunting';
                }
            } else {
                let nearestXP = null; 
                let minDist = 300; 
                
                state.xpDrops.forEach(xp => {
                    let d = Math.max(Math.hypot(xp.x - this.x, xp.y - this.y), 0.001);
                    if (d < minDist) { minDist = d; nearestXP = xp; }
                });

                if (nearestXP) {
                    this.vx = (nearestXP.x - this.x) / minDist * this.speed;
                    this.vy = (nearestXP.y - this.y) / minDist * this.speed;
                    
                    if (minDist < 60 && this.hp < 100 && Math.random() < 0.1) {
                        this.vacuumState = 'vacuuming';
                        this.vacuumTimer = 60; 
                    } else if (minDist < 15) { 
                        nearestXP.collected = true; 
                        this.hp += 10; 
                        this.maxHp += 10; 
                        this.speed += 0.1; 
                    }
                } else {
                    this.vx = Math.cos(state.frame * 0.05 + this.id) * (this.speed * 0.5);
                    this.vy = Math.sin(state.frame * 0.05 + this.id) * (this.speed * 0.5);
                }
            }
        }
        
        this.applyMovement(state, game);
    }
}