import { Enemy } from './Enemy.js';

export class Amalgamation extends Enemy {
    constructor() {
        super('AMALGAMATION', 35, '#3a4a1a', 'boss_hurt');
        this.actionState = 'pulling';
        this.actionTimer = 0;
        this.gravityRadius = 800; // Massive pull radius
    }

    init(id, x, y) {
        this.phase = 0;
        this.actionState = 'pulling';
        this.actionTimer = 180;
        // Colossal HP, extremely slow movement
        return this.initBase(id, x, y, 6000, 0.4); 
    }

    update(state, game) {
        this.phase += 0.05;
        let dx = state.player.x - this.x;
        let dy = state.player.y - this.y;
        let distToPlayer = Math.max(Math.hypot(dx, dy), 0.001);

        // Always drift slowly towards the player
        this.vx = (dx / distToPlayer) * this.speed;
        this.vy = (dy / distToPlayer) * this.speed;

        if (this.actionState === 'pulling') {
            this.actionTimer--;
            
            // The Gravity Well Mechanic
            if (distToPlayer < this.gravityRadius) {
                let pullStrength = (1 - (distToPlayer / this.gravityRadius)) * 3.5;
                // Only pull if the player isn't actively dashing away
                if (!state.player.dash || !state.player.dash.active) {
                    state.player.x -= (dx / distToPlayer) * pullStrength;
                    state.player.y -= (dy / distToPlayer) * pullStrength;
                }
            }

            if (this.actionTimer <= 0) {
                this.actionState = 'spawning';
                this.actionTimer = 60;
                game.state.cameraShake = 25;
                if (game.audioEngine) game.audioEngine.playSFX('boss_intro', 0.8);
            }
        } 
        else if (this.actionState === 'spawning') {
            this.actionTimer--;
            
            // Vomit enemies periodically during this phase
            if (this.actionTimer % 15 === 0) {
                let spawnType = Math.random() < 0.3 ? 'PARASITE' : 'SCAVENGER';
                // Spawn them slightly offset from the boss center
                let sAngle = Math.random() * Math.PI * 2;
                game.director.spawnEntity(spawnType, null, null, this.x + Math.cos(sAngle)*60, this.y + Math.sin(sAngle)*60);
                game.spawnParticles(this.x, this.y, '#55ff55', 20);
                if (game.audioEngine) game.audioEngine.playSFX('enemy_spawn', 0.5);
            }

            if (this.actionTimer <= 0) {
                this.actionState = 'resting';
                this.actionTimer = 90;
            }
        } 
        else if (this.actionState === 'resting') {
            this.actionTimer--;
            if (this.actionTimer <= 0) {
                this.actionState = 'pulling';
                this.actionTimer = 240; 
                if (game.audioEngine) game.audioEngine.playSFX('boss_static', 0.5);
            }
        }

        // Contact damage
        if (distToPlayer < 70 && (!state.player.dash || !state.player.dash.active)) {
            if (state.frame % 15 === 0) game.takeDamage(this.damage);
        }

        this.applyMovement(state, game);
    }
}