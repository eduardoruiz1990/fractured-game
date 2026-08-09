/**
 * Room-door rewards actually pay out (Patch 75).
 *
 * Run with:  node test_rewards.js
 *
 * WHY THIS FILE EXISTS: the TOKEN_DOOR reward was silently paying nothing for as long
 * as it has existed. It called spawnTokenDrop(), which pushes a pickup into
 * `state.tokenDrops` — and eighteen lines further down its OWN handler, the room
 * transition does `state.tokenDrops = []` and teleports the player to 0,0. The token
 * was created and destroyed in the same frame, in a room that no longer existed. It
 * never reached `runInventory`, so it was never banked at the end of the run.
 *
 * The reason nobody caught it: the "TOKEN DROPPED!" text DID appear, because damage
 * texts live in one of the few arrays that transition does not clear. The reward
 * looked like it worked and did nothing. RISK_REWARD had the same bug while charging
 * 30 Sanity for the privilege.
 *
 * So this file asserts the property that was missing, for every door type: after the
 * transition has run, is the player actually holding what the door promised? Anything
 * that lives in a pooled array cannot answer yes.
 */

import { Game } from './src/core/Game.js';

global.CustomEvent = class CustomEvent {
    constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
};
global.document = {
    addEventListener: () => {},
    dispatchEvent: () => {},
    getElementById: () => null,
    createElement: () => ({
        width: 1920, height: 1080,
        getContext: () => ({
            fillStyle: '', fillRect: () => {}, strokeStyle: '', lineWidth: 0,
            beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
            ellipse: () => {}, fill: () => {}, createPattern: () => {}, createImageData: () => ({ data: [] }),
            putImageData: () => {}, createRadialGradient: () => ({ addColorStop: () => {} }),
            createLinearGradient: () => ({ addColorStop: () => {} }), arc: () => {},
            translate: () => {}, scale: () => {}, rotate: () => {}, restore: () => {}, save: () => {},
            clip: () => {}, rect: () => {}, closePath: () => {}
        })
    })
};
global.window = { addEventListener: () => {} };
global.localStorage = { getItem: () => null, setItem: () => {} };

const mockSave = {
    metaState: {
        upgrades: { hp: 0, speed: 0, light: 0, magnet: 0 },
        killCounts: {}, inventory: [], equippedTokens: {}, selectedCurses: [],
        maxFloorReached: 1, tutorialCompleted: true, boonHistory: {}
    },
    saveGame: () => {},
    recordBoonPick: () => {}
};

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
    if (condition) {
        passed++;
        console.log(`  \x1b[32m✓\x1b[0m ${label}`);
    } else {
        failed++;
        console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
    }
}

const { Combat } = await import('./src/systems/Combat.js');

/**
 * Puts the player on a door of the given type and runs one real combat frame, which
 * is what fires the reward AND the room transition. Returns before/after snapshots.
 */
function takeDoor(rewardType) {
    const game = new Game();
    game.init(mockSave);
    const state = game.state;

    state.floor = 1;
    state.roomNumber = 2;
    state.player.x = 0;
    state.player.y = 0;
    state.sanity = 50;
    state.combatActive = false;
    state.roomCleared = true;
    state.entities = [];
    state.interactables = [{
        type: 'ROOM_DOOR',
        x: 0, y: 0, radius: 40, active: true, dead: false,
        rewardType
    }];

    const before = {
        lucidity: state.lucidity,
        xp: state.xp,
        sanity: state.sanity,
        tokens: (state.runInventory || []).length,
        room: state.roomNumber,
        weaponLevels: Object.values(state.player.weapons).reduce((a, w) => a + w.level, 0)
    };

    Combat.resolveWeapons(game);

    const after = {
        lucidity: state.lucidity,
        xp: state.xp,
        sanity: state.sanity,
        tokens: (state.runInventory || []).length,
        room: state.roomNumber,
        weaponLevels: Object.values(state.player.weapons).reduce((a, w) => a + w.level, 0),
        tokenDrops: (state.tokenDrops || []).length
    };

    return { before, after, state };
}

console.log('\nThe transition really does run (the thing that ate the token)');
{
    const { before, after, state } = takeDoor('LUCIDITY');
    check('taking a door advances the room', after.room === before.room + 1,
          `${before.room} -> ${after.room}`);
    check('and clears every pooled array on the way out',
          state.tokenDrops.length === 0 && state.xpDrops.length === 0 &&
          state.projectiles.length === 0 && state.entities.length === 0);
}

console.log('\nEvery door pays out something that SURVIVES the transition');
{
    {
        const { before, after } = takeDoor('LUCIDITY');
        check('LUCIDITY grants lucidity and xp',
              after.lucidity > before.lucidity && after.xp > before.xp,
              `+${after.lucidity - before.lucidity} lucidity`);
    }
    {
        const { before, after } = takeDoor('HEAL');
        check('HEAL restores grip', after.sanity > before.sanity,
              `${before.sanity} -> ${after.sanity}`);
    }
    {
        const { before, after } = takeDoor('WEAPON_UPGRADE');
        check('WEAPON_UPGRADE levels a weapon',
              after.weaponLevels === before.weaponLevels + 1,
              `${before.weaponLevels} -> ${after.weaponLevels}`);
    }
    {
        // The reported bug. Before Patch 75 this was 0 tokens, every time.
        const { before, after } = takeDoor('TOKEN_DOOR');
        check('TOKEN_DOOR puts a token in the run inventory',
              after.tokens === before.tokens + 1,
              `${before.tokens} -> ${after.tokens}`);
        check('and does NOT leave it as a pickup the transition will delete',
              after.tokenDrops === 0, `${after.tokenDrops} orphaned pickups`);
    }
    {
        const { before, after } = takeDoor('RISK_REWARD');
        check('RISK_REWARD grants lucidity', after.lucidity > before.lucidity);
        check('RISK_REWARD charges grip', after.sanity < before.sanity,
              `${before.sanity} -> ${after.sanity}`);
        check('RISK_REWARD delivers the token it charges for',
              after.tokens === before.tokens + 1,
              `${before.tokens} -> ${after.tokens}`);
    }
}

console.log('\nThe rarity a door grants is a real, bankable one');
{
    // main.js decrypts runInventory entries by rarity at the end of a run; an entry
    // that is not one of these silently becomes an unrenderable token.
    const valid = ['common', 'rare', 'epic', 'legendary'];
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
        const { state } = takeDoor('TOKEN_DOOR');
        state.runInventory.forEach(r => seen.add(r));
    }
    const all = [...seen];
    check('every granted rarity is one main.js can bank',
          all.every(r => valid.includes(r)), `saw ${all.join(', ')}`);
    check('the rarity roll is not stuck on one value', all.length >= 2,
          `only ever saw ${all.join(', ')}`);
}

console.log('\nGame.grantToken directly');
{
    const game = new Game();
    game.init(mockSave);
    game.state.runInventory = [];
    const rarity = game.grantToken(0, 0);
    check('returns the rarity it granted', typeof rarity === 'string' && rarity.length > 0);
    check('appends exactly one entry', game.state.runInventory.length === 1);
    check('and the entry matches what it returned', game.state.runInventory[0] === rarity);

    // Old saves and carried states can arrive without the field.
    game.state.runInventory = undefined;
    let threw = false;
    try { game.grantToken(0, 0); } catch (e) { threw = true; }
    check('rebuilds a missing runInventory rather than throwing',
          !threw && Array.isArray(game.state.runInventory) && game.state.runInventory.length === 1);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
