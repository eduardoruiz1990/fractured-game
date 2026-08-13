// Only getActiveSynergies is used here. MANIFESTATIONS, SYNERGIES and
// INTRUSIVE_THOUGHTS were imported but never referenced — note in particular that
// MANIFESTATIONS is NOT the level-up boon pool despite appearing to be. The real
// pool is BOONS, below.
import { getActiveSynergies } from '../data/Manifestations.js';
// Patch 95 — the weapon ceiling comes off in THE RECURSION. See src/core/Endless.js.
import { weaponLevelCap, isEndless } from '../core/Endless.js';

/**
 * The level-up boon pool — the real one.
 *
 * Patch 56/57: this used to be a `const BOONS` local to show(), which meant nothing
 * outside that one method could read it. The Clinical Guide needs it to document
 * boons without transcribing them by hand (a copy would drift the first time a
 * value changed), and the history tracker needs it to name a recorded pick. Moving
 * it to a module export changes no behaviour — show() reads the same array.
 *
 * `tags` mirrors the 12-tag vocabulary used by state.player.weapons, so offers can
 * later be weighted toward the build the player is already committing to. Every
 * boon here has a real implementation — see selectCard() below for the
 * instant-apply ones, and the boons.includes() hooks in Game.js / Combat.js for the
 * persistent ones.
 */
export const BOONS = [
    { id: 'kinetic_dash', name: 'Kinetic Routing', desc: 'Dashing damages enemies you pass through.', color: '#00ffcc', icon: '⚡', tags: ['kinetic', 'utility'] },
    { id: 'toxic_blood', name: 'Toxic Blood', desc: 'Taking damage spawns a Spilled Ink hazard at your feet.', color: '#aa00ff', icon: '🩸', tags: ['hazard', 'dark'] },
    { id: 'tunnel_vision', name: 'Hyperfocus', desc: 'Flashlight cone width is halved, but damage is doubled.', color: '#ffcc00', icon: '🔦', tags: ['light', 'focus'] },
    { id: 'adrenaline_surge', name: 'Adrenaline Surge', desc: 'Dropping below 30% Sanity doubles your movement speed.', color: '#ff0033', icon: '💉', tags: ['kinetic', 'passive'] },
    { id: 'iron_will', name: 'Iron Will', desc: 'Max Sanity increased by 50.', color: '#ffffff', icon: '🛡️', tags: ['passive', 'utility'] },
    { id: 'glass_cannon', name: 'Glass Cannon', desc: 'Flashlight and Static damage doubled, but Sanity drains twice as fast.', color: '#ff4444', icon: '💥', tags: ['passive', 'kinetic'] },
    { id: 'vampirism', name: 'Vampirism', desc: 'Melee kills restore 2 Sanity.', color: '#bb0000', icon: '🦇', tags: ['melee', 'dark'] },
    { id: 'static_discharge', name: 'Static Discharge', desc: 'Taking damage triggers a massive Static AoE.', color: '#00ffff', icon: '⚡', tags: ['aura', 'tech'] },
    { id: 'lead_shoes', name: 'Lead Shoes', desc: 'Cannot Dash. Max Sanity +200.', color: '#777777', icon: '🥾', tags: ['passive', 'utility'] },
    { id: 'shadow_step', name: 'Shadow Step', desc: 'Dashing grants 1 second of invisibility (enemies lose tracking).', color: '#555555', icon: '🥷', tags: ['dark', 'utility'] },

    { id: 'steady_hands', name: 'Steady Hands', desc: 'All weapon cooldowns reduced by 20%.', color: '#88ccff', icon: '🤲', tags: ['focus', 'tech'] },
    { id: 'wide_lens', name: 'Wide Lens', desc: 'Flashlight range +40%, but its damage drops by 10%.', color: '#ffdd88', icon: '🔎', tags: ['light', 'burst'] },
    { id: 'overcharge', name: 'Overcharge', desc: 'Static Receiver radius +50% and damage +30%.', color: '#66ffff', icon: '🔌', tags: ['aura', 'tech'] },
    { id: 'heavy_swing', name: 'Heavy Swing', desc: 'Pipe damage +60%, but it swings 20% slower.', color: '#cc8844', icon: '🔨', tags: ['melee', 'kinetic'] },
    { id: 'ink_flood', name: 'Ink Flood', desc: 'Spilled Ink pools are 50% larger and drop far more often.', color: '#8822cc', icon: '🌊', tags: ['hazard', 'dark'] },
    { id: 'sharpened_blades', name: 'Sharpened Blades', desc: 'Spinner damage +50% and it orbits wider.', color: '#dddddd', icon: '🗡️', tags: ['orbit', 'kinetic'] },
    { id: 'long_exposure', name: 'Long Exposure', desc: 'Camera flash reaches 50% further and recharges 25% faster.', color: '#ffffcc', icon: '📷', tags: ['burst', 'light'] },
    { id: 'chalk_dust', name: 'Chalk Dust', desc: 'Warding circles are 30% larger and last 50% longer.', color: '#f0f0e0', icon: '🕯️', tags: ['utility', 'focus'] },
    { id: 'second_wind', name: 'Second Wind', desc: 'Slowly regain Sanity while below 25%.', color: '#88ffaa', icon: '🌬️', tags: ['passive', 'utility'] },
    { id: 'scavenger_instinct', name: "Scavenger's Instinct", desc: 'Greatly increases the range you pull Lucidity from.', color: '#ffcc66', icon: '🧲', tags: ['utility', 'passive'] },
    { id: 'martyr', name: 'Martyr', desc: 'Taking damage leaves a warding circle where you stood.', color: '#ddaaff', icon: '✝️', tags: ['dark', 'hazard'] },
    { id: 'slowing_field', name: 'Slowing Field', desc: 'Enemies caught in your Static aura move at half speed.', color: '#aaddff', icon: '❄️', tags: ['aura', 'focus'] },
    { id: 'last_light', name: 'Last Light', desc: 'Flashlight damage +50% while below half Sanity.', color: '#ffaa33', icon: '🕯️', tags: ['light', 'focus'] },
    { id: 'reinforced_frame', name: 'Reinforced Frame', desc: 'Take 15% less damage from everything.', color: '#99aabb', icon: '🦴', tags: ['passive', 'melee'] }
];

