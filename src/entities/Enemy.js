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
        
        // Supports the new Ink Puddle slowing effect
        this.speedModifier = 1.0; 
        
        // Supports the Corrosive Battery effect
        this.acidTime = 0;
        this.acidDmg = 0;
        
        this.damageAccumulator = 0;
        this.damageTick = 0;
        
        return this;
    }

    takeDamage(amount, game) {
        this.hp -= amount;
        this.flashTime = 5;
        
        this.damageAccumulator += amount;
        this.damageTick++;
        
        if (this.damageTick >= 15 || this.hp <= 0) {
            if (game && this.damageAccumulator >= 1) {
                let isFinal = this.hp <= 0;
                
                let color = this.damageAccumulator > 15 ? '#c5a059' : '#ffaaaa';
                if (isFinal) color = '#ff3333'; 
                
                // Huge scaling text for death blows!
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
            // Tint them sickly green if they are currently melting from acid
            if (this.acidTime > 0 && this.flashTime <= 0) {
                this.color = '#55ff55';
            } else {
                this.color = this.buffed ? '#ff0000' : this.originalColor;
            }
        }

        // Modifier applies Ink slowness
        this.x += (this.vx || 0) * this.speedModifier;
        this.y += (this.vy || 0) * this.speedModifier;
        if (this.flashTime > 0) this.flashTime--;
    }

    update(state, game) {
        this.applyMovement(state);
    }
}