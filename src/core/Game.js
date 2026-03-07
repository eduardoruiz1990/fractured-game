// src/core/Game.js
// The Core Game Loop, State Management, and Ecosystem AI.

import { GAME_CONFIG } from '../data/Config.js';
import { MANIFESTATIONS } from '../data/Manifestations.js';

export class Game {
    constructor() {
        this.state = null;
        this.onDeath = null;
        this.onLevelUp = null;
        this.audioEngine = null; // Will be injected by main.js
    }

    init(saveManager) {
        const meta = saveManager.metaState;
        const maxSanity = 100 + (meta.upgrades.hp * 20);
        const speedMult = 1.0 + (meta.upgrades.speed * 0.05);
        const lightMult = 1.0 + (meta.upgrades.light * 0.1);

        this.state = {
            player: { 
                // We'll update x/y from the canvas center in main.js
                x: 0, y: 0, 
                radius: 12, angle: 0, targetAngle: 0, hp: maxSanity, maxHp: maxSanity, speedMultiplier: speedMult,
                weapons: {
                    flashlight: { level: 1, damage: 15, radius: 250 * lightMult, angle: 0.4 },
                    static: { level: 0, damage: 0, radius: 60, active: false, pulsePhase: 0 }
                }
            },
            inputBuffer: [],
            sanity: maxSanity, sanityDrainMult: 1.0,
            xp: 0, level: 1, lucidity: 0,
            entities: [], xpDrops: [], particles: [],
            frame: 0, stress: 1.0, cameraShake: 0,
            bossSpawned: false
        };
    }

    update(inputState, canvasWidth, canvasHeight, currentGameState) {
        if (currentGameState !== 'PLAYING') return;

        this.spawnWave(canvasWidth, canvasHeight);

        // 1. Sanity Logic
        this.state.sanity -= GAME_CONFIG.SANITY_DRAIN_RATE * this.state.sanityDrainMult;
        
        let isBreakdown = this.state.sanity <= 0;
        if (isBreakdown) {
            this.state.sanity = 0;
            this.state.inputBuffer.push({...inputState});
            if (this.state.inputBuffer.length < GAME_CONFIG.BREAKDOWN_DELAY_FRAMES) {
                this.processGameLogic({ moveX: 0, moveY: 0, aimAngle: this.state.player.angle, isMoving: false, isAiming: false }, canvasWidth, canvasHeight);
                return isBreakdown; 
            }
        } else {
            if (this.state.inputBuffer.length > 0) this.state.inputBuffer = [];
        }
        
        // 2. Resolve Input
        let currentInput = inputState;
        if (isBreakdown && this.state.inputBuffer.length >= GAME_CONFIG.BREAKDOWN_DELAY_FRAMES) {
            currentInput = this.state.inputBuffer.shift();
            this.state.inputBuffer.push({...inputState});
        }
        
        this.processGameLogic(currentInput, canvasWidth, canvasHeight);
        return isBreakdown; // Return the breakdown state so main.js can update the UI
    }

