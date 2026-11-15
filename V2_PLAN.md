# FRACTURED v2 — CrazyGames resubmission plan

## Context

v1 was **rejected** after CrazyGames Basic Launch. Day-1 metrics, both in the bottom 20%:
- **Average playtime: 1m36s.** The benchmark is 10+ minutes.
- **Gameplay conversion: 31.89%.** This is the share of players who play at least 60 seconds. Mobile was 26.98% and desktop 48.95%.

Patches 49–91 fixed the funnel mechanics: one click to play, the tutorial, mobile layout. The tree has since been retargeted to **itch.io**, which removed the SDK tag and added "saved in this browser only" notices.

**Decisions you made:**
- Full CrazyGames SDK v3 with ads and cloud saves.
- Big scope: new content and a story layer, with all art still procedural.
- Desktop and mobile treated as equals.

The analysis below combines five reviews: gamer, UI/UX, story designer, mobile, and QA/performance. All 10 test scripts pass today (assertion suites plus a 200-run fuzz).

**Diagnosis.** The core combat is solid. v2 has to fix four things:
1. **Too little hooks a player in the first 60 seconds.** Weapon cards are generic ("Upgrade this weapon.") and synergies stay hidden until both weapons reach level 5.
2. **Nothing makes a player try again.** Death leads to an ad, then the walkable hub, then a walk to the machine, then a folder, then AUTHORIZE: 4–5 actions. There is no Play Again.
3. **Too little variety and almost no story.** There are 3 enemy types, one arena shape, no characters, and no ending: one line follows the Architect.
4. **Late-game performance and memory are risky** on the low-end phones that CrazyGames traffic leans toward.

## Success targets (what v2 is judged on)

| Metric | v1 | v2 target |
|---|---|---|
| Conversion (≥60 s) | 31.9% | **≥ 70%**, with mobile within 10 points of desktop |
| Average playtime | 1m36s | **≥ 8 min** |
| Gameplay crash rate | 0.75% | < 0.3% |
| Initial download | about 3.9 MB | < 2.5 MB |
| Frame rate | — | Steady 60 fps on a mid-range Android with 4× CPU throttle in a full boss fight |

## Ground rules (carried over from CLAUDE.md and CHANGELOG)

- Number new patches from **102**. Make each patch a small exact-block replacement.
- After each patch: run `node -c`, run the relevant `test_*.js` suites, then stop so it can be checked in `npm run dev`.
- Never regenerate `Renderer.js`, `index.html` or `style.css` wholesale.
- Respect the Keep clauses, especially:
  - 1–2: storage and save schema. Every new `metaState` field gets a back-fill in `loadGame()`, `importSave()` and `wipeSave()`.
  - 27: a change to `PORTAL_GAMEPLAY_STATES` ships alone, with a date.
  - 29–35: floors 1–5 must stay identical under `Endless.js`.
- No gore. The PEGI-12 decision stands.
- Mental-health framing: bosses are defense mechanisms and fears, never "the mentally ill as monsters". The arc of the story is recovery.
- New player-facing text goes in a new `src/data/Strings.js`, so localization can be added later without touching code again.

---

## Phase A — Submission blockers and CrazyGames retarget (P0)

**A1. Build target switch.**
- Add `VITE_TARGET=crazygames|itch`, read through `import.meta.env`. The CrazyGames build injects the SDK v3 `<script>` tag. The hook and comment are already at `index.html:12-29`.
- Gate `showStorageNoticeIfNeeded` and `maybeShowBackupPrompt` (`main.js:974`) on `!portalSDK.available`.

**A2. Remove every native browser dialog.**
- Native calls to replace:
  - `UIManager.js`: `prompt`, `alert` and `confirm` at :348, :352, :355, :363, :437–451.
  - `main.js`: the `alert` fallback at :532.
- Replace them with the existing `#confirm-modal`, extended with a text-input variant.

**A3. Ads, through the existing `PortalSDK.requestAd`.**
- **Rewarded ads:**
  - Revive once per run at 50% Sanity, offered on the death screen.
  - Double the Lucidity kept on death.
  - Free reroll on level-up.
- **Midgame ads:** only at natural breaks:
  - after death;
  - after AWAKEN;
  - between floors on DESCEND, never more than once every 3 minutes.
- **`happytime()`:** on a boss kill, a new deepest floor, and a first synergy.

