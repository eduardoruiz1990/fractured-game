// V2 plan G2 (seed): headless performance soak.
//
// Drives the real game in Chromium under a worst-case load and reports frame time,
// heap growth, sprite-cache size, live entity counts and page errors.
//
//   node qa/soak_check.cjs [--seconds 60] [--throttle 4] [--phone] [--floor 9] [--baseline]
//
// Scenario: tutorial skipped, floor N (default 9, i.e. endless Cycle II), every weapon
// at level 5, all five bosses alive at once, room budget topped up continuously, the
// player kept alive and walking a square (held WASD, the real input path). That is far beyond anything real play
// produces, which is the point: it is a ceiling, and a regression shows up as a
// change in these numbers.
//
// CAVEAT: headless Chromium draws 2D canvas in SOFTWARE (SwiftShader), so absolute
// frame times are much worse than a real GPU-backed browser. Compare runs with each
// other (same flags, same machine), not against 16.7 ms. `--throttle` applies CDP CPU
// throttling on top, which approximates a weaker phone's JS cost.
//
// Exit code is non-zero when an INVARIANT breaks (page error, regular enemies above
// the Director's cap, or unbounded sprite-cache growth) — never for slow frames.
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? Number(args[i + 1]) : dflt; };
const flag = name => args.includes('--' + name);
const SECONDS = arg('seconds', 45);
const THROTTLE = arg('throttle', 1);
const FLOOR = arg('floor', 9);
const PHONE = flag('phone');
const URL = process.env.FRACTURED_URL || 'http://localhost:5199/';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage(PHONE
    ? { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }
    : { viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.__fractured.saveManager.metaState.tutorialCompleted = true; });
  await page.click('#btn-title-begin');
  await page.waitForTimeout(500);

  // Build the scenario.
  await page.evaluate((floor) => {
    const f = window.__fractured, g = f.game, st = g.state;
    st.floor = floor;
    st.roomNumber = 3;
    for (const w of Object.values(st.player.weapons)) { w.level = 5; if ('active' in w) w.active = true; }
    g.director.spawnRoom(floor, 3);
    for (const t of ['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT']) {
      g.director.spawnEntity(t, null, null, null, null, 1, 600);
    }
    // Start AT the live-enemy ceiling, so the cap itself is exercised from frame one.
    const mix = ['SCAVENGER', 'PREDATOR', 'PARASITE'];
    for (let i = 0; g.director.hasRoomForEnemy() && i < 500; i++) g.director.spawnEntity(mix[i % 3], null, null);
    window.__soakSeeded = g.director.liveRegularEnemyCount();
    // Frame recorder + keep-alive, all in-page so the harness does not perturb timing.
    window.__soak = { frames: [], maxRegular: 0, maxTotal: 0, maxOrbs: 0, maxParticles: 0, maxPuddles: 0 };
    const BOSS = new Set(['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT']);
    let last = performance.now();
    const tick = (now) => {
      const s = window.__soak;
      s.frames.push(now - last); last = now;
      const S = f.game.state;
      if (S.player && Number.isFinite(S.player.maxHp)) S.sanity = S.player.maxHp;   // immortal
      S.enemyBudget = Math.max(S.enemyBudget || 0, 200);                            // endless pressure
      S.xp = 0;   // no level-up cards: LEVEL_UP pauses the sim and would skew the numbers
      const ents = S.entities || [];
      let reg = 0; for (const e of ents) if (!BOSS.has(e.type)) reg++;
      s.maxRegular = Math.max(s.maxRegular, reg);
      s.maxTotal = Math.max(s.maxTotal, ents.length);
      s.maxOrbs = Math.max(s.maxOrbs, (S.xpDrops || []).length);
      s.maxParticles = Math.max(s.maxParticles, (S.particles || []).length);
      s.maxPuddles = Math.max(s.maxPuddles, (S.inkPuddles || []).length);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, FLOOR);

  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  const heap = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const m = Object.fromEntries(metrics.map(x => [x.name, x.value]));
    return m.JSHeapUsedSize / 1048576;
  };
  await page.evaluate(() => { window.__soak.frames.length = 0; window.__fractured.loopMs = []; });
  const heap0 = await heap();
  const cacheSamples = [];
  const keys = ['d', 's', 'a', 'w'];
  const end = Date.now() + SECONDS * 1000;
  let k = 0;
  while (Date.now() < end) {
    const key = keys[k++ % keys.length];
    await page.keyboard.down(key);
    await page.waitForTimeout(2500);
    await page.keyboard.up(key);
    cacheSamples.push(await page.evaluate(() => window.__fractured.renderer.spriteCache.size));
  }
  const heap1 = await heap();
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  const r = await page.evaluate(() => {
    const s = window.__soak, fr = s.frames.slice(5).sort((a, b) => a - b);
    const q = p => fr.length ? fr[Math.min(fr.length - 1, Math.floor(p * fr.length))] : NaN;
    const lm = (window.__fractured.loopMs || []).slice().sort((a, b) => a - b);
    const lq = p => lm.length ? lm[Math.min(lm.length - 1, Math.floor(p * lm.length))] : NaN;
    return {
      frames: fr.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), worst: fr[fr.length - 1],
      loop50: lq(0.5), loop95: lq(0.95), loopMean: lm.length ? lm.reduce((a, b) => a + b, 0) / lm.length : NaN,
      maxRegular: s.maxRegular, maxTotal: s.maxTotal, maxOrbs: s.maxOrbs,
      maxParticles: s.maxParticles, maxPuddles: s.maxPuddles,
      cap: window.__fractured.game.director.liveEntityCap, seeded: window.__soakSeeded,
      state: window.__fractured.gameState
    };
  });
  await browser.close();

  const fmt = n => Number.isFinite(n) ? n.toFixed(1) : String(n);
  console.log(`soak: ${SECONDS}s, ${PHONE ? 'phone 844x390' : 'desktop 1280x720'}, CPU throttle x${THROTTLE}, floor ${FLOOR}`);
  console.log(`  frames ${r.frames}  frame ms p50 ${fmt(r.p50)}  p95 ${fmt(r.p95)}  p99 ${fmt(r.p99)}  worst ${fmt(r.worst)}`);
  console.log(`  loop CPU ms (sim+render, no vsync) mean ${fmt(r.loopMean)}  p50 ${fmt(r.loop50)}  p95 ${fmt(r.loop95)}`);
  console.log(`  entities max ${r.maxTotal} (regular ${r.maxRegular}, seeded ${r.seeded}, cap ${r.cap})  orbs max ${r.maxOrbs}  particles max ${r.maxParticles}  puddles max ${r.maxPuddles}`);
  console.log(`  heap ${fmt(heap0)} -> ${fmt(heap1)} MB (${fmt(heap1 - heap0)})  spriteCache ${cacheSamples.join(' ')}`);
  console.log(`  final state ${r.state}  page errors ${errors.length}`);
  errors.slice(0, 5).forEach(e => console.log('    ! ' + e));

  const failures = [];
  if (errors.length) failures.push('page errors');
  if (Number.isFinite(r.cap) && r.maxRegular > r.cap) failures.push(`regular enemies ${r.maxRegular} > cap ${r.cap}`);
  // The cache legitimately fills toward its working set (~280 entries with every enemy
  // and boss on screen) and is hard-capped at 768 by Renderer.cacheSprite. Getting close
  // to the cap means a key is varying continuously again and the cache is thrashing.
  const lastCache = cacheSamples[cacheSamples.length - 1] || 0;
  if (lastCache > 600) failures.push(`sprite cache at ${lastCache} entries (thrashing toward the 768 cap)`);
  if (failures.length) { console.log('  FAIL: ' + failures.join('; ')); process.exit(1); }
  console.log('  invariants OK');
})();
