import { Enemy } from './Enemy.js';

export class Parasite extends Enemy {
    constructor() {
        super('PARASITE', 0, '#a0522d');
        this.lashingState = 'searching'; // searching, lashing
        this.lashTarget = null;
        this.lashTimer = 0;
    }

    init(id, x, y) {
        this.lashingState = 'searching';
        this.lashTarget = null;
        this.lashTimer = 0;
        return this.initBase(id, x, y, 15, 3.0);
    }

    update(state, game) {
        if (this.lashingState === 'lashing') {
            // Check if target is still valid
            if (!this.lashTarget || this.lashTarget.hp <= 0 || this.lashTarget.buffed) {
                this.lashingState = 'searching';
                this.lashTarget = null;
            } else {
                // Stop and pull towards target
                let minDist = Math.max(Math.hypot(this.lashTarget.x - this.x, this.lashTarget.y - this.y), 0.001);
                
                // Telegraph visual (drawn in Renderer later, but we need to stop moving)
                this.vx = 0;
                this.vy = 0;
                
                this.lashTimer--;
                if (this.lashTimer <= 0) {
                    // Rapid merge
                    this.x += (this.lashTarget.x - this.x) * 0.5;
                    this.y += (this.lashTarget.y - this.y) * 0.5;
                    
                    if (minDist < 25) {
                        this.lashTarget.buffed = true; 
                        this.lashTarget.speed *= 1.5; 
                        this.lashTarget.damage *= 2; 
                        this.lashTarget.color = '#ff0000'; 
                        
                        // AoE Knockback on player if close
                        let distToPlayer = Math.max(Math.hypot(state.player.x - this.x, state.player.y - this.y), 0.001);
                        if (distToPlayer < 80 && (!state.player.dash || !state.player.dash.active)) {
                             game.takeDamage(5);
                             // Calculate knockback vector
                             let kbVx = (state.player.x - this.x) / distToPlayer;
                             let kbVy = (state.player.y - this.y) / distToPlayer;
                             
                             // Since we can't directly manipulate player pos reliably here without feeling janky,
                             // we'll rely on the visual explosion and damage for impact.
                        }
                        
                        this.hp = 0; // Kills the parasite
                        game.spawnParticles(this.lashTarget.x, this.lashTarget.y, '#ff0000', 30);
                        if (game.audioEngine) game.audioEngine.playSFX('damage', 0.5); // Use damage sound for burst
                    }
                }
            }
        } else {
            // Searching State
            let target = null; 
            let minDist = 500;
            
            state.entities.forEach(other => {
                if (other.type === 'PREDATOR' && !other.buffed) {
                    let d = Math.max(Math.hypot(other.x - this.x, other.y - this.y), 0.001);
                    if (d < minDist) { minDist = d; target = other; }
                }
            });

            if (target) {
                this.vx = (target.x - this.x) / minDist * this.speed;
                this.vy = (target.y - this.y) / minDist * this.speed;
                
                // Trigger Lash Telegraph if close
                if (minDist < 100 && minDist > 40) {
                    this.lashingState = 'lashing';
                    this.lashTarget = target;
                    this.lashTimer = 30; // 0.5s pause before merge
                } else if (minDist <= 40) {
                     // Failsafe immediate merge
                     target.buffed = true; 
                     target.speed *= 1.5; 
                     target.damage *= 2; 
                     target.color = '#ff0000'; 
                     this.hp = 0;
                     game.spawnParticles(target.x, target.y, '#ff0000', 15);
                }
            } else {
                // Orbit Player
                const angleToPlayer = Math.atan2(state.player.y - this.y, state.player.x - this.x);
                this.vx = Math.cos(angleToPlayer + Math.PI/2) * this.speed;
                this.vy = Math.sin(angleToPlayer + Math.PI/2) * this.speed;
            }
        }

        this.applyMovement(state);
    }
}