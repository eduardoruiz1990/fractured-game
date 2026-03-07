export class Combat {
    static resolveWeapons(game) {
        const state = game.state;
        const staticWep = state.player.weapons.static;
        let deathCount = 0;

        for (let i = state.entities.length - 1; i >= 0; i--) {
            let ent = state.entities[i];
            let isDamaged = false;
            
            const dx = ent.x - state.player.x; 
            const dy = ent.y - state.player.y;
            const distToPlayer = Math.max(Math.sqrt(dx*dx + dy*dy), 0.001);
            
            let canTakeDamage = true;
            if (ent.type === 'BOSS' && state.sanity <= 0) {
                if (Math.sin(ent.phase * 10) < 0.5) canTakeDamage = false; 
            }

            if (canTakeDamage) {
                // Flashlight Hit
                if (distToPlayer < state.player.weapons.flashlight.radius) {
                    const angleToEnt = Math.atan2(dy, dx);
                    let angleDiff = angleToEnt - state.player.angle;
                    if (Number.isFinite(angleDiff)) {
                        if (angleDiff > 100 || angleDiff < -100) angleDiff = 0;
                        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                        
                        let hitAngle = state.player.weapons.flashlight.angle;
                        if (state.player.synergies && state.player.synergies.includes('blinding_signal')) {
                            hitAngle *= 1.5; 
                        }

                        if (Math.abs(angleDiff) < hitAngle) {
                            // PASSED 'game' HERE
                            ent.takeDamage(state.player.weapons.flashlight.damage / 60, game);
                            isDamaged = true;
                            ent.x -= ent.vx * 0.5; ent.y -= ent.vy * 0.5; 
                            
                            if (state.player.synergies && state.player.synergies.includes('blinding_signal')) {
                                ent.confused = 180; 
                            }
                        }
                    }
                }
                
                // Static Aura Hit
                if (staticWep.active && distToPlayer < staticWep.radius) {
                    // PASSED 'game' HERE
                    ent.takeDamage(staticWep.damage / 60, game);
                    ent.x += (dx / distToPlayer) * 1.5; ent.y += (dy / distToPlayer) * 1.5; 
                    isDamaged = true;
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