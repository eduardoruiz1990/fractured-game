// src/entities/Rorschach.js
// Epic 5 Split-Boss Entity
import { Enemy } from './Enemy.js';

export class Rorschach extends Enemy {
    constructor() {
        super('RORSCHACH', 20, '#1a0525');
        this.generation = 1;
        this.phase = 0;
        this.shootState = 'hunting';
        this.shootTimer = 0;
        this.shootAngle = 0;
    }

    init(id, x, y, generation = 1) {
        this.generation = generation;
        this.phase = Math.random() * Math.PI * 2;
        this.shootState = 'hunting';
        this.shootTimer = 180 + Math.random() * 120; // 3-5 seconds before first shot
        
        const hp = generation === 1 ? 2500 : (generation === 2 ? 900 : 350);
        const speed = generation === 1 ? 0.8 : (generation === 2 ? 1.6 : 2.8);
        this.radius = generation === 1 ? 55 : (generation === 2 ? 35 : 20);
        
        return this.initBase(id, x, y, hp, speed);
    }

    update(state, game) {
        this.phase += 0.05;
        let targetX = state.player.x;
        let targetY = state.player.y;
        
        if (this.confused > 0) {
            targetX += Math.cos(this.phase) * 300;
            targetY += Math.sin(this.phase) * 300;
        }
        
        const dx = targetX - this.x;
        const dy = targetY - this.y;
        const dist = Math.hypot(dx, dy);

        // --- Ranged Attack Logic ---
        if (this.shootState === 'telegraphing') {
            this.vx = 0;
            this.vy = 0;
            this.shootTimer--;
            
            // Lock onto player
            this.shootAngle = Math.atan2(targetY - this.y, targetX - this.x);

            if (this.shootTimer <= 0) {
                this.shootState = 'hunting';
                this.shootTimer = 180 + Math.random() * 120; 
                
                let count = this.generation === 1 ? 5 : (this.generation === 2 ? 3 : 1);
                let spread = 0.5; 
                let pSpeed = 3.0 + this.generation; 
                let pDmg = 35 / this.generation; 
                
                if (game.audioEngine) game.audioEngine.playSFX('dash', 0.5); 
                
                for (let i = 0; i < count; i++) {
                    let angle = this.shootAngle;
                    if (count > 1) {
                        angle += -spread/2 + (spread / (count - 1)) * i;
                    }
                    game.director.spawnProjectile(
                        this.x, this.y, 
                        Math.cos(angle) * pSpeed, Math.sin(angle) * pSpeed, 
                        10, pDmg, '#ff0055', 300
                    );
                }
            }
        } else {
            this.shootTimer--;
            if (this.shootTimer <= 0 && state.sanity > 0 && this.confused <= 0) {
                this.shootState = 'telegraphing';
                this.shootTimer = 45; // 0.75 seconds to react to the laser pointer
            }
            
            if (dist > 0) {
                this.vx += (dx / dist) * this.speed * 0.1;
                this.vy += (dy / dist) * this.speed * 0.1;
            }
            
            // Erratic, flowing ink movement
            this.vx += Math.cos(this.phase * 0.5) * 0.3;
            this.vy += Math.sin(this.phase * 0.7) * 0.3;
            
            this.vx *= 0.95; 
            this.vy *= 0.95;
        }
        
        // Melee collision
        if (dist < this.radius + state.player.radius && state.sanity > 0 && this.confused <= 0) {
            if (state.frame % 30 === 0) game.takeDamage(20 / this.generation);
        }

        this.applyMovement(state);
    }
}