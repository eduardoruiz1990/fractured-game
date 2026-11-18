// marketing/tools/cover.cjs: composites the engine renders (marketing/layers/L_*.png) into a cover.
//   node marketing/tools/cover.cjs <landscape|portrait|square|logo> <W> <H> <out.png> [layersDir]
// No dev server needed. The only text is the title (CrazyGames cover rules).
// Composites the engine renders (L_*.png) into a cover. Only text: the title.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [layout, W, H, out] = [process.argv[2], +process.argv[3], +process.argv[4], process.argv[5]];
const D = process.argv[6] || path.join(__dirname, '../layers');
const u = f => 'file://' + path.join(D, f);
const FONT = 'file://' + path.join(__dirname, 'fonts/SpecialElite-Regular.woff2');

// Layout = positions in % of the canvas, sizes in % of the shorter side.
const L = {
  landscape: { eye: [71, 50, 100], hero: [22, 97, 46], beamTo: [67, 52], title: [30, 26, 15.5], titleW: 54, ring: [71, 50, 230] },
  portrait:  { eye: [50, 31, 108], hero: [50, 99, 62], beamTo: [50, 36], title: [50, 66, 22.5], titleW: 92, ring: [50, 31, 250] },
  square:    { eye: [50, 37, 92], hero: [50, 101, 54], beamTo: [50, 41], title: [50, 80, 19.5], titleW: 84, ring: [50, 37, 210] },
  // the title alone on a transparent background (logo.png)
  logo:      { eye: [50, 50, 1], hero: [50, 50, 1], beamTo: [50, 40], title: [50, 42, 60], titleW: 90, ring: [50, 50, 1] }
}[layout];
const S = Math.min(W, H) / 100;   // 1 unit = 1% of the shorter side
const px = (x, y) => [x * W / 100, y * H / 100];

const [ex, ey] = px(L.eye[0], L.eye[1]), es = L.eye[2] * S;
const [hx, hy] = px(L.hero[0], L.hero[1]), hs = L.hero[2] * S;
const [bx, by] = px(L.beamTo[0], L.beamTo[1]);
const [rx, ry] = px(L.ring[0], L.ring[1]), rs = L.ring[2] * S;
const [tx, ty] = px(L.title[0], L.title[1]), tfs = L.title[2] * S;

// The beam: a wedge from the flashlight (just above the hero's centre) to the eye.
const fx = hx, fy = hy - hs * 0.12;
const ang = Math.atan2(by - fy, bx - fx), len = Math.hypot(bx - fx, by - fy) * 1.0, spread = 0.26;
const p1 = [fx + Math.cos(ang - spread) * len, fy + Math.sin(ang - spread) * len];
const p2 = [fx + Math.cos(ang + spread) * len, fy + Math.sin(ang + spread) * len];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Elite'; src: url('${FONT}') format('woff2'); }
html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #050304; }
.l { position: absolute; }
#bg { inset: 0; background:
  radial-gradient(ellipse ${es * 1.25}px ${es * 1.1}px at ${ex}px ${ey}px, rgba(120, 8, 28, 0.55), rgba(40, 2, 10, 0.25) 55%, transparent 75%),
  radial-gradient(ellipse at 50% 120%, rgba(60, 10, 12, 0.6), transparent 60%), #070405; }
#floor { inset: 0; background: url('${u('L_floor.png')}') center / cover; opacity: 0.16; mix-blend-mode: screen; filter: saturate(0.6); }
#ring { left: ${rx - rs / 2}px; top: ${ry - rs / 2}px; width: ${rs}px; height: ${rs}px; background: url('${u('L_ring.png')}') center / contain no-repeat;
  mix-blend-mode: screen; opacity: 0.55; -webkit-mask-image: radial-gradient(circle, transparent 34%, #000 48%, #000 62%, transparent 70%); }
#beamwrap { inset: 0; mix-blend-mode: screen; filter: blur(${S * 2.2}px); }
#beam { inset: 0;
  background: radial-gradient(circle ${len}px at ${fx}px ${fy}px, rgba(255, 232, 190, 0.75), rgba(255, 220, 170, 0.32) 45%, rgba(255, 210, 160, 0.06) 85%, transparent 100%);
  clip-path: polygon(${fx}px ${fy}px, ${p1[0]}px ${p1[1]}px, ${p2[0]}px ${p2[1]}px); }
#eye { left: ${ex - es / 2}px; top: ${ey - es / 2}px; width: ${es}px; height: ${es}px; background: url('${u('L_eye.png')}') center / contain no-repeat; mix-blend-mode: screen; }
#eyeglow { left: ${ex - es}px; top: ${ey - es}px; width: ${es * 2}px; height: ${es * 2}px; mix-blend-mode: screen;
  background: radial-gradient(circle, rgba(255, 40, 80, 0.28), transparent 45%); }
