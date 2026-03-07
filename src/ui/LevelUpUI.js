import { MANIFESTATIONS, SYNERGIES, INTRUSIVE_THOUGHTS } from '../data/Manifestations.js';

export class LevelUpUI {
    constructor(audioEngine) {
        this.modal = document.getElementById('level-up-modal');
        this.container = document.getElementById('cards-container');
        this.audioEngine = audioEngine;

        window.FRACTURED_DEV_MODE = false;
        this.setupDevShortcuts();
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

    show(game, onCompleteCallback) {
        this.modal.style.display = 'flex';
        this.container.innerHTML = '';
        
        if (!game.state.player.synergies) game.state.player.synergies = [];
        if (!game.state.player.curses) game.state.player.curses = [];

        let availableManifestations = Object.keys(MANIFESTATIONS).filter(key => {
            const currentLvl = game.state.player.weapons[key]?.level || 0;
            return currentLvl < MANIFESTATIONS[key].maxLvl;
        });

        let availableSynergies = Object.keys(SYNERGIES).filter(synKey => {
            const syn = SYNERGIES[synKey];
            const hasReqs = window.FRACTURED_DEV_MODE || 
                            syn.reqs.every(req => game.state.player.weapons[req] && game.state.player.weapons[req].level >= 5);
            const alreadyHas = game.state.player.synergies.includes(synKey);
            return hasReqs && !alreadyHas;
        });

        let availableCurses = Object.keys(INTRUSIVE_THOUGHTS).filter(cKey => !game.state.player.curses.includes(cKey));

        let pool = [...availableManifestations, ...availableSynergies];

        // Intrusive Thoughts have a 25% chance to infect the pool (or 100% in Dev Mode)
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
        
        selected.forEach(key => {
            let isSynergy = !!SYNERGIES[key];
            let isCurse = !!INTRUSIVE_THOUGHTS[key];
            
            const item = isCurse ? INTRUSIVE_THOUGHTS[key] : (isSynergy ? SYNERGIES[key] : MANIFESTATIONS[key]);
            const currentLvl = (isSynergy || isCurse) ? 0 : (game.state.player.weapons[key]?.level || 0);
            
            const card = document.createElement('div'); 
            card.className = 'card';
            
            if (isCurse) {
                card.style.borderBottom = '25px solid var(--ui-red)';
                card.style.boxShadow = '0 0 20px var(--ui-red)';
                card.innerHTML = `
                    <h3 style="color: var(--ui-red)">${item.name}</h3>
                    <p style="font-weight: bold;">${item.desc}</p>
                    <div class="lvl" style="color: var(--ui-red)">INTRUSIVE THOUGHT</div>
                `;
                card.onclick = () => this.selectCard(key, game, onCompleteCallback, 'curse');
            } else if (isSynergy) {
                card.style.borderBottom = '25px solid var(--ui-gold)';
                card.style.boxShadow = '0 0 20px var(--ui-gold)';
                card.innerHTML = `
                    <h3 style="color: var(--ui-gold)">${item.name}</h3>
                    <p>${item.desc}</p>
                    <div class="lvl" style="color: var(--ui-gold)">SYNERGY DISCOVERED</div>
                `;
                card.onclick = () => this.selectCard(key, game, onCompleteCallback, 'synergy');
            } else {
                card.innerHTML = `
                    <h3>${item.name}</h3>
                    <p>${item.desc}</p>
                    <div class="lvl">Level Up to ${currentLvl + 1}</div>
                `;
                card.onclick = () => this.selectCard(key, game, onCompleteCallback, 'normal');
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
            
            // Apply immediate curse state modifications
            if (key === 'everything_is_target') {
                game.state.player.weapons.flashlight.damage *= 2;
                game.state.player.weapons.static.damage *= 2;
                game.state.player.weapons.lead_pipe.damage *= 2;
            } else if (key === 'manic_episode') {
                game.state.player.weapons.lead_pipe.cooldown = Math.max(15, game.state.player.weapons.lead_pipe.cooldown / 2);
                game.state.player.weapons.spilled_ink.dropRate = Math.max(5, game.state.player.weapons.spilled_ink.dropRate / 2);
                game.state.sanityDrainMult *= 2.0;
            }
            
            if (this.audioEngine) this.audioEngine.playSFX('damage', 5); // Scary discordant sound
        } 
        else if (cardType === 'synergy') {
            game.state.player.synergies.push(key);
            if (key === 'blinding_signal') {
                game.state.cameraShake = 30; 
                game.state.player.weapons.flashlight.damage *= 1.2;
            } else if (key === 'industrial_bleed') {
                game.state.cameraShake = 30;
                game.state.player.weapons.lead_pipe.damage *= 1.5; 
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
            }
            if (this.audioEngine) this.audioEngine.playSFX('levelup');
        }
        
        game.state.sanity = Math.min(game.state.player.maxHp, game.state.sanity + 20);
        this.modal.style.display = 'none';
        try { if (navigator.vibrate) navigator.vibrate([50, 50, 50]); } catch(e){}
        onCompleteCallback();
    }
}