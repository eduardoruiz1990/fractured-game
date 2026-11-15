// Patch 120: the AUTO quality probe must step down on a slow device. Headless Chromium
// draws in software, so a busy 1280x720 room under CPU throttle is reliably slower
// than the 25 ms threshold; the probe must see that and settle on LOW within ~10 s.
// With --fast (small viewport, no throttle, no crowd: ~50+ fps here) it must STAY on HIGH.
//   node qa/auto_quality_check.cjs [--fast]    (needs `npx vite --port 5199 --strictPort`)
const { chromium } = require('playwright');
const FAST = process.argv.includes('--fast');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: FAST ? { width: 915, height: 412 } : { width: 1280, height: 720 } });
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  const cdp = await p.context().newCDPSession(p);
  await p.goto('http://localhost:5199/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  await p.evaluate(() => { const f = window.__fractured; f.saveManager.metaState.tutorialCompleted = true; f.setQuality('auto'); });
  const before = await p.evaluate(() => window.__fractured.qualityTier);
  await p.click('#btn-title-begin'); await p.waitForTimeout(500);
  if (!FAST) await p.evaluate(() => {
    const g = window.__fractured.game;
    for (const t of ['BOSS', 'RORSCHACH', 'PANOPTICON']) g.director.spawnEntity(t, null, null, null, null, 1, 600);
    for (let k = 0; g.director.hasRoomForEnemy() && k < 80; k++) g.director.spawnEntity(['SCAVENGER', 'PREDATOR', 'PARASITE'][k % 3], null, null);
    g.onLevelUp = null;
    setInterval(() => { const S = g.state; S.sanity = S.player.maxHp; }, 50);
  });
  if (FAST) await p.evaluate(() => { const g = window.__fractured.game; g.onLevelUp = null; setInterval(() => { g.state.sanity = g.state.player.maxHp; }, 50); });
  else await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let after = before;
  for (let i = 0; i < (FAST ? 16 : 40) && after !== 'low'; i++) { await p.waitForTimeout(500); after = await p.evaluate(() => window.__fractured.qualityTier); }
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('fractured_settings') || '{}').autoQuality);
  await b.close();
  console.log(`tier before ${before}, after ${after}, persisted autoQuality ${saved}, errors ${errors.length}`);
  const ok = FAST ? (after === 'high' && saved !== 'low') : (after === 'low' && saved === 'low');
  if (!ok || errors.length) { console.log('FAIL'); process.exit(1); }
  console.log('OK');
})();
