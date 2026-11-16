# FRACTURED: Second Opinion: store assets (Patches 160, 163)

These are the covers, logo and preview videos for the CrazyGames developer portal, and the tools that made them. Every image comes from the real game:
- The engine draws each layer in a headless browser.
- A small HTML page composites the layers and adds the title.
- Nothing is painted by hand, so the kit can be rebuilt after the art changes.

| File | Size | Portal slot |
| --- | --- | --- |
| `covers/cover_landscape_1920x1080.png` | 1920×1080 (16:9) | Landscape cover |
| `covers/cover_portrait_800x1200.png` | 800×1200 (2:3) | Portrait cover |
| `covers/cover_square_800x800.png` | 800×800 (1:1) | Square cover |
| `videos/preview_landscape_1920x1080.mp4` | 1080p 16:9, about 16 s | Landscape preview video |
| `videos/preview_portrait_1080x1620.mp4` | 1080×1620 (2:3), about 16 s | Portrait preview video |
| `logo/fractured_logo_1600x520.png` | 1600×520, transparent | Logo (title and stamp) |

## The CrazyGames rules these follow

Sources:
- [docs.crazygames.com/requirements/game-covers](https://docs.crazygames.com/requirements/game-covers/)
- the video section of the same requirements

From November 23rd 2026, cover click-through rate is a Basic Launch metric. Treat the covers as part of the game.

**Covers**
- **Sizes:** all three sizes are given, and they look like one set: the same eye, the same beam, the same title.
- **Allowed text:** the title is the only text: FRACTURED, with SECOND OPINION as a red clinic stamp, the same as on the title screen (Patch 163). There is no "New" or "Play", no logos, store badges or icons, and no border.
- **Focal point:** one focal point, the Panopticon's eye, with the flashlight beam leading to it. The title is large and stylised.
- **Not a raw screenshot:** the layers are separate engine renders at 5–6× zoom, composited. Nothing is upscaled, so nothing is blurry.

**Videos**
- **Length:** 15–20 s; longer videos are cut at 20 s. Both are under 50 MB.
- **Opening:** each video opens on its static cover, then crossfades into gameplay.
- **No sound.**
- **Real speed:** the portal speeds previews up slightly, so they are captured at 30 fps without fast-forward.
- **Nothing on screen but gameplay:**
  - no black screens, logo stingers, black bars or mouse cursor;
  - no promotional text or social icons;
  - the HUD and DOM are hidden.

## What the video changes (and why)

The capture runs the real game on a virtual clock: each frame is exactly 1000/30 ms of simulation, then a screenshot. The following are set for the camera only, and none of it is in the shipped build:
- **Darkness at 62%** instead of the full fill. The darkness mask is what makes the game read as horror at full size. On a 300 px thumbnail, it is mostly black. The flashlight still cuts it.
- **No damage numbers, no film grain, no level-up cards.**
  - Numbers clutter a 16 s clip.
  - Grain makes the encoder smear.
  - A card would pause the shot.
- **Sanity kept full and the camera held.** The shots are staged, not a scripted run.
- **Floor-exit doors and pickups removed after the boss kill.** Their labels are in-game text that would read as promotional text.

There are four shots, so the clip opens on a boss and ends on a boss kill:

| Shot | Length | What it shows |
| --- | --- | --- |
| `boss` | 4.4 s | Floor 3: the Panopticon, circle-strafed |
| `swarm` | 3.8 s | Floor 2: the crowd in the flashlight |
| `chaos` | 4.2 s | Floor 4: 10 weapons at level 4–5 |
| `finale` | 2.8 s | The Panopticon's death: freeze, slow motion, burst |

## Rebuilding

The covers and logo need no server:

```bash
NODE_PATH=/opt/node-tools/node_modules node marketing/tools/cover.cjs landscape 1920 1080 marketing/covers/cover_landscape_1920x1080.png
```

The other layouts are `portrait 800 1200`, `square 800 800` and `logo 1600 520`. For the video's opening frame, render `portrait 1080 1620`.

The layers (`layers/L_*.png`) and the video frames need the dev server running:

```bash
npx vite --port 5199 --strictPort
```

```bash
node marketing/tools/still.cjs 1400 1400 marketing/layers/L_eye.png '{"boss":"PANOPTICON","bossDy":-160,"zoom":5,"camY":800,"crowd":0,"lights":false,"fog":false,"noPlayer":true,"noVignette":true,"noGrain":true,"blackFloor":true,"angle":1.57}'
```

```bash
node marketing/tools/still.cjs 1000 1000 marketing/layers/L_hero.png '{"boss":null,"zoom":6,"crowd":0,"lights":false,"fog":false,"noVignette":true,"noGrain":true,"blackFloor":true,"angle":-1.5708,"noCone":true}'
```

```bash
node marketing/tools/still.cjs 1920 1920 marketing/layers/L_ring.png '{"boss":null,"zoom":3,"crowd":34,"ring":[230,330],"lights":false,"fog":false,"noPlayer":true,"noVignette":true,"noGrain":true,"blackFloor":true,"noCone":true,"plain":true,"mobs":["SCAVENGER","SCAVENGER","PREDATOR"]}'
```

```bash
node marketing/tools/still.cjs 1920 1080 marketing/layers/L_floor.png '{"noCone":true,"noPlayer":true,"crowd":0,"boss":null,"lights":false,"fog":false,"noVignette":true,"noGrain":true,"zoom":1.6}'
```

`L_floor` can catch a stray XP orb. It shows only at 16% opacity, but paint it out if it lands somewhere visible.

To make the videos, capture the frames, then encode. Each capture takes a few minutes.

```bash
node marketing/tools/video.cjs 1920 1080 /tmp/fr_L
```

```bash
node marketing/tools/video.cjs 1080 1620 /tmp/fr_P
```

```bash
marketing/tools/encode.sh marketing/covers/cover_landscape_1920x1080.png /tmp/fr_L marketing/videos/preview_landscape_1920x1080.mp4 1920 1080
```

```bash
marketing/tools/encode.sh /tmp/cover_portrait_1080x1620.png /tmp/fr_P marketing/videos/preview_portrait_1080x1620.mp4 1080 1620
```

`--only <shot>` and `--every N` give a quick look at a single shot.

Look at every cover and a few video frames before uploading. The capture is deterministic in timing but not in spawns, since spawn positions are random.

## Fonts

The title uses **Special Elite** by Astigmatic, under the Apache License 2.0. The font file and its licence are in `tools/fonts/`. It is used only to render the images; the game doesn't load it.
