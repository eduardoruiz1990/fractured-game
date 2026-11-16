// Patch 119 (V2 B11): the portal feedback context (SDK.game.setGameContext).
// Checks it is sent at the title, refreshed on entering a run, carries the last
// recorded error, contains no user-agent string, and is NOT re-sent every frame.
//   node qa/context_check.cjs        (needs `npx vite --port 5199 --strictPort`)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.addInitScript({ path: __dirname + '/sdkmock.js' });
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto('http://localhost:5199/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
  const ctx = () => p.evaluate(() => window.__gameContext || null);
  const calls = () => p.evaluate(() => window.__sdkCalls.filter(c => c[0] === 'setGameContext').length);
  const fails = [];
  const title = await ctx();
  console.log('title:', JSON.stringify(title));
  if (!title || title.screen !== 'TITLE') fails.push('no TITLE context');
  if (!title || !/^\d+\.\d+\.\d+-/.test(title.build || '')) fails.push('no build id (Patch 159)');
  await p.evaluate(() => { window.__fractured.saveManager.metaState.tutorialCompleted = true; });
  await p.click('#btn-title-begin'); await p.waitForTimeout(800);
  const run = await ctx();
  console.log('run:  ', JSON.stringify(run));
  if (!run || run.screen !== 'PLAYING' || !run.floor || !run.weapons) fails.push('run context missing screen/floor/weapons');
  const n0 = await calls(); await p.waitForTimeout(3000); const n1 = await calls();
  console.log('calls during 3s of steady play:', n1 - n0);
  if (n1 - n0 > 3) fails.push('context re-sent per frame');
  await p.evaluate(() => window.FRACTURED_ERRORS.capture(new Error('qa synthetic'), 'qa'));
  await p.waitForTimeout(200);
  const err = await ctx();
  console.log('error:', JSON.stringify(err));
  if (!err || !/qa synthetic/.test(err.lastError || '')) fails.push('lastError not attached');
  if (Object.values(err || {}).some(v => /Mozilla|Chrome\//.test(v))) fails.push('user agent leaked');
  if (Object.values(err || {}).some(v => typeof v !== 'string')) fails.push('non-string value');
  await p.evaluate(() => window.FRACTURED_ERRORS.clear());
  if (errors.length) fails.push('page errors: ' + errors.join(' | '));
  await b.close();
  if (fails.length) { console.log('FAIL: ' + fails.join('; ')); process.exit(1); }
  console.log('OK');
})();
