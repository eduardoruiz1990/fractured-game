// src/ui/UIManager.js
import { TOKENS, TOKEN_RARITIES, TOKEN_SETS, TOKEN_SLOT_TYPES, INTRUSIVE_THOUGHTS } from '../data/Manifestations.js';
import { SynapseTree } from './SynapseTree.js';

// Matches the hardcoded progression chain in SaveManager.upgradeToken() exactly —
// that method does NOT derive the chain from TOKEN_RARITIES, it's a separate
// hardcoded if/else, so this order must be kept in sync with it by hand.
const RARITY_UPGRADE_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic'];

// Patch 33: human-readable line per resolver stat key. Mirrors the exact
// vocabulary SaveManager.getResolvedTokenEffects() reads (see Patch 31/31b) —
// adding a stat there without a label here just means the hover preview silently
// skips it, never throws.
const TOKEN_EFFECT_LABELS = {
    sanity: v => `${v > 0 ? '+' : ''}${v} Max Grip`,
    speed: v => `${v > 0 ? '+' : ''}${v}% Move Speed`,
    light: v => `${v > 0 ? '+' : ''}${v}% Flashlight Range`,
    magnet: v => `${v > 0 ? '+' : ''}${v}px Vacuum Radius`,
    iframes: v => `${v > 0 ? '+' : ''}${v}f Invulnerability`,
    flashlightAngle: v => `${v > 0 ? '+' : ''}${v}% Cone Angle`,
    lucidityGain: v => `${v > 0 ? '+' : ''}${v}% Lucidity Gain`,
    dashCooldown: v => `${v > 0 ? '+' : ''}${v}f Dash Cooldown`,
    dashDuration: v => `${v > 0 ? '+' : ''}${v}f Dash Duration`
};

// Grant strings aren't numeric, so they get their own short human phrase instead
// of running through TOKEN_EFFECT_LABELS' +/- formatting.
const TOKEN_GRANT_LABELS = {
    denial_shield: 'Shield ignores 1st hit per floor',
    panic_dash: 'Dash: faster recharge, shorter range',
    twitch_cooldown: 'Cooldowns shrink as Grip drops',
    insomniac_burn_zone: '(Insomniac 4pc) Outer burn zone',
    shockwave_no_dash: '(Institutionalized 4pc) Hit shockwave, no dash',
    medicated_mitigation: '(Medicated 2pc) Damage taken -20%'
};

// Patch 33: formats a token's OWN effects at its CURRENT rarity — positive
// numeric effects scaled by TOKEN_RARITIES.multiplier, exactly matching how
// SaveManager.getResolvedTokenEffects() actually resolves them (Patch 31b), so
// this preview can't drift from what equipping the token really does.
function formatTokenEffects(tokenData, rarity) {
    const mult = (TOKEN_RARITIES[rarity] && TOKEN_RARITIES[rarity].multiplier) || 1.0;
    const lines = [];
    for (const [key, value] of Object.entries(tokenData.effects || {})) {
        if (key === 'grant') {
            lines.push(TOKEN_GRANT_LABELS[value] || value);
        } else if (key === 'tagDamage') {
            for (const [tag, amt] of Object.entries(value)) {
                const scaled = amt > 0 ? Math.round(amt * mult) : amt;
                lines.push(`${scaled > 0 ? '+' : ''}${scaled}% ${tag} damage`);
            }
        } else if (TOKEN_EFFECT_LABELS[key]) {
            const scaled = value > 0 ? Math.round(value * mult) : value;
            lines.push(TOKEN_EFFECT_LABELS[key](scaled));
        }
    }
    return lines;
}

