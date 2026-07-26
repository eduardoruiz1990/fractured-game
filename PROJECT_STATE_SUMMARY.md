# FRACTURED — Project State Summary

*Written 2026-07-26, for use as Claude Project knowledge. Describes what the
game IS right now, not the process that built it — for the patch-by-patch
history, Keep clauses, and design decisions behind current behavior, see
`EXECUTION_HANDOFF.md` in the repo. For architecture ground-truth and coding
conventions, see `CLAUDE.md` in the repo (both are more detailed than this file
and should be treated as authoritative if anything here goes stale).*

## What this is

**FRACTURED** is a browser-based survivors-like roguelite with a psychiatric/
clinical horror theme: Sanity stands in for HP, Lucidity is the meta-currency,
"Patient Level" is prestige, and equippable gear is "Tokens." Built in vanilla
JavaScript (ES6 modules), HTML5 Canvas 2D, the Web Audio API, and Vite — no
framework, no TypeScript, no bundler config beyond Vite defaults.

```
npm run dev       # Vite dev server
npm run build     # production build to dist/
npm run preview   # preview the production build
```

Not a git repository. No test framework installed — `test_bosses.js`,
`test_content.js`, and `test_synapse.js` at the repo root are standalone
assertion-based Node scripts (mock `document`/`window`/`localStorage`) that
exit non-zero on failure. Currently: **22/22, 157/157, 255/255 passing.**

## Development status

**A large, fully-specified 41-patch execution queue (`EXECUTION_HANDOFF.md`)
has just been completed in full.** Every patch from 13 through 41 is done.
There is no queued work — anything from here is a fresh, separately-scoped
request. The game went through, in order: instrumentation/telemetry → run
variety (boons, synergies, room modifiers, enemy variants) → progression
clarity (end-of-run summary, in-game guide, tutorial) → mechanical feel
(knockback, hit-reaction, i-frames, per-weapon impact weight) → a full Synapse
Tree meta-progression rebuild → token/curse system expansion and a loadout UX
redesign → and finally a complete visual overhaul (per-floor biome art,
lighting/atmosphere, menu polish, HUD redesign, VFX, boss telegraph clarity,
and a final consistency/perf pass).

## Architecture (condensed — see CLAUDE.md for full detail)

- `src/main.js` owns the single `requestAnimationFrame` loop and a plain
  string `gameState` (`TITLE`, `MENU`, `HUB`, `PLAYING`, `LEVEL_UP`, `PAUSED`,
  `EXIT_REACHED`, `DEAD`). Nearly all cross-system wiring — death, level-up,
  floor-complete, descend, dev overrides, and **all live HUD state updates**
  — lives inline in `initEngine()`.
- `Game.state` is one large mutable object (player, entities, projectiles,
  particles, floor/room progress, sanity, void status). No Redux-style
  pattern; systems mutate it directly.
- `Director.js` owns per-type `ObjectPool`s (scavenger/predator/parasite,
  each boss, particles, damage text, etc.) — spawning is `pool.get()` +
  `init()`; despawning is release-and-splice.
- `Combat.js` resolves projectile/interactable collision and weapon effects;
  `SaveManager.js` owns all persistent meta-progression (localStorage key
  `fractured_meta`) and self-saves on every mutator.
- `Renderer.js` (~3,490 lines) is the **only** file touching the canvas 2D
  context for gameplay. `UIManager.js` + inline handlers in `main.js` are the
  only code touching menu DOM. These two layers never cross.
- `src/entities/Player.js`, `EcosystemAI.js`, `ParticleGen.js`, `HudUI.js`,
  `MenuUI.js` are still empty 0-byte stubs, wired to nothing.
  `SynapseTree.js` is **no longer** an empty stub (built in Patch 29.6).

## Current feature set

**Combat/run loop:** 8 weapons, run-variety room modifiers (elite/blackout/
swarm/hazard), 3 enemy types each with armored/fast/volatile variants, 5
floors × 10 rooms, weapon-upgrade/token/risk-reward room doors beyond the
original Lucidity/Heal doors, enemy knockback, player i-frames with a visible
tell, per-weapon hit-stop/camera-shake weighting, and a boon pool grown from
9 to ~24 across 12 weapon tags with ~10 synergies.

