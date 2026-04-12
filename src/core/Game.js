// src/core/Game.js
import { Combat } from '../systems/Combat.js';
import { Director } from '../systems/Director.js';
import { TOKENS } from '../data/Manifestations.js'; 
import { HubWorld } from '../systems/HubWorld.js';

export class Game {
    constructor() {
        this.state = null;
        this.onDeath = null;
        this.onLevelUp = null;
        this.onFloorComplete = null; 
        this.audioEngine = null; 
        
        this.director = new Director(this);
        this.hubWorld = new HubWorld(this);
    }

    init(saveManager, carriedState = null) {
        this.saveManager = saveManager; 
        const meta = saveManager.metaState;
        
        const maxSanity = 100 + ((meta.upgrades.hp || 0) * 20);
        const speedBuff = 1.0 + ((meta.upgrades.speed || 0) * 0.05);
        const lightBuff = 1.0 + ((meta.upgrades.light || 0) * 0.1);

        const startFloor = carriedState ? carriedState.floor : 1;
        let effectiveMaxSanity = maxSanity;

        const pCurses = [];
        const pSets = {};
        const pSynergies = [];
        const pTokens = { hasTwitch: false, hasPanic: false };

        if (meta.equippedTokens) {
            Object.values(meta.equippedTokens).forEach(uid => {
                if (!uid) return;
                const invItem = meta.inventory.find(i => i.uid === uid);
                if (invItem) {
                    const tokenData = TOKENS[invItem.id];
                    if (tokenData.curses) pCurses.push(...tokenData.curses);
                    pSets[tokenData.set] = (pSets[tokenData.set] || 0) + 1;
                    
                    if (invItem.id === 'adrenaline_gland') pTokens.hasTwitch = true;
                    if (invItem.id === 'broken_watch') pTokens.hasPanic = true;
                }
            });
        }

        if (pCurses.includes('fragile_mind')) effectiveMaxSanity = Math.floor(maxSanity * 0.5);

        let startSanity = carriedState ? carriedState.sanity : effectiveMaxSanity;

        this.state = {
            killCounts: meta.killCounts || {}, 
            hubWorld: this.hubWorld,           
            floor: startFloor,
            convergence: 0,
            maxConvergence: Math.floor(100 * Math.pow(1.3, startFloor - 1)), 
            frame: 0,
            xp: carriedState ? carriedState.xp : 0,
            level: carriedState ? carriedState.level : 1,
            lucidity: carriedState ? carriedState.lucidity : 0, 
            sanity: startSanity,
            inVoid: false,
            cameraShake: 0,
            cameraFlash: 0,
            hitStop: 0,
            bossSpawned: false,
            mapOriginX: null,
            mapOriginY: null,
            runInventory: carriedState ? carriedState.runInventory : [], 
            
            player: {
                x: 0, y: 0,
                radius: 12,
                angle: 0,
                speed: 3.5 * speedBuff,
                maxHp: effectiveMaxSanity,
                curses: pCurses,
                sets: pSets,
                synergies: pSynergies,
                activeTokens: pTokens,
                flashTime: 0,
                breathPhase: 0,
                denialShieldActive: false,
                dash: { active: false, timer: 0, duration: 12, cooldown: 0, dx: 0, dy: 0 },
                weapons: carriedState ? carriedState.weapons : {
                    flashlight: { 
                        level: 1, damage: 15, radius: 250 * lightBuff, 
                        angle: 0.6, type: 'cone', 
                        tags: ['light', 'focus'] 
                    },
                    static: { level: 0, damage: 5, radius: 100, active: false, pulsePhase: 0, tags: ['aura', 'tech'] },
                    polaroid_camera: { level: 0, damage: 30, radius: 300, angle: Math.PI/3, cooldown: 180, timer: 0, tags: ['burst', 'light'] },
                    fidget_spinner: { level: 0, damage: 8, baseRadius: 60, speed: 0.1, tags: ['orbit', 'kinetic'] },
                    lead_pipe: { level: 0, damage: 45, radius: 70, cooldown: 90, timer: 0, tags: ['melee', 'kinetic'] },
                    spilled_ink: { level: 0, damage: 10, radius: 45, dropRate: 45, timer: 0, tags: ['hazard', 'dark'] },
                    broken_chalk: { level: 0, radius: 60, duration: 300, cooldown: 600, timer: 0, tags: ['utility', 'focus'] },
                    corrosive_battery: { level: 0, damage: 2, duration: 180, tags: ['passive', 'tech'] }
                },
                upgrades: meta.upgrades 
            },
            input: { moveX: 0, moveY: 0, aimAngle: 0, isMoving: false },
            entities: [],
            projectiles: [],
            particles: [],
            xpDrops: [],
            tokenDrops: [], 
            damageTexts: [],
            safeZones: [],
            inkPuddles: [],
            meleeSwings: [],
            interactables: [],
            playerAfterimages: [],
            decals: []
        };
        
        if (pSets.insomniac >= 2) this.state.player.weapons.flashlight.radius *= 1.25;

        // FIXED: The engine requires 'startGameDrone()', not 'startDrone()'
        if (this.audioEngine) this.audioEngine.startGameDrone();
    }

