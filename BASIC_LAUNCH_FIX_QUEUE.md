# FRACTURED — Basic Launch Fix Queue (Patches 49–58)

*Written 2026-08-04. Companion to `CLAUDE.md`, `GEMINI.md`, `GAME_STATE.md`,
and the prior `LAUNCH_HANDOFF_V3.md`. This document picks up numbering where
that queue left off. Read `CLAUDE.md` and `GAME_STATE.md` before starting —
they are authoritative on architecture and current state; if anything here
conflicts with them, they win.*

## Why this queue exists

FRACTURED entered CrazyGames Basic Launch. Day-1 dashboard data showed two
metrics flagged BOTTOM 20% by CrazyGames' own benchmarking:

- **Avg playtime: 1m36s** (benchmark: successful titles see 10+ min)
- **Gameplay conversion: 31.89%** (benchmark: top titles convert 80%+;
  conversion = % of players who play at least 1 minute)

Load time (1.4s) is strong — not a bottleneck. Retention (D1/D7 showing
0.00%) is very likely just not-yet-computed, since D1 retention needs a full
extra day to appear on the dashboard; re-check before treating it as signal.
Crash rates (Load 1.49%, Gameplay 0.75%) are modest in isolation but
uninvestigated — no telemetry currently exists beyond the CrazyGames
dashboard aggregate.

Basic Launch allows updates at any time, live instantly, automatically
approved. The evaluation window is minimum 7 days live AND 500+ plays (both
required) — we've cleared 500 plays but the 7-day clock is still running, so
there is real runway left for a corrected build to generate the data that
actually gets judged.

## How to work through this document

This queue has three phases. **Phase 2 depends on Phase 1's findings —do not
skip ahead.** Phase 3 is independent backlog and can be reordered freely if
priorities shift, but keep it last as currently sequenced.

**After every single patch** (not just every phase): run the standard
verification discipline — `node -c` syntax check → targeted grep validation
→ `git diff` review — then **stop and report back to the user.** State what
changed, what you verified, and explicitly ask whether to proceed to the next
patch. Do not chain multiple patches together in one uninterrupted run, even
if the next patch seems obvious or trivial. The user validates in-game
between patches; that step cannot be skipped or assumed.

At the end of each phase, additionally summarize the phase's findings/changes
as a whole before asking whether to proceed into the next phase.

If at any point a patch's scope turns out to require a decision not specified
here (naming, exact UX wording, an architectural choice left open below),
stop and ask rather than guessing — this queue intentionally leaves some
judgment calls to be resolved with the user or by the assigned model's own
investigation, and says so explicitly where that's the case.

---

## PHASE 1 — Investigate (do this before any redesign work)

### Patch 49 — Trace the real onboarding click-path `[MODEL: OPUS]`
**Files:** `src/main.js`, `index.html`, `src/ui/UIManager.js` (read-only pass)

- Trace the exact sequence of clicks/interactions from cold load (title
  screen) to the point a player is actually in combat (floor 1, room 1,
  enemies present). Count discrete user actions required.
- Note: there is no custom CrazyGames SDK "GameplayStart" event in play here
  — Basic Launch requires no SDK, and CrazyGames' "conversion" metric is
  simply "played the game for ≥60 seconds," tracked automatically. So the
  investigation is not about finding an event hook — it's about honestly
  mapping how long/how many steps it takes a new player to reach something
  engaging, and where in that path a confused or impatient player would
  plausibly bail before hitting 60 seconds.
- Cross-reference against CrazyGames' own placement guidance: games should
  land users in gameplay in as close to 1 click as feasible.
- Output: a short written summary (in your response to the user, not
  necessarily a new file) of the click path today, and a plain read on
  whether it's a likely contributor to the low conversion number.

### Patch 50 — Lightweight crash/error telemetry `[MODEL: SONNET]`
**Files:** `src/main.js`, new small module if cleaner (e.g.
`src/core/ErrorLog.js`)

- Add a global `window.onerror` and `window.addEventListener('unhandledrejection', ...)`
  handler.
- Capture on each error: timestamp, `gameState`, current floor/room (if
  available from `game.state`), user agent / rough device class, and the
  error message/stack.
