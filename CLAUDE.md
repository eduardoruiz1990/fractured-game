# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**FRACTURED** — a browser-based survivors-like roguelite built with vanilla JavaScript (ES6 modules), HTML5 Canvas 2D, the Web Audio API, and Vite. No framework, no TypeScript, no bundler config beyond Vite defaults. The game is themed around a psychiatric/"clinical" horror aesthetic (Sanity instead of HP, Lucidity as meta-currency, "Patient Level" as prestige, Tokens as equippable gear).

## Commands

```bash
npm run dev       # start Vite dev server
npm run build     # production build to dist/
npm run preview   # preview the production build
```

There is no test runner configured (no `test` script, no framework installed). `test_director.js`, `test_save.js` and `test_bosses.js` at the repo root are standalone Node scripts that mock `document`/`window`/`localStorage` and exercise `Game`/`SaveManager`/`Director` directly — run them with `node test_director.js` etc. `test_director.js` and `test_save.js` are exploratory (they print, they don't assert); **`test_bosses.js` is assertion-based and exits non-zero on failure**, so it's the one worth running after touching boss spawning, `state.activeBoss`, or entity `init()`.

Anything *visual* cannot be covered by these — `Renderer` needs a real canvas. Use the in-game **VISUAL TEST BENCH** instead: press `0` at the title/hub to reveal the dev panel (now also visible during `PLAYING`), then use SPAWN ONE OF EACH ENEMY / SPAWN ALL 5 BOSSES, FREEZE ENEMY AI (sets `state.devFreezeEntities`, which halts `entity.update()` and further spawning in `Game.processGameLogic()` while rendering keeps animating), and the scenario dropdown (IDLE / TELEGRAPH / ATTACK / HIT FLASH) to pin every entity into a state that would otherwise tick past in well under a second. `patch_game.cjs` is a one-off migration script (regex-based source patcher), not part of any workflow — don't run it against current source without reading it first, it assumes an older shape of `Game.js`.

## Architecture

### Two top-level loops driven by `gameState`

`src/main.js` owns a single `requestAnimationFrame` loop (`gameLoop`) and a plain string `gameState` (`TITLE`, `MENU`, `HUB`, `PLAYING`, `LEVEL_UP`, `PAUSED`, `EXIT_REACHED`, `DEAD`). It wires up all the DOM buttons/menus directly (no component framework — `document.getElementById` + manual class toggling throughout `main.js` and `UIManager.js`), calls `game.update(...)` every frame, and calls `renderer.drawGame(...)` to paint the canvas. `game.update()` branches on whether `currentGameState === 'HUB'` (safe zone, no combat/void/leveling) vs `'PLAYING'` (full combat sim). Read `main.js` top-to-bottom before touching game-state transitions — nearly all cross-system wiring (death, level-up, floor-complete, descend, awaken/bank-and-quit, dev overrides) lives inline in that one file's `initEngine()`.

### `Game.js` is the state container and per-frame simulation driver

`Game.state` is one large mutable object holding the entire run: player, entities, projectiles, particles, drops, decals, floor/room progress, sanity, void status, etc. There is no Redux/immutable-update pattern — systems mutate `game.state` directly. `Game.init(saveManager, carriedState)` rebuilds `state` from scratch each run (or floor descent), pulling permanent meta-upgrades from `SaveManager.metaState` and, if descending mid-meta-run, carrying over `carriedState` (weapons, XP, sanity, floor, runInventory) from `getCarriedState()`.

`Game.processGameLogic()` is the per-frame tick: dash handling → camera shake decay → movement → particle/decal lifecycle (via `Director.updateParticles()`) → void-zone sanity drain → `Director.spawnWave()` (enemy spawning budget) → `entity.update()` for every entity → `Combat.resolveWeapons()` (projectiles + interactables) → `Combat.collectXP()` → level-up check → audio state sync.

### Director + ObjectPool: all transient entities are pooled, never GC'd per-frame

`Director.js` owns an `ObjectPool` (`src/systems/ObjectPool.js`) per entity/effect type (scavenger, predator, parasite, each boss, particle, xpDrop, tokenDrop, damageText, inkPuddle, meleeSwing, safeZone, projectile, decal). Spawning something means `pool.get()` + `init(...)`; despawning means `pool.release(item)` **and** removing it from the matching `state.<array>` — `Director.updateParticles()` is the one place that does this release-and-splice for the particle-adjacent effects arrays every frame. Enemy entities (`state.entities`) are released back to their pool wherever they die/despawn in `Combat.js` — check that release happens alongside any `splice` you add to `state.entities`, or the pool leaks. Never add array-splicing logic for pooled entities without a matching `pool.release()` call.

`Director.spawnRoom()` sets the enemy budget for a room and spawns the floor's boss when `roomNumber >= state.maxRoomsPerFloor`. Boss choice is keyed off `state.floor` (1→BOSS, 2→RORSCHACH, 3→PANOPTICON, 4→AMALGAMATION, 5+→ARCHITECT). `Director.spawnWave()` runs every frame combat is active, throttled by `budgetTimer % spawnRate`, and picks scavenger/predator/parasite by floor-dependent RNG tables.

### Entities: shared base class + per-type files

`src/entities/Enemy.js` exports the common `Enemy` base (`initBase`, `takeDamage`, `applyMovement`, `update`) that `Scavenger`, `Predator`, `Parasite`, `Boss`, `Rorschach`, `Panopticon`, `Amalgamation`, `Architect` extend/compose. `takeDamage` batches damage numbers over ~15 frames before spawning a `damageText` (avoids a floating number per hit) and throttles pain-scream SFX via `painCooldown`. `applyMovement` teleports enemies that fall too far behind the player (>1500px) back into range, and handles the `confused` status (used by the `shadow_step` boon on dash) by re-targeting toward the nearest other entity. **`src/entities/Player.js` is an empty stub — player state lives inline in `Game.state.player`, not in a class.**

### Combat.js resolves interactions, doesn't own state

`Combat.resolveWeapons(game)` handles projectile movement/collision, and a big `interactables` loop (`BREAKER_BOX`, `OBJECTIVE_BACKPACK`, `EXIT_ELEVATOR`, `ROOM_DOOR`) that reads/mutates `state.interactables` in place, keyed on `obj.type` and toggling `obj.dead`/`obj.active`. `Combat.collectXP(game)` (further down the file) handles XP pickups. Weapon behavior (flashlight cone, static aura, pipe swing, ink trail, chalk ward, camera flash, spinner orbit) is resolved here too, driven by the per-weapon config objects under `state.player.weapons` (see `Game.init`) — each weapon carries a `tags` array (`light`, `focus`, `aura`, `tech`, `melee`, `kinetic`, `hazard`, `dark`, `orbit`, `burst`, `utility`, `passive`) that `Manifestations.getActiveSynergies()` cross-references against `SYNERGIES` reqs to unlock combo effects (e.g. flashlight+static → confuse-inducing strobe).

### Meta-progression lives in SaveManager, is separate from run state

`SaveManager.metaState` is the persistent save (localStorage key `fractured_meta`): `lucidityBank`, `spentLucidity` (drives "Patient Level" via `getPatientLevelInfo()`, a sqrt curve), `upgrades` (hp/speed/light/magnet, each independently priced with `1.1^level` scaling via `buyUpgrade`), token `inventory` + `equippedTokens` (4 slots: head/body/hands/legs), `selectedCurses` (a.k.a. "Intrusive Thoughts" — opt-in permanent debuffs that boost Lucidity gain, unlocked at Patient Level 5 + 1 boss kill), and per-type `killCounts` for trophies. Every mutator (`buyUpgrade`, `equipToken`, `upgradeToken`, `toggleCurse`, `addLucidity`, ...) calls `saveGame()` itself — callers don't need to persist separately. `loadGame()` back-fills missing fields defensively for old saves; when adding a new `metaState` field, add the same fallback there. Export/import round-trips the whole `metaState` through base64 JSON (`exportSave`/`importSave`).

Meta progression (`SaveManager`) and one run's live state (`Game.state`) intentionally never merge except at two seams: `Game.init()` reading `meta.upgrades`/`meta.equippedTokens`/`meta.selectedCurses` to build a fresh `state.player`, and `main.js` writing kills/lucidity/tokens back into `SaveManager` at death/awaken/floor-complete.

### Rendering is 100% Canvas; DOM is 100% menus

`Renderer.js` (2400+ lines) is the only file that touches the canvas 2D context for gameplay. `UIManager.js` and the inline handlers in `main.js` are the only code that touches menu DOM. Don't cross those wires — see the Golden Rules below, inherited from this project's existing AI guidelines (`GEMINI.md`, still present and applicable).

### Known-empty stub files

`src/entities/Player.js`, `src/systems/EcosystemAI.js`, `src/systems/ParticleGen.js`, `src/ui/HudUI.js`, `src/ui/MenuUI.js`, `src/ui/SynapseTree.js` are all 0 bytes. They are not wired into anything — don't assume functionality lives there just because the filename implies it; grep before assuming a system exists.

## Golden rules (from this project's existing AI dev guidelines)

- **No `ctx.shadowBlur`.** It tanks Canvas perf on complex shapes. Use faux-glows (low-alpha radial gradients) instead.
- **Reset `ctx.globalCompositeOperation`** back to `source-over` before any draw function returns if you changed it (e.g. to `screen` or `destination-out`) — leaving it set turns subsequent draws (including the player) invisible.
- **Cache static backgrounds to an off-screen canvas** (`document.createElement('canvas')`) once at init, then `drawImage()` it per frame — see `HubWorld.generateFloor()` and `Renderer.generateFloorPatterns()`/`this.cachedFloorPatterns` for the established pattern.
- **Never `array.splice()` a pooled entity/effect without releasing it back to its `Director.pools.*` pool first.**
- **Defensive fallbacks when reading `SaveManager.metaState`** — always `|| 0` / similar on upgrade/meta fields, since old saves may predate a field (see `loadGame()`'s back-fill block).
- **Validate before passing to Canvas math** — `NaN`/`undefined` into `createRadialGradient`, `arc`, etc. throws `DOMException` and kills the render loop. Use `Number.isFinite()` guards (see the `sanityRatio` checks in `main.js`/`Game.js` for the existing pattern).
- **All input goes through `InputManager` (`src/core/Input.js`)** — keyboard (WASD/Space), mouse aim, and dual-joystick touch controls are unified into one `this.state` object (`moveX`, `moveY`, `aimAngle`, `isMoving`, `isDashing`). Don't add ad hoc `window.addEventListener('keydown', ...)` calls in `Game.js` or entity files; read from `state.input` instead. (`main.js` itself has a few UI-level key listeners — e.g. Escape to pause, `E` to interact — those are menu/UI concerns, not gameplay input, and are fine where they are.)

## Visual/UX work conventions

- The DOM/CSS menu layer (`index.html`, `src/style.css`, `src/ui/UIManager.js`) has a distinct "clinical medical file" visual language — torn-paper folder chrome (`.medical-folder`), blood-drip animations (`.blood-drop`), patient stamps (`.patient-stamp`), typewriter-styled text (`.typewriter-text`). Preserve this language; don't replace it with something generic when touching menu UI.
- Per-floor/level visual differentiation (biome identity, fog, further work on `generateFloorPatterns`) is now in scope — see Patch 35 onward (Track G) in `EXECUTION_HANDOFF.md`. (Previously deferred to a separate effort; confirmed with the user on 2026-07-26 that no such effort is active elsewhere, so this note no longer applies.)
- `Renderer.drawHUD(state)` (around line 460) is dead code — confirmed not called anywhere in the real render pipeline (the real HUD is DOM-based, live in `index.html`'s `#ui-layer` and driven by `main.js`/`UIManager.js`). Ignore it; don't "improve" it, and don't assume it's load-bearing.
- Entities carry a `.phase` field, already used for animation desync/oscillation on `Boss`, `Rorschach`, `Panopticon`, `Amalgamation`, `Architect` (see e.g. `Rorschach.js`'s `this.phase += 0.05` drift and `Renderer.js`'s `Math.sin(ent.phase * 10)` flicker checks) but currently absent on `Scavenger`/`Predator`/`Parasite`. Reuse `.phase` for new per-entity animation timing rather than inventing a parallel field.
- **Patch discipline for `src/core/Renderer.js`, `index.html`, and `src/style.css`:** these are large files and have previously been silently truncated/wrong-but-plausibly regenerated by a prior AI tool. Work in small, independently-appliable patches — find an exact existing block, replace it with an exact new block — never regenerate one of these files wholesale. After every patch, run `node -c <file>` (for the `.js` case) as a syntax sanity check, then stop and let the change be manually verified in `npm run dev` before starting the next patch.
