# FRACTURED — Change Log (Patches 49–71, 80–83)

*Written 2026-08-04, extended 2026-08-05. Covers the CrazyGames Basic Launch
remediation work driven by `BASIC_LAUNCH_FIX_QUEUE.md` and then
`BASIC_LAUNCH_FIX_QUEUE_v2.md`, plus the follow-ups that came out of live play and
the mobile review. Picks up where `EXECUTION_HANDOFF.md` (patches 13–41) left off.*

**Read this before changing any of the systems below.** Like `EXECUTION_HANDOFF.md`,
this file exists because the reasoning behind these changes is not recoverable from
the diff alone — several are guards against failures that are invisible locally and
only appear on a player's device. The **Keep clauses** at the end are the parts most
likely to be broken by accident.

Session commits: `a4b954c` → `d5c179a` (5 commits) for patches 49–63. Patches 64–71
are the 2026-08-05 session and were uncommitted when this was written.

**A numbering warning.** `BASIC_LAUNCH_FIX_QUEUE_v2.md` is v1 plus two new items,
which it numbered **59** (tutorial directional cue) and **60** (mobile review) — but
49–58 had already shipped and 59–63 in this document were spent on post-phase work
from live play. So the queue's "Patch 59" is this document's **Patch 64**, and the
queue's "Patch 60" is the mobile review recorded under **Patch 66b** below. When a
queue item and a changelog patch number disagree, this file's numbers are the ones
in the source comments.

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

## ONBOARDING — the tutorial rebuild (2026-08-05)

Driven by `BASIC_LAUNCH_FIX_QUEUE_v2.md` and then by direct review of the tutorial as
an onboarding funnel. The framing question was not "is the tutorial correct" but "why
does the average session end at 1m36s", and the answer turned out to be mostly in
what the first sixty seconds fail to deliver.

### Patch 64 — Tutorial cue points at the enemy, not to the right

The instruction *"Eliminate the manifestation to proceed"* was drawn at a **fixed**
world position, `mapOriginX + 600` — always 600px to the right of the spawn point —
while `Director.spawnWave` places the single tutorial enemy at
`Math.random() * Math.PI * 2`. The only instruction in the game routinely pointed
away from the only enemy in the game.

New `Renderer.drawTutorialCue()`: an animated dashed runway and a chevron that track
the enemy's live position, plus an upright `ELIMINATE` label. Deliberately world-space
and deliberately not a screen-edge waypoint marker. It fades in over the band where
the enemy stops being comfortably on screen (derived from `viewHalfExtent`), and its
glyph sizes divide by the live zoom so it is a constant ~29 screen px on a 0.70-zoom
phone and a 1.3-zoom desktop alike.

The tutorial enemy also gets a pulsing highlight ring, inserted at the same
one-code-path spot as the Patch 24 variant tell.

### Patch 65 — The tutorial became a step machine

**New: `src/systems/Tutorial.js`.** The old tutorial delivered six instructions on
frame 1 across two competing surfaces — a DOM banner and world-space ground text —
every one hardcoded to WASD/mouse/SPACE, while an enemy was already walking in.

Now one instruction at a time, one surface, each advanced by the player
*demonstrating* the previous one, with a time fallback on every step. The module is a
stateless reducer over `game.state`, which is what makes it testable without a canvas.

Three findings drove the rest of the patch:

- **The core hook was a coin flip.** Level 1→2 costs 50 XP; the tutorial Scavenger
  dropped **2**. The two tutorial doors are LUCIDITY (+50 XP) and HEAL (+0), so
  whether a new player ever saw a boon card came down to which door they picked —
  and taking HEAL put the first card ~25 kills away, well past the average session.
  Half of all first sessions never reached "kill → level → choose", which *is* the
  genre's hook. The tutorial kill now drops 3 massive orbs (75 XP), so the card fires
  for everyone. Tutorial-only; the normal drop economy is untouched.
- **Mobile was told the wrong thing and shown nothing.** `isTouchDevice` only becomes
  true on the first canvas touch, and `#btn-dash` was `display:none` until then — so a
  phone's first frame had keyboard instructions and zero visible controls
  simultaneously. Added `InputManager.getInputMode()` (a `(pointer: coarse)` guess,
  corrected by the first real keypress) and `revealTouchControls()`, called from
  `enterPlayingState()`.
