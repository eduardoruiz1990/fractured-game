// Patch 105: tab-hide mute/auto-pause, Space-on-focused-button, typing in text fields.
// Usage: node qa/focus_keys_check.cjs            (off-portal)
//        node qa/focus_keys_check.cjs portal     (with the SDK mock)
const { chromium } = require('playwright');
const portal = process.argv[2] === 'portal';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  if (portal) await p.addInitScript({ path: __dirname + '/sdkmock.js' });
  await p.goto('http://localhost:5199/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
  await p.click('#btn-title-begin'); await p.waitForTimeout(600);
  const st = () => p.evaluate(() => window.__fractured.gameState);
  const setVis = v => p.evaluate(v => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
    document.dispatchEvent(new Event('visibilitychange')); }, v);
  await setVis('hidden');
  const muted = await p.evaluate(() => { const a = window.__fractured.game.audioEngine; return a && a._muteReasons ? [...a._muteReasons] : null; });
  console.log(`[${portal ? 'portal' : 'off-portal'}] hidden -> state:`, await st(), 'mute reasons:', muted);
  await setVis('visible');
  console.log('visible -> mute reasons:', await p.evaluate(() => [...(window.__fractured.game.audioEngine._muteReasons || [])]));
  if (await st() === 'PAUSED') await p.keyboard.press('p');
  // focused pause button + Space
  await p.click('#btn-pause'); await p.waitForTimeout(100);
  console.log('after clicking pause:', await st(), 'focused:', await p.evaluate(() => document.activeElement && document.activeElement.id));
  await p.keyboard.press('p'); await p.waitForTimeout(100);
  await p.keyboard.press(' '); await p.waitForTimeout(100);
  console.log('after resume + Space (expect PLAYING):', await st());
  console.log('errors:', errors);
  await b.close();
})();
