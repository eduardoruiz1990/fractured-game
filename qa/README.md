# Headless browser checks (V2 plan G1/G2 seed)

**Shipped bundles (G2):** `node qa/smoke_check.cjs [--seconds 40] [--no-soak] [--keep]` needs
no dev server. It builds the CrazyGames and playtest bundles, serves them with `vite preview`
(ports 5197/5196), plays the CrazyGames one like a player with no dev hook (SDK tag, no
foreign hosts, loading-window size < 2.5 MB, cold open, the tutorial advancing under real
input, pause, no errors) and soaks the built playtest bundle. Run it before every upload.

Playwright scripts that drive the real game in Chromium. They need the Vite **dev**
server, because they use the dev-only `window.__fractured` hook (absent from builds):

```bash
npx vite --port 5199 --strictPort &
node qa/ads_rewarded_check.cjs     # revive + recover flow, Lucidity bank maths, SDK call log
node qa/ads_cooldown_check.cjs     # adsDisabled hides offers; 5-minute midgame floor
node qa/happy_check.cjs            # happytime once per floor per session
node qa/dialog_check.cjs           # in-world dialog: export field, import value, no native dialogs
node qa/focus_keys_check.cjs [portal]  # tab-hide mute (+ auto-pause off-portal), Space vs focused buttons
node qa/settings_check.cjs         # settings migrate from localStorage into the portal store
node qa/suspend_bank_check.cjs     # mid-floor Awaken banks once; resume cannot re-bank
node qa/death_screen_check.cjs     # cause/stats, PLAY AGAIN on screen + into a fresh run, AWAKEN layout (Patch 124)
node qa/levelup_check.cjs          # cards: real names + stat lines, >=11px, on screen, 1/2/3 + 300 ms guard, SYNERGY READY (Patch 125)
node qa/synergy_check.cjs          # synergy formed: banner, slow motion, happytime once, codex silhouettes, cleared on death (Patch 126)
node qa/hud_check.cjs              # HUD: >=11px on phones, above scanlines, one row at 800/960, Sanity state in words + hatch (Patch 128)
node qa/hub_check.cjs              # folder: 4 groups + sub-tabs; hub DESCEND button/Enter, suspended run opens the machine (Patch 129)
node qa/text_check.cjs             # every reachable screen's text: no TODO/lorem, undefined/NaN/null, raw snake_case ids or emails; generic credits; Settings shows the build id (Patch 159)
node qa/juice_check.cjs            # level-up flash/deal-in/ease, boss-death freeze+slow-mo+burst, token pickup beat, photosensitive opt-out (Patch 130)
node qa/arsenal_check.cjs          # the four Phase D weapons fire and kill, their level-up card, the six-slot cap (Patch 132)
node qa/elite_check.cjs            # a named elite spawns, drops a chest, the chest opens with its notice, phone + desktop (Patch 133)
node qa/evolution_check.cjs        # EVOLUTION READY card, a chest evolves the pipe, the notice, the evolution codex (Patch 134)
node qa/enemies_check.cjs          # the Photocopy, Fire Warden and Crawlspace drawn in game, the Photocopy split (Patch 135)
node qa/patients_check.cjs         # the Patient picker on the title and in EVALUATION, a run started as the Vandal (Patch 136)
node qa/arena_check.cjs            # each floor's room shape drawn, the player held by the walls, the walls lowered on the clear (Patch 137)
node qa/events_check.cjs           # the Power Outage, Lockdown and Session Bell in game, with their notices and HUD lines (Patch 138)
node qa/achievements_check.cjs     # achievements held through the tutorial, locked instruments never offered, an unlock mid-run, the Mind Palace, the death-screen line (Patch 139)
node qa/daily_check.cjs            # the Daily Session: hidden at first, the day's run, its score, one attempt per day across a reload (Patch 140)
node qa/aim_check.cjs              # aim assist (on for touch, stick override, AUTO/ON on desktop) and the double-tap dash with its buzz (Patches 148-149)
node qa/access_check.cjs           # reduced-motion defaults, still title, colour-blind assist palette, text size on a phone (Patch 150)
node qa/sizes_check.cjs            # title, DESCEND, HUD, level-up, pause fit at 8 iframe/phone sizes; no blur over the canvas (Patch 151)
node qa/story_check.cjs            # Phase E: cold open, Case File pages and pane, boss lines and skip, death subtitle, session notes, both endings, replays (Patches 142-147)
node qa/sprite_cache_check.cjs     # sprite cache plateaus while the tutorial cue fades (Patch 109)
node qa/soak_check.cjs [--seconds 45] [--throttle 4] [--phone] [--floor 9]   # perf soak: all bosses + capped crowd; exits 1 on invariant breaks
node qa/render_recovery_check.cjs   # injected render faults do not leak canvas state (Patch 113)
node qa/highrefresh_check.cjs      # ~144 Hz rAF: idle frames skipped; boss banner ends with its freeze (Patch 114)
node qa/sim_cost_check.cjs [--no-weapons]  # processGameLogic alone, soak scenario (B2 measurement)
node qa/auto_quality_check.cjs [--fast]  # AUTO steps down on a slow run and persists; --fast must stay HIGH (Patch 120)
node qa/context_check.cjs          # portal feedback context: sent on change only, carries last error, no UA (Patch 119)
```

