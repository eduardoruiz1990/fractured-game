// src/core/SaveManager.js
export class SaveManager {
    constructor() {
        this.metaState = { 
            lucidityBank: 0,
            spentLucidity: 0, 
            upgrades: { hp: 0, speed: 0, light: 0, magnet: 0 },
            inventory: [], 
            equippedTokens: { head: null, body: null, hands: null, legs: null },
            maxFloorReached: 1,
            maxBossEncountered: 0,
            killCounts: { SCAVENGER: 0, PREDATOR: 0, PARASITE: 0, BOSS: 0, RORSCHACH: 0, PANOPTICON: 0, AMALGAMATION: 0, ARCHITECT: 0 }
        };
        this.loadGame();
    }

    loadGame() {
        try {
            const saved = localStorage.getItem('fractured_meta');
            if (saved) {
                const parsed = JSON.parse(saved);
                this.metaState = { ...this.metaState, ...parsed };
                
                // CRITICAL FIX: Robust fallback for older save files missing specific upgrades
                if (!this.metaState.upgrades) {
                    this.metaState.upgrades = { hp: 0, speed: 0, light: 0, magnet: 0 };
                } else {
                    if (this.metaState.upgrades.hp === undefined) this.metaState.upgrades.hp = 0;
                    if (this.metaState.upgrades.speed === undefined) this.metaState.upgrades.speed = 0;
                    if (this.metaState.upgrades.light === undefined) this.metaState.upgrades.light = 0;
                    if (this.metaState.upgrades.magnet === undefined) this.metaState.upgrades.magnet = 0;
                }

                if (!this.metaState.inventory) this.metaState.inventory = [];
                if (!this.metaState.equippedTokens) this.metaState.equippedTokens = { head: null, body: null, hands: null, legs: null };
                if (!this.metaState.maxFloorReached) this.metaState.maxFloorReached = 1; 
                if (!this.metaState.maxBossEncountered) this.metaState.maxBossEncountered = 0;
                
                if (!this.metaState.killCounts) {
                    this.metaState.killCounts = { SCAVENGER: 0, PREDATOR: 0, PARASITE: 0, BOSS: 0, RORSCHACH: 0, PANOPTICON: 0, AMALGAMATION: 0, ARCHITECT: 0 };
                }
            }
        } catch(e) { 
            console.warn("Local storage disabled or blocked."); 
        }
    }

    saveGame() {
        try {
            localStorage.setItem('fractured_meta', JSON.stringify(this.metaState));
        } catch(e) {
            console.warn("Failed to save game data.");
        }
    }

    exportSave() {
        try {
            return btoa(JSON.stringify(this.metaState));
        } catch(e) {
            console.warn("Failed to export save data.", e);
            return null;
        }
    }

    importSave(base64String) {
        try {
            const parsed = JSON.parse(atob(base64String));
            if (parsed && typeof parsed === 'object') {
                this.metaState = { ...this.metaState, ...parsed };
                this.saveGame();
                return true;
            }
            return false;
        } catch(e) {
            console.warn("Failed to import save data.", e);
            return false;
        }
    }

    recordKill(type) {
        if (!this.metaState.killCounts) {
            this.metaState.killCounts = { SCAVENGER: 0, PREDATOR: 0, PARASITE: 0, BOSS: 0, RORSCHACH: 0, PANOPTICON: 0, AMALGAMATION: 0, ARCHITECT: 0 };
        }
        if (this.metaState.killCounts[type] !== undefined) {
            this.metaState.killCounts[type]++;
        }
    }

    addLucidity(amount) {
        this.metaState.lucidityBank += amount;
        this.saveGame();
    }

    addTokenToInventory(tokenId, rarity) {
        const uid = `token_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        this.metaState.inventory.push({ uid: uid, id: tokenId, rarity: rarity, level: 1 });
        this.saveGame();
    }

    equipToken(uid, slotType) {
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

        let cost = 0;
        if (item.rarity === 'common') cost = 100;
        else if (item.rarity === 'rare') cost = 250;
        else if (item.rarity === 'epic') cost = 500;
        else if (item.rarity === 'legendary') cost = 1000;
        else return false; 

        if (this.metaState.lucidityBank >= cost) {
            this.metaState.lucidityBank -= cost;
            this.metaState.spentLucidity += cost; 
            
            if (item.rarity === 'common') item.rarity = 'rare';
            else if (item.rarity === 'rare') item.rarity = 'epic';
            else if (item.rarity === 'epic') item.rarity = 'legendary';
            else if (item.rarity === 'legendary') item.rarity = 'mythic';
            
            item.level++;
            this.saveGame();
            return true;
        }
        return false;
    }

    buyUpgrade(upgradeId, baseCost) {
        const currentLvl = this.metaState.upgrades[upgradeId] || 0;
        if (currentLvl >= 100) return false; 

        const cost = Math.floor(baseCost * Math.pow(1.1, currentLvl));
        if (this.metaState.lucidityBank >= cost) {
            this.metaState.lucidityBank -= cost;
            this.metaState.spentLucidity += cost;
            this.metaState.upgrades[upgradeId] = currentLvl + 1;
            this.saveGame();
            return true;
        }
        return false;
    }

    getPatientLevelInfo() {
        const spent = this.metaState.spentLucidity || 0;
        const level = Math.floor(Math.sqrt(spent / 500)) + 1;
        const currentLevelBaseXP = Math.pow(level - 1, 2) * 500;
        const nextLevelBaseXP = Math.pow(level, 2) * 500;
        const xpIntoLevel = spent - currentLevelBaseXP;
        const xpRequiredForNext = nextLevelBaseXP - currentLevelBaseXP;
        const progressPercent = (xpIntoLevel / xpRequiredForNext) * 100;

        return {
            level: level,
            currentXP: spent,
            nextXP: nextLevelBaseXP,
            progressPercent: progressPercent,
            totalSpent: spent
        };
    }

    wipeSave() {
        this.metaState = { 
            lucidityBank: 0, spentLucidity: 0, 
            upgrades: { hp: 0, speed: 0, light: 0, magnet: 0 },
            inventory: [], equippedTokens: { head: null, body: null, hands: null, legs: null },
            maxFloorReached: 1, maxBossEncountered: 0,
            tutorialCompleted: false,
            killCounts: { SCAVENGER: 0, PREDATOR: 0, PARASITE: 0, BOSS: 0, RORSCHACH: 0, PANOPTICON: 0, AMALGAMATION: 0, ARCHITECT: 0 }
        };
        this.saveGame();
        window.location.reload();
    }
}