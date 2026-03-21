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
        // Massive HP for the final encounter
        return this.initBase(id, x, y, 8000, 1.5); 
    }

    update(state, game) {
        this.phase += 0.05;
        let dx = state.player.x - this.x;
        let dy = state.player.y - this.y;
        let distToPlayer = Math.max(Math.hypot(dx, dy), 0.001);
        let angleToPlayer = Math.atan2(dy, dx);

        if (this.actionState === 'hovering') {
            // Cold, calculated pursuit. Keep a slight distance.
            let targetSpeed = this.speed;
            if (distToPlayer < 300) targetSpeed = -this.speed * 0.5; // Back away if too close
            else if (distToPlayer > 400) targetSpeed = this.speed * 1.2;

            this.vx = Math.cos(angleToPlayer) * targetSpeed;
            this.vy = Math.sin(angleToPlayer) * targetSpeed;

            // Periodically shoot a fast, targeted projectile
            if (this.actionTimer % 45 === 0) {
                game.director.spawnProjectile(
                    this.x, this.y,
                    Math.cos(angleToPlayer) * 7, Math.sin(angleToPlayer) * 7,
                    15, 25, '#ffffff', 200
                );
                if (game.audioEngine) game.audioEngine.playSFX('enemy_spawn', 0.5);
            }
            
            this.actionTimer--;
            if (this.actionTimer <= 0) {
                this.actionState = Math.random() < 0.5 ? 'burst' : 'charging_collapse';
                if (this.actionState === 'burst') this.actionTimer = 90;
                else {
                    this.actionTimer = 180; // 3 seconds to get inside the safe zone!
                    game.state.cameraShake = 20;
                    if (game.audioEngine) game.audioEngine.playSFX('boss_intro', 1.0);
                }
            }
        } 
        else if (this.actionState === 'burst') {
            // Slow down and fire rotating spirals
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
                        10, 20, '#c5a059', 240
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
            // Lock in place. The player MUST get inside the safe zone radius.
            this.vx = 0;
            this.vy = 0;
            this.actionTimer--;

            if (this.actionTimer <= 0) {
                this.actionState = 'collapse_active';
                this.actionTimer = 60; // The collapse lasts 1 second
                game.state.cameraShake = 40;
                if (game.audioEngine) game.audioEngine.playSFX('death', 1.5);
            }
        }
        else if (this.actionState === 'collapse_active') {
            // The deadly phase! Anyone OUTSIDE the safe zone takes massive damage.
            this.vx = 0;
            this.vy = 0;
            
            if (distToPlayer > this.safeZoneRadius) {
                if (!state.player.dash || !state.player.dash.active) {
                    if (state.frame % 15 === 0) { // Throttled to prevent stun-lock
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

        // Standard Contact damage
        if (distToPlayer < 60 && (!state.player.dash || !state.player.dash.active)) {
            if (state.frame % 15 === 0) game.takeDamage(this.damage);
        }

        this.applyMovement(state, game);
    }
}