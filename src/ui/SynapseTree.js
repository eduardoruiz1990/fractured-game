// src/ui/SynapseTree.js
// Patch 29.6: DOM-only renderer for the Synapse Tree (no canvas, no SVG). Builds
// into a container element handed to it — nothing in index.html/UIManager.js
// points at this yet; that wiring is Patch 29.7's job. Reuses the existing
// .synapse-node-file / .file-btn vocabulary from the old flat upgrade rows (see
// Patch 29.8's Keep clause) rather than inventing new class names, so the visual
// polish pass can layer state-based styling (purchased/available/unaffordable/
// locked) directly onto what's built here.
import { SYNAPSE_NODES, SYNAPSE_NODES_BY_ID } from '../data/SynapseNodes.js';

const BRANCH_ORDER = ['RESILIENCE', 'FOCUS', 'MOTOR', 'FORTUNE'];
const BRANCH_LABELS = { RESILIENCE: 'RESILIENCE', FOCUS: 'FOCUS', MOTOR: 'MOTOR', FORTUNE: 'FORTUNE' };
const STYLE_TAG_ID = 'synapse-tree-structural-styles';

export class SynapseTree {
    constructor(container, saveManager) {
        this.container = container;
        this.saveManager = saveManager;
        this._injectStyles();
    }