- **Arrow keys were never bound at all.** A desktop player who reached for them got a
  character that did not respond, on the first screen of the game.

**Also fixed here, and worth its own line: `Game.spawnDamageText` rendered "NaN" for
every non-numeric caller.** It did `Math.ceil(amount).toString()` unconditionally —
correct for damage numbers, garbage for the nine callers that pass text: `"VOID"`,
`"SUPPLIES RECOVERED!"`, `"TOKEN DROPPED!"`, `"WEAPON UPGRADED"`, and the
`"+50 LUCIDITY"` that pops when a first-time player takes their first reward door.

### Patch 66 — Pacing, the hold, and plainer words

- **Both controls are now taught in an empty room.** The spawn gate moved from the
  MOVE step to the DASH step, so the enemy does not exist until the player has moved
  *and* dashed. Combat is the first thing that can punish inattention.
- **The hold.** `tutorialFreeze` stops enemy AI while an instruction is pending — the
  enemy stands there, unaware, until the player does the thing being asked — via the
  same path as `devFreezeEntities`. Capped at 7s so it can never soft-lock, cleared on
  the kill, and re-checked against `isTutorial` in `Game` so a stale flag can never
  leave every enemy in a run inert. Contact damage rides on enemy `update()`, so the
  held enemy cannot hurt a player who is reading — that falls out of the freeze rather
  than needing its own rule.
- **`MIN_READ` (1s).** No step advances before its line has been on screen a full
  second. Without it a player already holding W never saw the MOVE line, and an
  instant dash blew past the DASH line in ~5 frames.
- **Copy rewritten for a twelve-year-old and a fifty-year-old** — short sentences,
  common words, no lore in a line whose job is teaching a button. The Lucidity lesson
  became its own `BANK` step rather than being crammed onto the level-up line.
- **The banner became a quiet note**, moved out of inline styles into `#tutorial-banner`
  in `style.css`: no border box, hairline rules, dimmed parchment instead of saturated
  gold, and a fade re-triggered on every text change.

### Patch 66b — Mobile experience review *(no code changes)*

The queue's Patch 60, run as a diagnostic. Findings, which became patches 67–71:
mobile conversion 26.98% vs desktop 48.95% on identical content, and the causes were
mechanical rather than design — a level-up modal with no mobile CSS at all, a canvas
upscaled with nearest-neighbour on every phone, a dash button sitting in the aim
thumb's landing zone, viewport maths hardcoded to the desktop zoom, and a portrait
layout nothing in the codebase acknowledged.

---

## MOBILE — the review's follow-ups (2026-08-05)

### Patch 67 — Level-up modal on phones, and canvas smoothing

**The level-up modal had no mobile rules whatsoever**, and Patch 65 had just made
every new player reach it inside the first minute. Three fixed 160x240 cards plus 40px
of padding measured ~914px tall on a 390px-wide phone (they wrap one per row) against
an 844px viewport, with no overflow rule — the first and last card were clipped off
screen with no way to scroll to them. Landscape clipped the same way at 375px tall.

Cards now stay on **one row at every size** (three side-by-side options is what makes
the choice read as a choice), sized `clamp(94px, 28vw, 152px)`. Two things that would
have bitten: `.banish-btn` hangs outside the card at `-15px` and would have been
clipped by the new scroll container, and `renderSurgeCard` sets an inline
`width: 300px` that only `max-width` outranks. `.card:hover`'s `scale(1.15)` is now
behind `@media (hover: hover)` — on touch it latched after a tap.

**`image-rendering: pixelated` removed from the canvas.** The backing store is sized
in CSS pixels, so on a DPR 2–3 phone the compositor upscales 2–3x, and `pixelated`
made that nearest-neighbour — the worst possible filter for radial faux-glows, 1–2px
strokes and canvas text, sitting beside a crisp DOM HUD. No effect on desktop.

### Patch 68 — Touch ergonomics, and two latched-state bugs

