// src/entities/Enemy.js
export class Enemy {
    constructor(type, damage, color, painSound = 'damage') {
        this.type = type;
        this.damage = damage;
        this.originalColor = color;
        this.painSound = painSound;
    }

    initBase(id, x, y, hp, speed) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.hp = hp;
        this.maxHp = hp;
        // Patch 62: the pool this entity STARTED with, kept separate from maxHp so
        // mechanics that grow an enemy mid-life (Predator feeding, Scavenger
        // vacuuming) can be capped against their origin rather than against a value
        // their own growth keeps moving. Director.applyEnemyVariant re-stamps this
        // after it scales a variant, so an ARMORED enemy's cap is based on its real
        // inflated pool rather than the pre-variant number.
        this.spawnMaxHp = hp;
        this.speed = speed;
        this.baseSpeed = speed;
        this.color = this.originalColor;
        this.flashTime = 0;
        this.buffed = false;
        this.confused = 0;
        this.active = true;
        this.speedModifier = 1.0; 
        this.acidTime = 0;
        this.acidDmg = 0;
        this.damageAccumulator = 0;
        this.damageTick = 0;
        this.painCooldown = 0; // NEW: Audio throttle for individual enemy hits
        this.knockbackX = 0;
        this.knockbackY = 0;
        // Patch 58: frames spent beyond the soft leash. MUST be reset here — these
        // entities are pooled, and a recycled straggler that kept a high strayTime
        // would spawn already sprinting at full catch-up boost.
        this.strayTime = 0;