- For now, the simplest viable sink is acceptable — do not scope-creep into
  a full analytics integration here. A local retrievable log (e.g.
  accumulating in `localStorage` under its own key, capped in size, with a
  simple way for the user to export/view it) is enough. Full third-party
  analytics (CrazyGames docs mention ByteBrew as a free option for
  drop-off/user-journey tracking) is a separate decision for later, not part
  of this patch.
- Must not throw itself, must not impact performance in the hot loop, must
  not interfere with existing error handling elsewhere in the codebase.
- Verify: `node -c`, manually trigger a forced error in dev mode and confirm
  it's captured correctly with the right context fields.

### Patch 51 — Full crash-surface code review `[MODEL: OPUS]`
**Files:** whole repo, read-first, then targeted fixes

- **Depends on Patch 49's click-path trace and at least a few days of real
  Patch 50 telemetry data. Do not run this patch cold or immediately after
  49/50 — wait for actual data to exist, and say so if asked to proceed
  before there's data to work from.**
- With that data in hand, review load-path and gameplay-loop code for
  plausible crash sources: pooling/release mismatches (per the existing
  keep-clause — releases must always pair with `state.<array>` splices),
  mobile-specific input/canvas issues, anything that could throw under real
  device variance that's hard to reproduce locally.
- Cross-reference crash telemetry's device/browser data against the
  dashboard's mobile-heavy traffic split noted in `GAME_STATE.md`/prior
  session notes.
- Propose specific fixes as their own sub-patches once root causes are
  identified — this patch is diagnostic, not a blind fix-everything pass.

---

## PHASE 2 — Funnel redesign (do not start until Phase 1 is reviewed with the user)

### Patch 52 — Collapse title screen to New/Continue; move Hub behind a secondary button `[MODEL: OPUS]`

**Why Opus:** this touches the `gameState` machine (`TITLE`/`MENU`/`HUB`/
`PLAYING`) and `main.js`'s `initEngine()` wiring, which `CLAUDE.md` itself
flags as something to read top-to-bottom before touching. This needs full
codebase context, not a mechanical find/replace.

**Files:** `src/main.js`, `index.html`, `src/ui/UIManager.js`

**Intent (some exact wiring deliberately left open for Opus's own
investigation — do not assume, verify against the real code first):**

- Title screen's primary action should go straight into an actual run — no
  walkable Hub detour required first.
- On load, check for `localStorage['fractured_suspended_run']` (the mid-floor
  save from Patch 53 below — note dependency):
  - **Exists** → show two options: **CONTINUE** (resumes the exact saved
    floor/room) and **NEW DESCENT** (starts fresh; must NOT touch permanent
    meta-progression in `SaveManager.metaState` — Lucidity, tokens, Patient
    Level, Synapse Tree purchases are untouched by this choice either way).
    Confirm explicitly with the user before implementing anything destructive
    if starting fresh would discard the suspended run — a simple confirm
    dialog is likely enough, but check existing UI conventions first.
  - **Doesn't exist** → single **NEW DESCENT** action, straight to floor 1
    room 1.