**A4. Tab hidden or focus lost.**
- On `visibilitychange` or blur: auto-pause if PLAYING, and suspend the AudioContext. Resume audio on return; gameplay waits for the player to unpause.
- Wire this next to the existing autosave at `main.js:1843`.

**A5. Keyboard hygiene inside the iframe.**
- Call `preventDefault` on Space, the arrow keys and Tab while gameState is PLAYING. `Input.js:44-53` currently leaves these alone on purpose, for scrolling menus.
- `blur()` buttons after they are clicked. This fixes Space re-triggering a focused ⏸ PAUSE button.

**A6. Settings and ErrorLog through cloud save.**
- Move them onto `portalSDK` storage, with `localStorage` as the fallback.

**A7. Cleanup.**
- Delete `src/counter.js`, `src/javascript.svg`, `public/vite.svg` and the unused `public/sounds/heartbeat.mp3`.
- Add a real favicon, `theme-color`, `og:image` and `viewport-fit=cover`. The last one makes iOS safe-area insets work.
- Pin Vite to a stable release; it is currently `^8.0.0-beta.13`.

**A8. Economy and copy bugs.**
- Fix the Lucidity double-bank on suspend → resume.
- Fix the token-door text: it says tokens are kept only if you survive, but `onDeath` keeps them anyway.
- Fix AWAKEN mid-floor showing "Earned 0 (Aborted)" even though Lucidity is banked (`main.js:1897` vs `:1953`).

## Phase B — Stability and performance (QA P0/P1)

**B1. Global live-entity cap, boss fights included.**
- Today the cap only applies in endless mode with no boss (`Director.js:334`).
- Cap at about 60 on desktop and less on the low tier. Throttle the Amalgamation's minion spawns against the same cap.

**B2. Stop the per-entity scans of the whole list.**
- `Scavenger.js:28,45`, `Predator.js:26,60`, `Parasite.js:61`, `Enemy.js:268` and `Combat.js:393` each loop over every entity.
- Add a simple uniform spatial grid, rebuilt once per sim step in `Game.processGameLogic`, for entity, orb and puddle queries.

**B3. Fix the `drawGlow` cache leak.**
- `Renderer.js:240`: quantize alpha into about 16 steps. The tutorial cue at :1813 currently creates a new 64 KB canvas almost every frame.
- Put an LRU size bound on `spriteCache`.

**B4. Cap the leftovers.**
- XP orbs: merge orbs once there are more than about 150.
- Cap ink puddles.
- Cull everything off-screen in the Renderer (orbs at :2132, puddles, particles).
- Make `spawnParticles` respect a per-tier cap.

**B5. Make renderer errors recoverable.**
- `Renderer.js:1033`: record the `save()` depth and unwind it in `finally`.
- Reset `globalCompositeOperation` and `globalAlpha` there too.
- Throttle the `console.error`.

**B6. High-refresh screens.**
- Move all render-side timers and state onto sim ticks. That covers the walk detection at :3733, afterimages at :3711, fog drift at :1137, and the boss intro countdown at :1023.
- The boss intro countdown is a real bug: at 144 Hz the banner ends while the game is still frozen.
- Skip redrawing when no sim step ran.

**B7. Quality tiers, picked automatically from frame time with a manual override in Settings.**
- Cache fog clouds as sprites, the `drawGlow` pattern. Fog is the largest single per-frame cost: 30 gradients.
- Cap render resolution at about 1.5 MP.
- Optional DPR up to 1.5–2 on the high tier.
- Lower the particle cap on the low tier.

**B8. Pool hygiene.**
- Release pooled arrays on room transitions (`Combat.js:280-286`) and in `Game.init`.
- Add a double-release guard to `ObjectPool.release`.

**B9. Hot-path allocations.**
- Reuse `BOSS_TYPES` (`Director.js:24`) instead of building new arrays per entity per step.
- HUD DOM writes only when a value changes. `#score` innerHTML is rewritten every frame (`main.js:2361`).
- Cache the noise buffers in `AudioEngine.js` (:494, :699, :784).
- Add a global SFX voice cap.

**B10. Audio size.**
- Re-encode `game_drone.mp3` (4.5 MB) and `menu_theme.mp3` (2.0 MB) to about 96 kbps mono loops.
- Start the in-run music streaming after the first frame of gameplay.

**B11. Remote error sink.**
- Send `ErrorLog` entries in batches to a small endpoint, with no personal data.
- **Needs your choice of endpoint.** If none is chosen, it stays local-only.

## Phase C — The first session (conversion and playtime)

