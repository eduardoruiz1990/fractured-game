import { ObjectPool } from './ObjectPool.js';
import { Scavenger } from '../entities/Scavenger.js';
import { Predator } from '../entities/Predator.js';
import { Parasite } from '../entities/Parasite.js';
import { Boss } from '../entities/Boss.js';
import { Rorschach } from '../entities/Rorschach.js'; 
import { Panopticon } from '../entities/Panopticon.js'; 

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
            particle: new ObjectPool(() => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, color: '', active: false }), 300),
            xpDrop: new ObjectPool(() => ({ x: 0, y: 0, value: 0, collected: false, active: false }), 300),
            tokenDrop: new ObjectPool(() => ({ x: 0, y: 0, rarity: '', color: '', collected: false, active: false }), 50),
            damageText: new ObjectPool(() => ({ x: 0, y: 0, text: '', life: 0, color: '', scale: 1, active: false }), 200),
            inkPuddle: new ObjectPool(() => ({ x: 0, y: 0, radius: 0, life: 0, damage: 0, active: false }), 200),
            meleeSwing: new ObjectPool(() => ({ x: 0, y: 0, radius: 0, maxRadius: 0, life: 0, active: false }), 20),
            safeZone: new ObjectPool(() => ({ x: 0, y: 0, radius: 0, life: 0, maxLife: 0, active: false }), 20),
            projectile: new ObjectPool(() => ({ x: 0, y: 0, vx: 0, vy: 0, radius: 0, damage: 0, color: '', life: 0, active: false }), 100)
        };
    }

    spawnWave(canvasWidth, canvasHeight) {
        const state = this.game.state;
        state.stress = 1.0 + (state.frame / 3600); 
        
        if (state.bossSpawned && !state.entities.some(e => e.type === 'BOSS' || e.type === 'RORSCHACH' || e.type === 'PANOPTICON')) {
            return; 
        }
        
        if (state.frame % Math.max(30, Math.floor(120 / state.stress)) === 0) this.spawnEntity('SCAVENGER', canvasWidth, canvasHeight);
        if (state.frame % Math.max(90, Math.floor(300 / state.stress)) === 0) this.spawnEntity('PREDATOR', canvasWidth, canvasHeight);
        if (state.frame > 1800 && state.frame % 600 === 0) this.spawnEntity('PARASITE', canvasWidth, canvasHeight); 

        if (state.convergence >= state.maxConvergence && !state.bossSpawned) {
            if (this.game.audioEngine) {
                this.game.audioEngine.playSFX('boss_intro', 1.0);
                this.game.audioEngine.playSFX('boss_static', 0.8);
            }
            
            // --- TIERED BOSS DEPLOYMENT ---
            if (state.floor === 1) {
                this.spawnEntity('BOSS', canvasWidth, canvasHeight);
            } else if (state.floor === 2) {
                this.spawnEntity('RORSCHACH', canvasWidth, canvasHeight);
            } else {
                this.spawnEntity('PANOPTICON', canvasWidth, canvasHeight);
            }
            state.bossSpawned = true;
            
            // --- ROADMAP UI: MARK BOSS AS ENCOUNTERED ---
            // We use a safe local storage injection here so you don't get 
            // "saveManager is not defined" scope errors in the Director class!
            try {
                const saveKey = 'fractured_save_v1';
                const savedStr = localStorage.getItem(saveKey);
                if (savedStr) {
                    let metaData = JSON.parse(savedStr);
                    if (!metaData.maxBossEncountered || metaData.maxBossEncountered < state.floor) {
                        metaData.maxBossEncountered = state.floor;
                        localStorage.setItem(saveKey, JSON.stringify(metaData));
                    }
                }
            } catch(e) {
                console.warn("Could not update boss roadmap encounter:", e);
            }
        }
    }

    spawnEntity(type, canvasWidth, canvasHeight, forceX = null, forceY = null, generation = 1) {
        const state = this.game.state;
        const spawnRadius = Math.max(canvasWidth, canvasHeight) * 0.6 + 100;
        const angle = Math.random() * Math.PI * 2;
        
        let x = forceX !== null ? forceX : state.player.x + Math.cos(angle) * spawnRadius;
        let y = forceY !== null ? forceY : state.player.y + Math.sin(angle) * spawnRadius;

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
        
        if (ent) {
            state.entities.push(ent);
            if (this.game.audioEngine && Math.random() < 0.3) {
                this.game.audioEngine.playSFX('enemy_spawn', 0.3);
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

    spawnXP(x, y, amount, isMassive = false) {
        const state = this.game.state;
        for(let i=0; i<amount; i++) {
            let xp = this.pools.xpDrop.get();
            xp.x = x + (Math.random() * (isMassive ? 100 : 20) - (isMassive ? 50 : 10));
            xp.y = y + (Math.random() * (isMassive ? 100 : 20) - (isMassive ? 50 : 10));
            xp.value = isMassive ? 20 : 5;
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