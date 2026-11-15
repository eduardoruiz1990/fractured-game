/**
 * In-world dialog (Patch 52b; moved here and extended in Patch 103).
 *
 * The ONE dialog implementation for the whole game — confirm, one-button notice, and
 * (Patch 103) a text field for save import/export. It renders into the
 * `#confirm-modal` folder chrome in index.html. Callback-based rather than a returned
 * promise, because the caller has to be able to simply do nothing on cancel.
 *
 * Patch 103 (V2 plan A2): there is no native window.alert/confirm/prompt fallback any
 * more, anywhere in the game. Native dialogs are blocked or broken inside portal
 * iframes and are a CrazyGames requirements failure. If the markup were ever missing
 * the call is logged and nothing happens — doing nothing is the safe outcome for every
 * caller, since every onConfirm is the action, never the undo. The markup ships in the
 * same index.html as this script, so this is a guard, not a code path.
 *
 * Moved out of main.js so UIManager can use it without a callback relay; main.js
 * imports it under the same name, so its call sites are unchanged.
 *
 * @param {object}   opts
 * @param {string}   opts.title
 * @param {string}   opts.body
 * @param {string}  [opts.note]
 * @param {string}   opts.confirmLabel
 * @param {string}  [opts.cancelLabel]   defaults to 'RETURN'
 * @param {Function}[opts.onConfirm]     called with the text field's value when `input` is set
 * @param {Function}[opts.onCancel]
 * @param {boolean} [opts.danger=true]   red (destructive) vs gold tone
 * @param {boolean} [opts.noticeOnly=false] one button, nothing to decide
 * @param {object}  [opts.input]         Patch 103: show a text field.
 * @param {string}  [opts.input.value]
 * @param {string}  [opts.input.placeholder]
 * @param {boolean} [opts.input.readOnly] a copyable read-out (export fallback)
 */
export function showConfirm({ title, body, note, confirmLabel, cancelLabel, onConfirm, onCancel,
                              danger = true, noticeOnly = false, input = null }) {
    const modal = document.getElementById('confirm-modal');
    const acceptBtn = document.getElementById('btn-confirm-accept');
    const cancelBtn = document.getElementById('btn-confirm-cancel');

    if (!modal || !acceptBtn || !cancelBtn) {
        console.error('[Dialog] #confirm-modal markup missing; dialog not shown:', title);
        return;
    }

    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-body').innerText = body;
    document.getElementById('confirm-note').innerText = note || '';
    acceptBtn.innerText = confirmLabel;
    // Defaulted rather than assigned raw: a noticeOnly caller has no cancel button to
    // label, and `innerText = undefined` writes the literal string "undefined" into it —
    // invisible today only because the button is hidden, and a trap for the next caller.
    cancelBtn.innerText = cancelLabel || 'RETURN';

    // Patch 101: `noticeOnly` turns this into a one-button NOTICE — same folder chrome,
    // nothing to decide. Added here rather than as a second dialog so there stays one
    // modal implementation; a second one is how two copies of the folder styling drift.
    //
    // Re-set on EVERY open rather than toggled, for exactly the reason the class resets
    // below say: leaving `display: none` behind would silently remove the cancel button
    // from the next ABANDON PROTOCOL dialog — a destructive prompt with no way out but
    // to accept it.
    cancelBtn.style.display = noticeOnly ? 'none' : '';

    // Patch 103: the text field. Re-set on every open for the same reason — a field
    // left visible would carry an old save string into the next unrelated dialog.
    const field = document.getElementById('confirm-input');
    if (field) {
        if (input) {
            field.style.display = '';
            field.value = input.value || '';
            field.placeholder = input.placeholder || '';
            field.readOnly = !!input.readOnly;
        } else {
            field.style.display = 'none';
            field.value = '';
        }
    }

    // Patch 92: `danger` defaults TRUE, so the original ABANDON PROTOCOL dialog is
    // byte-identical to before. The backup prompt passes false — it is an offer, not
    // a destructive action, and a red accept button reads as a warning. Both classes
    // are re-set on every open rather than toggled, so the modal cannot inherit the
    // previous caller's tone.
    const accent = danger ? 'var(--ui-red)' : 'var(--ui-gold)';
    acceptBtn.className = danger ? 'file-btn danger' : 'file-btn primary';
    cancelBtn.className = danger ? 'file-btn primary' : 'file-btn';
    const titleEl = document.getElementById('confirm-title');
    if (titleEl) titleEl.style.color = accent;
    // The red frame is set inline in the markup, so it has to be re-stated for BOTH
    // tones — assigning only the non-danger colour would leave the next destructive
    // dialog wearing gold.
    const modalFolder = modal.querySelector('.medical-folder');
    const modalHeader = modal.querySelector('.folder-header');
    if (modalFolder) modalFolder.style.borderColor = accent;
    if (modalHeader) modalHeader.style.borderBottomColor = accent;

    const onKey = (e) => {
        // Escape cancels. Safe to bind globally: main.js's own Escape handler acts
        // only on PLAYING/PAUSED, and every caller of this dialog opens it from
        // TITLE, DEAD or HUB (incl. the clinical folder) — none of which that
        // handler touches.
        if (e.key === 'Escape') { close(); if (onCancel) onCancel(); }
    };
    function close() {
        modal.style.display = 'none';
        window.removeEventListener('keydown', onKey);
    }

    // Assigned with onclick rather than addEventListener so reopening the dialog
    // replaces the handlers instead of stacking a second copy that would fire the
    // destructive action twice. Click SFX comes free — UIManager wires every
    // .file-btn on construction, and these buttons exist in the markup by then.
    //
    // The value is read BEFORE close() so a callback that opens a follow-up dialog
    // (import -> "reconstructed" notice) cannot have it wiped first.
    acceptBtn.onclick = () => {
        const value = (input && field) ? field.value : undefined;
        close();
        if (onConfirm) onConfirm(value);
    };
    cancelBtn.onclick = () => { close(); if (onCancel) onCancel(); };
    window.addEventListener('keydown', onKey);

    modal.style.display = 'flex';

    // A read-only export field opens pre-selected, so copying is one gesture
    // (Ctrl/Cmd+C, or the OS long-press menu on touch).
    if (input && field) {
        try {
            field.focus();
            if (input.readOnly) field.select();
        } catch (e) { /* focus can throw in detached/hidden states; harmless */ }
    }
}