**C1. A first minute that hooks.**
- First level-up within about 20 s: tune the tutorial room's XP.
- A second weapon offered by the second level-up.
- Show the first synergy preview, a "🔗 pairs with Flashlight" tag, on that card.

**C2. Level-up cards that explain themselves (`LevelUpUI.js:177-186`).**
- Use display names from `MANIFESTATIONS` and say exactly what changes, e.g. "Damage 15 → 20, cone +10%".
- Add NEW, EVOLUTION READY and SYNERGY badges.
- Keys 1/2/3 to pick on desktop.
- Make the banish button at least 44 px.
- Replace the alchemical emoji (🜂🜃🜁🜄🝊), which show as blank boxes on Windows and Android, with inline SVG icons.

**C3. Synergy discovery.**
- When a synergy activates: a banner, a short slow-motion beat, and `happytime`.
- Fix the Guide's "at sufficient level" text to say level 5, and show display names instead of raw ids.
- Add a Synergy Codex in which undiscovered synergies show as silhouettes.

**C4. Death screen redesign: PLAY AGAIN first.**
- Show what killed you, the floor and room reached, time survived, kills, Lucidity kept, and any new unlocks.
- Primary button: **PLAY AGAIN**, which goes ad → `startNewRun` directly.
- Secondary: REVIVE (rewarded ad), DOUBLE LUCIDITY (rewarded ad), and RETURN TO HUB.

**C5. Shorter session units.**
- Floors go from 10 rooms to **5** (`Game.js:137`, decided 2026-11-15): about 3 minutes a floor, and about 15–18 minutes for a full clear.
- `test_endless.js` and `test_fuzz_runs.js` need to keep passing. Update the cadence assertions that are tied to room count.
- **Needs approval:** this is a balance change that affects every existing player.

**C6. Hub friction.**
- Collapse the 8 tabs into 4: DESCEND, SYNAPSES, LOADOUT, RECORDS.
- Give the hub a DESCEND hotkey and button, so a player can start a run without walking to the machine.

**C7. HUD readability.**
- Move `#crt-scanlines` below `#ui-layer` or exclude it from the HUD; it sits at z-index 100 with opacity 0.8, across all HUD text.
- Minimum 11 px text on mobile (HUD and card descriptions are about 9 px now).
- Add a shape or text cue for the Sanity state, not colour alone.

**C8. Juice.**
- Level-up: a short time-dilation, a radial flash (skipped in photosensitivity mode), and a card deal-in animation.
- Chest open: anticipation, then a burst.
- Boss death: slow-motion and a fragment burst.

## Phase D — Content (gamer view)

**D1. Playable "Patients" (characters).** These fulfil the stubbed C2 starting-weapon capstone (`Game.js:252`).
- Four to start, each with a starting weapon, a passive, and a stat lean:
  - **The Insomniac:** Flashlight, sees in Blackout.
  - **The Vandal:** Pipe, with lifesteal on melee hits.
  - **The Artist:** Ink, whose puddles slow enemies.
  - **The Photographer:** Polaroid, with crits on stunned enemies.
- Unlock them through story milestones.
- Add a character-select strip to the run-launch path; the default stays one click.

**D2. Weapon evolutions.**
- A weapon at level 5 plus a specific boon gives an evolved weapon in a chest. This is separate from the existing 10 two-weapon synergies.
- 8 evolutions, one per weapon.

**D3. Four new weapons**, filling the tag gaps:
- a ricocheting thrown **Pill Bottle** (kinetic);
- a pulse-ring **Metronome** (aura/tech);
- a rotating-shield **Straitjacket Straps** (orbit/melee);
- a slow homing **Lullaby** (dark/burst).

**D4. New enemies and elites.**
- Three new enemy types, introduced one per floor across floors 2–4: a splitting, a shielding and a burrowing archetype.
- **Elites with name tags** that drop chests. Use the dormant `BREAKER_BOX` and `OBJECTIVE_BACKPACK` interactables in `Combat.js:110,160` for chests and room events.

**D5. Room variety.**
- Per-floor arena shapes: corridors, ring, pillars, the collapsing Architect grid.
- Room events: Power Outage, Lockdown (survive 30 s), and Session Bell (an elite wave).
- Spawn layouts are data-driven through `Director.spawnRoom`.

**D6. Panopticon telegraph design call.**
- The tell is about 0.0025 rad wide; the hitbox is ±0.5 rad with no range limit.
- Recommendation: widen the tell to match the hitbox and give the hitbox a range limit.

