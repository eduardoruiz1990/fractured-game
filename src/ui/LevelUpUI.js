import { MANIFESTATIONS, SYNERGIES, INTRUSIVE_THOUGHTS, getActiveSynergies } from '../data/Manifestations.js';

export class LevelUpUI {
    constructor(audioEngine, saveManager) {
        this.modal = document.getElementById('level-up-modal');
        this.container = document.getElementById('cards-container');
        this.btnReroll = document.getElementById('btn-reroll'); 
        this.audioEngine = audioEngine;
        this.saveManager = saveManager;

        window.FRACTURED_DEV_MODE = false;
        this.setupDevShortcuts();
        this.attachRerollEvent();
    }

    setupDevShortcuts() {
        window.addEventListener('keydown', (e) => {
            if (e.key === '0') {
                window.FRACTURED_DEV_MODE = !window.FRACTURED_DEV_MODE;
                console.log(`%c FRACTURED DEV MODE: ${window.FRACTURED_DEV_MODE ? 'ENABLED' : 'DISABLED'} `, 
                            'background: #c5a059; color: #000; font-weight: bold;');
            }
        });
    }

    attachRerollEvent() {
        if (this.btnReroll) {
            this.btnReroll.addEventListener('click', () => {
                if (this.currentGame && this.currentGame.state.sanity > 20) {
                    this.currentGame.state.sanity -= 20; 
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
                const canAfford = game.state.sanity > 20;
                this.btnReroll.disabled = !canAfford;
                this.btnReroll.innerText = canAfford ? "Reroll Choices (-20 Sanity)" : "Insufficient Sanity";
            } else {
                this.btnReroll.style.display = 'none';
            }
        }

        // `tags` mirrors the 12-tag vocabulary used by state.player.weapons, so offers
        // can later be weighted toward the build the player is already committing to.
        // Every boon here has a real implementation — see selectCard() below for the
        // instant-apply ones, and the boons.includes() hooks in Game.js / Combat.js
        // for the persistent ones.
        const BOONS = [
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

        let availableBoons = BOONS.filter(b => !game.state.player.boons.includes(b.id)).map(b => ({ ...b, type: 'boon' }));
        
        let availableWeapons = [];
        for (const [weaponKey, wep] of Object.entries(game.state.player.weapons)) {
            if (wep.level < 5) {
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
            
            let label = choice.type === 'boon' ? 'CLINICAL BREAKTHROUGH' : `WEAPON LVL ${choice.currentLevel + 1}`;

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