/**
 * Patch 95 — THE RECURSION's repeatable cards. Offered ONLY on floors 6+.
 *
 * WHY THESE ARE NEW CARDS RATHER THAN "the existing 24, made repeatable", which was
 * the obvious cheaper answer and is wrong on inspection:
 *
 *   - 11 of the 24 are FLAG boons. Game.js and Combat.js read them with
 *     `boons.includes('shadow_step')`, so taking one a second time does precisely
 *     nothing. A card that visibly does nothing is worse than no card.
 *   - Several are actively degenerate on repeat. `tunnel_vision` HALVES the flashlight
 *     cone each time (three picks and the beam is a line); `wide_lens` multiplies
 *     damage by 0.9 every time; `lead_shoes` permanently disables dashing.
 *
 * These are deliberately plain numbers instead. They are the endgame's "there is always
 * something to take" floor, not a second design space — the interesting choices are
 * still the 24 boons and the now-uncapped weapons, and these should never crowd those
 * out. Every one is safely repeatable by construction: no flags, no division, no
 * one-way switches.
 *
 * Exported for the same reason BOONS is (Patches 55/56): the Clinical Guide renders
 * from live data and must never carry a hand-transcribed copy of a catalogue.
 */
export const DEEP_BOONS = [
    { id: 'deep_acuity',    name: 'Acuity',    desc: 'All weapon damage +10%.',      color: '#ffd27f', icon: '🜂', tags: ['focus', 'passive'] },
    { id: 'deep_bulwark',   name: 'Bulwark',   desc: 'Max Sanity +25.',              color: '#9fd3c7', icon: '🜃', tags: ['passive', 'utility'] },
    { id: 'deep_impulse',   name: 'Impulse',   desc: 'Move speed +4%.',              color: '#8ec5ff', icon: '🜁', tags: ['kinetic', 'passive'] },
    { id: 'deep_reflex',    name: 'Reflex',    desc: 'Dash recharges 4 frames faster.', color: '#c9a0ff', icon: '🜄', tags: ['utility', 'kinetic'] },
    { id: 'deep_avarice',   name: 'Avarice',   desc: 'Pull Lucidity from 8% further.', color: '#ffcc66', icon: '🝊', tags: ['utility', 'passive'] }
];

