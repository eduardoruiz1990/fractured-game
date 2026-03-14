// src/ui/UIManager.js
// Master controller for DOM manipulation, screen transitions, and Epic 2 Loadout Logic.

import { TOKENS, TOKEN_RARITIES, TOKEN_SETS } from '../data/Manifestations.js';

export class UIManager {
    constructor(saveManager, onStartGameCallback) {
        this.saveManager = saveManager;
        this.onStartGameCallback = onStartGameCallback;
        
        // Epic 2 Loadout State
        this.selectedInventoryItem = null; // UID of selected item
        this.selectedSlotType = null;      // 'head', 'body', etc.
        
        this.bindElements();
        this.attachEvents();
        this.updateMenuUI();
    }

    bindElements() {
        // Screens
        this.mainMenu = document.getElementById('main-menu');
        this.synapseTree = document.getElementById('synapse-tree');
        this.loadoutMenu = document.getElementById('loadout-menu');
        this.uiLayer = document.getElementById('ui-layer');
        this.deathScreen = document.getElementById('death-screen');
        
        // Main Menu Buttons
        this.btnStart = document.getElementById('btn-start');
        this.btnTree = document.getElementById('btn-tree');
        this.btnCloseTree = document.getElementById('btn-close-tree');
        this.btnLoadout = document.getElementById('btn-loadout');
        this.btnCloseLoadout = document.getElementById('btn-close-loadout');
        
        // Upgrade Buttons
        this.btnUpgHp = document.getElementById('btn-upg-hp');
        this.btnUpgSpeed = document.getElementById('btn-upg-speed');
        this.btnUpgLight = document.getElementById('btn-upg-light');

        // Loadout Panel Elements
        this.inventoryGrid = document.getElementById('inventory-grid');
        this.detailName = document.getElementById('detail-name');
        this.detailDesc = document.getElementById('detail-desc');
        this.detailSet = document.getElementById('detail-set');
        this.btnEquipItem = document.getElementById('btn-equip-item');
        this.btnUnequipItem = document.getElementById('btn-unequip-item');
        this.btnUpgradeItem = document.getElementById('btn-upgrade-item');
    }

    attachEvents() {
        // Main Menu Navigation
        this.btnStart.addEventListener('click', () => {
            this.mainMenu.style.display = 'none';
            this.uiLayer.style.display = 'flex';
            if (this.onStartGameCallback) this.onStartGameCallback();
        });

        this.btnTree.addEventListener('click', () => {
            this.mainMenu.style.display = 'none';
            this.synapseTree.style.display = 'flex';
            this.updateMenuUI();
        });

        this.btnCloseTree.addEventListener('click', () => {
            this.synapseTree.style.display = 'none';
            this.mainMenu.style.display = 'flex';
            this.updateMenuUI();
        });

        // --- LOADOUT MENU NAVIGATION ---
        this.btnLoadout.addEventListener('click', () => {
            this.mainMenu.style.display = 'none';
            this.loadoutMenu.style.display = 'flex';
            this.selectedInventoryItem = null;
            this.selectedSlotType = null;
            this.renderLoadoutUI();
        });

        this.btnCloseLoadout.addEventListener('click', () => {
            this.loadoutMenu.style.display = 'none';
            this.mainMenu.style.display = 'flex';
            this.updateMenuUI();
        });

        // Equipment Actions
        this.btnEquipItem.addEventListener('click', () => {
            if (this.selectedInventoryItem) {
                const invItem = this.saveManager.metaState.inventory.find(i => i.uid === this.selectedInventoryItem);
                if (invItem) {
                    const tokenData = TOKENS[invItem.id];
                    this.saveManager.equipToken(invItem.uid, tokenData.type);
                    this.renderLoadoutUI();
                }
            }
        });

        this.btnUnequipItem.addEventListener('click', () => {
            if (this.selectedSlotType) {
                this.saveManager.unequipToken(this.selectedSlotType);
                this.renderLoadoutUI();
            }
        });

        // Synapse Tree Purchases
        this.btnUpgHp.addEventListener('click', () => {
            if (this.saveManager.buyUpgrade('hp', 50)) this.updateMenuUI();
        });
        this.btnUpgSpeed.addEventListener('click', () => {
            if (this.saveManager.buyUpgrade('speed', 75)) this.updateMenuUI();
        });
        this.btnUpgLight.addEventListener('click', () => {
            if (this.saveManager.buyUpgrade('light', 100)) this.updateMenuUI();
        });
    }

    updateMenuUI() {
        const meta = this.saveManager.metaState;
        
        document.getElementById('menu-banked-lucidity').innerText = meta.lucidityBank;
        document.getElementById('tree-lucidity').innerText = meta.lucidityBank;
        
        const upgradeStats = [
            { id: 'hp', baseCost: 50, element: this.btnUpgHp },
            { id: 'speed', baseCost: 75, element: this.btnUpgSpeed },
            { id: 'light', baseCost: 100, element: this.btnUpgLight }
        ];

        upgradeStats.forEach(stat => {
            const currentLvl = meta.upgrades[stat.id];
            document.getElementById(`upg-${stat.id}-lvl`).innerText = currentLvl;
            
            const cost = stat.baseCost + (currentLvl * 25);
            stat.element.innerText = `${cost} L`;
            
            const canAfford = meta.lucidityBank >= cost;
            const isMaxed = currentLvl >= 5;
            
            stat.element.disabled = !canAfford || isMaxed;
            if (isMaxed) stat.element.innerText = "MAX";
        });
    }