    processGameLogic(moveInput, canvasWidth, canvasHeight) {
        // --- PLAYER MOVEMENT ---
        if (moveInput.isMoving) {
            this.state.player.x += moveInput.moveX * (GAME_CONFIG.BASE_PLAYER_SPEED * this.state.player.speedMultiplier);
            this.state.player.y += moveInput.moveY * (GAME_CONFIG.BASE_PLAYER_SPEED * this.state.player.speedMultiplier);
        }

        this.state.player.x = Math.max(0, Math.min(canvasWidth, this.state.player.x));
        this.state.player.y = Math.max(0, Math.min(canvasHeight, this.state.player.y));

        if (moveInput.isAiming) {
            let diff = moveInput.aimAngle - this.state.player.angle;
            if (Number.isFinite(diff)) {
                if (diff > 100 || diff < -100) diff = 0; 
                while (diff < -Math.PI) diff += Math.PI * 2;
                while (diff > Math.PI) diff -= Math.PI * 2;
                this.state.player.angle += diff * 0.25;
            }
        }

        const staticWep = this.state.player.weapons.static;
        if (staticWep.active) staticWep.pulsePhase += 0.05;

        // --- ECOSYSTEM AI ---
        let bossExists = false; let bossX = 0; let bossY = 0;
        this.state.entities.forEach(e => { if(e.type === 'BOSS') { bossExists = true; bossX = e.x; bossY = e.y; } });

        let deathCount = 0;

        for (let i = this.state.entities.length - 1; i >= 0; i--) {
            let ent = this.state.entities[i];
            
            // AI ROUTINES
            if (ent.type === 'SCAVENGER') {
                if (bossExists && Math.hypot(bossX - ent.x, bossY - ent.y) < 300) {
                    let bDist = Math.max(Math.hypot(bossX - ent.x, bossY - ent.y), 0.001);
                    ent.vx = (ent.x - bossX) / bDist * ent.speed * 2;
                    ent.vy = (ent.y - bossY) / bDist * ent.speed * 2;
                } else {
                    let nearestXP = null; let minDist = 300; 
                    this.state.xpDrops.forEach(xp => {
                        let d = Math.max(Math.hypot(xp.x - ent.x, xp.y - ent.y), 0.001);
                        if (d < minDist) { minDist = d; nearestXP = xp; }
                    });

                    if (nearestXP) {
                        ent.vx = (nearestXP.x - ent.x) / minDist * ent.speed;
                        ent.vy = (nearestXP.y - ent.y) / minDist * ent.speed;
                        if (minDist < 15) { nearestXP.collected = true; ent.hp += 10; ent.maxHp += 10; ent.speed += 0.1; }
                    } else {
                        ent.vx = Math.cos(this.state.frame * 0.05 + ent.id) * (ent.speed * 0.5);
                        ent.vy = Math.sin(this.state.frame * 0.05 + ent.id) * (ent.speed * 0.5);
                    }
                }
            } 
            else if (ent.type === 'PREDATOR') {
                let targetX = this.state.player.x; let targetY = this.state.player.y;
                let distToTarget = Math.max(Math.hypot(targetX - ent.x, targetY - ent.y), 0.001);

                if (!bossExists) { 
                    this.state.entities.forEach(other => {
                        if (other.type === 'SCAVENGER') {
                            let d = Math.max(Math.hypot(other.x - ent.x, other.y - ent.y), 0.001);
                            if (d < distToTarget - 50) {
                                targetX = other.x; targetY = other.y; distToTarget = d;
                                if (d < 20) { 
                                    other.hp = 0; ent.hp += 20; 
                                    this.spawnParticles(ent.x, ent.y, '#8b0000', 10);
                                }
                            }
                        }
                    });
                }
                
                ent.vx = (targetX - ent.x) / distToTarget * ent.speed;
                ent.vy = (targetY - ent.y) / distToTarget * ent.speed;

                if (distToTarget < 20 && targetX === this.state.player.x) { 
                    this.takeDamage(ent.damage); 
                    ent.x -= ent.vx * 10; ent.y -= ent.vy * 10; 
                }
            }
            else if (ent.type === 'PARASITE') {
                let target = null; let minDist = 500;
                this.state.entities.forEach(other => {
                    if (other.type === 'PREDATOR' && !other.buffed) {
                        let d = Math.max(Math.hypot(other.x - ent.x, other.y - ent.y), 0.001);
                        if (d < minDist) { minDist = d; target = other; }
                    }
                });

                if (target) {
                    ent.vx = (target.x - ent.x) / minDist * ent.speed;
                    ent.vy = (target.y - ent.y) / minDist * ent.speed;
                    if (minDist < 15) {
                        target.buffed = true; target.speed *= 1.5; target.damage *= 2; target.color = '#ff0000'; 
                        ent.hp = 0; this.spawnParticles(target.x, target.y, '#ff0000', 15);
                    }
                } else {
                    const angleToPlayer = Math.atan2(this.state.player.y - ent.y, this.state.player.x - ent.x);
                    ent.vx = Math.cos(angleToPlayer + Math.PI/2) * ent.speed;
                    ent.vy = Math.sin(angleToPlayer + Math.PI/2) * ent.speed;
                }
            }
            else if (ent.type === 'BOSS') {
                ent.phase += 0.02;
                let distToTarget = Math.max(Math.hypot(this.state.player.x - ent.x, this.state.player.y - ent.y), 0.001);
                
                if (this.state.sanity <= 0) ent.speed = ent.baseSpeed * 0.3; 
                else ent.speed = ent.baseSpeed;

                ent.vx = (this.state.player.x - ent.x) / distToTarget * ent.speed;
                ent.vy = (this.state.player.y - ent.y) / distToTarget * ent.speed;

                if (distToTarget < 40) { 
                    this.takeDamage(ent.damage); 
                    ent.x -= ent.vx * 5; ent.y -= ent.vy * 5; 
                }
            }

            ent.x += ent.vx || 0; ent.y += ent.vy || 0;

            // --- DAMAGE RESOLUTION ---
            let isDamaged = false;
            const dx = ent.x - this.state.player.x; const dy = ent.y - this.state.player.y;
            const distToPlayer = Math.max(Math.sqrt(dx*dx + dy*dy), 0.001);
            
            let canTakeDamage = true;
            if (ent.type === 'BOSS' && this.state.sanity <= 0) {
                if (Math.sin(ent.phase * 10) < 0.5) canTakeDamage = false; 
            }

            if (canTakeDamage) {
                if (distToPlayer < this.state.player.weapons.flashlight.radius) {
                    const angleToEnt = Math.atan2(dy, dx);
                    let angleDiff = angleToEnt - this.state.player.angle;
                    if (Number.isFinite(angleDiff)) {
                        if (angleDiff > 100 || angleDiff < -100) angleDiff = 0;
                        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                        
                        if (Math.abs(angleDiff) < this.state.player.weapons.flashlight.angle) {
                            ent.hp -= (this.state.player.weapons.flashlight.damage / 60);
                            isDamaged = true;
                            ent.x -= ent.vx * 0.5; ent.y -= ent.vy * 0.5;
                        }
                    }
                }

                if (staticWep.active && distToPlayer < staticWep.radius) {
                    ent.hp -= (staticWep.damage / 60);
                    ent.x += (dx / distToPlayer) * 1.5; ent.y += (dy / distToPlayer) * 1.5;
                    isDamaged = true;
                }

                if (isDamaged) ent.flashTime = 5; 
            }

            if (ent.flashTime > 0) ent.flashTime--;

            if (ent.hp <= 0) {
                deathCount++;
                if (ent.type === 'BOSS') {
                    this.spawnXP(ent.x, ent.y, 25, true); 
                    this.state.cameraShake = 50;
                    if (this.audioEngine) this.audioEngine.playSFX('death', 10);
                } else {
                    let dropAmount = ent.type === 'SCAVENGER' ? 2 : (ent.type === 'PREDATOR' ? 5 : 1);
                    if (ent.maxHp > 30) dropAmount += 5; 
                    this.spawnXP(ent.x, ent.y, dropAmount);
                }
                this.spawnParticles(ent.x, ent.y, ent.color, ent.type === 'BOSS' ? 100 : 15);
                this.state.entities.splice(i, 1);
            }
        }
        
        if (deathCount > 0 && this.audioEngine) this.audioEngine.playSFX('death', deathCount);

        // --- XP COLLECTION ---
        let pickupCount = 0;
        for (let i = this.state.xpDrops.length - 1; i >= 0; i--) {
            let xp = this.state.xpDrops[i];
            let distToPlayer = Math.max(Math.hypot(xp.x - this.state.player.x, xp.y - this.state.player.y), 0.001);
            
            if (distToPlayer < 70) {
                xp.x += (this.state.player.x - xp.x) * 0.15; xp.y += (this.state.player.y - xp.y) * 0.15;
                if (distToPlayer < 15) {
                    xp.collected = true; this.state.xp += xp.value; this.state.lucidity += xp.value;
                    this.state.sanity = Math.min(this.state.player.maxHp, this.state.sanity + 3);
                    pickupCount++;
                }
            }
            if (xp.collected) this.state.xpDrops.splice(i, 1);
        }
        
        if (pickupCount > 0 && this.audioEngine) this.audioEngine.playSFX('pickup', pickupCount);

        // --- PARTICLES ---
        for (let i = this.state.particles.length - 1; i >= 0; i--) {
            let p = this.state.particles[i];
            p.x += p.vx; p.y += p.vy; p.life -= 0.05;
            if (p.life <= 0) this.state.particles.splice(i, 1);
        }

        // --- LEVEL UP CHECK ---
        const currentReq = GAME_CONFIG.BASE_XP_REQ * this.state.level;
        if (this.state.xp >= currentReq) {
            this.state.xp -= currentReq; 
            this.state.level++; 
            if (this.onLevelUp) this.onLevelUp();
        }

        if (this.state.cameraShake > 0) this.state.cameraShake -= 1;
        this.state.frame++;
        
        let ratio = this.state.sanity / this.state.player.maxHp;
        if (!Number.isFinite(ratio)) ratio = 0;
        if (this.audioEngine) this.audioEngine.updateState(this.state.stress, ratio);
    }