- **Dash button geometry.** The aim stick is a *floating* joystick: it materialises
  wherever the right thumb lands. Anything the button covers is dead space for aiming.
  At 80x80 with 40px offsets its centre sat ~80px in from each edge — exactly where a
  thumb rests to aim. Now 64px at 14px, with `max(14px, env(safe-area-inset-*))` so a
  notched phone in landscape pushes it clear of the rounded corner.
- **`touchcancel` was never bound on the dash button** (the canvas has had it since
  the joysticks were written). Any touch the *system* took away mid-press — call,
  notification shade, edge-swipe, backgrounding — left `isDashing` latched true for
  the rest of the session: continuous dashing, unfixable short of a reload.
- **`hideJoysticks()` released the visuals but not the input.** It is called on every
  menu open, which routinely happens *with a finger still down* (tapping PAUSE with
  one thumb while the other is on the stick). The slot kept its touch identifier, and
  `handleTouch` only adopts a new finger when the slot reads null — so if that
  finger's `touchend` never reached the canvas, the stick stayed claimed by a finger
  no longer on the glass, dead for the rest of the run. It now clears both slots and
  zeroes `moveX/moveY/isMoving/isDashing`.

### Patch 69 — The viewport maths stops assuming desktop

`viewHalfExtent` divided by a hardcoded `1.3`, justified as "assume the tightest
possible view". True on desktop, where the zoom really is 1.3. On a phone, where
`updateZoom` clamps to 0.70, it modelled a **150px half-extent where the player could
actually see 279px** — so every viewport-derived distance in the game was calibrated
for a screen nobody was looking at.

`main.js` now publishes `state.viewZoom` from the live camera each frame and Director
divides by that. `viewSafeRadius` was folded into the same derivation
(`viewHalfExtent * 0.65`) rather than keeping its own `min(w,h) * 0.25` formula — the
factor is chosen so **1920x1080 is unchanged to the pixel**, which `test_leash.js`
asserts.

Also: `resize()` bails when the dimensions have not changed (assigning `canvas.width`
reallocates the backing store and resets the 2D context *even for an identical value*,
and `drawLightingMasks` then reallocates the light canvas to match — two full-screen
buffers per spurious event, and mobile fires `resize` for things that change neither
dimension). Bursts are coalesced to one call per animation frame with rAF, not a
timeout: the canvas has no CSS size of its own, so any delay beyond a frame shows as
the game not filling the window.

### Patch 70 — The spawn ring must clear the corner of the view

`spawnEntity` used `max(canvasWidth, canvasHeight) * 0.5 + 50` — canvas **pixels** as
world units, against the larger canvas axis, with **no zoom term**.

| Viewport | Corner of view | Old ring | |
|---|---|---|---|
| Desktop 1920x1080 | 847 | 1010 | ok |
| Phone landscape 844x390 | 664 | 472 | **192px inside the view** |
| Phone portrait 390x844 | 664 | 472 | **192px inside the view** |
| Tall portrait 412x915 | 717 | 508 | **209px inside the view** |

It works on a 1080p desktop by coincidence, which is why it lasted. On every phone,
enemies **popped into existence in plain sight**, on every wave — which reads as the
game cheating. The radius is now `hypot(halfW, halfH) + 80` at the real zoom, with the
legacy value kept as a **floor** so desktop pacing is untouched.

### Patch 71 — Portrait is a supported layout

A 390x844 phone showed 557 x 1206 world units: a tall slot where horizontal threats
appear at 278 units and vertical ones at 603, with the player's own thumbs on the
bottom corners of the play area. Zoom alone cannot fix it — reaching the 900-unit
design width on a 390px screen needs zoom 0.43, at which the player is ~10 screen px.

So the bottom **26%** (clamped 140–300px, never >40%) is reserved as a control band,
the world renders into what is left, and the camera centre moves up to the middle of
the *world viewport* — the area under the thumbs becomes screen the world was never
using. The portrait zoom floor is 0.58 rather than 0.70, widening a 390px phone from
557 to 672 world units.

**The desktop path is unreachable from here, by construction.** The whole layout hangs
off one boolean, so `isPortraitLayout()` lives in its own pure module
(`src/core/Layout.js`) and is driven directly by `test_viewport.js`: touch pointer AND
taller than wide AND ≤820px, all three required. The touch term is what stops a mouse
user who drags their window tall and narrow from being given a phone layout with no
way out.