export class LevelUpUI {
    constructor(audioEngine, saveManager) {
        this.modal = document.getElementById('level-up-modal');
        this.container = document.getElementById('cards-container');
        this.btnReroll = document.getElementById('btn-reroll'); 
        this.audioEngine = audioEngine;
        this.saveManager = saveManager;

        if (import.meta.env.DEV) window.FRACTURED_DEV_MODE = false;
        this.setupDevShortcuts();
        this.attachRerollEvent();
    }

    setupDevShortcuts() {
        // Dev-build only. In production the listener is never registered, so pressing
        // '0' does nothing and FRACTURED_DEV_MODE stays permanently false — which also
        // keeps every `window.FRACTURED_DEV_MODE &&` guard elsewhere permanently closed.
        if (!import.meta.env.DEV) return;
        window.addEventListener('keydown', (e) => {
            if (e.key === '0') {
                window.FRACTURED_DEV_MODE = !window.FRACTURED_DEV_MODE;
                console.log(`%c FRACTURED DEV MODE: ${window.FRACTURED_DEV_MODE ? 'ENABLED' : 'DISABLED'} `,
                            'background: #c5a059; color: #000; font-weight: bold;');
            }
        });
    }

    // Patch 29.5: C3's rerollCost effect (-10, 20 -> 10 sanity) has no legacy
    // equivalent, so it's read straight off the resolver rather than through
    // Game.init's stat pipeline. Floored at 5 so future stacking can never reach
    // a degenerate free-or-negative reroll.
    getRerollCost() {
        const baseCost = 20;
        if (!this.saveManager || typeof this.saveManager.getResolvedUpgrades !== 'function') return baseCost;
        const { stats } = this.saveManager.getResolvedUpgrades();
        return Math.max(5, baseCost + (stats.rerollCost || 0));
    }

    attachRerollEvent() {
        if (this.btnReroll) {
            this.btnReroll.addEventListener('click', () => {
                const cost = this.getRerollCost();
                if (this.currentGame && this.currentGame.state.sanity > cost) {
                    this.currentGame.state.sanity -= cost;
                    this.currentGame.state.cameraShake = 15;
                    if (this.audioEngine) this.audioEngine.playSFX('damage', 2);

                    this.show(this.currentGame, this.currentCallback);
                }
            });
        }
    }

