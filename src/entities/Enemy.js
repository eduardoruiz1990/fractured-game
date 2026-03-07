export class Enemy {
    constructor(type, damage, color) {
        this.type = type;
        this.damage = damage;
        this.originalColor = color;
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
        
        // Damage accumulators for the UI
        this.damageAccumulator = 0;
        this.damageTick = 0;
        
        return this;
    }

    takeDamage(amount, game) {
        this.hp -= amount;
        this.flashTime = 5;
        
        this.damageAccumulator += amount;
        this.damageTick++;
        
        // Pop floating text every quarter-second, or instantly on death
        if (this.damageTick >= 15 || this.hp <= 0) {
            if (game && this.damageAccumulator >= 1) {
                let isFinal = this.hp <= 0;
                
                // Color mapping: Regular hits are pinkish, huge hits are gold, final death hits are bloody red
                let color = this.damageAccumulator > 15 ? '#c5a059' : '#ffaaaa';
                if (isFinal) color = '#ff3333'; 
                
                // Final hits are 150% size and hang on the screen twice as long!
                let scale = isFinal ? 1.5 : 1.0;
                let life = isFinal ? 2.5 : 1.0; 
                
                game.spawnDamageText(this.x, this.y, Math.floor(this.damageAccumulator).toString(), color, scale, life);
            }
            this.damageAccumulator = 0;
            this.damageTick = 0;
        }
    }

    applyMovement(state) {
        if (this.confused > 0) {
            this.confused--;
            this.color = '#ffffff'; // White out
            
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
            this.color = this.buffed ? '#ff0000' : this.originalColor;
        }

        this.x += this.vx || 0;
        this.y += this.vy || 0;
        if (this.flashTime > 0) this.flashTime--;
    }

    update(state, game) {
        this.applyMovement(state);
    }
}