// src/systems/Director.js
// The AI that manages game difficulty, spawns enemies, and updates particles.

import { Scavenger } from '../entities/Scavenger.js';
import { Predator } from '../entities/Predator.js';
import { Parasite } from '../entities/Parasite.js';
import { Boss } from '../entities/Boss.js';

export class Director {
    constructor(game) {
        this.game = game;
    }

    spawnWave(canvasWidth, canvasHeight) {
        const state = this.game.state;
        state.stress = 1.0 + (state.frame / 3600); // Increases roughly every minute
        
        if (state.frame % Math.max(30, Math.floor(120 / state.stress)) === 0) this.spawnEntity('SCAVENGER', canvasWidth, canvasHeight);
        if (state.frame % Math.max(90, Math.floor(300 / state.stress)) === 0) this.spawnEntity('PREDATOR', canvasWidth, canvasHeight);
        if (state.frame > 1800 && state.frame % 600 === 0) this.spawnEntity('PARASITE', canvasWidth, canvasHeight); 

        // BOSS TRIGGER (Level 4 reached)
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
        
        // Spawn off-screen
        if (side === 0) { x = Math.random() * canvasWidth; y = -pad; } 
        else if (side === 1) { x = canvasWidth + pad; y = Math.random() * canvasHeight; } 
        else if (side === 2) { x = Math.random() * canvasWidth; y = canvasHeight + pad; } 
        else { x = -pad; y = Math.random() * canvasHeight; }

        let ent;
        if (type === 'SCAVENGER') ent = new Scavenger(Math.random(), x, y, state.stress);
        else if (type === 'PREDATOR') ent = new Predator(Math.random(), x, y, state.stress);
        else if (type === 'PARASITE') ent = new Parasite(Math.random(), x, y);
        else if (type === 'BOSS') ent = new Boss(Math.random(), x, y);
        
        if (ent) state.entities.push(ent);
    }

    spawnXP(x, y, amount, isMassive = false) {
        const state = this.game.state;
        for(let i=0; i<amount; i++) {
            state.xpDrops.push({ 
                x: x + (Math.random() * (isMassive ? 100 : 20) - (isMassive ? 50 : 10)), 
                y: y + (Math.random() * (isMassive ? 100 : 20) - (isMassive ? 50 : 10)), 
                value: isMassive ? 20 : 5, collected: false
            });
        }
    }

    spawnParticles(x, y, color, count) {
        const state = this.game.state;
        for(let i=0; i<count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 3 + 1;
            state.particles.push({ x: x, y: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1.0, color: color });
        }
    }

    updateParticles() {
        const state = this.game.state;
        for (let i = state.particles.length - 1; i >= 0; i--) {
            let p = state.particles[i];
            p.x += p.vx; p.y += p.vy; p.life -= 0.05;
            if (p.life <= 0) state.particles.splice(i, 1);
        }
    }
}