    show(game, onCompleteCallback) {
        this.currentGame = game;
        this.currentCallback = onCompleteCallback;
        
        this.modal.style.display = 'flex';
        this.container.innerHTML = '';
        
        if (!game.state.player.synergies) game.state.player.synergies = [];
        if (!game.state.player.curses) game.state.player.curses = [];
        if (!game.state.banished) game.state.banished = []; 
        if (!game.state.player.boons) game.state.player.boons = [];

        const patLvlInfo = this.saveManager ? this.saveManager.getPatientLevelInfo() : { level: 1 };
        const patLvl = patLvlInfo.level;

        if (this.btnReroll) {
            if (patLvl >= 3) {
                this.btnReroll.style.display = 'block';
                const cost = this.getRerollCost();
                const canAfford = game.state.sanity > cost;
                this.btnReroll.disabled = !canAfford;
                this.btnReroll.innerText = canAfford ? `Reroll Choices (-${cost} Sanity)` : "Insufficient Sanity";
            } else {
                this.btnReroll.style.display = 'none';
            }
        }

        let availableBoons = BOONS.filter(b => !game.state.player.boons.includes(b.id)).map(b => ({ ...b, type: 'boon' }));

        // Patch 95: repeatable, so deliberately NOT filtered against player.boons —
        // and given their own `type` so selectCard cannot mistake one for a one-shot
        // boon and push it into that array, which would make it un-offerable again.
        if (isEndless(game.state.floor)) {
            availableBoons = availableBoons.concat(DEEP_BOONS.map(b => ({ ...b, type: 'deep' })));
        }

        let availableWeapons = [];
        const levelCap = weaponLevelCap(game.state.floor);
        for (const [weaponKey, wep] of Object.entries(game.state.player.weapons)) {
            // Patch 95: was a hardcoded `wep.level < 5`. weaponLevelCap returns exactly
            // 5 for floors 1-5, so Cycle I keeps its ceiling to the letter.
            if (wep.level < levelCap) {
                availableWeapons.push({
                    type: 'weapon',
                    id: weaponKey,
                    name: weaponKey.replace('_', ' ').toUpperCase(),
                    desc: 'Upgrade this weapon.',
                    color: '#c5a059',
                    icon: '🔧',
                    currentLevel: wep.level,
                    tags: wep.tags || []
                });
            }
        }

        let combinedPool = [...availableBoons, ...availableWeapons];

        if (combinedPool.length === 0) {
            game.state.player.maxHp += 50;
            game.state.sanity = Math.min(game.state.player.maxHp, game.state.sanity + 50);
            if (this.audioEngine) this.audioEngine.playSFX('pickup', 5);
            this.modal.style.display = 'none';
            if (onCompleteCallback) onCompleteCallback();
            return;
        }

        // Tag affinity: weight offers toward the build the player is already committing
        // to, so a run converges on an identity instead of drifting into a grab-bag.
        // Levelled weapons contribute by level (a level-4 weapon is a stronger
        // commitment than a level-1); already-taken boons contribute a flat 1.
        const affinity = {};
        const addAffinity = (tags, weight) => {
            (tags || []).forEach(t => { affinity[t] = (affinity[t] || 0) + weight; });
        };
        Object.values(game.state.player.weapons).forEach(wep => {
            if (wep && wep.level > 0) addAffinity(wep.tags, wep.level);
        });
        game.state.player.boons.forEach(id => {
            const taken = BOONS.find(b => b.id === id);
            if (taken) addAffinity(taken.tags, 1);
        });

        // Floor of 1 keeps every card reachable and the per-tag cap stops one maxed
        // weapon from dominating — weighting must stay a nudge, never a lock, or the
        // 24-boon pool collapses back to the same handful of cards every run.
        const weightOf = (item) => {
            let w = 1;
            (item.tags || []).forEach(t => { w += Math.min(affinity[t] || 0, 6) * 0.4; });
            return w;
        };

        // Weighted shuffle: repeated weighted draw WITHOUT replacement, so the three
        // cards rendered below are always distinct. Ordering the whole pool rather than
        // picking 3 directly leaves slice(0, 3) as the single source of "how many".
        const weightedPool = [...combinedPool];
        const shuffled = [];
        while (weightedPool.length > 0) {
            const weights = weightedPool.map(weightOf);
            const total = weights.reduce((a, b) => a + b, 0);
            let r = Math.random() * total;
            let idx = 0;
            for (; idx < weightedPool.length - 1; idx++) {
                r -= weights[idx];
                if (r <= 0) break;
            }
            shuffled.push(weightedPool.splice(idx, 1)[0]);
        }

        let selected = shuffled.slice(0, 3);
        
        selected.forEach((choice) => {
            const card = document.createElement('div'); 
            card.className = 'card';
            const rot = (Math.random() - 0.5) * 6;
            card.style.transform = `rotate(${rot}deg)`;
            card.style.background = '#111';
            card.style.border = '2px solid #555';
            
            // Patch 95: 'deep' needs its own arm. Without it a DEEP card falls into the
            // weapon branch and renders "WEAPON LVL NaN" — those cards carry no
            // currentLevel because they have no level to carry.
            let label;
            if (choice.type === 'boon') label = 'CLINICAL BREAKTHROUGH';
            else if (choice.type === 'deep') label = 'RECURSIVE ADAPTATION';
            else label = `WEAPON LVL ${choice.currentLevel + 1}`;

            card.innerHTML = `
                <div class="polaroid-photo" style="background: #111">
                    <div style="text-shadow: 0 0 15px rgba(255,255,255,0.5);">${choice.icon}</div>
                </div>
                <h3 style="color: ${choice.color}">${choice.name}</h3>
                <p style="color: #e2e8f0;">${choice.desc}</p>
                <div class="lvl" style="color: ${choice.color}">${label}</div>
            `;
            
            card.onclick = () => this.selectCard(choice, game, onCompleteCallback);
            this.container.appendChild(card);
        });
    }

