// src/systems/CasePages.js
//
// Patch 144 (V2 plan E3): Case File pages in the world.
//
// A page is an interactable (state.interactables, type 'CASE_PAGE', carrying `pageId`).
// - DROPS: a floor's boss always drops one (if any is left to find), a named elite half
//   the time (Story.rollPageDrop). Which page is Story.nextPageFor: the next page of the
//   floor's chapter that is neither filed nor already lying on the floor this run.
// - PICKUP: walk into it. Within PAGE_MAGNET_RADIUS it drifts to the player, so a page
//   dropped beside the boss's exit is not missed on the way out.
// - NEVER LOST TO A DOOR: anything still lying when the room door or the floor's exit
//   is taken is filed then (collectLoosePages). A page is only lost if the player dies
//   before reaching it; it simply drops again later.
// Filing goes through SaveManager.collectPage (which saves) and then game.onCasePage
// (main.js: the notice that opens to the page's text).

import { nextPageFor, rollPageDrop, PAGE_MAGNET_RADIUS } from '../data/Story.js';
import { resolveObstacles } from './Arena.js';

export const PAGE_RADIUS = 18;
export const PAGE_DRIFT_SPEED = 7;

/** Page ids lying (not yet filed) in this room. */
export function pendingPageIds(state) {
    return (state.interactables || []).filter(o => o && o.type === 'CASE_PAGE' && !o.dead).map(o => o.pageId);
}

/**
 * Rolls a drop for a kill (`kind` 'boss' | 'elite') and places the page. Returns the
 * interactable, or null. Never in the tutorial; never without a save to file into.
 */
export function dropPage(game, x, y, kind, rng = Math.random) {
    const state = game && game.state;
    const sm = game && game.saveManager;
    if (!state || !sm || !sm.metaState || state.isTutorial) return null;
    if (!rollPageDrop(kind, rng)) return null;
    const id = nextPageFor(sm.metaState, state.floor || 1, pendingPageIds(state));
    if (!id) return null;
    if (!Array.isArray(state.interactables)) state.interactables = [];
    const page = { type: 'CASE_PAGE', pageId: id, x, y, radius: PAGE_RADIUS, active: true, dead: false, life: 99999, spin: rng() * Math.PI * 2 };
    if (state.obstacles && state.obstacles.length) resolveObstacles(state.obstacles, page, PAGE_RADIUS + 8);
    state.interactables.push(page);
    return page;
}

/** Files a page interactable. Returns { id, isNew } (or null for one already filed). */
export function filePage(game, obj) {
    if (!obj || obj.dead) return null;
    obj.dead = true;
    const sm = game.saveManager;
    const isNew = !!(sm && typeof sm.collectPage === 'function' && sm.collectPage(obj.pageId));
    if (typeof game.onCasePage === 'function') {
        try { game.onCasePage(obj.pageId, isNew); } catch (e) { console.error(e); }
    }
    return { id: obj.pageId, isNew };
}

/** One step of a lying page: drift towards a near player, file on touch. */
export function updatePage(game, obj) {
    const p = game.state.player;
    const dx = p.x - obj.x, dy = p.y - obj.y;
    const d = Math.hypot(dx, dy);
    if (d < obj.radius + (p.radius || 12)) return filePage(game, obj);
    if (d < PAGE_MAGNET_RADIUS && d > 0) {
        const step = Math.min(d, PAGE_DRIFT_SPEED);
        obj.x += (dx / d) * step;
        obj.y += (dy / d) * step;
    }
    obj.spin = (obj.spin || 0) + 0.05;
    return null;
}

/** Files every page still lying in the room (a door or the exit is being taken). */
export function collectLoosePages(game) {
    const out = [];
    for (const o of (game.state.interactables || [])) {
        if (o && o.type === 'CASE_PAGE' && !o.dead) out.push(filePage(game, o));
    }
    return out;
}
