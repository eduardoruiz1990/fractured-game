// src/ui/FolderTabs.js
//
// Patch 129 (V2 plan C6): eight folder tabs become four.
//
// The clinical folder had eight top-level tabs — ~1000px of strip on a 390px phone,
// scrolling sideways with the scrollbar hidden, so most of them were never found.
// They are now four groups — DESCEND, SYNAPSES, LOADOUT, RECORDS — and a group with
// more than one pane shows a small row of sub-tabs under it.
//
// NOTHING about the panes changes. The eight `.tab-btn` buttons stay in the DOM with
// their ids, data-targets and UIManager's click handler (which renders each pane on
// open); they simply become the sub-tab row, showing only the active group's
// buttons. A group button activates a pane by clicking that pane's own `.tab-btn`,
// so there is one code path for "open a pane", whichever button was pressed.
//
// The groups follow whichever pane is active via a MutationObserver on the strip,
// so every other route that activates a tab directly — the hub zones in main.js
// (triggerInteraction), the QA scripts — keeps the group row in step without
// knowing it exists.

export const TAB_GROUPS = [
    { id: 'descend',  label: 'DESCEND',  panes: [['tab-main', 'EVALUATION'], ['tab-roadmap', 'DESCENT ROADMAP']] },
    { id: 'synapses', label: 'SYNAPSES', panes: [['tab-tree', 'SYNAPSE RECORDS']] },
    { id: 'loadout',  label: 'LOADOUT',  panes: [['tab-loadout', 'THERAPY REGIMEN'], ['tab-curses', 'INTRUSIVE THOUGHTS']] },
    // Patch 144: CASE FILE (the story's pages) — its button and pane are built by UIManager.
    { id: 'records',  label: 'RECORDS',  panes: [['tab-trophies', 'MIND PALACE'], ['tab-casefile', 'CASE FILE'], ['tab-history', 'MANIFESTATION LOG'], ['tab-guide', 'CLINICAL GUIDE']] }
];

/** Which group a pane id belongs to (null for an unknown pane). */
export function groupOfPane(paneId) {
    const g = TAB_GROUPS.find(gr => gr.panes.some(([id]) => id === paneId));
    return g ? g.id : null;
}

export class FolderTabs {
    constructor(strip = null) {
        this.strip = strip || (typeof document !== 'undefined' ? document.querySelector('.folder-tabs') : null);
        this.groupRow = null;
        this.lastPane = {};   // group id -> last pane opened in it
        this.activeGroup = null;
        if (this.strip) this.build();
    }

    build() {
        const strip = this.strip;
        strip.classList.add('subtabs');

        // Reorder the sub buttons to the group order, so each group's sub-tabs sit
        // together and in a deliberate order.
        TAB_GROUPS.forEach(g => g.panes.forEach(([paneId, label]) => {
            const btn = strip.querySelector(`.tab-btn[data-target="${paneId}"]`);
            if (!btn) return;
            btn.dataset.group = g.id;
            btn.textContent = label;
            strip.appendChild(btn);
        }));

        const row = document.createElement('div');
        row.className = 'folder-groups';
        row.setAttribute('role', 'tablist');
        TAB_GROUPS.forEach(g => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'group-btn';
            b.dataset.group = g.id;
            b.textContent = g.label;
            b.addEventListener('click', () => this.openGroup(g.id));
            row.appendChild(b);
        });
        strip.parentNode.insertBefore(row, strip);
        this.groupRow = row;

        if (typeof MutationObserver !== 'undefined') {
            this.observer = new MutationObserver(() => this.sync());
            this.observer.observe(strip, { subtree: true, attributes: true, attributeFilter: ['class'] });
        }
        this.sync();
    }

    /** Opens a group on the pane last used in it (its first pane otherwise). */
    openGroup(groupId) {
        const g = TAB_GROUPS.find(gr => gr.id === groupId);
        if (!g) return;
        const pane = this.lastPane[groupId] || g.panes[0][0];
        const btn = this.strip.querySelector(`.tab-btn[data-target="${pane}"]`);
        if (btn) btn.click();
    }

    /** Brings the group row and the visible sub-tabs in line with the active pane. */
    sync() {
        const active = this.strip.querySelector('.tab-btn.active');
        const groupId = active ? active.dataset.group : TAB_GROUPS[0].id;
        if (active) this.lastPane[groupId] = active.dataset.target;
        this.activeGroup = groupId;
        const g = TAB_GROUPS.find(gr => gr.id === groupId);
        this.strip.classList.toggle('single', !g || g.panes.length < 2);
        this.strip.querySelectorAll('.tab-btn').forEach(b => {
            b.classList.toggle('group-hidden', b.dataset.group !== groupId);
        });
        if (this.groupRow) {
            this.groupRow.querySelectorAll('.group-btn').forEach(b => {
                const on = b.dataset.group === groupId;
                b.classList.toggle('active', on);
                b.setAttribute('aria-selected', on ? 'true' : 'false');
            });
        }
    }
}