#hero { left: ${hx - hs / 2}px; top: ${hy - hs / 2}px; width: ${hs}px; height: ${hs}px; background: url('${u('L_hero.png')}') center / contain no-repeat; mix-blend-mode: screen;
  transform: rotate(${(ang + Math.PI / 2) * 180 / Math.PI}deg); }
#title { left: ${tx}px; top: ${ty}px; transform: translate(-50%, -50%); width: max-content; }
.t { font-family: 'Elite', 'Courier New', monospace; font-size: ${tfs}px; line-height: 1; letter-spacing: ${tfs * 0.06}px; color: #f4ead6; white-space: nowrap;
  text-shadow: ${tfs * 0.055}px 0 #b0001c, ${-tfs * 0.055}px 0 #c5a059; }
/* The soft dark halo sits on the unclipped ghost copy: on the clipped halves it was cut
   off at their box edge, which showed as a faint rectangle behind the title. */
.ghost { color: transparent; text-shadow: 0 ${tfs * 0.06}px ${tfs * 0.25}px rgba(0, 0, 0, 0.95), 0 0 ${tfs * 0.5}px rgba(0, 0, 0, 0.8); }
.half { position: absolute; left: 0; top: 0; width: 100%; }
.stampwrap { position: absolute; left: 0; top: 0; width: 100%; height: 1em; color: transparent; text-shadow: none; }
.a { clip-path: polygon(-10% -30%, 110% -30%, 110% 38%, 100% 38%, 64% 46%, 52% 58%, 30% 52%, 0 64%, -10% 64%); }
.b { clip-path: polygon(-10% 64%, 0 64%, 30% 52%, 52% 58%, 64% 46%, 100% 38%, 110% 38%, 110% 130%, -10% 130%); transform: translate(${tfs * 0.035}px, ${tfs * 0.05}px) rotate(0.6deg); }
#crack { left: 0; top: 0; width: 100%; height: 100%; }
/* Patch 163: the name is FRACTURED: Survivors; the subtitle is the game's red
   clinic stamp, as on the title screen (src/style.css .title-stamp). */
.stamp { position: absolute; right: 0.2em; bottom: -0.62em; z-index: 2; font-family: 'Courier New', Courier, monospace; font-weight: bold;
  font-size: 0.36em; letter-spacing: 0.16em; line-height: 1; color: #e0283f; border: 0.14em solid #e0283f; border-radius: 0.15em;
  padding: 0.32em 0.55em 0.26em; background: rgba(12, 4, 6, 0.6); white-space: nowrap; transform: rotate(-7deg); }
#title { padding-bottom: 0.4em; }
#vig { inset: 0; background: radial-gradient(ellipse at 50% 50%, transparent 52%, rgba(0, 0, 0, 0.78) 100%); }
#grain { inset: -50%; opacity: 0.10; mix-blend-mode: overlay; }
${layout === 'logo' ? 'html, body { background: transparent !important; } .l:not(#title) { display: none !important; }' : ''}
</style></head><body>
<div class="l" id="bg"></div><div class="l" id="floor"></div><div class="l" id="ring"></div>
<div class="l" id="eyeglow"></div><div class="l" id="beamwrap"><div class="l" id="beam"></div></div><div class="l" id="eye"></div><div class="l" id="hero"></div>
<div class="l" id="vig"></div>
<svg class="l" id="grain" width="${W * 2}" height="${H * 2}"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>
<div class="l" id="title"><div class="t ghost">FRACTURED</div><div class="t half a">FRACTURED</div><div class="t half b">FRACTURED</div><div class="t stampwrap"><span class="stamp">SURVIVORS</span></div></div>
</body></html>`;

(async () => {
  const f = path.join(require('os').tmpdir(), `fractured_cover_${layout}.html`);
  fs.writeFileSync(f, html);
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: W, height: H } })).newPage();
  await page.goto('file://' + f);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(({ target, base }) => {
    const ghost = document.querySelector('.ghost');
    const k = target / ghost.offsetWidth;
    document.querySelectorAll('.t').forEach(t => { t.style.fontSize = (base * k) + 'px'; t.style.letterSpacing = (base * k * 0.06) + 'px'; });
  }, { target: L.titleW * W / 100, base: tfs });
  await page.waitForTimeout(200);
  await page.screenshot({ path: out, omitBackground: layout === 'logo' });
  await b.close();
})();
