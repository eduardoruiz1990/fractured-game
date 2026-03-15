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

        let availableManifestations = Object.keys(MANIFESTATIONS).filter(key => {
            if (game.state.banished.includes(key)) return false;
            const currentLvl = game.state.player.weapons[key]?.level || 0;
            return currentLvl < MANIFESTATIONS[key].maxLvl;
        });

        let availableSynergies = Object.keys(SYNERGIES).filter(synKey => {
            if (game.state.banished.includes(synKey)) return false;
            const syn = SYNERGIES[synKey];
            const hasReqs = window.FRACTURED_DEV_MODE || 
                            syn.reqs.every(req => game.state.player.weapons[req] && game.state.player.weapons[req].level >= 5);
            const alreadyHas = game.state.player.synergies.includes(synKey);
            return hasReqs && !alreadyHas;
        });

        let availableCurses = Object.keys(INTRUSIVE_THOUGHTS).filter(cKey => !game.state.player.curses.includes(cKey) && !game.state.banished.includes(cKey));

        let pool = [...availableManifestations, ...availableSynergies];

        if (availableCurses.length > 0 && (Math.random() < 0.25 || window.FRACTURED_DEV_MODE)) {
            const injectedCurse = availableCurses[Math.floor(Math.random() * availableCurses.length)];
            pool.push(injectedCurse);
        }

        if (pool.length === 0) {
            this.renderSurgeCard(game, onCompleteCallback);
            return;
        }

        const shuffled = pool.sort((a, b) => {
            if (window.FRACTURED_DEV_MODE) {
                const aIsCurse = !!INTRUSIVE_THOUGHTS[a];
                const bIsCurse = !!INTRUSIVE_THOUGHTS[b];
                if (aIsCurse && !bIsCurse) return -1;
                if (!aIsCurse && bIsCurse) return 1;
            }
            return 0.5 - Math.random();
        });

        let selected = shuffled.slice(0, 3);
        
        const getIcon = (key) => {
            const icons = { 
                flashlight: '🔦', static: '📻', adrenaline: '💉', lead_pipe: '🔧', 
                spilled_ink: '🦑', corrosive_battery: '🔋', broken_chalk: '🖍️', 
                polaroid_camera: '📸', fidget_spinner: '⚙️', 
                blinding_signal: '👁️‍🗨️', industrial_bleed: '🩸', scholastic_purge: '☣️', 
                everything_is_target: '🎯', manic_episode: '🌀', compulsive_cleaner: '🧹',
                tunnel_vision: '🕳️' 
            };
            return icons[key] || '❓';
        };
        
        selected.forEach((key, index) => {
            let isSynergy = !!SYNERGIES[key];
            let isCurse = !!INTRUSIVE_THOUGHTS[key];
            
            const item = isCurse ? INTRUSIVE_THOUGHTS[key] : (isSynergy ? SYNERGIES[key] : MANIFESTATIONS[key]);
            const currentLvl = (isSynergy || isCurse) ? 0 : (game.state.player.weapons[key]?.level || 0);
            
            const card = document.createElement('div'); 
            card.className = 'card';
            const rot = (Math.random() - 0.5) * 6;
            card.style.transform = `rotate(${rot}deg)`;
            
            let titleColor = '#111';
            let bottomText = `Level Up to ${currentLvl + 1}`;
            let photoBg = '#111';
            let iconFilter = '';
            
            if (isCurse) {
                titleColor = 'var(--ui-red)'; bottomText = 'INTRUSIVE THOUGHT'; photoBg = '#2a0505'; iconFilter = 'hue-rotate(90deg) saturate(200%) brightness(50%)';
            } else if (isSynergy) {
                titleColor = 'var(--ui-gold)'; bottomText = 'SYNERGY DISCOVERED'; photoBg = '#221a05'; iconFilter = 'sepia(100%) saturate(300%) hue-rotate(10deg)';
            }
            
            card.innerHTML = `
                <div class="polaroid-photo" style="background: ${photoBg}">
                    <div style="filter: ${iconFilter}; text-shadow: 0 0 15px rgba(255,255,255,0.5);">${getIcon(key)}</div>
                </div>
                <h3 style="color: ${titleColor}">${item.name}</h3>
                <p>${item.desc}</p>
                <div class="lvl" style="color: ${titleColor}">${bottomText}</div>
            `;
            
            card.onclick = () => this.selectCard(key, game, onCompleteCallback, isCurse ? 'curse' : (isSynergy ? 'synergy' : 'normal'));
            
            if (patLvl >= 7) {
                const banishBtn = document.createElement('button');
                banishBtn.className = 'banish-btn';
                banishBtn.innerText = 'X';
                banishBtn.title = 'Suppress Memory (Banish)';
                banishBtn.onclick = (e) => {
                    e.stopPropagation(); 
                    game.state.banished.push(key);
                    if (this.audioEngine) this.audioEngine.playSFX('damage', 4);
                    game.state.cameraShake = 10;
                    this.show(game, onCompleteCallback); 
                };
                card.appendChild(banishBtn);
            }

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

    selectCard(key, game, onCompleteCallback, cardType) {
        if (cardType === 'curse') {
            game.state.player.curses.push(key);
            game.state.cameraShake = 40;
            
            if (key === 'everything_is_target') {
                game.state.player.weapons.flashlight.damage *= 2;
                game.state.player.weapons.static.damage *= 2;
                game.state.player.weapons.lead_pipe.damage *= 2;
            } else if (key === 'manic_episode') {
                game.state.player.weapons.lead_pipe.cooldown = Math.max(15, game.state.player.weapons.lead_pipe.cooldown / 2);
                game.state.player.weapons.spilled_ink.dropRate = Math.max(5, game.state.player.weapons.spilled_ink.dropRate / 2);
                game.state.sanityDrainMult *= 2.0;
            }
            
            if (this.audioEngine) this.audioEngine.playSFX('damage', 5); 
        } 
        else if (cardType === 'synergy') {
            game.state.player.synergies.push(key);
            if (key === 'blinding_signal') {
                game.state.cameraShake = 30; 
                game.state.player.weapons.flashlight.damage *= 1.2;
            } else if (key === 'industrial_bleed') {
                game.state.cameraShake = 30;
                game.state.player.weapons.lead_pipe.damage *= 1.5; 
            } else if (key === 'scholastic_purge') {
                game.state.cameraShake = 30;
                game.state.player.weapons.broken_chalk.duration *= 1.5;
            }

            if (this.audioEngine) this.audioEngine.playSFX('levelup', 5); 
        } 
        else {
            const wep = game.state.player.weapons[key];
            if (wep) wep.level++;

            if (key === 'adrenaline') {
                game.state.player.speedMultiplier += 0.1;
                game.state.sanityDrainMult *= 0.85;
            } else if (key === 'flashlight') { 
                wep.damage += 5; wep.radius += 20; wep.angle += 0.05; 
            } else if (key === 'static') { 
                wep.damage += 3; wep.radius += 15; wep.active = true; 
            } else if (key === 'lead_pipe') {
                wep.damage += 20; wep.radius += 15; wep.cooldown = Math.max(30, wep.cooldown - 10);
            } else if (key === 'spilled_ink') {
                wep.damage += 3; wep.radius += 10; wep.dropRate = Math.max(10, wep.dropRate - 5);
            } else if (key === 'corrosive_battery') {
                wep.damage += 5; wep.duration += 30;
            } else if (key === 'broken_chalk') {
                wep.radius += 15; wep.duration += 30; wep.cooldown = Math.max(60, wep.cooldown - 15);
            } else if (key === 'polaroid_camera') {
                wep.damage += 20; wep.radius += 40; wep.cooldown = Math.max(90, wep.cooldown - 30);
            } else if (key === 'fidget_spinner') {
                wep.damage += 5; wep.baseRadius += 10; wep.speed += 0.02;
            }
            
            if (this.audioEngine) this.audioEngine.playSFX('levelup');
        }
        
        game.state.sanity = Math.min(game.state.player.maxHp, game.state.sanity + 20);
        this.modal.style.display = 'none';
        try { if (navigator.vibrate) navigator.vibrate([50, 50, 50]); } catch(e){}
        onCompleteCallback();
    }
}