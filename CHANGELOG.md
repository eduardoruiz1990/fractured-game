# FRACTURED — Change Log (Patches 49–63)

*Written 2026-08-04. Covers the CrazyGames Basic Launch remediation work driven by
`BASIC_LAUNCH_FIX_QUEUE.md`, plus the follow-ups that came out of live play. Picks
up where `EXECUTION_HANDOFF.md` (patches 13–41) left off.*

**Read this before changing any of the systems below.** Like `EXECUTION_HANDOFF.md`,
this file exists because the reasoning behind these changes is not recoverable from
the diff alone — several are guards against failures that are invisible locally and
only appear on a player's device. The **Keep clauses** at the end are the parts most
likely to be broken by accident.

Session commits: `a4b954c` → `d5c179a` (5 commits).

---

## Why this work happened

Day-1 CrazyGames dashboard data flagged two metrics BOTTOM 20%: average playtime
**1m36s** and gameplay conversion **31.89%** (players who reach 60 seconds). Load
time (1.4s) was fine. Crash rates (load 1.49%, gameplay 0.75%) were modest but
completely undiagnosed — no telemetry existed.

---

## PHASE 1 — Investigation

### Patch 49 — Onboarding click-path trace *(no code changes)*
Cold load to first enemy took **4 discrete actions across 3 screens**: INITIALIZE →
walk a dark hub → `E` → AUTHORIZE DESCENT. CrazyGames guidance asks for ~1 click.

Findings that drove Phase 2:
- The hub was the **only** route to the folder menu; there was no other entry point.
- On arrival in the hub, `player.angle` starts at `0` (facing right), which points
  the interaction prompt at the *upgrades desk*, not the start-run machine.
- Mobile has no visible controls until first touch, and the only tutorial text is
  world-space and reads "WASD / Mouse".
- Zone beacons vanish on ~25% of flicker cycles (`lightIntensity > 0.5` gate).
- INITIALIZE was inert for up to 3s during SDK init, with no loading state.

### Patch 50 — Crash/error telemetry
**New: `src/core/ErrorLog.js`.** Captures `window.onerror` (capture phase, so
resource-load failures are included), `unhandledrejection`, and — most importantly —
the game loop's own `try/catch`, which had been swallowing every in-run crash.

Records timestamp, source, message, stack, `{gameState, floor, room}`, plus a
one-per-session device fingerprint (class, viewport, DPR, cores, memory). Dedupes by
signature with a repeat counter; capped at 30 entries / 24 KB in `localStorage`.
Readable anywhere via `FRACTURED_ERRORS.dump() / .export() / .clear()`.

The main-loop catch also stopped using `console.error`: from inside the rAF chain
Chrome prints its full async causality stack — hundreds of frames per crash, which
buries devtools at 60fps. It now logs the real synchronous stack once per distinct
message.

### Patch 51 — Crash-surface review, and fixes 51a–d
Ran as a code-review diagnostic (the field data it was gated on cannot exist — see
Known Issues).

- **51a — unguarded `localStorage` (the important one).** Five raw calls in
  `main.js`, one on the boot path inside `initEngine()`. In a partitioned or blocked
  iframe — Safari ITP, third-party-cookie blocking, in-app webviews — *touching*
  `window.localStorage` throws `SecurityError`. That killed the entire launch: no
  game loop, no title handler, dead screen. The CrazyGames SDK ships its own
  `SafeLocalStorage` wrapper for exactly this reason. Now routed through
  `portalSDK`, which is already try/caught and cloud-syncs for signed-in players.
- **51b — `getContext('2d')` was never null-checked.** Returns null under memory
  pressure; `new Renderer()` then threw on its first line. Now aborts boot with an
  in-voice `SESSION REFUSED` notice.
- **51c — instrumented the swallowing catches** in `Renderer` (×3), `Combat` and
  `Director`. `drawGame` is called from *inside* the loop's try, so render
  exceptions never reached the Patch 50 telemetry at all.
- **51d — zero-area canvas.** `canvas.width = window.innerWidth` was unclamped; a
  zero-sized iframe made every `drawImage(lightCanvas)` throw `InvalidStateError`,
  once per frame, freezing the screen. Clamped to ≥1, plus an early-return in
  `drawGame`. (`updateZoom` already guarded this case, so it was known to occur.)

---

## PHASE 2 — Funnel redesign

