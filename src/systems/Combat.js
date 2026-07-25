// src/systems/Combat.js
import { getActiveSynergies } from '../data/Manifestations.js';

// Patch 16: generic tag-scaled knockback, consumed by Enemy.takeDamage's
// optional knockbackForce param. Only wired at call sites with no existing
// hand-tuned push (camera's 30px shove, lead_pipe's 25px shove, and the
// centrifuge synergy's deliberately-capped 12px are left untouched — they
// already have impulse-like behavior and are separately tuned).
function tagKnockback(tags, damage) {
    if (!tags || tags.includes('aura') || tags.includes('passive')) return 0;
    if (tags.includes('kinetic') || tags.includes('melee')) return Math.min(14, 3 + damage * 0.4);
    return Math.min(6, 1 + damage * 0.15);
}

// Patch 18: cameraShake-only impact weight by tag. Deliberately NOT generalizing
// hitStop here — hitStop is a full sim freeze (Game.processGameLogic short-circuits
// every frame it's > 0), so it stays wired to lead_pipe's existing cooldown-gated
// swing alone (Keep: its Math.min(25, ...) ceiling, untouched below). Applying
// hitStop to any per-frame continuous tick (flashlight, static, ink) would
// stutter-freeze the game solid for as long as the tick kept firing. `passive`
// is excluded (a DoT layered on top of another hit, not a player-aimed swing);
// `aura` is NOT excluded here despite Patch 16 excluding it for knockback — the
// spec names static explicitly as the "light" example for this weight.
function tagShake(tags, damage) {
    if (!tags || tags.includes('passive')) return 0;
    if (tags.includes('kinetic') || tags.includes('melee')) return Math.min(10, 3 + damage * 0.35);
    return Math.min(6, 1 + damage * 0.15);
}

// Patch 29.5: F5/F7 grant tagDamage bonuses (percent) keyed per weapon tag, summed
// onto state.player.tagDamage at Game.init. Only wired to flashlight and
// polaroid_camera — the two weapons that actually carry the light/focus tags AND
// roll direct damage. broken_chalk also carries 'focus' but never deals damage
// itself (its whole effect is the safeZone 2x dmgMult on OTHER weapons), so there
// is nothing here for a per-hit multiplier to apply to.
function tagDamageMultiplier(tags, tagDamageStats) {
    if (!tags || !tagDamageStats) return 1;
    let bonus = 0;
    for (const t of tags) bonus += (tagDamageStats[t] || 0);
    return 1 + bonus / 100;
}

