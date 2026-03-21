import { Enemy } from './Enemy.js';

export class Architect extends Enemy {
    constructor() {
        super('ARCHITECT', 50, '#ffffff', 'boss_hurt');
        this.actionState = 'hovering';
        this.actionTimer = 0;
        this.burstCount = 0;
        this.safeZoneRadius = 250;
    }

    init(id, x, y) {
        this.phase = 0;
        this.actionState = 'hovering';
        this.actionTimer = 120;
        this.burstCount = 0;
        return this.initBase(id, x, y, 8000, 1.5); 
    }

    update(state, game) {
        this.phase += 0.05;
        let dx = state.player.x - this.x;
        let dy = state.player.y - this.y;
        let distToPlayer = Math.max(Math.hypot(dx, dy), 0.001);
        let angleToPlayer = Math.atan2(dy, dx);

        // --- NEW: MEMORY OPTIMIZATION (SPATIAL CULLING) ---
        // Actively deload bullets that fly way off-screen to prevent framerate tanking
        if (state.frame % 30 === 0 && state.projectiles) {
            for (let i = 0; i < state.projectiles.length; i++) {
                let p = state.projectiles[i];
                // If a bullet is more than 1000 pixels away from the player, it's off-screen. Kill it.
                if (Math.hypot(p.x - state.player.x, p.y - state.player.y) > 1000) {
                    p.life = 0; 
                }
            }
        }

        if (this.actionState === 'hovering') {
            let targetSpeed = this.speed;
            if (distToPlayer < 300) targetSpeed = -this.speed * 0.5;
            else if (distToPlayer > 400) targetSpeed = this.speed * 1.2;

            this.vx = Math.cos(angleToPlayer) * targetSpeed;
            this.vy = Math.sin(angleToPlayer) * targetSpeed;

            if (this.actionTimer % 45 === 0) {
                game.director.spawnProjectile(
                    this.x, this.y,
                    Math.cos(angleToPlayer) * 7, Math.sin(angleToPlayer) * 7,
                    15, 25, '#ffffff', 120 // Reduced life from 200 to 120
                );
                if (game.audioEngine) game.audioEngine.playSFX('enemy_spawn', 0.5);
            }
            
            this.actionTimer--;
            if (this.actionTimer <= 0) {
                this.actionState = Math.random() < 0.5 ? 'burst' : 'charging_collapse';
                if (this.actionState === 'burst') this.actionTimer = 90;
                else {
                    this.actionTimer = 180; 
                    game.state.cameraShake = 20;
                    if (game.audioEngine) game.audioEngine.playSFX('boss_intro', 1.0);
                }
            }
        } 
        else if (this.actionState === 'burst') {
            this.vx *= 0.9;
            this.vy *= 0.9;
            
            if (this.actionTimer % 15 === 0) {
                this.burstCount++;
                let numBullets = 8;
                for (let i = 0; i < numBullets; i++) {
                    let pAngle = (i / numBullets) * Math.PI * 2 + (this.burstCount * 0.2);
                    game.director.spawnProjectile(
                        this.x, this.y,
                        Math.cos(pAngle) * 5, Math.sin(pAngle) * 5,
                        10, 20, '#c5a059', 150 // Reduced life from 240 to 150
                    );
                }
                if (game.audioEngine) game.audioEngine.playSFX('breaker_box', 0.6);
            }

            this.actionTimer--;
            if (this.actionTimer <= 0) {
                this.actionState = 'hovering';
                this.actionTimer = 180;
            }
        } 
        else if (this.actionState === 'charging_collapse') {
            this.vx = 0;
            this.vy = 0;
            this.actionTimer--;

            if (this.actionTimer <= 0) {
                this.actionState = 'collapse_active';
                this.actionTimer = 600; // ENHANCED: Lasts 10 full seconds
                game.state.cameraShake = 40;
                if (game.audioEngine) game.audioEngine.playSFX('death', 1.5);
            }
        }
        else if (this.actionState === 'collapse_active') {
            // The safe zone slowly drifts!
            this.vx = Math.cos(this.phase * 0.3) * this.speed * 0.8;
            this.vy = Math.sin(this.phase * 0.4) * this.speed * 0.8;
            
            // Continuous Bullet Hell
            if (this.actionTimer % 12 === 0) {
                this.burstCount++;
                let numBullets = 4;
                for (let i = 0; i < numBullets; i++) {
                    let pAngle = (i / numBullets) * Math.PI * 2 + (this.burstCount * 0.3);
                    game.director.spawnProjectile(
                        this.x, this.y,
                        Math.cos(pAngle) * 3.5, Math.sin(pAngle) * 3.5,
                        10, 20, '#c5a059', 180 // Reduced life from 240 to 180
                    );
                }
                if (this.actionTimer % 36 === 0 && game.audioEngine) {
                    game.audioEngine.playSFX('enemy_ambient', 0.2);
                }
            }

            // Targeted Shots
            if (this.actionTimer % 60 === 0) {
                let pAngle = Math.atan2(state.player.y - this.y, state.player.x - this.x);
                game.director.spawnProjectile(
                    this.x, this.y,
                    Math.cos(pAngle) * 7, Math.sin(pAngle) * 7,
                    14, 25, '#ffffff', 120 // Reduced life from 200 to 120
                );
                if (game.audioEngine) game.audioEngine.playSFX('enemy_spawn', 0.4);
            }

            if (distToPlayer > this.safeZoneRadius) {
                if (!state.player.dash || !state.player.dash.active) {
                    if (state.frame % 15 === 0) { 
                        game.takeDamage(25);
                        if (game.audioEngine) game.audioEngine.playSFX('player_hurt', 0.8);
                    }
                }
            }

            this.actionTimer--;
            if (this.actionTimer <= 0) {
                this.actionState = 'hovering';
                this.actionTimer = 120 + Math.random() * 60;
            }
        }

        if (distToPlayer < 60 && (!state.player.dash || !state.player.dash.active)) {
            if (state.frame % 15 === 0) game.takeDamage(this.damage);
        }

        this.applyMovement(state, game);
    }
}