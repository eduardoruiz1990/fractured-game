// src/systems/Arsenal.js
//
// Patch 132 (V2 plan D3): the four weapons added in Phase D.
//
//   pill_bottle   kinetic/burst  a bottle thrown at the nearest enemy that ricochets
//                                to the next one, `bounces` times
//   metronome     aura/tech      every beat, a ring expands from you; everything the
//                                wavefront crosses is struck once and pushed outward
//   straitjacket  orbit/melee    straps circle you, lashing what they touch and
//                                tearing enemy projectiles out of the air
//   lullaby       dark/burst     slow notes drift after the nearest enemy and burst,
//                                leaving everything caught in it drowsy (slowed)
//
// They live here rather than in Combat.js's already 900-line resolveWeapons so each
// is readable in one place. Combat calls resolveArsenal() once per sim step BEFORE its
// main entity loop, so anything killed here is collected (XP, kill counts, pool
// release) by that loop in the same step — this file never splices state.entities.
//
// The weapons' transient objects (state.playerShots, state.pulseRings,
// state.lullabyNotes) are small plain-object arrays with hard caps, not pooled: a
// level-5 build has at most a couple of dozen alive. They are emptied on every room
// change (Director.releaseRoomState) and rebuilt by Game.init.
//
// The combat helpers (tag multipliers, knockback, shake) are passed in by Combat so
// this module does not import Combat back.

import { isBossType } from '../data/Config.js';

export const ARSENAL_CAPS = { playerShots: 24, pulseRings: 6, lullabyNotes: 16 };

/** Drowsy enemies move at this fraction of their speed (Combat applies it). */
export const DROWSY_SLOW = 0.4;

/** Same boss-flicker immunity rule every other weapon uses (Combat.js). */
function canHit(ent, state) {
    return !(isBossType(ent.type) && state.sanity <= 0 && Math.sin(ent.phase * 10) < 0.5);
}

/** 2x inside a chalk ward, exactly as the flashlight and static get. */
function wardMult(ent, state) {
    for (const sz of state.safeZones) {
        if (Math.hypot(ent.x - sz.x, ent.y - sz.y) < sz.radius) return 2;
    }
    return 1;
}

/** Nearest live enemy to (x, y) within maxDist, skipping ids in `exclude`. */
export function nearestEnemy(entities, x, y, maxDist = Infinity, exclude = null) {
    let best = null, bestD = maxDist;
    for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (!e || e.hp <= 0) continue;
        if (exclude && exclude.has(e.id)) continue;
        const d = Math.hypot(e.x - x, e.y - y);
        if (d < bestD) { bestD = d; best = e; }
    }
    return best;
}

const has = (state, synergy) => !!(state.player.synergies && state.player.synergies.includes(synergy));

/**
 * @param {object} game
 * @param {number} cooldownTick  Combat's per-step cooldown rate (twitch token, manic curse)
 * @param {{tagDamageMultiplier:Function, tagKnockback:Function, tagShake:Function}} h
 */
