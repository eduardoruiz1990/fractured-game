// src/core/Game.js
import { Combat } from '../systems/Combat.js';
import { Director } from '../systems/Director.js';
import { TOKENS, getActiveSynergies } from '../data/Manifestations.js'; 
import { HubWorld } from '../systems/HubWorld.js';
import { EventBus } from './EventBus.js';
import { getXPRequiredForLevel } from '../data/Config.js';

export class Game {
    constructor() {
        this.state = null;
        this.onDeath = null;
        this.onLevelUp = null;
        this.onFloorComplete = null; 
        this.audioEngine = null; 
        
        this.eventBus = new EventBus();
        this.director = new Director(this);
        this.hubWorld = new HubWorld(this);
    }

    init(saveManager, carriedState = null) {
        this.saveManager = saveManager;
        const meta = saveManager.metaState;

        // Patch 29.5: read the Synapse Tree resolver instead of meta.upgrades
        // directly, so legacy upgrades AND tree nodes both feed these buffs.
        // Defensive fallback reproduces the exact pre-29.5 legacy-only math for
        // saveManager-like objects that don't implement the resolver (e.g. the
        // plain mock objects test_bosses.js/test_content.js construct by hand).
        let stats, grants;
        if (saveManager && typeof saveManager.getResolvedUpgrades === 'function') {
            ({ stats, grants } = saveManager.getResolvedUpgrades());
        } else {
            stats = {
                sanity: (meta.upgrades.hp || 0) * 20,
                speed: (meta.upgrades.speed || 0) * 5,
                light: (meta.upgrades.light || 0) * 10,
                magnet: (meta.upgrades.magnet || 0) * 30
            };
            grants = new Set();
        }

        // Patch 31b: fold equipped tokens + earned set bonuses into the SAME bundle.
        // getResolvedTokenEffects() deliberately returns the same { stats, grants }
        // shape as getResolvedUpgrades(), so the merge is a plain sum with no
        // translation. tokenSetCounts feeds state.player.sets below, replacing the
        // hand-rolled counting loop that used to live here — one source of truth.
        let tokenSetCounts = {};
        if (saveManager && typeof saveManager.getResolvedTokenEffects === 'function') {
            const tokenBundle = saveManager.getResolvedTokenEffects();
            tokenSetCounts = tokenBundle.setCounts || {};
            for (const [key, value] of Object.entries(tokenBundle.stats || {})) {
                if (key === 'tagDamage') {
                    stats.tagDamage = stats.tagDamage || {};
                    for (const [tag, amt] of Object.entries(value)) {
                        stats.tagDamage[tag] = (stats.tagDamage[tag] || 0) + amt;
                    }
                } else {
                    stats[key] = (stats[key] || 0) + value;
                }
            }
            tokenBundle.grants.forEach(g => grants.add(g));
        }

        const maxSanity = 100 + (stats.sanity || 0);
        const speedBuff = 1.0 + ((stats.speed || 0) / 100);
        const lightBuff = 1.0 + ((stats.light || 0) / 100);

        const startFloor = carriedState ? carriedState.floor : 1;
        let effectiveMaxSanity = maxSanity;

        const pCurses = [];
        // Patch 31b: was a hand-rolled count in the loop below; now comes straight
        // off the token resolver so this can never disagree with what the loadout
        // screen shows. Combat.js and Renderer.js still read state.player.sets for
        // the insomniac 4pc burn zone, so the shape is unchanged.
        const pSets = tokenSetCounts;
        const pSynergies = [];
        // Patch 31b: these two were previously gated on ids ('adrenaline_gland',
        // 'broken_watch') that DO NOT EXIST in TOKENS — so the working code behind
        // them in Combat.js and Game.js could never fire. Now driven by grants
        // declared in the token data itself, which the resolver collects.
        const pTokens = { hasTwitch: false, hasPanic: false };

        // Patch 29.5: start_boon/start_weapon (C1/C2) only fire on a genuinely
        // fresh run, not a floor-descent carry-over — carriedState is null only
        // on a brand-new HUB-launched run. player.boons was previously never
        // carried across floors or pre-seeded here at all (LevelUpUI lazily
        // created it on first level-up); building it explicitly here is strictly
        // additive, not a change to that pre-existing (and out-of-scope) gap.
        const pBoons = carriedState && carriedState.boons ? [...carriedState.boons] : [];
        if (!carriedState && grants.has('start_boon')) {
            // 'reinforced_frame' is a flag-style boon (Game.js reads it via a plain
            // .includes() check, no instant-apply weapon mutation needed at pick
            // time) — safe to grant directly without going through LevelUpUI.
            pBoons.push('reinforced_frame');
        }

        pTokens.hasTwitch = grants.has('twitch_cooldown');
        pTokens.hasPanic = grants.has('panic_dash');

        // Set counting and the twitch/panic flags now come from the resolver above.
        // This loop survives only to collect token-attached curses — and it now
        // guards on tokenData, which the old version did not: a stale id left in an
        // inventory by an older build made `tokenData.curses` throw on undefined and
        // took the whole run start down with it.
        if (meta.equippedTokens) {
            Object.values(meta.equippedTokens).forEach(uid => {
                if (!uid) return;
                const invItem = meta.inventory.find(i => i.uid === uid);
                if (!invItem) return;
                const tokenData = TOKENS[invItem.id];
                if (tokenData && tokenData.curses) pCurses.push(...tokenData.curses);
            });
        }

        if (meta.selectedCurses && meta.selectedCurses.length > 0) pCurses.push(...meta.selectedCurses);

        if (pCurses.includes('fragile_mind')) effectiveMaxSanity = Math.floor(maxSanity * 0.5);

        let startSanity = carriedState ? carriedState.sanity : effectiveMaxSanity;

        this.state = {
            killCounts: meta.killCounts || {}, 
            hubWorld: this.hubWorld,           
            floor: startFloor,
            roomNumber: 1,
            maxRoomsPerFloor: 10,
            combatActive: true,
            roomCleared: false,
            convergence: 0,
            maxConvergence: Math.floor(100 * Math.pow(1.3, startFloor - 1)), 
            frame: 0,
            xp: carriedState ? carriedState.xp : 0,
            level: carriedState ? carriedState.level : 1,
            lucidity: carriedState ? carriedState.lucidity : 0, 
            nextLevelXP: getXPRequiredForLevel(carriedState ? carriedState.level : 1),
            sanity: startSanity,
            inVoid: false,
            cameraShake: 0,
            cameraFlash: 0,
            hitStop: 0,
            bossSpawned: false,
            activeBoss: null,
            mapOriginX: null,
            mapOriginY: null,
            runInventory: carriedState ? carriedState.runInventory : [],
            telemetry: (carriedState && carriedState.telemetry) ? carriedState.telemetry : this.createFreshTelemetry(startSanity),

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
                boons: pBoons,
                // Patch 29.5: sums per-tag damage bonuses (F5/F7). Consumed by Combat.js.
                // Patch 31b: token tagDamage (melee/kinetic/tech) is merged in too.
                tagDamage: stats.tagDamage || {},
                // Patch 31b: TOTAL vacuum-radius bonus in px (legacy + tree + tokens).
                // getResolvedUpgrades already returns magnet in px (level x 30), and
                // token magnet effects are px too, so the merge above is already the
                // correct total. Combat.js now reads this instead of recomputing from
                // upgrades.magnet — recomputing there would miss the token half.
                vacRadiusBonusPx: stats.magnet || 0,
                flashTime: 0,
                breathPhase: 0,
                // Patch 31b: body_denial's 'denial_shield' grant — "begin each floor
                // with a shield that ignores one hit". init() runs on every floor
                // descent, so granting it here gives exactly the per-floor cadence
                // the token promises. Before this, denialShieldActive started false
                // unconditionally and body_denial did nothing at all.
                denialShieldActive: grants.has('denial_shield'),
                // Institutionalized 4pc: shockwave on damage, and no dashing.
                hasShockwaveOnHit: grants.has('shockwave_no_dash'),
                noDash: grants.has('shockwave_no_dash'),
                // Medicated 2pc. The pre-existing dmgReduction check in takeDamage
                // read state.player.sets.medicated — a set that did not exist until
                // Patch 31, so that code was unreachable. Now driven by the grant.
                hasMedicatedMitigation: grants.has('medicated_mitigation'),
                // R6's 'denial_recharge' grant: the shield rearms itself on a long
                // timer after being consumed, instead of staying gone for the run.
                hasDenialRecharge: grants.has('denial_recharge'),
                denialRechargeTimer: 0,
                // Patch 19: base i-frame duration lives here (not a magic number in
                // takeDamage) so the Synapse Tree's R4/R7 nodes (iframes +Xf) can add to
                // it the same way maxSanity/speedBuff/lightBuff are built from base+upgrades.
                iframeDuration: 30 + (stats.iframes || 0),
                iframes: 0,
                lastHitAngle: null,
                hitIndicatorTime: 0,
                dash: {
                    active: false, timer: 0,
                    duration: 12 + (stats.dashDuration || 0),
                    cooldown: 0,
                    // M3's dashCooldown is a negative frame delta (-15f); clamped so
                    // stacking future nodes can never reach a degenerate near-0 cooldown.
                    baseCooldown: Math.max(20, 90 + (stats.dashCooldown || 0)),
                    // M7's 'dash_charge_2' grant: a real second charge, not just a
                    // shorter cooldown — see processGameLogic's charge-regen block.
                    maxCharges: 1 + (grants.has('dash_charge_2') ? 1 : 0),
                    charges: 1 + (grants.has('dash_charge_2') ? 1 : 0),
                    dx: 0, dy: 0
                },
                weapons: carriedState ? carriedState.weapons : {
                    flashlight: {
                        level: 1, damage: 15, radius: 250 * lightBuff,
                        // F3/F7's flashlightAngle has no legacy equivalent — applied here
                        // directly as a percentage widening of the base cone.
                        angle: 0.6 * (1 + (stats.flashlightAngle || 0) / 100), type: 'cone',
                        tags: ['light', 'focus']
                    },
                    static: { level: 0, damage: 5, radius: 100, active: false, pulsePhase: 0, tags: ['aura', 'tech'] },
                    polaroid_camera: { level: 0, damage: 30, radius: 300, angle: Math.PI/3, cooldown: 180, timer: 0, tags: ['burst', 'light'] },
                    fidget_spinner: { level: 0, damage: 8, baseRadius: 60, speed: 0.1, tags: ['orbit', 'kinetic'] },
                    // C2's 'start_weapon:<choice>' grant: no selection UI exists yet (the
                    // '<choice>' in the grant string is a placeholder for future work), so
                    // this always grants the same fixed weapon — lead_pipe at level 1 —
                    // rather than fabricating a choice mechanism that isn't built.
                    lead_pipe: { level: grants.has('start_weapon:<choice>') ? 1 : 0, damage: 45, radius: 70, cooldown: 90, timer: 0, tags: ['melee', 'kinetic'] },
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
            playerAfterimages: []
        };
        
        // Patch 31b: the insomniac 2pc flashlight bonus USED to be applied here as a
        // hardcoded x1.25. It now lives in TOKEN_SETS.insomniac.bonuses[2] as
        // { light: 25 } and flows through lightBuff above like every other light
        // source. Re-applying it here would double-count it.

        this.state.player.synergies = getActiveSynergies(this.state.player.weapons);

        // Patch 32b: was a flat curses.length*0.15 — every curse paid the same 15%
        // regardless of how much real risk it added. Now reads the weighted ladder
        // from Manifestations.js via the same resolver UIManager's curse screen
        // uses, passing state.player.curses (not metaState.selectedCurses) so a
        // token-granted curse's weight is counted too, not just adopted ones.
        // Falls back to the pre-32 flat rate for saveManager-like objects that
        // don't implement the resolver (test harness mocks).
        let curseBonusPct;
        if (saveManager && typeof saveManager.getResolvedCurseBonus === 'function') {
            curseBonusPct = saveManager.getResolvedCurseBonus(this.state.player.curses).totalPct;
        } else {
            curseBonusPct = this.state.player.curses.length * 15;
        }

        // Patch 29.5: T3/T6/T7's lucidityGain (no legacy equivalent) stacks onto the
        // existing curse-driven bonus rather than replacing it.
        this.state.lucidityBonusMultiplier = 1 + (curseBonusPct / 100) + ((stats.lucidityGain || 0) / 100);

        // FIXED: The engine requires 'startGameDrone()', not 'startDrone()'
        if (this.audioEngine) this.audioEngine.startGameDrone();

        // Dispatch initialized event for UI to attach achievement listeners
        document.dispatchEvent(new CustomEvent('game_initialized', { detail: { game: this } }));
    }

    getCarriedState() {
        return {
            floor: this.state.floor,
            sanity: this.state.sanity,
            weapons: this.state.player.weapons,
            xp: this.state.xp,
            level: this.state.level,
            lucidity: this.state.lucidity,
            runInventory: this.state.runInventory,
            boons: this.state.player.boons,
            telemetry: this.state.telemetry
        };
    }

    // DEV: run telemetry (Patch 13). Fresh per HUB-launched run, carried across
    // floor descents via getCarriedState() so "first boss"/"first boon" stay
    // run-relative rather than resetting every floor. Read by the dev overlay
    // and death-time console dump in main.js.
    createFreshTelemetry(startSanity) {
        return {
            runStartWallClock: performance.now(),
            firstBoonAt: null,
            firstBossAt: null,
            roomClearTimes: [],
            damagePerRoom: [],
            sanityLowWater: startSanity,
            lastRoomNumber: 1,
            currentRoomStartWallClock: performance.now(),
            currentRoomDamage: 0
        };
    }

    takeDamage(amount) {
        // Already invulnerable from a previous hit this window — ignore entirely,
        // same as denialShieldActive's block below, just without consuming anything.
        if (this.state.player.iframes > 0) return;

        if (this.state.player.denialShieldActive) {
            this.state.player.denialShieldActive = false;
            this.state.cameraFlash = 10;
            this.state.cameraShake = 20;
            if (this.audioEngine) this.audioEngine.playSFX('glass_shatter');
            // R6's grant, additive only — without it this block is unchanged.
            if (this.state.player.hasDenialRecharge) this.state.player.denialRechargeTimer = 2700; // 45s @ 60fps
            return;
        }

        if (this.state.player.curses && this.state.player.curses.includes('hemophilia')) {
            amount *= 1.5;
        }

        let dmgReduction = 0;
        // Patch 31b: was `sets.medicated >= 2`, referring to a set that did not exist
        // until Patch 31 created it — so this branch was unreachable dead code. Now
        // driven by the grant the medicated 2pc bonus actually declares.
        if (this.state.player.hasMedicatedMitigation) {
            dmgReduction = 0.2;
        }

        if (this.state.player.boons && this.state.player.boons.includes('reinforced_frame')) {
            // Additive with the set bonus, clamped so stacking can never reach immunity.
            dmgReduction = Math.min(0.75, dmgReduction + 0.15);
        }

        const finalDmg = amount * (1 - dmgReduction);
        this.state.sanity -= finalDmg;

        if (this.state.telemetry) {
            this.state.telemetry.currentRoomDamage += finalDmg;
            if (this.state.sanity < this.state.telemetry.sanityLowWater) {
                this.state.telemetry.sanityLowWater = Math.max(0, this.state.sanity);
            }
        }

        this.state.player.flashTime = 10;
        this.state.player.iframes = this.state.player.iframeDuration;
        this.state.cameraShake = Math.max(this.state.cameraShake, finalDmg * 2);

        // Directional hit indicator. takeDamage() only receives an amount — every
        // caller (projectiles, contact damage, boss attacks) lives outside this
        // patch's file scope (Combat.js, entity files), so there's no source
        // position to read directly. Nearest enemy is a reasonable stand-in: for
        // contact damage it IS the source, and for most ranged hits it's still the
        // immediate threat the player needs to react to.
        if (this.state.entities && this.state.entities.length > 0) {
            let nearest = null, minD = Infinity;
            for (const e of this.state.entities) {
                const d = Math.hypot(e.x - this.state.player.x, e.y - this.state.player.y);
                if (d < minD) { minD = d; nearest = e; }
            }
            if (nearest) {
                this.state.player.lastHitAngle = Math.atan2(nearest.y - this.state.player.y, nearest.x - this.state.player.x);
                this.state.player.hitIndicatorTime = 40;
            }
        }

        if (this.state.player.boons && this.state.player.boons.includes('toxic_blood')) {
            if (this.director && typeof this.director.spawnInkPuddle === 'function') {
                this.director.spawnInkPuddle(this.state.player.x, this.state.player.y, 60, 5);
            }
        }

        // static_discharge: previously defined as a card but never implemented — the
        // player could pick it and nothing happened. Damages everything in a burst.
        if (this.state.player.boons && this.state.player.boons.includes('static_discharge')) {
            const burstRadius = 220;
            this.state.entities.forEach(ent => {
                if (Math.hypot(ent.x - this.state.player.x, ent.y - this.state.player.y) < burstRadius) {
                    ent.takeDamage(35, this);
                }
            });
            this.spawnParticles(this.state.player.x, this.state.player.y, '#00ffff', 30);
            this.state.cameraShake = Math.max(this.state.cameraShake, 18);
        }

        // Patch 31b: Institutionalized 4pc — "taking damage triggers an AoE
        // shockwave, but you cannot dash". Wider and harder-hitting than
        // static_discharge above, since it costs an entire 4-token set plus the
        // dash. Both can fire on the same hit; that is the intended payoff for
        // committing to the set AND spending a boon pick on the same idea.
        if (this.state.player.hasShockwaveOnHit) {
            const shockRadius = 300;
            this.state.entities.forEach(ent => {
                if (Math.hypot(ent.x - this.state.player.x, ent.y - this.state.player.y) < shockRadius) {
                    ent.takeDamage(60, this);
                }
            });
            this.spawnParticles(this.state.player.x, this.state.player.y, '#ffddaa', 40);
            this.state.cameraShake = Math.max(this.state.cameraShake, 26);
        }

        // martyr: leaves a warding circle (2x damage zone) where you were hit.
        if (this.state.player.boons && this.state.player.boons.includes('martyr')) {
            if (this.director && typeof this.director.spawnSafeZone === 'function') {
                this.director.spawnSafeZone(this.state.player.x, this.state.player.y, 90, 240);
            }
        }

        if (this.audioEngine && finalDmg > 0) this.audioEngine.playSFX('player_hurt');
        
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

        // DEV: run telemetry tick (Patch 13). One-frame-late detection of room
        // clears / boss spawn is fine at this granularity; keeps this out of
        // Combat.js/Director.js where the actual transitions happen.
        if (!isHub && this.state.telemetry) {
            const tel = this.state.telemetry;

            if (this.state.bossSpawned && tel.firstBossAt === null) {
                tel.firstBossAt = performance.now() - tel.runStartWallClock;
            }

            if (this.state.roomNumber !== tel.lastRoomNumber) {
                tel.roomClearTimes.push(performance.now() - tel.currentRoomStartWallClock);
                tel.damagePerRoom.push(tel.currentRoomDamage);
                tel.lastRoomNumber = this.state.roomNumber;
                tel.currentRoomStartWallClock = performance.now();
                tel.currentRoomDamage = 0;
            }
        }

        this.state.input = moveInput;

        // Patch 31b: player.noDash is the Institutionalized 4pc's cost, and reuses the
        // exact same suppression path the lead_shoes boon already established.
        const canDash = !this.state.player.noDash
            && !(this.state.player.boons && this.state.player.boons.includes('lead_shoes'));
        // Patch 29.5: charge-based (M7's dash_charge_2 grant can raise maxCharges to
        // 2). Ready to dash whenever a charge is banked, regardless of whether the
        // regen timer toward the NEXT charge is still counting down.
        if (canDash && moveInput.isDashing && !this.state.player.dash.active && this.state.player.dash.charges > 0) {
            this.state.player.dash.active = true;
            this.state.player.dash.timer = this.state.player.dash.duration;
            this.state.player.dash.charges--;
            // Only (re)start the regen timer if it isn't already running — spending a
            // second banked charge shouldn't reset progress toward the first refill.
            if (this.state.player.dash.cooldown <= 0 && this.state.player.dash.charges < this.state.player.dash.maxCharges) {
                this.state.player.dash.cooldown = this.state.player.dash.baseCooldown;
            }
            let dashAngle = this.state.player.angle;
            if (moveInput.isMoving) {
                dashAngle = Math.atan2(moveInput.moveY, moveInput.moveX);
            }
            this.state.player.dash.dx = Math.cos(dashAngle);
            this.state.player.dash.dy = Math.sin(dashAngle);
            
            if (this.audioEngine) this.audioEngine.playSFX('dash');

            if (this.state.player.boons && this.state.player.boons.includes('shadow_step')) {
                this.state.entities.forEach(ent => {
                    let d = Math.hypot(ent.x - this.state.player.x, ent.y - this.state.player.y);
                    if (d < 250) ent.confused = Math.max(ent.confused || 0, 60);
                });
            }
        }

        // Regens one charge at a time, each taking baseCooldown frames, only while
        // below maxCharges. main.js's dash-bar HUD still reads dash.cooldown against
        // a hardcoded /90 — out of this patch's file scope (Game.js/Combat.js/
        // LevelUpUI.js only), so with M3 owned or a second charge banked the bar
        // will read slightly off. Flagged for a future HUD patch (Patch 38), not
        // fixed here.
        if (this.state.player.dash.charges < this.state.player.dash.maxCharges) {
            if (this.state.player.dash.cooldown > 0) {
                this.state.player.dash.cooldown--;
            } else {
                this.state.player.dash.charges++;
                if (this.state.player.dash.charges < this.state.player.dash.maxCharges) {
                    this.state.player.dash.cooldown = this.state.player.dash.baseCooldown;
                }
            }
        }

        if (this.state.player.denialRechargeTimer > 0) {
            this.state.player.denialRechargeTimer--;
            if (this.state.player.denialRechargeTimer <= 0) {
                this.state.player.denialShieldActive = true;
            }
        }

        if (this.state.player.flashTime > 0) this.state.player.flashTime--;
        if (this.state.player.iframes > 0) this.state.player.iframes--;
        if (this.state.player.hitIndicatorTime > 0) this.state.player.hitIndicatorTime--;
        if (this.state.cameraShake > 0) this.state.cameraShake *= 0.9;
        if (this.state.cameraShake < 0.5) this.state.cameraShake = 0;
        if (this.state.cameraFlash > 0) this.state.cameraFlash--;

        this.state.player.breathPhase += 0.05;
        this.state.player.angle = moveInput.aimAngle;
        
        let currentSpeed = this.state.player.speed;

        if (this.state.player.boons && this.state.player.boons.includes('adrenaline_surge')) {
            let sanityRatio = this.state.player.maxHp > 0 ? (this.state.sanity / this.state.player.maxHp) : 1;
            if (sanityRatio < 0.3) currentSpeed *= 2;
        }
        
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

        this.state.activeBoss = this.state.entities.find(e => ['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'].includes(e.type)) || null;
    
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
            if (this.state.combatActive && !this.state.isTutorial) {
                this.state.sanity -= 0.1;
            }
            if (this.state.frame % 10 === 0) {
                this.state.cameraShake = Math.max(this.state.cameraShake, 2);
                let voidColor = '#800080';
                if (this.state.floor === 1) voidColor = '#a05a2c';
                else if (this.state.floor === 2) voidColor = '#555555';
                else if (this.state.floor === 3) voidColor = '#8b0000';
                else if (this.state.floor === 4) voidColor = '#2e8b57';
                else if (this.state.floor >= 5) voidColor = '#daa520';
                
                this.spawnDamageText(this.state.player.x, this.state.player.y - 20, "VOID", voidColor, 1.0, 0.5);
            }
        } else {
            this.state.inVoid = false;
        }

        if (this.state.sanity > 0 && !this.state.inVoid && !isInsideSafeZone && this.state.combatActive) {
            if (!this.state.isTutorial) {
                let drainRate = 0.02;
                if (this.state.player.curses && this.state.player.curses.includes('nyctophobia')) drainRate = 0.05;
                if (this.state.player.curses && this.state.player.curses.includes('manic_episode')) drainRate *= 2;
                // glass_cannon: the drain half of its tradeoff (damage half is in Combat.js).
                if (this.state.player.boons && this.state.player.boons.includes('glass_cannon')) drainRate *= 2;
                this.state.sanity -= drainRate;
            }
        }

        // second_wind: slow regen while badly hurt. Runs outside the drain block so it
        // still ticks inside safe zones and the Void, where drain is suppressed.
        if (this.state.sanity > 0 && this.state.player.boons && this.state.player.boons.includes('second_wind')) {
            if (this.state.sanity < this.state.player.maxHp * 0.25) {
                this.state.sanity = Math.min(this.state.player.maxHp, this.state.sanity + 0.05);
            }
        }

        if (this.state.sanity <= 0 && this.onDeath) {
            this.state.sanity = 0;
            this.onDeath();
        }

        // DEV: devFreezeEntities halts enemy AI and further spawning so a state can be
        // held still and inspected. Rendering keeps ticking, so animations still play.
        const devFrozen = !!this.state.devFreezeEntities;

        if (this.director && typeof this.director.spawnWave === 'function' && !devFrozen) {
            this.director.spawnWave(canvasWidth, canvasHeight);
        }

        if (!devFrozen) {
            for (let i = this.state.entities.length - 1; i >= 0; i--) {
                let ent = this.state.entities[i];
                if (typeof ent.update === 'function') {
                    ent.update(this.state, this);
                }
            }
        }

        Combat.resolveWeapons(this);
        Combat.collectXP(this);
        
        const requiredXP = getXPRequiredForLevel(this.state.level);
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