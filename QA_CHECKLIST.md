# FRACTURED — release QA checklist (V2 plan G4)

Run this against the **CrazyGames developer-portal preview** of the exact zip being
submitted, after the automated gates pass. Tick every box; anything that fails goes in
`CHANGELOG.md` → Known issues with a decision, or blocks the upload.

## 0. Automated gates (before building the zip)

- [ ] All Node suites pass: `for t in bosses content synapse leash tutorial viewport endless rewards pacing arena progress story input; do node test_$t.js || break; done`
- [ ] `node test_fuzz_runs.js` completes 200/200.
- [ ] Dev server up (`npx vite --port 5199 --strictPort`) and every `qa/*_check.cjs` passes (list in `qa/README.md`).
- [ ] `node qa/smoke_check.cjs` passes — it builds and plays the shipped bundles.
- [ ] `npm run build` → `dist/`. `grep -l '__fractured\|perf-overlay' dist/assets/*.js` prints nothing.
- [ ] Zip the **contents** of `dist/` (index.html at the zip root).

## 1. SDK events (portal preview, QA tool / console)

- [ ] `loadingStart` on page load, `loadingStop` once the title is ready (no player wait in between).
- [ ] `gameplayStart` on BEGIN DESCENT / AUTHORIZE DESCENT / PLAY AGAIN / RESUME.
- [ ] `gameplayStop` on pause, level-up cards, death screen, AWAKEN, the folder, the hub, tab hidden.
- [ ] `gameplayStart` again on resume from each of the above.
- [ ] `happytime` on killing a boss on your deepest floor (once per floor per session) and on the first new synergy of the session — nowhere else.
- [ ] `setGameContext` updates on floor/room changes, not every frame.

## 2. Ads

- [ ] **No midgame ad in the first 5 minutes** after page load.
- [ ] After 5 minutes, a midgame ad plays after a death, after AWAKEN and on DESCEND — never mid-combat, and never twice within 5 minutes.
- [ ] Rewarded **REVIVE** (death screen): once per run, the run continues at 50% Sanity.
- [ ] Rewarded **RECOVER LUCIDITY** (death screen): the kept Lucidity doubles, banked once.
- [ ] While any ad plays, game audio is muted; it returns after.
- [ ] Ad error / no fill (try with an ad blocker): the offer disappears or the game continues; no stuck screen, no double reward.
- [ ] Watching a rewarded ad resets the midgame clock (no midgame ad straight after).

## 3. Saves

- [ ] Guest: progress survives a reload in the same browser.
- [ ] Logged in: progress made on device A appears on device B after a reload.
- [ ] Settings (volume, aim assist, text size, colour assist, reduced motion choices) persist the same way.
- [ ] BACK UP FILE → RESTORE FILE round-trips on a fresh profile (in-game dialogs, no native prompt).
- [ ] A suspended run (AWAKEN mid-floor) resumes from the title; Lucidity is not banked twice.

## 4. Devices and browsers

For each: cold load, the tutorial to the first level-up, one boss, death → PLAY AGAIN, the hub.

- [ ] **Android Chrome** (a mid/low-end phone, e.g. the Samsung A56): portrait and landscape. Aim assist turns the light; a held right stick overrides it; double-tap the left side dashes; the phone buzzes on hits and boss wind-ups; HAPTICS off silences it.
- [ ] **iOS Safari** (iPhone): audio starts on the first tap; no vibration (expected, no error); safe-area insets keep the HUD and DASH clear of the notch and the home bar.
- [ ] **Desktop Chrome, Firefox, Safari**: mouse aim, WASD, Space dash, 1/2/3 card picks, Esc/P pause, E interact, Enter DESCEND in the hub.
- [ ] **iframe sizes** in the preview's size selector: 960×540, 800×600, 1280×720 and full screen — title, DESCEND, HUD, level-up and pause all fit with no scrolling.
- [ ] Switching tabs mid-run pauses the game and mutes audio; coming back does not unpause by itself.
- [ ] Space / arrow keys never scroll the portal page while playing.

## 5. Performance (playtest bundle on the phone)

Use `npm run build:playtest`; open the perf overlay and RUN BENCHMARK, or copy a report.

- [ ] Gameplay on LOW holds ~60 fps on the low-end Android phone.
- [ ] **Mind Hub** holds ~60 fps: in the hub, the perf panel's RUN BENCHMARK (~1.5 min) shows 60 for all six 10 s default rows (Patches 157–158).
- [ ] The RECORDS → MIND PALACE pane scrolls smoothly (Patch 151).
- [ ] A full boss fight (floor 5, the Architect) stays playable on LOW.
- [ ] AUTO quality drops a slow phone to LOW within the first seconds and remembers it.

## 6. Accessibility and comfort

- [ ] With the OS set to reduce motion: screen shake starts off, photosensitivity starts on, the title does not glitch.
- [ ] Photosensitivity on: no full-screen flashes (level-up, Polaroid, boss death).
- [ ] Colour-Blind Assist: Sanity reads blue → orange → pink; attack wind-ups get a white dashed ring.
- [ ] Text size LARGER: menus, HUD and canvas subtitles grow; nothing overflows a 384 px-wide phone.

## 7. Content and policy

- [ ] PEGI-12: no blood, gore or decals anywhere (title, play, death, endings).
- [ ] First launch: the cold open plays over the tutorial room and the first input dismisses it; the content note is in the Clinical Guide.
- [ ] Mental-health framing reads as recovery: boss lines, session notes and both endings.
- [ ] Credits read "The FRACTURED team" — no personal names.
- [ ] No placeholder text ("TODO", "lorem", raw ids like `lead_pipe`) on any screen.
- [ ] Both endings play (first Architect kill; the true ending with every Case File page) and AWAKEN / RECURSE do what they say.

## 8. Submission form

- [ ] Title, description, controls text (keyboard + touch), and tags match the build.
- [ ] Thumbnail/cover art is current and gore-free.
- [ ] "Mobile friendly" ticked only if section 4's phone runs all passed.