export class Combat {
    static resolveWeapons(game) {
        const state = game.state;
        let deathCount = 0;

        for (let i = state.projectiles.length - 1; i >= 0; i--) {
            let p = state.projectiles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life--;
            
            let distToPlayer = Math.hypot(p.x - state.player.x, p.y - state.player.y);
            if (distToPlayer < p.radius + state.player.radius && (!state.player.dash || !state.player.dash.active)) {
                game.takeDamage(p.damage);
                p.life = 0; 
                game.spawnParticles(p.x, p.y, p.color, 10);
            }
            
            if (p.life <= 0) {
                p.active = false;
                if (game.director && game.director.pools && game.director.pools.projectile) {
                    game.director.pools.projectile.release(p);
                }
                state.projectiles.splice(i, 1);
            }
        }

        if (state.interactables) {
            for (let obj of state.interactables) {
                if (obj.type === 'BREAKER_BOX') {
                    if (!obj.active) {
                        const dx = obj.x - state.player.x; 
                        const dy = obj.y - state.player.y;
                        const dist = Math.max(Math.hypot(dx, dy), 0.001);
                        
                        if (dist < state.player.weapons.flashlight.radius) {
                            const angle = Math.atan2(dy, dx);
                            let diff = angle - state.player.angle;
                            if (Number.isFinite(diff)) {
                                while(diff < -Math.PI) diff += Math.PI*2;
                                while(diff > Math.PI) diff -= Math.PI*2;
                                
                                if (Math.abs(diff) < state.player.weapons.flashlight.angle) {
                                    obj.charge += 1;
                                    game.spawnParticles(obj.x, obj.y, '#ffffaa', 1);
                                    
                                    if (obj.charge > 60) { 
                                        obj.active = true;
                                        obj.life = 450; 
                                        state.cameraShake = 30;
                                        if (game.audioEngine) game.audioEngine.playSFX('breaker_box', 0.8);
                                    }
                                }
                            }
                        }
                    } else {
                        obj.life--;
                        if (state.frame % 10 === 0) game.spawnParticles(obj.x, obj.y, '#ffffff', 3);
                        
                        for (let ent of state.entities) {
                            if (Math.hypot(ent.x - obj.x, ent.y - obj.y) < obj.radius) {
                                ent.x -= (ent.vx || 0) * (ent.speedModifier || 1);
                                ent.y -= (ent.vy || 0) * (ent.speedModifier || 1);
                                
                                if (ent.attackState) ent.attackState = 'hunting';
                                if (ent.lashingState) ent.lashingState = 'searching';
                                if (ent.vacuumState) ent.vacuumState = 'hunting';
                                if (ent.pulseState) ent.pulseState = 'hunting';
                                if (ent.shootState) ent.shootState = 'hunting';
                                if (ent.actionState && ent.type !== 'ARCHITECT') ent.actionState = 'pulling'; 

                                if (state.frame % 30 === 0) {
                                    ent.takeDamage(20, game);
                                    game.spawnParticles(ent.x, ent.y, '#ffffaa', 5);
                                    if (game.director && typeof game.director.spawnDecal === 'function') {
                                        game.director.spawnDecal(ent.x, ent.y, ent.color || '#fff', 6);
                                    }
                                }
                            }
                        }
                        if (obj.life <= 0) obj.dead = true;
                    }
                } else if (obj.type === 'OBJECTIVE_BACKPACK') {
                    obj.life--;
                    if (obj.life <= 0) {
                        obj.dead = true;
                        game.spawnParticles(obj.x, obj.y, '#555555', 10); 
                    } else {
                        const distToPlayer = Math.hypot(obj.x - state.player.x, obj.y - state.player.y);
                        if (distToPlayer < obj.radius + state.player.radius) {
                            obj.dead = true;
                            game.spawnXP(obj.x, obj.y, 8, true); 
                            state.sanity = Math.min(state.player.maxHp, state.sanity + 50); 
                            state.cameraShake = 20;
                            
                            if (game.audioEngine) game.audioEngine.playSFX('backpack', 0.8);
                            
                            game.spawnParticles(obj.x, obj.y, '#55ff55', 30);
                            game.spawnDamageText(obj.x, obj.y - 30, "SUPPLIES RECOVERED!", '#55ff55', 1.5, 2.0);
                        }
                    }
                } else if (obj.type === 'EXIT_ELEVATOR') {
                    const distToPlayer = Math.hypot(obj.x - state.player.x, obj.y - state.player.y);
                    if (distToPlayer < obj.radius + state.player.radius) {
                        if (game.onFloorComplete) game.onFloorComplete();
                        obj.dead = true; 
                    }
                } else if (obj.type === 'ROOM_DOOR') {
                    const distToPlayer = Math.hypot(obj.x - state.player.x, obj.y - state.player.y);
                    if (distToPlayer < obj.radius + state.player.radius) {
                        obj.dead = true;

                        if (state.isTutorial) {
                            state.isTutorial = false;
                            if (game.saveManager) {
                                game.saveManager.metaState.tutorialCompleted = true;
                                game.saveManager.saveGame();
                            }
                        }

                        if (obj.rewardType === 'LUCIDITY') {                            state.lucidity += 50;
                            state.xp += 50;
                            game.spawnDamageText(state.player.x, state.player.y - 20, "+50 LUCIDITY", '#ffddaa', 1.5, 2.0);
                        } else if (obj.rewardType === 'HEAL') {
                            state.sanity = Math.min(state.player.maxHp, state.sanity + 50);
                            game.spawnDamageText(state.player.x, state.player.y - 20, "+50 GRIP", '#aaffaa', 1.5, 2.0);
                        } else if (obj.rewardType === 'WEAPON_UPGRADE') {
                            const upgradeable = Object.values(state.player.weapons).filter(w => w.level < 5);
                            if (upgradeable.length > 0) {
                                const wep = upgradeable[Math.floor(Math.random() * upgradeable.length)];
                                wep.level++;
                                // Generic stat bump rather than per-weapon branches — that
                                // table lives in LevelUpUI.js's selectCard(), outside this
                                // patch's file scope. Scales whichever fields this weapon
                                // actually has, mirroring the "lower cooldown/dropRate is
                                // better" convention every weapon's own upgrade already uses.
                                if (wep.damage) wep.damage *= 1.15;
                                if (wep.radius) wep.radius *= 1.08;
                                if (wep.baseRadius) wep.baseRadius += 8;
                                if (wep.angle) wep.angle += 0.03;
                                if (wep.cooldown) wep.cooldown = Math.max(20, Math.floor(wep.cooldown * 0.9));
                                if (wep.dropRate) wep.dropRate = Math.max(10, Math.floor(wep.dropRate * 0.9));
                                if (wep.duration) wep.duration = Math.floor(wep.duration * 1.1);
                                game.spawnDamageText(state.player.x, state.player.y - 20, "WEAPON UPGRADED", '#c5a059', 1.5, 2.0);
                            } else {
                                // Every weapon already maxed — fall back rather than a no-op door.
                                state.lucidity += 50;
                                state.xp += 50;
                                game.spawnDamageText(state.player.x, state.player.y - 20, "+50 LUCIDITY", '#ffddaa', 1.5, 2.0);
                            }
                            state.player.synergies = getActiveSynergies(state.player.weapons);
                        } else if (obj.rewardType === 'TOKEN_DOOR') {
                            game.spawnTokenDrop(state.player.x, state.player.y);
                            game.spawnDamageText(state.player.x, state.player.y - 20, "TOKEN DROPPED!", '#ff8c00', 1.5, 2.0);
                        } else if (obj.rewardType === 'RISK_REWARD') {
                            // Direct sanity cost rather than game.takeDamage(): takeDamage
                            // can trigger onDeath(), and this fires mid-room-transition
                            // (roomNumber++ and a full entity/interactable reset happen
                            // right after this block) — letting a menu-adjacent, chosen
                            // cost kill the player through that transition is an edge case
                            // worth avoiding entirely, so it's clamped instead of lethal.
                            // It also deliberately bypasses denialShieldActive/curses: this
                            // is a self-inflicted cost, not enemy damage, so it shouldn't be
                            // negatable by defenses meant for combat.
                            state.lucidity += 150;
                            state.xp += 150;
                            game.spawnTokenDrop(state.player.x, state.player.y);
                            state.sanity = Math.max(1, state.sanity - 30);
                            game.spawnDamageText(state.player.x, state.player.y - 20, "+150 LUCIDITY -30 GRIP", '#ff3333', 1.5, 2.0);
                        }

                        if (game.audioEngine) game.audioEngine.playSFX('ui_upgrade', 0.8);
                        
                        state.roomNumber++;
                        
                        state.player.x = 0;
                        state.player.y = 0;
                        
                        state.entities = [];
                        state.projectiles = [];
                        state.xpDrops = [];
                        state.tokenDrops = [];
                        state.inkPuddles = [];
                        state.safeZones = [];
                        state.interactables = [];
                        
                        if (game.director) {
                            game.director.spawnRoom(state.floor, state.roomNumber);
                        }
                    }
                }
            }
            state.interactables = state.interactables.filter(i => !i.dead);
        }

        let cooldownTick = 1;
        if (state.player.activeTokens && state.player.activeTokens.hasTwitch) {
            let sanityRatio = Math.max(0, state.sanity / state.player.maxHp);
            cooldownTick = 1 + (1 - sanityRatio) * 2.0; 
        }
        if (state.player.curses && state.player.curses.includes('manic_episode')) {
            cooldownTick *= 1.5;
        }

        const camera = state.player.weapons.polaroid_camera;
        if (camera && camera.level > 0) {
            camera.timer -= cooldownTick;
            if (camera.timer <= 0) {
                camera.timer = camera.cooldown;
                state.cameraFlash = 15; 
                state.cameraShake = 10;
                if (game.audioEngine) game.audioEngine.playSFX('polaroid'); 
                
                for (let i = state.entities.length - 1; i >= 0; i--) {
                    let ent = state.entities[i];
                    let dx = ent.x - state.player.x;
                    let dy = ent.y - state.player.y;
                    let dist = Math.hypot(dx, dy);
                    let isBoss = ['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'].includes(ent.type);
                    let canTakeDamage = !(isBoss && state.sanity <= 0 && Math.sin(ent.phase * 10) < 0.5);

                    if (canTakeDamage && dist < camera.radius) {
                        let angle = Math.atan2(dy, dx);
                        let diff = angle - state.player.angle;
                        while (diff < -Math.PI) diff += Math.PI * 2;
                        while (diff > Math.PI) diff -= Math.PI * 2;
                        
                        if (Math.abs(diff) < camera.angle) {
                            ent.takeDamage(camera.damage * tagDamageMultiplier(camera.tags, state.player.tagDamage), game);
                            ent.confused = 120;

                            if (state.player.synergies && state.player.synergies.includes('overexposure')) {
                                ent.confused = 240;
                                ent.takeDamage(state.player.weapons.flashlight.damage, game);
                            }
                            if (state.player.synergies && state.player.synergies.includes('chemical_burn')) {
                                const camBatt = state.player.weapons.corrosive_battery;
                                if (camBatt) { ent.acidTime = camBatt.duration; ent.acidDmg = camBatt.damage; }
                            }

                            ent.x += (dx / dist) * 30;
                            // Defensive check for decals
                            if (game.director && typeof game.director.spawnDecal === 'function') {
                                game.director.spawnDecal(ent.x, ent.y, ent.color || '#fff', 8);
                            }
                        }
                    }
                }
            }
        }

        const spinner = state.player.weapons.fidget_spinner;
        if (spinner && spinner.level > 0) {
            // Patch 31b: spinner is tagged orbit/kinetic, so token kinetic bonuses
            // (hands_grip, body_scars, relapse 4pc) now reach it.
            let spinnerDmg = spinner.damage * tagDamageMultiplier(spinner.tags, state.player.tagDamage);
            if (state.player.dash && state.player.dash.active) spinnerDmg *= 2;

            const hasCentrifuge = !!(state.player.synergies && state.player.synergies.includes('centrifuge'));
            const hasDischarge = !!(state.player.synergies && state.player.synergies.includes('kinetic_discharge'));
            // Blades normally bite every 15 frames; centrifuge triples that rate.
            const spinnerTick = hasCentrifuge ? 5 : 15;

            for (let i = state.entities.length - 1; i >= 0; i--) {
                let ent = state.entities[i];
                let dist = Math.hypot(ent.x - state.player.x, ent.y - state.player.y);
                let isBoss = ['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'].includes(ent.type);
                let canTakeDamage = !(isBoss && state.sanity <= 0 && Math.sin(ent.phase * 10) < 0.5);

                if (canTakeDamage && dist > spinner.baseRadius - 15 && dist < spinner.baseRadius + 15) {
                     if (state.frame % spinnerTick === 0) {
                         // Plain spinner hit had no push at all. Gated on !hasCentrifuge so
                         // this never stacks with that synergy's own hand-tuned 12px shove
                         // below, which is deliberately capped to stay inside the blade band.
                         ent.takeDamage(spinnerDmg, game, hasCentrifuge ? 0 : tagKnockback(spinner.tags, spinnerDmg));
                         // Shake isn't gated on hasCentrifuge like the knockback above — it's
                         // screen-wide, not a positional shove, so it can't eject anyone from
                         // the blade band and there's nothing to double-stack against.
                         state.cameraShake = Math.max(state.cameraShake, tagShake(spinner.tags, spinnerDmg));
                         game.spawnParticles(ent.x, ent.y, '#aaaaaa', 2);
                         if (Math.random() < 0.3 && game.director && typeof game.director.spawnDecal === 'function') {
                             game.director.spawnDecal(ent.x, ent.y, ent.color || '#fff', 4);
                         }

                         if (hasCentrifuge) {
                             // Kept below the ring's ~30px band (baseRadius +/-15) on
                             // purpose: a bigger shove would eject enemies out of the
                             // blade band entirely and REDUCE total hits, defeating the
                             // 3x tick rate this synergy is built around.
                             const d = Math.max(dist, 0.001);
                             ent.x += ((ent.x - state.player.x) / d) * 12;
                             ent.y += ((ent.y - state.player.y) / d) * 12;
                         }

                         if (hasDischarge) {
                             // Arc static into everything around the struck enemy.
                             const arcRadius = 90;
                             const arcDmg = state.player.weapons.static.damage;
                             for (let j = state.entities.length - 1; j >= 0; j--) {
                                 const other = state.entities[j];
                                 if (other === ent) continue;
                                 if (Math.hypot(other.x - ent.x, other.y - ent.y) < arcRadius) {
                                     other.takeDamage(arcDmg, game);
                                     game.spawnParticles(other.x, other.y, '#66ffff', 2);
                                 }
                             }
                         }
                     }
                }
            }
        }

        const pipe = state.player.weapons.lead_pipe;
        if (pipe && pipe.level > 0) {
            pipe.timer -= cooldownTick; 
            if (pipe.timer <= 0) {
                pipe.timer = pipe.cooldown;
                game.director.spawnMeleeSwing(state.player.x, state.player.y, pipe.radius);
                if (game.audioEngine) game.audioEngine.playSFX('pipe_swing');
                
                let hitCount = 0;
                for (let i = state.entities.length - 1; i >= 0; i--) {
                    let ent = state.entities[i];
                    let d = Math.max(Math.hypot(ent.x - state.player.x, ent.y - state.player.y), 0.001);
                    let isBoss = ['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'].includes(ent.type);
                    let canTakeDamage = !(isBoss && state.sanity <= 0 && Math.sin(ent.phase * 10) < 0.5);

                    if (canTakeDamage && d <= pipe.radius) {
                        // Patch 31b: pipe is tagged melee/kinetic — the primary
                        // beneficiary of the Relapse set's damage bonuses.
                        ent.takeDamage(pipe.damage * tagDamageMultiplier(pipe.tags, state.player.tagDamage), game);
                        ent.lastHitByMelee = true;
                        ent.x += (ent.x - state.player.x) / d * 25; 
                        ent.y += (ent.y - state.player.y) / d * 25;
                        hitCount++;
                        
                        if (game.director && typeof game.director.spawnDecal === 'function') {
                            game.director.spawnDecal(ent.x, ent.y, ent.color || '#fff', 10);
                        }
                        
                        if (state.player.synergies && state.player.synergies.includes('industrial_bleed')) {
                            game.director.spawnInkPuddle(ent.x, ent.y, pipe.radius * 0.8, pipe.damage * 0.2);
                        }
                    }
                }
                
                if (hitCount > 0) {
                    state.hitStop = Math.min(25, state.hitStop + 6 + (hitCount * 3));
                    state.cameraShake = Math.max(state.cameraShake, 10 + hitCount * 3);
                    if (game.audioEngine) game.audioEngine.playSFX('pipe_hit', hitCount);

                    // consecrated_ground: only pays out while the PLAYER is standing in
                    // one of their own wards, so it rewards holding ground rather than
                    // swinging anywhere. Capped so a big crowd can't fully heal a swing.
                    if (state.player.synergies && state.player.synergies.includes('consecrated_ground')) {
                        const playerInWard = state.safeZones.some(sz =>
                            Math.hypot(state.player.x - sz.x, state.player.y - sz.y) < sz.radius);
                        if (playerInWard) {
                            state.sanity = Math.min(state.player.maxHp, state.sanity + Math.min(hitCount, 5));
                        }
                    }
                }
            }
        }

        const ink = state.player.weapons.spilled_ink;
        if (ink && ink.level > 0) {
            ink.timer -= cooldownTick; 
            if (ink.timer <= 0) {
                ink.timer = ink.dropRate;
                game.director.spawnInkPuddle(state.player.x, state.player.y, ink.radius, ink.damage);
            }
        }
        
        const chalk = state.player.weapons.broken_chalk;
        if (chalk && chalk.level > 0) {
            chalk.timer -= cooldownTick; 
            if (chalk.timer <= 0) {
                chalk.timer = chalk.cooldown;
                game.director.spawnSafeZone(state.player.x, state.player.y, chalk.radius, chalk.duration);
            }
        }

        const staticWep = state.player.weapons.static;

        if (state.player.curses && state.player.curses.includes('everything_is_target')) {
            let hitAngle = state.player.weapons.flashlight.angle;
            if (state.player.synergies && state.player.synergies.includes('blinding_signal')) hitAngle *= 1.5; 
            
            for (let j = state.xpDrops.length - 1; j >= 0; j--) {
                let xp = state.xpDrops[j];
                let distToXP = Math.max(Math.hypot(xp.x - state.player.x, xp.y - state.player.y), 0.001);
                if (distToXP < state.player.weapons.flashlight.radius) {
                    let angleToXP = Math.atan2(xp.y - state.player.y, xp.x - state.player.x);
                    let angleDiff = angleToXP - state.player.angle;
                    if (Number.isFinite(angleDiff)) {
                        if (angleDiff > 100 || angleDiff < -100) angleDiff = 0;
                        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                        
                        if (Math.abs(angleDiff) < hitAngle) {
                            xp.active = false;
                            if (game.director && game.director.pools && game.director.pools.xpDrop) {
                                game.director.pools.xpDrop.release(xp);
                            }
                            state.xpDrops.splice(j, 1);
                            game.spawnParticles(xp.x, xp.y, '#ffffff', 3); 
                        }
                    }
                }
            }
        }

        for (let i = state.entities.length - 1; i >= 0; i--) {
            let ent = state.entities[i];
            
            if (ent.acidTime > 0) {
                ent.acidTime--;
                if (state.frame % 30 === 0) {
                    ent.takeDamage(ent.acidDmg, game);
                    game.spawnParticles(ent.x, ent.y, '#55ff55', 3);
                }
            }
            
            ent.speedModifier = 1.0;
            const hasIonTrail = !!(state.player.synergies && state.player.synergies.includes('ion_trail'));
            for (let p of state.inkPuddles) {
                if (Math.hypot(ent.x - p.x, ent.y - p.y) < p.radius) {
                    ent.speedModifier = hasIonTrail ? 0.25 : 0.5;
                    if (state.frame % 30 === 0) {
                        ent.takeDamage(p.damage, game);
                        state.cameraShake = Math.max(state.cameraShake, tagShake(state.player.weapons.spilled_ink.tags, p.damage));
                        // Electrified ink: adds the static receiver's damage on top,
                        // read directly off state rather than the staticWep local so
                        // this stays independent of declaration order above.
                        if (hasIonTrail) ent.takeDamage(state.player.weapons.static.damage, game);
                    }
                    break;
                }
            }

            const dx = ent.x - state.player.x; 
            const dy = ent.y - state.player.y;
            const distToPlayer = Math.max(Math.sqrt(dx*dx + dy*dy), 0.001);
            
            if (state.player.dash && state.player.dash.active && state.player.boons && state.player.boons.includes('kinetic_dash')) {
                if (distToPlayer < (ent.radius || 15) + state.player.radius) {
                    if (state.frame % 5 === 0) {
                        // kinetic_dash: literally dashing through the enemy, heavy tier fits.
                        ent.takeDamage(15, game, tagKnockback(['kinetic'], 15));
                        state.cameraShake = Math.max(state.cameraShake, tagShake(['kinetic'], 15));
                        game.spawnParticles(ent.x, ent.y, '#00ffcc', 5);
                    }
                }
            }

            let dmgMult = 1.0;
            for (let sz of state.safeZones) {
                if (Math.hypot(ent.x - sz.x, ent.y - sz.y) < sz.radius) {
                    dmgMult = 2.0;
                    if (state.player.synergies && state.player.synergies.includes('scholastic_purge')) {
                        if (ent.type === 'PARASITE') ent.takeDamage(9999, game);
                        else if (state.frame % 30 === 0) ent.takeDamage(state.player.weapons.corrosive_battery.damage * 2, game);
                    }
                    break;
                }
            }

            // glass_cannon: previously defined as a card but never implemented — picking
            // it did nothing at all. Applied AFTER the safe-zone loop, because that loop
            // assigns dmgMult rather than compounding it and would otherwise wipe this
            // bonus out whenever the player stood in a ward. dmgMult feeds the flashlight
            // and static lines below, which is why the card text names those two weapons
            // instead of promising a global damage boost — there is no global damage
            // pipeline in Combat.js to hook into.
            if (state.player.boons && state.player.boons.includes('glass_cannon')) dmgMult *= 2.0;


            let isBoss = ['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'].includes(ent.type);
            let canTakeDamage = !(isBoss && state.sanity <= 0 && Math.sin(ent.phase * 10) < 0.5);

            if (canTakeDamage) {
                
                if (state.player.sets && state.player.sets.insomniac >= 4) {
                    const innerRad = state.player.weapons.flashlight.radius;
                    const outerRad = innerRad + 200;
                    if (distToPlayer > innerRad && distToPlayer < outerRad) {
                        if (state.frame % 30 === 0) {
                            ent.takeDamage(5, game); 
                            game.spawnParticles(ent.x, ent.y, '#ffaa00', 3);
                        }
                    }
                }

                if (distToPlayer < state.player.weapons.flashlight.radius) {
                    const angleToEnt = Math.atan2(dy, dx);
                    let angleDiff = angleToEnt - state.player.angle;
                    if (Number.isFinite(angleDiff)) {
                        if (angleDiff > 100 || angleDiff < -100) angleDiff = 0;
                        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                        
                        let hitAngle = state.player.weapons.flashlight.angle;
                        if (state.player.synergies && state.player.synergies.includes('blinding_signal')) hitAngle *= 1.5; 

                        let flDamage = state.player.weapons.flashlight.damage;
                        if (state.player.curses && state.player.curses.includes('tunnel_vision')) flDamage *= 3.0;
                        if (state.player.boons && state.player.boons.includes('last_light')) {
                            if (state.sanity < state.player.maxHp * 0.5) flDamage *= 1.5;
                        }

                        // ritual_focus bypasses the cone entirely for warded enemies.
                        // dmgMult > 1.0 is already the "this enemy is inside a ward"
                        // signal computed above, so no extra zone check is needed.
                        const wardedBypass = dmgMult > 1.0
                            && state.player.synergies
                            && state.player.synergies.includes('ritual_focus');

                        if (Math.abs(angleDiff) < hitAngle || wardedBypass) {
                            const flDmgDealt = (flDamage / 60) * dmgMult * tagDamageMultiplier(state.player.weapons.flashlight.tags, state.player.tagDamage);
                            // The always-on starter weapon had zero positional push before
                            // this patch (the vx/vy dampen below is a separate flinch effect,
                            // not knockback) — light tier, ticks every frame it's lit up.
                            ent.takeDamage(flDmgDealt, game, tagKnockback(state.player.weapons.flashlight.tags, flDmgDealt));
                            state.cameraShake = Math.max(state.cameraShake, tagShake(state.player.weapons.flashlight.tags, flDmgDealt));
                            ent.x -= ent.vx * 0.5; ent.y -= ent.vy * 0.5;
                            if (state.player.synergies && state.player.synergies.includes('blinding_signal')) ent.confused = 180; 
                            
                            const batt = state.player.weapons.corrosive_battery;
                            if (batt && batt.level > 0) {
                                ent.acidTime = batt.duration;
                                ent.acidDmg = batt.damage;
                            }
                            if (state.frame % 30 === 0 && game.director && typeof game.director.spawnDecal === 'function') {
                                game.director.spawnDecal(ent.x, ent.y, ent.color || '#fff', 4);
                            }
                        }
                    }
                }
                
                if (staticWep.active && distToPlayer < staticWep.radius) {
                    // Patch 31b: static is tagged aura/tech — the target of hands_tremor.
                    const staticDmgDealt = (staticWep.damage / 60) * dmgMult
                        * tagDamageMultiplier(staticWep.tags, state.player.tagDamage);
                    ent.takeDamage(staticDmgDealt, game);
                    state.cameraShake = Math.max(state.cameraShake, tagShake(staticWep.tags, staticDmgDealt));
                    ent.x += (dx / distToPlayer) * 1.5; ent.y += (dy / distToPlayer) * 1.5;

                    // slowing_field: halve movement while inside the aura. Applied to the
                    // velocity the entity already computed this frame, so it decays
                    // naturally next frame without needing a persistent status field.
                    if (state.player.boons && state.player.boons.includes('slowing_field')) {
                        ent.vx *= 0.5;
                        ent.vy *= 0.5;
                    }
                }
            }

            if (ent.hp <= 0) {
                if (game.eventBus) {
                    game.eventBus.emit('enemy_killed', ent.type);
                }
                
                if (state.player.boons && state.player.boons.includes('vampirism') && ent.lastHitByMelee) {
                    state.sanity = Math.min(state.player.maxHp, state.sanity + 2);
                }

                // VOLATILE variant detonates on death. Runs before the splice below so
                // ent.x/y are still the death position. Damages the player only —
                // chaining into other enemies would turn crowds into a trivial cascade,
                // so the counterplay here is simply to kill these at range.
                if (ent.variant === 'VOLATILE') {
                    const blastRadius = 130;
                    const distToPlayer = Math.hypot(ent.x - state.player.x, ent.y - state.player.y);
                    if (distToPlayer < blastRadius) {
                        game.takeDamage(18);
                    }
                    game.spawnParticles(ent.x, ent.y, '#ff7043', 40);
                    state.cameraShake = Math.max(state.cameraShake, 16);
                    if (game.director && typeof game.director.spawnDecal === 'function') {
                        game.director.spawnDecal(ent.x, ent.y, '#ff7043', 22);
                    }
                }

                deathCount++;
                ent.active = false;
                
                // --- ANTI-ZOMBIE FIX: Immediately extract from array ---
                state.entities.splice(i, 1);
                
                try {
                    if (game.director && typeof game.director.spawnDecal === 'function') {
                        game.director.spawnDecal(ent.x, ent.y, ent.color || '#fff', 15);
                    }
                    if (game.saveManager && typeof game.saveManager.recordKill === 'function') {
                        game.saveManager.recordKill(ent.type);
                    }
                } catch(e) {
                    console.warn("Recovered from logic error on enemy death:", e);
                }
                
                if (ent.type === 'RORSCHACH' && ent.generation < 3) {
                    game.director.spawnEntity('RORSCHACH', null, null, ent.x - 20, ent.y, ent.generation + 1);
                    game.director.spawnEntity('RORSCHACH', null, null, ent.x + 20, ent.y, ent.generation + 1);
                    
                    game.spawnParticles(ent.x, ent.y, '#8b008b', 50); 
                    game.spawnXP(ent.x, ent.y, 5, true); 
                    
                    if (game.director && game.director.pools && game.director.pools.rorschach) {
                        game.director.pools.rorschach.release(ent);
                    }
                    continue; 
                }

                if (isBoss || (ent.type === 'RORSCHACH' && ent.generation === 3)) {
                    game.spawnXP(ent.x, ent.y, ent.type === 'BOSS' ? 25 : 10, true); 
                    game.spawnParticles(ent.x, ent.y, ent.color || '#ffffff', 100);
                    
                    const dropAngle = Math.random() * Math.PI * 2;
                    const dropDist = 120 + Math.random() * 30; 
                    const tokenX = ent.x + Math.cos(dropAngle) * dropDist;
                    const tokenY = ent.y + Math.sin(dropAngle) * dropDist;
                    game.spawnTokenDrop(tokenX, tokenY);
                    
                    const otherBosses = state.entities.filter(e => ['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'].includes(e.type) && e.id !== ent.id);
                    
                    if (otherBosses.length === 0) {
                        state.cameraShake = 50;
                        if (game.audioEngine) game.audioEngine.playSFX('death', 1.5);
                        
                        state.interactables.push({
                             id: Math.random(),
                             type: 'EXIT_ELEVATOR',
                             x: ent.x,
                             y: ent.y,
                             active: true, charge: 0, life: 99999, radius: 40, dead: false 
                        });
                    }
                    
                } else {
                    let dropAmount = ent.type === 'SCAVENGER' ? 2 : (ent.type === 'PREDATOR' ? 5 : 1);
                    if (ent.maxHp > 30) dropAmount += 5; 
                    if (ent.type === 'SCAVENGER' && state.player.curses && state.player.curses.includes('compulsive_cleaner')) {
                        dropAmount += 3; 
                    }
                    
                    game.spawnXP(ent.x, ent.y, dropAmount);
                    
                    if (!state.bossSpawned) {
                        state.convergence += (ent.type === 'PREDATOR' ? 3 : 1);
                    }
                    game.spawnParticles(ent.x, ent.y, ent.color || '#fff', 15);
                }
                
                let poolKey = ent.type.toLowerCase();
                if (game.director && game.director.pools && game.director.pools[poolKey]) {
                    game.director.pools[poolKey].release(ent);
                }
            }
        }
        
        if (deathCount > 0 && game.audioEngine) game.audioEngine.playSFX('death', Math.min(1.2, 0.6 + deathCount * 0.1));
    }

