// src/core/SaveManager.js
// Handles reading and writing to the browser's localStorage for meta-progression.

export class SaveManager {
    constructor() {
        this.saveKey = 'fractured_save_v1';
        this.metaState = { 
            lucidityBank: 0, 
            upgrades: { hp: 0, speed: 0, light: 0 },
            inventory: [], // Array of token objects
            equippedTokens: { head: null, body: null, hands: null, legs: null } // Stores inventory UIDs
        };
        this.loadSave();
        
        // Give new players a starting token to play with the UI
        if (this.metaState.inventory.length === 0) {
            this.addTokenToInventory('head_paranoia', 'COMMON');
        }
    }

    loadSave() {
        try {
            const saved = localStorage.getItem(this.saveKey);
            if (saved) {
                const parsed = JSON.parse(saved);
                // Merge to ensure backward compatibility with older saves
                this.metaState = { ...this.metaState, ...parsed };
                if (!this.metaState.inventory) this.metaState.inventory = [];
                if (!this.metaState.equippedTokens) this.metaState.equippedTokens = { head: null, body: null, hands: null, legs: null };
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

    // --- EPIC 2: TOKEN MANAGEMENT ---

    generateUID() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    addTokenToInventory(tokenId, rarity) {
        const newItem = {
            uid: this.generateUID(),
            id: tokenId,
            rarity: rarity,
            level: 1
        };
        this.metaState.inventory.push(newItem);
        this.saveGame();
    }

    equipToken(uid, slotType) {
        // Unequip current if necessary
        if (this.metaState.equippedTokens[slotType] === uid) return; // Already equipped
        
        this.metaState.equippedTokens[slotType] = uid;
        this.saveGame();
    }

    unequipToken(slotType) {
        this.metaState.equippedTokens[slotType] = null;
        this.saveGame();
    }
}