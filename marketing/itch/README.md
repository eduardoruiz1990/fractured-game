# itch.io page kit (FRACTURED: Survivors)

For the project at https://guayoxgames.itch.io/fractured (edit page: https://itch.io/game/edit/4886552).

| File | Where it goes on itch.io |
| --- | --- |
| `itch_cover_630x500.png` | Edit game → Cover image |
| `screenshot_1.png` … `screenshot_5.png` | Edit game → Screenshots |
| `banner_logo_1600x520.png` | Public page → Edit theme → Banner |
| `devlog_v3.md` | Dashboard → Devlog → New devlog (first line is the title) |

The cover is rendered with `marketing/tools/cover.cjs landscape 1260 1000` and scaled to 630×500.
The screenshots are frames of the preview-video capture (`marketing/tools/video.cjs`), HUD hidden.
Builds are pushed with butler to the `html5` channel: `butler push dist guayoxgames/fractured:html5`.
