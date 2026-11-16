# FRACTURED: CrazyGames submission sheet (v2.0.0)

Draft text for the developer-portal form, written from the game as built (Patch 159).
Check every line against the uploaded build before pasting, and tick
`QA_CHECKLIST.md` §8 when done. Counts were read from the data files
(`src/data/*`, `src/systems/Evolutions.js`). If content changes, re-count.

## Build to upload

- `npm run package`: builds the CrazyGames bundle, checks it, and writes
  `release/fractured-<build id>.zip` (index.html at the zip root).
  - The build id (e.g. `2.0.0-crazygames-1a2b3c4`) is shown at the bottom of Settings.
  - It is also sent with every player-feedback report (`setGameContext`), so a report
    names the exact upload.
- Before uploading: `node qa/smoke_check.cjs` passes.
- After uploading: work through `QA_CHECKLIST.md` in the portal preview.

## Store assets (Patch 160)

All of these are in `marketing/`; see `marketing/README.md` for the rules they follow and how to rebuild them.

| Portal field | File |
| --- | --- |
| Cover, landscape 16:9 | `marketing/covers/cover_landscape_1920x1080.png` |
| Cover, portrait 2:3 | `marketing/covers/cover_portrait_800x1200.png` |
| Cover, square 1:1 | `marketing/covers/cover_square_800x800.png` |
| Preview video, landscape | `marketing/videos/preview_landscape_1920x1080.mp4` (16 s, no audio) |
| Preview video, portrait | `marketing/videos/preview_portrait_1080x1620.mp4` (16 s, no audio) |
| Logo, if asked | `marketing/logo/fractured_logo_1600x400.png` (transparent) |

**Cover click-through rate** becomes a Basic Launch metric for games that start Basic Launch on or after 23 November 2026, so the covers count as much as the build.
- Upload all three covers.
- Check how they look as small tiles in the portal preview.

## Title

FRACTURED

## Short description (one line)

Hold the light. Survive the swarm. Break five nightmares, and find your way back.

(Longer alternative: "A psychological survivors-like: a flashlight against the dark, five
nightmare bosses, hundreds of builds, and a story about getting better.")

## Description

**The dark is full of them. You have a flashlight.**

You are Subject 0, waking inside an evaluation built from a memory you won't face. Each
floor of the institution is a defence mechanism, and each one has a guardian. Hold the
light up, keep your Sanity, and go deeper.

Easy to pick up: move, and your weapons fire on their own. A run lasts a few minutes, and
every run makes the next one stronger.

- **Survive the swarm.** Janitors, Hall Monitors, Substitutes, Photocopies, Fire
  Wardens and Crawlspaces come in waves from the dark.
  - Your weapons fire on their own; you move, aim and dash.
  - Aim assist is on by default on touch.
- **Build your run.** There are 12 weapons, from the Rusted Flashlight to the Lullaby,
  plus 14 synergies when two weapons click, and 12 evolutions.
  - Every level-up card says exactly what changes.
- **Five bosses, five defences.** Sphere Head, the Rorschach, the Panopticon, the
  Amalgamation and the Architect each fight differently.
- **Come back stronger.** You earn Lucidity on every run, win or lose. Spend it on:
  - the 31-node Synapse Tree;
  - 16 tokens to equip;
  - 4 playable Patients, each with their own start and passive;
  - 7 Intrusive Thoughts, for players who want it harder.
- **Find the whole story.** There are 25 Case File pages to collect, two endings, a
  Daily Session, 37 achievements, and THE RECURSION, an endless descent past the fifth
  floor.

No blood or gore. The game deals with grief and mental health, framed around
recovery. A short content note is in the Clinical Guide.

## Controls

**Keyboard and mouse**
- WASD or the arrow keys: move
- Mouse: aim your light (or let aim assist turn it: Settings → Aim Assist)
- Space: dash
- 1 / 2 / 3: pick a level-up card
- E: interact (doors, chests, desks in the Mind Hub)
- P (or Esc): pause
- Enter: DESCEND from the Mind Hub

**Touch**
- Left stick: move
- Right stick: aim (aim assist turns the light for you when you let go)
- DASH button, or double-tap the left side: dash
- Tap a card to pick it; tap doors and desks to use them

## Category and tags (suggested)

- **Category:** Action
- **Tags:** survival, roguelike, bullet hell, horror, dark, 2D, mouse, keyboard, mobile.
  - Use `mobile` only if `QA_CHECKLIST.md` §4's phone runs all passed.
  - Replace any tag the portal does not offer with its nearest listed tag.

## Content and age rating notes

- PEGI 12 target: no blood, gore or decals anywhere (removed in v1.2, checked again in
  QA §7).
- Themes: grief, anxiety, institutional settings.
  - Bosses are defence mechanisms, not people with mental illness.
  - The story's arc is recovery.
  - No depiction of self-harm.
- The credits point to findahelpline.com.
- Photosensitivity: the Photosensitivity setting removes full-screen flashes, and it
  starts on when the OS asks for reduced motion.

## Notes to the CrazyGames team (resubmission)

v1 was declined after Basic Launch (average playtime 1m36s, gameplay conversion 32%).
What v2 changes, in the order a new player meets it:

- **First minute:**
  - The first click plays: the cold open runs over the tutorial room.
  - The first level-up comes at about 20 s, and a second weapon by the second level-up.
  - Cards explain themselves and preview synergies.
  - Mobile aim assist frees the right thumb.
- **Reasons to continue:**
  - The death screen puts PLAY AGAIN first.
  - The death screen offers rewarded REVIVE and DOUBLE LUCIDITY (once per run each).
  - Midgame ads come only at natural breaks, at most once every 5 minutes, and never
    in the first 5 minutes.
- **Depth:** 4 new weapons, 3 new enemies with named elites, chests and evolutions,
  arena shapes and room events, Patients, achievements, a Daily Session, and the story
  with two endings.
- **Stability:**
  - A live-entity cap, quality tiers that adapt on their own, and 60 fps on LOW on a
    mid-range Android phone.
  - The initial download during the loading window is about 1.8 MB.
- **SDK:** v3 with cloud saves, `gameplayStart`/`gameplayStop` at every boundary,
  `happytime` on boss kills and new depth, and player-feedback context including the
  build id.
