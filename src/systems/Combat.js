// src/systems/Combat.js
import { LUCIDITY_PER_XP } from '../data/Horde.js';   // Patch 165
import { ROOM_PACE, DOOR_ENTER_STEPS } from '../data/Config.js';   // Patch 168, 170
// Patch 168: kill-pop ring colours (the same as the eyes in the dark).
const POP_COLOURS = { SCAVENGER: '#ffd24a', PREDATOR: '#ff5a48', PARASITE: '#9dff6a', SPLITTER: '#f4f0e0', WARDEN: '#ffb347', BURROWER: '#ffc9a0' };
import { getActiveSynergies, LIGHT_RECOIL_RESIST, TOKEN_RARITIES } from '../data/Manifestations.js';

// Patch 130 (V2 plan C8): juice constants. Sim steps (Game.update counts them).
export const BOSS_DEATH_SLOWMO_STEPS = 72;
/**
 * 0 for common, rising with rarity in TOKEN_RARITIES' own order (common, rare, epic,
 * legendary, mythic), capped at 3; an unknown rarity reads as 0.
 */
export function tokenBurstTier(rarity) {
    const i = Object.keys(TOKEN_RARITIES).indexOf(String(rarity || '').toLowerCase());
    return i < 0 ? 0 : Math.min(3, i);
}
// Patch 95 — the weapon ceiling comes off in THE RECURSION. See src/core/Endless.js.
import { weaponLevelCap } from '../core/Endless.js';

/**
 * Flashlight cone falloff (Patch 63).
 *
 * The cone used to be binary — anywhere inside it dealt identical damage and an
 * identical shove. That made sweeping the beam strictly better than aiming it, and
 * removed any reason to prioritise one target over another.
 *
 * The two curves are deliberately different shapes:
 *   - damage falls off GENTLY (1.0 centre -> 0.55 edge), so clipping something with
 *     the edge of the beam is still worth doing.
 *   - recoil falls off STEEPLY (quadratic, 1.0 centre -> 0.10 edge), so only a
 *     deliberate, direct beam actually holds something off. This is what creates the
 *     "which one do I point at?" tension when several are closing at once.
 *
 * Pure and exported so the curve is testable without standing up a combat frame.
 *
 * @param {number} angleDiff  signed angle from beam centre to the target, radians
 * @param {number} hitAngle   the cone's half-width, radians
 * @returns {{centrality:number, damageScale:number, recoilScale:number}}
 */
export function coneFalloff(angleDiff, hitAngle) {
    if (!Number.isFinite(angleDiff) || !Number.isFinite(hitAngle) || hitAngle <= 0) {
        return { centrality: 1, damageScale: 1, recoilScale: 1 };
    }
    const centrality = Math.max(0, Math.min(1, 1 - Math.abs(angleDiff) / hitAngle));
    return {
        centrality,
        damageScale: 0.55 + 0.45 * centrality,
        recoilScale: 0.10 + 0.90 * centrality * centrality
    };
}
// Patch 51c: the enemy-death catch below swallows into console.warn only. It sits
// on the hottest gameplay path there is, so anything failing there is exactly what
// the crash telemetry needs to see. Only touched when something already threw.
import { errorLog } from '../core/ErrorLog.js';
import { isBossType, MAX_WEAPON_SLOTS, ownedWeaponCount } from '../data/Config.js';   // Patch 117, 132
// Patch 132 (V2 plan D3): the four Phase D weapons. See src/systems/Arsenal.js.
import { resolveArsenal, applyArsenalStatus } from './Arsenal.js';
// Patch 133 (V2 plan D4): named elites drop chests. See src/systems/Elites.js.
import { dropChest, resolveChest, CHEST_OPEN_STEPS } from './Elites.js';
import { dropPage, updatePage, collectLoosePages } from './CasePages.js';   // Patch 144
import { bossDeathLine, BOSS_DEATH_SUBTITLE_STEPS } from '../data/Story.js';   // Patch 146
// Patch 134 (V2 plan D2): a chest evolves a qualifying weapon first.
import { evolveForChest } from './Evolutions.js';
import { floorPressure } from '../data/Difficulty.js';   // Patch 156

// Patch 16: generic tag-scaled knockback, consumed by Enemy.takeDamage's
// optional knockbackForce param. Only wired at call sites with no existing
// hand-tuned push (camera's 30px shove, lead_pipe's 25px shove, and the
// centrifuge synergy's deliberately-capped 12px are left untouched — they
// already have impulse-like behavior and are separately tuned).
function tagKnockback(tags, damage) {
    if (!tags || tags.includes('aura') || tags.includes('passive')) return 0;
    if (tags.includes('kinetic') || tags.includes('melee')) return Math.min(14, 3 + damage * 0.4);
    return Math.min(6, 1 + damage * 0.15);
}

// Patch 18: cameraShake-only impact weight by tag. Deliberately NOT generalizing
// hitStop here — hitStop is a full sim freeze (Game.processGameLogic short-circuits
// every frame it's > 0), so it stays wired to lead_pipe's existing cooldown-gated
// swing alone (Keep: its Math.min(25, ...) ceiling, untouched below). Applying
// hitStop to any per-frame continuous tick (flashlight, static, ink) would
// stutter-freeze the game solid for as long as the tick kept firing. `passive`
// is excluded (a DoT layered on top of another hit, not a player-aimed swing);
// `aura` is NOT excluded here despite Patch 16 excluding it for knockback — the
// spec names static explicitly as the "light" example for this weight.
function tagShake(tags, damage) {
    if (!tags || tags.includes('passive')) return 0;
    if (tags.includes('kinetic') || tags.includes('melee')) return Math.min(10, 3 + damage * 0.35);
    return Math.min(6, 1 + damage * 0.15);
}

// Patch 29.5: F5/F7 grant tagDamage bonuses (percent) keyed per weapon tag, summed
// onto state.player.tagDamage at Game.init. Only wired to flashlight and
// polaroid_camera — the two weapons that actually carry the light/focus tags AND
// roll direct damage. broken_chalk also carries 'focus' but never deals damage
// itself (its whole effect is the safeZone 2x dmgMult on OTHER weapons), so there
// is nothing here for a per-hit multiplier to apply to.
function tagDamageMultiplier(tags, tagDamageStats) {
    if (!tags || !tagDamageStats) return 1;
    let bonus = 0;
    for (const t of tags) bonus += (tagDamageStats[t] || 0);
    return 1 + bonus / 100;
}

/**
 * Patch 182: whether a solid wall stands between (ax, ay) and (bx, by). Blocks are
 * axis-aligned boxes (a slab test), posts are circles. Arcs do not block: they are
 * thin and curved, and the Renderer does not shadow them either.
 */