The band is a DOM element sized from `Renderer.controlBandH` — never from CSS, so the
band and the camera cannot disagree about where the world stops — and it is
`pointer-events: none`, which is load-bearing: the floating joysticks materialise
wherever a thumb lands, *including inside the band*, and they listen on the canvas.

`game.update()` now receives the **world viewport** rather than the canvas, so the
spawn ring and leash do not count the band as visible space. The vignette and the boss
banner follow the camera centre too.

**Correction to Patch 69 recorded here:** that patch fixed the *published*
`viewSafeRadius`, but the tutorial's actual spawn distance still had its own copy of
the old canvas-pixel formula. Both read the same value as of this patch — which was
the stated intent when `viewSafeRadius` was introduced in Patch 60.

---

## PLAYER FEEDBACK — audio and vocabulary (2026-08-09)

Two unrelated items shipped together because the second is strictly text.

### Patch 80 — Music and SFX volume

**Driver:** two separate players in two days via the CrazyGames feedback portal.
*"Noise effects are cool, but not good for my ears. Please don't play noise all the
time and make an optional setting."* and *"the music is very painful, this could
seriously cause someone damage, its giving me a headache."* The second asked to
**adjust**, not mute — so this is a slider, not a toggle.

**What the graph actually was.** One bus. Everything — the menu bed, the drone, the
flashlight hum, every buffered SFX, every procedural voice, footsteps, the heartbeat —
terminated at `masterGain`. `playProceduralSFX` appeared to have a routing split
(`targetGainNode` vs `this.masterGain`) but line 553 assigned `targetGainNode =
this.masterGain`, so both names were the same node. `gains.heartbeat` was built and
connected and then never used by anything; `gains.spinner` / `gains.static` are
declared `null` and never created at all. There was no music/SFX seam to hang a
control on, and `masterGain` could not become one: it is simultaneously the ducking
node (`triggerAudioDucking`), the fade node (`stop()`) and the mute node (`setMuted`).

**So two new buses sit BELOW masterGain**: `musicGain` (menuTheme, drone, flashlight
hum) and `sfxGain` (everything else). The hum is on the music side deliberately — it
is a continuous tone with no trigger, i.e. exactly the "noise all the time" the first
player described. Every stray `this.masterGain` inside `playProceduralSFX` now goes
through `targetGainNode`, which resolves to the SFX bus.

**Volume is NOT `setMuted`.** That is a reason-tracked binary owned by the portal
(`'ad'`, `'platform'`) which hard-sets `masterGain`, suspends the context, and
restores a captured pre-mute value. Folding a player float into it would mean an ad
ending stamps its restore value over the player's choice, and a player sliding music
to 0 clears an ad-mute that is still meant to be in force. Living on separate nodes
makes the two multiply instead of fight: *muted-during-ad AND music-at-30%* is a
representable state.

Other decisions worth their line:
- **Gain is `v²`, not `v`.** Loudness is roughly logarithmic; a linear slider gives
  almost no resolution at the quiet end, which is the end these players are trying to
  reach. Halfway is now −12dB.
- **Defaults are 1.0 — bit-identical to the pre-patch mix.** Opt-out, not opt-in. A
  settings blob written before this patch simply lacks the keys and the spread leaves
  the defaults standing.
- **Applied and persisted on `input`, not on APPLY & CLOSE** like the two toggles
  beside them. A player who is in pain needs the change while they are still dragging,
  and closing the tab from that screen must not restore full volume next session.
- **`applyAudioSettings()` runs before `preload()`**, so the buses are *created* at the
  player's level rather than opening every session at full volume for a few frames.
- The settings modal gained `max-height: 90vh` and a scrolling `folder-content`. Two
  more rows push it past a landscape phone's height and `.medical-folder` has no
  overflow rule of its own — the same shape as the Patch 67 level-up clipping.

`fractured_settings` is still **raw `localStorage`**, unlike the suspended-run storage
which goes through `portalSDK` (Patch 51a). Noted, not changed here: it is try/caught
in both directions so a `SecurityError` degrades to default settings rather than
killing boot, and migrating it is its own change.

### Patch 81 — "Grip" and "Sanity" were the same number

