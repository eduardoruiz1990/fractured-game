const { chromium } = require('playwright');
const S = process.argv[2] || __dirname;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.addInitScript({ path: S + '/sdkmock.js' });
  await p.goto('http://localhost:5199/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
  await p.click('#btn-title-begin'); await p.waitForTimeout(600);
  const n = () => p.evaluate(() => window.__sdkCalls.filter(c => c[0]==='happytime').length);
  await p.evaluate(() => window.__fractured.game.onFloorComplete()); console.log('happytime after floor-1 boss:', await n());
  await p.evaluate(() => window.__fractured.game.onFloorComplete()); console.log('same floor again (expect 1):', await n());
  await b.close();
})();
