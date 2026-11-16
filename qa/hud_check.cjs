// Patch 128 (V2 plan C7): HUD readability.
// Assertion-based: exits 1 on any failure. Needs the dev server on :5199.
const { chromium } = require('playwright');
const S = process.argv[2] || __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ width: 384, height: 717 }, { width: 915, height: 412 }, { width: 800, height: 600 }, { width: 960, height: 600 }, { width: 1280, height: 720 }]) {
    const touch = vp.width < 1000 && vp.width !== 800;
    const page = await browser.newPage({ viewport: vp, hasTouch: touch });
    const tag = `${vp.width}x${vp.height}`;
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript({ path: S + '/sdkmock.js' });
    await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.click('#btn-title-begin');
    await page.waitForTimeout(1200);

    const base = await page.evaluate(() => {
      const texts = [...document.querySelectorAll('#ui-layer *')].filter(e => e.offsetParent && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
      const hud = document.getElementById('ui-layer'), scan = document.getElementById('crt-scanlines');
      const r = [...document.querySelectorAll('#ui-layer .hud-top > *')].map(e => e.getBoundingClientRect());
      return {
        min: Math.min(...texts.map(e => parseFloat(getComputedStyle(e).fontSize))),
        smallest: texts.map(e => [e.id || e.className, parseFloat(getComputedStyle(e).fontSize)]).sort((a, b) => a[1] - b[1])[0],
        zHud: +getComputedStyle(hud).zIndex, zScan: +getComputedStyle(scan).zIndex,
        zMenu: +getComputedStyle(document.getElementById('pause-menu')).zIndex,
        inside: r.every(b => b.left >= 0 && b.right <= innerWidth + 1 && b.top >= 0),
        oneRow: r.every(b => Math.abs(b.top - r[0].top) < 2),
        label: document.getElementById('sanity-label').textContent
      };
    });
    ok(base.min >= 11, `${tag} every HUD text >= 11px (smallest ${JSON.stringify(base.smallest)})`);
    ok(base.zHud > base.zScan && base.zHud < base.zMenu, `${tag} HUD above scanlines, below menus (${base.zScan} < ${base.zHud} < ${base.zMenu})`);
    ok(base.inside, `${tag} HUD clusters inside the viewport`);
    ok(base.oneRow, `${tag} HUD is one row`);
    const overlap = await page.evaluate(() => {
      const t = document.getElementById('tutorial-banner');
      if (!t || getComputedStyle(t).display === 'none') return false;
      const tb = t.getBoundingClientRect();
      return [...document.querySelectorAll('#ui-layer .hud-top > *')].some(e => { const b = e.getBoundingClientRect();
        return !(tb.right <= b.left || tb.left >= b.right || tb.bottom <= b.top || tb.top >= b.bottom); });
    });
    ok(!overlap, `${tag} tutorial note does not overlap the HUD`);
    ok(/^SANITY \d+%$/.test(base.label), `${tag} healthy label "${base.label}"`);

    // Low Sanity: words + hatch, not colour alone.
    await page.evaluate(() => { const g = window.__fractured.game; g.state.sanity = g.state.player.maxHp * 0.2; });
    await page.waitForTimeout(150);
    const low = await page.evaluate(() => {
      const sec = document.querySelector('.sanity-section');
      return { label: document.getElementById('sanity-label').textContent, cls: sec.className,
               hatch: getComputedStyle(document.getElementById('sanity-bar')).backgroundImage };
    });
    ok(/FRAYING/.test(low.label) && /sanity-low/.test(low.cls), `${tag} low Sanity reads "${low.label}"`);
    ok(/repeating-linear-gradient/.test(low.hatch), `${tag} low Sanity bar is hatched`);
    const fit = await page.evaluate(() => { const l = document.getElementById('sanity-label'); return l.scrollWidth <= l.parentElement.clientWidth + 1; });
    ok(fit, `${tag} the longest label fits its panel`);
    await page.screenshot({ path: `${S}/hud_low_${tag}.png` });

    // Recover: back to the plain label.
    await page.evaluate(() => { const g = window.__fractured.game; g.state.sanity = g.state.player.maxHp; });
    await page.waitForTimeout(150);
    const back = await page.evaluate(() => ({ label: document.getElementById('sanity-label').textContent, cls: document.querySelector('.sanity-section').className }));
    ok(!/FRAYING|BREAKDOWN/.test(back.label) && !/sanity-low|sanity-breakdown/.test(back.cls), `${tag} recovers to "${back.label}"`);
    ok(errors.length === 0, `${tag} no page errors ${JSON.stringify(errors)}`);
    await page.close();
  }
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
