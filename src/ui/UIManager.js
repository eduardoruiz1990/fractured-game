// src/ui/UIManager.js
import { TOKENS, TOKEN_RARITIES, TOKEN_SETS, TOKEN_SLOT_TYPES, INTRUSIVE_THOUGHTS, MANIFESTATIONS, PLAYER_WEAPON_IDS, ENEMY_BESTIARY, SYNERGIES } from '../data/Manifestations.js';
import { synergyRecipe } from './SynergyBanner.js';
import { EVOLUTIONS, evolutionRecipe } from '../systems/Evolutions.js';   // Patch 134

// Patch 126: synergy names/descs are static data today, but escaped anyway — the
// codex builds markup from them.
const escapeText = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
import { SynapseTree } from './SynapseTree.js';
import { GuideUI } from './GuideUI.js';
import { FolderTabs } from './FolderTabs.js';
import { renderCaseFile, playEnding, installContentNote } from './StoryUI.js';   // Patches 143–147
import { PatientStrips } from './PatientStrip.js';   // Patch 136
import { ACHIEVEMENTS, achievementProgress, totalKills } from '../data/Achievements.js';   // Patch 139
import { WEAPON_UNLOCKS, isWeaponUnlocked } from '../data/Unlocks.js';
import { PATIENTS, PATIENT_ORDER, isPatientUnlocked } from '../data/Patients.js';
import { showConfirm } from './Dialog.js';
import { BOONS } from './LevelUpUI.js';
// Patch 98 — the roadmap reports depth past floor 5. See src/core/Endless.js.
import { isEndless, cycleLabel } from '../core/Endless.js';

// Matches the hardcoded progression chain in SaveManager.upgradeToken() exactly —
// that method does NOT derive the chain from TOKEN_RARITIES, it's a separate
// hardcoded if/else, so this order must be kept in sync with it by hand.
const RARITY_UPGRADE_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic'];