    renderSurgeCard(game, onCompleteCallback) {
        const card = document.createElement('div');
        card.className = 'card';
        card.style.width = '300px';
        card.innerHTML = `
            <h3>LUCIDITY SURGE</h3>
            <p>Your mind has stabilized. All systems at peak performance.</p>
            <div class="lvl" style="color: var(--ui-red)">Recover +50% Sanity</div>
        `;
        card.onclick = () => {
            game.state.sanity = Math.min(game.state.player.maxHp, game.state.sanity + (game.state.player.maxHp * 0.5));
            this.modal.style.display = 'none';
            if (this.audioEngine) this.audioEngine.playSFX('pickup', 5);
            onCompleteCallback();
        };
        this.container.appendChild(card);
    }

    selectCard(choice, game, onCompleteCallback) {
        // Patch 57: recorded here rather than at the two branch tails below, so the
        // record cannot miss a pick if a future branch gains an early return. Weapons
        // report the level they just reached; boons pass null (they are one-shot).
        if (this.saveManager && typeof this.saveManager.recordBoonPick === 'function') {
            const wepForLevel = choice.type === 'weapon' ? game.state.player.weapons[choice.id] : null;
            this.saveManager.recordBoonPick(choice.id, wepForLevel ? wepForLevel.level + 1 : null);
        }

        if (choice.type === 'weapon') {
            const wep = game.state.player.weapons[choice.id];
            if (wep) {
                wep.level++;
                if (choice.id === 'flashlight') { 
                    wep.damage += 5; wep.radius += 20; wep.angle += 0.05; 
                } else if (choice.id === 'static') { 
                    wep.damage += 3; wep.radius += 15; wep.active = true; 
                } else if (choice.id === 'lead_pipe') {
                    wep.damage += 20; wep.radius += 15; wep.cooldown = Math.max(30, wep.cooldown - 10);
                } else if (choice.id === 'spilled_ink') {
                    wep.damage += 3; wep.radius += 10; wep.dropRate = Math.max(10, wep.dropRate - 5);
                } else if (choice.id === 'corrosive_battery') {
                    wep.damage += 5; wep.duration += 30;
                } else if (choice.id === 'broken_chalk') {
                    wep.radius += 15; wep.duration += 30; wep.cooldown = Math.max(60, wep.cooldown - 15);
                } else if (choice.id === 'polaroid_camera') {
                    wep.damage += 20; wep.radius += 40; wep.cooldown = Math.max(90, wep.cooldown - 30);
                } else if (choice.id === 'fidget_spinner') {
                    wep.damage += 5; wep.baseRadius += 10; wep.speed += 0.02;
                }
            }
        } else if (choice.type === 'deep') {
            // Patch 95 — repeatable. Deliberately NOT pushed into player.boons: that
            // array is the one-shot ledger the BOONS pool filters against, and adding
            // to it would make each of these offerable exactly once, which is the whole
            // thing they exist not to be.
            //
            // Every effect below is safe to apply an unbounded number of times — plain
            // addition or a multiplier above 1, no flags, no division, no one-way
            // switches. That constraint is what the pool was designed around; keep it
            // if any card is ever added here.
            const p = game.state.player;
            if (choice.id === 'deep_acuity') {
                Object.values(p.weapons).forEach(wep => {
                    if (wep && Number.isFinite(wep.damage)) wep.damage *= 1.10;
                });
            } else if (choice.id === 'deep_bulwark') {
                p.maxHp += 25;
                game.state.sanity += 25;
            } else if (choice.id === 'deep_impulse') {
                p.speed *= 1.04;
            } else if (choice.id === 'deep_reflex') {
                // Same clamp Game.init applies to the Synapse Tree's dashCooldown node,
                // so stacking this can never reach a degenerate near-zero cooldown.
                p.dash.baseCooldown = Math.max(20, p.dash.baseCooldown - 4);
            } else if (choice.id === 'deep_avarice') {
                // Combat.collectXP reads `70 + vacRadiusBonusPx`, so an 8% increase in
                // reach means 8% of that total, not 8% of the bonus alone.
                const current = 70 + (p.vacRadiusBonusPx || 0);
                p.vacRadiusBonusPx = (p.vacRadiusBonusPx || 0) + Math.round(current * 0.08);
            }
        } else {
            game.state.player.boons.push(choice.id);

            const w = game.state.player.weapons;

            if (choice.id === 'tunnel_vision') {
                w.flashlight.angle /= 2;
                w.flashlight.damage *= 2;
            } else if (choice.id === 'iron_will') {
                game.state.player.maxHp += 50;
                game.state.sanity += 50;
            } else if (choice.id === 'lead_shoes') {
                game.state.player.maxHp += 200;
                game.state.sanity += 200;
            } else if (choice.id === 'steady_hands') {
                // Applies to every weapon that actually has a cooldown field.
                ['lead_pipe', 'broken_chalk', 'polaroid_camera'].forEach(id => {
                    if (w[id] && w[id].cooldown) w[id].cooldown = Math.max(20, Math.floor(w[id].cooldown * 0.8));
                });
            } else if (choice.id === 'wide_lens') {
                w.flashlight.radius *= 1.4;
                w.flashlight.damage *= 0.9;
            } else if (choice.id === 'overcharge') {
                w.static.radius *= 1.5;
                w.static.damage *= 1.3;
            } else if (choice.id === 'heavy_swing') {
                w.lead_pipe.damage *= 1.6;
                w.lead_pipe.cooldown = Math.floor(w.lead_pipe.cooldown * 1.2);
            } else if (choice.id === 'ink_flood') {
                w.spilled_ink.radius *= 1.5;
                w.spilled_ink.dropRate = Math.max(8, Math.floor(w.spilled_ink.dropRate * 0.5));
            } else if (choice.id === 'sharpened_blades') {
                w.fidget_spinner.damage *= 1.5;
                w.fidget_spinner.baseRadius += 20;
            } else if (choice.id === 'long_exposure') {
                w.polaroid_camera.radius *= 1.5;
                w.polaroid_camera.cooldown = Math.max(60, Math.floor(w.polaroid_camera.cooldown * 0.75));
            } else if (choice.id === 'chalk_dust') {
                w.broken_chalk.radius *= 1.3;
                w.broken_chalk.duration = Math.floor(w.broken_chalk.duration * 1.5);
            }
        }

        game.state.player.synergies = getActiveSynergies(game.state.player.weapons);

        if (this.audioEngine) this.audioEngine.playSFX('levelup', 5);
        
        game.state.sanity = Math.min(game.state.player.maxHp, game.state.sanity + 20);
        this.modal.style.display = 'none';
        try { if (navigator.vibrate) navigator.vibrate([50, 50, 50]); } catch(e){}
        onCompleteCallback();
    }
}  