// Patch 34: equipped-vs-candidate diff, used by both the inventory hover tooltip
// and the detail panel so a player can tell what swapping in a token actually
// changes without doing the swap. Reuses TOKEN_EFFECT_LABELS' v => string
// formatters to render each delta — they only care about the sign/number/unit,
// so calling them with a delta instead of an absolute value is safe and keeps
// this from drifting from formatTokenEffects' own vocabulary. grant is a
// presence/absence swap, not a numeric delta, so it's reported separately.
function computeEffectDiff(fromTokenData, fromRarity, toTokenData, toRarity) {
    const scale = (tokenData, rarity) => {
        const mult = (TOKEN_RARITIES[rarity] && TOKEN_RARITIES[rarity].multiplier) || 1.0;
        const out = {};
        for (const [key, value] of Object.entries(tokenData.effects || {})) {
            if (key === 'tagDamage') {
                for (const [tag, amt] of Object.entries(value)) {
                    out[`tagDamage:${tag}`] = amt > 0 ? Math.round(amt * mult) : amt;
                }
            } else if (TOKEN_EFFECT_LABELS[key]) {
                out[key] = value > 0 ? Math.round(value * mult) : value;
            }
        }
        return out;
    };
    const from = scale(fromTokenData, fromRarity);
    const to = scale(toTokenData, toRarity);
    const lines = [];
    new Set([...Object.keys(from), ...Object.keys(to)]).forEach(key => {
        const delta = (to[key] || 0) - (from[key] || 0);
        if (delta === 0) return;
        if (key.startsWith('tagDamage:')) {
            const tag = key.replace('tagDamage:', '');
            lines.push(`${delta > 0 ? '+' : ''}${delta}% ${tag} damage`);
        } else {
            lines.push(TOKEN_EFFECT_LABELS[key](delta));
        }
    });

    const fromGrant = fromTokenData.effects && fromTokenData.effects.grant;
    const toGrant = toTokenData.effects && toTokenData.effects.grant;
    if (fromGrant !== toGrant) {
        if (fromGrant) lines.push(`Lose: ${TOKEN_GRANT_LABELS[fromGrant] || fromGrant}`);
        if (toGrant) lines.push(`Gain: ${TOKEN_GRANT_LABELS[toGrant] || toGrant}`);
    }
    return lines;
}

export class UIManager {
    constructor(saveManager, audioEngine, onStartGameCallback) {
        this.saveManager = saveManager;
        this.audioEngine = audioEngine;
        this.onStartGameCallback = onStartGameCallback;
        
        this.selectedInventoryItem = null;
        this.selectedSlotType = null;

        // Patch 34: inventory sort/filter state, read by renderLoadoutUI().
        this.loadoutSort = 'rarity-desc';
        this.loadoutFilterRarity = 'all';

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
        this.loadoutSortSelect = document.getElementById('loadout-sort');
        this.loadoutFilterSelect = document.getElementById('loadout-filter-rarity');
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

        // Patch 34b: one shared floating tooltip appended directly to <body>,
        // outside .inventory-panel's DOM subtree so its overflow-y:auto (which
        // forces overflow-x to 'auto' too, clipping anything positioned
        // relative to a card inside it) can never clip this. Positioned via
        // JS in showItemTooltip() using getBoundingClientRect().
        this.itemTooltipEl = document.createElement('div');
        this.itemTooltipEl.className = 'item-tooltip';
        document.body.appendChild(this.itemTooltipEl);
    }

    showItemTooltip(targetEl, text) {
        if (!this.itemTooltipEl) return;
        this.itemTooltipEl.innerText = text;
        this.itemTooltipEl.classList.add('visible');

        const rect = targetEl.getBoundingClientRect();
        const tooltipWidth = 180;
        const margin = 8;
        let left = rect.left + rect.width / 2 - tooltipWidth / 2;
        left = Math.max(margin, Math.min(left, window.innerWidth - tooltipWidth - margin));
        this.itemTooltipEl.style.left = `${left}px`;

        // Prefer above the card (matches the old anchor); flip below if that
        // would run off the top of the viewport.
        const tooltipHeight = this.itemTooltipEl.offsetHeight || 90;
        const top = (rect.top - tooltipHeight - margin < 0)
            ? rect.bottom + margin
            : rect.top - tooltipHeight - margin;
        this.itemTooltipEl.style.top = `${top}px`;
    }

