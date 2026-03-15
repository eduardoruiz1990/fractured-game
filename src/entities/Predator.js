import { Enemy } from './Enemy.js';

export class Predator extends Enemy {
    constructor() {
        super('PREDATOR', 15, '#8b0000', 'predator_hurt'); 
        this.attackState = 'hunting'; 
        this.attackTimer = 0;
        this.lungeVx = 0;
        this.lungeVy = 0;
    }

    init(id, x, y, stress) {
        this.attackState = 'hunting';
        this.attackTimer = 0;
        return this.initBase(id, x, y, 45 * stress, 1.8 * stress);
    }

    update(state, game) {
        let bossExists = false;
        state.entities.forEach(e => { if(e.type === 'BOSS') bossExists = true; });

        let targetX = state.player.x; 
        let targetY = state.player.y;
        let distToTarget = Math.max(Math.hypot(targetX - this.x, targetY - this.y), 0.001);

        if (this.attackState === 'telegraphing') {
            let aimAngle = Math.atan2(targetY - this.y, targetX - this.x);
            this.lungeVx = Math.cos(aimAngle);
            this.lungeVy = Math.sin(aimAngle);
            
            this.vx = this.lungeVx * 0.001; 
            this.vy = this.lungeVy * 0.001;

            this.attackTimer--;
            if (this.attackTimer <= 0) {
                this.attackState = 'lunging';
                this.attackTimer = 20; 
                if (game.audioEngine) game.audioEngine.playSFX('dash', 0.5); 
            }
        } 
        else if (this.attackState === 'lunging') {
            this.vx = this.lungeVx * this.speed * 4.5; 
            this.vy = this.lungeVy * this.speed * 4.5;
            
            this.attackTimer--;
            if (this.attackTimer <= 0) {
                this.attackState = 'hunting';
                this.attackTimer = 120 + Math.random() * 120; 
            }
        }
        else {
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

            this.attackTimer--;
            if (this.attackTimer <= 0 && distToTarget < 250 && distToTarget > 80 && Math.random() < 0.02) {
                this.attackState = 'telegraphing';
                this.attackTimer = 45; 
            }
        }

        if (distToTarget < 20 && targetX === state.player.x) { 
            if (!state.player.dash || !state.player.dash.active) {
                game.takeDamage(this.damage); 
                
                this.x -= this.vx * 10; 
                this.y -= this.vy * 10; 
                
                if (this.attackState === 'lunging') {
                    this.attackState = 'hunting';
                    this.attackTimer = 60;
                }
            }
        }

        this.applyMovement(state, game);
    }
}