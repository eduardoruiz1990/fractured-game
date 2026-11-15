const { chromium } = require('playwright');
const S = process.argv[2] || __dirname;
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function fresh(adMode) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { const r = performance.now.bind(performance); window.__off = 0; performance.now = () => r() + window.__off; });
    await page.addInitScript({ path: S + '/sdkmock.js' });
    await page.addInitScript(m => { window.__adModeInit = m; }, adMode);
    await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
    await page.evaluate(() => { window.__adMode = window.__adModeInit; });
    await page.waitForTimeout(1000);
    await page.click('#btn-title-begin'); await page.waitForTimeout(800);
    return page;
  }
  const kill = p => p.evaluate(() => { const g = window.__fractured.game; g.state.lucidity = 200; g.state.sanity = 0; });
  const vis = (p, id) => p.evaluate(i => { const e = document.getElementById(i); return !!e && e.offsetParent !== null; }, id);
  const calls = p => p.evaluate(() => window.__sdkCalls.filter(c => c[0] === 'requestAd' || c[0] === 'happytime').map(c => c[0] + ':' + (c[1]||'')).join(' '));

  // 1. Basic Launch: adsDisabled
  let p = await fresh('error:adsDisabled');
  await kill(p); await p.waitForTimeout(300);
  await p.click('#btn-revive'); await p.waitForTimeout(300);
  console.log('[adsDisabled] box visible after error:', await vis(p, 'death-rewarded'), 'state:', await p.evaluate(() => window.__fractured.gameState));
  await p.click('#btn-restart'); await p.waitForTimeout(300);
  await p.close();

  // 2. Cooldown: no midgame inside 5 min, midgame after
  p = await fresh('finish');
  await kill(p); await p.waitForTimeout(300);
  await p.click('#btn-restart'); await p.waitForTimeout(300);
  console.log('[t<5min] calls:', JSON.stringify(await calls(p)), 'state:', await p.evaluate(() => window.__fractured.gameState));
  await p.evaluate(() => { window.__off += 6 * 60 * 1000; });
  // back into a run from the hub via dev-free path: title begin isn't visible in HUB, so start via a new death
  await p.evaluate(() => { const f = window.__fractured; });
  await p.close();

  p = await fresh('finish');
  await p.evaluate(() => { window.__off += 6 * 60 * 1000; });
  await kill(p); await p.waitForTimeout(300);
  await p.click('#btn-restart'); await p.waitForTimeout(400);
  console.log('[t>5min] calls:', JSON.stringify(await calls(p)), 'state:', await p.evaluate(() => window.__fractured.gameState));
  await p.close();
  console.log('errors:', errors);
  await browser.close();
})();
