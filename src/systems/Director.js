// src/systems/Director.js
import { ObjectPool } from './ObjectPool.js';
import { Scavenger } from '../entities/Scavenger.js';
import { Predator } from '../entities/Predator.js';
import { Parasite } from '../entities/Parasite.js';
import { Boss } from '../entities/Boss.js';

export class Director {
    constructor(game) {
        this.game = game;
        
        // Create our memory pools to prevent Garbage Collection stutter!
        this.pools = {
            scavenger: new ObjectPool(() => new Scavenger(), 100),
            predator: new ObjectPool(() => new Predator(), 50),
            parasite: new ObjectPool(() => new Parasite(), 30),
            boss: new ObjectPool(() => new Boss(), 2),
            particle: new ObjectPool(() => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, color: '', active: false }), 300),
            xpDrop: new ObjectPool(() => ({ x: 0, y: 0, value: 0, collected: false, active: false }), 300)
        };
    }

    spawnWave(canvasWidth, canvasHeight) {
        const state = this.game.state;
        state.stress = 1.0 + (state.frame / 3600); 
        
        if (state.frame % Math.max(30, Math.floor(120 / state.stress)) === 0) this.spawnEntity('SCAVENGER', canvasWidth, canvasHeight);
        if (state.frame % Math.max(90, Math.floor(300 / state.stress)) === 0) this.spawnEntity('PREDATOR', canvasWidth, canvasHeight);
        if (state.frame > 1800 && state.frame % 600 === 0) this.spawnEntity('PARASITE', canvasWidth, canvasHeight); 

        if (state.level >= 4 && !state.bossSpawned) {
            this.spawnEntity('BOSS', canvasWidth, canvasHeight);
            state.bossSpawned = true;
            state.cameraShake = 30; 
            try { if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 500]); } catch(e){}
            if (this.game.audioEngine) this.game.audioEngine.playSFX('levelup'); 
        }
    }

    spawnEntity(type, canvasWidth, canvasHeight) {
        const state = this.game.state;
        const side = Math.floor(Math.random() * 4);
        let x, y;
        const pad = type === 'BOSS' ? 150 : 50;
        
        if (side === 0) { x = Math.random() * canvasWidth; y = -pad; } 
        else if (side === 1) { x = canvasWidth + pad; y = Math.random() * canvasHeight; } 
        else if (side === 2) { x = Math.random() * canvasWidth; y = canvasHeight + pad; } 
        else { x = -pad; y = Math.random() * canvasHeight; }

        let ent;
        if (type === 'SCAVENGER') ent = this.pools.scavenger.get().init(Math.random(), x, y, state.stress);
        else if (type === 'PREDATOR') ent = this.pools.predator.get().init(Math.random(), x, y, state.stress);
        else if (type === 'PARASITE') ent = this.pools.parasite.get().init(Math.random(), x, y);
        else if (type === 'BOSS') ent = this.pools.boss.get().init(Math.random(), x, y);
        
        if (ent) state.entities.push(ent);
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

    updateParticles() {
        const state = this.game.state;
        for (let i = state.particles.length - 1; i >= 0; i--) {
            let p = state.particles[i];
            p.x += p.vx; p.y += p.vy; p.life -= 0.05;
            
            // Release dead particles back to the pool
            if (p.life <= 0) {
                p.active = false;
                this.pools.particle.release(p);
                state.particles.splice(i, 1);
            }
        }
    }
}