**Confirmed bug, display-only fix.** Internally the field is `sanity` everywhere. The
display split down the middle: `Manifestations.js` (TOKENS, TOKEN_SETS,
INTRUSIVE_THOUGHTS) said **Grip** — "Max Grip +40", "Your maximum Grip is halved" —
while `LevelUpUI.js`'s BOONS said **Sanity** — "Max Sanity increased by 50", "Lead
Shoes: Max Sanity +200". The Clinical Guide hedged as "THE GRIP (SANITY)". A player
reading a token and a boon in the same run had no way to know they were one stat.

Standardised on **Sanity**: already the internal field, the HUD label and the guide's
primary term. Only `name`/`desc`/`effect`/label strings and the guide copy changed —
no `effects: { sanity: N }` key, no `bonuses` key, and no token/boon/curse `id`, since
ids are referenced by `uid → id` in live inventories and renaming one orphans every
save that owns it.

Two judgement calls inside the sweep:
- **`ARMORED` became "Three times the health", not "Sanity".** That string describes an
  *enemy's* HP. Enemies have no sanity, so the mechanical rename would have been
  actively wrong there.
- **The token named "White-Knuckle Grip" keeps its name.** It grants kinetic damage and
  never touched the stat; with "Grip" gone as a stat name everywhere else, the word is
  just English again.

**The reward door, verified before rewriting.** `Combat.js`'s `ROOM_DOOR` HEAL branch
is `state.sanity = Math.min(state.player.maxHp, state.sanity + 50)` — it **restores**
lost Sanity and never raises the maximum. Unambiguous and consistent, so the text was
safe to fix without touching behaviour. A player had explicitly reported being unable
to tell which it was, so all three surfaces now say so: the door label reads
`HEAL +50 SANITY`, the pickup pops `+50 SANITY RESTORED`, and the guide entry reads
"Restores 50 Sanity you have already lost. Does NOT raise your maximum." RISK
PROTOCOL's cost is likewise stated as "30 **current** Sanity".

---

## METRICS — gameplay-state accounting (2026-08-09)

### Patch 82 — `LEVEL_UP` now counts as gameplay

> ## ⚠️ MEASUREMENT DISCONTINUITY — 2026-08-09
>
> **CrazyGames dashboard "gameplay conversion" and average-playtime figures from
> before this date are NOT directly comparable with figures from after it.** This
> patch changes what the game reports as gameplay, so a change in those numbers
> across this boundary is not by itself evidence of a change in player behaviour.
>
> Both metrics should move **up**, on every platform, with no gameplay change
> whatsoever — the conversion threshold is 60 seconds of reported gameplay, and this
> patch stops subtracting level-up card time from it. Mobile should move up **more
> than desktop**; see below for why.
>
> Any A/B reasoning that spans this date needs a fresh baseline taken after it.
> Compare *within* an era, never across the boundary.

**One line changed**, shipped alone and deliberately unbundled so the metric shift is
attributable to exactly one cause:

```js
const PORTAL_GAMEPLAY_STATES = new Set(['PLAYING']);            // before
const PORTAL_GAMEPLAY_STATES = new Set(['PLAYING', 'LEVEL_UP']); // after
```

**Why the Patch 44 exclusion was wrong here.** That decision was aimed at *menus* —
out-of-run management the player enters on purpose and can sit in indefinitely, which
is what the SDK docs call a gameplay break. A level-up card is the opposite of that:
an in-run decision, forced by the run, unreachable any other way, exited in one click.
It was swept up by a rule written for the Mind Palace.

**Why it plausibly distorted the mobile gap specifically.** Patch 65 made the tutorial
kill drop 75 XP precisely so that **every** new player reaches a level-up card inside
their first minute — that was the right fix for the hook, and it is why the card
reliably lands *inside* the platform's 60-second conversion window. The cards render
at `clamp(94px, 28vw, 152px)`, so a 390px phone spends longer reading the same three
options than a desktop does. The exclusion was therefore subtracting more time from
mobile than from desktop, on the one screen the game guarantees both of them see.

This does **not** claim the desktop/mobile conversion gap is only an artefact. It
claims some unknown part of it was, and that the part was not measurable while this
line stood. Establishing the real gap is the point of the change.