    // --- EPIC 2: LOADOUT RENDERING ---

    renderLoadoutUI() {
        const meta = this.saveManager.metaState;
        
        // 1. Render Equipped Slots
        ['head', 'body', 'hands', 'legs'].forEach(slotType => {
            const slotEl = document.getElementById(`slot-${slotType}`);
            const equippedUid = meta.equippedTokens[slotType];
            
            // Clear old classes
            slotEl.className = 'token-slot';
            
            if (equippedUid) {
                const invItem = meta.inventory.find(i => i.uid === equippedUid);
                if (invItem) {
                    const tokenData = TOKENS[invItem.id];
                    slotEl.innerHTML = `<strong>${tokenData.name}</strong><br><small>Lv.${invItem.level}</small>`;
                    slotEl.classList.add('filled');
                    slotEl.classList.add(`rarity-${invItem.rarity}`);
                    
                    slotEl.onclick = () => this.selectEquippedSlot(slotType, invItem);
                } else {
                    // Fallback if data is corrupted
                    slotEl.innerHTML = `${slotType.toUpperCase()}<br>Empty`;
                    slotEl.onclick = null;
                }
            } else {
                let slotName = slotType === 'head' ? 'STATE OF MIND' : (slotType === 'body' ? 'COPING MECHANISM' : (slotType === 'hands' ? 'NERVOUS HABIT' : 'FLIGHT RESPONSE'));
                slotEl.innerHTML = `${slotName}<br>Empty`;
                slotEl.onclick = null;
            }
        });

        // 2. Render Inventory Grid
        this.inventoryGrid.innerHTML = '';
        meta.inventory.forEach(invItem => {
            // Don't show items that are currently equipped in the inventory grid to avoid confusion
            const isEquipped = Object.values(meta.equippedTokens).includes(invItem.uid);
            if (isEquipped) return;

            const tokenData = TOKENS[invItem.id];
            if (!tokenData) return; // Safety check

            const el = document.createElement('div');
            el.className = `inventory-item filled rarity-${invItem.rarity}`;
            el.innerHTML = `<strong>${tokenData.name}</strong><br><small>Lv.${invItem.level}</small>`;
            
            el.onclick = () => this.selectInventoryItem(invItem, tokenData);
            
            this.inventoryGrid.appendChild(el);
        });

        // 3. Clear Details Panel
        this.detailName.innerText = "Select a Token";
        this.detailDesc.innerText = "Configure your fractured mind before descending.";
        this.detailSet.innerText = "";
        this.btnEquipItem.style.display = 'none';
        this.btnUnequipItem.style.display = 'none';
        this.btnUpgradeItem.style.display = 'none';
    }

    selectInventoryItem(invItem, tokenData) {
        this.selectedInventoryItem = invItem.uid;
        this.selectedSlotType = null;
        
        const rarityData = TOKEN_RARITIES[invItem.rarity];
        const setData = TOKEN_SETS[tokenData.set];

        this.detailName.innerText = `[${invItem.rarity}] ${tokenData.name} (Lv.${invItem.level})`;
        this.detailName.style.color = rarityData.color;
        
        this.detailDesc.innerText = tokenData.desc;
        this.detailSet.innerText = `Set: ${setData.name} | (2) ${setData['2']} | (4) ${setData['4']}`;

        this.btnEquipItem.style.display = 'block';
        this.btnUnequipItem.style.display = 'none';
        
        // Setup Upgrade Button (Future feature placeholder)
        if (rarityData.costToUpgrade) {
            this.btnUpgradeItem.style.display = 'block';
            this.btnUpgradeItem.innerText = `Upgrade (${rarityData.costToUpgrade} L)`;
            this.btnUpgradeItem.disabled = this.saveManager.metaState.lucidityBank < rarityData.costToUpgrade;
        } else {
            this.btnUpgradeItem.style.display = 'none';
        }
    }

    selectEquippedSlot(slotType, invItem) {
        this.selectedSlotType = slotType;
        this.selectedInventoryItem = null;

        const tokenData = TOKENS[invItem.id];
        const rarityData = TOKEN_RARITIES[invItem.rarity];
        const setData = TOKEN_SETS[tokenData.set];

        this.detailName.innerText = `[${invItem.rarity}] ${tokenData.name} (Lv.${invItem.level})`;
        this.detailName.style.color = rarityData.color;
        
        this.detailDesc.innerText = tokenData.desc;
        this.detailSet.innerText = `Set: ${setData.name} | (2) ${setData['2']} | (4) ${setData['4']}`;

        this.btnEquipItem.style.display = 'none';
        this.btnUnequipItem.style.display = 'block';
        this.btnUpgradeItem.style.display = 'none'; // Only allow upgrading from inventory to prevent edge cases
    }
}