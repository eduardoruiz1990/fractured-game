# FRACTURED — Execution Handoff (v2)

## STATUS (last updated 2026-07-26)

This file is the persistent copy of the patch queue — the original only existed
in chat, and got lost once already when a session compacted past it. **Any
Claude session picking this project back up should read this file before doing
anything else**, to know what's done and what's next.

**Execution order:** `13 → 14 → 15 → 20 → 21 → 22 → 23 → 24 → 28 → 26 → 27 →
25 → 16 → 17 → 18 → 19 → 29.1 → 29.2 → 29.3 → 29.4 → 29.5 → 29.6 → 29.7 →
29.8 → 31 → 32 → 33 → 34 → 35 → 36 → 37 → 38 → 39 → 40 → 41`

- **DONE:** Patches 13, 14, 15, 20, 21, 22, 23, 24, 28, 26, 27, 25, 16, 17, 18,
  19, 29.1–29.8, 31, 32, 33, 34 — all of Tracks A–F.
  - Two unnumbered "wiring" follow-ups were done immediately after their
    parent patch, at the user's request, closing gaps where the parent
    patch's own file scope didn't reach the files needed to make the new
    data/resolver actually affect gameplay: **31b** (token effects wired into
    `Game.js`/`Combat.js`) and **32b** (curse resolver wired into `Game.js`,
    server-side unlock-gate enforcement added to `SaveManager`).
  - **34b** (live bug, not a numbered patch): the Patch 33/34 hover tooltip
    was getting clipped/overlapping neighboring panels for inventory items
    near the grid's edges, because `.inventory-panel`'s `overflow-y: auto`
    forces `overflow-x` to compute to `auto` too (CSS overflow spec), clipping
    anything positioned `absolute` inside it. Fixed by making the tooltip a
    single shared element appended to `document.body` with `position: fixed`,
    positioned via `getBoundingClientRect()` in `UIManager.showItemTooltip()`.
  - Also fixed along the way (real bugs found via test harnesses while
    executing these patches, not separate patches): a `uid` collision in
    `SaveManager.addTokenToInventory()` when called in a tight loop (surfaced
    by the dev "add one of each token" button), and broken `.rarity-*` CSS
    selectors that meant zero rarity styling had ever rendered on any token.
- **Patch 35 DONE** (2026-07-26). Confirmed with the user that the "separate
  effort" on per-floor/biome visual differentiation referenced in CLAUDE.md is
  NOT active elsewhere, so Track G was cleared to proceed; CLAUDE.md's note
  was updated accordingly.
  - Required a small **out-of-declared-scope** edit: `test_bosses.js` and
    `test_content.js` mock a 2D context by hand and were missing `rotate`,
    which `HubWorld.generateFloor` now calls. Both suites crashed until
    `rotate: () => {}` was added to each mock. Additive, one word per file.
    Flagging because the patch's declared scope was Renderer.js + HubWorld.js.
- **Patch 36 DONE** (2026-07-26). Per-floor atmosphere (`getAtmosphere`),
  soft-edged flashlight penumbra, fog depth/tint. Also fixed a dead branch in
  `drawFog` where the `hitStop` check had two identical bodies, so fog never
  froze on impact pauses like every other system does.
- **NEXT: Patch 37** — Menu/DOM visual pass, `[MODEL: OPUS]`.
- **NOT STARTED:** 37, 38, 39, 40, 41.

