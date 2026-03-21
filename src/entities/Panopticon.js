import { Enemy } from './Enemy.js';

export class Panopticon extends Enemy {
    constructor() {
        super('PANOPTICON', 40, '#ff0055', 'boss_hurt');
        this.gazeState = 'moving';
        this.gazeTimer = 0;
        this.gazeAngle = 0;
        this.gazeWidth = 0.5; // Narrower, highly lethal beam
    }

    init(id, x, y) {
        this.phase = 0;
        this.gazeState = 'moving';
        this.gazeTimer = 120;
        this.gazeAngle = 0;
        return this.initBase(id, x, y, 4000, 1.2); 
    }

    update(state, game) {
        this.phase += 0.05;
        let dx = state.player.x - this.x;
        let dy = state.player.y - this.y;
        let distToPlayer = Math.max(Math.hypot(dx, dy), 0.001);
        let angleToPlayer = Math.atan2(dy, dx);

        if (this.gazeState === 'moving') {
            // --- NEW: THE TETHER MECHANIC ---
            // Ensure the boss stays right at the edge of the flashlight range without drifting into the void
            let targetSpeed = this.speed;
            if (distToPlayer > 350) targetSpeed = this.speed * 2.5; // It aggressively speeds up to catch you!
            else if (distToPlayer < 200) targetSpeed = this.speed * 0.5; // It slows down to let you attack it safely!

            this.vx = Math.cos(angleToPlayer) * targetSpeed;
            this.vy = Math.sin(angleToPlayer) * targetSpeed;
            
            this.gazeTimer--;
            if (this.gazeTimer <= 0) {
                this.gazeState = 'charging';
                this.gazeTimer = 45;
                if (game.audioEngine) game.audioEngine.playSFX('boss_intro', 0.8);
            }
        } 
        else if (this.gazeState === 'charging') {
            this.vx *= 0.8;
            this.vy *= 0.8;
            this.gazeTimer--;
            this.gazeAngle = angleToPlayer;

            if (this.gazeTimer <= 0) {
                this.gazeState = 'sweeping';
                this.gazeTimer = 180; 
                game.state.cameraShake = 20;
            }
        } 
        else if (this.gazeState === 'sweeping') {
            this.vx = 0;
            this.vy = 0;
            
            let angleDiff = angleToPlayer - this.gazeAngle;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            
            // --- NERFED: SLOWER BEAM SWEEP ---
            // Reduced from 0.015 to 0.010 so it's noticeably slower than your sprint speed!
            this.gazeAngle += Math.sign(angleDiff) * 0.010; 
            
            if (Math.abs(angleDiff) < this.gazeWidth) {
                if (!state.player.dash || !state.player.dash.active) {
                    if (state.frame % 15 === 0) {
                        game.takeDamage(15); 
                        if (game.audioEngine) game.audioEngine.playSFX('player_hurt', 0.4);
                    }
                }
            }

            this.gazeTimer--;
            if (this.gazeTimer <= 0) {
                this.gazeState = 'recovering';
                this.gazeTimer = 60;
                
                // Bullet Hell Burst
                for (let i = 0; i < 18; i++) {
                    let pAngle = (i / 18) * Math.PI * 2;
                    game.director.spawnProjectile(
                        this.x, this.y,
                        Math.cos(pAngle) * 5, Math.sin(pAngle) * 5, 
                        12, 30, '#ff0055', 240
                    );
                }
                if (game.audioEngine) game.audioEngine.playSFX('breaker_box', 1.0);
            }
        } 
        else if (this.gazeState === 'recovering') {
            this.vx = 0;
            this.vy = 0;
            this.gazeTimer--;
            if (this.gazeTimer <= 0) {
                this.gazeState = 'moving';
                this.gazeTimer = 120 + Math.random() * 60;
            }
        }

        // Contact damage
        if (distToPlayer < 55 && (!state.player.dash || !state.player.dash.active)) {
            if (state.frame % 15 === 0) game.takeDamage(this.damage);
        }

        this.applyMovement(state, game);
    }
}