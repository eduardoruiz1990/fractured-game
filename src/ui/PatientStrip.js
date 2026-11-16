// src/ui/PatientStrip.js
//
// Patch 136 (V2 plan D1): choosing a Patient, on the run-launch path.
//
// One component, mounted in two places:
//   - the title screen, under BEGIN DESCENT (compact; hidden until a second Patient is
//     unlocked, so a first-time player's title stays exactly as uncluttered as before);
//   - the machine's EVALUATION pane, above AUTHORIZE DESCENT (always shown, locked
//     Patients included, so the unlocks read as goals).
//
// Launching stays ONE click: BEGIN DESCENT / AUTHORIZE / PLAY AGAIN all start with the
// Patient last chosen here (SaveManager.metaState.selectedCharacter, read by
// Game.init). Picking a chip only changes that choice.

import { PATIENTS, PATIENT_ORDER, isPatientUnlocked, newlyAdmitted, resolvePatient } from '../data/Patients.js';
import { MANIFESTATIONS } from '../data/Manifestations.js';

const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class PatientStrips {
    constructor(saveManager) {
        this.sm = saveManager;
        this.mounts = [];
    }

    /**
     * @param {HTMLElement} host
     * @param {{compact?: boolean}} opts  compact = title screen (hidden with one Patient)
     */
    mount(host, opts = {}) {
        if (!host) return;
        const m = { host, compact: !!opts.compact, peek: null };
        host.classList.add('patient-strip');
        if (m.compact) host.classList.add('compact');
        host.addEventListener('click', (e) => {
            const chip = e.target.closest('.patient-chip');
            if (!chip || !host.contains(chip)) return;
            const id = chip.dataset.patient;
            if (isPatientUnlocked(id, this.sm.metaState)) {
                this.sm.setSelectedCharacter(id);
                this.mounts.forEach(x => { x.peek = null; });
            } else {
                m.peek = id;   // a locked chip shows how to unlock it, here only
            }
            chip.blur();
            this.render();
        });
        this.mounts.push(m);
        this.render();
    }

    render() {
        const meta = this.sm.metaState;
        const selected = resolvePatient(meta.selectedCharacter, meta);
        const fresh = newlyAdmitted(meta);
        const unlockedCount = PATIENT_ORDER.filter(id => isPatientUnlocked(id, meta)).length;
        for (const m of this.mounts) {
            if (m.compact && unlockedCount < 2) { m.host.style.display = 'none'; continue; }
            m.host.style.display = '';
            const chips = PATIENT_ORDER.map(id => {
                const p = PATIENTS[id];
                const open = isPatientUnlocked(id, meta);
                if (m.compact && !open) return '';
                const cls = ['patient-chip', open ? '' : 'locked', id === selected ? 'selected' : '', id === m.peek ? 'peek' : ''].join(' ');
                const badge = fresh.includes(id) ? '<span class="patient-new">NEW</span>' : '';
                return `<button type="button" class="${cls}" data-patient="${id}" aria-pressed="${id === selected}">
                    <span class="patient-icon">${open ? p.icon : '🔒'}</span>
                    <span class="patient-name">${esc(p.name.replace(/^THE /, ''))}</span>${badge}
                </button>`;
            }).join('');
            const show = PATIENTS[m.peek] || PATIENTS[selected];
            const locked = m.peek && !isPatientUnlocked(m.peek, meta);
            const wep = MANIFESTATIONS[show.weapon] ? MANIFESTATIONS[show.weapon].name : show.weapon;
            const detail = locked
                ? `<strong>${esc(show.name)}</strong> — LOCKED. ${esc(show.unlockText)}`
                : `<strong>${esc(show.name)}</strong> · ${esc(wep)}<br>${esc(show.passive)} <em>${esc(show.lean)}</em>`;
            const label = m.compact ? `PATIENT · ${esc(PATIENTS[selected].name.replace(/^THE /, ''))}` : 'PATIENT';
            m.host.innerHTML = `<div class="patient-label">${label}</div><div class="patient-chips">${chips}</div>`
                + (m.compact ? '' : `<div class="patient-detail">${detail}</div>`);
        }
    }
}
