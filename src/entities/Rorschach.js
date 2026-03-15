// src/entities/Rorschach.js
// Epic 5 Split-Boss Entity

export class Rorschach {
    constructor() {
        this.active = false;
    }

    init(id, x, y, generation = 1) {
        this.id = id;
        this.type = 'RORSCHACH';
        this.generation = generation; // 1 = Huge, 2 = Medium, 3 = Small Swarm
        this.x = x;
        this.y = y;
        
        // Stats scale based on generation
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
        
        if (dist > 0) {
            this.vx += (dx / dist) * this.speed * 0.1;
            this.vy += (dy / dist) * this.speed * 0.1;
        }
        
        // Erratic, flowing ink movement
        this.vx += Math.cos(this.phase * 0.5) * 0.3;
        this.vy += Math.sin(this.phase * 0.7) * 0.3;
        
        this.vx *= 0.95; // Friction
        this.vy *= 0.95;
        
        this.x += this.vx * (this.speedModifier || 1.0);
        this.y += this.vy * (this.speedModifier || 1.0);
        
        if (dist < this.radius + state.player.radius && state.sanity > 0 && this.confused <= 0) {
            // Smaller pieces deal less damage per hit, but overwhelm via swarm
            if (state.frame % 30 === 0) game.takeDamage(20 / this.generation);
        }
    }

    takeDamage(amount, game) {
        this.hp -= amount;
        this.flashTime = 4;
    }
}