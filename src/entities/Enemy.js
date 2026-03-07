// src/entities/Enemy.js
// The master class that all creatures inherit from.

export class Enemy {
    constructor(id, type, x, y, hp, speed, damage, color) {
        this.id = id;
        this.type = type;
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.hp = hp;
        this.maxHp = hp;
        this.speed = speed;
        this.baseSpeed = speed;
        this.damage = damage;
        this.color = color;
        this.flashTime = 0;
        this.buffed = false;
    }

    takeDamage(amount) {
        this.hp -= amount;
        this.flashTime = 5;
    }

    // Applies physics at the end of the frame
    applyMovement() {
        this.x += this.vx || 0;
        this.y += this.vy || 0;
        if (this.flashTime > 0) this.flashTime--;
    }

    // To be overridden by subclasses
    update(state, game) {
        this.applyMovement();
    }
}