    hideItemTooltip() {
        if (this.itemTooltipEl) this.itemTooltipEl.classList.remove('visible');
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

        // Patch 34: sort/filter controls just re-render the grid — they don't
        // touch selection state, so a currently-open detail panel stays put.
        if (this.loadoutSortSelect) {
            this.loadoutSortSelect.addEventListener('change', () => {
                this.loadoutSort = this.loadoutSortSelect.value;
                this.renderLoadoutUI();
            });
        }
        if (this.loadoutFilterSelect) {
            this.loadoutFilterSelect.addEventListener('change', () => {
                this.loadoutFilterRarity = this.loadoutFilterSelect.value;
                this.renderLoadoutUI();
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

    // Patch 32b: weight -> tier label/colour, matching the static legend added to
    // #tab-curses in index.html (Patch 32) exactly, so the numbers on each card
    // agree with what that legend promises.
    curseTierLabel(weight) {
        if (weight >= 30) return { text: 'EXTREME', color: 'var(--ui-red)' };
        if (weight >= 20) return { text: 'SEVERE', color: '#c05a00' };
        if (weight >= 15) return { text: 'MODERATE', color: '#a67c00' };
        return { text: 'MILD', color: '#888' };
    }

    renderCurseSelection() {
        const meta = this.saveManager.metaState;
        // Patch 32b: isCurseUnlocked() is now the single source of truth for this
        // gate (also enforced server-side in toggleCurse) — reads it here instead
        // of re-deriving the same patientLevel >= 5 && bossKills > 0 check locally.
        const isUnlocked = this.saveManager.isCurseUnlocked();
        const selected = meta.selectedCurses || [];
        // Patch 32b: was Math.round(selected.length * 15) — flat 15% regardless of
        // which curses were adopted. Now the real weighted total from the ladder.
        const bonusPct = this.saveManager.getResolvedCurseBonus().totalPct;

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
            const tier = this.curseTierLabel(curse.lucidityWeight);
            html += `
                <div class="synapse-node-file">
                    <div class="node-info">
                        <strong>${curse.name}</strong>
                        <span style="color:${tier.color}; font-size:0.7rem; font-weight:bold; margin-left:6px;">${tier.text} +${curse.lucidityWeight}%</span>
                        <br><span class="typewriter-text">${curse.desc}</span>
                    </div>
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

        const meta = this.saveManager.metaState;
        const maxFloor = meta.maxFloorReached || 1;
        const maxBoss = meta.maxBossEncountered || 0;
        const kills = meta.killCounts || {};

        // bossKey maps a floor to its killCounts entry, matching Director.spawnRoom's
        // floor->boss dispatch (1 BOSS, 2 RORSCHACH, 3 PANOPTICON, 4 AMALGAMATION,
        // 5+ ARCHITECT). That count is what turns this from a static list into a
        // record of what the patient has actually survived.
        const floors = [
            { f: 1, area: "THE WASTES",       boss: "SPHERE HEAD",  bossKey: 'BOSS',
              note: "Initial dissociative episode. Baseline hostility." },
            { f: 2, area: "THE DIVIDE",       boss: "RORSCHACH",    bossKey: 'RORSCHACH',
              note: "Perceptual splitting. The subject sees pattern where there is none." },
            { f: 3, area: "THE PANOPTICON",   boss: "THE ALL-SEEING EYE", bossKey: 'PANOPTICON',
              note: "Persistent surveillance ideation. Constant observation." },
            { f: 4, area: "THE AMALGAMATION", boss: "THE COLLECTIVE", bossKey: 'AMALGAMATION',
              note: "Ego dissolution. Boundaries between selves fail." },
            { f: 5, area: "THE ARCHITECT",    boss: "THE ARCHITECT", bossKey: 'ARCHITECT',
              note: "Terminal stage. The source of the construct.", isFinal: true }
        ];

        const deepest = Math.min(maxFloor, floors.length);
        const conquered = floors.filter(fl => (kills[fl.bossKey] || 0) > 0).length;
        const pct = Math.round((conquered / floors.length) * 100);

        timeline.innerHTML = '';

        // --- Summary band: the at-a-glance progress read ---
        const summary = document.createElement('div');
        summary.className = 'roadmap-summary';
        summary.innerHTML = `
            <div class="roadmap-summary-row">
                <span class="section-label" style="margin:0;">DESCENT PROGRESS</span>
                <span class="roadmap-summary-figure">${conquered} / ${floors.length} SUBDUED</span>
            </div>
            <div class="roadmap-progress-track"><div class="roadmap-progress-fill" style="width:${pct}%;"></div></div>
            <div class="roadmap-summary-row roadmap-summary-sub">
                <span>DEEPEST REACHED: FLOOR ${deepest}</span>
                <span>${meta.hasEscapedFloor1 ? 'ESCAPE ON RECORD' : 'NO ESCAPE ON RECORD'}</span>
            </div>
        `;
        timeline.appendChild(summary);

        floors.forEach(floor => {
            const bossKills = kills[floor.bossKey] || 0;
            const defeated = bossKills > 0;
            // "Seen" means the player actually got to this floor, so its identity is
            // no longer redacted even if the boss is still standing.
            const seen = floor.f <= maxFloor || maxBoss >= floor.f;

            const node = document.createElement('div');
            node.className = 'roadmap-node';
            if (floor.isFinal) node.classList.add('boss');

            if (defeated) node.classList.add('completed');
            else if (floor.f === maxFloor) node.classList.add('active');
            else if (!seen) node.classList.add('locked');

            if (!seen) {
                node.innerHTML = `
                    <div class="roadmap-node-head">
                        <span class="roadmap-floor-tag">FLOOR ${floor.f}</span>
                        <span class="roadmap-status redacted">SEALED</span>
                    </div>
                    <div class="roadmap-area redacted-text">(UNKNOWN)</div>
                `;
            } else {
                const status = defeated
                    ? `SUBDUED ×${bossKills}`
                    : (floor.f === maxFloor ? 'IN PROGRESS' : 'ENCOUNTERED');
                node.innerHTML = `
                    <div class="roadmap-node-head">
                        <span class="roadmap-floor-tag">FLOOR ${floor.f}</span>
                        <span class="roadmap-status ${defeated ? 'subdued' : 'pending'}">${status}</span>
                    </div>
                    <div class="roadmap-area">${floor.area}</div>
                    <div class="roadmap-boss">SUBJECT OF RECORD: <strong>${floor.boss}</strong></div>
                    <div class="roadmap-note typewriter-text">${floor.note}</div>
                `;
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

    // Patch 31: pre-run 2/4 set progress. Reads setCounts straight off the token
    // resolver so this display can never disagree with what the equipped tokens
    // actually resolve to. Only shows sets the player has at least one piece of —
    // listing all four unconditionally would bury the one they're building.
    renderSetProgress() {
        const container = document.getElementById('set-progress-container');
        if (!container) return;

        const { setCounts } = this.saveManager.getResolvedTokenEffects();
        const owned = Object.entries(setCounts).filter(([, count]) => count > 0);

        if (owned.length === 0) {
            container.innerHTML = `<div class="typewriter-text" style="font-size:0.7rem; color:#666;">No set pieces prescribed.</div>`;
            return;
        }

        container.innerHTML = owned.map(([setKey, count]) => {
            const setData = TOKEN_SETS[setKey];
            if (!setData) return '';
            const tier2 = count >= 2;
            const tier4 = count >= 4;
            const line = (active, n, text) => `
                <div style="font-size:0.65rem; line-height:1.25; color:${active ? 'var(--ui-red)' : '#888'}; font-weight:${active ? 'bold' : 'normal'};">
                    ${active ? '&#10003;' : '&#9679;'} (${n}) ${text}
                </div>`;
            return `
                <div style="margin-bottom:8px;">
                    <div class="typewriter-text" style="font-size:0.75rem;">${setData.name} &mdash; ${count}/4</div>
                    ${line(tier2, 2, setData['2'])}
                    ${line(tier4, 4, setData['4'])}
                </div>`;
        }).join('');
    }

    // Patch 33: shared drag-SOURCE wiring for both an inventory tile and an
    // equipped slot. tokenType marks compatibility (readable during dragover via
    // e.dataTransfer.types, before the payload itself is readable — the standard
    // way to validate a drop target ahead of the actual drop). sourceSlotType is
    // only set for a drag that started on an EQUIPPED slot, so a drop onto the
    // inventory grid knows to unequip rather than no-op.
    attachDragSource(el, invItem, tokenType, sourceSlotType = null) {
        el.draggable = true;
        el.ondragstart = (e) => {
            e.dataTransfer.setData('text/plain', invItem.uid);
            e.dataTransfer.setData(`token-type/${tokenType}`, invItem.uid);
            if (sourceSlotType) e.dataTransfer.setData(`source-slot/${sourceSlotType}`, invItem.uid);
            e.dataTransfer.effectAllowed = 'move';
            el.classList.add('dragging');
        };
        el.ondragend = () => el.classList.remove('dragging');
    }

    // Patch 33: drop target for a single equipment slot. Accepts only a drag whose
    // token-type marker matches this slot — dragging a head token onto the legs
    // slot is rejected the same way the click path already guarantees it (equipToken
    // is always called with the TOKEN's own type, never a mismatched target).
    attachSlotDropTarget(slotEl, slotType) {
        const isCompatible = (e) => e.dataTransfer.types.includes(`token-type/${slotType}`);
        slotEl.ondragover = (e) => {
            if (!isCompatible(e)) return; // no preventDefault => browser shows "not allowed"
            e.preventDefault();
            slotEl.classList.add('drag-target-valid');
        };
        slotEl.ondragleave = () => slotEl.classList.remove('drag-target-valid');
        slotEl.ondrop = (e) => {
            if (!isCompatible(e)) return;
            e.preventDefault();
            const uid = e.dataTransfer.getData('text/plain');
            this.saveManager.equipToken(uid, slotType);
            if (this.audioEngine) this.audioEngine.playSFX('ui_upgrade');
            this.renderLoadoutUI();
        };
    }

    renderLoadoutUI() {
        const meta = this.saveManager.metaState;

        // Patch 34b: rebuilding the grid below destroys whichever card the mouse
        // is currently over (e.g. clicking the inline forge button re-renders
        // mid-hover) without a mouseleave ever firing on it, which would
        // otherwise strand the shared tooltip pointing at a removed element.
        this.hideItemTooltip();

        // Patch 31: driven by TOKEN_SLOT_TYPES rather than a hardcoded 4-slot literal,
        // so the new 'prescription' slot needs no change here and a 6th never would.
        TOKEN_SLOT_TYPES.forEach(slotType => {
            const slotEl = document.getElementById(`slot-${slotType}`);
            if (!slotEl) return;
            const equippedUid = meta.equippedTokens[slotType];

            slotEl.className = 'token-slot';
            this.attachSlotDropTarget(slotEl, slotType); // every slot accepts drops, filled or not

            if (equippedUid) {
                const invItem = meta.inventory.find(i => i.uid === equippedUid);
                if (invItem) {
                    const tokenData = TOKENS[invItem.id];
                    slotEl.innerHTML = `<div>${tokenData.name}</div><div style="font-size:0.6rem; color:var(--ink-black);">Lv.${invItem.level}</div>`;
                    slotEl.classList.add('filled');
                    slotEl.classList.add(`rarity-${invItem.rarity}`);
                    slotEl.onclick = () => this.selectEquippedSlot(slotType, invItem);
                    // Patch 33: drag an equipped item back out to unequip (drop
                    // target is the inventory grid, wired below), or straight onto
                    // a different slot's own drop target — pointless in practice
                    // (only one slot per type exists) but harmless either way.
                    this.attachDragSource(slotEl, invItem, tokenData.type, slotType);
                }
            } else {
                slotEl.innerHTML = `${slotType.toUpperCase()}<br>Empty`;
                slotEl.onclick = null;
                slotEl.draggable = false;
                slotEl.ondragstart = null;
            }
        });

        this.renderSetProgress();

        this.inventoryGrid.innerHTML = '';
        // Patch 33: dropping an equipped item's drag here unequips it — the click
        // fallback for the same action is btn-unequip-item, unchanged below.
        this.inventoryGrid.ondragover = (e) => {
            if (!e.dataTransfer.types.some(t => t.startsWith('source-slot/'))) return;
            e.preventDefault();
        };
        this.inventoryGrid.ondrop = (e) => {
            const sourceType = e.dataTransfer.types.find(t => t.startsWith('source-slot/'));
            if (!sourceType) return;
            e.preventDefault();
            this.saveManager.unequipToken(sourceType.replace('source-slot/', ''));
            this.renderLoadoutUI();
        };

        // Patch 34: filter (rarity) then sort, using RARITY_UPGRADE_ORDER as the
        // single source of tier ordering rather than a second hardcoded list.
        let unequippedItems = meta.inventory.filter(invItem =>
            !Object.values(meta.equippedTokens).includes(invItem.uid) && TOKENS[invItem.id]);

        if (this.loadoutFilterRarity && this.loadoutFilterRarity !== 'all') {
            unequippedItems = unequippedItems.filter(invItem => invItem.rarity === this.loadoutFilterRarity);
        }

        unequippedItems.sort((a, b) => {
            const tokenA = TOKENS[a.id], tokenB = TOKENS[b.id];
            switch (this.loadoutSort) {
                case 'rarity-asc':
                    return RARITY_UPGRADE_ORDER.indexOf(a.rarity) - RARITY_UPGRADE_ORDER.indexOf(b.rarity);
                case 'name':
                    return tokenA.name.localeCompare(tokenB.name);
                case 'slot':
                    return tokenA.type.localeCompare(tokenB.type);
                case 'rarity-desc':
                default:
                    return RARITY_UPGRADE_ORDER.indexOf(b.rarity) - RARITY_UPGRADE_ORDER.indexOf(a.rarity);
            }
        });

        const levelInfo = this.saveManager.getPatientLevelInfo();

        unequippedItems.forEach(invItem => {
            const tokenData = TOKENS[invItem.id];

            const el = document.createElement('div');
            el.className = `inventory-item filled rarity-${invItem.rarity}`;

            // 💊 is the prescription slot's icon and also the pre-existing fallback,
            // so the new slot type needs no extra branch here.
            let icon = '💊';
            if (tokenData.type === 'head') icon = '🧠';
            else if (tokenData.type === 'body') icon = '🦺';
            else if (tokenData.type === 'hands') icon = '🧤';
            else if (tokenData.type === 'legs') icon = '🥾';

            // Patch 33: hover stat-delta. Pure CSS reveal (see .item-tooltip in
            // style.css) — populated once here, no hover JS needed.
            // Patch 34: appends an equipped-vs-this-item diff when this slot type
            // already has something prescribed, so hovering tells you what
            // swapping in would actually change before you commit to it.
            const rarityLabel = invItem.rarity.charAt(0).toUpperCase() + invItem.rarity.slice(1);
            const effectLines = formatTokenEffects(tokenData, invItem.rarity);
            const tooltipLines = [`${rarityLabel} — ${tokenData.name}`, ...effectLines];

            const equippedUid = meta.equippedTokens[tokenData.type];
            const equippedItem = equippedUid ? meta.inventory.find(i => i.uid === equippedUid) : null;
            if (equippedItem) {
                const equippedTokenData = TOKENS[equippedItem.id];
                const diffLines = computeEffectDiff(equippedTokenData, equippedItem.rarity, tokenData, invItem.rarity);
                tooltipLines.push('', `vs ${equippedTokenData.name}:`, ...(diffLines.length ? diffLines : ['(no change)']));
            }
            const tooltipText = tooltipLines.join('\n');

            // Patch 34: inline forge button — upgrades straight from the grid card
            // without going through select-then-click-FORGE. Reads the same
            // TOKEN_RARITIES.costToUpgrade the detail panel does; SaveManager.
            // upgradeToken() itself (the actual cost curve) is untouched.
            const rarityData = TOKEN_RARITIES[invItem.rarity];
            const forgeCost = rarityData.costToUpgrade;
            const forgeLabel = forgeCost ? `⬆ FORGE (${forgeCost}L)` : 'MAX RARITY';

            el.innerHTML = `<div style="font-size:1.5rem;">${icon}</div><div>${tokenData.name}</div>` +
                `<button type="button" class="inline-forge-btn" style="margin-top:2px; font-size:0.55rem; width:100%; background:var(--ink-black); color:var(--ui-gold); border:1px solid #333; font-family:inherit; padding:2px;">${forgeLabel}</button>`;
            el.onclick = () => this.selectInventoryItem(invItem, tokenData);
            // Patch 34b: shared body-level tooltip (see showItemTooltip) instead of
            // a per-card absolutely-positioned child — see the CSS comment on
            // .item-tooltip for why the old approach clipped at the grid's edges.
            el.addEventListener('mouseenter', () => this.showItemTooltip(el, tooltipText));
            el.addEventListener('mouseleave', () => this.hideItemTooltip());
            this.attachDragSource(el, invItem, tokenData.type);

            const inlineForgeBtn = el.querySelector('.inline-forge-btn');
            if (forgeCost) {
                inlineForgeBtn.disabled = levelInfo.level < 10 || this.saveManager.metaState.lucidityBank < forgeCost;
                inlineForgeBtn.style.cursor = inlineForgeBtn.disabled ? 'default' : 'pointer';
                inlineForgeBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (this.saveManager.upgradeToken(invItem.uid)) {
                        if (this.audioEngine) this.audioEngine.playSFX('ui_upgrade');
                        this.showXPToast();
                        this.updateMenuUI();
                        this.selectInventoryItem(invItem, tokenData);
                        this.renderLoadoutUI();
                    }
                };
            } else {
                inlineForgeBtn.disabled = true;
            }

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

        // Value-delta (Patch 27, corrected Patch 33): the original comment here said
        // TOKEN_RARITIES.multiplier was dead data, which was true when it was
        // written — Patch 31b made it real (positive token effects scale with it),
        // so forging now has an actual, showable numeric delta instead of just a
        // tier-name change. Uses the SAME formatTokenEffects() the hover tooltip
        // uses, so this can't drift from what the tooltip (or an equip) shows.
        const rarityIdx = RARITY_UPGRADE_ORDER.indexOf(invItem.rarity);
        const nextRarity = (rarityIdx >= 0 && rarityIdx < RARITY_UPGRADE_ORDER.length - 1)
            ? RARITY_UPGRADE_ORDER[rarityIdx + 1] : null;
        const currentEffects = formatTokenEffects(tokenData, invItem.rarity).join(', ') || '(no numeric effect)';
        const rarityDeltaLine = nextRarity
            ? `Forge: ${invItem.rarity} → ${nextRarity}\nNow: ${currentEffects}\nNext: ${formatTokenEffects(tokenData, nextRarity).join(', ')}`
            : `Rarity: ${invItem.rarity} (MAXED)\n${currentEffects}`;

        // Patch 34: equipped-vs-selected diff — same computeEffectDiff() the
        // inventory hover tooltip uses, so this can't disagree with what
        // hovering already told the player.
        const meta = this.saveManager.metaState;
        const equippedUid = meta.equippedTokens[tokenData.type];
        const equippedItem = equippedUid ? meta.inventory.find(i => i.uid === equippedUid) : null;
        let compareLine = '';
        if (equippedItem) {
            const equippedTokenData = TOKENS[equippedItem.id];
            const diffLines = computeEffectDiff(equippedTokenData, equippedItem.rarity, tokenData, invItem.rarity);
            compareLine = `\nvs ${equippedTokenData.name} (equipped): ${diffLines.length ? diffLines.join(', ') : '(no change)'}`;
        }

        this.detailSet.innerText = `Set: ${setData.name} | (2) ${setData['2']} | (4) ${setData['4']}\n${rarityDeltaLine}${compareLine}\n\n[CLICK PRESCRIBE TO EQUIP]`;

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
        // Patch 33: same effect formatter as the inventory hover tooltip and the
        // forge preview above, so all three surfaces agree with each other.
        const currentEffects = formatTokenEffects(tokenData, invItem.rarity).join(', ') || '(no numeric effect)';
        this.detailSet.innerText = `Set: ${setData.name} | (2) ${setData['2']} | (4) ${setData['4']}\nActive: ${currentEffects}`;

        this.btnEquipItem.style.display = 'none';
        this.btnUnequipItem.style.display = 'block';
        this.btnUpgradeItem.style.display = 'none';
    }
}