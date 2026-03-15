// src/ui/UIManager.js
// Master controller for DOM manipulation, screen transitions, and Epic 2 Loadout Logic.

import { TOKENS, TOKEN_RARITIES, TOKEN_SETS } from '../data/Manifestations.js';

export class UIManager {
    constructor(saveManager, onStartGameCallback) {
        this.saveManager = saveManager;
        this.onStartGameCallback = onStartGameCallback;
        
        this.selectedInventoryItem = null; 
        this.selectedSlotType = null;      
        
        this.bindElements();
        this.attachEvents();
        this.updateMenuUI();
    }

    bindElements() {
        this.mainMenu = document.getElementById('main-menu');
        this.synapseTree = document.getElementById('synapse-tree');
        this.loadoutMenu = document.getElementById('loadout-menu');
        this.uiLayer = document.getElementById('ui-layer');
        this.deathScreen = document.getElementById('death-screen');
        
        this.btnStart = document.getElementById('btn-start');
        this.btnTree = document.getElementById('btn-tree');
        this.btnCloseTree = document.getElementById('btn-close-tree');
        this.btnLoadout = document.getElementById('btn-loadout');
        this.btnCloseLoadout = document.getElementById('btn-close-loadout');
        
        this.btnUpgHp = document.getElementById('btn-upg-hp');
        this.btnUpgSpeed = document.getElementById('btn-upg-speed');
        this.btnUpgLight = document.getElementById('btn-upg-light');
        this.btnWipeSave = document.getElementById('btn-wipe-save'); 

        this.inventoryGrid = document.getElementById('inventory-grid');
        this.detailName = document.getElementById('detail-name');
        this.detailDesc = document.getElementById('detail-desc');
        this.detailSet = document.getElementById('detail-set');
        this.btnEquipItem = document.getElementById('btn-equip-item');
        this.btnUnequipItem = document.getElementById('btn-unequip-item');
        this.btnUpgradeItem = document.getElementById('btn-upgrade-item');

        // EPIC 3: XP Toast Elements
        this.xpToast = document.getElementById('xp-toast');
        this.toastLevel = document.getElementById('toast-level-display');
        this.toastBar = document.getElementById('toast-xp-bar');
        this.toastText = document.getElementById('toast-xp-text');
        this.toastTimer = null;
    }