export function beamBlocked(obstacles, ax, ay, bx, by) {
    if (!obstacles || !obstacles.length) return false;
    const dx = bx - ax, dy = by - ay;
    for (let i = 0; i < obstacles.length; i++) {
        const o = obstacles[i];
        if (!o || !o.solid || o.cap) continue;
        if (o.kind === 'block') {
            let t0 = 0, t1 = 1, hit = true;
            for (let axis = 0; axis < 2 && hit; axis++) {
                const p0 = axis ? ay : ax, d = axis ? dy : dx;
                const lo = (axis ? o.y - o.hh : o.x - o.hw), hi = (axis ? o.y + o.hh : o.x + o.hw);
                if (Math.abs(d) < 1e-9) { if (p0 < lo || p0 > hi) hit = false; continue; }
                let ta = (lo - p0) / d, tb = (hi - p0) / d;
                if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
                if (ta > t0) t0 = ta;
                if (tb < t1) t1 = tb;
                if (t0 > t1) hit = false;
            }
            // t0 > 0: the light starts outside the wall; an enemy standing inside one is not hidden
            if (hit && t0 > 0.001 && t0 < 0.999 && t1 < 0.999) return true;
        } else if (o.kind === 'post' && o.r > 0) {
            const len2 = dx * dx + dy * dy;
            if (len2 < 1e-9) continue;
            const t = Math.max(0, Math.min(1, ((o.x - ax) * dx + (o.y - ay) * dy) / len2));
            const cx = ax + dx * t - o.x, cy = ay + dy * t - o.y;
            if (cx * cx + cy * cy < o.r * o.r * 0.7 && t > 0.02 && t < 0.98) return true;
        }
    }
    return false;
}

