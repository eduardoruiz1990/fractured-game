// src/core/SaveManager.js
export class SaveManager {
    constructor() {
        this.metaState = {
            lucidityBank: 0,
            spentLucidity: 0,
            upgrades: { hp: 0, speed: 0, light: 0, magnet: 0 },
            // Patch 29.3: Synapse Tree scaffolding. treeNodes is the list of purchased
            // node ids. legacyUpgrades is intentionally NOT defaulted here — it's a
            // frozen snapshot of pre-tree upgrade LEVELS (see _migrateMetaState below),
            // and it must still read as undefined right up until that snapshot runs, or
            // an existing save's real upgrade progress (e.g. hp level 30) would be
            // masked by this default surviving the loadGame()/importSave() merge and
            // silently snapshot as all-zero instead.
            treeNodes: [],
            inventory: [],
            equippedTokens: { head: null, body: null, hands: null, legs: null },
            maxFloorReached: 1,
            maxBossEncountered: 0,
            hasEscapedFloor1: false,
            selectedCurses: [],
            killCounts: { SCAVENGER: 0, PREDATOR: 0, PARASITE: 0, BOSS: 0, RORSCHACH: 0, PANOPTICON: 0, AMALGAMATION: 0, ARCHITECT: 0 }
        };
        this.loadGame();
        // Runs even when loadGame() found nothing in localStorage (a truly fresh
        // save), so a brand-new player still gets a real (all-zero) legacyUpgrades
        // snapshot immediately, rather than leaving it undefined until their first
        // save/load round-trip.
        this._migrateMetaState();
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
                if (this.metaState.tutorialCompleted === undefined) this.metaState.tutorialCompleted = false;
                if (this.metaState.hasEscapedFloor1 === undefined) this.metaState.hasEscapedFloor1 = false;
                if (!this.metaState.selectedCurses) this.metaState.selectedCurses = [];

                if (!this.metaState.killCounts) {
                    this.metaState.killCounts = { SCAVENGER: 0, PREDATOR: 0, PARASITE: 0, BOSS: 0, RORSCHACH: 0, PANOPTICON: 0, AMALGAMATION: 0, ARCHITECT: 0 };
                }
            }
        } catch(e) {
            console.warn("Local storage disabled or blocked.");
        }
    }

    // Patch 29.3: back-fills treeNodes and takes a ONE-TIME snapshot of pre-tree
    // upgrade levels into legacyUpgrades, guarded on legacyUpgrades === undefined
    // so re-running this on an already-migrated save is a no-op. Deliberately does
    // NOT touch spentLucidity and does NOT convert legacy levels into purchased
    // tree nodes — a legacy hp level of 30 represents real spent Lucidity and would
    // lose power if silently translated into tree-node ownership instead. Called
    // unconditionally from the constructor (covers both the loadGame() merge path
    // AND a truly fresh save with nothing in localStorage) and again from
    // importSave(), so an imported pre-tree export gets the same migration.
    _migrateMetaState() {
        if (!this.metaState.treeNodes) this.metaState.treeNodes = [];
        if (this.metaState.legacyUpgrades === undefined) {
            this.metaState.legacyUpgrades = { ...this.metaState.upgrades };
        }
    }

    saveGame() {
        try {
            localStorage.setItem('fractured_meta', JSON.stringify(this.metaState));
        } catch(e) {
            console.warn("Failed to save game data.");
        }
    }

    // DEV: build-diversity logger (Patch 14). Deliberately a SEPARATE localStorage
    // key from 'fractured_meta' — this is throwaway dev telemetry, not part of the
    // save file, and must never round-trip through exportSave/importSave.
    logRunBuild(buildData) {
        try {
            const key = 'fractured_build_log';
            const log = JSON.parse(localStorage.getItem(key) || '[]');
            log.push({ ...buildData, loggedAt: Date.now() });
            const MAX_ENTRIES = 20;
            while (log.length > MAX_ENTRIES) log.shift();
            localStorage.setItem(key, JSON.stringify(log));
        } catch(e) {
            console.warn("Failed to log run build.", e);
        }
    }

    getRunBuildLog() {
        try {
            return JSON.parse(localStorage.getItem('fractured_build_log') || '[]');
        } catch(e) {
            return [];
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
                if (!this.metaState.treeNodes) this.metaState.treeNodes = [];

                // Deliberately NOT _migrateMetaState() here — that helper guards on
                // this.metaState.legacyUpgrades === undefined, which is only a safe
                // check right after this SaveManager's OWN one-time construction. An
                // import REPLACES the save wholesale and can happen on an instance
                // that already has a legacyUpgrades value sitting there (even a stale
                // fresh-profile zero default) — that guard would then never fire, and
                // an old-format import's real upgrade levels would get masked instead
                // of snapshotted. Derive from the IMPORTED data specifically instead.
                if (parsed.legacyUpgrades === undefined) {
                    this.metaState.legacyUpgrades = { ...(parsed.upgrades || this.metaState.upgrades) };
                }

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

    markFirstEscape() {
        if (!this.metaState.hasEscapedFloor1) {
            this.metaState.hasEscapedFloor1 = true;
            this.saveGame();
        }
    }

    toggleCurse(curseId) {
        if (!this.metaState.selectedCurses) this.metaState.selectedCurses = [];
        const idx = this.metaState.selectedCurses.indexOf(curseId);
        if (idx === -1) this.metaState.selectedCurses.push(curseId);
        else this.metaState.selectedCurses.splice(idx, 1);
        this.saveGame();
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
            hasEscapedFloor1: false,
            selectedCurses: [],
            killCounts: { SCAVENGER: 0, PREDATOR: 0, PARASITE: 0, BOSS: 0, RORSCHACH: 0, PANOPTICON: 0, AMALGAMATION: 0, ARCHITECT: 0 }
        };
        this.saveGame();
        window.location.reload();
    }
}