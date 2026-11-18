# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**FRACTURED** — a browser-based survivors-like roguelite built with vanilla JavaScript (ES6 modules), HTML5 Canvas 2D, the Web Audio API, and Vite. No framework, no TypeScript, no bundler config beyond Vite defaults. The game is themed around a psychiatric/"clinical" horror aesthetic (Sanity instead of HP, Lucidity as meta-currency, "Patient Level" as prestige, Tokens as equippable gear).

## Commands

```bash
npm run dev              # start Vite dev server (no portal SDK)
npm run dev:crazygames   # dev server WITH the CrazyGames SDK tag (placeholder ads on localhost)
npm run build            # production build to dist/ — the CrazyGames target (SDK tag injected)
npm run build:itch       # production build without the SDK tag (itch.io / self-hosted)
npm run build:playtest   # itch-style build + on-screen PERF panel/benchmark for real-device testing (Patch 120)
npm run preview          # preview the production build
npm run package          # Patch 159: build + check the CrazyGames bundle, zip it to release/fractured-<build id>.zip (needs a clean tree)
```

**Releasing:** the version is `package.json`'s; the build id (`src/data/Build.js`, set by `vite.config.js`: version-mode-commit, `+dirty` for uncommitted builds) is shown in Settings and sent in the portal feedback context. The upload flow is `QA_CHECKLIST.md` §0 → `npm run package` → upload → the rest of the checklist; the form text is `SUBMISSION.md`. The covers, preview videos and logo are in `marketing/` (Patch 160), made from engine renders by `marketing/tools/`. `marketing/README.md` explains how to rebuild them after the art changes.

The SDK `<script>` is injected by `vite.config.js` per Vite mode (Patch 102) — never add
it to `index.html` by hand. **The v2 resubmission roadmap is `V2_PLAN.md`** (phases A–G,
patches numbered from 102).

There is no test runner configured (no `test` script, no framework installed). The `test_*.js` scripts at the repo root are standalone Node scripts that mock `document`/`window`/`localStorage` and exercise the real modules directly — run them with `node test_bosses.js` etc.

**These are assertion-based and exit non-zero on failure — run the relevant ones after any change** (`test_rewards.js`, `test_pacing.js` and `test_fuzz_runs.js` also assert; see their headers):

| File | Run it after touching |
| --- | --- |
| `test_bosses.js` | boss spawning, `state.activeBoss`, entity `init()`/pooling, predator feeding, `Director.spawnEntity`'s spawn ring |
| `test_content.js` | synergy/token/set/curse data, XP curve, audio asset paths, the boon pool, weapon lists |
| `test_synapse.js` | Synapse Tree costs, gates or the upgrade resolver |
| `test_leash.js` | `Enemy.applyMovement`, leash thresholds, tutorial spawn distances |
| `test_tutorial.js` | `src/systems/Tutorial.js`, tutorial copy, the step gates, the instruction hold |
| `test_viewport.js` | `Renderer.updateZoom`, `src/core/Layout.js`, the portrait band, anything reading canvas dimensions |
| `test_arena.js` | `src/systems/Arena.js` (room shapes, spawn sectors, wall collision), `src/systems/RoomEvents.js`, `Director.spawnRoom`'s layout/event choice, the room-clear path |
| `test_progress.js` | `src/data/Achievements.js`, `src/data/Unlocks.js`, the `achievements`/`stats` save fields, `claimAchievements`, the Daily Session |
| `test_story.js` | `src/data/Story.js`, `src/data/Strings.js`, `metaState.story`, Case File drops, session notes, boss lines, the ending choice, the Patients' page unlocks |
| `test_input.js` | `src/systems/AutoAim.js`, the aim-assist hook in `Game.update`, `InputManager`'s touch state (`aimHeld`, the dash gesture), input-dependent tutorial copy |
| `test_endless.js` | `src/core/Endless.js`, boss-per-floor dispatch, endless scaling/cadence, the run-completion latch, per-floor palettes or enemy tints, `LevelUpUI`'s weapon cap or `DEEP_BOONS` |

