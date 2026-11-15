// Patch 106: settings migrate from raw localStorage into the portal store, then load from it.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(); const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(() => { try { localStorage.setItem('fractured_settings', JSON.stringify({ musicVolume: 0.3, sfxVolume: 0.6, screenShake: false })); } catch (e) {} });
  await p.addInitScript({ path: __dirname + '/sdkmock.js' });
  await p.goto('http://localhost:5199/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
  const inPortal = await p.evaluate(() => window.CrazyGames.SDK.data.getItem('fractured_settings'));
  console.log('migrated into portal store:', inPortal);
  console.log('shake toggle reflects it (expect false):', await p.evaluate(() => { const t = document.querySelector('input[type=checkbox]#toggle-shake') || document.getElementById('toggle-shake'); return t ? t.checked : 'n/a'; }));
  console.log('errors:', errors);
  await b.close();
})();