**D7. Reasons to return.**
- **Daily Session:** a seeded run with a fixed character and curse, one attempt scored per day, best score kept locally.
- About 30 achievements: the trophy system exists but has only one entry.
- Unlock tracks for weapons and characters.
- A Recursion best-depth record.

## Phase E — Story layer (story designer view)

**Premise.**
- The player is **Subject 0**, inside an evaluation engine built from a memory they won't face.
- Each floor is a **defense mechanism**:

| Floor | Boss | Defense mechanism | What it is in the story |
|---|---|---|---|
| 1 | Sphere Head | Denial | the faceless authority |
| 2 | Rorschach | Projection | |
| 3 | Panopticon | Hypervigilance | |
| 4 | Amalgamation | Repression | everything swallowed |
| 5 | Architect | Control | the one who built the walls: the Subject themself |

- The school and institution enemies (Janitor, Hall Monitor, Substitute) become the memory's setting, made explicit.

**E1. Cold open.** 3 skippable text cards in the medical-file style, shown before the first tutorial. They must not add a click before gameplay: the cards play over the tutorial room while it loads, and the first input dismisses them.

**E2. Session Notes between floors.**
- A one-paragraph clinician's note on DESCEND and AWAKEN, a different note per floor.
- Plus a reaction to how the player is doing: low Sanity, fast clear, deaths.

**E3. Case File fragments.**
- About 25 collectible memory pages, dropped by elites, chests and bosses.
- Read them in a new RECORDS → Case File tab.
- Collecting them unlocks Patients (D1) and the true ending.

**E4. Boss intros and outros.**
- Two lines of dialogue on top of the existing boss banner (`Renderer.js:3603`) and one line at the boss's death. All of it is skippable text.

**E5. Endings.**
- First Architect kill: an ending sequence with credits. The choice is **AWAKEN**, which ends the story, or **RECURSE**, which reframes THE RECURSION as relapse loops.
- A "true" ending needs all Case File pages.

**E6. Tone guardrails.**
- A content note on the first launch.
- No depiction of self-harm.
- The arc moves toward recovery, not toward madness as spectacle.

## Phase F — Mobile and accessibility

**F1. Auto-aim.**
- On by default on touch, a toggle on desktop: aim at the nearest enemy, with the right stick as a manual override.
- This frees the right thumb and fixes "can't dash while aiming".

**F2. Dash gesture.** Double-tap the movement side to dash in the current direction. This is the fix the CHANGELOG known-issues list asks for.

**F3. Default from the OS.** Photosensitivity and shake follow `prefers-reduced-motion` by default. Tame the title glitch (`style.css:833`).

**F4. Colourblind palette option** for Sanity, telegraphs and XP, plus a text-size option.

**F5. iframe sizes.**
- Measure and fix layouts at 960×540, 800×600, 1280×720, and phones in landscape and portrait.
- This includes the title-column overflow at short heights (a Patch 83 known issue).

**F6. Haptics.** Use haptics consistently: hits taken, level-up and boss telegraphs. Respect a toggle.

## Phase G — QA harness and release

**G1. Dev-only hook.** Add `window.__game` behind `import.meta.env.DEV` to expose state counts: entities, orbs, `spriteCache.size`, pools.

**G2. New `test_smoke.mjs` (Playwright).**
- Playwright is preinstalled. Run it against `vite build && vite preview`.
- Steps:
  - Cold load, then BEGIN DESCENT.
  - Play through the tutorial with simulated input.
  - Spawn all 5 bosses from the dev panel.
  - Soak for 3 minutes with a 4× CPU throttle and a phone viewport.
- Assert:
  - p95 frame time under 20 ms;
  - heap growth under 30 MB;
  - `spriteCache` stays bounded;
  - entities ≤ the cap;
  - no `FRACTURED_ERRORS` entries.
- Screenshots at each iframe size.

**G3. Extend the existing suites.**
- `test_content.js`: new weapons, evolutions, characters, and Strings keys present.
- `test_endless.js`: floors 1–5 identity with the new room count.
- New `test_story.js`: unlock gates and Case File drop bookkeeping.

**G4. Manual QA checklist** (new `QA_CHECKLIST.md`), run against the CrazyGames developer-portal preview:
- the SDK events firing;
- each ad placement, with audio muted during the ad;
- cloud save carried across devices;
- iOS Safari, Android Chrome, desktop Chrome, Firefox and Safari;
- an offline/adblock fallback, where `requestAd` fails gracefully.