**What stays excluded, and the one honest asymmetry.** `PAUSED`, `DEAD`,
`EXIT_REACHED` and `HUB` are unchanged. The accepted edge case: a player who walks
away with the level-up card open is now counted as playing, where a player who walks
away on the pause menu is not. `PAUSED` is the player declaring they have stopped; a
level-up card is a run in progress. Accepted knowingly rather than overlooked.

**Verified before shipping** (`syncPortalGameplayState` is a frame observer, so the
risk is a missed or duplicated edge, not a wrong value):

- `PLAYING → LEVEL_UP → PLAYING` now emits **nothing at all** — no stop, no restart —
  including across many idle frames with the card open. That is the whole intent.
- Every exit from `LEVEL_UP` (`DEAD`, `PAUSED`, `EXIT_REACHED`, `HUB`) still emits
  exactly one `gameplayStop`, and leaves the observer able to re-emit `gameplayStart`.
- `showAdThen`'s `portalLastGameplay` handling is untouched. Its only caller runs at
  `gameState === 'DEAD'`, where the flag is already false and the guard is a no-op —
  before and after. Asserted anyway that if it ever fired mid-gameplay it stops once
  and does not wedge the observer.
- No `START`/`STOP` imbalance across a long mixed session.

Three structural facts confirmed while reading `main.js`, which is what makes the
above safe: the observer runs once per frame at the top of `gameLoop` rather than at
the ~15 assignment sites; `showAdThen` has exactly one caller; and `LEVEL_UP` can only
be entered from a `PLAYING` step, because `Game.update` early-returns for any state
that is not `PLAYING` or `HUB`, `HUB` has no leveling, and `onLevelUp` returns early
when `gameState === 'DEAD'`.

---

## ONBOARDING — mobile follow-ups (2026-08-09)

### Patch 83 — Settings reachable from the title screen

**Additive UI only.** No game logic, no metric accounting, nothing near Patch 82.

Patch 80 shipped audio volume in response to two player complaints in two days, one
reporting a headache — and then put it behind the pause menu (in-run) and the clinical
folder's EVALUATION tab (behind MIND HUB). **`playMenuTheme()` runs on the title
screen**, so the music that generated the complaints was playing on the one screen
with no way to adjust it. The player's only options were to start a run they did not
want, or to navigate into a clinical folder to escape the sound.

Third entry point, same panel. Built by **injection** next to its two siblings rather
than as static markup in `index.html`: all three are now constructed identically and
all three open the same `settingsUI` element. A fourth button written into the markup
would have needed its own listener wiring — a second way to open one panel, which is
how two copies drift apart later. It also lands before `new UIManager`, so
`attachEvents()`'s `querySelectorAll('.file-btn')` gives it hover/click SFX for free,
exactly like the other two.

Order is `(RESUME) → BEGIN DESCENT → MIND HUB → SYSTEM SETTINGS`. Patch 52 collapsed
this screen to one tap deliberately and that is not disturbed — the new entry is
styled to MIND HUB's secondary convention so it cannot compete with BEGIN DESCENT.

**One deliberate deviation from MIND HUB: `min-height: 44px`.** MIND HUB's inline
values compute to roughly 41px, just under the touch-target floor. `min-height` rather
than extra padding, so the two look identical on desktop where both already clear 44px.

**Deliberately NOT done — the "this is new" highlight.** Making it *one-time* needs
persisted state, and the correct home is `SaveManager.metaState` (per Keep clause 1,
raw `localStorage` throws in a blocked iframe), which per Keep clause 2 drags in
back-fill across `loadGame()`, `importSave()` and `wipeSave()`. That is a save-schema
change wearing a UI costume, and far more than this patch warrants. Flagged for a
decision rather than smuggled in.