    // Structural grid/connector layout only — node STATE visuals (purchased
    // stamp, gold border, unaffordable red, locked desaturation) are Patch 29.8's
    // job in style.css. Scoped under #synapse-tree-grid so none of this leaks
    // onto the old #tab-tree rows' existing .synapse-node-file/.file-btn usage.
    _injectStyles() {
        if (document.getElementById(STYLE_TAG_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_TAG_ID;
        style.textContent = `
            #synapse-tree-grid {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 12px;
                overflow-y: auto;
                overflow-x: auto;
                min-width: 620px;
            }
            #synapse-tree-header {
                position: sticky;
                top: 0;
                z-index: 5;
                display: flex;
                justify-content: space-between;
                padding: 10px 14px;
                margin-bottom: 12px;
                background: rgba(253, 250, 243, 0.95);
                border-bottom: 2px dashed #c2b59b;
                font-weight: bold;
            }
            .synapse-branch-col { display: flex; flex-direction: column; min-width: 140px; }
            .synapse-branch-header {
                text-align: center; font-weight: bold; padding: 6px 0; margin-bottom: 8px;
                border-bottom: 2px solid currentColor;
            }
            .synapse-tier-row { display: flex; gap: 8px; margin-top: 12px; }
            .synapse-tier-row:first-of-type { margin-top: 0; }
            .synapse-tier-row.split > * { flex: 1; min-width: 0; }
            #synapse-tree-grid .synapse-node-file {
                width: auto; max-width: none; min-height: 80px;
                flex-direction: column; align-items: flex-start; justify-content: flex-start;
                gap: 4px; padding: 8px 10px; margin-bottom: 0;
                box-sizing: border-box; position: relative;
            }
            #synapse-tree-grid .synapse-node-file.synapse-connected::before {
                content: ''; position: absolute; top: -12px; left: 50%;
                width: 2px; height: 12px; background: var(--connector-color, #999);
            }
            #synapse-tree-grid .synapse-node-name { font-size: 0.8rem; font-weight: bold; }
            #synapse-tree-grid .synapse-node-desc { font-size: 0.68rem; opacity: 0.75; line-height: 1.15; flex: 1; }
            #synapse-tree-grid .synapse-node-badge { font-size: 0.62rem; font-style: italic; opacity: 0.8; }
            #synapse-tree-grid .file-btn.small { width: 100%; margin-top: auto; }
            .synapse-capstone-row {
                grid-column: 1 / -1;
                display: flex; gap: 12px; margin-top: 16px; padding-top: 12px;
                border-top: 2px dashed #c2b59b;
            }
            .synapse-capstone-row > .synapse-node-file { flex: 1; }
        `;
        document.head.appendChild(style);
    }

    // Mirrors buyNode's own validation order for DISPLAY purposes only — buyNode
    // itself remains the sole authority; a click that somehow slips past this is
    // still rejected there.
    _nodeState(node, ownedSet, patientLevel) {
        if (ownedSet.has(node.id)) return 'purchased';

        const neededCount = node.requireMode === 'any' ? (node.requireCount || 1) : node.requires.length;
        const satisfiedCount = node.requires.filter(r => ownedSet.has(r)).length;
        if (satisfiedCount < neededCount) return 'locked';

        if (node.minPatientLevel !== null && node.minPatientLevel !== undefined && patientLevel < node.minPatientLevel) {
            return 'locked';
        }

        const bank = (this.saveManager && this.saveManager.metaState) ? this.saveManager.metaState.lucidityBank : 0;
        if (bank < node.cost) return 'unaffordable';

        return 'available';
    }

    _requiresBadgeText(node) {
        const names = node.requires.map(id => (SYNAPSE_NODES_BY_ID[id] || {}).name || id);
        if (node.requireMode === 'any') {
            const count = node.requireCount || 1;
            const phrase = count === 1 ? 'Requires any of' : `Requires any ${count} of`;
            return `${phrase}: ${names.join(', ')}`;
        }
        return `Requires: ${names.join(' + ')}`;
    }

    _buildNodeCard(node, ownedSet, patientLevel, { showConnector = false } = {}) {
        const state = this._nodeState(node, ownedSet, patientLevel);

        const card = document.createElement('div');
        card.className = `synapse-node-file synapse-node--${state}`;
        card.dataset.nodeId = node.id;
        card.style.setProperty('--connector-color', node.color);
        if (showConnector) card.classList.add('synapse-connected');

        const name = document.createElement('div');
        name.className = 'synapse-node-name';
        name.style.color = node.color;
        name.textContent = node.name;
        card.appendChild(name);

        const desc = document.createElement('div');
        desc.className = 'synapse-node-desc';
        desc.textContent = node.desc;
        card.appendChild(desc);

        // Text badge instead of a diagonal connector line, for anything with more
        // than one prerequisite (two-parent tier-7 nodes, cross-branch capstones).
        const needsBadge = node.requires.length > 1 || node.requireMode === 'any';
        if (needsBadge) {
            const badge = document.createElement('div');
            badge.className = 'synapse-node-badge';
            badge.textContent = this._requiresBadgeText(node);
            card.appendChild(badge);
        }

        const btn = document.createElement('button');
        btn.className = 'file-btn small';
        if (state === 'purchased') {
            btn.textContent = 'AUTHORISED';
            btn.disabled = true;
        } else if (state === 'locked') {
            btn.textContent = (node.minPatientLevel !== null && node.minPatientLevel !== undefined)
                ? `PATIENT LEVEL ${node.minPatientLevel} REQUIRED`
                : 'LOCKED';
            btn.disabled = true;
        } else {
            btn.textContent = `${node.cost} L`;
            btn.disabled = (state === 'unaffordable');
            btn.onclick = () => this._handleBuyClick(node.id);
        }
        card.appendChild(btn);

        return card;
    }

    _handleBuyClick(nodeId) {
        if (!this.saveManager || typeof this.saveManager.buyNode !== 'function') return;
        this.saveManager.buyNode(nodeId);
        this.render();
    }

    _buildBranchColumn(branchName, ownedSet, patientLevel) {
        const nodes = SYNAPSE_NODES
            .filter(n => n.branch === branchName)
            .sort((a, b) => a.tier - b.tier);
        const byTier = tier => nodes.find(n => n.tier === tier);

        const col = document.createElement('div');
        col.className = 'synapse-branch-col';
        col.style.color = (nodes[0] || {}).color || '#999';

        const header = document.createElement('div');
        header.className = 'synapse-branch-header';
        header.textContent = BRANCH_LABELS[branchName];
        col.appendChild(header);

        // Tier 1: no connector (root). Tiers 2-6: single-parent connector.
        // Tier 7: two-parent (AND) — text badge instead, per the layout spec.
        const tier1Row = document.createElement('div');
        tier1Row.className = 'synapse-tier-row';
        tier1Row.appendChild(this._buildNodeCard(byTier(1), ownedSet, patientLevel));
        col.appendChild(tier1Row);

        const tier2Row = document.createElement('div');
        tier2Row.className = 'synapse-tier-row';
        tier2Row.appendChild(this._buildNodeCard(byTier(2), ownedSet, patientLevel, { showConnector: true }));
        col.appendChild(tier2Row);

        const tier34Row = document.createElement('div');
        tier34Row.className = 'synapse-tier-row split';
        tier34Row.appendChild(this._buildNodeCard(byTier(3), ownedSet, patientLevel, { showConnector: true }));
        tier34Row.appendChild(this._buildNodeCard(byTier(4), ownedSet, patientLevel, { showConnector: true }));
        col.appendChild(tier34Row);

        const tier56Row = document.createElement('div');
        tier56Row.className = 'synapse-tier-row split';
        tier56Row.appendChild(this._buildNodeCard(byTier(5), ownedSet, patientLevel, { showConnector: true }));
        tier56Row.appendChild(this._buildNodeCard(byTier(6), ownedSet, patientLevel, { showConnector: true }));
        col.appendChild(tier56Row);

        const tier7Row = document.createElement('div');
        tier7Row.className = 'synapse-tier-row';
        tier7Row.appendChild(this._buildNodeCard(byTier(7), ownedSet, patientLevel));
        col.appendChild(tier7Row);

        return col;
    }

    _buildCapstoneRow(ownedSet, patientLevel) {
        const row = document.createElement('div');
        row.className = 'synapse-capstone-row';
        ['C1', 'C2', 'C3'].forEach(id => {
            row.appendChild(this._buildNodeCard(SYNAPSE_NODES_BY_ID[id], ownedSet, patientLevel));
        });
        return row;
    }

    _buildHeader() {
        const meta = (this.saveManager && this.saveManager.metaState) ? this.saveManager.metaState : { lucidityBank: 0 };
        const plInfo = (this.saveManager && typeof this.saveManager.getPatientLevelInfo === 'function')
            ? this.saveManager.getPatientLevelInfo() : { level: 1 };

        const header = document.createElement('div');
        header.id = 'synapse-tree-header';

        const lucidity = document.createElement('span');
        lucidity.textContent = `LUCIDITY RESERVES: ${meta.lucidityBank || 0}`;
        header.appendChild(lucidity);

        const patLvl = document.createElement('span');
        patLvl.className = 'patient-stamp';
        patLvl.style.fontSize = '0.9rem';
        patLvl.style.padding = '3px 10px';
        patLvl.textContent = `PATIENT LEVEL ${plInfo.level}`;
        header.appendChild(patLvl);

        return header;
    }

    render() {
        if (!this.container) return;
        this.container.innerHTML = '';

        const meta = (this.saveManager && this.saveManager.metaState) ? this.saveManager.metaState : { treeNodes: [] };
        const ownedSet = new Set(meta.treeNodes || []);
        const patientLevel = (this.saveManager && typeof this.saveManager.getPatientLevelInfo === 'function')
            ? this.saveManager.getPatientLevelInfo().level : 1;

        this.container.appendChild(this._buildHeader());

        const grid = document.createElement('div');
        grid.id = 'synapse-tree-grid';

        BRANCH_ORDER.forEach(branchName => {
            grid.appendChild(this._buildBranchColumn(branchName, ownedSet, patientLevel));
        });

        grid.appendChild(this._buildCapstoneRow(ownedSet, patientLevel));

        this.container.appendChild(grid);
    }
}