`test_director.js` and `test_save.js` are exploratory only (they print, they don't assert).

**v3 (Patches 165–167, "NIGHT SHIFT"):** the game is now a horde game. Rooms keep 10–50 enemies alive (`src/data/Horde.js`), enemies spawn at the edge of the view, the dark is dim rather than black (`DARKNESS_ALPHA` in `Renderer.js`) with eyes drawn through it, the HUD has an XP bar, and a first session has no cold open or scripted tutorial. Read the V3 section of `CHANGELOG.md` (Keep clauses 54–57) before touching spawning, the camera, the darkness or the XP/heal economy.

**Balance:** `node sim_difficulty.js` (Patch 156) plays whole runs headless with a scripted player and reports Sanity lows, damage and deaths per floor (`--detail`, `--sources`, `--ttk`; `--pressure '{"3":{"hp":1.6}}'` tries a row of `src/data/Difficulty.js` without editing it). It measures, it doesn't assert; run it before and after any change to enemy stats, spawning, healing or that table. Add `test_content.js` to the table above for `Difficulty.js`. Its skills include `statue` (an untouched phone) and `anchored` (a thumb resting, never moving); run both after any change to `src/systems/AutoAim.js` (Keep clause 53).

**Browser checks (`qa/`, V2):** Playwright scripts that drive the real game against the dev server (`npx vite --port 5199 --strictPort`). They cover ads against an SDK mock, dialogs, focus and keys, the sprite cache, render recovery, high refresh, the portal context, and a perf soak (`qa/soak_check.cjs`) that fails on invariant breaks. See `qa/README.md`. Run the relevant ones after touching `main.js` flows, `PortalSDK`, `Renderer` caching or Director caps. Keep clauses 36–51 in `CHANGELOG.md` cover the V2 guards. `qa/smoke_check.cjs` is the one browser check that needs no dev server: it builds the CrazyGames and playtest bundles, serves them with `vite preview` and plays them with no dev hook — run it before every upload.

Anything *visual* cannot be covered by these — `Renderer` needs a real canvas. Use the in-game **VISUAL TEST BENCH** instead: press `0` at the title/hub to reveal the dev panel (now also visible during `PLAYING`), then use SPAWN ONE OF EACH ENEMY / SPAWN ALL 5 BOSSES, FREEZE ENEMY AI (sets `state.devFreezeEntities`, which halts `entity.update()` and further spawning in `Game.processGameLogic()` while rendering keeps animating), and the scenario dropdown (IDLE / TELEGRAPH / ATTACK / HIT FLASH) to pin every entity into a state that would otherwise tick past in well under a second. `patch_game.cjs` is a one-off migration script (regex-based source patcher), not part of any workflow — don't run it against current source without reading it first, it assumes an older shape of `Game.js`.

## Change history

`EXECUTION_HANDOFF.md` covers patches 13–41. **`CHANGELOG.md` covers patches 49 onward**
(the CrazyGames Basic Launch remediation shipped as v1.2, the tutorial rebuild and
the mobile work, then the v2 resubmission from Patch 102, grouped by `V2_PLAN.md`
phase A–G) and is the more important of the two for
current work — several of those changes are guards against failures that are
invisible on a dev machine and only appear on a real player's device, so the diff
alone does not explain them. Its **Keep clauses** and **Known issues** sections are
the parts most likely to be broken by accident; read them before touching storage,
the save schema, the run-launch path, enemy movement, the tutorial, or anything that
reads canvas dimensions. Clauses 36–51 are the v2 ones: performance guards, per-frame
DOM writes, no `backdrop-filter` over the canvas, the level-up overlay rule, haptics,
aim assist, the SDK loading-window budget, and never reading back a canvas that is drawn every frame.

**Before an upload** run `node qa/smoke_check.cjs` (it builds and plays the shipped
bundles) and work through `QA_CHECKLIST.md` in the CrazyGames developer-portal preview.

Note the numbering caveat at the top of `CHANGELOG.md`: `BASIC_LAUNCH_FIX_QUEUE_v2.md`
numbers its two new items 59 and 60, which collide with different patches already
recorded under those numbers. The changelog's numbers match the source comments.

## Architecture

### Two top-level loops driven by `gameState`

`src/main.js` owns a single `requestAnimationFrame` loop (`gameLoop`) and a plain string `gameState` (`TITLE`, `MENU`, `HUB`, `PLAYING`, `LEVEL_UP`, `PAUSED`, `EXIT_REACHED`, `DEAD`). It wires up all the DOM buttons/menus directly (no component framework — `document.getElementById` + manual class toggling throughout `main.js` and `UIManager.js`), calls `game.update(...)` every frame, and calls `renderer.drawGame(...)` to paint the canvas. `game.update()` branches on whether `currentGameState === 'HUB'` (safe zone, no combat/void/leveling) vs `'PLAYING'` (full combat sim). Read `main.js` top-to-bottom before touching game-state transitions — nearly all cross-system wiring (death, level-up, floor-complete, descend, awaken/bank-and-quit, dev overrides) lives inline in that one file's `initEngine()`.

### `Game.js` is the state container and per-frame simulation driver

`Game.state` is one large mutable object holding the entire run: player, entities, projectiles, particles, drops, floor/room progress, sanity, void status, etc. There is no Redux/immutable-update pattern — systems mutate `game.state` directly. `Game.init(saveManager, carriedState)` rebuilds `state` from scratch each run (or floor descent), pulling permanent meta-upgrades from `SaveManager.metaState` and, if descending mid-meta-run, carrying over `carriedState` (weapons, XP, sanity, floor, runInventory) from `getCarriedState()`.

`Game.processGameLogic()` is the per-frame tick: dash handling → camera shake decay → movement → particle lifecycle (via `Director.updateParticles()`) → void-zone sanity drain → `Director.spawnWave()` (enemy spawning budget) → `entity.update()` for every entity → `Combat.resolveWeapons()` (projectiles + interactables) → `Combat.collectXP()` → level-up check → audio state sync.

### Director + ObjectPool: all transient entities are pooled, never GC'd per-frame

`Director.js` owns an `ObjectPool` (`src/systems/ObjectPool.js`) per entity/effect type (scavenger, predator, parasite, each boss, particle, xpDrop, tokenDrop, damageText, inkPuddle, meleeSwing, safeZone, projectile). Spawning something means `pool.get()` + `init(...)`; despawning means `pool.release(item)` **and** removing it from the matching `state.<array>` — `Director.updateParticles()` is the one place that does this release-and-splice for the particle-adjacent effects arrays every frame. Enemy entities (`state.entities`) are released back to their pool wherever they die/despawn in `Combat.js` — check that release happens alongside any `splice` you add to `state.entities`, or the pool leaks. Never add array-splicing logic for pooled entities without a matching `pool.release()` call.

**Note (2026-07-31): the gore/decal splatter system (`Director.spawnDecal`, `state.decals`, the `decal` pool, and the menu-screen blood-drop rain in `UIManager.initBloodRain`) was removed for the CrazyGames PEGI-12 release. Don't reintroduce blood/gore visual effects without checking with the user first.**

`Director.spawnRoom()` sets the enemy budget for a room and spawns the floor's boss when `roomNumber >= state.maxRoomsPerFloor`. Boss choice comes from `bossTypeForFloor(state.floor)` in **`src/core/Endless.js`** (1→BOSS, 2→RORSCHACH, 3→PANOPTICON, 4→AMALGAMATION, 5→ARCHITECT, then the same five again — floors 6+ are **THE RECURSION**, the endless mode added in Patches 93–98; see `CHANGELOG.md` and Keep clauses 29–35). `Endless.js` is a pure module and the single place anything keyed off depth is decided; every one of its functions returns the identity for floors 1–5, which is what makes the mode strictly additive. `Director.spawnWave()` runs every frame combat is active, throttled by `budgetTimer % spawnRate`, and picks scavenger/predator/parasite by floor-dependent RNG tables.

### Entities: shared base class + per-type files

`src/entities/Enemy.js` exports the common `Enemy` base (`initBase`, `takeDamage`, `applyMovement`, `update`) that `Scavenger`, `Predator`, `Parasite`, `Boss`, `Rorschach`, `Panopticon`, `Amalgamation`, `Architect` extend/compose. `takeDamage` batches damage numbers over ~15 frames before spawning a `damageText` (avoids a floating number per hit) and throttles pain-scream SFX via `painCooldown`. `applyMovement` teleports enemies that fall too far behind the player (>1500px) back into range, and handles the `confused` status (used by the `shadow_step` boon on dash) by re-targeting toward the nearest other entity. **There is no `Player` class or file — player state lives inline in `Game.state.player`.** (`src/entities/Player.js` was an empty stub, deleted 2026-07-29.)

### Combat.js resolves interactions, doesn't own state

`Combat.resolveWeapons(game)` handles projectile movement/collision, and a big `interactables` loop (`BREAKER_BOX`, `OBJECTIVE_BACKPACK`, `EXIT_ELEVATOR`, `ROOM_DOOR`) that reads/mutates `state.interactables` in place, keyed on `obj.type` and toggling `obj.dead`/`obj.active`. `Combat.collectXP(game)` (further down the file) handles XP pickups. Weapon behavior (flashlight cone, static aura, pipe swing, ink trail, chalk ward, camera flash, spinner orbit) is resolved here too, driven by the per-weapon config objects under `state.player.weapons` (see `Game.init`) — each weapon carries a `tags` array (`light`, `focus`, `aura`, `tech`, `melee`, `kinetic`, `hazard`, `dark`, `orbit`, `burst`, `utility`, `passive`) that `Manifestations.getActiveSynergies()` cross-references against `SYNERGIES` reqs to unlock combo effects (e.g. flashlight+static → confuse-inducing strobe).

### Meta-progression lives in SaveManager, is separate from run state

`SaveManager.metaState` is the persistent save (localStorage key `fractured_meta`): `lucidityBank`, `spentLucidity` (drives "Patient Level" via `getPatientLevelInfo()`, a sqrt curve), `upgrades` (hp/speed/light/magnet, each independently priced with `1.1^level` scaling via `buyUpgrade`), token `inventory` + `equippedTokens` (4 slots: head/body/hands/legs), `selectedCurses` (a.k.a. "Intrusive Thoughts" — opt-in permanent debuffs that boost Lucidity gain, unlocked at Patient Level 5 + 1 boss kill), and per-type `killCounts` for trophies. Every mutator (`buyUpgrade`, `equipToken`, `upgradeToken`, `toggleCurse`, `addLucidity`, ...) calls `saveGame()` itself — callers don't need to persist separately. `loadGame()` back-fills missing fields defensively for old saves; when adding a new `metaState` field, add the same fallback there. Export/import round-trips the whole `metaState` through base64 JSON (`exportSave`/`importSave`).

Meta progression (`SaveManager`) and one run's live state (`Game.state`) intentionally never merge except at two seams: `Game.init()` reading `meta.upgrades`/`meta.equippedTokens`/`meta.selectedCurses` to build a fresh `state.player`, and `main.js` writing kills/lucidity/tokens back into `SaveManager` at death/awaken/floor-complete.

### Rendering is 100% Canvas; DOM is 100% menus

`Renderer.js` (2400+ lines) is the only file that touches the canvas 2D context for gameplay. `UIManager.js` and the inline handlers in `main.js` are the only code that touches menu DOM. Don't cross those wires — see the Golden Rules below, inherited from this project's existing AI guidelines (`GEMINI.md`, still present and applicable).

### Known-empty stub files

**DELETED (2026-07-29).** `src/entities/Player.js`, `src/systems/EcosystemAI.js`, `src/systems/ParticleGen.js`, `src/ui/HudUI.js` and `src/ui/MenuUI.js` were all 0-byte stubs wired to nothing, and have been removed. `src/ui/SynapseTree.js` is NOT a stub — it has real content as of Patch 29.6. Don't recreate the deleted files: player state lives inline in `Game.state.player`, particles live in `Director`/`Renderer`, and the HUD is DOM-based in `index.html`'s `#ui-layer`. Grep before assuming a system exists.

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