**G5. Release notes.**
- Extend `CHANGELOG.md` with patches 102+ and new Keep clauses.
- Update `CLAUDE.md`'s test table.

## Proposed order and gates

1. **Phase A + B** first, about 20 patches. Ship this as a candidate build and confirm it is stable in the preview.
2. **Phase C**, about 10 patches. This alone should move both metrics, and it could be a soft resubmission point.
3. **Phases D + E** together, about 30 patches, because story unlocks drive characters and Case Files drive drops.
4. **Phase F + G** last. G2 (the smoke harness) is started during Phase B so it guards everything after it.

## Critical files

- `src/main.js`: state flow, death screen, ads wiring, visibility handling.
- `src/systems/PortalSDK.js`: ads and happytime.
- `src/systems/Director.js`: cap, grid, spawn layouts, events.
- `src/systems/Combat.js`: chests, pools, evolutions.
- `src/core/Renderer.js`: glow cache, catch recovery, tiers, fog, culling.
- `src/ui/LevelUpUI.js`: cards.
- `src/ui/UIManager.js`: dialogs, hub tabs, Case File.
- `src/data/Manifestations.js`: weapons, evolutions, characters.
- `src/core/SaveManager.js`: new fields with back-fill.
- `src/core/Input.js`: auto-aim, dash gesture, preventDefault.
- `index.html` and `src/style.css`: in small patches only.
- New files: `src/data/Strings.js`, `src/data/Story.js`, `test_smoke.mjs`, `test_story.js`, `QA_CHECKLIST.md`.

## Verification (every phase)

- `node -c` on each edited file.
- All 7 assertion suites plus `test_fuzz_runs.js`.
- `test_smoke.mjs` once G2 exists.
- A manual pass in `npm run dev` with the VISUAL TEST BENCH (dev panel on `0`).
- At the end of each phase, a `vite build` and checking `dist` size against the 2.5 MB target.
- Before resubmitting: run the whole G4 checklist in the CrazyGames preview.

## Decisions (confirmed 2026-11-15)

- **C5:** floors go from 10 rooms to **5**, not 6.
- **B11:** use only what CrazyGames already provides. There is no error-reporting API in the SDK docs, and the dashboard computes crash rates itself. So: no third-party sink. Instead, attach a compact diagnostic to `SDK.game.setGameContext(...)`, which feeds the player-feedback reports: build id, floor and room, error count, and the last error's signature. Check that signature against the live docs before writing the patch.
- **D6:** widen the Panopticon's tell to match its ±0.5 rad hitbox, and give the hitbox a range limit.
- **A3:** midgame ads at most **once every 5 minutes**, enforced by us. The SDK's own floor is 3 minutes.

## Findings from the CrazyGames docs that change Phase A

Source: docs.crazygames.com `sdk/video-ads`, `sdk/game`, `sdk/data`, `requirements/ads|quality|technical|gameplay`.

**Rewarded ads**
- A rewarded button must **not appear on an active gameplay screen**, so the level-up "free reroll" ad is **dropped**. Revive and double-Lucidity both live on the death screen.
- Grant the reward only in `adFinished`, never on `adError`.
- No chaining: offer one rewarded ad per death.
- Never a midgame ad **and** a "watch to keep playing" offer between the same two levels. If the player revives, that death gets no midgame ad.
- Basic Launch disables ads (`adsDisabled`). Rewarded buttons must disappear cleanly, not appear broken.

**`happytime()`**
- Sparingly, for achievements: a boss kill and a new deepest floor. Not for completing a level, and not for synergies.

**Escape key and focus**
- **Restricted keys:** avoid Escape, which exits fullscreen. Add **P** as the primary pause key and keep Escape as a secondary binding.
- **Focus changes:** "Don't call [gameplayStop] when the user switches focus (we handle this)." So A4 suspends audio on tab hide everywhere, but auto-pauses only when no portal is present. On the portal, focus is CrazyGames' job.

**Platform mute and saves**
- `settings.muteAudio` takes priority over in-game volume. That is already done.
- The data module is the save of record. It covers guests (a localStorage mirror that transfers to the account on login) and is limited to 1 MB with a 1 s debounce. The submission form must tick **"Progress Save"**, or the module is disabled.

**Download size**
- Initial download must be ≤ 20 MB for the mobile homepage. We are well under.
