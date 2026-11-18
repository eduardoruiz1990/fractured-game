import { Enemy } from './Enemy.js';
// Patch 94 — boss aggression. See src/core/Endless.js.
import { cadence } from '../core/Endless.js';

// Patch 131: the beam's reach, used by the hit test below AND drawn by Renderer
// (which reads ent.gazeRange), so the tell, the beam and the hitbox are one shape.
export const GAZE_RANGE = 650;

/** Pure hit test for the gaze — exported for test_bosses.js. */
export function gazeHits(angleDiff, dist, gazeWidth, gazeRange = GAZE_RANGE) {
    return Math.abs(angleDiff) < gazeWidth && dist < gazeRange;
}

export class Panopticon extends Enemy {
    constructor() {
        super('PANOPTICON', 26, '#ff0055', 'boss_hurt');   // Patch 189: contact 40 -> 26
        this.gazeState = 'moving';
        this.gazeTimer = 0;
        this.gazeAngle = 0;
        this.gazeWidth = 0.5; // Narrower, highly lethal beam
        // Patch 131 (V2 plan D6): the beam reaches GAZE_RANGE px and no further. It
        // used to hit at any distance, so the only escapes were dashing or outpacing
        // the sweep; stepping out of the beam's reach is now a third, readable one.
        this.gazeRange = GAZE_RANGE;
    }

    init(id, x, y) {
        this.phase = 0;
        this.gazeState = 'moving';
        this.gazeTimer = 120;
        this.gazeAngle = 0;
        this.aggression = 1;   // Patch 94 — pooled state; see the note in Boss.init.
        // Patch 189: 4000 -> 2600. The first boss has 800; a fivefold jump at floor 3,
        // with a sweep that could deal 90 of a new player's 100 Sanity, killed every
        // simulated player on every profile. It is still the hardest fight so far.
        return this.initBase(id, x, y, 2600, 1.2);
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
                this.gazeTimer = 150;   // Patch 189: was 180
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
            this.gazeAngle += Math.sign(angleDiff) * 0.0085;   // Patch 189: was 0.010; circling inside ~290 units now outruns it
            
            if (gazeHits(angleDiff, distToPlayer, this.gazeWidth, this.gazeRange)) {
                if (!state.player.dash || !state.player.dash.active) {
                    if (state.frame % 15 === 0) {
                        game.takeDamage(9, this.type);   // Patch 189: was 15 (a full sweep: 90 -> 45)
                        if (game.audioEngine) game.audioEngine.playSFX('player_hurt', 0.4);
                    }
                }
            }

            this.gazeTimer--;
            if (this.gazeTimer <= 0) {
                this.gazeState = 'recovering';
                // Patch 94: 'recovering' is the punish window — the only stretch where
                // this boss stands still and cannot retaliate. Shortening it is the
                // sharpest aggression lever it has. The 180-frame sweep above is the
                // ATTACK and is left alone: cutting it short would make the fight
                // easier, not harder.
                this.gazeTimer = cadence(60, this.aggression, 24);

                // Bullet Hell Burst
                // Patch 189: 18 bolts of 30 -> 14 of 16, so the ring has gaps to step through.
                for (let i = 0; i < 14; i++) {
                    let pAngle = (i / 14) * Math.PI * 2;
                    game.director.spawnProjectile(
                        this.x, this.y,
                        Math.cos(pAngle) * 5, Math.sin(pAngle) * 5, 
                        12, 16, '#ff0055', 240
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
                // The stalk before the next gaze — a cooldown, so it compresses.
                this.gazeTimer = cadence(120 + Math.random() * 60, this.aggression, 45);
            }
        }

        // Contact damage
        if (distToPlayer < 55 && (!state.player.dash || !state.player.dash.active)) {
            if (state.frame % 15 === 0) game.takeDamage(this.damage, this.type);
        }

        this.applyMovement(state, game);
    }
}