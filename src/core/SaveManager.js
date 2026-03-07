// src/core/SaveManager.js
// Handles reading and writing to the browser's localStorage for meta-progression.
export class SaveManager {
    constructor() {
        this.saveKey = 'fractured_save_v1';
        this.metaState = { 
            lucidityBank: 0, 
            upgrades: { hp: 0, speed: 0, light: 0 } 
        };
        this.loadSave();
    }

    loadSave() {
        try {
            const saved = localStorage.getItem(this.saveKey);
            if (saved) {
                this.metaState = JSON.parse(saved);
            }
        } catch(e) { 
            console.warn("Local storage disabled or blocked."); 
        }
    }

    saveGame() {
        try {
            localStorage.setItem(this.saveKey, JSON.stringify(this.metaState));
        } catch(e) { 
            console.warn("Local storage disabled or blocked."); 
        }
    }

    buyUpgrade(stat, baseCost) {
        const cost = baseCost + (this.metaState.upgrades[stat] * 25);
        if (this.metaState.lucidityBank >= cost && this.metaState.upgrades[stat] < 5) {
            this.metaState.lucidityBank -= cost;
            this.metaState.upgrades[stat]++;
            this.saveGame();
            return true;
        }
        return false;
    }
    
    addLucidity(amount) {
        this.metaState.lucidityBank += amount;
        this.saveGame();
    }
}