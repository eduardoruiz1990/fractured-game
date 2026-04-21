import { MANIFESTATIONS, SYNERGIES, INTRUSIVE_THOUGHTS } from '../data/Manifestations.js';

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

        const BOONS = [
            { id: 'kinetic_dash', name: 'Kinetic Routing', desc: 'Dashing damages enemies you pass through.', color: '#00ffcc', icon: '⚡' },
            { id: 'toxic_blood', name: 'Toxic Blood', desc: 'Taking damage spawns a Spilled Ink hazard at your feet.', color: '#aa00ff', icon: '🩸' },
            { id: 'tunnel_vision', name: 'Hyperfocus', desc: 'Flashlight cone width is halved, but damage is doubled.', color: '#ffcc00', icon: '🔦' },
            { id: 'adrenaline_surge', name: 'Adrenaline Surge', desc: 'Dropping below 30% Sanity doubles your movement speed.', color: '#ff0033', icon: '💉' },
            { id: 'iron_will', name: 'Iron Will', desc: 'Max Sanity increased by 50.', color: '#ffffff', icon: '🛡️' },
            { id: 'glass_cannon', name: 'Glass Cannon', desc: 'Damage +100%, Sanity drains twice as fast.', color: '#ff4444', icon: '💥' },
            { id: 'vampirism', name: 'Vampirism', desc: 'Melee kills restore 2 Sanity.', color: '#bb0000', icon: '🦇' },
            { id: 'static_discharge', name: 'Static Discharge', desc: 'Taking damage triggers a massive Static AoE.', color: '#00ffff', icon: '⚡' },
            { id: 'lead_shoes', name: 'Lead Shoes', desc: 'Cannot Dash. Max Sanity +200.', color: '#777777', icon: '🥾' },
            { id: 'shadow_step', name: 'Shadow Step', desc: 'Dashing grants 1 second of invisibility (enemies lose tracking).', color: '#555555', icon: '🥷' }
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
                    currentLevel: wep.level
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

        const shuffled = combinedPool.sort(() => 0.5 - Math.random());
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
            
            if (choice.id === 'tunnel_vision') {
                game.state.player.weapons.flashlight.angle /= 2;
                game.state.player.weapons.flashlight.damage *= 2;
            } else if (choice.id === 'iron_will') {
                game.state.player.maxHp += 50;
                game.state.sanity += 50;
            } else if (choice.id === 'lead_shoes') {
                game.state.player.maxHp += 200;
                game.state.sanity += 200;
            }
        }

        if (this.audioEngine) this.audioEngine.playSFX('levelup', 5);
        
        game.state.sanity = Math.min(game.state.player.maxHp, game.state.sanity + 20);
        this.modal.style.display = 'none';
        try { if (navigator.vibrate) navigator.vibrate([50, 50, 50]); } catch(e){}
        onCompleteCallback();
    }
}  