    takeDamage(amount) {
        this.state.sanity -= amount;
        this.state.cameraShake = 10;
        if (this.audioEngine) this.audioEngine.playSFX('damage');
        try { if (navigator.vibrate) navigator.vibrate(100); } catch(e){}
        
        if (this.state.sanity <= -20 && this.onDeath) {
            this.onDeath();
        }
    }

    spawnWave(canvasWidth, canvasHeight) {
        this.state.stress = 1.0 + (this.state.frame / 3600);
        
        if (this.state.frame % Math.max(30, Math.floor(120 / this.state.stress)) === 0) this.spawnEntity('SCAVENGER', canvasWidth, canvasHeight);
        if (this.state.frame % Math.max(90, Math.floor(300 / this.state.stress)) === 0) this.spawnEntity('PREDATOR', canvasWidth, canvasHeight);
        if (this.state.frame > 1800 && this.state.frame % 600 === 0) this.spawnEntity('PARASITE', canvasWidth, canvasHeight); 

        // BOSS TRIGGER
        if (this.state.level >= 4 && !this.state.bossSpawned) {
            this.spawnEntity('BOSS', canvasWidth, canvasHeight);
            this.state.bossSpawned = true;
            this.state.cameraShake = 30; 
            try { if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 500]); } catch(e){}
            if (this.audioEngine) this.audioEngine.playSFX('levelup'); 
        }
    }

    spawnEntity(type, canvasWidth, canvasHeight) {
        const side = Math.floor(Math.random() * 4);
        let x, y;
        const pad = type === 'BOSS' ? 150 : 50;
        if (side === 0) { x = Math.random() * canvasWidth; y = -pad; } 
        else if (side === 1) { x = canvasWidth + pad; y = Math.random() * canvasHeight; } 
        else if (side === 2) { x = Math.random() * canvasWidth; y = canvasHeight + pad; } 
        else { x = -pad; y = Math.random() * canvasHeight; }

        let stats = { hp: 10, speed: 1.0, damage: 5, color: '#444' };
        
        if (type === 'SCAVENGER') stats = { hp: 20, speed: 1.2 * this.state.stress, damage: 2, color: '#555' };
        else if (type === 'PREDATOR') stats = { hp: 45 * this.state.stress, speed: 1.8 * this.state.stress, damage: 15, color: '#8b0000' };
        else if (type === 'PARASITE') stats = { hp: 15, speed: 3.0, damage: 0, color: '#a0522d' };
        else if (type === 'BOSS') stats = { hp: 800, speed: 0.8, damage: 30, color: '#b87333' }; 

        this.state.entities.push({
            id: Math.random(), type: type, x: x, y: y, vx: 0, vy: 0,
            hp: stats.hp, maxHp: stats.hp, speed: stats.speed, baseSpeed: stats.speed,
            damage: stats.damage, color: stats.color, target: null, flashTime: 0, buffed: false, phase: 0
        });
    }

    spawnXP(x, y, amount, isMassive = false) {
        for(let i=0; i<amount; i++) {
            this.state.xpDrops.push({ 
                x: x + (Math.random() * (isMassive ? 100 : 20) - (isMassive ? 50 : 10)), 
                y: y + (Math.random() * (isMassive ? 100 : 20) - (isMassive ? 50 : 10)), 
                value: isMassive ? 20 : 5, collected: false
            });
        }
    }

    spawnParticles(x, y, color, count) {
        for(let i=0; i<count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 3 + 1;
            this.state.particles.push({ x: x, y: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1.0, color: color });
        }
    }
}