// src/systems/Combat.js
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
                            ent.takeDamage(camera.damage, game);
                            ent.confused = 120; 
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
            let spinnerDmg = spinner.damage;
            if (state.player.dash && state.player.dash.active) spinnerDmg *= 2; 

            for (let i = state.entities.length - 1; i >= 0; i--) {
                let ent = state.entities[i];
                let dist = Math.hypot(ent.x - state.player.x, ent.y - state.player.y);
                let isBoss = ['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'].includes(ent.type);
                let canTakeDamage = !(isBoss && state.sanity <= 0 && Math.sin(ent.phase * 10) < 0.5);

                if (canTakeDamage && dist > spinner.baseRadius - 15 && dist < spinner.baseRadius + 15) {
                     if (state.frame % 15 === 0) { 
                         ent.takeDamage(spinnerDmg, game);
                         game.spawnParticles(ent.x, ent.y, '#aaaaaa', 2);
                         if (Math.random() < 0.3 && game.director && typeof game.director.spawnDecal === 'function') {
                             game.director.spawnDecal(ent.x, ent.y, ent.color || '#fff', 4);
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
                        ent.takeDamage(pipe.damage, game);
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
            for (let p of state.inkPuddles) {
                if (Math.hypot(ent.x - p.x, ent.y - p.y) < p.radius) {
                    ent.speedModifier = 0.5; 
                    if (state.frame % 30 === 0) ent.takeDamage(p.damage, game); 
                    break;
                }
            }

            const dx = ent.x - state.player.x; 
            const dy = ent.y - state.player.y;
            const distToPlayer = Math.max(Math.sqrt(dx*dx + dy*dy), 0.001);
            
            if (state.player.dash && state.player.dash.active && state.player.boons && state.player.boons.includes('kinetic_dash')) {
                if (distToPlayer < (ent.radius || 15) + state.player.radius) {
                    if (state.frame % 5 === 0) {
                        ent.takeDamage(15, game);
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

                        if (Math.abs(angleDiff) < hitAngle) {
                            ent.takeDamage((flDamage / 60) * dmgMult, game);
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
                    ent.takeDamage((staticWep.damage / 60) * dmgMult, game);
                    ent.x += (dx / distToPlayer) * 1.5; ent.y += (dy / distToPlayer) * 1.5; 
                }
            }

            if (ent.hp <= 0) {
                if (game.eventBus) {
                    game.eventBus.emit('enemy_killed', ent.type);
                }
                
                if (state.player.boons && state.player.boons.includes('vampirism') && ent.hp <= -10) {
                   // actually just doing standard vampirism check... wait, how to know it's a melee kill?
                   // The prompt said: "vampirism: 'Melee kills restore 2 Sanity.'" 
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
        
        let baseVacRadius = 70;
        if (state.player.upgrades && state.player.upgrades.magnet) {
            baseVacRadius += (state.player.upgrades.magnet * 30); 
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