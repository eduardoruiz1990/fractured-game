import { MANIFESTATIONS, SYNERGIES } from '../data/Manifestations.js';

export class LevelUpUI {
    constructor(audioEngine) {
        this.modal = document.getElementById('level-up-modal');
        this.container = document.getElementById('cards-container');
        this.audioEngine = audioEngine;

        // Initialize Dev Mode
        window.FRACTURED_DEV_MODE = false;
        this.setupDevShortcuts();
    }

    setupDevShortcuts() {
        window.addEventListener('keydown', (e) => {
            // Press '0' to toggle Dev Mode for testing synergies
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

        // 1. Build the list of available regular upgrades
        let availableManifestations = Object.keys(MANIFESTATIONS).filter(key => {
            const currentLvl = game.state.player.weapons[key]?.level || 0;
            return currentLvl < MANIFESTATIONS[key].maxLvl;
        });

        // 2. Build the list of available synergies
        let availableSynergies = Object.keys(SYNERGIES).filter(synKey => {
            const syn = SYNERGIES[synKey];
            const hasReqs = window.FRACTURED_DEV_MODE || 
                            syn.reqs.every(req => game.state.player.weapons[req] && game.state.player.weapons[req].level >= 5);
            const alreadyHas = game.state.player.synergies.includes(synKey);
            return hasReqs && !alreadyHas;
        });

        // 3. Combine pools
        let pool = [...availableManifestations, ...availableSynergies];

        // 4. Handle "Soft Block" (Endgame Fallback)
        // If the pool is empty (everything maxed), we offer "Lucidity Surge"
        if (pool.length === 0) {
            this.renderSurgeCard(game, onCompleteCallback);
            return;
        }

        // Shuffle logic (Prioritize Synergies in Dev Mode)
        const shuffled = pool.sort((a, b) => {
            if (window.FRACTURED_DEV_MODE) {
                const aIsSyn = !!SYNERGIES[a];
                const bIsSyn = !!SYNERGIES[b];
                if (aIsSyn && !bIsSyn) return -1;
                if (!aIsSyn && bIsSyn) return 1;
            }
            return 0.5 - Math.random();
        });

        let selected = shuffled.slice(0, 3);
        
        selected.forEach(key => {
            let isSynergy = !!SYNERGIES[key];
            const item = isSynergy ? SYNERGIES[key] : MANIFESTATIONS[key];
            const currentLvl = isSynergy ? 0 : (game.state.player.weapons[key]?.level || 0);
            
            const card = document.createElement('div'); 
            card.className = 'card';
            
            if (isSynergy) {
                card.style.borderBottom = '25px solid var(--ui-gold)';
                card.style.boxShadow = '0 0 20px var(--ui-gold)';
                card.innerHTML = `
                    <h3 style="color: var(--ui-gold)">${item.name}</h3>
                    <p>${item.desc}</p>
                    <div class="lvl" style="color: var(--ui-gold)">SYNERGY DISCOVERED</div>
                `;
                card.onclick = () => this.selectCard(key, game, onCompleteCallback, true);
            } else {
                card.innerHTML = `
                    <h3>${item.name}</h3>
                    <p>${item.desc}</p>
                    <div class="lvl">Level Up to ${currentLvl + 1}</div>
                `;
                card.onclick = () => this.selectCard(key, game, onCompleteCallback, false);
            }
            this.container.appendChild(card);
        });
    }

    // New Fallback UI for maxed-out builds
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

    selectCard(key, game, onCompleteCallback, isSynergy = false) {
        if (isSynergy) {
            game.state.player.synergies.push(key);
            console.log(`%c Synergy Selected: ${key} `, 'color: #c5a059; font-weight: bold;');
            
            // Special initialization for "The Blinding Signal" logic
            if (key === 'blinding_signal') {
                game.state.cameraShake = 30; // Visual confirmation
                // We ensure the player weapon damage gets a small synergy boost
                game.state.player.weapons.flashlight.damage *= 1.2;
            }

            if (this.audioEngine) this.audioEngine.playSFX('levelup', 5); // Huge sound
        } else {
            const wep = game.state.player.weapons[key];
            if (wep) wep.level++;

            // Apply specific manifestation effects
            if (key === 'adrenaline') {
                game.state.player.speedMultiplier += 0.1;
                game.state.sanityDrainMult *= 0.85;
            } else if (key === 'flashlight') { 
                wep.damage += 5; 
                wep.radius += 20; 
                wep.angle += 0.05; 
            } else if (key === 'static') { 
                wep.damage += 3; 
                wep.radius += 15; 
                wep.active = true; 
            }
            if (this.audioEngine) this.audioEngine.playSFX('levelup');
        }
        
        // Heal some sanity on level up
        game.state.sanity = Math.min(game.state.player.maxHp, game.state.sanity + 20);
        
        // Hide UI
        this.modal.style.display = 'none';
        
        // Haptics & Audio confirmation
        try { if (navigator.vibrate) navigator.vibrate([50, 50, 50]); } catch(e){}
        
        // Resume Game Loop via callback
        onCompleteCallback();
    }
}