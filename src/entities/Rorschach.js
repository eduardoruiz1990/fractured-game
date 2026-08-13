// src/entities/Rorschach.js
// Patch 94 — boss aggression. NOTE this class does NOT extend Enemy: it has no
// baseDamage, no spawnMaxHp and no `damage` field at all, which is why
// Director.applyEndlessScaling guards every field it touches.
import { cadence } from '../core/Endless.js';

export class Rorschach {
    constructor() {
        this.active = false;
    }

    init(id, x, y, generation = 1) {
        this.id = id;
        this.type = 'RORSCHACH';
        this.generation = generation; 
        this.x = x;
        this.y = y;
        
        this.maxHp = generation === 1 ? 2500 : (generation === 2 ? 900 : 350);
        this.hp = this.maxHp;
        this.radius = generation === 1 ? 55 : (generation === 2 ? 35 : 20);
        this.speed = generation === 1 ? 0.8 : (generation === 2 ? 1.6 : 2.8);
        
        this.vx = 0;
        this.vy = 0;
        this.phase = Math.random() * Math.PI * 2;
        this.color = '#1a0525';
        this.flashTime = 0;
        this.confused = 0;
        this.acidTime = 0;
        this.acidDmg = 0;
        
        this.shootState = 'hunting';
        this.shootTimer = 180 + Math.random() * 120;
        this.shootAngle = 0;
        // Patch 94: cleared on every init, like every other pooled field here — see
        // the note in Boss.init. A split child re-inits through this same path, then
        // Director.applyEndlessScaling re-stamps it, so children inherit the parent's
        // difficulty rather than spawning as Cycle I bosses mid-fight.
        this.aggression = 1;

        this.active = true;
        return this;
    }

    update(state, game) {
        if (this.flashTime > 0) this.flashTime--;
        if (this.confused > 0) this.confused--;
        
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

        if (this.shootState === 'telegraphing') {
            this.vx = 0;
            this.vy = 0;
            this.shootTimer--;
            
            this.shootAngle = Math.atan2(targetY - this.y, targetX - this.x);

            if (this.shootTimer <= 0) {
                this.shootState = 'hunting';
                // Patch 94: the volley COOLDOWN. The 45-frame telegraph that precedes
                // it is left alone — Renderer draws its warning line's alpha as
                // `1 - shootTimer/45`, and it is the only warning this attack gives.
                this.shootTimer = cadence(180 + Math.random() * 120, this.aggression, 60);

                let count = this.generation === 1 ? 5 : (this.generation === 2 ? 3 : 1);
                let spread = 0.5; 
                let pSpeed = 3.0 + this.generation; 
                let pDmg = 35 / this.generation; 
                
                // NEW: Enemy Dash Hook
                if (game.audioEngine) game.audioEngine.playSFX('enemy_dash', 0.8); 
                
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
                this.shootTimer = 45; 
            }
            
            if (dist > 0) {
                this.vx += (dx / dist) * this.speed * 0.1;
                this.vy += (dy / dist) * this.speed * 0.1;
            }
            
            this.vx += Math.cos(this.phase * 0.5) * 0.3;
            this.vy += Math.sin(this.phase * 0.7) * 0.3;
            
            this.vx *= 0.95; 
            this.vy *= 0.95;
            
            this.x += this.vx * (this.speedModifier || 1.0);
            this.y += this.vy * (this.speedModifier || 1.0);
        }

        if (Math.random() < 0.001 && game && game.audioEngine) {
            game.audioEngine.playSFX('enemy_ambient', 0.2);
        }
        
        if (dist < this.radius + state.player.radius && state.sanity > 0 && this.confused <= 0) {
            if (state.frame % 30 === 0) game.takeDamage(20 / this.generation);
        }
    }

    takeDamage(amount, game) {
        this.hp -= amount;
        this.flashTime = 4;
        if (game && game.audioEngine) game.audioEngine.playSFX('boss_hurt', 0.5);
    }
}