### Patch 53 — Resume dropped to room 1 *(prerequisite for 52)*
`getCarriedState()` never captured `roomNumber` and `init()` hardcoded `1`.

Three changes, not the two the queue specified — **the third is load-bearing**: the
descend handler must now reset `carryData.roomNumber = 1`. You only reach DESCEND
DEEPER by killing the boss in room 10, so carrying the room forward made
`Director.spawnRoom` see `roomNumber >= maxRoomsPerFloor` and drop the next floor's
boss into its opening room.

### Patch 52 — Title screen goes straight to gameplay
**1 click** to gameplay, down from 4 actions. `BEGIN DESCENT` / `RESUME DESCENT`
(shown only when a suspended run exists) / `MIND HUB`.

All four entry points — both title buttons, the hub's AUTHORIZE DESCENT, the
folder's RESUME — now funnel through one `startNewRun()` / `resumeSuspendedRun()`
pair, so they cannot drift.

Two bugs found while wiring it:
- **Upgrades bought in the hub did not apply to the run launched from it.** The old
  callback deliberately skipped `game.init()`, so `state.player` was built from meta
  as it was when the player *entered* the hub.
- **The menu theme would have bled over the opening room.** `stopMenuTheme()` fades
  across a full second. Split `AudioEngine.unlock()` out of `init()` — it resumes the
  context without starting the menu bed. `Game.init()` already starts the gameplay
  drone.

### Patch 52b — Title polish
Suspended-run notice became a stamped plate (it was `#8b0000` text on a dark red
background — invisible). `window.confirm()` replaced with an in-world
`#confirm-modal` reusing the `.medical-folder` chrome.

---

## PHASE 3 — Backlog

### Patch 54 — Auto-save on unclean exit
`pagehide` + `beforeunload` + `visibilitychange`, because none alone is reliable —
on mobile a tab is often discarded without ever firing `beforeunload`. Guarded to
`PLAYING`/`PAUSED`.

**Deliberately does not bank Lucidity** (unlike Awaken): the carried state keeps
`lucidity`, so paying out per autosave would let a player background the tab
repeatedly and be paid each time.

**Required a companion fix:** the suspended run is now cleared in `game.onDeath`.
Before this patch nothing wrote a mid-floor save, so death had nothing to clean up;
with continuous autosaves, dying would have left a resumable copy — making death
free.

### Patches 55 + 56 — Data-driven Clinical Guide
**New: `src/ui/GuideUI.js`.** Renders door rewards, room conditions, the bestiary,
strains, weapons, synergies, boons, tokens, sets and curses from live game data. The
nine hand-written prose flashcards stay in markup (prose is fine hardcoded; a
catalogue is not).

Two enabling changes:
- **`BOONS` is now exported from `LevelUpUI.js`.** It was a `const` local to
  `show()`, so nothing could read the real boon pool. This closed a gap
  `test_content.js` had documented as untestable.
- **`PLAYER_WEAPON_IDS` added to `Manifestations.js`.** `MANIFESTATIONS` also
  contains `adrenaline`, which is **not a real weapon** — `Game.init()` never creates
  it. Iterating `MANIFESTATIONS` would advertise an unobtainable item.

### Patch 57 — Manifestation Log
`metaState.boonHistory` → `{ timesChosen, highestLevelReached }`, recorded from both
grant paths (level-up card, `ROOM_DOOR` weapon reward). New folder tab, reusing the
roadmap's redaction vocabulary.

**Import back-fill needed the opposite treatment from load.** A `if (!boonHistory)`
guard is wrong in `importSave`: when the imported file lacks the key, the spread
leaves *this instance's* history in place, the guard never fires, and the previous
profile's record survives into the imported save. It now derives from `parsed`.

### Patch 58 — Enemy leash
Replaced the single 1500px teleport with a soft catch-up pull plus a hard recall.
`strayTime` resets in `initBase` — these are pooled, and a recycled straggler would
otherwise spawn at full catch-up boost.

---

## POST-PHASE — from live play

### Patch 59 — Guide categories, Mind Palace, run statistics
- Guide split into **CONTROLS / ROOMS / ENEMIES / INSTRUMENTS / TRAITS / TOKENS /
  THOUGHTS**; hidden panes are `display:none` so they contribute no scroll height.
- **Mind Palace rebuilt data-driven with redaction.** Kept as the *single* home for
  kill counts — the Manifestation Log deliberately does not repeat them. Unencountered
  manifestations are now sealed, which also stops the trophy room spoiling all five
  bosses to a new player.
