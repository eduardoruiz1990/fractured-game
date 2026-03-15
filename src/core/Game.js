import { GAME_CONFIG } from '../data/Config.js';
import { Combat } from '../systems/Combat.js';
import { Director } from '../systems/Director.js';
import { TOKENS } from '../data/Manifestations.js'; 

export class Game {
    constructor() {
        this.state = null;
        this.onDeath = null;
        this.onLevelUp = null;
        this.onFloorComplete = null; 
        this.audioEngine = null; 
        
        this.director = new Director(this);

        window.addEventListener('keydown', (e) => {
            if (e.key === '9' && this.state && this.state.sanity > 0) {
                this.state.xp += 1000;
                console.log('%c DEV CHEAT: +1000 XP applied! ', 'background: #44aa44; color: white;');
            }
        });
    }

    init(saveManager, carriedState = null) {
        const meta = saveManager.metaState;
        const maxSanity = 100 + (meta.upgrades.hp * 20);
        const speedMult = 1.0 + (meta.upgrades.speed * 0.05);
        const lightMult = 1.0 + (meta.upgrades.light * 0.1);

        let startFloor = 1;
        let startLucidity = 0;
        let startLevel = 1;
        
        let startTokens = { head: null, body: null, hands: null, legs: null };
        let startRunInventory = [];

        let startWeapons = {
            flashlight: { level: 1, damage: 15, radius: 250 * lightMult, angle: 0.4 },
            static: { level: 0, damage: 0, radius: 60, active: false, pulsePhase: 0 },
            adrenaline: { level: 0 },
            lead_pipe: { level: 0, damage: 50, radius: 80, cooldown: 90, timer: 0 },
            spilled_ink: { level: 0, damage: 5, radius: 30, dropRate: 30, timer: 0 },
            corrosive_battery: { level: 0, damage: 2, duration: 60 },
            broken_chalk: { level: 0, radius: 70, duration: 180, cooldown: 120, timer: 0 },
            polaroid_camera: { level: 0, damage: 60, radius: 350, angle: 0.8, cooldown: 240, timer: 0 }, 
            fidget_spinner: { level: 0, damage: 10, baseRadius: 55, speed: 0.05 }
        };
        let startSynergies = [];
        let startCurses = [];

        if (carriedState) {
            startFloor = carriedState.floor;
            startLucidity = carriedState.lucidity;
            startWeapons = carriedState.weapons;
            startSynergies = carriedState.synergies;
            startCurses = carriedState.curses;
            startLevel = carriedState.level;
            
            if (carriedState.tokens) startTokens = carriedState.tokens;
            if (carriedState.runInventory) startRunInventory = carriedState.runInventory;
        } else {
            if (meta.equippedTokens) {
                startTokens = JSON.parse(JSON.stringify(meta.equippedTokens));
            }
        }

        let setCounts = { insomniac: 0, institutionalized: 0 };
        let activeTokens = { hasParanoia: false, hasDenial: false, hasTwitch: false, hasPanic: false };

        Object.values(startTokens).forEach(uid => {
            if (!uid) return;
            const invItem = meta.inventory.find(i => i.uid === uid);
            if (invItem && TOKENS[invItem.id]) {
                const tData = TOKENS[invItem.id];
                if (setCounts[tData.set] !== undefined) setCounts[tData.set]++;
                if (tData.id === 'head_paranoia') activeTokens.hasParanoia = true;
                if (tData.id === 'body_denial') activeTokens.hasDenial = true;
                if (tData.id === 'hands_twitch') activeTokens.hasTwitch = true;
                if (tData.id === 'legs_panic') activeTokens.hasPanic = true;
            }
        });

        let effectiveMaxSanity = maxSanity;
        if (setCounts.institutionalized >= 2) effectiveMaxSanity += 50; 

        let effectiveSpeedMult = speedMult;
        if (setCounts.insomniac >= 2) effectiveSpeedMult += 0.10; 
        
        if (activeTokens.hasParanoia) {
            startWeapons.flashlight.radius *= 1.5; 
            startWeapons.flashlight.angle *= 0.8;  
        }

        let startSanity = carriedState ? carriedState.sanity : effectiveMaxSanity;

        this.state = {
            floor: startFloor,
            convergence: 0,
            maxConvergence: Math.floor(100 * Math.pow(1.3, startFloor - 1)), 
            
            player: { 
                x: 0, y: 0, 
                radius: 12, angle: 0, targetAngle: 0, hp: effectiveMaxSanity, maxHp: effectiveMaxSanity, speedMultiplier: effectiveSpeedMult,
                dash: { active: false, timer: 0, cooldown: 0, dx: 0, dy: 0 },
                weapons: startWeapons,
                synergies: startSynergies, 
                curses: startCurses,
                tokens: startTokens, 
                activeTokens: activeTokens, 
                sets: setCounts,            
                denialShieldActive: activeTokens.hasDenial 
            },
            runInventory: startRunInventory, 
            inputBuffer: [],
            sanity: startSanity, sanityDrainMult: 1.0 + (startFloor - 1) * 0.2, 
            xp: 0, level: startLevel, lucidity: startLucidity,
            entities: [], xpDrops: [], particles: [], damageTexts: [], inkPuddles: [], meleeSwings: [], safeZones: [],
            interactables: [], 
            tokenDrops: [], 
            projectiles: [], 
            playerAfterimages: [], 
            hitStop: 0, 
            frame: 0, stress: 1.0, cameraShake: 0, bossSpawned: false,
            cameraFlash: 0, 
            isDead: false
        };
    }