Also added since v2 was written, outside the numbered queue (ad hoc dev
tooling, at the user's request): two dev-panel buttons in `src/main.js`
("ADD ONE OF EACH TOKEN" / "ADD RANDOM TOKEN") that call the real
`SaveManager.addTokenToInventory()` to populate the inventory for manual
loadout testing without grinding real drops.

---

## 0. Your role

You are executing a pre-approved patch queue on the FRACTURED codebase at
`/home/eduardo-ruiz/3_Games/Fractured/fractured-game`. All design thinking is
DONE and captured below. Do not redesign, re-scope, re-sequence, or "improve"
on these specs. If a spec is genuinely ambiguous or contradicted by the code,
STOP and ask — do not guess and do not silently substitute your own approach.

Invoke the `game-dev-efficient` skill before starting. Read CLAUDE.md once.

## 1. Working rules (NON-NEGOTIABLE)

0. **MODEL CHECK FIRST.** Every patch below is tagged `[MODEL: OPUS]` or
   `[MODEL: SONNET]`. Before doing ANY work on a patch, output exactly:
   `PATCH <n> — REQUIRES <MODEL>`
   If the currently active model is not that model, STOP immediately and tell
   the user to switch with `/model`. Do not begin the patch. Do not "do it
   anyway because it looks simple." OPUS-tagged patches involve design
   judgement that must not be improvised.
1. **One patch at a time.** Apply, verify, report, then STOP and wait for the
   user's explicit go-ahead. Never chain patches.
2. **Exact-block edits only.** Find an exact existing block, replace with an
   exact new block. NEVER regenerate a whole file. `src/core/Renderer.js`,
   `index.html`, and `src/style.css` have previously been silently truncated by
   a prior AI tool — treat them as fragile.
3. **After every `.js` change run `node -c <file>`** and report the result.
   Working directory does NOT persist between Bash calls — always
   `cd /home/eduardo-ruiz/3_Games/Fractured/fractured-game && ...`.
4. **Run the relevant test script** after touching its subject area:
   `node test_bosses.js` (boss spawning, activeBoss, entity init/phase),
   `node test_content.js` and `node test_synapse.js` once they exist.
   These exit non-zero on failure.
5. **`npm run build`** validates module resolution across all files and takes
   ~200ms. Use it after multi-file patches.
6. You CANNOT verify visuals — there is no browser automation here. Say so
   plainly and hand visual verification to the user via `npm run dev`.
7. **Report honestly.** If a test fails, show the output. If you skipped part of
   a patch, say so and why. Never claim completion you haven't verified.
8. Not a git repo. There is no undo. Before overwriting anything non-trivial,
   back it up to the scratchpad directory.

## 2. Verified codebase facts — DO NOT RE-DERIVE

**Architecture**
- `src/main.js` owns the rAF loop and a string `gameState`. Nearly all
  cross-system wiring lives inline in `initEngine()`.
- `Game.state` is one big mutable object. Systems mutate it directly.
- `Director.js` owns `ObjectPool`s. Pool keys are `ent.type.toLowerCase()`.
- `src/entities/Player.js` is EMPTY — player state lives in `Game.state.player`.
- Empty 0-byte stubs wired to nothing: `Player.js`, `EcosystemAI.js`,
  `ParticleGen.js`, `HudUI.js`, `MenuUI.js`, `SynapseTree.js` (**stale as of
  Patch 29.6 — `SynapseTree.js` is no longer empty**).
- `Renderer.drawHUD()` is DEAD CODE. Real HUD is DOM (`#ui-layer`). Do not
  revive it.

**Content inventory (actual, as of original handoff — grew during 20/21/31/32)**
- 8 weapons: `flashlight` (starts `level:1`), `static`, `polaroid_camera`,
  `fidget_spinner`, `lead_pipe`, `spilled_ink`, `broken_chalk`,
  `corrosive_battery`. All except flashlight start `level:0`.
- Original: 9 boons, 3 synergies, 4 tokens, 2 token sets, 5 curses, 4 meta
  upgrades, 3 enemy types, 5 floors × 10 rooms, 2 room reward types.
  **Since grown:** tokens 4→16 (Patch 31), token sets 2→4, curses 5→7
  (Patch 32), boons/synergies expanded in Patches 20/21.

**Economy (verified)**
- XP drop `value` = 1 normally, 25 for massive. `state.lucidity += xp.value` on
  pickup — **Lucidity is 1:1 with kills.**
- LUCIDITY door = +50. Run-end banks `lucidity × lucidityBonusMultiplier`
  (that field already exists on state).
- `enemyBudget = floor(10 + floor*5 + roomNumber*2)`; costs are
  scavenger 1 / predator 2 / parasite 3.
- Patient Level = `floor(sqrt(spentLucidity/500)) + 1`.
  PL2=500, PL3=2000, PL4=4500, PL5=8000, PL6=12500, PL7=18000, PL8=24500,
  PL9=32000.

**Player base stats**
- `radius: 12`, `speed: 3.5 * speedBuff`, `maxHp: effectiveMaxSanity`
  (base 100 + hp*20), `dash: {duration: 12, cooldown set to 90 on use}`.
- `Combat.collectXP`: `baseVacRadius = 70`, `+30px per magnet level`
  (**stale as of Patch 31b — now reads `state.player.vacRadiusBonusPx`, a
  pre-summed legacy+tree+token total**).

**Meta / save**
- `metaState.upgrades = {hp, speed, light, magnet}`, integer levels, cap 100.
- `buyUpgrade(id, baseCost)`: cost `baseCost * 1.1^lvl`, deducts
  `lucidityBank`, adds `spentLucidity`, and **CALLS `saveGame()` ITSELF**.
- Base costs hardcoded in `UIManager.attachEvents`: hp 50, speed 75, light 100,
  magnet 150.
- **`spentLucidity` must NEVER decrease** — Patient Level derives from it and
  curses gate on PL5 + 1 boss kill.
- Upgrade consumers: `Game.init` (hp→maxSanity +20/lvl, speed→+5%/lvl,
  light→+10%/lvl); `Combat.js:503` (magnet→+30px, via `state.player.upgrades`,
  a copy made in `Game.init`).
- `loadGame()` back-fills missing fields. ANY new `metaState` field needs a
  back-fill there. `importSave` is a SECOND entry path needing the same
  coverage.
- `equippedTokens = {head, body, hands, legs}` hardcoded in FIVE places
  (**stale as of Patch 31 — now 5 slots, driven by the single
  `TOKEN_SLOT_TYPES` constant in `Manifestations.js`**): `SaveManager`
  constructor, `loadGame()` back-fill, hard-reset (~line 194),
  `UIManager.js:469`, and four `.token-slot` divs in `index.html`.
- All 4 tokens are types head/body/hands/legs. **No token can fill a 5th slot**
  (**stale as of Patch 31 — the `prescription` slot now exists, 16 tokens**).

**UI**
- Tabs: `#tab-main`, `#tab-curses`, `#tab-loadout`, `#tab-tree`, `#tab-roadmap`,
  `#tab-trophies`, `#tab-guide`.
- `#tab-tree` is NOT a tree — 4 flat `.synapse-node-file` rows, buttons
  `btn-upg-hp|speed|light|magnet`, spans `upg-<id>-lvl`, plus `tree-lucidity`
  and `btn-wipe-save` (**stale as of Patch 29.6/29.7 — it IS a tree now,
  rendered by `SynapseTree.js`**).
- `#tab-guide` EXISTS ("INDUCTION FLASHCARDS") with only 3 cards:
  `I. EVASION`, `II. DIRECTED THERAPY`, `V. THE VOID`. III/IV missing. Covers
  controls + Void, NOT Sanity/Lucidity/Patient Level/Tokens.
- Loadout is click-based (`selectInventoryItem`, `selectEquippedSlot`); slots
  `slot-head|body|hands|legs` with `data-type` (**stale as of Patch 33 — now
  drag-and-drop with click fallback, 5 slots, hover tooltips, sort/filter as
  of Patch 34**).
- **Reroll costs 20 SANITY**, not a count, gated on `sanity > 20` in
  `LevelUpUI.attachRerollEvent`. Unlimited but self-damaging.
- `LevelUpUI.show()` offers `shuffled.slice(0, 3)`.
- HubWorld interactable colours (reuse for branch palette): bed `#c5a059`,
  desk `#0ea5e9`, locker `#94a3b8`, trophies `#8b0000`.

**Combat feel — what already exists**
- `hitStop` and `cameraShake` ALREADY implemented at 6+ sites; batched damage
  numbers, dash + afterimages, footstep SFX all exist.
- **No enemy knockback anywhere** (**stale if Patch 16 has run**).
- **No player i-frames** (**stale if Patch 19 has run**). `Game.takeDamage()`
  did `sanity -= finalDmg` with no cooldown originally. Only
  `denialShieldActive` (one-shot) guards damage in the original code.

**Rendering work completed (patches 1–12) — DO NOT REGRESS**
- `Renderer.entPulse(ent, speed=0.1, offset=0)` — two detuned sines offset by
  `ent.phase`. Range ≈ [-1.3, 1.3] (~30% wider than a plain sine).
- `Scavenger`/`Predator`/`Parasite` set `this.phase = Math.random()*Math.PI*2`
  in **`init()`** (not constructor) because they are pooled. Bosses increment
  `phase`; the three small enemies use it as a STATIC offset.
- `Renderer.spriteCache` (Map), `getSprite(key,w,h,drawFn)`, `drawSprite()`,
  `drawGlow(x,y,radius,color,alpha)`. Sprites supersampled `spriteScale = 2`
  because world draws at `this.zoom = 1.3`.
- SCAVENGER body is sprite-cached with bob quantised into 0.5px buckets so
  desync survives caching. **Never flatten bucketing to one shared sprite.**
- `drawGlow` takes a HEX colour (routes through `hexToRgba`, which returns
  white for non-hex). ARCHITECT and PANOPTICON glows were deliberately NOT
  converted — they interpolate between two DIFFERENT colours.
- `Director.spawnRoom()` sets `state.activeBoss` immediately after
  `state.bossSpawned = true`. Fixes every boss announcing as "THE SPHERE HEAD".
  `test_bosses.js` guards it.
- Boss idle state names: PANOPTICON `'moving'`, RORSCHACH `'hunting'`,
  ARCHITECT `'hovering'`, AMALGAMATION `'resting'`, BOSS `'hunting'`.

**Dev tooling that exists**
- Press `0` to toggle `window.FRACTURED_DEV_MODE` (title/menu/hub/playing).
- Dev panel: floor selector, SKIP TO BOSS ROOM (+1200 XP), lucidity/patient-XP
  buttons, and VISUAL TEST BENCH — SPAWN ONE OF EACH ENEMY, SPAWN ALL 5 BOSSES,
  CLEAR ALL ENTITIES (releases to pools), FREEZE ENEMY AI
  (`state.devFreezeEntities`, guards `entity.update()` and `spawnWave()`), and
  scenario dropdown IDLE / TELEGRAPH / ATTACK / HIT FLASH. **Since grown:**
  LOADOUT TESTING section with ADD ONE OF EACH TOKEN / ADD RANDOM TOKEN
  (not part of the numbered queue — added ad hoc for testing Patch 33/34).
- `node test_bosses.js` — 22 assertions, all passing.
- `node test_content.js` — grew from an initial baseline to 157 assertions
  across Patches 31/32.
- `node test_synapse.js` — 255 assertions (Patches 29.2–29.4).

## 3. Golden rules

- **No `ctx.shadowBlur`.** Faux-glow via low-alpha radial gradients only.
- **Reset `ctx.globalCompositeOperation` to `source-over`** before any draw
  function returns if you changed it, or later draws (including the player)
  become invisible.
- **Never `splice()` a pooled entity without `pool.release()` first.**
- **Validate before Canvas math.** `NaN`/`undefined` into `arc`,
  `createRadialGradient`, `ellipse` throws `DOMException` and kills the render
  loop. Use `Number.isFinite()`. When forcing an entity state, set its
  companion fields too.
- **Defensive fallbacks on `metaState`** (`|| 0`).
- **All gameplay input via `InputManager`.**
- **Canvas = gameplay, DOM = menus. Never cross.**
- Preserve the clinical-file language (`.medical-folder`, `.blood-drop`,
  `.patient-stamp`, `.typewriter-text`).

## 4. Decisions already made — DO NOT RE-OPEN

1. Patch 30 is ABSORBED into Patch 29 as capstones. Numbering keeps 30 struck.
2. **Respec is OUT.** Former 29.9 dropped. Consequence: purchases are permanent,
   so NO trap/situational nodes.
3. 5th token slot CUT from 29, re-homed in Patch 31 (no token type can fill it).
4. "Extra reroll" = REDUCED REROLL COST (reroll is a 20-Sanity cost, not a count).
5. Patch 12b (predator/parasite sprite caching) folded into Patch 41.
6. Patch 10 boss-announcement audit is COMPLETE — all 5 banners + dispatch fixed.
7. **Synapse migration is a one-time `legacyUpgrades` snapshot**, NOT a
   write-through of `upgrades`. Details in 29.3/29.4. The naive mirror
   double-counts; do not implement it.
8. Tier-1 node cost is **150, not 120** — 120 creates a PL2 deadlock on fresh
   saves. Do not "round it down."

## 5. Execution order

**13 → 14 → 15 → 20 → 21 → 22 → 23 → 24 → 28 → 26 → 27 → 25 → 16 → 17 → 18 →
19 → 29.1 → 29.2 → 29.3 → 29.4 → 29.5 → 29.6 → 29.7 → 29.8 → 31 → 32 → 33 →
34 → 35 → 36 → 37 → 38 → 39 → 40 → 41**

29.1–29.4 are headless and ship zero visible change; they may be pulled forward
if the user asks.

---

# PATCH QUEUE

## TRACK A — Instrumentation

### Patch 13 — Run telemetry overlay  `[MODEL: SONNET]`  ✅ DONE
Files: `src/main.js`, `src/core/Game.js`
Dev-panel toggle recording and displaying: time-to-first-boon, time-to-first-boss,
per-room clear time, damage taken per room, sanity low-water mark. Text overlay
while active; console dump on death.
Keep: existing dev panel controls and `state.devFreezeEntities`.
Verify: `node -c`. User plays 3 runs.

### Patch 14 — Build-diversity logger  `[MODEL: SONNET]`  ✅ DONE
Files: `src/main.js`, `src/core/SaveManager.js`
On run end append `{weapons, levels, boons, synergies, tokens, curses, floor}`
to a capped localStorage ring buffer; dev button dumps as a table.
Keep: use a SEPARATE localStorage key — do not touch `fractured_meta`,
`exportSave`, or `importSave`.
Verify: `node -c`.

### Patch 15 — `test_content.js`  `[MODEL: SONNET]`  ✅ DONE
Files: new root `test_content.js`, modelled on `test_bosses.js` (mock
`document`/`window`/`localStorage`/`CustomEvent`; `document` needs
`dispatchEvent`, `addEventListener`, `getElementById`, `createElement`).
Assert: every `SYNERGIES[].reqs` id exists in the weapons object; tokens have
valid `type`/`rarity`; every `TOKEN_SETS` key referenced by ≥2 tokens; boon pool
≥ threshold; `getXPRequiredForLevel` monotonic. Exit non-zero on failure.
Verify: `node test_content.js`.

## TRACK C — Run variety

### Patch 20 — Boon pool 9 → ~24  `[MODEL: OPUS]`  ✅ DONE
Files: `src/data/Manifestations.js` (DATA ONLY)
DESIGN WORK: 15 new boon effects must be invented, spanning all 12 tags
(`light, focus, aura, tech, melee, kinetic, hazard, dark, orbit, burst,
utility, passive`). Weight offers toward the player's current tags so builds
commit rather than drift.
Keep: `getActiveSynergies()` signature; `LevelUpUI.show()`'s `slice(0, 3)`.
Verify: `node -c`, `node test_content.js`.

### Patch 21 — Synergies 3 → ~10  `[MODEL: OPUS]`  ✅ DONE
Files: `src/data/Manifestations.js` (DATA ONLY)
DESIGN WORK: existing 3 cover flashlight+static, lead_pipe+spilled_ink,
broken_chalk+corrosive_battery. `polaroid_camera` and `fidget_spinner` have
NONE. Invent ~7 pairings and their effects.
Keep: the `reqs` array shape.
Verify: `node test_content.js`.

### Patch 22 — Room modifiers  `[MODEL: SONNET]`  ✅ DONE
Files: `src/systems/Director.js`
Per-room modifier (elite / blackout / swarm / hazard) chosen in `spawnRoom`,
affecting `enemyBudget`, `stress`, spawn table.
Keep: the `roomNumber >= state.maxRoomsPerFloor && !state.bossSpawned` boss
branch EXACTLY as-is INCLUDING the `state.activeBoss` line, and the
floor-1-room-1 tutorial early-return.
Verify: `node -c`, `node test_bosses.js` must stay 22/22.

### Patch 23 — Room reward variety  `[MODEL: SONNET]`  ✅ DONE
Files: `src/systems/Director.js` (`spawnRewardDoors`), `src/systems/Combat.js`
(`ROOM_DOOR` branch)
Add weapon-upgrade / token / risk-reward doors beyond LUCIDITY and HEAL.
Keep: the `obj.dead`/`obj.active` toggle contract.
Verify: `node -c`.

### Patch 24 — Enemy variants  `[MODEL: OPUS]`  ✅ DONE
Files: `src/entities/Scavenger.js|Predator.js|Parasite.js`,
`src/systems/Director.js`
DESIGN WORK: armored / fast / volatile variants need balanced stat multipliers
and distinguishable tints, plus spawn-weighting per floor.
Keep: REUSE existing pools — do NOT add pools. Set variant fields in `init()`,
not the constructor (instances are recycled). Preserve the `this.phase`
assignment in `init()`.
Verify: `node -c`, `node test_bosses.js` (phase assertions must stay green).

## TRACK D — Progression clarity

### Patch 28 — End-of-run summary  `[MODEL: SONNET]`  ✅ DONE
Files: `src/main.js`, `index.html`, `src/style.css`
What you built, what killed you, what you earned, what to spend it on. Reuses
Patch 14's data.
Keep: existing death/awaken flow and lucidity banking.
Verify: `node -c`, `npm run build`.

### Patch 26 — Extend guide to meta systems  `[MODEL: SONNET]`  ✅ DONE
Files: `index.html` (`#tab-guide` only)
Fill missing III and IV cards; add Sanity-is-HP, Lucidity, Patient Level,
Tokens, Intrusive Thoughts.
Keep: existing flashcard markup/visual language exactly.
Verify: `npm run build`.

### Patch 27 — Value-delta tooltips  `[MODEL: SONNET]`  ✅ DONE
Files: `src/ui/UIManager.js`, `index.html`
Every upgrade and token shows current → next, not just cost.
Keep: `buyUpgrade` pricing and its self-saving behaviour — no caller-side
`saveGame()`.
Verify: `node -c`.

### Patch 25 — In-context first-run tutorial  `[MODEL: SONNET]`  ✅ DONE
Files: `src/main.js`, `src/systems/Director.js`, `index.html`
Staged prompts (move → aim → dash → interact → level-up) during the existing
tutorial room.
Keep: `tutorialCompleted` gate in `Director.spawnRoom` and its clear in
`Combat.js` (~line 114). UI-level key listeners live in `main.js`; gameplay
input stays in `InputManager`.
Verify: `node -c`, `node test_bosses.js`.

## TRACK B — Mechanical feel

### Patch 16 — Enemy knockback  `[MODEL: SONNET]`  ✅ DONE
Files: `src/systems/Combat.js`, `src/entities/Enemy.js`
Impulse on `takeDamage`, scaled by damage and weapon tag (`kinetic`/`melee`
heavy, `aura`/`passive` none). Decay in `applyMovement`.
Keep: existing `hitStop`/`cameraShake` values; the >1500px teleport-back; the
`confused` retarget; `takeDamage`'s 15-frame batching and `painCooldown`.
Verify: `node -c`, `node test_bosses.js`.

### Patch 17 — Enemy hit-reaction  `[MODEL: SONNET]`  ✅ DONE
Files: `src/core/Renderer.js`
Squash/recoil offset driven off existing `flashTime`.
Keep: `isFlashed` colour swaps. ONE SMALL PATCH PER ENTITY BRANCH — `node -c`
after each. Do not do all types in one edit.

### Patch 18 — Per-weapon impact weight  `[MODEL: SONNET]`  ✅ DONE
Files: `src/systems/Combat.js`
Per-tag hitStop/cameraShake weights so `lead_pipe` lands heavy, `static` light.
Keep: the `Math.min(25, ...)` hitStop ceiling.
Verify: `node -c`.

### Patch 19 — Player i-frames + hit direction  `[MODEL: SONNET]`  ✅ DONE
Files: `src/core/Game.js`, `src/core/Renderer.js`
Invulnerability window after `takeDamage` with a visible tell; directional
damage indicator. NOTE: node R4/R7 in the Synapse Tree add `iframes +Xf`, so
expose the base duration as a resolver-readable value.
Keep: `denialShieldActive` one-shot logic and its dashed-ring render.
Verify: `node -c`.

## TRACK E — Synapse Tree (Patch 29)

**Design context.** Replaces the 4 flat upgrade rows with a 4-branch tree.
Branch palette reuses HubWorld interactable colours.

**Node schema:**
`{ id, name, desc, branch, tier, cost, requires:[nodeId], minPatientLevel,
   effects: { <numeric deltas> and/or grant:'<string>' } }`
Costs are FLAT per node — the curve lives in tree depth, not `1.1^n`.

**HARD CONSTRAINT:** tree effects on the four legacy stats MUST be integer
multiples of the legacy step (sanity +20, speed +5%, light +10%, magnet +30px)
so the derived mirror stays lossless and integer. New stats (iframes, dash,
lucidity gain, token drop, tag damage, flashlight angle) have no legacy
equivalent and live only in the resolver bundle.

### Patch 29.1 — Node data  `[MODEL: SONNET]`  ✅ DONE
Files: `src/data/SynapseNodes.js` (NEW). Nothing imports it yet.
Transcribe EXACTLY the 31 nodes below. Do not invent, rename, retune, or add.

RESILIENCE (`#8b0000`)
| id | name | cost | PL | requires | effects |
|----|------|------|----|----------|---------|
| R1 | Thickened Skin       | 150  | – | –      | sanity +20 |
| R2 | Scar Tissue          | 350  | 2 | R1     | sanity +20 |
| R3 | Numbed Response      | 800  | 3 | R2     | sanity +40 |
| R4 | Deadened Nerves      | 1400 | 4 | R2     | iframes +20f |
| R5 | Clinical Detachment  | 2600 | 5 | R3     | sanity +40 |
| R6 | Second Opinion       | 3800 | 6 | R4     | grant:'denial_recharge' |
| R7 | Institutional Body   | 7000 | 8 | R5,R6  | sanity +60, iframes +10f |

FOCUS (`#c5a059`)
| id | name | cost | PL | requires | effects |
|----|------|------|----|----------|---------|
| F1 | Fresh Batteries      | 150  | – | –      | light +10% |
| F2 | Polished Lens        | 350  | 2 | F1     | light +10% |
| F3 | Wide Beam            | 800  | 3 | F2     | flashlightAngle +15% |
| F4 | Halogen Upgrade      | 1400 | 4 | F2     | light +20% |
| F5 | Focused Intent       | 2600 | 5 | F3     | tagDamage light/focus +10% |
| F6 | Steady Hand          | 3800 | 6 | F4     | light +20% |
| F7 | Perfect Clarity      | 7000 | 8 | F5,F6  | light +30%, tagDamage +15% |

MOTOR (`#0ea5e9`)
| id | name | cost | PL | requires | effects |
|----|------|------|----|----------|---------|
| M1 | Restless Legs        | 150  | – | –      | speed +5% |
| M2 | Quick Feet           | 350  | 2 | M1     | speed +5% |
| M3 | Muscle Memory        | 800  | 3 | M2     | dashCooldown -15f |
| M4 | Adrenaline           | 1400 | 4 | M2     | speed +10% |
| M5 | Extra Step           | 2600 | 5 | M3     | dashDuration +4f |
| M6 | Sprinter's Heart     | 3800 | 6 | M4     | speed +10% |
| M7 | Flight Response      | 7000 | 8 | M5,M6  | grant:'dash_charge_2' |

FORTUNE (`#94a3b8`)
| id | name | cost | PL | requires | effects |
|----|------|------|----|----------|---------|
| T1 | Keen Eye             | 150  | – | –      | magnet +30px |
| T2 | Sticky Fingers       | 350  | 2 | T1     | magnet +30px |
| T3 | Clarity Dividend     | 800  | 3 | T2     | lucidityGain +10% |
| T4 | Deep Pockets         | 1400 | 4 | T2     | magnet +60px |
| T5 | Salvager             | 2600 | 5 | T3     | tokenDropRate +25% |
| T6 | Compound Interest    | 3800 | 6 | T4     | lucidityGain +15% |
| T7 | Hoarder's Instinct   | 7000 | 8 | T5,T6  | tokenDrop +25%, lucidityGain +15% |

CAPSTONES (absorbed Patch 30)
| id | name | cost | PL | requires | effects |
|----|------|------|----|----------|---------|
| C1 | Preparation      | 6000 | 7 | any two tier-4 | grant:'start_boon' |
| C2 | Personal Effects | 8000 | 9 | any tier-7     | grant:'start_weapon:<choice>' |
| C3 | Second Guess     | 6500 | 7 | F5 or T5       | rerollCost -10 (20→10 sanity) |

Total tree cost = **84,900**. Every node is a straight gain (no respec).
`lucidityGain` feeds the existing `state.lucidityBonusMultiplier`.
Verify: `node -c`.

### Patch 29.2 — Graph integrity tests  `[MODEL: SONNET]`  ✅ DONE
Files: `test_synapse.js` (NEW, root)
Assert: every `requires` id exists; no cycles; every node reachable from a root;
no duplicate ids; costs non-negative; every `effects` key is one the resolver
knows; every `grant` string has a named consumer; legacy-stat effects are exact
integer multiples of their legacy step.
**PL-DEADLOCK INVARIANT (critical):** for every node, the cumulative cost of all
nodes purchasable at or below its PL gate must be ≥ the `spentLucidity` needed
to reach that gate. Expected passing values: after all tier-1 = 600 (PL2 ✓);
tier-2 = 2000 (PL3 ✓); tier-3 = 5200 (PL4 ✓); tier-4 = 10800 (PL5 ✓);
tier-5 = 21200 (PL7 ✓); tier-6 = 36400 (PL9 ✓).
Verify: `node test_synapse.js`, non-zero exit on failure.

### Patch 29.3 — Save schema + migration  `[MODEL: SONNET]`  ✅ DONE
Files: `src/core/SaveManager.js`
Add `metaState.treeNodes = []`. Back-fill in `loadGame()` AND cover the
`importSave` path.
Migration: take a ONE-TIME snapshot `metaState.legacyUpgrades = {...upgrades}`,
guarded on `legacyUpgrades === undefined` so it is idempotent.
Keep: **`spentLucidity` UNTOUCHED.** Do NOT convert legacy levels into purchased
nodes — legacy `hp` can be level 30 and would lose power.
Verify: fixture saves (legacy / fresh / maxed) asserted in `test_synapse.js`.

### Patch 29.4 — Purchase + resolver  `[MODEL: SONNET]`  ✅ DONE
Files: `src/core/SaveManager.js`
`buyNode(nodeId)` validating requires, `minPatientLevel`, and bank.
`getResolvedUpgrades()` returning `{ stats: {...}, grants: Set }` — summed
numerics and discrete grants kept separate so grants are never added as numbers.
**Resolver total = `legacyUpgrades` + tree contributions.** Never re-read
`metaState.upgrades` (that would double-count).
Then update `metaState.upgrades` as a PURE DERIVED MIRROR of the total in legacy
level units, so unfound readers (e.g. `Combat.js:503`) stay correct.
Keep: `buyUpgrade()` intact and callable; it self-saves.
Verify: assert a migrated legacy save resolves to the SAME derived stats the old
flat upgrades produced.

### Patch 29.5 — Consumers read the resolver  `[MODEL: SONNET]`  ✅ DONE
Files: `src/core/Game.js`, `src/systems/Combat.js`, `src/ui/LevelUpUI.js`
`Game.init` reads stats + honours `start_weapon`/`start_boon`/`dash_charge_2`/
`denial_recharge`; `Combat.js:503` magnet; `LevelUpUI` reroll cost.
Keep: the `Game.init()` ← `metaState` seam. Never write run state into meta.
Verify: `node -c`, `node test_synapse.js`.

### Patch 29.6 — Tree renderer  `[MODEL: SONNET]`  ✅ DONE
Files: `src/ui/SynapseTree.js` (currently 0 bytes). DOM ONLY — no canvas, no SVG.
Layout, exactly:
```
┌─ sticky header: LUCIDITY RESERVES · PATIENT LEVEL ─────────┐
├────────────┬────────────┬────────────┬────────────┤
│ RESILIENCE │   FOCUS    │   MOTOR    │  FORTUNE   │ headers
├────────────┼────────────┼────────────┼────────────┤
│     R1     │     F1     │     M1     │     T1     │ tier 1
│     R2     │     F2     │     M2     │     T2     │ tier 2
│   R3  R4   │   F3  F4   │   M3  M4   │   T3  T4   │ tiers 3–4 split
│   R5  R6   │   F5  F6   │   M5  M6   │   T5  T6   │ tiers 5–6
│     R7     │     F7     │     M7     │     T7     │ tier 7
├────────────┴────────────┴────────────┴────────────┤
│   C1 Preparation │ C2 Personal Effects │ C3 Second Guess  │ span 4
└──────────────────────────────────────────────────┘
```
- `#synapse-tree-grid`, CSS Grid `repeat(4, 1fr)`, gap 12px,
  `overflow-y: auto` (matches `#tab-guide`), plus `overflow-x: auto` with a
  `min-width` so narrow/touch screens scroll rather than reflow.
- Node card ≈ 140×80px; grid ≈ 620px wide.
- **Connectors:** CSS `::before` vertical rules between tiers WITHIN a column.
  **No diagonal lines.** Two-parent tier-7 nodes and cross-branch capstones show
  prereqs as TEXT BADGES ("Requires: Clinical Detachment + Second Opinion").
- Click-to-buy calls `buyNode`.
Verify: `node -c`, `npm run build`.

### Patch 29.7 — UIManager rewiring  `[MODEL: SONNET]`  ✅ DONE
Files: `src/ui/UIManager.js`, `index.html` (`#tab-tree`)
Remove the 4 hardcoded `buyUpgrade` handlers and the `upg-<id>-lvl` loop;
delegate to `SynapseTree`.
Keep: `tree-lucidity` element and `btn-wipe-save`.
`index.html` is fragile — expect 2–3 small patches.
Verify: `node -c`, `npm run build`.

### Patch 29.8 — Tree visuals  `[MODEL: SONNET]`  ✅ DONE
Files: `src/style.css`
Node states, reusing the clinical-file language:
- purchased → `.patient-stamp` "AUTHORISED" overprint
- available → gold border + cost button
- unaffordable → gold border, cost in `--ui-red`
- locked → desaturated, "PATIENT LEVEL n REQUIRED"
Branch colour coding: Resilience `#8b0000`, Focus `#c5a059`, Motor `#0ea5e9`,
Fortune `#94a3b8`.
Keep: `.synapse-node-file`, `.file-btn`, `.typewriter-text` vocabulary.
Verify: `npm run build`.

## TRACK E (cont.)

### Patch 31 — Tokens 4 → ~16, sets legible, 5th slot  `[MODEL: OPUS]`  ✅ DONE (+ 31b wiring)
Files: `src/data/Manifestations.js`, `src/ui/UIManager.js`,
`src/core/SaveManager.js`, `index.html`
DESIGN WORK: 12 new tokens, a NEW token type for the 5th slot, and set
identities/bonuses. Then show 2/4 set progress pre-run and update the 4-slot
shape in ALL FIVE hardcoded places listed in §2.
Keep: `equipToken`/`unequipToken`/`upgradeToken` APIs; `loadGame()` back-fill
must cover the new slot key for old saves.
Verify: `node -c`, `node test_content.js`, `npm run build`.

### Patch 32 — Curse risk ladder  `[MODEL: SONNET]`  ✅ DONE (+ 32b wiring)
Files: `src/data/Manifestations.js`, `src/core/SaveManager.js`,
`index.html` (`#tab-curses`)
Stacking curses with a visible cumulative Lucidity multiplier.
Keep: the PL5 + 1-boss-kill unlock gate.
Verify: `node -c`, `node test_content.js`.

## TRACK F — Loadout UX

### Patch 33 — Loadout redesign  `[MODEL: SONNET]`  ✅ DONE
Files: `index.html` (`#tab-loadout`), `src/ui/UIManager.js` (`renderLoadoutUI`,
`selectInventoryItem`, `selectEquippedSlot`), `src/style.css`
Slot grid + inventory side by side; drag-and-drop WITH click fallback (click is
the touch path — do not remove it); hover stat-delta; set-progress indicator.
Keep: `slot-<type>` ids and `data-type`; `.token-slot` and `.rarity-*` classes.
Verify: `node -c`, `npm run build`.

### Patch 34 — Token compare & upgrade flow  `[MODEL: SONNET]`  ✅ DONE (+ 34b clipping fix)
Files: `src/ui/UIManager.js`, `index.html`
Equipped-vs-hovered diff, inline upgrade with cost, rarity sort/filter.
Keep: `upgradeToken` cost curve.
Verify: `node -c`, `npm run build`.

## TRACK G — Complete visual overhaul (FINAL POLISH)

⚠️ BEFORE PATCH 35: CLAUDE.md records that per-floor/biome visual
differentiation is "being handled in a separate effort — don't start on it
unless explicitly asked." The user HAS explicitly asked, so it is in scope.
Confirm the other effort is not still live, then update that CLAUDE.md line.
**Confirmed with the user 2026-07-26: no other effort is live. CLAUDE.md
updated. Cleared to proceed.**

### Patch 35 — Per-floor biome identity  `[MODEL: OPUS]`  ✅ DONE
Files: `src/core/Renderer.js` (`generateFloorPatterns`), `src/systems/HubWorld.js`
Keep: the offscreen-cache pattern; regenerate on floor change only.

### Patch 36 — Lighting & atmosphere pass  `[MODEL: OPUS]`  ✅ DONE
Files: `src/core/Renderer.js` (`lightCanvas` pipeline, fog clouds)
Keep: **the `globalCompositeOperation` reset rule** — highest-risk section in
the codebase for invisible-player bugs.

### Patch 37 — Menu/DOM visual pass  `[MODEL: OPUS]`  ⬅ NEXT
Files: `index.html`, `src/style.css`
Keep: `.medical-folder`, `.blood-drop`, `.patient-stamp`, `.typewriter-text`.

### Patch 38 — HUD overhaul  `[MODEL: OPUS]`
Files: `index.html` (`#ui-layer`), `src/style.css`, `src/ui/UIManager.js`
Keep: DOM-ONLY. `Renderer.drawHUD()` is dead — do NOT revive it.

### Patch 39 — VFX pass  `[MODEL: OPUS]`
Files: `src/core/Renderer.js`, `src/systems/Director.js`
Particles are currently 2px lines.
Keep: pool discipline; no `shadowBlur`; prefer the existing `drawGlow` helper.

### Patch 40 — Boss arena & telegraph polish  `[MODEL: OPUS]`
Files: `src/core/Renderer.js`
Keep: every telegraph's existing TIMING and HITBOX. Looks only — must not change
balance.

### Patch 41 — Consistency audit + perf re-check (includes 12b)  `[MODEL: SONNET]`
Files: `src/core/Renderer.js`
Final sweep, plus deferred 12b: extend sprite caching to PREDATOR and PARASITE
bodies using the SAME quantised-bucket approach used for SCAVENGER, re-measured
against Patch 13 telemetry.
Keep: **Patch 11 desync — bucket the animation parameter, NEVER flatten.**
`entPulse` output is ~[-1.3, 1.3]; cache keys must capture every input or
entities render stale forever.
Verify: `node -c`, `npm run build`, `node test_bosses.js`.

---

## Final reminder

Before EVERY patch: output `PATCH <n> — REQUIRES <MODEL>` and stop if the active
model doesn't match. After EVERY patch: run the checks, report plainly, then STOP
and wait for an explicit go-ahead.
