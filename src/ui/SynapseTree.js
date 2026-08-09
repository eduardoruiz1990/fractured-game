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

// Patch 89 — the narrow-screen panes. Four branches plus the cross-branch capstones,
// which are their own pane because they belong to no single branch.
const CAPSTONE_PANE = 'CAPSTONES';
const PANE_ORDER = [...BRANCH_ORDER, CAPSTONE_PANE];
const PANE_LABELS = { ...BRANCH_LABELS, [CAPSTONE_PANE]: 'CAPSTONES' };
const CAPSTONE_COLOR = '#c5a059';

/** A branch's colour, taken from its own nodes so this cannot drift from the data. */
function branchColor(branchName) {
    if (branchName === CAPSTONE_PANE) return CAPSTONE_COLOR;
    const node = SYNAPSE_NODES.find(n => n.branch === branchName);
    return (node && node.color) || '#999';
}

export class SynapseTree {
    // onPurchase(nodeId) is optional — called after a successful buyNode, before
    // this class's own render(). Lets a host (UIManager) react to a purchase that
    // otherwise happens entirely inside this class's own click handler, with
    // nothing telling the host it occurred (e.g. UIManager's separate
    // #tree-lucidity display, SFX, or the XP toast — none of those live in here).
    constructor(container, saveManager, onPurchase = null) {
        this.container = container;
        this.saveManager = saveManager;
        this.onPurchase = onPurchase;
        // Patch 89: which pane the narrow-screen selector is showing. Instance state,
        // not DOM state, so it survives render() — which rebuilds everything on every
        // purchase and would otherwise throw the player back to RESILIENCE each time
        // they bought a node.
        this.activeBranch = BRANCH_ORDER[0];
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

            /* Patch 90 - tier wrapper. Above the breakpoint the rail is hidden and this
               is a transparent pass-through, so a column is the same sequence of rows
               it has always been. .synapse-tier-row.split targets these now rather than
               the cards, so the card has to grow inside its own wrapper. */
            .synapse-tier { display: flex; gap: 8px; align-items: stretch; }
            .synapse-tier > .synapse-node-file { flex: 1 1 auto; min-width: 0; }
            .synapse-rail { display: none; }

            /* Patch 89 - narrow-screen branch selector. Hidden by default; the media
               query below turns it on. Living in the DOM at every width keeps render()
               unconditional - nothing here has to know the viewport. */
            #synapse-branch-nav { display: none; }

            /* --- NARROW SCREENS: ONE PILLAR AT A TIME ---------------------------
               PATCH 88 found the bug: the rules above are unconditional, and a
               4-column grid with min-width 620px and 140px columns does not fit a
               390px phone, where .folder-content leaves 362px. 258px of the tree sat
               outside the pane - MOTOR and FORTUNE, 14 of the 31 nodes, plus capstones
               C2 and C3 - and it could not be scrolled to, because .folder-content
               carries touch-action: pan-y (correctly, for the guide and inventory) so a
               finger cannot pan it sideways and a phone has no scrollbar. The
               overflow-x: auto on the grid itself does nothing: an element cannot
               scroll away its own min-width. Confirmed on device, and the confirmation
               was the proof - reachable in landscape (844px leaves 816px, so 620px
               fits), unreachable in portrait. A bug that reverses with orientation is a
               width bug.

               PATCH 89 replaces Patch 88s stopgap. That patch reflowed to a 2x2 grid,
               which made everything reachable but read wrong: two pillars above two
               pillars destroys the one thing the layout exists to say, which is that
               these are FOUR PARALLEL LANES you choose between. Reported as looking
               odd, and it did.

               Now one pillar at a time, chosen from a selector. That keeps the trees
               actual semantics - pick a lane, climb it tier by tier - gives each node
               the full 362px instead of 140px, and removes horizontal overflow rather
               than trying to make it scrollable. The selector doubles as the thing that
               TELLS a player four branches exist, which the clipped layout actively hid.

               Desktop is untouched: every rule that hides a pane lives inside this
               query, so above the breakpoint all four columns and the capstone row
               render exactly as before, and the selector stays display:none.

               BREAKPOINT. The grid needs 620px plus the folders padding. Below 768px
               .medical-folder is full-bleed with 14px padding, so the content box is
               viewport minus 28 and 620px stops fitting at ~648px; above 768px the
               folder is 90%/max-1000px with 30px padding and the narrowest case there
               (769px -> 632px) still fits. So 660px, not the 700px Patch 88 used: the
               4-column layout genuinely works down to ~648px, and swapping a working
               layout for a selector would be a downgrade. Phones in portrait
               (360-430px) get the selector; phones in landscape (844px+) and tablets in
               portrait (768px) keep the full tree. */
            /* Patch 90 widens the gate. Patch 89 keyed only on width, so a LANDSCAPE
               phone (844px wide) fell through to the desktop four-column tree inside a
               308px-tall window - the orientation the tree was least usable in. The
               height arm catches it. Requiring pointer:coarse on that arm keeps a
               desktop user who drags their window short from being handed a phone
               layout, which is the same guard Layout.js applies to portrait mode. */
            @media (max-width: 660px), (pointer: coarse) and (max-height: 560px) {
                #synapse-tree-grid {
                    grid-template-columns: 1fr;
                    min-width: 0;
                }
                .synapse-branch-col { min-width: 0; }

                #synapse-branch-nav {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 6px;
                    margin-bottom: 14px;
                }
                /* 44px floor for the same reason as Patches 85 and 87: these are the
                   only way to reach 4/5 of this screen on a phone. flex:1 1 auto lets
                   five labels of different lengths share the row and wrap when they
                   must, rather than being clipped like the folder tab strip was. */
                .synapse-branch-tab {
                    flex: 1 1 auto;
                    width: auto;
                    min-height: 44px;
                    padding: 6px 8px;
                    font-size: 0.68rem;
                    letter-spacing: 0;
                    border-color: var(--branch-color, #555);
                    color: var(--branch-color, #555);
                }
                /* Active reads as filled, matching how .tab-btn.active already signals
                   the open folder tab - same vocabulary, not a new one. */
                .synapse-branch-tab.synapse-branch-tab--active {
                    background: var(--branch-color, #555);
                    color: var(--paper-bg);
                    font-weight: 900;
                    box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.25);
                }

                /* One pane visible. Both pane types are flex containers already - the
                   branch columns column-wise, the capstone row row-wise - so a single
                   display:flex restores whichever one is active. */
                #synapse-tree-grid > [data-branch] { display: none; }
                #synapse-tree-grid > [data-branch].synapse-pane--active { display: flex; }

                /* Patch 90: the paired tiers (3/4 and 5/6) STACK here rather than
                   sitting side by side. Patch 89 kept them paired because they fit -
                   but the rail only reads as a climb if every tier is its own row with
                   its own number. Seven rows is a longer pillar; that is what scrolling
                   is for, and it is the shape the draft was approved in. */
                .synapse-tier-row.split { flex-direction: column; gap: 12px; }
                .synapse-tier-row.split > * { flex: 0 0 auto; }

                /* THE TIER RAIL. Tier order is gated information - each node requires
                   the one below it - and the four-column grid used to carry that
                   implicitly. On one pillar it has to be drawn. */
                .synapse-rail {
                    display: flex;
                    flex: 0 0 22px;
                    flex-direction: column;
                    align-items: center;
                    gap: 2px;
                    color: var(--rail-color, #999);
                }
                .synapse-rail-dot {
                    width: 20px; height: 20px; border-radius: 50%;
                    border: 2px solid currentColor; background: rgba(253, 250, 243, 0.9);
                    display: flex; align-items: center; justify-content: center;
                    font-size: 0.62rem; font-weight: bold; line-height: 1;
                    flex: 0 0 auto;
                }
                .synapse-rail-line { flex: 1 1 auto; width: 2px; background: currentColor; opacity: .3; min-height: 6px; }
                .synapse-rail--owned .synapse-rail-dot { background: var(--rail-color, #999); color: var(--paper-bg); }
                .synapse-rail--owned .synapse-rail-line { opacity: .75; }
                .synapse-rail--locked { color: #9c948a; }
                .synapse-rail--locked .synapse-rail-line { opacity: .18; }

                /* The connector stub was a desktop affordance drawn above each card. The
                   rail now says the same thing continuously and better. */
                #synapse-tree-grid .synapse-node-file.synapse-connected::before { display: none; }

                /* One reserves line, not two: index.html renders its own above this
                   component (see .tree-reserves-line in style.css, hidden there) and
                   this sticky header is the one that also carries Patient Level. */
                #synapse-tree-header { position: sticky; top: 0; }

                /* When the capstones ARE the pane, the divider they hang off is not
                   there any more, and three cards of long cross-branch text want the
                   full width each. */
                .synapse-capstone-row {
                    flex-wrap: wrap;
                    margin-top: 0;
                    padding-top: 0;
                    border-top: none;
                }
                .synapse-capstone-row > .synapse-node-file { flex: 1 1 100%; }

                #synapse-tree-header { flex-wrap: wrap; gap: 6px; }
            }
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
        const bought = this.saveManager.buyNode(nodeId);
        if (bought && typeof this.onPurchase === 'function') this.onPurchase(nodeId);
        this.render();
    }

    _buildBranchColumn(branchName, ownedSet, patientLevel) {
        const nodes = SYNAPSE_NODES
            .filter(n => n.branch === branchName)
            .sort((a, b) => a.tier - b.tier);
        const byTier = tier => nodes.find(n => n.tier === tier);

        const col = document.createElement('div');
        col.className = 'synapse-branch-col';
        // Patch 89: marks this as a selectable pane. The CSS only acts on it inside
        // the narrow-screen media query, so on desktop the attribute is inert.
        col.dataset.branch = branchName;
        col.style.color = (nodes[0] || {}).color || '#999';

        const header = document.createElement('div');
        header.className = 'synapse-branch-header';
        header.textContent = BRANCH_LABELS[branchName];
        col.appendChild(header);

        // Tier 1: no connector (root). Tiers 2-6: single-parent connector.
        // Tier 7: two-parent (AND) — text badge instead, per the layout spec.
        // Patch 90: each node is now wrapped in a .synapse-tier carrying a rail. The
        // rail is display:none above the breakpoint, so the desktop column is the same
        // sequence of rows it has always been.
        const tier = (n, opts) => this._buildTier(byTier(n), n, ownedSet, patientLevel, opts);

        const tier1Row = document.createElement('div');
        tier1Row.className = 'synapse-tier-row';
        tier1Row.appendChild(tier(1));
        col.appendChild(tier1Row);

        const tier2Row = document.createElement('div');
        tier2Row.className = 'synapse-tier-row';
        tier2Row.appendChild(tier(2, { showConnector: true }));
        col.appendChild(tier2Row);

        const tier34Row = document.createElement('div');
        tier34Row.className = 'synapse-tier-row split';
        tier34Row.appendChild(tier(3, { showConnector: true }));
        tier34Row.appendChild(tier(4, { showConnector: true }));
        col.appendChild(tier34Row);

        const tier56Row = document.createElement('div');
        tier56Row.className = 'synapse-tier-row split';
        tier56Row.appendChild(tier(5, { showConnector: true }));
        tier56Row.appendChild(tier(6, { showConnector: true }));
        col.appendChild(tier56Row);

        const tier7Row = document.createElement('div');
        tier7Row.className = 'synapse-tier-row';
        tier7Row.appendChild(tier(7));
        col.appendChild(tier7Row);

        return col;
    }

    /**
     * A node plus its tier rail (Patch 90).
     *
     * The rail is NOT decoration. Tier order is gated information — every node requires
     * the one below it — so on mobile, where the four-column grid that used to convey
     * "this is a 1 to 7 climb" is gone, the rail is what carries it. Numbered because
     * the sequence is real, which is the only thing that justifies numbering.
     *
     * Built at every width and hidden by CSS above the breakpoint, for the same reason
     * as the Patch 89 selector: render() never has to know how wide the viewport is.
     */
    _buildTier(node, tierNumber, ownedSet, patientLevel, opts = {}) {
        const wrap = document.createElement('div');
        wrap.className = 'synapse-tier';

        const state = this._nodeState(node, ownedSet, patientLevel);
        const rail = document.createElement('div');
        // Three visual states, not four: 'unaffordable' and 'available' are both
        // "not yours yet, and not blocked" as far as the climb is concerned. The card
        // itself already distinguishes them by disabling its own button.
        const railState = state === 'purchased' ? 'owned' : (state === 'locked' ? 'locked' : 'open');
        rail.className = `synapse-rail synapse-rail--${railState}`;
        rail.style.setProperty('--rail-color', node.color);

        const dot = document.createElement('span');
        dot.className = 'synapse-rail-dot';
        dot.textContent = String(tierNumber);
        rail.appendChild(dot);

        const line = document.createElement('span');
        line.className = 'synapse-rail-line';
        rail.appendChild(line);

        wrap.appendChild(rail);
        wrap.appendChild(this._buildNodeCard(node, ownedSet, patientLevel, opts));
        return wrap;
    }

    _buildCapstoneRow(ownedSet, patientLevel) {
        const row = document.createElement('div');
        row.className = 'synapse-capstone-row';
        // Patch 89: the capstones are their own pane — they belong to no single branch,
        // so they cannot live under one of the four tabs.
        row.dataset.branch = CAPSTONE_PANE;
        ['C1', 'C2', 'C3'].forEach(id => {
            row.appendChild(this._buildNodeCard(SYNAPSE_NODES_BY_ID[id], ownedSet, patientLevel));
        });
        return row;
    }

    /**
     * The narrow-screen pane selector (Patch 89).
     *
     * Built at EVERY width and hidden by CSS on desktop, so render() never has to ask
     * how wide the viewport is — the one boolean that decides the layout stays in the
     * media query, and there is no JS copy of it to drift.
     */
    _buildBranchNav() {
        const nav = document.createElement('div');
        nav.id = 'synapse-branch-nav';

        PANE_ORDER.forEach(paneId => {
            const btn = document.createElement('button');
            btn.className = 'file-btn small synapse-branch-tab';
            btn.dataset.branch = paneId;
            btn.textContent = PANE_LABELS[paneId];
            btn.style.setProperty('--branch-color', branchColor(paneId));
            // Switches panes by toggling classes rather than re-rendering: rebuilding
            // all 31 cards to change a tab would also reset the pane's scroll position,
            // and this runs on every tap.
            btn.onclick = () => {
                this.activeBranch = paneId;
                this._applyActivePane();
            };
            nav.appendChild(btn);
        });

        return nav;
    }

    /**
     * Shows exactly one pane and marks its tab.
     *
     * Purely additive to the DOM: on desktop the media query never hides anything, so
     * these classes sit there doing nothing and all four columns render as always.
     */
    _applyActivePane() {
        if (!this.grid) return;
        // Direct children only — a node card inside a column must never be mistaken
        // for a pane.
        Array.from(this.grid.children).forEach(el => {
            if (!el.dataset || !el.dataset.branch) return;
            el.classList.toggle('synapse-pane--active', el.dataset.branch === this.activeBranch);
        });
        if (this.nav) {
            Array.from(this.nav.children).forEach(btn => {
                btn.classList.toggle('synapse-branch-tab--active', btn.dataset.branch === this.activeBranch);
            });
        }
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

        // Patch 89: the pane selector sits between the header and the grid, so on a
        // phone the first thing under the reserves line is the choice of pillar.
        this.nav = this._buildBranchNav();
        this.container.appendChild(this.nav);

        const grid = document.createElement('div');
        grid.id = 'synapse-tree-grid';

        BRANCH_ORDER.forEach(branchName => {
            grid.appendChild(this._buildBranchColumn(branchName, ownedSet, patientLevel));
        });

        grid.appendChild(this._buildCapstoneRow(ownedSet, patientLevel));

        this.container.appendChild(grid);
        this.grid = grid;

        // Re-assert the selection AFTER the rebuild. render() runs on every purchase,
        // and without this a player buying a node in FORTUNE would be dropped back to
        // RESILIENCE mid-decision.
        this._applyActivePane();
    }
}