    getCarriedState() {
        if (!this.state) return null;
        return {
            floor: this.state.floor,
            lucidity: this.state.lucidity,
            sanity: this.state.sanity,
            weapons: this.state.player.weapons,
            synergies: this.state.player.synergies,
            curses: this.state.player.curses,
            level: this.state.level,
            tokens: this.state.player.tokens,         
            runInventory: this.state.runInventory     
        };
    }

    spawnTokenDrop(x, y) {
        const rarities = [
            { type: 'COMMON', chance: 0.60, color: '#aaaaaa' },
            { type: 'RARE', chance: 0.30, color: '#5555ff' },
            { type: 'EPIC', chance: 0.09, color: '#aa55ff' },
            { type: 'ANOMALOUS', chance: 0.01, color: '#ff5555' }
        ];
        
        let roll = Math.random();
        let selectedRarity = rarities[0];
        let accum = 0;
        
        for (let r of rarities) {
            accum += r.chance;
            if (roll <= accum) {
                selectedRarity = r;
                break;
            }
        }
        console.log(`[SYSTEM] A ${selectedRarity.type} Personal Token dropped!`);
    }

    update(inputState, canvasWidth, canvasHeight, currentGameState) {
        if (currentGameState !== 'PLAYING') return;

        if (this.state.hitStop > 0) {
            this.state.hitStop--;
            this.state.sanity -= (GAME_CONFIG.SANITY_DRAIN_RATE * 0.1); 
            if (this.state.sanity <= -20 && this.onDeath && !this.state.isDead) {
                this.state.isDead = true;
                this.onDeath();
            }
            return this.state.sanity <= 0;
        }

        this.director.spawnWave(canvasWidth, canvasHeight);

        const isBossDefeated = this.state.bossSpawned && !this.state.entities.some(e => e.type === 'BOSS' || e.type === 'RORSCHACH');

        if (!isBossDefeated) {
            if (this.state.frame > 0 && this.state.frame % 1800 === 0) {
                 this.state.interactables.push({
                     id: Math.random(),
                     type: 'BREAKER_BOX',
                     x: 100 + Math.random() * (canvasWidth - 200),
                     y: 100 + Math.random() * (canvasHeight - 200),
                     active: false, charge: 0, life: 0, radius: 350, dead: false
                 });
            }

            if (this.state.frame > 0 && this.state.frame % 2400 === 0) {
                let targetX, targetY;
                for (let i=0; i<5; i++) {
                    targetX = 100 + Math.random() * (canvasWidth - 200);
                    targetY = 100 + Math.random() * (canvasHeight - 200);
                    if (Math.hypot(targetX - this.state.player.x, targetY - this.state.player.y) > 400) break;
                }
                this.state.interactables.push({
                     id: Math.random(),
                     type: 'OBJECTIVE_BACKPACK',
                     x: targetX,
                     y: targetY,
                     active: true, charge: 0, life: 1200, radius: 30, dead: false 
                });
                
                if (this.audioEngine) this.audioEngine.playSFX('levelup', 1); 
                this.spawnDamageText(this.state.player.x, this.state.player.y - 40, "SUPPLY DROP DETECTED!", '#55ff55', 1.2, 3.0);
            }
        }

        this.state.sanity -= GAME_CONFIG.SANITY_DRAIN_RATE * this.state.sanityDrainMult;
        
        if (this.state.sanity <= -20 && this.onDeath && !this.state.isDead) {
            this.state.isDead = true;
            this.onDeath();
            return true; 
        }
        
        let isBreakdown = this.state.sanity <= 0;
        if (isBreakdown) {
            this.state.inputBuffer.push({...inputState});
            if (this.state.inputBuffer.length < GAME_CONFIG.BREAKDOWN_DELAY_FRAMES) {
                this.processGameLogic({ moveX: 0, moveY: 0, aimAngle: this.state.player.angle, isMoving: false, isAiming: false, dash: false }, canvasWidth, canvasHeight);
                return isBreakdown; 
            }
        } else {
            if (this.state.inputBuffer.length > 0) this.state.inputBuffer = [];
        }
        
        let currentInput = inputState;
        if (isBreakdown && this.state.inputBuffer.length >= GAME_CONFIG.BREAKDOWN_DELAY_FRAMES) {
            currentInput = this.state.inputBuffer.shift();
            this.state.inputBuffer.push({...inputState});
        }
        
        this.processGameLogic(currentInput, canvasWidth, canvasHeight);
        return isBreakdown; 
    }