**Real devices:** `npm run build:playtest` builds the game with an on-screen PERF panel
(`src/dev/PerfOverlay.js`). RUN BENCHMARK there measures fog, darkness, vignette, grain,
the CRT overlay, the HUD and both tiers on the phone's own GPU, and prints a copyable
report. The headless checks can't measure this, because they draw in software.

**A/B in the soak:** `FRACTURED_PRE='<js>' node qa/soak_check.cjs ...` evaluates the snippet
in the page after the tier is set, e.g. `window.__fractured.renderer.fogBuffered=true`.
Headless runs drift by ±1–2 ms between sessions, so always run both sides back to back.

`sdkmock.js` is a minimal CrazyGames SDK v3 stand-in, injected with `addInitScript`.
Set `window.__adMode` to `'finish'` or `'error:<code>'` (e.g. `error:adsDisabled`).
Screenshots land next to the scripts and are gitignored.

## Soak baselines (headless Chromium, software canvas — compare runs, not absolutes)

| Date / patch | Flags | frame p50 / p95 ms | max regular (cap) | particles max | heap Δ | spriteCache end |
|---|---|---|---|---|---|---|
| 2026-11-15, after P111 | `--seconds 30` | 33.4 / 50.1 | 60 (60) | 633 | +0.3 MB | 306 |
| 2026-11-15, after P111 | `--seconds 30 --phone --throttle 4` | 116.7 / 166.6 | 40 (60) | 587 | +0.1 MB | 294 |
| 2026-11-15, after P115 | `--seconds 25 --quality high` | 50.0 / 66.8 (loop CPU mean 6.6) | — | — | — | — |
| 2026-11-15, after P115 | `--seconds 25 --quality low` | 33.3 / 50.0 (loop CPU mean 3.6) | — | — | — | — |

## Real-device baselines (playtest build, PERF → RUN BENCHMARK)

| Date / patch | Device | LOW sustained 60 s | HIGH | Notes |
|---|---|---|---|---|
| 2026-11-15, P120 | Samsung A56, Claude app WebView, 384×717 portrait, dpr 2.8, 120 Hz | 60 fps at start, slowed later in the run | 26 fps | AUTO picked LOW correctly; the slowdown made the rows hard to read |
| 2026-11-15, P121 | same | not measured | 25 fps → 11 fps after ~8 s | the fog buffer stalled JS for 68 ms; removed in P122 |
| 2026-11-15, P122 | same | **60 fps in all six 10 s windows**, p95 ≤ 22 ms | 33 fps | drift check matched the first window; every LOW-minus row ran at 60 |