export function resolveArsenal(game, cooldownTick, h) {
    const state = game.state;
    const W = state.player.weapons;
    if (!W) return;
    if (!state.playerShots) state.playerShots = [];
    if (!state.pulseRings) state.pulseRings = [];
    if (!state.lullabyNotes) state.lullabyNotes = [];

    // ---- PILL BOTTLE ---------------------------------------------------------------
    const pill = W.pill_bottle;
    if (pill && pill.level > 0) {
        pill.timer = (pill.timer || 0) - cooldownTick;
        if (pill.timer <= 0) {
            const target = nearestEnemy(state.entities, state.player.x, state.player.y, 520);
            if (target && state.playerShots.length < ARSENAL_CAPS.playerShots) {
                pill.timer = pill.cooldown;
                // Patch 134: the Pill Organiser evolution throws `volley` bottles, each
                // at a different nearby enemy where there is one.
                const aimed = new Set();
                for (let v = 0; v < (pill.volley || 1) && state.playerShots.length < ARSENAL_CAPS.playerShots; v++) {
                    const t = v === 0 ? target : (nearestEnemy(state.entities, state.player.x, state.player.y, 520, aimed) || target);
                    aimed.add(t.id);
                    const a = Math.atan2(t.y - state.player.y, t.x - state.player.x);
                    state.playerShots.push({
                        kind: 'pill', x: state.player.x, y: state.player.y,
                        vx: Math.cos(a) * 9, vy: Math.sin(a) * 9, spin: 0,
                        target: t, life: 90, bouncesLeft: pill.bounces,
                        damage: pill.damage, hit: new Set()
                    });
                }
                if (game.audioEngine) game.audioEngine.playSFX('pipe_swing', 0.35);
            } else {
                pill.timer = 10;   // nothing in reach — check again shortly
            }
        }
    }
    for (let i = state.playerShots.length - 1; i >= 0; i--) {
        const s = state.playerShots[i];
        s.life--; s.spin += 0.4;
        // Light homing toward the current target keeps ricochets from missing a
        // moving enemy; the bottle still travels visibly rather than snapping.
        if (s.target && s.target.active !== false && s.target.hp > 0) {
            const a = Math.atan2(s.target.y - s.y, s.target.x - s.x);
            s.vx += (Math.cos(a) * 9 - s.vx) * 0.25;
            s.vy += (Math.sin(a) * 9 - s.vy) * 0.25;
        }
        s.x += s.vx; s.y += s.vy;
        let struck = null;
        for (let j = 0; j < state.entities.length; j++) {
            const e = state.entities[j];
            if (s.hit.has(e.id) || e.hp <= 0) continue;
            if (Math.hypot(e.x - s.x, e.y - s.y) < (e.radius || 15) + 8) { struck = e; break; }
        }
        if (struck) {
            s.hit.add(struck.id);
            if (canHit(struck, state)) {
                const dmg = s.damage * h.tagDamageMultiplier(pill.tags, state.player.tagDamage) * wardMult(struck, state);
                struck.takeDamage(dmg, game, h.tagKnockback(pill.tags, dmg) * 0.5);
                state.cameraShake = Math.max(state.cameraShake, h.tagShake(pill.tags, dmg) * 0.5);
                game.spawnParticles(struck.x, struck.y, '#f2f2f2', 4);
                if (has(state, 'bitter_pill') && W.corrosive_battery) {
                    struck.acidTime = W.corrosive_battery.duration;
                    struck.acidDmg = W.corrosive_battery.damage;
                }
            }
            const next = s.bouncesLeft > 0 ? nearestEnemy(state.entities, s.x, s.y, 300, s.hit) : null;
            if (next) { s.bouncesLeft--; s.target = next; s.life = 60; }
            else s.life = 0;
        }
        if (s.life <= 0) state.playerShots.splice(i, 1);
    }

    // ---- METRONOME -----------------------------------------------------------------
    const met = W.metronome;
    if (met && met.level > 0) {
        met.timer = (met.timer || 0) - cooldownTick;
        if (met.timer <= 0) {
            met.timer = met.cooldown;
            if (state.pulseRings.length < ARSENAL_CAPS.pulseRings) {
                state.pulseRings.push({ x: state.player.x, y: state.player.y, r: 10, maxR: met.radius,
                                        damage: met.damage, hit: new Set() });
            }
            if (game.audioEngine) game.audioEngine.playSFX('ui_click', 0.5);
        }
    }
    for (let i = state.pulseRings.length - 1; i >= 0; i--) {
        const ring = state.pulseRings[i];
        const prevR = ring.r;
        ring.r += 9;
        for (let j = 0; j < state.entities.length; j++) {
            const e = state.entities[j];
            if (ring.hit.has(e.id)) continue;
            const d = Math.hypot(e.x - ring.x, e.y - ring.y);
            // Struck once, as the wavefront passes over it.
            if (d >= prevR - (e.radius || 15) && d < ring.r + (e.radius || 15)) {
                ring.hit.add(e.id);
                if (!canHit(e, state)) continue;
                const dmg = ring.damage * h.tagDamageMultiplier(met.tags, state.player.tagDamage) * wardMult(e, state);
                e.takeDamage(dmg, game);
                const dd = Math.max(d, 0.001);
                e.x += ((e.x - ring.x) / dd) * 18;
                e.y += ((e.y - ring.y) / dd) * 18;
                if (has(state, 'cradle_song') || (met && met.lulls)) e.drowsy = Math.max(e.drowsy || 0, 90);   // lulls: Grandfather Clock (Patch 134)
            }
        }
        if (ring.r >= ring.maxR) state.pulseRings.splice(i, 1);
    }

    // ---- STRAITJACKET STRAPS --------------------------------------------------------
    const straps = W.straitjacket;
    if (straps && straps.level > 0) {
        straps.phase = (straps.phase || 0) + straps.speed;
        const n = Math.max(1, Math.floor(straps.straps));
        for (let k = 0; k < n; k++) {
            const a = straps.phase + (k * Math.PI * 2) / n;
            const sx = state.player.x + Math.cos(a) * straps.radius;
            const sy = state.player.y + Math.sin(a) * straps.radius;
            // The shield: enemy projectiles that touch a strap are torn out of the air.
            for (let p = state.projectiles.length - 1; p >= 0; p--) {
                const pr = state.projectiles[p];
                if (Math.hypot(pr.x - sx, pr.y - sy) < 20 + (pr.radius || 0)) {
                    pr.active = false;
                    if (game.director && game.director.pools && game.director.pools.projectile) {
                        game.director.pools.projectile.release(pr);
                    }
                    state.projectiles.splice(p, 1);
                    game.spawnParticles(sx, sy, '#e8dcc0', 3);
                }
            }
            if (state.frame % 12 !== k % 12) continue;   // each strap bites on its own beat
            for (let j = 0; j < state.entities.length; j++) {
                const e = state.entities[j];
                if (Math.hypot(e.x - sx, e.y - sy) > (e.radius || 15) + 16) continue;
                if (!canHit(e, state)) continue;
                const dmg = straps.damage * h.tagDamageMultiplier(straps.tags, state.player.tagDamage) * wardMult(e, state);
                e.takeDamage(dmg, game, h.tagKnockback(straps.tags, dmg));
                e.lastHitByMelee = true;   // vampirism counts strap kills as melee
                state.cameraShake = Math.max(state.cameraShake, h.tagShake(straps.tags, dmg) * 0.5);
                game.spawnParticles(e.x, e.y, '#e8dcc0', 2);
                if (has(state, 'restraint')) e.held = Math.max(e.held || 0, 30);
            }
        }
    }

    // ---- LULLABY -------------------------------------------------------------------
    const lul = W.lullaby;
    if (lul && lul.level > 0) {
        lul.timer = (lul.timer || 0) - cooldownTick;
        if (lul.timer <= 0) {
            lul.timer = lul.cooldown;
            const n = Math.max(1, Math.floor(lul.notes));
            for (let k = 0; k < n && state.lullabyNotes.length < ARSENAL_CAPS.lullabyNotes; k++) {
                const a = (k / n) * Math.PI * 2 + state.frame * 0.01;
                state.lullabyNotes.push({ x: state.player.x + Math.cos(a) * 20, y: state.player.y + Math.sin(a) * 20,
                                          vx: Math.cos(a) * 1.5, vy: Math.sin(a) * 1.5, life: 300, bob: Math.random() * 6 });
            }
        }
    }
    const nightlight = has(state, 'nightlight');
    for (let i = state.lullabyNotes.length - 1; i >= 0; i--) {
        const nt = state.lullabyNotes[i];
        nt.life--; nt.bob += 0.15;
        const target = nearestEnemy(state.entities, nt.x, nt.y, 600);
        if (target) {
            const a = Math.atan2(target.y - nt.y, target.x - nt.x);
            nt.vx += Math.cos(a) * 0.12; nt.vy += Math.sin(a) * 0.12;
            const sp = Math.hypot(nt.vx, nt.vy);
            if (sp > 2.6) { nt.vx *= 2.6 / sp; nt.vy *= 2.6 / sp; }
        }
        nt.x += nt.vx; nt.y += nt.vy;
        const touching = target && Math.hypot(target.x - nt.x, target.y - nt.y) < (target.radius || 15) + 8;
        if (touching || nt.life <= 0) {
            if (touching && lul) {
                const burstR = nightlight ? lul.radius * 2 : lul.radius;
                for (let j = 0; j < state.entities.length; j++) {
                    const e = state.entities[j];
                    if (Math.hypot(e.x - nt.x, e.y - nt.y) > burstR + (e.radius || 15)) continue;
                    if (!canHit(e, state)) continue;
                    const dmg = lul.damage * h.tagDamageMultiplier(lul.tags, state.player.tagDamage) * wardMult(e, state);
                    e.takeDamage(dmg, game);
                    e.drowsy = Math.max(e.drowsy || 0, lul.sleep || 90);
                }
                game.spawnParticles(nt.x, nt.y, '#9b8cff', 12);
                // Patch 134: the Music Box evolution restores Sanity per burst.
                if (lul.heals) state.sanity = Math.min(state.player.maxHp, state.sanity + lul.heals);
                if (game.audioEngine) game.audioEngine.playSFX('pickup', 0.4);
            }
            state.lullabyNotes.splice(i, 1);
        }
    }
}

/** Per-entity status from the new weapons; Combat calls it inside its entity loop
 *  after it resets speedModifier. Drowsy slows, held (the restraint synergy) stops. */
export function applyArsenalStatus(ent) {
    if (ent.held > 0) { ent.held--; ent.speedModifier = 0.05; return; }   // not 0: Rorschach reads `speedModifier || 1`
    if (ent.drowsy > 0) { ent.drowsy--; ent.speedModifier = Math.min(ent.speedModifier, DROWSY_SLOW); }
}
