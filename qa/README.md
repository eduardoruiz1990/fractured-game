# Headless browser checks (V2 plan G1/G2 seed)

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
node qa/sprite_cache_check.cjs     # sprite cache plateaus while the tutorial cue fades (Patch 109)
node qa/soak_check.cjs [--seconds 45] [--throttle 4] [--phone] [--floor 9]   # perf soak: all bosses + capped crowd; exits 1 on invariant breaks
node qa/render_recovery_check.cjs   # injected render faults do not leak canvas state (Patch 113)
node qa/highrefresh_check.cjs      # ~144 Hz rAF: idle frames skipped; boss banner ends with its freeze (Patch 114)
node qa/context_check.cjs          # portal feedback context: sent on change only, carries last error, no UA (Patch 119)
```

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
