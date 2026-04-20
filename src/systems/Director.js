// src/systems/Director.js
import { ObjectPool } from './ObjectPool.js';
import { Scavenger } from '../entities/Scavenger.js';
import { Predator } from '../entities/Predator.js';
import { Parasite } from '../entities/Parasite.js';
import { Boss } from '../entities/Boss.js';
import { Rorschach } from '../entities/Rorschach.js'; 
import { Panopticon } from '../entities/Panopticon.js'; 
import { Amalgamation } from '../entities/Amalgamation.js';
import { Architect } from '../entities/Architect.js'; 

export class Director {
    constructor(game) {
        this.game = game;
        
        this.pools = {
            scavenger: new ObjectPool(() => new Scavenger(), 100),
            predator: new ObjectPool(() => new Predator(), 50),
            parasite: new ObjectPool(() => new Parasite(), 30),
            boss: new ObjectPool(() => new Boss(), 2),
            rorschach: new ObjectPool(() => new Rorschach(), 15), 
            panopticon: new ObjectPool(() => new Panopticon(), 2), 
            amalgamation: new ObjectPool(() => new Amalgamation(), 2),
            architect: new ObjectPool(() => new Architect(), 2), 
            particle: new ObjectPool(() => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, color: '', active: false }), 300),
            xpDrop: new ObjectPool(() => ({ x: 0, y: 0, value: 0, collected: false, active: false }), 300),
            tokenDrop: new ObjectPool(() => ({ x: 0, y: 0, rarity: '', color: '', collected: false, active: false }), 50),
            damageText: new ObjectPool(() => ({ x: 0, y: 0, text: '', life: 0, color: '', scale: 1, active: false }), 200),
            inkPuddle: new ObjectPool(() => ({ x: 0, y: 0, radius: 0, life: 0, damage: 0, active: false }), 200),
            meleeSwing: new ObjectPool(() => ({ x: 0, y: 0, radius: 0, maxRadius: 0, life: 0, active: false }), 20),
            safeZone: new ObjectPool(() => ({ x: 0, y: 0, radius: 0, life: 0, maxLife: 0, active: false }), 20),
            projectile: new ObjectPool(() => ({ x: 0, y: 0, vx: 0, vy: 0, radius: 0, damage: 0, color: '', life: 0, active: false }), 100),
            // --- ADDED: DECAL POOL FOR PERSISTENT GORE ---
            decal: new ObjectPool(() => ({ x: 0, y: 0, radius: 0, color: '', active: false }), 300)
        };
    }

    spawnRoom(floor, roomNumber) {
        const state = this.game.state;
        state.combatActive = true;
        state.roomCleared = false;
        
        if (floor === 1 && roomNumber === 1 && this.game.saveManager && !this.game.saveManager.metaState.tutorialCompleted) {
            state.isTutorial = true;
            state.enemyBudget = 1;
            state.stress = 0;
            state.budgetTimer = 0;
            return;
        }
        
        state.isTutorial = false;
        state.enemyBudget = Math.floor(10 + (floor * 5) + (roomNumber * 2));
        state.budgetTimer = 0;
        
        if (roomNumber >= state.maxRoomsPerFloor && !state.bossSpawned) {
            state.enemyBudget = 0;
            if (this.game.audioEngine) {
                this.game.audioEngine.playSFX('boss_intro', 1.0);
                this.game.audioEngine.playSFX('boss_static', 0.8);
            }
            
            if (state.floor === 1) {
                this.spawnEntity('BOSS', 2000, 2000);
            } else if (state.floor === 2) {
                this.spawnEntity('RORSCHACH', 2000, 2000);
            } else if (state.floor === 3) {
                this.spawnEntity('PANOPTICON', 2000, 2000);
            } else if (state.floor === 4) {
                this.spawnEntity('AMALGAMATION', 2000, 2000);
            } else {
                this.spawnEntity('ARCHITECT', 2000, 2000); 
            }
            state.bossSpawned = true;
            
            try {
                if (this.game.saveManager) {
                    let metaData = this.game.saveManager.metaState;
                    if (!metaData.maxBossEncountered || metaData.maxBossEncountered < state.floor) {
                        metaData.maxBossEncountered = state.floor;
                        this.game.saveManager.saveGame();
                    }
                }
            } catch(e) {
                console.warn("Could not update boss roadmap encounter:", e);
            }
        }
    }

    spawnRewardDoors() {
        const state = this.game.state;
        const px = state.player.x;
        const py = state.player.y;
        
        state.interactables.push({
            type: 'ROOM_DOOR',
            x: px - 200, y: py - 200, radius: 40, active: true, dead: false,
            rewardType: 'LUCIDITY'
        });
        state.interactables.push({
            type: 'ROOM_DOOR',
            x: px + 200, y: py - 200, radius: 40, active: true, dead: false,
            rewardType: 'HEAL'
        });
    }

    spawnWave(canvasWidth, canvasHeight) {
        const state = this.game.state;
        
        if (!state.combatActive) return;
        
        const bossAlive = state.entities.some(e => ['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'].includes(e.type));
        
        if (state.bossSpawned && !bossAlive) {
            return; 
        }

        if (state.enemyBudget === undefined) {
            this.spawnRoom(state.floor, state.roomNumber);
        }

        if (state.enemyBudget > 0 || bossAlive) {
            state.budgetTimer++;
            state.stress = 1.0 + (state.roomNumber * 0.1); 

            const spawnRate = bossAlive ? 120 : Math.max(15, 60 - (state.roomNumber * 2));

            if (state.budgetTimer % spawnRate === 0) {
                // Determine spawn pools by biome (Floor)
                let spawnType = 'SCAVENGER';
                let roll = Math.random();

                if (state.floor === 1) {
                    if (roll < 0.1 && (state.enemyBudget >= 2 || bossAlive)) spawnType = 'PREDATOR'; 
                } 
                else if (state.floor === 2) {
                    if (roll < 0.4 && (state.enemyBudget >= 2 || bossAlive)) spawnType = 'PREDATOR'; 
                }
                else if (state.floor === 3) {
                    if (roll < 0.3 && (state.enemyBudget >= 2 || bossAlive)) spawnType = 'PREDATOR'; 
                    else if (roll < 0.6 && (state.enemyBudget >= 3 || bossAlive)) spawnType = 'PARASITE'; 
                }
                else if (state.floor >= 4) {
                    if (roll < 0.3 && (state.enemyBudget >= 2 || bossAlive)) spawnType = 'PREDATOR'; 
                    else if (roll < 0.8 && (state.enemyBudget >= 3 || bossAlive)) spawnType = 'PARASITE'; 
                }

                this.spawnEntity(spawnType, canvasWidth, canvasHeight);

                if (!bossAlive) {
                    if (spawnType === 'SCAVENGER') state.enemyBudget -= 1;
                    else if (spawnType === 'PREDATOR') state.enemyBudget -= 2;
                    else if (spawnType === 'PARASITE') state.enemyBudget -= 3;
                }
            }
        } else if (state.entities.length === 0 && !state.roomCleared && !state.bossSpawned) {
            state.combatActive = false;
            state.roomCleared = true;
            this.spawnRewardDoors();
        }
    }

    spawnEntity(type, canvasWidth, canvasHeight, forceX = null, forceY = null, generation = 1) {
        const state = this.game.state;
        const spawnRadius = Math.max(canvasWidth, canvasHeight) * 0.5 + 50;
        const angle = Math.random() * Math.PI * 2;
        
        let x = forceX !== null ? forceX : state.player.x + Math.cos(angle) * spawnRadius;
        let y = forceY !== null ? forceY : state.player.y + Math.sin(angle) * spawnRadius;

        const mapOriginX = state.mapOriginX || 0;
        const mapOriginY = state.mapOriginY || 0;
        const distFromCenter = Math.hypot(x - mapOriginX, y - mapOriginY);
        
        if (distFromCenter > 1550) {
            const angleToCenter = Math.atan2(y - mapOriginY, x - mapOriginX);
            x = mapOriginX + Math.cos(angleToCenter) * 1550;
            y = mapOriginY + Math.sin(angleToCenter) * 1550;
        }

        let ent;
        if (type === 'SCAVENGER') ent = this.pools.scavenger.get().init(Math.random(), x, y, state.stress);
        else if (type === 'PREDATOR') {
            ent = this.pools.predator.get().init(Math.random(), x, y, state.stress);
            if (state.player.curses && state.player.curses.includes('compulsive_cleaner')) {
                ent.speed *= 2.0; ent.baseSpeed *= 2.0;
            }
        }
        else if (type === 'PARASITE') ent = this.pools.parasite.get().init(Math.random(), x, y);
        else if (type === 'BOSS') ent = this.pools.boss.get().init(Math.random(), x, y);
        else if (type === 'RORSCHACH') ent = this.pools.rorschach.get().init(Math.random(), x, y, generation);
        else if (type === 'PANOPTICON') ent = this.pools.panopticon.get().init(Math.random(), x, y); 
        else if (type === 'AMALGAMATION') ent = this.pools.amalgamation.get().init(Math.random(), x, y);
        else if (type === 'ARCHITECT') ent = this.pools.architect.get().init(Math.random(), x, y);

        if (ent) {
            if (!['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'].includes(ent.type)) {
                if (state.floor === 1) ent.originalColor = ent.type === 'SCAVENGER' ? '#8b5a2b' : '#a0522d';
                else if (state.floor === 2) ent.originalColor = ent.type === 'SCAVENGER' ? '#888888' : '#333333';
                else if (state.floor === 3) ent.originalColor = ent.type === 'SCAVENGER' ? '#800020' : '#4b0000';
                else if (state.floor === 4) ent.originalColor = ent.type === 'SCAVENGER' ? '#2e8b57' : '#004d00';
                else if (state.floor >= 5) ent.originalColor = ent.type === 'SCAVENGER' ? '#daa520' : '#b8860b';
                ent.color = ent.originalColor;
            }

            state.entities.push(ent);
            if (this.game.audioEngine && Math.random() < 0.3) {                this.game.audioEngine.playSFX('enemy_spawn', 0.3);
            }
        }
    }

    spawnProjectile(x, y, vx, vy, radius, damage, color, life) {
        const state = this.game.state;
        let p = this.pools.projectile.get();
        p.x = x; p.y = y; p.vx = vx; p.vy = vy; 
        p.radius = radius; p.damage = damage; p.color = color; 
        p.life = life; p.active = true;
        state.projectiles.push(p);
    }

    // --- ADDED: DECAL SPAWNING ---
    spawnDecal(x, y, color, size) {
        const state = this.game.state;
        // Keep a rolling buffer of exactly 250 blood/ink splatters to prevent lag
        if (state.decals.length > 250) {
            let old = state.decals.shift();
            this.pools.decal.release(old);
        }
        
        // Spawn 3 overlapping shapes for a "splatter" look
        for(let i=0; i<3; i++) {
            let d = this.pools.decal.get();
            d.x = x + (Math.random() - 0.5) * 30;
            d.y = y + (Math.random() - 0.5) * 30;
            d.radius = size * (0.5 + Math.random() * 0.8);
            d.color = color;
            d.active = true;
            state.decals.push(d);
        }
    }

    spawnXP(x, y, amount, isMassive = false) {
        const state = this.game.state;
        for(let i=0; i<amount; i++) {
            let xp = this.pools.xpDrop.get();
            xp.x = x + (Math.random() * (isMassive ? 100 : 20) - (isMassive ? 50 : 10));
            xp.y = y + (Math.random() * (isMassive ? 100 : 20) - (isMassive ? 50 : 10));
            xp.value = isMassive ? 25 : 1;
            xp.collected = false;
            xp.active = true;
            state.xpDrops.push(xp);
        }
    }

    spawnToken(x, y, rarityData) {
        const state = this.game.state;
        let token = this.pools.tokenDrop.get();
        token.x = x + (Math.random() * 40 - 20);
        token.y = y + (Math.random() * 40 - 20);
        token.rarity = rarityData.type;
        token.color = rarityData.color;
        token.collected = false;
        token.active = true;
        if (!state.tokenDrops) state.tokenDrops = [];
        state.tokenDrops.push(token);
    }

    spawnParticles(x, y, color, count) {
        const state = this.game.state;
        for(let i=0; i<count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 3 + 1;
            let p = this.pools.particle.get();
            p.x = x; p.y = y; 
            p.vx = Math.cos(angle) * speed; 
            p.vy = Math.sin(angle) * speed; 
            p.life = 1.0; 
            p.color = color;
            p.active = true;
            state.particles.push(p);
        }
    }

    spawnDamageText(x, y, text, color = '#ffaaaa', scale = 1.0, life = 1.0) {
        const state = this.game.state;
        let dt = this.pools.damageText.get();
        dt.x = x + (Math.random() * 30 - 15);
        dt.y = y - 10;
        dt.text = text;
        dt.color = color;
        dt.scale = scale;
        dt.life = life;
        dt.active = true;
        state.damageTexts.push(dt);
    }

    spawnInkPuddle(x, y, radius, damage) {
        let p = this.pools.inkPuddle.get();
        p.x = x; p.y = y; p.radius = radius; p.damage = damage; p.life = 300; 
        p.active = true;
        this.game.state.inkPuddles.push(p);
    }

    spawnMeleeSwing(x, y, maxRadius) {
        let m = this.pools.meleeSwing.get();
        m.x = x; m.y = y; m.radius = 0; m.maxRadius = maxRadius; m.life = 15; 
        m.active = true;
        this.game.state.meleeSwings.push(m);
    }
    
    spawnSafeZone(x, y, radius, life) {
        let sz = this.pools.safeZone.get();
        sz.x = x; sz.y = y; sz.radius = radius; sz.life = life; sz.maxLife = life; sz.active = true;
        this.game.state.safeZones.push(sz);
    }

    updateParticles() {
        const state = this.game.state;
        for (let i = state.particles.length - 1; i >= 0; i--) {
            let p = state.particles[i];
            p.x += p.vx; p.y += p.vy; p.life -= 0.05;
            if (p.life <= 0) { p.active = false; this.pools.particle.release(p); state.particles.splice(i, 1); }
        }
        for (let i = state.damageTexts.length - 1; i >= 0; i--) {
            let dt = state.damageTexts[i];
            dt.y -= 0.5; dt.life -= 0.02; 
            if (dt.life <= 0) { dt.active = false; this.pools.damageText.release(dt); state.damageTexts.splice(i, 1); }
        }
        for (let i = state.inkPuddles.length - 1; i >= 0; i--) {
            let p = state.inkPuddles[i];
            p.life--;
            if (p.life <= 0) { p.active = false; this.pools.inkPuddle.release(p); state.inkPuddles.splice(i, 1); }
        }
        for (let i = state.meleeSwings.length - 1; i >= 0; i--) {
            let m = state.meleeSwings[i];
            m.life--;
            m.radius += (m.maxRadius - m.radius) * 0.3; 
            if (m.life <= 0) { m.active = false; this.pools.meleeSwing.release(m); state.meleeSwings.splice(i, 1); }
        }
        for (let i = state.safeZones.length - 1; i >= 0; i--) {
            let sz = state.safeZones[i];
            sz.life--;
            if (sz.life <= 0) { sz.active = false; this.pools.safeZone.release(sz); state.safeZones.splice(i, 1); }
        }
        
        if (state.tokenDrops) {
            for (let i = state.tokenDrops.length - 1; i >= 0; i--) {
                let t = state.tokenDrops[i];
                if (t.collected) {
                    t.active = false;
                    this.pools.tokenDrop.release(t);
                    state.tokenDrops.splice(i, 1);
                }
            }
        }
    }
}