    static collectXP(game) {
        const state = game.state;
        let pickupCount = 0;
        
        // Patch 31b: reads the pre-summed total (legacy + tree + tokens, all in px)
        // that Game.init computes, instead of recomputing from upgrades.magnet —
        // that mirror only covers legacy+tree, so token magnet was invisible here.
        // Falls back to the old derivation for states built before this field existed.
        let baseVacRadius = 70;
        if (state.player.vacRadiusBonusPx !== undefined) {
            baseVacRadius += state.player.vacRadiusBonusPx;
        } else if (state.player.upgrades && state.player.upgrades.magnet) {
            baseVacRadius += (state.player.upgrades.magnet * 30);
        }
        if (state.player.boons && state.player.boons.includes('scavenger_instinct')) {
            baseVacRadius += 80;
        }
        
        for (let i = state.xpDrops.length - 1; i >= 0; i--) {
            let xp = state.xpDrops[i];
            let distToPlayer = Math.max(Math.hypot(xp.x - state.player.x, xp.y - state.player.y), 0.001);
            
            if (distToPlayer < baseVacRadius) {
                xp.x += (state.player.x - xp.x) * 0.15; 
                xp.y += (state.player.y - xp.y) * 0.15;
                
                if (distToPlayer < 15) {
                    xp.collected = true; 
                    state.xp += xp.value; 
                    state.lucidity += xp.value;
                    state.sanity = Math.min(state.player.maxHp, state.sanity + 3);
                    pickupCount++;
                }
            }
            
            if (xp.collected) {
                xp.active = false;
                if (game.director && game.director.pools && game.director.pools.xpDrop) {
                    game.director.pools.xpDrop.release(xp);
                }
                state.xpDrops.splice(i, 1);
            }
        }
        
        if (pickupCount > 0 && game.audioEngine) game.audioEngine.playSFX('pickup', Math.min(0.8, 0.3 + pickupCount * 0.05));

        if (state.tokenDrops) {
            for (let i = state.tokenDrops.length - 1; i >= 0; i--) {
                let t = state.tokenDrops[i];
                let distToPlayer = Math.max(Math.hypot(t.x - state.player.x, t.y - state.player.y), 0.001);
                
                if (distToPlayer < baseVacRadius) {
                    t.x += (state.player.x - t.x) * 0.15; 
                    t.y += (state.player.y - t.y) * 0.15;
                    
                    if (distToPlayer < 15) {
                        t.collected = true; 
                        state.runInventory.push(t.rarity);
                        game.spawnDamageText(t.x, t.y - 20, `${t.rarity} TOKEN!`, t.color, 1.5, 2.0);
                        if (game.audioEngine) game.audioEngine.playSFX('ui_upgrade', 0.8);
                    }
                }
            }
        }
    }
}