export class Combat {
    static resolveWeapons(game) {
        const state = game.state;
        let deathCount = 0;

        for (let i = state.projectiles.length - 1; i >= 0; i--) {
            let p = state.projectiles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life--;
            
            let distToPlayer = Math.hypot(p.x - state.player.x, p.y - state.player.y);
            if (distToPlayer < p.radius + state.player.radius && (!state.player.dash || !state.player.dash.active)) {
                // Patch 124: projectiles are boss-fired; credit the boss on screen.
                game.takeDamage(p.damage, p.source || (state.activeBoss && state.activeBoss.type) || 'PROJECTILE');
                p.life = 0; 
                game.spawnParticles(p.x, p.y, p.color, 10);
            }
            
            if (p.life <= 0) {
                p.active = false;
                if (game.director && game.director.pools && game.director.pools.projectile) {
                    game.director.pools.projectile.release(p);
                }
                state.projectiles.splice(i, 1);
            }
        }

        if (state.interactables) {
            for (let obj of state.interactables) {
                if (obj.type === 'BREAKER_BOX') {
                    if (!obj.active) {
                        const dx = obj.x - state.player.x; 
                        const dy = obj.y - state.player.y;
                        const dist = Math.max(Math.hypot(dx, dy), 0.001);
                        
                        if (dist < state.player.weapons.flashlight.radius) {
                            const angle = Math.atan2(dy, dx);
                            let diff = angle - state.player.angle;
                            if (Number.isFinite(diff)) {
                                while(diff < -Math.PI) diff += Math.PI*2;
                                while(diff > Math.PI) diff -= Math.PI*2;
                                
                                if (Math.abs(diff) < state.player.weapons.flashlight.angle) {
                                    obj.charge += 1;
                                    game.spawnParticles(obj.x, obj.y, '#ffffaa', 1);
                                    
                                    if (obj.charge > 60) { 
                                        obj.active = true;
                                        obj.life = 450; 
                                        state.cameraShake = 30;
                                        if (game.audioEngine) game.audioEngine.playSFX('breaker_box', 0.8);
                                    }
                                }
                            }
                        }
                    } else {
                        obj.life--;
                        if (state.frame % 10 === 0) game.spawnParticles(obj.x, obj.y, '#ffffff', 3);
                        
                        for (let ent of state.entities) {
                            if (Math.hypot(ent.x - obj.x, ent.y - obj.y) < obj.radius) {
                                ent.x -= (ent.vx || 0) * (ent.speedModifier || 1);
                                ent.y -= (ent.vy || 0) * (ent.speedModifier || 1);
                                
                                if (ent.attackState) ent.attackState = 'hunting';
                                if (ent.lashingState) ent.lashingState = 'searching';
                                if (ent.vacuumState) ent.vacuumState = 'hunting';
                                if (ent.pulseState) ent.pulseState = 'hunting';
                                if (ent.shootState) ent.shootState = 'hunting';
                                if (ent.actionState && ent.type !== 'ARCHITECT') ent.actionState = 'pulling'; 

                                if (state.frame % 30 === 0) {
                                    ent.takeDamage(20, game);
                                    game.spawnParticles(ent.x, ent.y, '#ffffaa', 5);
                                }
                            }
                        }
                        if (obj.life <= 0) obj.dead = true;
                    }
                } else if (obj.type === 'OBJECTIVE_BACKPACK') {
                    obj.life--;
                    if (obj.life <= 0) {
                        obj.dead = true;
                        game.spawnParticles(obj.x, obj.y, '#555555', 10); 
                    } else {
                        const distToPlayer = Math.hypot(obj.x - state.player.x, obj.y - state.player.y);
                        if (distToPlayer < obj.radius + state.player.radius) {
                            obj.dead = true;
                            game.spawnXP(obj.x, obj.y, 8, true); 
                            state.sanity = Math.min(state.player.maxHp, state.sanity + 50); 
                            state.cameraShake = 20;
                            
                            if (game.audioEngine) game.audioEngine.playSFX('backpack', 0.8);
                            
                            game.spawnParticles(obj.x, obj.y, '#55ff55', 30);
                            game.spawnDamageText(obj.x, obj.y - 30, "SUPPLIES RECOVERED!", '#55ff55', 1.5, 2.0);
                        }
                    }
                } else if (obj.type === 'CHEST') {
                    // Patch 133: walk in, a short opening beat (the lid rattles and the
                    // shake builds), then the burst and the reward. Counted in sim steps.
                    if (!obj.opening) {
                        const d = Math.hypot(obj.x - state.player.x, obj.y - state.player.y);
                        if (d < obj.radius + state.player.radius) {
                            obj.opening = 1;
                            if (game.audioEngine) game.audioEngine.playSFX('backpack', 0.7);
                        }
                    } else {
                        obj.opening++;
                        state.cameraShake = Math.max(state.cameraShake, 2 + obj.opening * 0.25);
                        if (obj.opening % 6 === 0) game.spawnParticles(obj.x, obj.y, '#d9a441', 2);
                        if (obj.opening >= CHEST_OPEN_STEPS) {
                            obj.dead = true;
                            const result = resolveChest(state, { evolve: evolveForChest });
                            if (typeof game.refreshSynergies === 'function') game.refreshSynergies();
                            state.hitStop = Math.max(state.hitStop || 0, 8);
                            state.slowMo = Math.max(state.slowMo || 0, 24);
                            state.cameraShake = Math.max(state.cameraShake, 18);
                            game.spawnParticles(obj.x, obj.y, '#ffd27f', 40);
                            game.spawnParticles(obj.x, obj.y, '#ffffff', 20);
                            // Patch 172: the burst, a big pop and a crown of small ones.
                            if (typeof game.spawnPop === 'function') {
                                game.spawnPop(obj.x, obj.y - 8, '#ffd27f', 4.5);
                                for (let k = 0; k < 8; k++) game.spawnPop(obj.x + Math.cos(k * 0.785) * 46, obj.y - 8 + Math.sin(k * 0.785) * 46, k % 2 ? '#fff3c4' : '#ffb347', 1.3);
                            }
                            state.cameraFlash = Math.max(state.cameraFlash || 0, 5);
                            if (game.audioEngine) game.audioEngine.playSFX('chest_open', 0.9);   // Patch 183
                            game.spawnDamageText(obj.x, obj.y - 30, result.title, '#ffd27f', 1.5, 2.2);
                            if (game.audioEngine) game.audioEngine.playSFX('ui_upgrade', 1.0);
                            if (typeof game.onChestOpened === 'function') {
                                try { game.onChestOpened(result); } catch (e) { console.error(e); }
                            }
                        }
                    }
                } else if (obj.type === 'CASE_PAGE') {
                    updatePage(game, obj);   // Patch 144: drifts to a near player, files on touch
                } else if (obj.type === 'EXIT_ELEVATOR') {
                    const distToPlayer = Math.hypot(obj.x - state.player.x, obj.y - state.player.y);
                    if (distToPlayer < obj.radius + state.player.radius) {
                        collectLoosePages(game);   // Patch 144: a page left lying is filed, not lost
                        if (game.onFloorComplete) game.onFloorComplete();
                        obj.dead = true; 
                    }
                } else if (obj.type === 'ROOM_DOOR') {
                    const distToPlayer = Math.hypot(obj.x - state.player.x, obj.y - state.player.y);
                    // Patch 170: walking THROUGH the door. Touching it starts a short
                    // entry (DOOR_ENTER_STEPS): the player is drawn into the arch and
                    // cannot be hurt, the screen fills with the door's light
                    // (Renderer.drawDoorTransition reads state.doorFx), and only then
                    // does the room change, behind the light.
                    if (!obj.entering && !state.doorFx_busy && distToPlayer < obj.radius + state.player.radius) {
                        obj.entering = DOOR_ENTER_STEPS;
                        state.doorFx_busy = true;
                        state.doorFx = { born: state.frame, x: obj.x, y: obj.y, rewardType: obj.rewardType };
                        if (game.audioEngine) game.audioEngine.playSFX('door', 0.8);   // Patch 183
                        if (typeof game.onHaptic === 'function') game.onHaptic('hit');
                    }
                    if (obj.entering > 0) {
                        obj.entering--;
                        state.player.x += (obj.x - state.player.x) * 0.22;
                        state.player.y += (obj.y - state.player.y) * 0.22;
                        state.player.iframes = Math.max(state.player.iframes || 0, 50);
                    }
                    if (obj.entering === 0) {
                        obj.entering = undefined;
                        state.doorFx_busy = false;
                        obj.dead = true;

                        // Patch 165: the first door a new player walks through ends
                        // their first session's hand-holding (no scripted tutorial room).
                        state.isTutorial = false;
                        state.firstRoom = false;
                        if (game.saveManager && !game.saveManager.metaState.tutorialCompleted) {
                            game.saveManager.metaState.tutorialCompleted = true;
                            game.saveManager.saveGame();
                        }

                        if (obj.rewardType === 'LUCIDITY') {                            state.lucidity += 50;
                            state.xp += 50;
                            game.spawnDamageText(state.player.x, state.player.y - 20, "+50 LUCIDITY", '#ffddaa', 1.5, 2.0);
                        } else if (obj.rewardType === 'HEAL') {
                            state.sanity = Math.min(state.player.maxHp, state.sanity + 50);
                            // "RESTORED" is load-bearing wording, not flavour: this line
                            // is min(maxHp, sanity + 50) — it refills lost Sanity and
                            // never raises the maximum. A player reported not being able
                            // to tell which of the two it was.
                            game.spawnDamageText(state.player.x, state.player.y - 20, "+50 SANITY RESTORED", '#aaffaa', 1.5, 2.0);
                        } else if (obj.rewardType === 'WEAPON_UPGRADE') {
                            // Patch 57: entries() rather than values() so the chosen
                            // weapon's id survives for the history record below —
                            // values() discards exactly the key the record is keyed on.
                            // Patch 95: was a hardcoded `w.level < 5`, the twin of the
                            // one in LevelUpUI.show(). Both now read the same helper, so
                            // the reward door and the level-up card cannot disagree
                            // about whether a weapon is maxed. Returns exactly 5 for
                            // floors 1-5.
                            const doorLevelCap = weaponLevelCap(state.floor);
                            // Patch 132: levels a weapon the player OWNS. With twelve
                            // weapons, a draw over all of them mostly handed out level 1 of
                            // something new; a new one is drawn only if nothing owned can
                            // level and a slot is free.
                            let upgradeable = Object.entries(state.player.weapons).filter(([, w]) => w.level > 0 && w.level < doorLevelCap);
                            if (upgradeable.length === 0 && ownedWeaponCount(state.player.weapons) < MAX_WEAPON_SLOTS) {
                                // Patch 139: never a locked instrument.
                                const lk = Array.isArray(state.player.lockedWeapons) ? state.player.lockedWeapons : [];
                                upgradeable = Object.entries(state.player.weapons).filter(([id, w]) => w.level === 0 && !lk.includes(id));
                            }
                            if (upgradeable.length > 0) {
                                const [wepId, wep] = upgradeable[Math.floor(Math.random() * upgradeable.length)];
                                wep.level++;
                                // Patch 132: a door-granted first level of the Static
                                // Receiver left it switched off (only the card set it).
                                if ('active' in wep) wep.active = true;
                                // A door-granted level counts exactly like a card-granted
                                // one — same reward, so the same record.
                                if (game.saveManager && typeof game.saveManager.recordBoonPick === 'function') {
                                    game.saveManager.recordBoonPick(wepId, wep.level);
                                }
                                // Generic stat bump rather than per-weapon branches — that
                                // table lives in LevelUpUI.js's selectCard(), outside this
                                // patch's file scope. Scales whichever fields this weapon
                                // actually has, mirroring the "lower cooldown/dropRate is
                                // better" convention every weapon's own upgrade already uses.
                                if (wep.damage) wep.damage *= 1.15;
                                if (wep.radius) wep.radius *= 1.08;
                                if (wep.baseRadius) wep.baseRadius += 8;
                                if (wep.angle) wep.angle += 0.03;
                                if (wep.cooldown) wep.cooldown = Math.max(20, Math.floor(wep.cooldown * 0.9));
                                if (wep.dropRate) wep.dropRate = Math.max(10, Math.floor(wep.dropRate * 0.9));
                                if (wep.duration) wep.duration = Math.floor(wep.duration * 1.1);
                                game.spawnDamageText(state.player.x, state.player.y - 20, "WEAPON UPGRADED", '#c5a059', 1.5, 2.0);
                            } else {
                                // Every weapon already maxed — fall back rather than a no-op door.
                                state.lucidity += 50;
                                state.xp += 50;
                                game.spawnDamageText(state.player.x, state.player.y - 20, "+50 LUCIDITY", '#ffddaa', 1.5, 2.0);
                            }
                            // Patch 126: through Game so a synergy this door completes is announced.
                            if (typeof game.refreshSynergies === 'function') game.refreshSynergies();
                            else state.player.synergies = getActiveSynergies(state.player.weapons);
                        } else if (obj.rewardType === 'TOKEN_DOOR') {
                            // Patch 75: grantToken, NOT spawnTokenDrop. A pickup spawned
                            // here is wiped by `state.tokenDrops = []` a few lines below,
                            // in this same handler, before the player can ever touch it —
                            // the door paid out nothing at all. See Game.grantToken.
                            game.grantToken(state.player.x, state.player.y);
                        } else if (obj.rewardType === 'RISK_REWARD') {
                            // Direct sanity cost rather than game.takeDamage(): takeDamage
                            // can trigger onDeath(), and this fires mid-room-transition
                            // (roomNumber++ and a full entity/interactable reset happen
                            // right after this block) — letting a menu-adjacent, chosen
                            // cost kill the player through that transition is an edge case
                            // worth avoiding entirely, so it's clamped instead of lethal.
                            // It also deliberately bypasses denialShieldActive/curses: this
                            // is a self-inflicted cost, not enemy damage, so it shouldn't be
                            // negatable by defenses meant for combat.
                            state.lucidity += 150;
                            state.xp += 150;
                            // Patch 75: same fix as TOKEN_DOOR above, and it mattered more
                            // here — this door charges 30 Sanity for a token that was being
                            // destroyed on the same frame it was created.
                            game.grantToken(state.player.x, state.player.y);
                            state.sanity = Math.max(1, state.sanity - 30);
                            game.spawnDamageText(state.player.x, state.player.y - 20, "+150 LUCIDITY -30 SANITY", '#ff3333', 1.5, 2.0);
                        }

                        if (game.audioEngine) game.audioEngine.playSFX('ui_upgrade', 0.8);
                        
                        state.roomNumber++;
                        
                        state.player.x = 0;
                        state.player.y = 0;
                        
                        // Patch 116: released to their pools, not dropped (see
                        // Director.releaseArrays). interactables are not pooled.
                        if (game.director && typeof game.director.releaseRoomState === 'function') {
                            game.director.releaseRoomState(state);
                        } else {
                            state.entities = []; state.projectiles = []; state.xpDrops = [];
                            state.tokenDrops = []; state.inkPuddles = []; state.safeZones = [];
                        }
                        collectLoosePages(game);   // Patch 144: before the room's interactables go
                        state.interactables = [];
                        
                        if (game.director) {
                            game.director.spawnRoom(state.floor, state.roomNumber);
                        }
                    }
                }
            }
            state.interactables = state.interactables.filter(i => !i.dead);
        }

        let cooldownTick = 1;
        if (state.player.activeTokens && state.player.activeTokens.hasTwitch) {
            let sanityRatio = Math.max(0, state.sanity / state.player.maxHp);
            cooldownTick = 1 + (1 - sanityRatio) * 2.0; 
        }
        if (state.player.curses && state.player.curses.includes('manic_episode')) {
            cooldownTick *= 1.5;
        }

        const camera = state.player.weapons.polaroid_camera;
        if (camera && camera.level > 0) {
            camera.timer -= cooldownTick;
            if (camera.timer <= 0) {
                camera.timer = camera.cooldown;
                state.cameraFlash = 15; 
                state.cameraShake = 10;
                if (game.audioEngine) game.audioEngine.playSFX('polaroid'); 
                
                for (let i = state.entities.length - 1; i >= 0; i--) {
                    let ent = state.entities[i];
                    let dx = ent.x - state.player.x;
                    let dy = ent.y - state.player.y;
                    let dist = Math.hypot(dx, dy);
                    let isBoss = isBossType(ent.type);
                    let canTakeDamage = !(isBoss && state.sanity <= 0 && Math.sin(ent.phase * 10) < 0.5);

                    if (canTakeDamage && dist < camera.radius) {
                        let angle = Math.atan2(dy, dx);
                        let diff = angle - state.player.angle;
                        while (diff < -Math.PI) diff += Math.PI * 2;
                        while (diff > Math.PI) diff -= Math.PI * 2;
                        
                        if (Math.abs(diff) < camera.angle) {
                            ent.takeDamage(camera.damage * tagDamageMultiplier(camera.tags, state.player.tagDamage), game);
                            ent.confused = 120;

                            if (state.player.synergies && state.player.synergies.includes('overexposure')) {
                                ent.confused = 240;
                                ent.takeDamage(state.player.weapons.flashlight.damage, game);
                            }
                            if (state.player.synergies && state.player.synergies.includes('chemical_burn')) {
                                const camBatt = state.player.weapons.corrosive_battery;
                                if (camBatt) { ent.acidTime = camBatt.duration; ent.acidDmg = camBatt.damage; }
                            }

                            // Patch 165: a Burrower surfaces exactly on the player (dist 0).
                            if (dist > 0.001) ent.x += (dx / dist) * 30;
                        }
                    }
                }
            }
        }

        const spinner = state.player.weapons.fidget_spinner;
        if (spinner && spinner.level > 0) {
            // Patch 31b: spinner is tagged orbit/kinetic, so token kinetic bonuses
            // (hands_grip, body_scars, relapse 4pc) now reach it.
            let spinnerDmg = spinner.damage * tagDamageMultiplier(spinner.tags, state.player.tagDamage);
            if (state.player.dash && state.player.dash.active) spinnerDmg *= 2;

            const hasCentrifuge = !!(state.player.synergies && state.player.synergies.includes('centrifuge'));
            const hasDischarge = !!(state.player.synergies && state.player.synergies.includes('kinetic_discharge'));
            // Blades normally bite every 15 frames; centrifuge triples that rate.
            const spinnerTick = hasCentrifuge ? 5 : 15;

            for (let i = state.entities.length - 1; i >= 0; i--) {
                let ent = state.entities[i];
                let dist = Math.hypot(ent.x - state.player.x, ent.y - state.player.y);
                let isBoss = isBossType(ent.type);
                let canTakeDamage = !(isBoss && state.sanity <= 0 && Math.sin(ent.phase * 10) < 0.5);

                if (canTakeDamage && dist > spinner.baseRadius - 15 && dist < spinner.baseRadius + 15) {
                     if (state.frame % spinnerTick === 0) {
                         // Plain spinner hit had no push at all. Gated on !hasCentrifuge so
                         // this never stacks with that synergy's own hand-tuned 12px shove
                         // below, which is deliberately capped to stay inside the blade band.
                         ent.takeDamage(spinnerDmg, game, hasCentrifuge ? 0 : tagKnockback(spinner.tags, spinnerDmg));
                         // Shake isn't gated on hasCentrifuge like the knockback above — it's
                         // screen-wide, not a positional shove, so it can't eject anyone from
                         // the blade band and there's nothing to double-stack against.
                         state.cameraShake = Math.max(state.cameraShake, tagShake(spinner.tags, spinnerDmg));
                         game.spawnParticles(ent.x, ent.y, '#aaaaaa', 2);

                         if (hasCentrifuge) {
                             // Kept below the ring's ~30px band (baseRadius +/-15) on
                             // purpose: a bigger shove would eject enemies out of the
                             // blade band entirely and REDUCE total hits, defeating the
                             // 3x tick rate this synergy is built around.
                             const d = Math.max(dist, 0.001);
                             ent.x += ((ent.x - state.player.x) / d) * 12;
                             ent.y += ((ent.y - state.player.y) / d) * 12;
                         }

                         if (hasDischarge) {
                             // Arc static into everything around the struck enemy.
                             const arcRadius = 90;
                             const arcDmg = state.player.weapons.static.damage;
                             for (let j = state.entities.length - 1; j >= 0; j--) {
                                 const other = state.entities[j];
                                 if (other === ent) continue;
                                 if (Math.hypot(other.x - ent.x, other.y - ent.y) < arcRadius) {
                                     other.takeDamage(arcDmg, game);
                                     game.spawnParticles(other.x, other.y, '#66ffff', 2);
                                 }
                             }
                         }
                     }
                }
            }
        }

        const pipe = state.player.weapons.lead_pipe;
        if (pipe && pipe.level > 0) {
            pipe.timer -= cooldownTick; 
            if (pipe.timer <= 0) {
                pipe.timer = pipe.cooldown;
                game.director.spawnMeleeSwing(state.player.x, state.player.y, pipe.radius);
                if (game.audioEngine) game.audioEngine.playSFX('pipe_swing');
                
                let hitCount = 0;
                for (let i = state.entities.length - 1; i >= 0; i--) {
                    let ent = state.entities[i];
                    let d = Math.max(Math.hypot(ent.x - state.player.x, ent.y - state.player.y), 0.001);
                    let isBoss = isBossType(ent.type);
                    let canTakeDamage = !(isBoss && state.sanity <= 0 && Math.sin(ent.phase * 10) < 0.5);

                    if (canTakeDamage && d <= pipe.radius) {
                        // Patch 31b: pipe is tagged melee/kinetic — the primary
                        // beneficiary of the Relapse set's damage bonuses.
                        ent.takeDamage(pipe.damage * tagDamageMultiplier(pipe.tags, state.player.tagDamage), game);
                        ent.lastHitByMelee = true;
                        ent.x += (ent.x - state.player.x) / d * 25; 
                        ent.y += (ent.y - state.player.y) / d * 25;
                        hitCount++;

                        if (state.player.synergies && state.player.synergies.includes('industrial_bleed')) {
                            game.director.spawnInkPuddle(ent.x, ent.y, pipe.radius * 0.8, pipe.damage * 0.2);
                        }
                    }
                }
                
                if (hitCount > 0) {
                    // Patch 136: the Vandal's passive — melee hits restore Sanity.
                    if (state.player.meleeLifesteal) {
                        state.sanity = Math.min(state.player.maxHp, state.sanity + Math.min(3, hitCount * 0.75));
                    }
                    state.hitStop = Math.min(25, state.hitStop + 6 + (hitCount * 3));
                    state.cameraShake = Math.max(state.cameraShake, 10 + hitCount * 3);
                    if (game.audioEngine) game.audioEngine.playSFX('pipe_hit', hitCount);

                    // consecrated_ground: only pays out while the PLAYER is standing in
                    // one of their own wards, so it rewards holding ground rather than
                    // swinging anywhere. Capped so a big crowd can't fully heal a swing.
                    if (state.player.synergies && state.player.synergies.includes('consecrated_ground')) {
                        const playerInWard = state.safeZones.some(sz =>
                            Math.hypot(state.player.x - sz.x, state.player.y - sz.y) < sz.radius);
                        if (playerInWard) {
                            state.sanity = Math.min(state.player.maxHp, state.sanity + Math.min(hitCount, 5));
                        }
                    }
                }
            }
        }

        const ink = state.player.weapons.spilled_ink;
        if (ink && ink.level > 0) {
            ink.timer -= cooldownTick; 
            if (ink.timer <= 0) {
                ink.timer = ink.dropRate;
                // Patch 136: the Artist's pools hit 25% harder.
                game.director.spawnInkPuddle(state.player.x, state.player.y, ink.radius, ink.damage * (state.player.inkMaster ? 1.25 : 1));
            }
        }
        
        const chalk = state.player.weapons.broken_chalk;
        if (chalk && chalk.level > 0) {
            chalk.timer -= cooldownTick; 
            if (chalk.timer <= 0) {
                chalk.timer = chalk.cooldown;
                game.director.spawnSafeZone(state.player.x, state.player.y, chalk.radius, chalk.duration);
            }
        }

        const staticWep = state.player.weapons.static;

        if (state.player.curses && state.player.curses.includes('everything_is_target')) {
            let hitAngle = state.player.weapons.flashlight.angle;
            if (state.player.synergies && state.player.synergies.includes('blinding_signal')) hitAngle *= 1.5; 
            
            for (let j = state.xpDrops.length - 1; j >= 0; j--) {
                let xp = state.xpDrops[j];
                let distToXP = Math.max(Math.hypot(xp.x - state.player.x, xp.y - state.player.y), 0.001);
                if (distToXP < state.player.weapons.flashlight.radius) {
                    let angleToXP = Math.atan2(xp.y - state.player.y, xp.x - state.player.x);
                    let angleDiff = angleToXP - state.player.angle;
                    if (Number.isFinite(angleDiff)) {
                        if (angleDiff > 100 || angleDiff < -100) angleDiff = 0;
                        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                        
                        if (Math.abs(angleDiff) < hitAngle) {
                            xp.active = false;
                            if (game.director && game.director.pools && game.director.pools.xpDrop) {
                                game.director.pools.xpDrop.release(xp);
                            }
                            state.xpDrops.splice(j, 1);
                            game.spawnParticles(xp.x, xp.y, '#ffffff', 3); 
                        }
                    }
                }
            }
        }

        // Patch 132: before the entity loop below, so a kill made by one of the new
        // weapons is collected by that loop in this same step.
        resolveArsenal(game, cooldownTick, { tagDamageMultiplier, tagKnockback, tagShake });

        for (let i = state.entities.length - 1; i >= 0; i--) {
            let ent = state.entities[i];
            
            if (ent.acidTime > 0) {
                ent.acidTime--;
                if (state.frame % 30 === 0) {
                    ent.takeDamage(ent.acidDmg, game);
                    game.spawnParticles(ent.x, ent.y, '#55ff55', 3);
                }
            }
            
            ent.speedModifier = 1.0;
            const hasIonTrail = !!(state.player.synergies && state.player.synergies.includes('ion_trail'));
            for (let p of state.inkPuddles) {
                if (Math.hypot(ent.x - p.x, ent.y - p.y) < p.radius) {
                    // Patch 136: the Artist's pools slow far more (0.3, not 0.5).
                    ent.speedModifier = hasIonTrail ? 0.25 : (state.player.inkMaster ? 0.3 : 0.5);
                    if (state.frame % 30 === 0) {
                        ent.takeDamage(p.damage, game);
                        state.cameraShake = Math.max(state.cameraShake, tagShake(state.player.weapons.spilled_ink.tags, p.damage));
                        // Electrified ink: adds the static receiver's damage on top,
                        // read directly off state rather than the staticWep local so
                        // this stays independent of declaration order above.
                        if (hasIonTrail) ent.takeDamage(state.player.weapons.static.damage, game);
                    }
                    break;
                }
            }
            applyArsenalStatus(ent);   // Patch 132: drowsy (Lullaby) / held (restraint)

            const dx = ent.x - state.player.x; 
            const dy = ent.y - state.player.y;
            const distToPlayer = Math.max(Math.sqrt(dx*dx + dy*dy), 0.001);
            
            if (state.player.dash && state.player.dash.active && state.player.boons && state.player.boons.includes('kinetic_dash')) {
                if (distToPlayer < (ent.radius || 15) + state.player.radius) {
                    if (state.frame % 5 === 0) {
                        // kinetic_dash: literally dashing through the enemy, heavy tier fits.
                        ent.takeDamage(15, game, tagKnockback(['kinetic'], 15));
                        state.cameraShake = Math.max(state.cameraShake, tagShake(['kinetic'], 15));
                        game.spawnParticles(ent.x, ent.y, '#00ffcc', 5);
                    }
                }
            }

            let dmgMult = 1.0;
            for (let sz of state.safeZones) {
                if (Math.hypot(ent.x - sz.x, ent.y - sz.y) < sz.radius) {
                    dmgMult = 2.0;
                    if (state.player.synergies && state.player.synergies.includes('scholastic_purge')) {
                        if (ent.type === 'PARASITE') ent.takeDamage(9999, game);
                        else if (state.frame % 30 === 0) ent.takeDamage(state.player.weapons.corrosive_battery.damage * 2, game);
                    }
                    break;
                }
            }

            // glass_cannon: previously defined as a card but never implemented — picking
            // it did nothing at all. Applied AFTER the safe-zone loop, because that loop
            // assigns dmgMult rather than compounding it and would otherwise wipe this
            // bonus out whenever the player stood in a ward. dmgMult feeds the flashlight
            // and static lines below, which is why the card text names those two weapons
            // instead of promising a global damage boost — there is no global damage
            // pipeline in Combat.js to hook into.
            if (state.player.boons && state.player.boons.includes('glass_cannon')) dmgMult *= 2.0;


            let isBoss = isBossType(ent.type);
            let canTakeDamage = !(isBoss && state.sanity <= 0 && Math.sin(ent.phase * 10) < 0.5);

            if (canTakeDamage) {
                
                if (state.player.sets && state.player.sets.insomniac >= 4) {
                    const innerRad = state.player.weapons.flashlight.radius;
                    const outerRad = innerRad + 200;
                    if (distToPlayer > innerRad && distToPlayer < outerRad) {
                        if (state.frame % 30 === 0) {
                            ent.takeDamage(5, game); 
                            game.spawnParticles(ent.x, ent.y, '#ffaa00', 3);
                        }
                    }
                }

                if (distToPlayer < state.player.weapons.flashlight.radius) {
                    const angleToEnt = Math.atan2(dy, dx);
                    let angleDiff = angleToEnt - state.player.angle;
                    if (Number.isFinite(angleDiff)) {
                        if (angleDiff > 100 || angleDiff < -100) angleDiff = 0;
                        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                        
                        let hitAngle = state.player.weapons.flashlight.angle;
                        if (state.player.synergies && state.player.synergies.includes('blinding_signal')) hitAngle *= 1.5; 

                        let flDamage = state.player.weapons.flashlight.damage;
                        if (state.player.curses && state.player.curses.includes('tunnel_vision')) flDamage *= 3.0;
                        if (state.player.boons && state.player.boons.includes('last_light')) {
                            if (state.sanity < state.player.maxHp * 0.5) flDamage *= 1.5;
                        }

                        // ritual_focus bypasses the cone entirely for warded enemies.
                        // dmgMult > 1.0 is already the "this enemy is inside a ward"
                        // signal computed above, so no extra zone check is needed.
                        const wardedBypass = dmgMult > 1.0
                            && state.player.synergies
                            && state.player.synergies.includes('ritual_focus');

                        // Patch 182: the beam stops at walls (the Renderer shows it stopping), so
                        // an enemy behind a solid wall is in shadow and takes no light damage.
                        const inCone = Math.abs(angleDiff) < hitAngle
                            && !beamBlocked(state.obstacles, state.player.x, state.player.y, ent.x, ent.y);
                        if (inCone || wardedBypass) {
                            // Patch 63: where in the beam the target is standing now
                            // matters. A ritual_focus bypass is NOT the beam touching
                            // them — it reaches through the ward — so it keeps full
                            // damage but applies no push at all.
                            const falloff = inCone ? coneFalloff(angleDiff, hitAngle)
                                                   : { damageScale: 1, recoilScale: 0 };
                            const recoil = falloff.recoilScale * (LIGHT_RECOIL_RESIST[ent.type] ?? 1);

                            const flDmgDealt = (flDamage / 60) * dmgMult * falloff.damageScale
                                * tagDamageMultiplier(state.player.weapons.flashlight.tags, state.player.tagDamage);
                            // The always-on starter weapon had zero positional push before
                            // this patch (the vx/vy dampen below is a separate flinch effect,
                            // not knockback) — light tier, ticks every frame it's lit up.
                            ent.takeDamage(flDmgDealt, game, tagKnockback(state.player.weapons.flashlight.tags, flDmgDealt) * recoil);
                            state.cameraShake = Math.max(state.cameraShake, tagShake(state.player.weapons.flashlight.tags, flDmgDealt));
                            // The flinch — how much of this frame's advance the light
                            // takes back off them. Scaled by both beam position and the
                            // target's own resistance, so a Predator caught on the edge
                            // of the cone barely slows at all.
                            const flinch = 0.5 * recoil;
                            ent.x -= ent.vx * flinch; ent.y -= ent.vy * flinch;
                            if (state.player.synergies && state.player.synergies.includes('blinding_signal')) ent.confused = 180; 
                            
                            const batt = state.player.weapons.corrosive_battery;
                            if (batt && batt.level > 0) {
                                ent.acidTime = batt.duration;
                                ent.acidDmg = batt.damage;
                            }
                        }
                    }
                }
                
                if (staticWep.active && distToPlayer < staticWep.radius) {
                    // Patch 31b: static is tagged aura/tech — the target of hands_tremor.
                    const staticDmgDealt = (staticWep.damage / 60) * dmgMult
                        * tagDamageMultiplier(staticWep.tags, state.player.tagDamage);
                    ent.takeDamage(staticDmgDealt, game);
                    state.cameraShake = Math.max(state.cameraShake, tagShake(staticWep.tags, staticDmgDealt));
                    ent.x += (dx / distToPlayer) * 1.5; ent.y += (dy / distToPlayer) * 1.5;

                    // slowing_field: halve movement while inside the aura. Applied to the
                    // velocity the entity already computed this frame, so it decays
                    // naturally next frame without needing a persistent status field.
                    if (state.player.boons && state.player.boons.includes('slowing_field')) {
                        ent.vx *= 0.5;
                        ent.vy *= 0.5;
                    }
                }
            }

            if (ent.hp <= 0) {
                if (game.eventBus) {
                    game.eventBus.emit('enemy_killed', ent.type);
                }
                
                if (state.player.boons && state.player.boons.includes('vampirism') && ent.lastHitByMelee) {
                    state.sanity = Math.min(state.player.maxHp, state.sanity + 2);
                }

                // VOLATILE variant detonates on death. Runs before the splice below so
                // ent.x/y are still the death position. Damages the player only —
                // chaining into other enemies would turn crowds into a trivial cascade,
                // so the counterplay here is simply to kill these at range.
                if (ent.variant === 'VOLATILE') {
                    const blastRadius = 130;
                    const distToPlayer = Math.hypot(ent.x - state.player.x, ent.y - state.player.y);
                    if (distToPlayer < blastRadius) {
                        game.takeDamage(18, 'VOLATILE');   // Patch 124
                    }
                    game.spawnParticles(ent.x, ent.y, '#ff7043', 40);
                    state.cameraShake = Math.max(state.cameraShake, 16);
                }

                deathCount++;
                ent.active = false;

                // --- ANTI-ZOMBIE FIX: Immediately extract from array ---
                state.entities.splice(i, 1);

                state.runKills = (state.runKills || 0) + 1;   // Patch 124
                try {
                    if (game.saveManager && typeof game.saveManager.recordKill === 'function') {
                        game.saveManager.recordKill(ent.type);
                    }
                } catch(e) {
                    console.warn("Recovered from logic error on enemy death:", e);
                    errorLog.capture(e, 'enemy-death');
                }
                
                // Patch 135: a full-size Photocopy tears into two smaller copies. It
                // still pays out below like any other kill; the copies are ordinary
                // pooled spawns (they do not split again).
                if (ent.type === 'SPLITTER' && ent.generation < 2 && game.director) {
                    game.director.spawnEntity('SPLITTER', null, null, ent.x - 16, ent.y, 2);
                    game.director.spawnEntity('SPLITTER', null, null, ent.x + 16, ent.y, 2);
                    game.spawnParticles(ent.x, ent.y, '#d8cfb8', 16);
                }

                if (ent.type === 'RORSCHACH' && ent.generation < 3) {
                    game.director.spawnEntity('RORSCHACH', null, null, ent.x - 20, ent.y, ent.generation + 1);
                    game.director.spawnEntity('RORSCHACH', null, null, ent.x + 20, ent.y, ent.generation + 1);
                    
                    game.spawnParticles(ent.x, ent.y, '#8b008b', 50); 
                    game.spawnXP(ent.x, ent.y, 5, true); 
                    
                    if (game.director && game.director.pools && game.director.pools.rorschach) {
                        game.director.pools.rorschach.release(ent);
                    }
                    continue; 
                }

                if (isBoss || (ent.type === 'RORSCHACH' && ent.generation === 3)) {
                    game.spawnXP(ent.x, ent.y, ent.type === 'BOSS' ? 25 : 10, true); 
                    game.spawnParticles(ent.x, ent.y, ent.color || '#ffffff', 100);
                    
                    const dropAngle = Math.random() * Math.PI * 2;
                    const dropDist = 120 + Math.random() * 30; 
                    const tokenX = ent.x + Math.cos(dropAngle) * dropDist;
                    const tokenY = ent.y + Math.sin(dropAngle) * dropDist;
                    game.spawnTokenDrop(tokenX, tokenY);
                    
                    const otherBosses = state.entities.filter(e => isBossType(e.type) && e.id !== ent.id);
                    
                    if (otherBosses.length === 0) {
                        // Patch 144: the floor's boss files the next page of its chapter,
                        // opposite the token so the two never land on one spot.
                        dropPage(game, ent.x - Math.cos(dropAngle) * dropDist, ent.y - Math.sin(dropAngle) * dropDist, 'boss');
                        // Patch 146 (V2 plan E4): the defense's last line, as a subtitle.
                        const lastLine = bossDeathLine(ent.type);
                        if (lastLine) state.subtitle = { text: lastLine, steps: BOSS_DEATH_SUBTITLE_STEPS, total: BOSS_DEATH_SUBTITLE_STEPS };
                        // Patch 170: a boss goes out in a ring of detonations.
                        if (typeof game.spawnPop === 'function') {
                            game.spawnPop(ent.x, ent.y, '#ffffff', 5);
                            for (let k = 0; k < 10; k++) {
                                const ba = k * 0.628, bd = 50 + (k % 3) * 45;
                                game.spawnPop(ent.x + Math.cos(ba) * bd, ent.y + Math.sin(ba) * bd, k % 2 ? '#ffd27f' : '#ff5a48', 1.6 + (k % 3) * 0.5);
                            }
                        }
                        state.cameraShake = 50;
                        if (game.audioEngine) game.audioEngine.playSFX('death', 1.5);
                        // Patch 130 (V2 plan C8): the kill lands. A short impact freeze,
                        // then ~1.2 s at half speed (Game.update: hitStop first, then
                        // slowMo), a soft white flash (main.js zeroes cameraFlash in
                        // photosensitivity mode) and a ring of fragments in the boss's
                        // colour and white on top of the existing burst. All counted in
                        // sim steps, so it is the same length at any refresh rate.
                        state.hitStop = Math.max(state.hitStop || 0, 12);
                        state.slowMo = Math.max(state.slowMo || 0, BOSS_DEATH_SLOWMO_STEPS);
                        state.cameraFlash = Math.max(state.cameraFlash || 0, 8);
                        game.spawnParticles(ent.x, ent.y, '#ffffff', 40);
                        game.spawnParticles(ent.x, ent.y, ent.color || '#c5a059', 40);
                        
                        state.interactables.push({
                             id: Math.random(),
                             type: 'EXIT_ELEVATOR',
                             x: ent.x,
                             y: ent.y,
                             active: true, charge: 0, life: 99999, radius: 40, dead: false 
                        });
                    }
                    
                } else {
                    // Patch 133: a named elite drops the room's chest, a heavy orb, and
                    // lands with a beat of its own.
                    if (ent.elite) {
                        dropChest(state, ent.x, ent.y);
                        dropPage(game, ent.x - 44, ent.y + 10, 'elite');   // Patch 144: half the time
                        game.spawnXP(ent.x + 30, ent.y, 2, true);
                        game.spawnParticles(ent.x, ent.y, '#ffd27f', 40);
                        if (typeof game.spawnPop === 'function') game.spawnPop(ent.x, ent.y, '#ffd27f', 3);   // Patch 170
                        game.spawnDamageText(ent.x, ent.y - 40, `${ent.eliteName || 'ELITE'} DISPERSED`, '#ffd27f', 1.4, 2.4);
                        state.hitStop = Math.max(state.hitStop || 0, 6);
                        state.cameraShake = Math.max(state.cameraShake, 16);
                        if (!state.bossSpawned) state.convergence += 5;
                        try { if (game.saveManager && game.saveManager.recordKill) game.saveManager.recordKill('ELITE'); } catch (e) { /* counted below */ }
                        if (game.eventBus) game.eventBus.emit('elite_killed', ent.type);
                    }
                    let dropAmount = ent.type === 'SCAVENGER' ? 2 : (ent.type === 'PREDATOR' ? 5 : 1);
                    // Patch 135: the Phase D enemies.
                    if (ent.type === 'SPLITTER') dropAmount = ent.generation === 1 ? 2 : 1;
                    else if (ent.type === 'WARDEN') dropAmount = 6;
                    else if (ent.type === 'BURROWER') dropAmount = 4;
                    if (ent.maxHp > 30) dropAmount += 5; 
                    // Patch 168: a thief pays back what it ate, plus a tip.
                    if (ent.stolen > 0) { dropAmount += Math.ceil(ent.stolen * 1.25 / ROOM_PACE); ent.stolen = 0; }   // orbs are ROOM_PACE XP each
                    if (ent.type === 'SCAVENGER' && state.player.curses && state.player.curses.includes('compulsive_cleaner')) {
                        dropAmount += 3; 
                    }
                    
                    if (state.isTutorial) {
                        // Patch 65 — the tutorial kill is GUARANTEED to level the player.
                        //
                        // It previously dropped 2 XP against a 50 XP requirement
                        // (Config.getXPRequiredForLevel), so whether a new player ever
                        // saw a boon card came down to which tutorial door they picked:
                        // LUCIDITY grants +50 XP, HEAL grants none. Take HEAL and the
                        // first card was ~25 more kills away — well past the average
                        // session length. The whole reason to keep playing a
                        // survivors-like is kill -> level -> choose, and half of all
                        // first sessions never reached it.
                        //
                        // 3 massive orbs (25 each) rather than exactly 50, so the card
                        // still fires if one orb is left behind out of vacuum range.
                        game.spawnXP(ent.x, ent.y, 3, true);
                        game.spawnDamageText(ent.x, ent.y - 40, "MANIFESTATION DISPERSED", '#c5a059', 1.6, 2.2);
                    } else {
                        game.spawnXP(ent.x, ent.y, dropAmount);
                    }

                    if (!state.bossSpawned) {
                        state.convergence += (ent.type === 'PREDATOR' ? 3 : 1);
                    }
                    game.spawnParticles(ent.x, ent.y, ent.color || '#fff', 8);   // Patch 168: 15 -> 8, the pop carries it
                    if (typeof game.spawnPop === 'function') game.spawnPop(ent.x, ent.y, POP_COLOURS[ent.type]);
                    if (game.audioEngine) game.audioEngine.playSFX('kill', 0.55);   // Patch 183
                }
                
                let poolKey = ent.type.toLowerCase();
                if (game.director && game.director.pools && game.director.pools[poolKey]) {
                    game.director.pools[poolKey].release(ent);
                }
            }
        }
        
        if (deathCount > 0 && game.audioEngine) game.audioEngine.playSFX('death', Math.min(1.2, 0.6 + deathCount * 0.1));
    }