    getCarriedState() {
        return {
            floor: this.state.floor,
            sanity: this.state.sanity,
            weapons: this.state.player.weapons,
            xp: this.state.xp,
            level: this.state.level,
            lucidity: this.state.lucidity,
            runInventory: this.state.runInventory
        };
    }

    takeDamage(amount) {
        if (this.state.player.denialShieldActive) {
            this.state.player.denialShieldActive = false;
            this.state.cameraFlash = 10;
            this.state.cameraShake = 20;
            if (this.audioEngine) this.audioEngine.playSFX('glass_shatter');
            return;
        }

        if (this.state.player.curses && this.state.player.curses.includes('hemophilia')) {
            amount *= 1.5;
        }

        let dmgReduction = 0;
        if (this.state.player.sets && this.state.player.sets.medicated >= 2) {
            dmgReduction = 0.2; 
        }

        const finalDmg = amount * (1 - dmgReduction);
        this.state.sanity -= finalDmg;
        this.state.player.flashTime = 10;
        this.state.cameraShake = Math.max(this.state.cameraShake, finalDmg * 2);
        
        if (this.audioEngine && finalDmg > 5) this.audioEngine.playSFX('player_hit');
        
        if (this.state.sanity <= 0 && this.onDeath) {
            this.onDeath();
        }
    }

    spawnParticles(x, y, color, count) {
        if (this.director && typeof this.director.spawnParticles === 'function') {
            this.director.spawnParticles(x, y, color, count);
        }
    }

    spawnDamageText(x, y, amount, color, scale = 1.0, life = 1.0) {
        if (this.director && typeof this.director.spawnDamageText === 'function') {
            this.director.spawnDamageText(x, y, Math.ceil(amount).toString(), color, scale, life);
        }
    }

    spawnXP(x, y, value, isBoss = false) {
        if (this.director && typeof this.director.spawnXP === 'function') {
            this.director.spawnXP(x, y, value, isBoss);
        }
        if (isBoss) this.state.cameraShake = 15;
    }

    spawnTokenDrop(x, y) {
        const rand = Math.random();
        let rarity = 'common';
        let color = '#cd7f32';
        
        if (rand > 0.95) { rarity = 'legendary'; color = '#ff8c00'; }
        else if (rand > 0.80) { rarity = 'epic'; color = '#800080'; }
        else if (rand > 0.50) { rarity = 'rare'; color = '#4169e1'; }

        if (this.director && typeof this.director.spawnToken === 'function') {
            this.director.spawnToken(x, y, { type: rarity, color: color });
        }
        
        this.spawnParticles(x, y, color, 30);
        this.spawnDamageText(x, y - 20, "TOKEN DROPPED!", color, 1.2, 2.0);
    }

    update(inputState, canvasWidth, canvasHeight, currentGameState) {
        if (currentGameState === 'HUB') {
            this.state.input = inputState;
            this.processGameLogic(inputState, canvasWidth, canvasHeight, true);
            if (this.hubWorld) this.hubWorld.update(this.state);
            return false; 
        }

        if (currentGameState !== 'PLAYING') return;

        if (this.state.hitStop > 0) {
            this.state.hitStop--;
            this.state.frame++; 
            return false;
        }

        const currentInput = {
            moveX: inputState.moveX,
            moveY: inputState.moveY,
            aimAngle: inputState.aimAngle,
            isMoving: inputState.isMoving,
            isDashing: inputState.isDashing
        };

        let isBreakdown = false;
        if (this.state.sanity <= 0) {
            isBreakdown = true;
            if (this.state.frame % 3 !== 0) {
                currentInput.moveX = 0;
                currentInput.moveY = 0;
                currentInput.isMoving = false;
            }
        }

        this.processGameLogic(currentInput, canvasWidth, canvasHeight);
        return isBreakdown; 
    }

