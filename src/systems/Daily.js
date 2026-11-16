// src/systems/Daily.js
//
// Patch 140 (V2 plan D7): the Daily Session — one scored attempt a day.
//
// Everyone who plays on the same (local) date gets the same session:
//   - the same Patient (any of the four, locked or not: the daily is a way to try one),
//   - the same Intrusive Thought (one, in place of the player's own adopted ones),
//   - the same ROOMS: every decision Director.spawnRoom makes (the room modifier, the
//     room's shape, its event, whether a named elite comes) is drawn from an rng seeded
//     by the date, the floor and the room, so the sequence of rooms is shared.
// What is NOT seeded, honestly: the moment-to-moment spawns, drops and level-up cards,
// which also run on Math.random from code paths that depend on frame timing; and the
// player's own Synapse Tree and tokens still apply (it is their patient file).
//
// One attempt per day: the attempt is recorded the moment it starts, so quitting and
// retrying does not reroll it. The score (best kept locally, with a day streak):
//   100 per room cleared + 1 per nightmare banished.
//
// Pure apart from the Math.random swap helper; no DOM.

import { PATIENT_ORDER } from '../data/Patients.js';
import { INTRUSIVE_THOUGHTS } from '../data/Manifestations.js';

/** 'YYYY-MM-DD' in the player's local time. */
export function dailyKey(date = new Date()) {
    const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 32-bit FNV-1a of a string. */
export function hashString(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
}

/** mulberry32: a small, good, seedable PRNG returning [0, 1). */
export function seededRng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const DAILY_CURSES = Object.keys(INTRUSIVE_THOUGHTS);

/** The day's session. */
export function dailySetup(key = dailyKey()) {
    const seed = hashString(`fractured-daily:${key}`);
    const r = seededRng(seed);
    const patient = PATIENT_ORDER[Math.floor(r() * PATIENT_ORDER.length)];
    const curse = DAILY_CURSES[Math.floor(r() * DAILY_CURSES.length)];
    return { key, seed, patient, curse };
}

/** The rng for one room of a daily run: same date + floor + room, same rolls. */
export function roomRng(daily, floor, room) {
    return seededRng(hashString(`${daily.seed}:${floor}:${room}`));
}

/**
 * Runs fn with Math.random replaced by rng, and always restores it. Used around
 * Director.spawnRoom so every roll in it (and in what it calls) is the seeded one.
 */
export function withRandom(rng, fn) {
    const real = Math.random;
    Math.random = rng;
    try { return fn(); } finally { Math.random = real; }
}

/** Rooms cleared in this run: every room before the current one, plus this one if cleared. */
export function roomsCleared(state) {
    const per = state.maxRoomsPerFloor || 5;
    const floor = Math.max(1, state.floor || 1);
    const room = Math.max(1, state.roomNumber || 1);
    return (floor - 1) * per + (room - 1) + (state.roomCleared || state.bossDefeated ? 1 : 0);
}

export function dailyScore(state) {
    return roomsCleared(state) * 100 + (Number(state.runKills) || 0);
}

/** The save's daily record, defaulted. */
export function emptyDaily() {
    return { lastKey: '', lastScore: 0, attempted: false, best: 0, bestKey: '', streak: 0, played: 0 };
}

/** Whether today's attempt is still available. */
export function canStartDaily(daily, key = dailyKey()) {
    const d = daily || emptyDaily();
    return !(d.lastKey === key && d.attempted);
}

/** The day after a 'YYYY-MM-DD' key (local calendar). */
export function nextKey(key) {
    const [y, m, d] = String(key).split('-').map(Number);
    if (!y || !m || !d) return '';
    return dailyKey(new Date(y, m - 1, d + 1));
}

/** Marks today's attempt as started (mutates and returns the record). */
export function startDailyAttempt(daily, key = dailyKey()) {
    const d = { ...emptyDaily(), ...(daily || {}) };
    d.streak = d.lastKey && nextKey(d.lastKey) === key ? d.streak + 1 : (d.lastKey === key ? d.streak : 1);
    d.lastKey = key;
    d.attempted = true;
    d.lastScore = 0;
    d.played = (d.played || 0) + 1;
    return d;
}

/** Records the attempt's score (only for the day it was started). Returns {record, isBest}. */
export function finishDailyAttempt(daily, key, score) {
    const d = { ...emptyDaily(), ...(daily || {}) };
    if (d.lastKey !== key) return { record: d, isBest: false };
    d.lastScore = Math.max(d.lastScore || 0, score | 0);
    const isBest = d.lastScore > (d.best || 0);
    if (isBest) { d.best = d.lastScore; d.bestKey = key; }
    return { record: d, isBest };
}