**Known, pre-existing, made worse by ~58px:** `.fullscreen-menu` centres a flex column
with no overflow handling (the same gap Patch 73 documented for the title text). A
returning player with a *suspended run* renders RESUME DESCENT plus `#title-case-record`
plus `#title-suspended-note`, which by arithmetic already overflowed a 390px-tall
landscape phone before this patch. Because the column is centred, the overflow splits
top and bottom — the title clips above and the suspended-run note clips below, while
the buttons sit in the middle and survive. **These are estimates from CSS, not
measurements**, and per Keep clause 12 font-derived heights differ by machine
(`'Courier New'` is absent on most Linux systems). Not fixed here: a correct fix is not
`overflow-y: auto` alone — a centred flex container makes its top overflow unreachable
by scrolling — so it is its own patch.

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
5. **Leash thresholds derive from `state.viewHalfExtent`.** Never reintroduce
   fixed-pixel leash constants — they are wrong on every other viewport.
   *Superseded by Patch 69:* the divisor is now `state.viewZoom`, the camera's LIVE
   zoom, published from `main.js` each frame — not the hardcoded `1.3` this clause
   originally named. `1.3` is only ever correct on desktop; phones run at 0.70, so
   the old maths modelled a view half the real size. `viewSafeRadius` is now
   `viewHalfExtent * 0.65` for the same reason. Both are asserted unchanged at
   1920x1080 in `test_leash.js` — keep that assertion.
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
15. **`Game.spawnDamageText` must not coerce its text.** It rounds finite NUMBERS and
    passes everything else through. Reinstating a blanket `Math.ceil()` puts the
    literal string "NaN" on screen for nine player-facing callers.
16. **Every control-teaching tutorial step needs a `touch` variant in
    `TUTORIAL_COPY`.** A step with only `keyboard` copy silently tells a phone to
    press SPACE. Asserted in `test_tutorial.js`, along with a line-length ceiling —
    the copy is deliberately plain and short, and "improving" it is how that gets
    undone.
17. **Every tutorial step needs a working time fallback.** The gates are behavioural;
    a player who never presses the taught key must still reach combat, the kill and
    the exit. Asserted per step.
18. **`tutorialFreeze` is re-checked against `isTutorial` in `Game.processGameLogic`.**
    The tutorial can end on any frame, and a stale freeze leaves every enemy in the
    run inert. Never consume the flag on its own.
19. **Nothing derives a world distance from canvas pixels.** Spawn rings, leash
    thresholds and the tutorial spawn all go through `state.viewZoom` /
    `viewHalfExtent` / `viewSafeRadius`. Canvas pixels are only world units at zoom
    1.0, which is a zoom the game never uses. This is what broke on every phone in
    Patches 69–71, three separate times, in three separate formulas.
20. **`game.update()` receives the WORLD viewport, not `canvas.width/height`.** In
    portrait they differ by the control band, and counting the band as visible space
    puts spawns inside the view again.
21. **`isPortraitLayout()` in `src/core/Layout.js` is the ONLY gate for portrait
    behaviour**, and it must keep requiring a touch pointer. Everything portrait —
    the band, the raised camera, the lower zoom floor — hangs off that one boolean, so
    if it can return true on a desktop, a desktop player gets a phone layout with no
    setting to escape it. `test_viewport.js` asserts both directions, including that
    the desktop branch of `updateZoom` is bit-identical to the pre-Patch-71 formula.
22. **The three world transforms must share `cameraCenterX/Y`** — `drawGame` and both
    `lightCtx` passes. If they disagree, the darkness mask slides off the world.
23. **Player volume never goes through `setMuted()`, and `setMuted()` never writes
    `musicGain`/`sfxGain`.** They are different concepts on different nodes on
    purpose: `setMuted` is a reason-tracked binary owned by the portal that hard-sets
    `masterGain` and suspends the context, and it restores a *captured* value on
    release. Put a player float anywhere near it and an ad ending overwrites the
    player's choice, or a player muting the music clears a still-active ad-mute.
24. **Everything audible must connect to `musicGain` or `sfxGain`, never to
    `masterGain` directly.** A new sound wired straight to `masterGain` is silently
    exempt from the volume sliders — which is the accessibility bug this existed to
    fix. `playProceduralSFX`'s `targetGainNode` local is the SFX bus; use it for every
    sub-voice too, including the ones that used to name `this.masterGain`.
25. **The audio settings default to 1.0 and must stay opt-out.** Lowering the defaults
    changes the mix for every existing player who never opened the panel.
