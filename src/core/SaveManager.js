// src/core/SaveManager.js
import { SYNAPSE_NODES_BY_ID } from '../data/SynapseNodes.js';
import { TOKENS, TOKEN_SETS, TOKEN_RARITIES, TOKEN_SLOT_TYPES, INTRUSIVE_THOUGHTS } from '../data/Manifestations.js';
// Patch 47a: 'fractured_meta' reads/writes route through the portal adapter, which
// uses the host's cloud-save backend when one exists and plain localStorage when it
// does not. Off-portal this is exactly the previous localStorage behaviour.
import { portalSDK } from '../systems/PortalSDK.js';

// Patch 31: built from TOKEN_SLOT_TYPES so the equippedTokens shape has ONE source
// of truth. §2 of the handoff listed five hardcoded copies of the old 4-slot shape;
// the three inside this file now derive from here instead of repeating a literal.
function emptyEquippedTokens() {
    return TOKEN_SLOT_TYPES.reduce((acc, slot) => { acc[slot] = null; return acc; }, {});
}

// Patch 29.4: legacy "level" units <-> native stat-delta units, mirroring
// Game.js's own formulas exactly (maxSanity: +20/lvl, speedBuff: +5%/lvl,
// lightBuff: +10%/lvl) and Combat.js's magnet (+30px/lvl). This is the same
// mapping the Synapse Tree's hard constraint (tree effects on these four stats
// are exact integer multiples of these steps) is built to stay compatible with.
const LEGACY_STEP = { sanity: 20, speed: 5, light: 10, magnet: 30 };

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
            equippedTokens: emptyEquippedTokens(),
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
        // Self-healing: always re-derive metaState.upgrades from legacyUpgrades +
        // treeNodes on load, rather than trusting whatever was last persisted. For
        // a freshly-migrated legacy save (treeNodes still empty) this reproduces
        // the exact same numbers the old flat upgrades held — not a save (no
        // purchase happened), just an in-memory refresh.
        this._recomputeUpgradeMirror();
    }

    loadGame() {
        try {
            const saved = portalSDK.getItem('fractured_meta');
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
                // Patch 31: per-slot back-fill, not just a whole-object fallback. A
                // pre-31 save HAS equippedTokens but is missing the new 'prescription'
                // key entirely, so the old `if (!equippedTokens)` guard would skip it
                // and leave that slot undefined rather than null.
                if (!this.metaState.equippedTokens) this.metaState.equippedTokens = emptyEquippedTokens();
                TOKEN_SLOT_TYPES.forEach(slot => {
                    if (this.metaState.equippedTokens[slot] === undefined) this.metaState.equippedTokens[slot] = null;
                });
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
            portalSDK.setItem('fractured_meta', JSON.stringify(this.metaState));
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

                // Patch 31: the spread above replaces equippedTokens WHOLESALE, so a
                // pre-31 export (4 keys, no 'prescription') would leave that slot
                // undefined no matter what this instance held before the import.
                if (!this.metaState.equippedTokens) this.metaState.equippedTokens = emptyEquippedTokens();
                TOKEN_SLOT_TYPES.forEach(slot => {
                    if (this.metaState.equippedTokens[slot] === undefined) this.metaState.equippedTokens[slot] = null;
                });

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
                this._recomputeUpgradeMirror();

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

    // Patch 32: the unlock gate previously lived ONLY in UIManager.renderCurseSelection
    // (it simply never rendered an ADOPT button while locked) — toggleCurse itself had
    // no check, so anything else calling it (a bug, a dev-console slip) could adopt a
    // curse before Patient Level 5 + a boss kill. Keep clause is "keep the gate", so
    // making it authoritative here, not just trusted-from-the-UI, is a strengthening of
    // that guarantee, not a change to its threshold. Revoking an already-adopted curse
    // is always allowed regardless of gate state, same as before.
    isCurseUnlocked() {
        const patientLevel = this.getPatientLevelInfo().level;
        const bossKills = (this.metaState.killCounts && this.metaState.killCounts.BOSS) || 0;
        return patientLevel >= 5 && bossKills > 0;
    }

    toggleCurse(curseId) {
        if (!this.metaState.selectedCurses) this.metaState.selectedCurses = [];
        const idx = this.metaState.selectedCurses.indexOf(curseId);
        if (idx === -1) {
            if (!INTRUSIVE_THOUGHTS[curseId]) return false; // unknown id
            if (!this.isCurseUnlocked()) return false;
            this.metaState.selectedCurses.push(curseId);
        } else {
            this.metaState.selectedCurses.splice(idx, 1);
        }
        this.saveGame();
        return true;
    }

    // Patch 32: cumulative Lucidity bonus from stacked curses, weighted per curse
    // (the risk ladder) instead of the flat 15%-per-curse rate this used to be.
    // Mirrors getResolvedUpgrades()/getResolvedTokenEffects()'s shape so a future
    // consumer merges it the same way. totalPct is also exposed pre-computed since
    // that's the one number every current display site (curse-status-line,
    // per-curse card, run-end banking) actually needs.
    //
    // Patch 32b: optional curseList override. Default (metaState.selectedCurses) is
    // what the pre-run menu (UIManager) wants — the player's adopted set. Game.js's
    // in-run multiplier instead passes state.player.curses, which can include curses
    // a token grants on top of the adopted set (Game.js's `tokenData.curses` path) —
    // reading metaState.selectedCurses there would silently under-count a token-
    // granted curse's payout.
    getResolvedCurseBonus(curseList) {
        const selected = curseList || this.metaState.selectedCurses || [];
        let totalPct = 0;
        const weights = {};
        for (const curseId of selected) {
            const curse = INTRUSIVE_THOUGHTS[curseId];
            if (!curse) continue; // stale id from an older build — ignore, don't throw
            const weight = curse.lucidityWeight || 0;
            weights[curseId] = weight;
            totalPct += weight;
        }
        return { totalPct, weights };
    }

    addLucidity(amount) {
        this.metaState.lucidityBank += amount;
        this.saveGame();
    }

    // uid was previously Date.now() + a 0-999 random suffix — fine for one drop at
    // a time in real play, but a real collision risk for any caller invoking this
    // in a tight loop (e.g. a dev tool granting several tokens at once): with ~16
    // calls sharing the same millisecond and only 1000 random buckets, the
    // birthday-paradox collision chance is real, not theoretical, and a uid
    // collision corrupts equip/inventory lookups (two items answering to the same
    // id). An always-incrementing counter makes every uid unique regardless of
    // call frequency, with no behavior change for the normal one-at-a-time case.
    addTokenToInventory(tokenId, rarity) {
        this._tokenUidCounter = (this._tokenUidCounter || 0) + 1;
        const uid = `token_${Date.now()}_${this._tokenUidCounter}`;
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

    // Patch 29.4: cost curve now scales off legacyUpgrades (the legacy track's own
    // level counter) instead of metaState.upgrades directly — upgrades is now a
    // derived mirror (see _recomputeUpgradeMirror below), and scaling this curve
    // off the mirror would make the price creep every time a Synapse Tree node
    // happened to touch the same stat, coupling two tracks that are meant to be
    // independent. Externally unchanged: same params, same 1.1^lvl curve, same
    // 100-level cap, still self-saves.
    buyUpgrade(upgradeId, baseCost) {
        const currentLvl = this.metaState.legacyUpgrades[upgradeId] || 0;
        if (currentLvl >= 100) return false;

        const cost = Math.floor(baseCost * Math.pow(1.1, currentLvl));
        if (this.metaState.lucidityBank >= cost) {
            this.metaState.lucidityBank -= cost;
            this.metaState.spentLucidity += cost;
            this.metaState.legacyUpgrades[upgradeId] = currentLvl + 1;
            this._recomputeUpgradeMirror();
            this.saveGame();
            return true;
        }
        return false;
    }

    // Resolver total = legacyUpgrades (frozen pre-tree progress, converted from
    // level units into native stat-delta units) + every owned tree node's effects.
    // Deliberately never reads metaState.upgrades — that field is a DERIVED OUTPUT
    // of this method (see _recomputeUpgradeMirror), not an input; reading it here
    // would double-count whatever it already mirrored from a previous resolve.
    // grants is a Set so discrete unlocks (e.g. 'denial_recharge') can never be
    // accidentally summed as if they were numeric deltas.
    getResolvedUpgrades() {
        const legacy = this.metaState.legacyUpgrades || { hp: 0, speed: 0, light: 0, magnet: 0 };
        const stats = {
            sanity: legacy.hp * LEGACY_STEP.sanity,
            speed: legacy.speed * LEGACY_STEP.speed,
            light: legacy.light * LEGACY_STEP.light,
            magnet: legacy.magnet * LEGACY_STEP.magnet,
            iframes: 0,
            flashlightAngle: 0,
            tagDamage: {},
            lucidityGain: 0,
            tokenDropRate: 0,
            dashCooldown: 0,
            dashDuration: 0,
            rerollCost: 0
        };
        const grants = new Set();

        const owned = this.metaState.treeNodes || [];
        for (const nodeId of owned) {
            const node = SYNAPSE_NODES_BY_ID[nodeId];
            if (!node) continue; // unknown/stale id — ignore rather than throw
            for (const [key, value] of Object.entries(node.effects)) {
                if (key === 'grant') {
                    grants.add(value);
                } else if (key === 'tagDamage') {
                    for (const [tag, amt] of Object.entries(value)) {
                        stats.tagDamage[tag] = (stats.tagDamage[tag] || 0) + amt;
                    }
                } else {
                    stats[key] = (stats[key] || 0) + value;
                }
            }
        }

        return { stats, grants };
    }

    // Patch 31: resolves every equipped token + earned set bonus into the SAME
    // { stats, grants } shape getResolvedUpgrades() returns, so a consumer can merge
    // the two bundles without translating between vocabularies. Also returns
    // setCounts so the loadout UI can show 2/4 progress without recomputing it.
    //
    // Rarity multiplier: TOKEN_RARITIES.multiplier was dead data before this patch
    // (confirmed in Patch 27 — nothing read it). It is now applied to a token's
    // POSITIVE numeric effects only, so forging a token is always strictly an
    // upgrade and never amplifies its own drawback. Set bonuses are never scaled —
    // they come from the set, not from any one token's rarity.
    getResolvedTokenEffects() {
        const stats = {
            sanity: 0, speed: 0, light: 0, magnet: 0, iframes: 0,
            flashlightAngle: 0, tagDamage: {}, lucidityGain: 0,
            dashCooldown: 0, dashDuration: 0
        };
        const grants = new Set();
        const setCounts = {};

        const apply = (effects, mult) => {
            for (const [key, value] of Object.entries(effects || {})) {
                if (key === 'grant') {
                    grants.add(value);
                } else if (key === 'tagDamage') {
                    for (const [tag, amt] of Object.entries(value)) {
                        const scaled = amt > 0 ? amt * mult : amt;
                        stats.tagDamage[tag] = (stats.tagDamage[tag] || 0) + scaled;
                    }
                } else {
                    stats[key] = (stats[key] || 0) + (value > 0 ? value * mult : value);
                }
            }
        };

        const equipped = this.metaState.equippedTokens || {};
        const inventory = this.metaState.inventory || [];
        for (const uid of Object.values(equipped)) {
            if (!uid) continue;
            const invItem = inventory.find(i => i.uid === uid);
            if (!invItem) continue;
            const tokenData = TOKENS[invItem.id];
            if (!tokenData) continue; // stale id from an older build — ignore, don't throw

            setCounts[tokenData.set] = (setCounts[tokenData.set] || 0) + 1;
            const rarity = TOKEN_RARITIES[invItem.rarity];
            apply(tokenData.effects, (rarity && rarity.multiplier) || 1.0);
        }

        for (const [setKey, count] of Object.entries(setCounts)) {
            const setData = TOKEN_SETS[setKey];
            if (!setData || !setData.bonuses) continue;
            if (count >= 2) apply(setData.bonuses[2], 1.0);
            if (count >= 4) apply(setData.bonuses[4], 1.0);
        }

        return { stats, grants, setCounts };
    }

    // Writes metaState.upgrades as a PURE DERIVED MIRROR of getResolvedUpgrades(),
    // converted back from native stat-delta units into legacy LEVEL units, so
    // readers that predate the tree (e.g. Combat.js's magnet lookup) keep working
    // unmodified regardless of whether a given point of "level" came from
    // legacyUpgrades or from a tree node. Division is always exact — the tree's
    // hard constraint guarantees every contribution to these four stats is an
    // integer multiple of its legacy step.
    _recomputeUpgradeMirror() {
        const { stats } = this.getResolvedUpgrades();
        this.metaState.upgrades = {
            hp: stats.sanity / LEGACY_STEP.sanity,
            speed: stats.speed / LEGACY_STEP.speed,
            light: stats.light / LEGACY_STEP.light,
            magnet: stats.magnet / LEGACY_STEP.magnet
        };
    }

    // Patch 29.4: purchase a Synapse Tree node. Validates ownership (no
    // double-buy), requires (AND by default; requireMode:'any' + requireCount for
    // the 3 capstones), minPatientLevel, and bank — in that order, so a failed
    // check never has side effects.
    buyNode(nodeId) {
        const node = SYNAPSE_NODES_BY_ID[nodeId];
        if (!node) return false;

        const owned = this.metaState.treeNodes || (this.metaState.treeNodes = []);
        if (owned.includes(nodeId)) return false;

        const neededCount = node.requireMode === 'any' ? (node.requireCount || 1) : node.requires.length;
        const satisfiedCount = node.requires.filter(r => owned.includes(r)).length;
        if (satisfiedCount < neededCount) return false;

        if (node.minPatientLevel !== null && node.minPatientLevel !== undefined) {
            if (this.getPatientLevelInfo().level < node.minPatientLevel) return false;
        }

        if (this.metaState.lucidityBank < node.cost) return false;

        this.metaState.lucidityBank -= node.cost;
        this.metaState.spentLucidity += node.cost;
        owned.push(nodeId);
        this._recomputeUpgradeMirror();
        this.saveGame();
        return true;
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
            inventory: [], equippedTokens: emptyEquippedTokens(),
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