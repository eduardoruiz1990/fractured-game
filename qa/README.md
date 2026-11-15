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
```

`sdkmock.js` is a minimal CrazyGames SDK v3 stand-in, injected with `addInitScript`.
Set `window.__adMode` to `'finish'` or `'error:<code>'` (e.g. `error:adsDisabled`).
Screenshots land next to the scripts and are gitignored.