// Patch 33: human-readable line per resolver stat key. Mirrors the exact
// vocabulary SaveManager.getResolvedTokenEffects() reads (see Patch 31/31b) —
// adding a stat there without a label here just means the hover preview silently
// skips it, never throws.
const TOKEN_EFFECT_LABELS = {
    sanity: v => `${v > 0 ? '+' : ''}${v} Max Sanity`,
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
    twitch_cooldown: 'Cooldowns shrink as Sanity drops',
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

// Patch 191: a structured comparison of a candidate token against the one worn in its
// slot, for the card badges and the detail panel. Built on the same scaling as
// computeEffectDiff, so the two cannot disagree.
//
//   rows     one per numeric attribute either token has: { label, from, to, delta,
//            shared, better } where `shared` means BOTH tokens affect it (a like-for-like
//            comparison) and `better` is true/false/null (null = no change)
//   grants   { lose, gain } special effects swapped
//   verdict  'new'     nothing is worn in the slot
//            'up'      the same token at a higher rarity (or strictly better on every line)
//            'down'    the same token at a lower rarity (or strictly worse on every line)
//            'same'    no difference
//            'diff'    a different effect; `lean` says which way the SHARED attributes
//                      point: 'up', 'down', 'mixed' or null when nothing is shared
const LOWER_IS_BETTER = new Set(['dashCooldown']);
function scaledEffects(tokenData, rarity) {
    const mult = (TOKEN_RARITIES[rarity] && TOKEN_RARITIES[rarity].multiplier) || 1.0;
    const out = {};
    for (const [key, value] of Object.entries((tokenData && tokenData.effects) || {})) {
        if (key === 'tagDamage') {
            for (const [tag, amt] of Object.entries(value)) out[`tagDamage:${tag}`] = amt > 0 ? Math.round(amt * mult) : amt;
        } else if (TOKEN_EFFECT_LABELS[key]) {
            out[key] = value > 0 ? Math.round(value * mult) : value;
        }
    }
    return out;
}
function effectLabel(key, v) {
    if (key.startsWith('tagDamage:')) return `${v > 0 ? '+' : ''}${v}% ${key.replace('tagDamage:', '')} damage`;
    return TOKEN_EFFECT_LABELS[key](v);
}
export function compareTokens(wornData, wornRarity, candData, candRarity) {
    if (!wornData) return { verdict: 'new', lean: null, rows: [], grants: { lose: null, gain: null } };
    const from = scaledEffects(wornData, wornRarity), to = scaledEffects(candData, candRarity);
    const rows = [];
    new Set([...Object.keys(from), ...Object.keys(to)]).forEach(key => {
        const a = from[key] || 0, b = to[key] || 0, delta = b - a;
        const shared = key in from && key in to;
        const base = key.startsWith('tagDamage:') ? key : key;
        const better = delta === 0 ? null : (LOWER_IS_BETTER.has(base) ? delta < 0 : delta > 0);
        rows.push({ key, shared, from: key in from ? effectLabel(key, a) : null, to: key in to ? effectLabel(key, b) : null,
            delta: delta === 0 ? null : effectLabel(key, delta), better });
    });
    const fromGrant = (wornData.effects && wornData.effects.grant) || null;
    const toGrant = (candData.effects && candData.effects.grant) || null;
    const grants = fromGrant !== toGrant
        ? { lose: fromGrant ? (TOKEN_GRANT_LABELS[fromGrant] || fromGrant) : null, gain: toGrant ? (TOKEN_GRANT_LABELS[toGrant] || toGrant) : null }
        : { lose: null, gain: null };
    const changed = rows.filter(r => r.better !== null);
    const anyGrant = !!(grants.lose || grants.gain);
    const sharedRows = changed.filter(r => r.shared);
    const lean = !sharedRows.length ? null
        : sharedRows.every(r => r.better) ? 'up' : sharedRows.every(r => !r.better) ? 'down' : 'mixed';
    let verdict;
    if (wornData.id === candData.id) {
        const a = RARITY_UPGRADE_ORDER.indexOf(wornRarity), b = RARITY_UPGRADE_ORDER.indexOf(candRarity);
        verdict = b > a ? 'up' : b < a ? 'down' : 'same';
    } else if (!changed.length && !anyGrant) verdict = 'same';
    else if (!anyGrant && changed.every(r => r.better)) verdict = 'up';
    else if (!anyGrant && changed.every(r => !r.better)) verdict = 'down';
    else verdict = 'diff';
    return { verdict, lean, rows, grants };
}
const COMPARE_BADGE = {
    new:  { text: '+', title: 'Nothing is worn in this slot' },
    up:   { text: '▲', title: 'Better than what you are wearing' },
    down: { text: '▼', title: 'Worse than what you are wearing' },
    same: { text: '=', title: 'The same as what you are wearing' },
    diff: { text: '≠', title: 'A different effect from what you are wearing' }
};

// Patch 176: the paper doll in the LOADOUT pane (renderSlotChips).
const DOLL_SLOT_ICONS = { head: '🧠', body: '🦺', hands: '🧤', legs: '👟', prescription: '💊' };
const DOLL_SVG = `<svg viewBox="0 0 120 190" xmlns="http://www.w3.org/2000/svg">
  <defs><radialGradient id="dollGlow" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#e9c877" stop-opacity="0.28"/><stop offset="1" stop-color="#e9c877" stop-opacity="0"/></radialGradient></defs>
  <ellipse cx="60" cy="92" rx="58" ry="88" fill="url(#dollGlow)"/>
  <ellipse cx="60" cy="178" rx="34" ry="7" fill="rgba(0,0,0,0.5)"/>
  <g stroke="#0b0d14" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <path d="M47 118 L44 166 L55 166 L60 126 L65 166 L76 166 L73 118 Z" fill="#39446a"/>
    <path d="M40 166 h17 v8 h-19 z M63 166 h17 l2 8 h-19 z" fill="#d9d2c2"/>
    <path d="M36 66 Q60 56 84 66 L80 122 Q60 128 40 122 Z" fill="#3f78b5"/>
    <path d="M36 68 L22 104 L30 108 L42 82 Z M84 68 L98 104 L90 108 L78 82 Z" fill="#3f78b5"/>
    <circle cx="25" cy="109" r="6" fill="#efd2b0"/><circle cx="95" cy="109" r="6" fill="#efd2b0"/>
    <rect x="92" y="100" width="20" height="8" rx="2" fill="#5a5f6a"/><circle cx="113" cy="104" r="4.5" fill="#fff6cc"/>
    <circle cx="60" cy="40" r="21" fill="#efd2b0"/>
    <path d="M39 38 Q40 16 60 17 Q80 16 81 38 Q70 26 60 29 Q50 26 39 38 Z" fill="#2b2530"/>
  </g>
  <circle cx="52" cy="42" r="2.6" fill="#12141c"/><circle cx="68" cy="42" r="2.6" fill="#12141c"/>
  <path d="M54 52 Q60 55 66 52" stroke="#12141c" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="M47 46 q5 3 10 0 M63 46 q5 3 10 0" stroke="rgba(90,60,110,0.7)" stroke-width="1.4" fill="none"/>
</svg>`;

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
        // Patch 91: which slot the mobile chip strip is filtering to, or 'all'.
        // Defaults to 'all' so the screen OPENS showing the whole collection — nothing
        // is hidden until the player asks for it — and so the desktop path, where the
        // chips are display:none and can never be clicked, is bit-identical to before.
        this.loadoutSlotFilter = 'all';

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
        // Patches 55/56: the catalogue half of the Clinical Guide. Rendered ONCE here
        // rather than from updateMenuUI() — it is built purely from static game data,
        // so re-rendering it on every menu refresh would be pure waste (it is by far
        // the largest block of markup in the folder).
        this.guideUI = new GuideUI(document.getElementById('guide-dynamic'));
        this.guideUI.render();

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
        // Patch 52: btn-enter-system (the old INITIALIZE) no longer exists — the title
        // screen's three actions are wired directly in main.js, which owns the
        // gameState machine. Kept pointing at the hub button so this binding refers to
        // something real rather than silently holding null.
        this.btnTitleHub = document.getElementById('btn-title-hub');

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

        // Patch 144 (V2 plan E3): the CASE FILE pane and its sub-tab button, built here
        // (index.html untouched) BEFORE the buttons and panes are captured below, so it
        // is an ordinary tab to every handler that follows.
        if (!document.getElementById('tab-casefile')) {
            const hist = document.getElementById('tab-history');
            const histBtn = document.querySelector('.tab-btn[data-target="tab-history"]');
            if (hist && histBtn) {
                const pane = document.createElement('div');
                pane.id = 'tab-casefile';
                pane.className = 'tab-pane';
                hist.parentNode.insertBefore(pane, hist);
                const b = document.createElement('button');
                b.className = 'tab-btn';
                b.dataset.target = 'tab-casefile';
                b.textContent = 'CASE FILE';
                histBtn.parentNode.insertBefore(b, histBtn);
            }
        }
        installContentNote();   // Patch 143 (E6): the content note heads the Clinical Guide

        this.tabBtns = document.querySelectorAll('.tab-btn');
        this.tabPanes = document.querySelectorAll('.tab-pane');
        // Patch 129: the eight tabs grouped into four (see FolderTabs.js). Built after
        // tabBtns is captured: the same buttons, regrouped, keep their handlers.
        this.folderTabs = new FolderTabs();

        // Patch 136 (V2 plan D1): the Patient picker, on the title (compact) and in
        // the EVALUATION pane. Hosts are created here so index.html is untouched.
        this.patientStrips = new PatientStrips(this.saveManager);
        const titleBegin = document.getElementById('btn-title-begin');
        if (titleBegin && titleBegin.parentNode) {
            const t = document.createElement('div');
            t.id = 'title-patient-strip';
            titleBegin.parentNode.insertBefore(t, titleBegin.nextSibling);
            this.patientStrips.mount(t, { compact: true });
        }
        const startBtn = document.getElementById('btn-start');
        if (startBtn && startBtn.parentNode && startBtn.parentNode.parentNode) {
            const f = document.createElement('div');
            f.id = 'folder-patient-strip';
            startBtn.parentNode.parentNode.insertBefore(f, startBtn.parentNode);
            this.patientStrips.mount(f, { compact: false });
        }

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
                } else if (targetId === 'tab-casefile') {
                    this.renderCaseFilePane();   // Patch 144
                } else if (targetId === 'tab-tree' || targetId === 'tab-main' || targetId === 'tab-trophies' || targetId === 'tab-curses' || targetId === 'tab-history') {
                    // tab-history added (Patch 57): the log changes mid-session as the
                    // player picks things, so it has to re-read on open rather than
                    // showing whatever was true when the folder was first built.
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
            this.btnExportSave.addEventListener('click', () => this.runExportSave());
        }

        // Patch 92: the export routine, extracted from the button handler above so the
        // milestone backup prompt (main.js, maybeShowBackupPrompt) can offer a DIRECT
        // route to export rather than only naming the tab it lives in. One code path,
        // so the button and the prompt cannot drift.
        //
        // SaveManager.exportSave() itself is untouched — same base64, same format.
        // The only change to the surrounding UI flow is the `navigator.clipboard`
        // existence check: the old code called `.writeText` unconditionally, which
        // throws a TypeError (not a rejection, so the .catch never ran) wherever the
        // Clipboard API is absent — non-secure contexts and several in-app webviews,
        // i.e. exactly the itch.io embed cases this patch exists for. That threw away
        // the player's only backup route with no fallback and no message. It now
        // falls through to the same prompt() path a rejection already used.

        if (this.btnImportSave) {
            // Patch 103: in-world dialogs, no native prompt()/alert() (V2 plan A2).
            this.btnImportSave.addEventListener('click', () => this.runImportSave());
        }

        if (this.btnWipeSave) {
            this.btnWipeSave.addEventListener('click', () => {
                showConfirm({
                    title: 'DESTROY CLINICAL FILE?',
                    body: 'This will completely erase your clinical file.',
                    note: 'All tokens, upgrades and banked Lucidity are destroyed. This cannot be undone.',
                    confirmLabel: 'ERASE EVERYTHING',
                    cancelLabel: 'KEEP MY FILE',
                    onConfirm: () => this.saveManager.wipeSave()
                });
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

    /**
     * Exports the clinical file to the clipboard, with an in-world copyable fallback (Patch 103).
     *
     * Patch 92: extracted verbatim from the EXPORT button's click handler so the
     * milestone backup prompt can call the same path. Callers are the EVALUATION
     * tab's button and main.js's maybeShowBackupPrompt().
     *
     * @returns {boolean} false only when SaveManager could not serialize the save.
     */
    runExportSave() {
        const encoded = this.saveManager.exportSave();
        if (!encoded) {
            showConfirm({
                noticeOnly: true, title: 'EXPORT FAILED',
                body: 'The clinical file could not be read for export.',
                confirmLabel: 'UNDERSTOOD'
            });
            return false;
        }
        // Patch 103: the manual-copy fallback is now an in-world read-only field,
        // opened pre-selected, instead of a native prompt() (blocked in many iframes).
        const showManualCopy = () => showConfirm({
            danger: false, noticeOnly: true,
            title: 'BACK UP FILE',
            body: 'Copy this text and keep it somewhere safe.',
            note: 'Paste it into RESTORE FILE to recover your progress on any browser.',
            confirmLabel: 'DONE',
            input: { value: encoded, readOnly: true }
        });
        // Guarded because `navigator.clipboard` is undefined outside a secure context
        // and in several in-app webviews; calling through it there throws
        // synchronously, which the .catch below cannot see.
        const clip = (typeof navigator !== 'undefined' && navigator.clipboard) ? navigator.clipboard : null;
        if (!clip || typeof clip.writeText !== 'function') {
            showManualCopy();
            return true;
        }
        clip.writeText(encoded).then(() => {
            showConfirm({
                danger: false, noticeOnly: true,
                title: 'FILE COPIED',
                body: 'Clinical file copied to your clipboard.',
                note: 'Paste it somewhere safe. RESTORE FILE brings it back.',
                confirmLabel: 'UNDERSTOOD'
            });
        }).catch(showManualCopy);
        return true;
    }

    /**
     * Patch 103: save import through the in-world dialog (was native prompt/alert).
     * SaveManager.importSave() is untouched — same base64 format, same validation.
     */
    runImportSave() {
        showConfirm({
            danger: false,
            title: 'RESTORE FILE',
            body: 'Paste your exported clinical file below.',
            note: 'This replaces the file currently in use.',
            confirmLabel: 'RECONSTRUCT FILE',
            cancelLabel: 'RETURN',
            input: { value: '', placeholder: 'Paste the file text here' },
            onConfirm: (raw) => {
                const encoded = (raw || '').trim();
                if (!encoded) return;
                if (this.saveManager.importSave(encoded)) {
                    showConfirm({
                        danger: false, noticeOnly: true,
                        title: 'FILE RECONSTRUCTED',
                        body: 'Clinical file successfully reconstructed.',
                        confirmLabel: 'RELOAD',
                        // Escape too: the save is already replaced, so every exit reloads.
                        onConfirm: () => window.location.reload(),
                        onCancel: () => window.location.reload()
                    });
                } else {
                    showConfirm({
                        noticeOnly: true,
                        title: 'IMPORT FAILED',
                        body: 'File corruption detected. Nothing was changed.',
                        confirmLabel: 'UNDERSTOOD'
                    });
                }
            }
        });
    }

    updateMenuUI() {
        const meta = this.saveManager.metaState;
        if (this.patientStrips) this.patientStrips.render();   // Patch 136
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
        this.renderCaseFilePane();   // Patch 144
        this.renderCurseSelection();
        this.renderBoonHistory();
    }

    /** Patch 144 (V2 plan E3): RECORDS → CASE FILE. Endings seen can be replayed (E5). */
    renderCaseFilePane() {
        const pane = document.getElementById('tab-casefile');
        if (!pane) return;
        renderCaseFile(pane, this.saveManager.metaState, {
            onReplay: (kind) => playEnding(kind, this.saveManager.metaState, { choice: false })
        });
    }

    /**
     * Lifetime manifestation record (Patch 57).
     *
     * Redacted-until-first-pick, deliberately reusing renderRoadmap()'s exact
     * vocabulary — .roadmap-node + .locked, a "SEALED" status chip and
     * .redacted-text for the name — so an unmanifested boon reads as withheld in
     * the same way an unreached floor does, rather than as a second, unrelated
     * "locked" idiom in the same folder.
     *
     * Weapons and boons share one list because the player experiences them as one
     * choice: the level-up screen offers both on the same cards.
     */
    renderBoonHistory() {
        const timeline = document.getElementById('history-timeline');
        if (!timeline) return;

        const history = (this.saveManager.metaState && this.saveManager.metaState.boonHistory) || {};

        // PLAYER_WEAPON_IDS rather than Object.keys(MANIFESTATIONS): the latter
        // includes `adrenaline`, which is not a real weapon and could never be
        // manifested, so it would sit here sealed forever (see its note in
        // Manifestations.js).
        const weaponEntries = PLAYER_WEAPON_IDS
            .filter(id => MANIFESTATIONS[id])
            .map(id => ({
                id,
                name: MANIFESTATIONS[id].name,
                desc: MANIFESTATIONS[id].desc,
                kind: 'INSTRUMENT',
                maxLvl: MANIFESTATIONS[id].maxLvl || 5
            }));

        const boonEntries = BOONS.map(b => ({
            id: b.id, name: b.name, desc: b.desc, kind: 'TRAIT', maxLvl: null
        }));

        const all = [...weaponEntries, ...boonEntries];
        const discovered = all.filter(e => (history[e.id] && history[e.id].timesChosen > 0)).length;
        const pct = all.length ? Math.round((discovered / all.length) * 100) : 0;

        timeline.innerHTML = '';

        // Patch 59: lifetime case statistics. Sits above the manifestation record
        // because it frames it — how many attempts produced this much of a record.
        const stats = this.saveManager.getRunStats();
        const statBand = document.createElement('div');
        statBand.className = 'roadmap-summary';
        const stat = (label, value, color) => `
            <div style="text-align:center; flex:1;">
                <div style="font-family:var(--ui-font); font-size:1.6rem; font-weight:900; color:${color}; line-height:1;">${value}</div>
                <div style="font-size:0.62rem; color:#6b6355; letter-spacing:2px; margin-top:4px;">${label}</div>
            </div>`;
        statBand.innerHTML = `
            <div class="roadmap-summary-row">
                <span class="section-label" style="margin:0;">CASE STATISTICS</span>
            </div>
            <div style="display:flex; gap:10px; margin-top:10px;">
                ${stat('DESCENTS', stats.runsStarted, 'var(--ink-black)')}
                ${stat('MINDS BROKEN', stats.deaths, 'var(--ui-red)')}
                ${stat('CONSTRUCTS ESCAPED', stats.runsCompleted, 'var(--ui-gold)')}
            </div>
        `;
        timeline.appendChild(statBand);

        const summary = document.createElement('div');
        summary.className = 'roadmap-summary';
        summary.innerHTML = `
            <div class="roadmap-summary-row">
                <span class="section-label" style="margin:0;">MANIFESTATION RECORD</span>
                <span class="roadmap-summary-figure">${discovered} / ${all.length} ON FILE</span>
            </div>
            <div class="roadmap-progress-track"><div class="roadmap-progress-fill" style="width:${pct}%;"></div></div>
            <div class="roadmap-summary-row roadmap-summary-sub">
                <span>INSTRUMENTS &amp; TRAITS EVER MANIFESTED</span>
                <span>${pct}%</span>
            </div>
        `;
        timeline.appendChild(summary);

        all.forEach(entry => {
            const rec = history[entry.id];
            const seen = !!(rec && rec.timesChosen > 0);

            const node = document.createElement('div');
            node.className = 'roadmap-node';
            if (seen) node.classList.add('completed');
            else node.classList.add('locked');

            if (!seen) {
                node.innerHTML = `
                    <div class="roadmap-node-head">
                        <span class="roadmap-floor-tag">${entry.kind}</span>
                        <span class="roadmap-status redacted">SEALED</span>
                    </div>
                    <div class="roadmap-area redacted-text">(UNMANIFESTED)</div>
                `;
                timeline.appendChild(node);
                return;
            }

            // Only instruments carry a level; a boon is one-shot, so showing "peak
            // level" for one would be meaningless noise.
            const peak = (entry.maxLvl && rec.highestLevelReached)
                ? `<div class="roadmap-boss">PEAK LEVEL: <strong>${rec.highestLevelReached} / ${entry.maxLvl}</strong></div>`
                : '';

            node.innerHTML = `
                <div class="roadmap-node-head">
                    <span class="roadmap-floor-tag">${entry.kind}</span>
                    <span class="roadmap-status subdued">MANIFESTED ×${rec.timesChosen}</span>
                </div>
                <div class="roadmap-area">${entry.name}</div>
                ${peak}
                <div class="roadmap-note typewriter-text">${entry.desc}</div>
            `;
            timeline.appendChild(node);
        });
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

        // Patch 98: was `Math.min(maxFloor, floors.length)`, which capped the readout at
        // 5 — correct while 5 was the end of the game, and now it would under-report
        // every endless run a player had made. The clamp is gone; the five listed
        // floors below are unaffected because they are their own array.
        const deepest = maxFloor;
        const inRecursion = isEndless(maxFloor);
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
                <span>DEEPEST REACHED: FLOOR ${deepest}${inRecursion ? ` · CYCLE ${cycleLabel(maxFloor)}` : ''}</span>
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

        // Patch 98 — THE RECURSION. Appended after the five rather than added to the
        // `floors` array on purpose: that array drives the "n / 5 SUBDUED" count and
        // the per-floor boss records above, and the Recursion has no single boss and no
        // completion state, so folding it in would corrupt both.
        //
        // Shown only once the player has actually been there. Same redaction convention
        // the rest of this screen uses — a sealed node that names an endless mode after
        // the final boss would spoil the ending to someone still on floor 2.
        if (inRecursion) {
            const rec = document.createElement('div');
            rec.className = 'roadmap-node boss active';
            rec.innerHTML = `
                <div class="roadmap-node-head">
                    <span class="roadmap-floor-tag">FLOOR 6+</span>
                    <span class="roadmap-status pending">CYCLE ${cycleLabel(maxFloor)}</span>
                </div>
                <div class="roadmap-area">THE RECURSION</div>
                <div class="roadmap-boss">SUBJECT OF RECORD: <strong>ALL OF THEM, AGAIN</strong></div>
                <div class="roadmap-note typewriter-text">
                    The construct does not end; it repeats. Each cycle re-presents all five subjects,
                    deeper and less patient than the last. Deepest floor on record: ${deepest}.
                </div>
            `;
            timeline.appendChild(rec);
        }
    }

    /**
     * The Mind Palace (Patch 59: rebuilt data-driven, with redaction).
     *
     * This is the single home for kill counts in the game — the Manifestation Log
     * deliberately does NOT repeat them. A second kill display would have meant two
     * places to read the same number and two places to keep in sync.
     *
     * Redaction matches the Manifestation Log and the Descent Roadmap: a
     * manifestation you have never killed does not announce its own name with a 0
     * beside it, it reads as withheld. Bronze/Silver/Gold tiers are unchanged.
     */
    renderTrophies() {
        const grid = document.getElementById('trophy-grid');
        if (!grid) return;

        const kills = this.saveManager.metaState.killCounts || {};
        const mobs = ENEMY_BESTIARY.filter(e => !e.boss);
        const bosses = ENEMY_BESTIARY.filter(e => e.boss);

        const heading = (text) => `
            <div style="grid-column: 1 / -1; border-bottom: 1px dashed #ccc; padding-bottom: 5px; margin-top: 10px;">
                <strong style="color: var(--ink-black);">${text}</strong>
            </div>`;

        // Tier thresholds are the pre-existing ones (10 / 1k / 10k) — only the
        // presentation around them changed.
        const mobTier = (count) => {
            if (count >= 10000) return { goal: null, color: '#ffd700', shadow: '0 0 15px #ffd700' };
            if (count >= 1000)  return { goal: 10000, color: '#c0c0c0', shadow: '0 0 10px #c0c0c0' };
            if (count >= 10)    return { goal: 1000,  color: '#cd7f32', shadow: '0 0 10px #cd7f32' };
            return { goal: 10, color: null, shadow: 'none' };
        };

        const sealedCard = () => `
            <div class="trophy-card" style="background: rgba(255, 255, 255, 0.03); border: 1px dashed rgba(255, 255, 255, 0.22); box-shadow:4px 4px 0 rgba(0,0,0,0.06); padding:15px; text-align:center;">
                <div style="font-size:3.5rem; color: #f2eee3; opacity:0.07; line-height:1;">?</div>
                <div class="redacted-text" style="font-weight:bold; margin-top:15px; font-size:0.8rem;">(UNENCOUNTERED)</div>
                <div style="font-size:0.7rem; color:#9a917f; margin-top:5px; letter-spacing:2px;">SEALED</div>
            </div>`;

        const trophyCard = (entry, count, tier, goalText) => `
            <div class="trophy-card" style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(233, 200, 119, 0.35); box-shadow:4px 4px 0 rgba(0,0,0,0.1); padding:15px; text-align:center; position:relative;">
                <div style="font-size:3.5rem; line-height:1; color:${tier.color || '#111'}; opacity:${tier.color ? 1 : 0.35}; text-shadow:${tier.shadow};">${entry.icon}</div>
                <div style="font-weight:bold; color:var(--ink-black); margin-top:15px; font-size:0.9rem;">${entry.name}</div>
                <div style="font-size:0.8rem; color: #b3adc0; margin-top:5px; font-weight:bold;">${count}${goalText}</div>
            </div>`;

        // Patch 139 (V2 plan D7): the case records, the achievements, and the unlock
        // tracks come first: they are the goals, the monuments below are the history.
        const meta = this.saveManager.metaState;
        const deepest = Number(meta.maxFloorReached) || 1;
        const depthText = isEndless(deepest) ? `Floor ${deepest} · Recursion Cycle ${cycleLabel(deepest)}` : `Floor ${deepest}`;
        const rec = (label, value) => `<div class="record-cell"><span class="record-value">${escapeText(value)}</span><span class="record-label">${label}</span></div>`;
        let html = heading('CASE RECORDS');
        html += `<div class="records-row" style="grid-column: 1 / -1;">
            ${rec('DEEPEST', depthText)}
            ${rec('DESCENTS', Number(meta.runsStarted) || 0)}
            ${rec('FLOOR 5 CLEARS', Number(meta.runsCompleted) || 0)}
            ${rec('BANISHED', totalKills(meta).toLocaleString('en-US'))}
            ${rec('NAMED ELITES', Number((meta.killCounts || {}).ELITE) || 0)}
            ${rec('CHESTS', Number((meta.stats || {}).chestsOpened) || 0)}
        </div>`;

        const got = meta.achievements || {};
        const earned = ACHIEVEMENTS.filter(a => got[a.id]).length;
        html += heading(`ACHIEVEMENTS (${earned} / ${ACHIEVEMENTS.length})`);
        ACHIEVEMENTS.forEach(a => {
            const when = got[a.id];
            const p = achievementProgress(a, meta);
            const prog = !when && p && p.goal > 1 ? `<div class="ach-progress"><span style="width:${Math.round(p.value / p.goal * 100)}%"></span></div><div class="ach-count">${p.value.toLocaleString('en-US')} / ${p.goal.toLocaleString('en-US')}</div>` : '';
            const date = when ? `<div class="ach-date">${escapeText(new Date(when).toISOString().slice(0, 10))}</div>` : '';
            html += `
            <div class="trophy-card ach-card ${when ? 'earned' : 'locked'}" data-achievement="${a.id}">
                <div class="ach-icon">${a.icon}</div>
                <div class="ach-name">${escapeText(a.name)}</div>
                <div class="ach-desc">${escapeText(a.desc)}</div>
                ${prog}${date}
            </div>`;
        });

        html += heading('UNLOCK TRACKS');
        PATIENT_ORDER.forEach(id => {
            const pt = PATIENTS[id];
            const open = isPatientUnlocked(id, meta);
            html += `
            <div class="trophy-card ach-card ${open ? 'earned' : 'locked'}" data-unlock="patient:${id}">
                <div class="ach-icon">${open ? pt.icon : '🔒'}</div>
                <div class="ach-name">${escapeText(pt.name)}</div>
                <div class="ach-desc">${open ? 'Admitted. Choose them before a descent.' : escapeText(pt.unlockText)}</div>
            </div>`;
        });
        ['pill_bottle', ...Object.keys(WEAPON_UNLOCKS)].forEach(id => {
            const open = isWeaponUnlocked(id, meta);
            const name = (MANIFESTATIONS[id] && MANIFESTATIONS[id].name) || id;
            const u = WEAPON_UNLOCKS[id];
            html += `
            <div class="trophy-card ach-card ${open ? 'earned' : 'locked'}" data-unlock="weapon:${id}">
                <div class="ach-icon">${open ? '🧰' : '🔒'}</div>
                <div class="ach-name">${escapeText(name)}</div>
                <div class="ach-desc">${open ? 'In the level-up pool.' : escapeText(u ? u.text : '')}</div>
            </div>`;
        });

        html += heading('STANDARD NIGHTMARES (Bronze: 10, Silver: 1k, Gold: 10k)');
        mobs.forEach(entry => {
            const count = kills[entry.id] || 0;
            if (count <= 0) { html += sealedCard(); return; }
            const tier = mobTier(count);
            html += trophyCard(entry, count, tier, tier.goal ? ` / ${tier.goal}` : '');
        });

        html += heading('APEX PREDATORS (Boss Monuments)');
        bosses.forEach(entry => {
            const count = kills[entry.id] || 0;
            if (count <= 0) { html += sealedCard(); return; }
            html += trophyCard(entry, count, { color: entry.color, shadow: `0 0 15px ${entry.color}` }, '');
        });

        // Patch 126 (V2 plan C3): the Synergy Codex. A synergy this profile has
        // formed shows its name and effect; one it has not is a silhouette that
        // still names its RECIPE — the point of a locked entry is to be a goal, and
        // "Rusted Flashlight + Static Receiver, both level 5" is a goal a player can
        // act on next run. The name and effect stay withheld, like a sealed trophy.
        const formed = this.saveManager.metaState.discoveredSynergies || {};
        const synIds = Object.keys(SYNERGIES);
        const formedCount = synIds.filter(id => (Number(formed[id]) || 0) > 0).length;
        html += heading(`SYNERGY CODEX (${formedCount} / ${synIds.length} formed · both instruments at level 5)`);
        synIds.forEach(id => {
            const syn = SYNERGIES[id];
            const times = Number(formed[id]) || 0;
            const recipe = escapeText(synergyRecipe(syn));
            if (times <= 0) {
                html += `
            <div class="trophy-card codex-card codex-locked" data-synergy="${id}" style="background: rgba(255, 255, 255, 0.03); border: 1px dashed rgba(255, 255, 255, 0.22); box-shadow:4px 4px 0 rgba(0,0,0,0.06); padding:15px; text-align:center;">
                <div style="font-size:2.6rem; color: #f2eee3; opacity:0.08; line-height:1;">🔗</div>
                <div class="redacted-text" style="font-weight:bold; margin-top:10px; font-size:0.8rem;">(UNFORMED)</div>
                <div style="font-size:0.72rem; color:#6f6656; margin-top:6px; line-height:1.35;">${recipe}</div>
            </div>`;
                return;
            }
            html += `
            <div class="trophy-card codex-card" data-synergy="${id}" style="background: rgba(255, 255, 255, 0.05); border:2px solid var(--ui-gold); box-shadow:4px 4px 0 rgba(0,0,0,0.1); padding:15px; text-align:center;">
                <div style="font-size:2.6rem; line-height:1;">🔗</div>
                <div style="font-weight:bold; color:var(--ink-black); margin-top:10px; font-size:0.9rem;">${escapeText(syn.name)}</div>
                <div style="font-size:0.72rem; color:#6f6656; margin-top:4px; line-height:1.35;">${recipe}</div>
                <div style="font-size:0.74rem; color: #b3adc0; margin-top:6px; line-height:1.35;">${escapeText(syn.desc)}</div>
                <div style="font-size:0.7rem; color:#8a8172; margin-top:6px; letter-spacing:1px;">FORMED ×${times}</div>
            </div>`;
        });

        // Patch 134 (V2 plan D2): the evolution codex — same rules as the synergy one:
        // an unrevealed entry shows its recipe (weapon at level 5 + boon, then a chest)
        // so it is a goal, and keeps its name and effect sealed.
        const evolved = this.saveManager.metaState.discoveredEvolutions || {};
        const evoIds = Object.keys(EVOLUTIONS);
        const evolvedCount = evoIds.filter(id => (Number(evolved[id]) || 0) > 0).length;
        html += heading(`EVOLUTION CODEX (${evolvedCount} / ${evoIds.length} · weapon at level 5 + its boon, then open an elite's chest)`);
        evoIds.forEach(id => {
            const evo = EVOLUTIONS[id];
            const times = Number(evolved[id]) || 0;
            const recipe = escapeText(evolutionRecipe(evo));
            if (times <= 0) {
                html += `
            <div class="trophy-card codex-card codex-locked" data-evolution="${id}" style="background: rgba(255, 255, 255, 0.03); border: 1px dashed rgba(255, 255, 255, 0.22); box-shadow:4px 4px 0 rgba(0,0,0,0.06); padding:15px; text-align:center;">
                <div style="font-size:2.6rem; color: #f2eee3; opacity:0.08; line-height:1;">⬆</div>
                <div class="redacted-text" style="font-weight:bold; margin-top:10px; font-size:0.8rem;">(UNEVOLVED)</div>
                <div style="font-size:0.72rem; color:#6f6656; margin-top:6px; line-height:1.35;">${recipe}</div>
            </div>`;
                return;
            }
            html += `
            <div class="trophy-card codex-card" data-evolution="${id}" style="background:#fbf8ff; border:2px solid #8e6cd8; box-shadow:4px 4px 0 rgba(0,0,0,0.1); padding:15px; text-align:center;">
                <div style="font-size:2.6rem; line-height:1; color:#8e6cd8;">⬆</div>
                <div style="font-weight:bold; color:var(--ink-black); margin-top:10px; font-size:0.9rem;">${escapeText(evo.name)}</div>
                <div style="font-size:0.72rem; color:#6f6656; margin-top:4px; line-height:1.35;">${recipe}</div>
                <div style="font-size:0.74rem; color: #b3adc0; margin-top:6px; line-height:1.35;">${escapeText(evo.desc)}</div>
                <div style="font-size:0.7rem; color:#8a8172; margin-top:6px; letter-spacing:1px;">EVOLVED ×${times}</div>
            </div>`;
        });

        grid.innerHTML = html;
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

    /**
     * The mobile slot strip (Patch 91) — one chip per equip slot, plus ALL.
     *
     * This is the phone's replacement for the whole `.equipped-panel`, which is a
     * two-column grid of `aspect-ratio: 1` squares: on a 362px screen those are 176px
     * each, so five slots plus their two section labels ran to ~550px before the
     * inventory even started, and in landscape the panel needed ~398px inside 308px of
     * available height — it structurally could not fit. A chip carries the same two
     * facts (which slot, what is in it) in 44px.
     *
     * Each chip does BOTH jobs, which is why the strip can replace the panel outright:
     * it filters the list to that slot, and — when the slot is filled — selects the
     * equipped token so the sticky action bar offers REVOKE. Without that second
     * behaviour, hiding the panel would take away the only way to unequip on a phone.
     *
     * Built at every width and hidden by CSS on desktop, matching how the Synapse
     * selector works: no render path has to know the viewport, and there is no JS copy
     * of the breakpoint to drift.
     *
     * Rebuilt on every renderLoadoutUI() rather than patched, because the chips display
     * live equipped state and this method already rebuilds the whole inventory grid;
     * six buttons alongside that is free.
     */
    renderSlotChips() {
        if (!this.inventoryGrid || !this.inventoryGrid.parentNode) return;
        const meta = this.saveManager.metaState;

        let bar = document.getElementById('loadout-slot-chips');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'loadout-slot-chips';
            this.inventoryGrid.parentNode.insertBefore(bar, this.inventoryGrid);
        }
        // Patch 191: where there is a left column (desktop; the phone layout hides it)
        // the doll goes there, above SET PROGRESS, and the whole right column is the
        // inventory. Checked on every render, so a resize settles on the next one.
        const eqPanel = document.querySelector('#tab-loadout .equipped-panel');
        let wide = false;
        try { wide = !!eqPanel && getComputedStyle(eqPanel).display !== 'none'; } catch (e) { wide = false; }
        if (wide && bar.parentNode !== eqPanel) eqPanel.insertBefore(bar, eqPanel.firstChild);
        else if (!wide && bar.parentNode !== this.inventoryGrid.parentNode) this.inventoryGrid.parentNode.insertBefore(bar, this.inventoryGrid);
        // The detail panel follows the same rule: on a desktop it sits in the left
        // column right under the doll, so the comparison is beside what is worn and
        // the inventory keeps the whole right column; on a phone it stays the sticky
        // bar at the foot of the pane.
        const details = document.getElementById('item-details');
        const invCol = this.inventoryGrid.parentNode;
        const container = document.querySelector('#tab-loadout .loadout-container');
        if (details && container) {
            if (wide && details.previousElementSibling !== bar) eqPanel.insertBefore(details, bar.nextSibling);
            else if (!wide && details.parentNode !== container.parentNode && container.parentNode) container.parentNode.insertBefore(details, container.nextSibling);
            details.classList.toggle('item-details--docked', wide);
        }
        bar.innerHTML = '';

        // Patch 176: the strip is now a paper doll. The Patient stands in the middle
        // and each slot sits by the part of the body it dresses, with the token's
        // icon and its rarity colour, so what is worn can be read at a glance.
        bar.classList.add('paper-doll');
        const fig = document.createElement('div');
        fig.className = 'doll-figure';
        fig.setAttribute('aria-hidden', 'true');
        fig.innerHTML = DOLL_SVG;
        bar.appendChild(fig);

        // 'all' first so the default state is the leftmost chip and the strip reads
        // left-to-right as "everything, then narrow it down".
        const entries = ['all', ...TOKEN_SLOT_TYPES];

        entries.forEach(slot => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'loadout-slot-chip';
            chip.dataset.slot = slot;
            if (this.loadoutSlotFilter === slot) chip.classList.add('loadout-slot-chip--active');

            const name = document.createElement('span');
            name.className = 'loadout-slot-chip-name';
            // 'prescription' is 12 characters and would set the width of the whole
            // strip; SCRIPT is what the token itself is called in-fiction anyway.
            name.textContent = slot === 'all' ? 'ALL'
                : (slot === 'prescription' ? 'SCRIPT' : slot.toUpperCase());
            chip.appendChild(name);

            const sub = document.createElement('span');
            sub.className = 'loadout-slot-chip-sub';

            let equippedItem = null;
            if (slot !== 'all') {
                const uid = meta.equippedTokens[slot];
                equippedItem = uid ? meta.inventory.find(i => i.uid === uid) : null;
                const tokenData = equippedItem ? TOKENS[equippedItem.id] : null;
                sub.textContent = tokenData ? tokenData.name : '— empty —';
                if (tokenData) chip.classList.add('loadout-slot-chip--filled');
                // Patch 176: the slot's icon, and the worn token's rarity on the frame.
                const ic = document.createElement('span');
                ic.className = 'loadout-slot-chip-icon';
                ic.textContent = DOLL_SLOT_ICONS[slot] || '◆';
                chip.insertBefore(ic, chip.firstChild);
                const rar = equippedItem && TOKEN_RARITIES[equippedItem.rarity];
                if (rar) { chip.style.borderColor = rar.color; chip.style.boxShadow = `0 0 12px ${rar.color}55, inset 0 0 0 1px ${rar.color}55`; }
            } else {
                const filled = TOKEN_SLOT_TYPES.filter(s => meta.equippedTokens[s]).length;
                sub.textContent = `${filled}/${TOKEN_SLOT_TYPES.length} worn`;
            }
            chip.appendChild(sub);

            // Patch 191: a slot on the doll takes a dragged token of its own type (the
            // old slot squares it replaced were the only drop targets).
            if (slot !== 'all') this.attachSlotDropTarget(chip, slot);

            chip.onclick = () => {
                this.loadoutSlotFilter = slot;
                // Selecting the worn token is what keeps REVOKE reachable once the
                // equipped panel is hidden. renderLoadoutUI() runs after, so the chip's
                // own active state is redrawn from the filter we just set.
                if (equippedItem) {
                    const tokenData = TOKENS[equippedItem.id];
                    if (tokenData) this.selectEquippedSlot(slot, equippedItem);
                }
                this.renderLoadoutUI();
            };

            bar.appendChild(chip);
        });
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
        this.renderSlotChips();

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

        // Patch 91: slot filter, driven by the mobile chip strip. Inert on desktop —
        // the chips are display:none there, so this stays 'all' and the list is exactly
        // what it was. Applied alongside the rarity filter rather than replacing it, so
        // the two compose ("epic head tokens") instead of fighting.
        if (this.loadoutSlotFilter && this.loadoutSlotFilter !== 'all') {
            unequippedItems = unequippedItems.filter(invItem => {
                const t = TOKENS[invItem.id];
                return t && t.type === this.loadoutSlotFilter;
            });
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
            // Patch 191: a corner badge on every card: how it compares with what is worn
            // in its slot (see compareTokens). A different item whose shared attributes
            // all point one way carries a small arrow beside the "different" sign.
            {
                const cmp = compareTokens(equippedItem ? TOKENS[equippedItem.id] : null, equippedItem && equippedItem.rarity, tokenData, invItem.rarity);
                const b = COMPARE_BADGE[cmp.verdict];
                const badge = document.createElement('span');
                badge.className = `cmp-badge cmp-${cmp.verdict}`;
                badge.textContent = b.text + (cmp.verdict === 'diff' && cmp.lean === 'up' ? '▲' : cmp.verdict === 'diff' && cmp.lean === 'down' ? '▼' : '');
                badge.title = b.title;
                badge.setAttribute('aria-label', b.title);
                el.appendChild(badge);
                if (this.selectedInventoryItem === invItem.uid) el.classList.add('inventory-item--selected');
            }
            el.onclick = () => { this.selectInventoryItem(invItem, tokenData); this.markSelectedCard(el); };
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
        this.renderCompareBlock(null, null, null, null);   // Patch 191
        this.btnEquipItem.style.display = 'none';
        this.btnUnequipItem.style.display = 'none';
        this.btnUpgradeItem.style.display = 'none';
    }

    /** Patch 191: outline the card that was just picked (the grid is not re-rendered). */
    markSelectedCard(el) {
        if (!this.inventoryGrid) return;
        this.inventoryGrid.querySelectorAll('.inventory-item--selected').forEach(n => n.classList.remove('inventory-item--selected'));
        if (el) el.classList.add('inventory-item--selected');
    }

    /**
     * Patch 191: the comparison block in the detail panel. A verdict in words and
     * colour, then one row per attribute: what the worn token gives, what this one
     * gives, and the change, green when this one is better and red when it is worse.
     * Attributes BOTH tokens affect are marked, because those are the like-for-like ones.
     * Pass a null candidate to clear it.
     */
    renderCompareBlock(wornData, wornItem, candData, candItem) {
        const host = this.detailSet && this.detailSet.parentNode;
        if (!host) return;
        let box = document.getElementById('detail-compare');
        if (!box) { box = document.createElement('div'); box.id = 'detail-compare'; host.appendChild(box); }
        if (!candData || !candItem) { box.innerHTML = ''; box.style.display = 'none'; return; }
        const esc = (v) => String(v).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
        const cmp = compareTokens(wornData, wornItem && wornItem.rarity, candData, candItem.rarity);
        const VERDICT = {
            new: ['EMPTY SLOT', 'Nothing is worn here. Equipping this only adds.'],
            up: ['UPGRADE', 'Better than what you are wearing.'],
            down: ['DOWNGRADE', 'Worse than what you are wearing.'],
            same: ['NO CHANGE', 'The same as what you are wearing.'],
            diff: ['DIFFERENT EFFECT', cmp.lean === 'up' ? 'A different item. Where they overlap, this one is better.'
                : cmp.lean === 'down' ? 'A different item. Where they overlap, this one is worse.'
                : cmp.lean === 'mixed' ? 'A different item. Where they overlap, it is better on some and worse on others.'
                : 'A different item. They do not affect the same things.']
        }[cmp.verdict];
        let html = `<div class="cmp-head"><span class="cmp-pill cmp-${cmp.verdict}">${COMPARE_BADGE[cmp.verdict].text} ${VERDICT[0]}</span>` +
            `<span class="cmp-vs">${wornData ? `vs <strong>${esc(wornData.name)}</strong> (${esc(wornItem.rarity)}), worn` : ''}</span></div>` +
            `<div class="cmp-note">${VERDICT[1]}</div>`;
        if (cmp.rows.length || cmp.grants.lose || cmp.grants.gain) {
            html += '<div class="cmp-rows">';
            // shared attributes first: they are the direct comparison
            [...cmp.rows].sort((a, b) => (b.shared ? 1 : 0) - (a.shared ? 1 : 0)).forEach(r => {
                const cls = r.better === null ? 'cmp-flat' : (r.better ? 'cmp-good' : 'cmp-bad');
                const arrow = r.better === null ? '=' : (r.better ? '▲' : '▼');
                html += `<div class="cmp-row ${cls}"><span class="cmp-attr">${r.shared ? '<em>BOTH</em>' : ''}${esc(r.to || r.from)}</span>` +
                    `<span class="cmp-was">${r.from ? esc(r.from) : 'none'} → ${r.to ? esc(r.to) : 'none'}</span>` +
                    `<span class="cmp-delta">${arrow}${r.delta ? ' ' + esc(r.delta) : ''}</span></div>`;
            });
            if (cmp.grants.lose) html += `<div class="cmp-row cmp-bad"><span class="cmp-attr">${esc(cmp.grants.lose)}</span><span class="cmp-was">special effect</span><span class="cmp-delta">▼ lose</span></div>`;
            if (cmp.grants.gain) html += `<div class="cmp-row cmp-good"><span class="cmp-attr">${esc(cmp.grants.gain)}</span><span class="cmp-was">special effect</span><span class="cmp-delta">▲ gain</span></div>`;
            html += '</div>';
        }
        box.innerHTML = html;
        box.style.display = 'block';
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
        // Patch 191: the comparison is its own block now (renderCompareBlock), not a
        // line of text at the end of this one.
        this.detailSet.innerText = `Set: ${setData.name} | (2) ${setData['2']} | (4) ${setData['4']}\n${rarityDeltaLine}`;
        this.renderCompareBlock(equippedItem ? TOKENS[equippedItem.id] : null, equippedItem, tokenData, invItem);

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
        this.renderCompareBlock(null, null, null, null);   // Patch 191: a worn token is not compared with itself

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