    processGameLogic(moveInput, canvasWidth, canvasHeight, isHub = false) {
        if (this.state.mapOriginX === null) {
            this.state.mapOriginX = this.state.player.x;
            this.state.mapOriginY = this.state.player.y;
        }

        this.state.frame++;
        this.state.input = moveInput;

        if (moveInput.isDashing && !this.state.player.dash.active && this.state.player.dash.cooldown <= 0) {
            this.state.player.dash.active = true;
            this.state.player.dash.timer = this.state.player.dash.duration;
            this.state.player.dash.cooldown = 90;
            let dashAngle = this.state.player.angle;
            if (moveInput.isMoving) {
                dashAngle = Math.atan2(moveInput.moveY, moveInput.moveX);
            }
            this.state.player.dash.dx = Math.cos(dashAngle);
            this.state.player.dash.dy = Math.sin(dashAngle);
            
            if (this.audioEngine) this.audioEngine.playSFX('dash');
        }

        if (this.state.player.dash.cooldown > 0) {
            this.state.player.dash.cooldown--;
        }

        if (this.state.player.flashTime > 0) this.state.player.flashTime--;
        if (this.state.cameraShake > 0) this.state.cameraShake *= 0.9;
        if (this.state.cameraShake < 0.5) this.state.cameraShake = 0;
        if (this.state.cameraFlash > 0) this.state.cameraFlash--;

        this.state.player.breathPhase += 0.05;
        this.state.player.angle = moveInput.aimAngle;
        
        let currentSpeed = this.state.player.speed;
        
        if (this.state.player.dash.active) {
            currentSpeed *= this.state.player.activeTokens.hasPanic ? 2.5 : 3.5; 
            this.state.player.dash.timer--;
            
            this.state.player.x += this.state.player.dash.dx * currentSpeed;
            this.state.player.y += this.state.player.dash.dy * currentSpeed;

            if (!isHub && this.state.frame % 2 === 0) {
                this.state.playerAfterimages.push({
                    x: this.state.player.x, y: this.state.player.y, 
                    angle: this.state.player.angle, life: 1.0
                });
            }

            if (this.state.player.dash.timer <= 0) {
                this.state.player.dash.active = false;
            }
        } else if (moveInput.isMoving) {
            if (moveInput.moveX !== 0 && moveInput.moveY !== 0) {
                const len = Math.hypot(moveInput.moveX, moveInput.moveY);
                moveInput.moveX /= len;
                moveInput.moveY /= len;
            }
            this.state.player.x += moveInput.moveX * currentSpeed;
            this.state.player.y += moveInput.moveY * currentSpeed;
        }

        if (this.director && typeof this.director.updateParticles === 'function') {
            this.director.updateParticles();
        }

        if (isHub) return; 

        const mapCenterX = this.state.mapOriginX;
        const mapCenterY = this.state.mapOriginY;
        const distFromCenter = Math.hypot(this.state.player.x - mapCenterX, this.state.player.y - mapCenterY);
        
        let voidRadius = 1600;
        let isInsideSafeZone = false;

        for (let sz of this.state.safeZones) {
            if (Math.hypot(this.state.player.x - sz.x, this.state.player.y - sz.y) < sz.radius) {
                isInsideSafeZone = true;
                break;
            }
        }

        if (!isInsideSafeZone && distFromCenter > voidRadius) {
            this.state.inVoid = true;
            this.state.sanity -= 0.1;
            if (this.state.frame % 10 === 0) {
                this.state.cameraShake = Math.max(this.state.cameraShake, 2);
                this.spawnDamageText(this.state.player.x, this.state.player.y - 20, "VOID", '#800080', 1.0, 0.5);
            }
        } else {
            this.state.inVoid = false;
        }

        if (this.state.sanity > 0 && !this.state.inVoid && !isInsideSafeZone) {
            let drainRate = 0.02;
            if (this.state.player.curses && this.state.player.curses.includes('nyctophobia')) drainRate = 0.05;
            this.state.sanity -= drainRate; 
        }

        if (this.director && typeof this.director.spawnWave === 'function') {
            this.director.spawnWave(canvasWidth, canvasHeight);
        }
        
        for (let i = this.state.entities.length - 1; i >= 0; i--) {
            let ent = this.state.entities[i];
            if (typeof ent.update === 'function') {
                ent.update(this.state, this);
            }
        }

        Combat.resolveWeapons(this);
        Combat.collectXP(this);
        
        const requiredXP = Math.floor(10 * Math.pow(1.5, this.state.level - 1));
        if (this.state.xp >= requiredXP && this.onLevelUp) {
            this.state.level++;
            this.state.xp -= requiredXP;
            this.onLevelUp();
        }

        // --- RESTORED AUDIO HOOK ---
        // Dynamically modulates audio filters and triggers the procedural heartbeat
        if (this.audioEngine) {
            let sanityRatio = this.state.sanity / this.state.player.maxHp;
            if (!Number.isFinite(sanityRatio)) sanityRatio = 0;
            this.audioEngine.updateState(this.state.stress, sanityRatio);
        }
    }
}