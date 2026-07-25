// src/ui/UIManager.js
import { TOKENS, TOKEN_RARITIES, TOKEN_SETS, INTRUSIVE_THOUGHTS } from '../data/Manifestations.js';
import { SynapseTree } from './SynapseTree.js';

// Matches the hardcoded progression chain in SaveManager.upgradeToken() exactly —
// that method does NOT derive the chain from TOKEN_RARITIES, it's a separate
// hardcoded if/else, so this order must be kept in sync with it by hand.
const RARITY_UPGRADE_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic'];

export class UIManager {
    constructor(saveManager, audioEngine, onStartGameCallback) {
        this.saveManager = saveManager;
        this.audioEngine = audioEngine;
        this.onStartGameCallback = onStartGameCallback;
        
        this.selectedInventoryItem = null; 
        this.selectedSlotType = null;      
        
        this.bindElements();
        // Patch 29.7: constructed once here; render() is called from updateMenuUI()
        // below so it stays in sync with everything else that refreshes the menu
        // (tab switches, purchases, imports). onPurchase closes the gap flagged
        // after 29.7: a node buy happens entirely inside SynapseTree's own click
        // handler, so without this hook nothing tells UIManager it occurred —
        // #tree-lucidity (a separate element SynapseTree doesn't touch) would only
        // catch up next time the tab was reopened, and the purchase SFX/XP toast
        // the old upgrade buttons had would never fire at all.
        this.synapseTree = new SynapseTree(this.synapseTreeContainer, this.saveManager, () => {
            if (this.audioEngine) this.audioEngine.playSFX('ui_upgrade');
            this.updateMenuUI();
            this.showXPToast();
        });
        this.attachEvents();
        this.updateMenuUI();
        
        this.initBloodRain();

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

    initBloodRain() {
        // Create the container inside the medical folder so it's visually bounded
        const container = document.createElement('div');
        container.id = 'blood-container';
        
        const medicalFolder = document.querySelector('.medical-folder');
        if (medicalFolder) {
            medicalFolder.appendChild(container);
        } else {
            document.body.appendChild(container);
        }

        // Spawn a blood drop every 80 milliseconds
        setInterval(() => {
            // OPTIMIZATION: Only spawn blood if the menu is actually active and visible
            if (!this.clinicalFolder || this.clinicalFolder.style.display === 'none' || this.clinicalFolder.style.display === '') {
                return;
            }

            const drop = document.createElement('div');
            drop.classList.add('blood-drop');
            
            // Randomize position, size, and speed for a natural look
            drop.style.left = Math.random() * 100 + '%';
            drop.style.height = (Math.random() * 15 + 5) + 'px';
            drop.style.width = (Math.random() * 2 + 1) + 'px';
            drop.style.animationDuration = (Math.random() * 1.5 + 0.8) + 's';
            
            container.appendChild(drop);

            // Destroy the drop after it falls off screen to prevent memory leaks
            setTimeout(() => {
                if (drop.parentNode) {
                    drop.remove();
                }
            }, 2500);
        }, 80); 
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

        // Patch 29.7: the 4 hardcoded upgrade buttons are gone — the Synapse Tree
        // renders into this container instead (see the constructor below).
        this.synapseTreeContainer = document.getElementById('synapse-tree-container');

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
                } else if (targetId === 'tab-tree' || targetId === 'tab-main' || targetId === 'tab-trophies' || targetId === 'tab-curses') {
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

        // Patch 29.7: no hardcoded upgrade-button handlers here anymore — the
        // Synapse Tree's own node cards call buyNode and re-render themselves
        // (see SynapseTree.js). NOTE: this means buying a tree node currently does
        // NOT play the 'ui_upgrade' SFX or trigger showXPToast() the old buttons
        // did — SynapseTree.js has no hook exposed for that, and it's out of this
        // patch's file scope (UIManager.js, index.html only) to add one. Flagging
        // as a real, known gap rather than a silent regression.
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

        // Patch 29.7: the old 4-stat value-delta loop (Patch 27) is gone — the
        // Synapse Tree's own node cards show cost/state directly. render() rebuilds
        // the whole tree fresh, so it always reflects the current bank/PL/treeNodes.
        if (this.synapseTree) this.synapseTree.render();

        this.renderRoadmap();
        this.renderTrophies();
        this.renderCurseSelection();
    }

    renderCurseSelection() {
        const meta = this.saveManager.metaState;
        const patientLevel = this.saveManager.getPatientLevelInfo().level;
        const bossKills = (meta.killCounts && meta.killCounts.BOSS) || 0;
        const isUnlocked = patientLevel >= 5 && bossKills > 0;
        const selected = meta.selectedCurses || [];
        const bonusPct = Math.round(selected.length * 15);

        const statusLine = document.getElementById('curse-status-line');
        if (statusLine) {
            if (!isUnlocked) {
                statusLine.innerText = '';
            } else if (selected.length === 0) {
                statusLine.innerText = 'No Intrusive Thoughts active.';
                statusLine.style.color = '#888';
            } else {
                statusLine.innerText = `Active Intrusive Thoughts: ${selected.length} (+${bonusPct}% Lucidity)`;
                statusLine.style.color = '#8b0000';
            }
        }

        const container = document.getElementById('curse-selection-container');
        if (!container) return;

        if (!isUnlocked) {
            container.innerHTML = `<p class="typewriter-text" style="color:#888; text-align:center; font-size:0.9rem;">🔒 INTRUSIVE THOUGHTS LOCKED — Requires Patient Level 5 and at least one Boss defeated.</p>`;
            return;
        }

        let html = `<div class="section-label" style="text-align:center;">CURRENT BONUS: +${bonusPct}% LUCIDITY</div>`;

        Object.values(INTRUSIVE_THOUGHTS).forEach(curse => {
            const isActive = selected.includes(curse.id);
            html += `
                <div class="synapse-node-file">
                    <div class="node-info"><strong>${curse.name}</strong><br><span class="typewriter-text">${curse.desc}</span></div>
                    <button class="file-btn small ${isActive ? 'danger' : ''}" data-curse-id="${curse.id}">${isActive ? 'ACTIVE (REVOKE)' : 'ADOPT'}</button>
                </div>
            `;
        });

        container.innerHTML = html;

        container.querySelectorAll('[data-curse-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.saveManager.toggleCurse(btn.getAttribute('data-curse-id'));
                if (this.audioEngine) this.audioEngine.playSFX('ui_click');
                this.renderCurseSelection();
            });
        });
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

        // Value-delta (Patch 27): rarity is the only field upgradeToken() actually
        // changes today. TOKEN_RARITIES.multiplier and the token's own .level are
        // not read by any gameplay system (Game.js/Combat.js) — grep confirms it —
        // so this deliberately shows the rarity-tier change rather than inventing a
        // stat number that would misrepresent what forging currently does.
        const rarityIdx = RARITY_UPGRADE_ORDER.indexOf(invItem.rarity);
        const nextRarity = (rarityIdx >= 0 && rarityIdx < RARITY_UPGRADE_ORDER.length - 1)
            ? RARITY_UPGRADE_ORDER[rarityIdx + 1] : null;
        const rarityDeltaLine = nextRarity
            ? `Forge: ${invItem.rarity} → ${nextRarity}`
            : `Rarity: ${invItem.rarity} (MAXED)`;

        this.detailSet.innerText = `Set: ${setData.name} | (2) ${setData['2']} | (4) ${setData['4']}\n${rarityDeltaLine}\n\n[CLICK PRESCRIBE TO EQUIP]`;

        this.btnEquipItem.innerText = "[ PRESCRIBE TO PATIENT ]";
        this.btnEquipItem.style.cssText = 'display: block; width: 100%; background-color: var(--blood-red); color: white; padding: 12px; font-weight: bold; font-size: 1rem; border: 2px solid #ef4444; margin-bottom: 15px; cursor: pointer; text-shadow: 0 0 5px red; font-family: Courier New; text-transform: uppercase; white-space: normal; line-height: 1.2;';
        this.btnEquipItem.disabled = false;
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