- All folder-menu content (Synapse Tree, Loadout, Intrusive Thoughts,
  Descent Roadmap, Clinical Guide, etc.) and the literal walkable Hub/Mind
  Palace space move behind one secondary title-screen button (e.g. "MIND
  HUB"), reachable without forcing a returning or first-time player through
  it before they can play.
- Before implementing, explicitly re-verify how the walkable `HUB` gameState
  and the folder-tab menu (which is cosmetically also associated with "Mind
  Palace" via its trophies tab) currently relate in the actual code — this
  relationship is not fully clear from documentation alone and should not be
  assumed going in.
- Naming/wording of buttons should stay in the existing clinical-file voice
  established elsewhere in the UI (see `index.html`'s existing button copy
  for tone reference) — don't default to generic "New Game"/"Continue"
  wording without checking whether the existing language style should carry
  through.

**Verify:** `node -c`, `npm run build`, manual click-count audit from cold
load to first enemy on screen (should be dramatically shorter than Patch 49's
baseline trace), test both the save-exists and no-save-exists paths.

---

## PHASE 3 — Original backlog (independent of Phases 1–2, sequence flexible)

### Patch 53 — Fix resume dropping to room 1 `[MODEL: SONNET]`
**Bug (confirmed):** `Game.getCarriedState()` doesn't capture `roomNumber`;
`Game.init()` hardcodes `roomNumber: 1` regardless of `carriedState`.
**Files:** `src/core/Game.js`
- Add `roomNumber: this.state.roomNumber` to `getCarriedState()`'s return.
- Change `roomNumber: 1` to `roomNumber: carriedState ? carriedState.roomNumber : 1`
  in `init()`.
- Verify `Director.spawnRoom()`/enemy budget correctly initializes for the
  resumed room rather than relying on stale state from before the save.
**Verify:** `node -c`; manual test — clear to floor 2 room 2, Awaken, reload,
Resume, confirm room counter reads 2.
**Note:** Patch 52 (title screen Continue button) depends on this being
correct — do this one first if doing Phase 2 and Phase 3 together.

### Patch 54 — Auto-save on unclean exit `[MODEL: SONNET]`
**Files:** `src/main.js`
- `beforeunload` (or CrazyGames SDK lifecycle equivalent, if one exists —
  check docs) listener that performs the same carry-state-to-localStorage
  logic as the existing Awaken button, guarded to only fire during
  `PLAYING`/`PAUSED` states.
- Must not double-save or clobber a legitimate `EXIT_REACHED` (floor-complete)
  state.
**Verify:** manual test — close tab mid-room without pausing, reload, confirm
Resume appears and lands on the correct floor/room.

### Patch 55 — In-game room-choice mechanics explainer `[MODEL: SONNET]`
**Files:** `index.html` (`#tab-guide`)
- Add flashcard content explaining `ROOM_DOOR` reward types
  (`LUCIDITY`/`HEAL`/`WEAPON_UPGRADE`) and room modifiers
  (`ELITE`/`BLACKOUT`/`SWARM`/`HAZARD`) — documentation-first, not a new
  on-door visual overlay (that's an optional later follow-up, not in scope
  here).

### Patch 56 — Enemy/powerup glossary expansion `[MODEL: SONNET]`
**Files:** `index.html` (`#tab-guide`), possibly `src/ui/UIManager.js`
- Add entries for every enemy type/variant/boss, every boon, every token,
  every curse — sourced from the existing `SYNERGIES`/`TOKENS`/
  `INTRUSIVE_THOUGHTS` data objects so nothing can drift out of sync with
  real game data.
- Consider converting the guide tab to data-driven rendering (like
  `SynapseTree.js`'s approach) given the content volume, instead of more
  hardcoded HTML.
**Verify:** `node -c`, `npm run build`, spot-check entries against live data
values.

### Patch 57 — Powerup/upgrade history tracker (Roadmap-style) `[MODEL: OPUS]`
**Files:** `src/core/SaveManager.js`, new UI tab/panel reusing `.roadmap-*`
CSS, `src/ui/UIManager.js`
- Add `metaState.boonHistory` (or similar): per boon/upgrade id,
  `{ timesChosen, highestLevelReached }`.
- Record on pick (`LevelUpUI` selection path) and on `ROOM_DOOR`
  weapon-upgrade grants.
- Back-fill in **both** `loadGame()` and `importSave()` — two separate entry
  paths, both need the same coverage per existing save-schema keep-clauses.
- Render redacted-until-first-pick, same pattern as the existing
  `renderRoadmap()`'s boss redaction.
**Verify:** `node -c`, `npm run build`, `node test_synapse.js`, manual test
across a full run + save reload.

### Patch 58 — Enemy leash/wandering fix `[MODEL: SONNET]`
**Files:** `src/entities/Enemy.js`
- Tighten `applyMovement()`'s hard-teleport leash distance (currently
  1500px — consider ~900px).
- Add a softer "idle too long off-screen" correction that nudges an enemy's
  movement toward the player before the hard-teleport threshold triggers, so
  stragglers close distance naturally instead of only via a sudden snap.
**Verify:** `node -c`; manual playtest across a few rooms watching for
enemies going missing.

---

## Standing reminders (from `CLAUDE.md`/`GEMINI.md`, restated here for convenience)

- Never use `ctx.shadowBlur`.
- Never regenerate large files whole — small, independently applicable
  find/replace patches only, especially for `Renderer.js`, `index.html`,
  `style.css`.
- `spentLucidity` must never decrease.
- Any new `metaState` field needs back-fill in both `loadGame()` and
  `importSave()`.
- Don't reintroduce gore/blood visual effects without checking with the user.
- After every patch: `node -c` → grep validation → `git diff` review → stop
  and ask before continuing, per this document's own instructions above.
