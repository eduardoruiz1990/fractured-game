// src/entities/Rorschach.js
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