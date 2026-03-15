// src/core/SaveManager.js
// Handles reading and writing to the browser's localStorage for meta-progression.
import { TOKEN_RARITIES } from '../data/Manifestations.js';

export class SaveManager {
    constructor() {
        this.saveKey = 'fractured_save_v1';
        this.metaState = { 
            lucidityBank: 0, 
            spentLucidity: 0, // EPIC 3: Track all-time spending for Patient Level
            upgrades: { hp: 0, speed: 0, light: 0 },
            inventory: [], // Array of token objects
            equippedTokens: { head: null, body: null, hands: null, legs: null } 
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
                this.metaState = { ...this.metaState, ...parsed };
                if (!this.metaState.inventory) this.metaState.inventory = [];
                if (!this.metaState.equippedTokens) this.metaState.equippedTokens = { head: null, body: null, hands: null, legs: null };
                if (this.metaState.spentLucidity === undefined) this.metaState.spentLucidity = 0; // Legacy save patch
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
    
    // --- NEW: HARD RESET ---
    wipeSave() {
        try {
            localStorage.removeItem(this.saveKey);
            location.reload(); // Force page refresh to instantly reset the engine
        } catch(e) {
            console.warn("Could not wipe local storage.");
        }
    }

    // --- EPIC 3: GLOBAL PROGRESSION ---
    getPatientLevel() {
        // Gain 1 Level for every 500 Lucidity spent!
        return 1 + Math.floor(this.metaState.spentLucidity / 500);
    }

    buyUpgrade(stat, baseCost) {
        // Exponential cost: baseCost * (1.1 ^ currentLevel)
        const cost = Math.floor(baseCost * Math.pow(1.1, this.metaState.upgrades[stat]));
        
        // Increased max level cap from 50 to 100
        if (this.metaState.lucidityBank >= cost && this.metaState.upgrades[stat] < 100) {
            this.metaState.lucidityBank -= cost;
            this.metaState.spentLucidity += cost; // Progress global level!
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
        this.metaState.spentLucidity += rarityData.costToUpgrade; // Massive bump to Patient Level

        // Promote Rarity
        if (item.rarity === 'COMMON') item.rarity = 'RARE';
        else if (item.rarity === 'RARE') item.rarity = 'EPIC';
        else if (item.rarity === 'EPIC') item.rarity = 'ANOMALOUS';

        this.saveGame();
        return true;
    }
}