    static collectXP(game) {
        const state = game.state;
        let pickupCount = 0;
        
        // Patch 31b: reads the pre-summed total (legacy + tree + tokens, all in px)
        // that Game.init computes, instead of recomputing from upgrades.magnet —
        // that mirror only covers legacy+tree, so token magnet was invisible here.
        // Falls back to the old derivation for states built before this field existed.
        let baseVacRadius = 115;   // Patch 165: was 70; a horde leaves orbs everywhere
        if (state.player.vacRadiusBonusPx !== undefined) {
            baseVacRadius += state.player.vacRadiusBonusPx;
        } else if (state.player.upgrades && state.player.upgrades.magnet) {
            baseVacRadius += (state.player.upgrades.magnet * 30);
        }
        if (state.player.boons && state.player.boons.includes('scavenger_instinct')) {
            baseVacRadius += 80;
        }
        
        for (let i = state.xpDrops.length - 1; i >= 0; i--) {
            let xp = state.xpDrops[i];
            let distToPlayer = Math.max(Math.hypot(xp.x - state.player.x, xp.y - state.player.y), 0.001);
            
            if (distToPlayer < baseVacRadius) {
                xp.x += (state.player.x - xp.x) * 0.15; 
                xp.y += (state.player.y - xp.y) * 0.15;
                
                if (distToPlayer < 15) {
                    xp.collected = true; 
                    state.xp += xp.value; 
                    // Patch 165: a horde drops far more orbs; Lucidity banks at a fraction,
                    // in whole points (the remainder carries).
                    state.lucidityCarry = (state.lucidityCarry || 0) + xp.value * LUCIDITY_PER_XP;
                    if (state.lucidityCarry >= 1) { const whole = Math.floor(state.lucidityCarry); state.lucidity += whole; state.lucidityCarry -= whole; }
                    // Patch 156: per floor (data/Difficulty.js); 3 on floor 1, as it was.
                    state.sanity = Math.min(state.player.maxHp, state.sanity + floorPressure(state.floor).orbHeal);
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
        
        if (pickupCount > 0 && game.audioEngine) game.audioEngine.playSFX('pickup', Math.min(0.8, 0.3 + pickupCount * 0.05));

        if (state.tokenDrops) {
            for (let i = state.tokenDrops.length - 1; i >= 0; i--) {
                let t = state.tokenDrops[i];
                let distToPlayer = Math.max(Math.hypot(t.x - state.player.x, t.y - state.player.y), 0.001);
                
                if (distToPlayer < baseVacRadius) {
                    t.x += (state.player.x - t.x) * 0.15; 
                    t.y += (state.player.y - t.y) * 0.15;
                    
                    if (distToPlayer < 15) {
                        t.collected = true; 
                        state.runInventory.push(t.rarity);
                        game.spawnDamageText(t.x, t.y - 20, `${t.rarity} TOKEN!`, t.color, 1.5, 2.0);
                        if (game.audioEngine) game.audioEngine.playSFX('ui_upgrade', 0.8);
                        // Patch 130 (V2 plan C8): the reward lands — a beat of
                        // anticipation (a brief freeze), then a burst in the rarity's
                        // colour that grows with rarity, and a small kick of shake.
                        const tier = tokenBurstTier(t.rarity);
                        state.hitStop = Math.max(state.hitStop || 0, 5 + tier * 2);
                        state.cameraShake = Math.max(state.cameraShake || 0, 4 + tier * 3);
                        game.spawnParticles(state.player.x, state.player.y, t.color || '#ffffff', 18 + tier * 12);
                    }
                }
            }
        }
    }
}