**Meta-progression:** a 4-branch **Synapse Tree** (Resilience/Focus/Motor/
Fortune + cross-branch capstones, 31 nodes, 84,900 total Lucidity, DOM-rendered
tree UI with purchased/available/unaffordable/locked states) replaced the old
4 flat upgrade rows. Legacy upgrade levels are preserved via a one-time
`legacyUpgrades` snapshot; a resolver (`getResolvedUpgrades()`) sums legacy +
tree contributions into a derived-mirror `metaState.upgrades` so old readers
stay correct.

**Tokens:** 16 tokens (4 sets × 4 pieces, up from an original 4), a 5th
`prescription` equip slot (`TOKEN_SLOT_TYPES` is the single source of truth),
5 rarity tiers with a real forge-upgrade cost/multiplier curve, and a redesigned
Loadout tab: drag-and-drop with a click fallback, hover tooltips showing
rarity-scaled effects, an equipped-vs-hovered stat diff, inline forge buttons
on inventory cards, rarity sort/filter, and 2pc/4pc set-progress display.

**Curses ("Intrusive Thoughts"):** grew from 4 to 7, now a stacking risk ladder
with a visible cumulative Lucidity multiplier, gated on Patient Level 5 + one
boss kill (server-side enforced in `SaveManager`, not just UI-side).

**Visuals:** all 5 floors now have distinct structural biome identity (not
just palette) — institutional rust/cracks, mirrored Rorschach inkblots,
Panopticon watch-rings/tally marks, Amalgamation organic veins, Architect
blueprint linework — plus matching per-floor darkness/fog tint and a
soft-edged flashlight penumbra. The hub has worn traffic paths derived from
its interactable zones. The DOM menu layer got paper-fibre texture, tab
physicality, the project's first `:focus-visible`/`:active` states, and
`prefers-reduced-motion` support. The in-game HUD was restyled as bedside-
monitor instrument chrome (bezels, scanlines, gauge ticks) with safe-area
insets. Particles went from flat 2px lines to speed-proportional streaks with
cached faux-glow heads. Boss telegraphs (Panopticon gaze, Architect collapse)
got clearer, hitbox-accurate visual reads. Predator and Parasite bodies are
now sprite-cached with the same phase-bucketing discipline as Scavenger.

## Known open items (flagged during development, not yet acted on)

These are real, identified gaps — not guesses. Worth surfacing before any new
work in these areas:

1. **Panopticon telegraph understates its hitbox by ~200×.** The charging
   warning is a ~0.0025 rad sliver; the actual sweep damages within ±0.5 rad
   with no distance limit. Deliberately not fixed (would be a balance change
   outside the visual-only patch that found it) — needs an explicit design
   call: widen the tell, or shrink the hitbox to match it.
2. **HUD state logic still lives entirely in `main.js`** as inline style
   writes every frame (not semantic CSS classes), and `#score`'s innerHTML is
   overwritten 60×/sec so it can't hold child markup. Functional, but the
   HUD's visual layer (`style.css`) and its state-driving layer (`main.js`)
   are more coupled than ideal.
3. **Footstep dust particles are heap-allocated, not pooled** — `Renderer.js`
   has no `Director` reference to spawn through. Correct (no leak) but not
   optimal; fixing it means passing a Director handle into the renderer.
4. `spawnParticles(x, y, color, count)`'s signature is intentionally
   unchanged despite 27 call sites across the codebase — any future particle
   parameter needs those call sites updated too, not just `Director.js`.

## Reference docs in the repo

- **`CLAUDE.md`** — architecture ground-truth, verified codebase facts, golden
  rules (no `shadowBlur`, `globalCompositeOperation` reset discipline, pool
  discipline, canvas/DOM separation), and visual/UX conventions. Read this
  first for anything touching rendering or menu code.
- **`EXECUTION_HANDOFF.md`** — the complete patch-by-patch history: what each
  patch changed, every Keep clause, every design decision and why, every bug
  found along the way and whether it was fixed or flagged. The most detailed
  record of *why* the code looks the way it does.
- **`GEMINI.md`** — older AI dev guidelines, still applicable, largely
  superseded by CLAUDE.md's Golden Rules section.
