// src/entities/Enemy.js
// The master class that all creatures inherit from.

export class Enemy {
    constructor(type, damage, color) {
        // These properties never change, so we set them once on memory allocation
        this.type = type;
        this.damage = damage;
        this.originalColor = color;
    }

    // Called every time the entity is pulled from the Object Pool
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
        return this;
    }

    takeDamage(amount) {
        this.hp -= amount;
        this.flashTime = 5;
    }

    // Applies physics at the end of the frame
    applyMovement(state) {
        if (this.confused > 0) {
            this.confused--;
            this.color = '#ffffff'; // White out
            
            // Override normal AI to attack nearest entity
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

    // To be overridden by subclasses
    update(state, game) {
        this.applyMovement(state);
    }
}