    // --- NEW: Display the sliding XP notification ---
    showXPToast() {
        if (!this.xpToast) return;
        
        const levelInfo = this.saveManager.getPatientLevelInfo();
        
        this.toastLevel.innerText = `PATIENT LEVEL ${levelInfo.level}`;
        this.toastBar.style.width = `${levelInfo.progressPercent}%`;
        this.toastText.innerText = `${levelInfo.currentXP} / ${levelInfo.nextXP} L Spent`;

        // Slide the toast down
        this.xpToast.style.top = '20px'; 

        // Reset the hide timer every time they click
        if (this.toastTimer) clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            this.xpToast.style.top = '-100px'; 
        }, 2500);
    }

    attachEvents() {
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

        if (this.btnWipeSave) {
            this.btnWipeSave.addEventListener('click', () => {
                const isConfirmed = confirm("WARNING: This will completely erase your clinical file, destroying all tokens, upgrades, and banked lucidity. Do you wish to proceed?");
                if (isConfirmed) {
                    this.saveManager.wipeSave();
                }
            });
        }

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

        this.btnUpgradeItem.addEventListener('click', () => {
            if (this.selectedInventoryItem) {
                if (this.saveManager.upgradeToken(this.selectedInventoryItem)) {
                    this.updateMenuUI(); 
                    this.showXPToast(); // POP UP THE TOAST
                    
                    const invItem = this.saveManager.metaState.inventory.find(i => i.uid === this.selectedInventoryItem);
                    const tokenData = TOKENS[invItem.id];
                    this.selectInventoryItem(invItem, tokenData);
                    this.renderLoadoutUI();
                }
            }
        });

        this.btnUpgHp.addEventListener('click', () => {
            if (this.saveManager.buyUpgrade('hp', 50)) {
                this.updateMenuUI();
                this.showXPToast(); // POP UP THE TOAST
            }
        });
        this.btnUpgSpeed.addEventListener('click', () => {
            if (this.saveManager.buyUpgrade('speed', 75)) {
                this.updateMenuUI();
                this.showXPToast(); // POP UP THE TOAST
            }
        });
        this.btnUpgLight.addEventListener('click', () => {
            if (this.saveManager.buyUpgrade('light', 100)) {
                this.updateMenuUI();
                this.showXPToast(); // POP UP THE TOAST
            }
        });
    }

    updateMenuUI() {
        const meta = this.saveManager.metaState;
        
        // Retrieve exponential level data and update the Main Menu HUD
        const levelInfo = this.saveManager.getPatientLevelInfo();
        const levelDisplay = document.getElementById('patient-level-display');
        const xpBar = document.getElementById('patient-xp-bar');
        const xpText = document.getElementById('patient-xp-text');

        if (levelDisplay) levelDisplay.innerText = `CLINICAL FILE: PATIENT LEVEL ${levelInfo.level}`;
        if (xpBar) xpBar.style.width = `${levelInfo.progressPercent}%`;
        if (xpText) xpText.innerText = `${levelInfo.currentXP} / ${levelInfo.nextXP} L`;

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
            
            // Exponential cost math
            const cost = Math.floor(stat.baseCost * Math.pow(1.1, currentLvl));
            stat.element.innerText = `${cost} L`;
            
            const canAfford = meta.lucidityBank >= cost;
            const isMaxed = currentLvl >= 100;
            
            stat.element.disabled = !canAfford || isMaxed;
            if (isMaxed) stat.element.innerText = "MAX";
        });
    }

    renderLoadoutUI() {
        const meta = this.saveManager.metaState;
        
        ['head', 'body', 'hands', 'legs'].forEach(slotType => {
            const slotEl = document.getElementById(`slot-${slotType}`);
            const equippedUid = meta.equippedTokens[slotType];
            
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
                    slotEl.innerHTML = `${slotType.toUpperCase()}<br>Empty`;
                    slotEl.onclick = null;
                }
            } else {
                let slotName = slotType === 'head' ? 'STATE OF MIND' : (slotType === 'body' ? 'COPING MECHANISM' : (slotType === 'hands' ? 'NERVOUS HABIT' : 'FLIGHT RESPONSE'));
                slotEl.innerHTML = `${slotName}<br>Empty`;
                slotEl.onclick = null;
            }
        });

        this.inventoryGrid.innerHTML = '';
        meta.inventory.forEach(invItem => {
            const isEquipped = Object.values(meta.equippedTokens).includes(invItem.uid);
            if (isEquipped) return;

            const tokenData = TOKENS[invItem.id];
            if (!tokenData) return; 

            const el = document.createElement('div');
            el.className = `inventory-item filled rarity-${invItem.rarity}`;
            el.innerHTML = `<strong>${tokenData.name}</strong><br><small>Lv.${invItem.level}</small>`;
            
            el.onclick = () => this.selectInventoryItem(invItem, tokenData);
            
            this.inventoryGrid.appendChild(el);
        });

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
        const levelInfo = this.saveManager.getPatientLevelInfo();

        this.detailName.innerText = `[${invItem.rarity}] ${tokenData.name} (Lv.${invItem.level})`;
        this.detailName.style.color = rarityData.color;
        
        this.detailDesc.innerText = tokenData.desc;
        this.detailSet.innerText = `Set: ${setData.name} | (2) ${setData['2']} | (4) ${setData['4']}`;

        this.btnEquipItem.style.display = 'block';
        this.btnUnequipItem.style.display = 'none';
        
        if (rarityData.costToUpgrade) {
            this.btnUpgradeItem.style.display = 'block';
            if (levelInfo.level >= 10) {
                this.btnUpgradeItem.innerText = `Upgrade (${rarityData.costToUpgrade} L)`;
                this.btnUpgradeItem.disabled = this.saveManager.metaState.lucidityBank < rarityData.costToUpgrade;
            } else {
                this.btnUpgradeItem.innerText = `Requires Patient Lvl 10`;
                this.btnUpgradeItem.disabled = true;
            }
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
        this.btnUpgradeItem.style.display = 'none'; 
    }
}