- `runsStarted` / `deaths` / `runsCompleted`. Descents count in `startNewRun()`, not
  `enterPlayingState()` (resuming is the same descent continuing). Completions latch
  on `state.runCompletionRecorded`.

### Patch 60 — Tutorial leash, title case record
The general leash was actively wrong in the tutorial: it recalled to 700px at a
random bearing, off-screen on most viewports — "rescuing" the only enemy in the game
by hiding it. The tutorial now recalls to `state.viewSafeRadius`, the same on-screen
radius Director spawns it at.

### Patch 61 — Off-screen leash dead zone *(from a player report)*
**Reported symptom:** dying because the last 1–2 enemies never arrived.

**Not a "too far" problem.** `SOFT_LEASH` was a flat 520px while the visible
half-height at 1080p is ~415px, so an enemy that stopped moving in that band was
simultaneously off screen and below the threshold that triggers help — forever. A
Scavenger in its `vacuuming` state does exactly that. Worse, the pull released the
instant an enemy crossed the threshold, so its equilibrium *was* the threshold: even
a correctly-leashed enemy came to rest just out of sight.

Thresholds now derive from `state.viewHalfExtent`, published by
`Director.spawnWave`, plus hysteresis (`RECOVERED`) so a recalled enemy comes fully
back into frame.

### Patch 62 — Predator feeding cap *(same report)*
Predators absorb nearby Scavengers (`this.hp += 20`) — previously uncapped. A slowly
cleared room became a feedback loop: scavengers survive longer → predators eat them →
the last enemies are 300–400hp sponges on Floor 1. Capped at **2× `spawnMaxHp`**.

`maxHp` now tracks the gain — `hp` used to climb past it, so the health bar rendered
above 100%. `spawnMaxHp` is re-stamped in `applyEnemyVariant` **after** the variant
multiplier, or an ARMORED predator's cap would sit below its own starting HP.

### Patch 63 — Boss banner fit, flashlight cone falloff *(from live play)*

**Banner truncation.** `drawBossAnnouncement` hardcoded `900 110px` and never
measured. The title is left-aligned from `x = -100` with the panel centred, so the
usable width is `canvas.width / 2 + 100`, and the longer names overran it.

The reason it reproduced on one machine and not another: **`'Courier New'` is not
installed on most Linux systems**, so it falls back to a wider monospace. Identical
name, identical window, different glyph widths. Any fix based on assumed metrics
would have been wrong on some platform — it now measures at runtime and scales to
fit, and viewports under 720px centre the text and use the full width (the boss
portrait is drawn around `x = -565..-235` and is entirely off screen on a phone, so
the left-aligned layout was budgeting space that did not exist).

**Flashlight cone falloff.** The cone was binary: anywhere inside it dealt identical
damage and an identical shove, which made *sweeping* the beam strictly better than
aiming it and removed any reason to prioritise a target.

New pure exported `coneFalloff(angleDiff, hitAngle)` in `Combat.js`, with two
deliberately different curve shapes:

| | Centre | Edge |
|---|---|---|
| Damage | 1.00 | 0.55 — gentle, so clipping a target is still worth doing |
| Recoil | 1.00 | 0.10 — steep (quadratic), so only a direct beam holds anything off |

Layered on top is `LIGHT_RECOIL_RESIST` (`Manifestations.js`): Scavenger 1.0,
Parasite 0.7, Predator 0.45, apex 0.10–0.25. Both the knockback and the positional
flinch scale by `falloff × resistance`, so a Predator on the edge of the cone barely
slows. This is also the "enemies are more aggressive" change — they now push through
light that previously stopped everything equally.

`ritual_focus`'s ward bypass is *not* the beam touching the target, so it keeps full
damage and applies **no** push.

Documented in-game in the guide's INSTRUMENTS category — the tension only works if
the player understands it.

---

## Keep clauses (things future patches break by accident)

1. **Never touch `localStorage` directly in `main.js`.** Use
   `readSuspendedRun` / `writeSuspendedRun` / `clearSuspendedRun`, which go through
   `portalSDK`. Raw access throws in a blocked iframe and kills boot.
2. **A new `metaState` field needs back-fill in BOTH `loadGame()` and
   `importSave()`** — and in `importSave` it must be derived from `parsed`, not
   guarded on truthiness, or the previous profile's value survives the import. Also
   add it to `wipeSave()`.
