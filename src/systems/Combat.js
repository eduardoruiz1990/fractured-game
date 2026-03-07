// src/systems/Combat.js
export class Combat {
    static resolveWeapons(game) {
        const state = game.state;
        let deathCount = 0;

        // 1. Process New Melee Weapons
        const pipe = state.player.weapons.lead_pipe;
        if (pipe && pipe.level > 0) {
            pipe.timer--;
            if (pipe.timer <= 0) {
                pipe.timer = pipe.cooldown;
                game.director.spawnMeleeSwing(state.player.x, state.player.y, pipe.radius);
                if (game.audioEngine) game.audioEngine.playSFX('damage', 2);
                
                for (let i = state.entities.length - 1; i >= 0; i--) {
                    let ent = state.entities[i];
                    let d = Math.max(Math.hypot(ent.x - state.player.x, ent.y - state.player.y), 0.001);
                    let canTakeDamage = !(ent.type === 'BOSS' && state.sanity <= 0 && Math.sin(ent.phase * 10) < 0.5);

                    if (canTakeDamage && d <= pipe.radius) {
                        ent.takeDamage(pipe.damage, game);
                        ent.x += (ent.x - state.player.x) / d * 25; // Massive Knockback
                        ent.y += (ent.y - state.player.y) / d * 25;
                        
                        // SYNERGY: Industrial Bleed
                        if (state.player.synergies && state.player.synergies.includes('industrial_bleed')) {
                            game.director.spawnInkPuddle(ent.x, ent.y, pipe.radius * 0.8, pipe.damage * 0.2);
                        }
                    }
                }
            }
        }

        const ink = state.player.weapons.spilled_ink;
        if (ink && ink.level > 0) {
            ink.timer--;
            if (ink.timer <= 0) {
                ink.timer = ink.dropRate;
                game.director.spawnInkPuddle(state.player.x, state.player.y, ink.radius, ink.damage);
            }
        }

        const staticWep = state.player.weapons.static;

        // 2. Process Enemy Loop (Flashlight, Static, and Ink interactions)
        for (let i = state.entities.length - 1; i >= 0; i--) {
            let ent = state.entities[i];
            
            // Apply Ink Slow & DoT
            ent.speedModifier = 1.0;
            for (let p of state.inkPuddles) {
                if (Math.hypot(ent.x - p.x, ent.y - p.y) < p.radius) {
                    ent.speedModifier = 0.5; // Walk through sludge
                    if (state.frame % 30 === 0) ent.takeDamage(p.damage, game); // Damage tick
                    break;
                }
            }

            const dx = ent.x - state.player.x; 
            const dy = ent.y - state.player.y;
            const distToPlayer = Math.max(Math.sqrt(dx*dx + dy*dy), 0.001);
            
            let canTakeDamage = !(ent.type === 'BOSS' && state.sanity <= 0 && Math.sin(ent.phase * 10) < 0.5);

            if (canTakeDamage) {
                // Flashlight
                if (distToPlayer < state.player.weapons.flashlight.radius) {
                    const angleToEnt = Math.atan2(dy, dx);
                    let angleDiff = angleToEnt - state.player.angle;
                    if (Number.isFinite(angleDiff)) {
                        if (angleDiff > 100 || angleDiff < -100) angleDiff = 0;
                        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                        
                        let hitAngle = state.player.weapons.flashlight.angle;
                        if (state.player.synergies && state.player.synergies.includes('blinding_signal')) hitAngle *= 1.5; 

                        if (Math.abs(angleDiff) < hitAngle) {
                            ent.takeDamage(state.player.weapons.flashlight.damage / 60, game);
                            ent.x -= ent.vx * 0.5; ent.y -= ent.vy * 0.5; 
                            
                            if (state.player.synergies && state.player.synergies.includes('blinding_signal')) ent.confused = 180; 
                        }
                    }
                }
                
                // Static Aura
                if (staticWep.active && distToPlayer < staticWep.radius) {
                    ent.takeDamage(staticWep.damage / 60, game);
                    ent.x += (dx / distToPlayer) * 1.5; ent.y += (dy / distToPlayer) * 1.5; 
                }
            }

            if (ent.hp <= 0) {
                deathCount++;
                if (ent.type === 'BOSS') {
                    game.spawnXP(ent.x, ent.y, 25, true); 
                    state.cameraShake = 50;
                    if (game.audioEngine) game.audioEngine.playSFX('death', 10);
                } else {
                    let dropAmount = ent.type === 'SCAVENGER' ? 2 : (ent.type === 'PREDATOR' ? 5 : 1);
                    if (ent.maxHp > 30) dropAmount += 5; 
                    game.spawnXP(ent.x, ent.y, dropAmount);
                }
                game.spawnParticles(ent.x, ent.y, ent.color, ent.type === 'BOSS' ? 100 : 15);
                
                ent.active = false;
                let poolKey = ent.type.toLowerCase();
                if (game.director && game.director.pools && game.director.pools[poolKey]) {
                    game.director.pools[poolKey].release(ent);
                }
                state.entities.splice(i, 1);
            }
        }
        
        if (deathCount > 0 && game.audioEngine) game.audioEngine.playSFX('death', deathCount);
    }

    static collectXP(game) {
        const state = game.state;
        let pickupCount = 0;
        
        for (let i = state.xpDrops.length - 1; i >= 0; i--) {
            let xp = state.xpDrops[i];
            let distToPlayer = Math.max(Math.hypot(xp.x - state.player.x, xp.y - state.player.y), 0.001);
            
            if (distToPlayer < 70) {
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
        if (pickupCount > 0 && game.audioEngine) game.audioEngine.playSFX('pickup', pickupCount);
    }
}