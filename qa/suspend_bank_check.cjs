// Patch 108: mid-floor Awaken banks once; a resumed run cannot re-bank the same Lucidity.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto('http://localhost:5199/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
  await p.click('#btn-title-begin'); await p.waitForTimeout(500);
  const bank = () => p.evaluate(() => window.__fractured.saveManager.metaState.lucidityBank);
  const b0 = await bank();
  await p.evaluate(() => { window.__fractured.game.state.lucidity = 100; });
  await p.keyboard.press('p'); await p.waitForTimeout(100);
  await p.click('#btn-awaken'); await p.waitForTimeout(200);
  const b1 = await bank();
  const carried = await p.evaluate(() => JSON.parse(localStorage.getItem('fractured_suspended_run') || 'null'));
  console.log('bank', b0, '->', b1, '| carried lucidity:', carried && carried.lucidity, '| floor/room:', carried && carried.floor, carried && carried.roomNumber);
  console.log('screen:', (await p.textContent('#final-stats')).replace(/\s+/g, ' ').slice(0, 140));
  // resume and awaken again with no new earnings
  await p.click('#btn-restart'); await p.waitForTimeout(300);
  await p.evaluate(() => { const g = window.__fractured.game; });
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
  await p.click('#btn-title-resume'); await p.waitForTimeout(500);
  console.log('resumed lucidity:', await p.evaluate(() => window.__fractured.game.state.lucidity), 'state:', await p.evaluate(() => window.__fractured.gameState));
  await p.keyboard.press('p'); await p.waitForTimeout(100);
  await p.click('#btn-awaken'); await p.waitForTimeout(200);
  console.log('bank after 2nd suspend (expect unchanged', b1 + '):', await bank());
  console.log('errors:', errors); await b.close();
})();