    processGameLogic(moveInput, canvasWidth, canvasHeight) {
        let canDash = true;
        if (this.state.player.sets.institutionalized >= 4) canDash = false;

        if (moveInput.dash && canDash && this.state.player.dash.cooldown <= 0 && this.state.player.dash.timer <= 0) {
            let dashCooldown = this.state.player.activeTokens.hasPanic ? 45 : 90;
            
            this.state.player.dash.active = true;
            this.state.player.dash.timer = 15; 
            this.state.player.dash.cooldown = dashCooldown; 
            if (this.audioEngine) this.audioEngine.playSFX('dash');
            
            let dx = moveInput.moveX;
            let dy = moveInput.moveY;
            if (dx === 0 && dy === 0) {
                dx = Math.cos(this.state.player.angle);
                dy = Math.sin(this.state.player.angle);
            }
            let dist = Math.max(Math.hypot(dx, dy), 0.001);
            this.state.player.dash.dx = dx / dist;
            this.state.player.dash.dy = dy / dist;
        }

        if (this.state.player.dash.cooldown > 0) {
            this.state.player.dash.cooldown--;
        }

        let currentSpeed = GAME_CONFIG.BASE_PLAYER_SPEED * this.state.player.speedMultiplier;

        if (this.state.player.dash.active) {
            currentSpeed *= this.state.player.activeTokens.hasPanic ? 2.5 : 3.5; 
            this.state.player.dash.timer--;
            
            this.state.player.x += this.state.player.dash.dx * currentSpeed;
            this.state.player.y += this.state.player.dash.dy * currentSpeed;

            if (this.state.frame % 2 === 0) {
                this.state.playerAfterimages.push({
                    x: this.state.player.x, y: this.state.player.y, 
                    angle: this.state.player.angle, life: 1.0
                });
            }

            if (this.state.player.dash.timer <= 0) {
                this.state.player.dash.active = false;
            }
        } else if (moveInput.isMoving) {
            this.state.player.x += moveInput.moveX * currentSpeed;
            this.state.player.y += moveInput.moveY * currentSpeed;
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

        if (this.state.cameraFlash > 0) this.state.cameraFlash--;

        const staticWep = this.state.player.weapons.static;
        if (staticWep.active) staticWep.pulsePhase += 0.05;

        for (let i = this.state.entities.length - 1; i >= 0; i--) {
            let ent = this.state.entities[i];
            ent.update(this.state, this);
        }
        
        Combat.resolveWeapons(this);
        Combat.collectXP(this);
        this.director.updateParticles();

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
        
        // --- EPIC 7: PASS ENTIRE STATE TO AUDIO ENGINE FOR WEAPON SFX SYNC ---
        if (this.audioEngine) this.audioEngine.updateState(this.state.stress, ratio, this.state);
    }

    takeDamage(amount) {
        if (this.state.player.dash.active || this.state.isDead) return;

        if (this.state.player.denialShieldActive) {
            this.state.player.denialShieldActive = false; 
            this.spawnDamageText(this.state.player.x, this.state.player.y - 20, "DENIED!", '#ffffff', 1.5, 2.0);
            this.spawnParticles(this.state.player.x, this.state.player.y, '#aaaaff', 30);
            if (this.audioEngine) this.audioEngine.playSFX('pickup', 5); 
            return; 
        }

        this.state.sanity -= amount;
        this.state.cameraShake = 15; 
        this.state.hitStop = 8; 

        if (this.state.player.sets.institutionalized >= 4) {
            this.spawnDamageText(this.state.player.x, this.state.player.y, "SHOCKWAVE", '#aa55ff', 2.0, 1.5);
            this.spawnParticles(this.state.player.x, this.state.player.y, '#aa55ff', 50);
            this.state.cameraShake = 40;
            
            this.state.entities.forEach(ent => {
                let d = Math.hypot(ent.x - this.state.player.x, ent.y - this.state.player.y);
                if (d < 300) {
                    ent.takeDamage(40, this);
                    ent.x += (ent.x - this.state.player.x) / d * 150; 
                    ent.y += (ent.y - this.state.player.y) / d * 150;
                }
            });

            this.state.sanity = Math.min(this.state.player.maxHp, this.state.sanity + (this.state.player.maxHp * 0.10));
        }
        
        if (this.audioEngine) this.audioEngine.playSFX('damage');
        try { if (navigator.vibrate) navigator.vibrate(100); } catch(e){}
        
        this.spawnDamageText(this.state.player.x, this.state.player.y, `-${Math.floor(amount)}`, '#ff0000', 1.5, 1.5);
        
        if (this.state.sanity <= -20 && this.onDeath) {
            this.state.isDead = true;
            this.onDeath();
        }
    }

    spawnXP(x, y, amount, isMassive = false) {
        this.director.spawnXP(x, y, amount, isMassive);
    }

    spawnParticles(x, y, color, count) {
        this.director.spawnParticles(x, y, color, count);
    }

    spawnDamageText(x, y, text, color = '#ffaaaa', scale = 1.0, life = 1.0) {
        this.director.spawnDamageText(x, y, text, color, scale, life);
    }
}