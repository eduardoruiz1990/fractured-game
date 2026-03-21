// src/core/SaveManager.js
export class SaveManager {
    constructor() {
        this.saveKey = 'fractured_save_v1';
        this.metaState = { 
            lucidityBank: 0, 
            spentLucidity: 0, 
            // --- ADDED: 'magnet' stat ---
            upgrades: { hp: 0, speed: 0, light: 0, magnet: 0 },
            inventory: [], 
            equippedTokens: { head: null, body: null, hands: null, legs: null },
            maxFloorReached: 1,
            maxBossEncountered: 0
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
                if (!this.metaState.maxFloorReached) this.metaState.maxFloorReached = 1; 
                if (!this.metaState.maxBossEncountered) this.metaState.maxBossEncountered = 0;
                
                // Backwards compatibility for old saves without magnet
                if (this.metaState.upgrades.magnet === undefined) this.metaState.upgrades.magnet = 0;
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

    addLucidity(amount) {
        this.metaState.lucidityBank += amount;
        this.saveGame();
    }

    buyUpgrade(statId, cost) {
        if (this.metaState.lucidityBank >= cost && this.metaState.upgrades[statId] < 100) {
            this.metaState.lucidityBank -= cost;
            this.metaState.spentLucidity += cost;
            this.metaState.upgrades[statId]++;
            this.saveGame();
            return true;
        }
        return false;
    }

    addTokenToInventory(tokenId, rarity) {
        const uniqueId = tokenId + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        this.metaState.inventory.push({
            id: tokenId,
            uid: uniqueId,
            rarity: rarity,
            level: 1
        });
        this.saveGame();
    }

    equipToken(uid, slotType) {
        const item = this.metaState.inventory.find(i => i.uid === uid);
        if (item) {
            this.metaState.equippedTokens[slotType] = uid;
            this.saveGame();
        }
    }

    unequipToken(slotType) {
        this.metaState.equippedTokens[slotType] = null;
        this.saveGame();
    }

    upgradeToken(uid) {
        const item = this.metaState.inventory.find(i => i.uid === uid);
        if (!item) return false;

        const rarityData = {
            'COMMON': { costToUpgrade: 100 },
            'RARE': { costToUpgrade: 300 },
            'EPIC': { costToUpgrade: 1000 },
            'ANOMALOUS': { costToUpgrade: null }
        };

        const cost = rarityData[item.rarity].costToUpgrade;
        if (!cost || this.metaState.lucidityBank < cost) return false;

        this.metaState.lucidityBank -= cost;
        this.metaState.spentLucidity += cost;

        if (item.rarity === 'COMMON') item.rarity = 'RARE';
        else if (item.rarity === 'RARE') item.rarity = 'EPIC';
        else if (item.rarity === 'EPIC') item.rarity = 'ANOMALOUS';

        this.saveGame();
        return true;
    }

    getPatientLevelInfo() {
        const spent = this.metaState.spentLucidity || 0;
        const level = Math.floor(Math.sqrt(spent / 100)) + 1;
        const currentLevelBaseXP = Math.pow(level - 1, 2) * 100;
        const nextLevelBaseXP = Math.pow(level, 2) * 100;
        const xpInCurrentLevel = spent - currentLevelBaseXP;
        const xpRequiredForNext = nextLevelBaseXP - currentLevelBaseXP;
        const progressPercent = Math.min(100, Math.max(0, (xpInCurrentLevel / xpRequiredForNext) * 100));

        return {
            level: level,
            currentXP: xpInCurrentLevel,
            nextXP: xpRequiredForNext,
            progressPercent: progressPercent,
            totalSpent: spent
        };
    }

    wipeSave() {
        this.metaState = { 
            lucidityBank: 0, spentLucidity: 0, 
            upgrades: { hp: 0, speed: 0, light: 0, magnet: 0 },
            inventory: [], equippedTokens: { head: null, body: null, hands: null, legs: null },
            maxFloorReached: 1, maxBossEncountered: 0
        };
        this.saveGame();
        window.location.reload();
    }
}