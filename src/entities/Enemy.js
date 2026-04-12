// src/entities/Enemy.js
export class Enemy {
    constructor(type, damage, color, painSound = 'damage') {
        this.type = type;
        this.damage = damage;
        this.originalColor = color;
        this.painSound = painSound;
    }

    initBase(id, x, y, hp, speed) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.hp = hp;
        this.maxHp = hp;
        this.speed = speed;
        this.baseSpeed = speed;
        this.color = this.originalColor;
        this.flashTime = 0;
        this.buffed = false;
        this.confused = 0;
        this.active = true;
        this.speedModifier = 1.0; 
        this.acidTime = 0;
        this.acidDmg = 0;
        this.damageAccumulator = 0;
        this.damageTick = 0;
        this.painCooldown = 0; // NEW: Audio throttle for individual enemy hits
        
        return this;
    }

    takeDamage(amount, game) {
        this.hp -= amount;
        this.flashTime = 5;
        
        // NEW: Check if the enemy is allowed to scream again (prevents machine-gun audio overlap)
        if (this.painCooldown <= 0 && game && game.audioEngine && this.painSound) {
            game.audioEngine.playSFX(this.painSound, 0.3);
            this.painCooldown = 90; // Sets a 1.5 second silence period before it can scream again
        }
        
        this.damageAccumulator += amount;
        this.damageTick++;
        
        if (this.damageTick >= 15 || this.hp <= 0) {
            if (game && this.damageAccumulator >= 1) {
                let isFinal = this.hp <= 0;
                let color = this.damageAccumulator > 15 ? '#c5a059' : '#ffaaaa';
                if (isFinal) color = '#ff3333'; 
                let scale = isFinal ? 1.5 : 1.0;
                let life = isFinal ? 2.5 : 1.0; 
                
                game.spawnDamageText(this.x, this.y, Math.floor(this.damageAccumulator).toString(), color, scale, life);
            }
            this.damageAccumulator = 0;
            this.damageTick = 0;
        }
    }

    applyMovement(state, game) {
        // Tick down the audio pain cooldown
        if (this.painCooldown > 0) this.painCooldown--;

        let distToPlayer = Math.hypot(state.player.x - this.x, state.player.y - this.y);
        
        // If the player outruns the enemies and leaves them far behind, teleport them ahead
        if (distToPlayer > 1500 && !['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'].includes(this.type)) {
            let spawnRadius = 900;
            // Teleport generally in the direction the player is aiming/moving
            let aimAngle = state.player.angle + (Math.random() - 0.5) * Math.PI; 
            this.x = state.player.x + Math.cos(aimAngle) * spawnRadius;
            this.y = state.player.y + Math.sin(aimAngle) * spawnRadius;
        }

        if (this.confused > 0) {
            this.confused--;
            this.color = '#ffffff'; 
            
            let nearest = null; let minDist = 9999;
            if (state && state.entities) {
                state.entities.forEach(other => {
                    if (other.id !== this.id) {
                        let d = Math.hypot(other.x - this.x, other.y - this.y);
                        if (d < minDist) { minDist = d; nearest = other; }
                    }
                });
            }
            if (nearest) {
                this.vx = (nearest.x - this.x) / Math.max(minDist, 0.001) * this.speed * 1.5;
                this.vy = (nearest.y - this.y) / Math.max(minDist, 0.001) * this.speed * 1.5;
            }
        } else {
            if (this.acidTime > 0 && this.flashTime <= 0) {
                this.color = '#55ff55';
            } else {
                this.color = this.buffed ? '#ff0000' : this.originalColor;
            }
        }

        if (Math.random() < 0.0005 && game && game.audioEngine) {
            game.audioEngine.playSFX('enemy_ambient', 0.15);
        }

        this.x += (this.vx || 0) * this.speedModifier;
        this.y += (this.vy || 0) * this.speedModifier;
        if (this.flashTime > 0) this.flashTime--;
    }

    update(state, game) {
        this.applyMovement(state, game);
    }
}