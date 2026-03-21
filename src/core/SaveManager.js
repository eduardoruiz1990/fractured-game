// src/core/SaveManager.js
// Handles reading and writing to the browser's localStorage for meta-progression.
import { TOKEN_RARITIES } from '../data/Manifestations.js';

export class SaveManager {
    constructor() {
        this.saveKey = 'fractured_save_v1';
        this.metaState = { 
            lucidityBank: 0, 
            spentLucidity: 0, 
            upgrades: { hp: 0, speed: 0, light: 0 },
            inventory: [], 
            equippedTokens: { head: null, body: null, hands: null, legs: null },
            maxFloorReached: 1 // NEW: Track the deepest descent
        };
        this.loadSave();
        
        if (this.metaState.inventory.length === 0) {
            this.addTokenToInventory('head_paranoia', 'COMMON');
        }
    }

    loadSave() {
        try {
            const saved = localStorage.getItem(this.saveKey);
            if (saved) {
                const parsed = JSON.parse(saved);
                this.metaState = { ...this.metaState, ...parsed };
                if (!this.metaState.inventory) this.metaState.inventory = [];
                if (!this.metaState.equippedTokens) this.metaState.equippedTokens = { head: null, body: null, hands: null, legs: null };
                if (this.metaState.spentLucidity === undefined) this.metaState.spentLucidity = 0; 
                if (!this.metaState.maxFloorReached) this.metaState.maxFloorReached = 1; // Backwards compatibility
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
    
    wipeSave() {
        try {
            localStorage.removeItem(this.saveKey);
            location.reload(); 
        } catch(e) {
            console.warn("Could not wipe local storage.");
        }
    }

    // --- EPIC 3: GLOBAL PROGRESSION ---
    getPatientLevelInfo() {
        let xp = this.metaState.spentLucidity || 0;
        let level = 1;
        let xpForNext = 1000; // Base requirement heavily increased
        let xpForCurrentLevelStart = 0;

        // Stricter exponential scaling: 1.8x each level (80% more per level)
        while (xp >= xpForCurrentLevelStart + xpForNext) {
            xpForCurrentLevelStart += xpForNext;
            level++;
            xpForNext = Math.floor(xpForNext * 1.8);
        }

        let currentLevelXP = xp - xpForCurrentLevelStart;
        return {
            level: level,
            currentXP: currentLevelXP,
            nextXP: xpForNext,
            progressPercent: (currentLevelXP / xpForNext) * 100
        };
    }

    buyUpgrade(stat, baseCost) {
        const cost = Math.floor(baseCost * Math.pow(1.1, this.metaState.upgrades[stat]));
        
        if (this.metaState.lucidityBank >= cost && this.metaState.upgrades[stat] < 100) {
            this.metaState.lucidityBank -= cost;
            this.metaState.spentLucidity += cost; 
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

    // --- EPIC 2 & 3: TOKEN MANAGEMENT & FORGING ---

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
        if (this.metaState.equippedTokens[slotType] === uid) return; 
        this.metaState.equippedTokens[slotType] = uid;
        this.saveGame();
    }

    unequipToken(slotType) {
        this.metaState.equippedTokens[slotType] = null;
        this.saveGame();
    }

    upgradeToken(uid) {
        const item = this.metaState.inventory.find(i => i.uid === uid);
        if (!item) return false;
        
        const rarityData = TOKEN_RARITIES[item.rarity];
        if (!rarityData || !rarityData.costToUpgrade || this.metaState.lucidityBank < rarityData.costToUpgrade) return false;

        this.metaState.lucidityBank -= rarityData.costToUpgrade;
        this.metaState.spentLucidity += rarityData.costToUpgrade; 

        if (item.rarity === 'COMMON') item.rarity = 'RARE';
        else if (item.rarity === 'RARE') item.rarity = 'EPIC';
        else if (item.rarity === 'EPIC') item.rarity = 'ANOMALOUS';

        this.saveGame();
        return true;
    }
}