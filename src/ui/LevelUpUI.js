// src/ui/LevelUpUI.js
import { MANIFESTATIONS } from '../data/Manifestations.js';

export class LevelUpUI {
    constructor(audioEngine) {
        this.modal = document.getElementById('level-up-modal');
        this.container = document.getElementById('cards-container');
        this.audioEngine = audioEngine;
    }

    show(game, onCompleteCallback) {
        this.modal.style.display = 'flex';
        this.container.innerHTML = '';
        
        const keysList = Object.keys(MANIFESTATIONS);
        const shuffled = [...keysList].sort(() => 0.5 - Math.random());
        let selected = shuffled.slice(0, 3);
        
        selected.forEach(key => {
            const man = MANIFESTATIONS[key];
            const currentLvl = game.state.player.weapons[key]?.level || 0;
            const card = document.createElement('div'); 
            card.className = 'card';
            
            if (currentLvl >= man.maxLvl) {
                card.innerHTML = `<h3>${man.name}</h3><p>MAX LEVEL</p>`;
                card.style.opacity = '0.5'; 
                card.style.cursor = 'not-allowed';
            } else {
                card.innerHTML = `<h3>${man.name}</h3><p>${man.desc}</p><div class="lvl">Level Up to ${currentLvl + 1}</div>`;
                card.onclick = () => {
                    this.selectCard(key, game, onCompleteCallback);
                };
            }
            this.container.appendChild(card);
        });
    }

    selectCard(key, game, onCompleteCallback) {
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
        
        // Heal some sanity on level up
        game.state.sanity = Math.min(game.state.player.maxHp, game.state.sanity + 20);
        
        // Hide UI
        this.modal.style.display = 'none';
        
        // Haptics & Audio confirmation
        if (this.audioEngine) this.audioEngine.playSFX('levelup');
        try { if (navigator.vibrate) navigator.vibrate([50, 50, 50]); } catch(e){}
        
        // Resume Game Loop via callback
        onCompleteCallback();
    }
}