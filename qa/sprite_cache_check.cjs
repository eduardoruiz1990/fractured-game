// Patch 109: the sprite cache must stay bounded while the tutorial cue fades in/out.
// Walks away from the tutorial enemy so the off-screen cue (drawGlow with a varying
// alpha) is drawn, and samples Renderer.spriteCache.size.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto('http://localhost:5199/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  await p.click('#btn-title-begin'); await p.waitForTimeout(500);
  const size = () => p.evaluate(() => window.__fractured.renderer.spriteCache.size);
  // Tutorial gates: MOVE -> DASH -> ENGAGE (the enemy spawns on ENGAGE).
  await p.mouse.move(900, 360);
  await p.keyboard.down('d'); await p.waitForTimeout(800); await p.keyboard.up('d');
  await p.keyboard.press('Space'); await p.waitForTimeout(300);
  const samples = [await size()];
  // Walk away and back repeatedly, so the off-screen cue fades in and out.
  for (const k of ['a', 'a', 'd', 'd', 'a', 'a', 'w', 's']) {
    await p.keyboard.down(k); await p.waitForTimeout(1200); await p.keyboard.up(k);
    samples.push(await size());
  }
  const glowKeys = await p.evaluate(() => [...window.__fractured.renderer.spriteCache.keys()].filter(k => k.startsWith('glow|')).length);
  console.log('spriteCache size over ~9s:', samples.join(' -> '), '| glow keys:', glowKeys);
  console.log('errors:', errors); await b.close();
})();
