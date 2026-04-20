// src/ui/UIManager.js
import { TOKENS, TOKEN_RARITIES, TOKEN_SETS } from '../data/Manifestations.js';

export class UIManager {
    constructor(saveManager, audioEngine, onStartGameCallback) {
        this.saveManager = saveManager;
        this.audioEngine = audioEngine;
        this.onStartGameCallback = onStartGameCallback;
        
        this.selectedInventoryItem = null; 
        this.selectedSlotType = null;      
        
        this.bindElements();
        this.attachEvents();
        this.updateMenuUI();

        // Listen for EventBus achievements
        document.addEventListener('game_initialized', (e) => {
            const game = e.detail.game;
            if (game && game.eventBus) {
                game.eventBus.on('enemy_killed', () => {
                    const kills = Object.values(game.state.killCounts).reduce((a, b) => a + b, 0);
                    if (kills === 100) {
                        this.showAchievement("ACHIEVEMENT: CULL THE HERD");
                    }
                });
            }
        });
    }

    showAchievement(text) {
        if (!this.xpToast) return;
        
        this.xpToast.style.top = '30px'; 
        this.xpToast.style.backgroundColor = '#ffd700';
        this.xpToast.style.color = '#000';
        
        setTimeout(() => {
            this.toastLevel.innerText = text;
            this.toastBar.style.width = `100%`;
            this.toastText.innerText = "Congratulations!";
        }, 150);

        if (this.toastTimer) clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            this.xpToast.style.top = '-150px'; 
            setTimeout(() => {
                this.xpToast.style.backgroundColor = '';
                this.xpToast.style.color = '';
            }, 500);
        }, 4000);
    }

    bindElements() {
        this.titleScreen = document.getElementById('title-screen');
        this.btnEnterSystem = document.getElementById('btn-enter-system');

        this.clinicalFolder = document.getElementById('clinical-folder-menu');
        this.uiLayer = document.getElementById('ui-layer');
        this.deathScreen = document.getElementById('death-screen');
        
        this.btnStart = document.getElementById('btn-start');
        this.btnResume = document.getElementById('btn-resume-run');
        this.btnWipeSave = document.getElementById('btn-wipe-save'); 

        this.btnExportSave = document.getElementById('btn-export-save');
        this.btnImportSave = document.getElementById('btn-import-save');

        this.btnUpgHp = document.getElementById('btn-upg-hp');
        this.btnUpgSpeed = document.getElementById('btn-upg-speed');
        this.btnUpgLight = document.getElementById('btn-upg-light');
        this.btnUpgMagnet = document.getElementById('btn-upg-magnet');

        this.inventoryGrid = document.getElementById('inventory-grid');
        this.detailName = document.getElementById('detail-name');
        this.detailDesc = document.getElementById('detail-desc');
        this.detailSet = document.getElementById('detail-set');
        this.btnEquipItem = document.getElementById('btn-equip-item');
        this.btnUnequipItem = document.getElementById('btn-unequip-item');
        this.btnUpgradeItem = document.getElementById('btn-upgrade-item');

        this.xpToast = document.getElementById('xp-toast');
        this.toastLevel = document.getElementById('toast-level-display');
        this.toastBar = document.getElementById('toast-xp-bar');
        this.toastText = document.getElementById('toast-xp-text');
        this.toastTimer = null;

        this.tabBtns = document.querySelectorAll('.tab-btn');
        this.tabPanes = document.querySelectorAll('.tab-pane');
    }

    showXPToast() {
        if (!this.xpToast) return;
        const levelInfo = this.saveManager.getPatientLevelInfo();
        
        this.xpToast.style.top = '30px'; 

        setTimeout(() => {
            this.toastLevel.innerText = `PATIENT LEVEL ${levelInfo.level}`;
            this.toastBar.style.width = `${levelInfo.progressPercent}%`;
            this.toastText.innerText = `${levelInfo.currentXP} / ${levelInfo.nextXP} L Spent`;
        }, 150);

        if (this.toastTimer) clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            this.xpToast.style.top = '-150px'; 
        }, 2500);
    }

    attachEvents() {
        document.querySelectorAll('.file-btn, .tab-btn').forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                if (!btn.disabled && this.audioEngine) this.audioEngine.playSFX('ui_hover');
            });
            btn.addEventListener('click', () => {
                if (!btn.disabled && this.audioEngine) this.audioEngine.playSFX('ui_click');
            });
        });

        // NOTE: The main.js file handles the INITIALIZE button logic to safely transition to the HUB. 
        // We have removed the duplicate UI listener that was forcing the clinical folder open.

        this.tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.tabBtns.forEach(b => b.classList.remove('active'));
                this.tabPanes.forEach(p => p.classList.remove('active'));
                
                btn.classList.add('active');
                
                if (this.audioEngine) {
                    this.audioEngine.playSFX('ui_click');
                }
                const targetId = btn.getAttribute('data-target');
                document.getElementById(targetId).classList.add('active');
                
                if (targetId === 'tab-loadout') {
                    this.selectedInventoryItem = null;
                    this.selectedSlotType = null;
                    this.renderLoadoutUI();
                } else if (targetId === 'tab-tree' || targetId === 'tab-main' || targetId === 'tab-trophies') {
                    this.updateMenuUI();
                }
            });
        });

        this.btnStart.addEventListener('click', () => {
            this.clinicalFolder.style.display = 'none';
            this.uiLayer.style.display = 'flex';
            if (this.onStartGameCallback) this.onStartGameCallback();
        });

        if (this.btnExportSave) {
            this.btnExportSave.addEventListener('click', () => {
                const encoded = this.saveManager.exportSave();
                if (encoded) {
                    navigator.clipboard.writeText(encoded).then(() => {
                        alert("Clinical file copied to clipboard! Keep it safe.");
                    }).catch(err => {
                        prompt("Copy this text to save your file:", encoded);
                    });
                }
            });
        }

        if (this.btnImportSave) {
            this.btnImportSave.addEventListener('click', () => {
                const encoded = prompt("Paste your exported clinical file string here:");
                if (encoded) {
                    const success = this.saveManager.importSave(encoded);
                    if (success) {
                        alert("Clinical file successfully reconstructed. Reloading UI.");
                        window.location.reload();
                    } else {
                        alert("ERROR: File corruption detected. Import failed.");
                    }
                }
            });
        }

        if (this.btnWipeSave) {
            this.btnWipeSave.addEventListener('click', () => {
                const isConfirmed = confirm("WARNING: This will completely erase your clinical file, destroying all tokens, upgrades, and banked lucidity. Do you wish to proceed?");
                if (isConfirmed) this.saveManager.wipeSave();
            });
        }

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
                    if (this.audioEngine) this.audioEngine.playSFX('ui_upgrade');
                    this.updateMenuUI(); 
                    this.showXPToast(); 
                    
                    const invItem = this.saveManager.metaState.inventory.find(i => i.uid === this.selectedInventoryItem);
                    const tokenData = TOKENS[invItem.id];
                    this.selectInventoryItem(invItem, tokenData);
                    this.renderLoadoutUI();
                }
            }
        });

        this.btnUpgHp.addEventListener('click', () => { 
            if (this.saveManager.buyUpgrade('hp', 50)) { 
                if (this.audioEngine) this.audioEngine.playSFX('ui_upgrade');
                this.updateMenuUI(); this.showXPToast(); 
            } 
        });
        this.btnUpgSpeed.addEventListener('click', () => { 
            if (this.saveManager.buyUpgrade('speed', 75)) { 
                if (this.audioEngine) this.audioEngine.playSFX('ui_upgrade');
                this.updateMenuUI(); this.showXPToast(); 
            } 
        });
        this.btnUpgLight.addEventListener('click', () => { 
            if (this.saveManager.buyUpgrade('light', 100)) { 
                if (this.audioEngine) this.audioEngine.playSFX('ui_upgrade');
                this.updateMenuUI(); this.showXPToast(); 
            } 
        });
        this.btnUpgMagnet.addEventListener('click', () => { 
            if (this.saveManager.buyUpgrade('magnet', 150)) { 
                if (this.audioEngine) this.audioEngine.playSFX('ui_upgrade');
                this.updateMenuUI(); this.showXPToast(); 
            } 
        });
    }

    updateMenuUI() {
        const meta = this.saveManager.metaState;
        const levelInfo = this.saveManager.getPatientLevelInfo();
        
        const levelDisplays = document.querySelectorAll('.patient-stamp');
        levelDisplays.forEach(el => el.innerText = `PATIENT LVL ${levelInfo.level}`);
        
        const xpBar = document.getElementById('patient-xp-bar');
        const xpText = document.getElementById('patient-xp-text');
        if (xpBar) xpBar.style.width = `${levelInfo.progressPercent}%`;
        if (xpText) xpText.innerText = `${levelInfo.currentXP} / ${levelInfo.nextXP} L`;

        document.getElementById('tree-lucidity').innerText = meta.lucidityBank;
        
        const upgradeStats = [
            { id: 'hp', baseCost: 50, element: this.btnUpgHp },
            { id: 'speed', baseCost: 75, element: this.btnUpgSpeed },
            { id: 'light', baseCost: 100, element: this.btnUpgLight },
            { id: 'magnet', baseCost: 150, element: this.btnUpgMagnet }
        ];

        upgradeStats.forEach(stat => {
            const currentLvl = meta.upgrades[stat.id] || 0;
            document.getElementById(`upg-${stat.id}-lvl`).innerText = currentLvl;
            const cost = Math.floor(stat.baseCost * Math.pow(1.1, currentLvl));
            stat.element.innerText = `${cost} L`;
            
            const canAfford = meta.lucidityBank >= cost;
            const isMaxed = currentLvl >= 100;
            stat.element.disabled = !canAfford || isMaxed;
            if (isMaxed) stat.element.innerText = "MAX";
        });

        this.renderRoadmap();
        this.renderTrophies();
    }

    renderRoadmap() {
        const timeline = document.querySelector('.roadmap-timeline');
        if (!timeline) return;

        const maxFloor = this.saveManager.metaState.maxFloorReached || 1;
        const maxBoss = this.saveManager.metaState.maxBossEncountered || 0;

        const floors = [
            { f: 1, name: "Floor 1: The Wastes (Sphere Head)", unknown: "Floor 1: (UNKNOWN)" },
            { f: 2, name: "Floor 2: The Divide (Rorschach)", unknown: "Floor 2: (UNKNOWN)" },
            { f: 3, name: "Floor 3: The Panopticon (The All-Seeing Eye)", unknown: "Floor 3: (UNKNOWN)" },
            { f: 4, name: "Floor 4: The Amalgamation (The Collective Nightmare)", unknown: "Floor 4: (UNKNOWN)" },
            { f: 5, name: "Floor 5: The Architect (FINAL)", unknown: "Floor 5: (UNKNOWN)", isBoss: true }
        ];

        timeline.innerHTML = '';
        
        floors.forEach(floor => {
            const node = document.createElement('div');
            node.className = 'roadmap-node';
            if (floor.isBoss) node.classList.add('boss');

            if (floor.f < maxFloor) {
                node.classList.add('completed');
                node.innerText = floor.name;
            } else if (floor.f === maxFloor) {
                node.classList.add('active');
                if (maxBoss >= floor.f) node.innerText = floor.name;
                else node.innerText = floor.unknown;
            } else {
                node.classList.add('locked');
                node.innerText = floor.unknown;
            }
            timeline.appendChild(node);
        });
    }

    renderTrophies() {
        const kills = this.saveManager.metaState.killCounts || {};
        
        const updateMobTrophy = (id, count) => {
            const statEl = document.getElementById(`stat-${id}`);
            const goalEl = document.getElementById(`goal-${id}`);
            const silEl = document.getElementById(`sil-${id}`);
            if (!statEl || !silEl || !goalEl) return;
            
            let nextGoal = 10;
            let metalColor = '';
            let opacity = 0.1;
            let shadow = 'none';

            if (count >= 10000) { nextGoal = "MAX"; metalColor = '#ffd700'; opacity = 1.0; shadow = '0 0 15px #ffd700'; } // Gold
            else if (count >= 1000) { nextGoal = 10000; metalColor = '#c0c0c0'; opacity = 1.0; shadow = '0 0 10px #c0c0c0'; } // Silver
            else if (count >= 10) { nextGoal = 1000; metalColor = '#cd7f32'; opacity = 1.0; shadow = '0 0 10px #cd7f32'; } // Bronze
            
            statEl.innerText = count;
            goalEl.innerText = nextGoal === "MAX" ? "" : ` / ${nextGoal}`;
            
            if (opacity > 0.1) {
                silEl.style.opacity = opacity;
                silEl.style.color = metalColor;
                silEl.style.textShadow = shadow;
            }
        };

        const updateBossTrophy = (id, count, color) => {
            const statEl = document.getElementById(`stat-${id}`);
            const silEl = document.getElementById(`sil-${id}`);
            if (!statEl || !silEl) return;

            statEl.innerText = count;
            if (count > 0) {
                silEl.style.opacity = 1.0;
                silEl.style.color = color;
                silEl.style.textShadow = `0 0 15px ${color}`;
            }
        };

        updateMobTrophy('scavenger', kills.SCAVENGER || 0);
        updateMobTrophy('predator', kills.PREDATOR || 0);
        updateMobTrophy('parasite', kills.PARASITE || 0);

        updateBossTrophy('boss', kills.BOSS || 0, '#b87333');
        updateBossTrophy('rorschach', kills.RORSCHACH || 0, '#800080');
        updateBossTrophy('panopticon', kills.PANOPTICON || 0, '#ff0055');
        updateBossTrophy('amalgamation', kills.AMALGAMATION || 0, '#55ff55');
        updateBossTrophy('architect', kills.ARCHITECT || 0, '#c5a059');
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
                    slotEl.innerHTML = `<div>${tokenData.name}</div><div style="font-size:0.6rem; color:var(--ink-black);">Lv.${invItem.level}</div>`;
                    slotEl.classList.add('filled');
                    slotEl.classList.add(`rarity-${invItem.rarity}`);
                    slotEl.onclick = () => this.selectEquippedSlot(slotType, invItem);
                }
            } else {
                let slotName = slotType === 'head' ? 'HEAD' : (slotType === 'body' ? 'BODY' : (slotType === 'hands' ? 'HANDS' : 'LEGS'));
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
            
            let icon = '💊';
            if (tokenData.type === 'head') icon = '🧠';
            else if (tokenData.type === 'body') icon = '🦺';
            else if (tokenData.type === 'hands') icon = '🧤';
            else if (tokenData.type === 'legs') icon = '🥾';

            el.innerHTML = `<div style="font-size:1.5rem;">${icon}</div><div>${tokenData.name}</div>`;
            el.onclick = () => this.selectInventoryItem(invItem, tokenData);
            this.inventoryGrid.appendChild(el);
        });

        this.detailName.innerText = "Select an Item";
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
                this.btnUpgradeItem.innerText = `FORGE (${rarityData.costToUpgrade} L)`;
                this.btnUpgradeItem.disabled = this.saveManager.metaState.lucidityBank < rarityData.costToUpgrade;
            } else {
                this.btnUpgradeItem.innerText = `REQUIRES PATIENT LVL 10`;
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