        return this;
    }

    // knockbackForce is optional and defaults to 0 (no behavior change for the
    // many existing call sites that don't pass it). When present, direction is
    // always away from the player — every real caller's hit source is player-
    // centered (cone, aura, dash, orbiting blade), so there's no need to thread
    // a separate origin point through every call site.
    takeDamage(amount, game, knockbackForce = 0) {
        this.hp -= amount;
        this.flashTime = 5;
        this.lastHitByMelee = false;

        if (knockbackForce > 0 && game && game.state && game.state.player) {
            const dx = this.x - game.state.player.x;
            const dy = this.y - game.state.player.y;
            const dist = Math.max(Math.hypot(dx, dy), 0.001);
            this.knockbackX += (dx / dist) * knockbackForce;
            this.knockbackY += (dy / dist) * knockbackForce;
        }

        // NEW: Check if the enemy is allowed to scream again (prevents machine-gun audio overlap)
        if (this.painCooldown <= 0 && game && game.audioEngine && this.painSound) {
            game.audioEngine.playSFX(this.painSound, 0.3);
            this.painCooldown = 90; // Sets a 1.5 second silence period before it can scream again
        }
        
        this.damageAccumulator += amount;
        this.damageTick++;
        
        if (this.damageTick >= 15 || this.hp <= 0) {
            if (game && this.damageAccumulator >= 1) {
                let isFinal = this.hp <= 0;
                let color = this.damageAccumulator > 15 ? '#c5a059' : '#ffaaaa';
                if (isFinal) color = '#ff3333'; 
                let scale = isFinal ? 1.5 : 1.0;
                let life = isFinal ? 2.5 : 1.0; 
                
                game.spawnDamageText(this.x, this.y, Math.floor(this.damageAccumulator).toString(), color, scale, life);
            }
            this.damageAccumulator = 0;
            this.damageTick = 0;
        }
    }

    applyMovement(state, game) {
        // Tick down the audio pain cooldown
        if (this.painCooldown > 0) this.painCooldown--;

        let distToPlayer = Math.hypot(state.player.x - this.x, state.player.y - this.y);
        
        // --- LEASH (Patch 58) ---
        //
        // The old behaviour was a single hard rule: past 1500px, teleport. 1500px is
        // roughly twice the visible half-width at this zoom, so a straggler spent a
        // long time genuinely gone — the room felt empty — and then reappeared by
        // snapping into existence, which reads as a glitch rather than as pursuit.
        //
        // Now there are two stages. A soft stage nudges an enemy that has been
        // trailing for a while into closing the distance under its own power, and
        // the hard teleport is pulled in to 900px as a last resort for the cases the
        // nudge cannot fix (an enemy stuck behind geometry, or a dashing player
        // simply outrunning it).
        //
        // The TUTORIAL is a special case (Patch 60). There is exactly one enemy in
        // the room and the whole lesson depends on the player being able to see it,
        // so it gets a much tighter leash — and critically, it is returned to the
        // SAME on-screen radius Director uses to spawn it, rather than the 700px
        // used for ordinary rooms. 700px is outside the visible area on most
        // viewports, so the general-case teleport would have "rescued" the one
        // enemy in the game by hiding it, leaving the player wandering an empty
        // room. state.viewSafeRadius is published by Director.spawnWave from the
        // live canvas size; the fallback only matters if applyMovement somehow runs
        // before the first spawnWave tick.
        // Patch 61: the thresholds are derived from what the player can actually SEE,
        // not from fixed pixel constants. The old soft leash was a flat 520px, but the
        // visible half-height at 1080p is only ~415px — so an enemy that stopped
        // moving anywhere between those two numbers was off screen AND ignored by the
        // leash, forever. A Scavenger in its 'vacuuming' state does exactly that.
        // Worse, the pull's equilibrium WAS the threshold itself, so even a correctly
        // leashed enemy came to rest at 520px — still invisible. Hence RECOVERED
        // below: once help engages it keeps pulling until the enemy is genuinely back
        // on screen, rather than releasing it the instant it crosses the line.
        const isTutorial = !!state.isTutorial;
        const safeR = Number.isFinite(state.viewSafeRadius) ? state.viewSafeRadius : 220;
        const visible = Number.isFinite(state.viewHalfExtent) ? state.viewHalfExtent : 380;

        const SOFT_LEASH = isTutorial ? safeR * 1.5 : visible;
        const RECOVERED = SOFT_LEASH * 0.6;                  // comfortably back in frame
        const HARD_LEASH = isTutorial ? safeR * 2.2 : Math.max(600, visible * 2.2);
        const RETURN_RADIUS = isTutorial ? safeR : visible * 0.8;
        const STRAY_GRACE = isTutorial ? 45 : 90;            // tutorial gets help twice as fast
        const isLeashable = !['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'].includes(this.type);

        if (isLeashable) {
            if (distToPlayer > SOFT_LEASH) {
                this.strayTime = (this.strayTime || 0) + 1;
            } else if (distToPlayer < RECOVERED) {
                // Only a full return to view clears the debt. Between RECOVERED and
                // SOFT_LEASH the counter HOLDS, so an enemy already being pulled keeps
                // coming instead of stalling on the boundary.
                this.strayTime = 0;
            }

            // Ramped rather than a step change, so the correction arrives as an enemy
            // gradually gaining ground instead of a visible lurch in speed.
            if (this.strayTime > STRAY_GRACE) {
                const ramp = Math.min(1, (this.strayTime - STRAY_GRACE) / 180);
                const pull = this.speed * (0.3 + ramp * 0.7);
                const inv = 1 / Math.max(distToPlayer, 0.001);
                this.vx += (state.player.x - this.x) * inv * pull;
                this.vy += (state.player.y - this.y) * inv * pull;
            }

            if (distToPlayer > HARD_LEASH) {
                // Teleport generally in the direction the player is aiming/moving
                let aimAngle = state.player.angle + (Math.random() - 0.5) * Math.PI;
                this.x = state.player.x + Math.cos(aimAngle) * RETURN_RADIUS;
                this.y = state.player.y + Math.sin(aimAngle) * RETURN_RADIUS;
                // Cleared with the teleport: the enemy is back in play, and leaving it
                // set would keep the catch-up boost running on an enemy that no longer
                // needs it.
                this.strayTime = 0;
            }
        }

        if (this.confused > 0) {
            this.confused--;
            this.color = '#ffffff'; 
            
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
            if (this.acidTime > 0 && this.flashTime <= 0) {
                this.color = '#55ff55';
            } else {
                this.color = this.buffed ? '#ff0000' : this.originalColor;
            }
        }

        if (Math.random() < 0.0005 && game && game.audioEngine) {
            game.audioEngine.playSFX('enemy_ambient', 0.15);
        }

        this.x += (this.vx || 0) * this.speedModifier;
        this.y += (this.vy || 0) * this.speedModifier;

        // Knockback decays independently of vx/vy so it survives every entity
        // subclass recomputing vx/vy fresh each frame (chase/flee/orbit logic).
        if (this.knockbackX || this.knockbackY) {
            this.x += this.knockbackX;
            this.y += this.knockbackY;
            this.knockbackX *= 0.8;
            this.knockbackY *= 0.8;
            if (Math.abs(this.knockbackX) < 0.05) this.knockbackX = 0;
            if (Math.abs(this.knockbackY) < 0.05) this.knockbackY = 0;
        }

        if (this.flashTime > 0) this.flashTime--;
    }

    update(state, game) {
        this.applyMovement(state, game);
    }
}