3. **`getCarriedState()` carries `roomNumber`.** Anything that carries state to a
   *new floor* must reset it to 1.
4. **Autosave must never bank Lucidity, and must be cleared on death.**
5. **Leash thresholds derive from `state.viewHalfExtent`** (`min(w,h)/2 ÷ 1.3`).
   The 1.3 must stay in sync with `Renderer.updateZoom`'s `MAX_ZOOM`. Never
   reintroduce fixed-pixel leash constants — they are wrong on every other viewport.
6. **`strayTime` and `spawnMaxHp` must be reset/stamped in `initBase`**, and
   `spawnMaxHp` re-stamped in `applyEnemyVariant`. Pooled entities inherit anything
   you forget.
7. **`PLAYER_WEAPON_IDS`, not `Object.keys(MANIFESTATIONS)`,** for anything
   player-facing. Guarded by `test_content.js`.
8. **`BOONS` (exported from `LevelUpUI.js`) is the boon pool.** `MANIFESTATIONS` is
   not, despite appearances.
9. **`DOOR_REWARDS` / `ROOM_MODIFIERS` in `Manifestations.js` mirror inline literals**
   in `Combat.js` and `Director.js` that are not exported. Tuning one means changing
   both.
10. **New swallowing catches should call `errorLog.capture(e, '<source>')`** —
    otherwise the crash is invisible to telemetry, which is how the gameplay crash
    rate went unexplained.
11. **The Clinical Guide and Mind Palace are data-driven.** Do not add hardcoded
    cards to either.
12. **Never size canvas text by assumption — measure it.** `'Courier New'` is absent
    on most Linux systems and falls back to a wider monospace, so hardcoded font
    sizes with fixed offsets fit on one machine and truncate on another. Anything
    drawing player-facing text into the canvas needs `measureText` and a narrow-
    viewport path.
13. **`coneFalloff()` is the single source of the flashlight's damage/recoil
    curves**, and `LIGHT_RECOIL_RESIST` needs an entry for every new enemy type
    (asserted in `test_content.js`). If the curves are retuned, update the
    AIMING THE BEAM cards in `GuideUI.js` — they state the behaviour in words.
14. **`coneFalloff` runs every frame for every lit enemy.** It must stay total: it
    feeds a positional flinch, so a `NaN` escaping it teleports entities. The
    degenerate-input cases are asserted; keep them passing.

---

## Known issues — deliberately NOT fixed

- **Lucidity double-bank.** Awaken banks `state.lucidity` *and* saves it into the
  carried run, so suspend → resume → suspend banks the same Lucidity each cycle.
  Pre-existing; fixing it changes the reward economy, so it needs a design decision.
- **Pooled arrays cleared without release.** `Combat.js`'s `ROOM_DOOR` transition
  does `state.projectiles = []`, `xpDrops`, `tokenDrops`, `inkPuddles`, `safeZones`
  — all pooled types. `ObjectPool.release` is just a push, so these objects never
  return and `get()` falls back to allocating. Violates the golden rule in
  `CLAUDE.md`; drains the pools a little every room transition.
- **~9 swallowing catches still uninstrumented.** `SaveManager`'s
  `"Failed to save game data"` is the notable one — a silent save failure loses real
  progress.
- **`ErrorLog` is local-only.** Nothing is transmitted, so there is no field
  aggregate. A remote sink (the queue names ByteBrew) is a separate decision.
- **`GAME_STATE.md` does not exist** despite `BASIC_LAUNCH_FIX_QUEUE.md` citing it as
  authoritative. Closest equivalent is `PROJECT_STATE_SUMMARY.md`.

---

## Test inventory

| File | Count | Covers |
|---|---|---|
| `test_bosses.js` | 28 | boss dispatch, `activeBoss` on spawn frame, entity `.phase` pooling, **predator feeding cap** |
| `test_content.js` | 180 | synergy/token/set/curse data, XP curve, audio asset paths, **boon pool**, **`PLAYER_WEAPON_IDS` vs real loadout**, **cone falloff curves + light-recoil coverage** |
| `test_synapse.js` | 255 | Synapse Tree costs, gates, resolver |
| `test_leash.js` | 12 | **new** — off-screen dead zone, recall lands on screen, boss exclusion, tutorial cases |

`test_director.js` and `test_save.js` remain exploratory (they print, they don't
assert). All four assertion suites exit non-zero on failure and should be run after
touching entities, save schema, or content data.