26. **The player-facing name of the `sanity` stat is "Sanity" everywhere.** It was
    split between "Grip" and "Sanity" across two data files for long enough that a
    player could not tell one number from two. When adding a token, boon, curse or
    door reward, the display string says Sanity — and never rename an `id`,
    `effects` key or `bonuses` key while editing that text, since saves reference
    ids by `uid → id`.
27. **`PORTAL_GAMEPLAY_STATES` changes are METRIC changes — ship them alone, dated.**
    Editing that Set silently redefines what the CrazyGames dashboard's conversion
    and playtime figures mean, and the discontinuity is invisible in the numbers
    themselves. Anything bundled alongside becomes permanently unattributable. Every
    change to it needs its own dated changelog banner (see Patch 82) so a future
    reader can tell a real behaviour change from an accounting one. `syncPortalGameplayState`
    is a frame OBSERVER — verify additions by walking every entry and exit edge of the
    new state, not just the happy path, and confirm `showAdThen`'s
    `portalLastGameplay` guard still leaves the observer authoritative.
28. **`#control-band` stays `pointer-events: none` and takes its height from
    `Renderer.controlBandH`.** The floating joysticks materialise inside it and listen
    on the canvas, so a band that swallowed touches would remove the controls exactly
    where they are meant to be used. A CSS-set height would let the band and the
    camera disagree about where the world stops.

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
- **On touch you cannot dash while aiming.** One thumb cannot hold the aim stick and
  reach the dash button. Patch 68 fixed *accidental* dashing (the button no longer
  sits in the thumb's landing zone) but not this. The real fix is a gesture —
  double-tap the movement side to dash in the direction already being pushed, putting
  dash on the hand that is not doing precision work. Not built; it adds an input mode
  and needs a design call.
- **Fog is 30 live `createRadialGradient` + `arc` + `fill` per frame**
  (`generateFogClouds` / `drawFog`), with no scaling by device class — the largest
  single per-frame cost, on top of ~40 other gradient sites. `drawGlow` already proves
  the cached-sprite pattern works here. Identified in the Patch 66b review; not
  green-lit.
- **The canvas renders at CSS-pixel resolution, ignoring DPR.** Deliberate — it is a
  large performance saving on phones — but it means the image is upscaled by the
  compositor. Patch 67 made that upscale smooth; it did not make it sharp. If this is
  ever revisited, `image-rendering` should be reconsidered in the same change.
- **Portrait is playable, not equal.** Even with the Patch 71 band and the 0.58 zoom
  floor, a phone held upright gets roughly half the desktop's horizontal warning
  distance. Enemies spawn just off screen and the leash adapts, so it is fair, but the
  reaction time is genuinely shorter than in landscape.

---

## Test inventory

| File | Count | Covers |
|---|---|---|
| `test_bosses.js` | 34 | boss dispatch, `activeBoss` on spawn frame, entity `.phase` pooling, predator feeding cap, **spawn ring clears the view on 5 viewports + desktop ring unchanged** |
| `test_content.js` | 180 | synergy/token/set/curse data, XP curve, audio asset paths, boon pool, `PLAYER_WEAPON_IDS` vs real loadout, cone falloff curves + light-recoil coverage |
| `test_synapse.js` | 255 | Synapse Tree costs, gates, resolver |
| `test_leash.js` | 15 | off-screen dead zone, recall lands on screen, boss exclusion, tutorial cases, **desktop viewport derivation unchanged by the live-zoom refactor** |
| `test_tutorial.js` | 51 | **new** — step gates and overrides, every step's timeout, the instruction hold and its cap, device-appropriate copy, copy length ceiling, degenerate state |
| `test_viewport.js` | 42 | **new** — the desktop/portrait split in both directions, desktop `updateZoom` bit-identical to pre-Patch-71, band and camera geometry, zero-sized canvas |

`test_director.js` and `test_save.js` remain exploratory (they print, they don't
assert). All six assertion suites exit non-zero on failure and should be run after
touching entities, save schema, content data, the tutorial, or anything that reads
viewport dimensions.

`test_tutorial.js` and `test_viewport.js` are both driven against the real modules
without a canvas — `Tutorial` is a pure reducer over state, and `updateZoom` is called
through `Renderer.prototype` on a stub. Keep them that way; the moment either needs a
live canvas it stops being runnable and stops being run.
