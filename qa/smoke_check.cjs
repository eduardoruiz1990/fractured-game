// V2 plan G2: smoke test of the SHIPPED bundles. Every other qa check drives the dev
// server; this one builds what we actually upload and plays it like a player would.
// Assertion-based: exits 1 on any failure. Needs no dev server (it serves its own).
//
//   node qa/smoke_check.cjs [--seconds 40] [--no-soak] [--keep]
//
// 1. Builds `--mode crazygames` and `--mode playtest` into a temp dir and serves each
//    with `vite preview`.
// 2. The CrazyGames bundle, desktop 1280x720 and a 384x717 touch phone, first launch
//    (empty storage), the SDK script answered by qa/sdkmock.js:
//    - the SDK <script> tag is requested, and no host other than this one and the SDK's
//      is ever contacted;
//    - the download inside the SDK's loading window (loadingStart .. loadingStop, what
//      the platform measures) is under 2.5 MB; the in-run music (~1.9 MB) is fetched
//      after loadingStop on purpose (AudioEngine.loadDeferredAssets) and reported apart;
//    - the dev hook and the perf overlay are absent at runtime;
//    - the SDK hears init, then gameplayStart on BEGIN DESCENT;
//    - the cold open plays and the first input dismisses it;
//    - the tutorial ADVANCES under simulated input (held keys and mouse aim on desktop,
//      taps on the phone): its banner text changes at least twice;
//    - pause opens the pause menu and the SDK hears gameplayStop;
//    - no page error, no console.error, and nothing in ErrorLog's store.
// 3. The playtest bundle (it carries the dev hook): qa/soak_check.cjs against it, phone
//    viewport, 4x CPU throttle, LOW tier — every invariant, including heap growth.
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const argNum = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? Number(args[i + 1]) : d; };
const SECONDS = argNum('seconds', 40);
const SOAK = !args.includes('--no-soak');
const KEEP = args.includes('--keep');
const OUT = path.join(os.tmpdir(), 'fractured-smoke');
const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const SDK_MOCK = fs.readFileSync(path.join(__dirname, 'sdkmock.js'), 'utf8');
const SHOTS = process.env.FRACTURED_SHOTS || OUT;

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

function build(mode) {
  const dir = path.join(OUT, mode);
  execSync(`npx vite build --mode ${mode} --outDir "${dir}" --emptyOutDir`, { cwd: ROOT, stdio: 'pipe' });
  return dir;
}
function serve(dir, port) {
  const p = spawn('npx', ['vite', 'preview', '--outDir', dir, '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
  return p;
}
const up = (url) => new Promise(res => http.get(url, r => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)));
async function waitUp(url, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await up(url)) return true; await new Promise(r => setTimeout(r, 250)); }
  return false;
}
const levelUpOpen = (page) => page.evaluate(() => !!document.querySelector('#cards-container .card') && [...document.querySelectorAll('#cards-container .card')].some(c => c.offsetParent !== null));
const bannerText = (page) => page.evaluate(() => { const b = document.getElementById('tutorial-banner'); return b && getComputedStyle(b).display !== 'none' ? b.innerText.trim() : ''; });

async function playCrazyGames(browser, base, vp) {
  const tag = `${vp.width}x${vp.height}`;
  const touch = !!vp.touch;
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

  // Network: answer the SDK with the mock, record every host and every byte.
  const hosts = new Set();
  let sdkRequested = false;

  await page.route(SDK_URL, route => { sdkRequested = true; route.fulfill({ status: 200, contentType: 'application/javascript', body: SDK_MOCK }); });
  page.on('request', r => { try { hosts.add(new URL(r.url()).host); } catch (e) {} });

  const t0 = Date.now();
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForSelector('#btn-title-begin', { state: 'visible', timeout: 15000 });
  await page.waitForTimeout(500);
  ok(sdkRequested, `${tag} the CrazyGames SDK tag is in the bundle and requested`);
  // Resource Timing: everything requested before loadingStop counts, the rest is deferred.
  const load = await page.evaluate(() => {
    const stop = (window.__sdkCalls.find(c => c[0] === 'loadingStop') || [])[2];
    const size = e => e.transferSize || e.encodedBodySize || 0;
    const res = performance.getEntriesByType('resource');
    const nav = performance.getEntriesByType('navigation')[0];
    // The mock rounds its timestamps to the ms and the deferred fetch starts in the same
    // ms as loadingStop, so "before" means more than 1 ms before.
    const before = e => stop !== undefined && e.startTime < stop - 1;
    const inWindow = res.filter(before);
    const after = res.filter(e => !before(e));
    return { stop, inWindow: inWindow.reduce((a, e) => a + size(e), 0) + (nav ? size(nav) : 0), after: after.reduce((a, e) => a + size(e), 0),
      afterNames: after.filter(e => size(e) > 100000).map(e => e.name.split('/').pop()) };
  });
  const mb = load.inWindow / 1048576;
  ok(load.stop !== undefined && mb < 2.5, `${tag} loading-window download ${mb.toFixed(2)} MB < 2.5 MB (loadingStop at ${load.stop} ms; title ready in ${Date.now() - t0} ms; ${(load.after / 1048576).toFixed(2)} MB deferred: ${load.afterNames.join(', ')})`);
  const leak = await page.evaluate(() => ({ hook: typeof window.__fractured, overlay: !!document.getElementById('perf-overlay') }));
  ok(leak.hook === 'undefined' && !leak.overlay, `${tag} no dev hook or perf overlay at runtime ${JSON.stringify(leak)}`);
  await page.screenshot({ path: path.join(SHOTS, `smoke_title_${tag}.png`) });

  // BEGIN DESCENT on a first launch: the cold open over the tutorial room.
  if (touch) await page.tap('#btn-title-begin'); else await page.click('#btn-title-begin');
  await page.waitForTimeout(1200);
  const cold = await page.evaluate(() => !!document.querySelector('#story-coldopen'));
  ok(cold, `${tag} the cold open plays on a first launch`);
  const calls1 = await page.evaluate(() => window.__sdkCalls.map(c => c[0]));
  ok(calls1.includes('init') && calls1.includes('gameplayStart'), `${tag} SDK heard init and gameplayStart (${[...new Set(calls1)].join(',')})`);
  // The first input dismisses it.
  if (touch) await page.tap('#gameCanvas', { position: { x: 60, y: vp.height - 120 } }); else await page.keyboard.press('w');
  await page.waitForTimeout(600);
  const coldGone = await page.evaluate(() => { const c = document.querySelector('#story-coldopen'); return !c || getComputedStyle(c).display === 'none' || getComputedStyle(c).opacity === '0'; });
  ok(coldGone, `${tag} the first input dismisses the cold open`);

  // Play the tutorial with real input and watch its banner advance.
  const seen = new Set();
  const note = async () => { const t = await bannerText(page); if (t) seen.add(t.split('\n')[0]); };
  const end = Date.now() + SECONDS * 1000;
  let i = 0;
  if (touch) {
    const cdp = await ctx.newCDPSession(page);
    const L = (x, y) => [{ x, y, id: 1 }];
    const cx = 90, cy = vp.height - 130;
    while (Date.now() < end) {
      // steer around a circle with the left stick for ~1.2 s
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: L(cx, cy) });
      for (let k = 1; k <= 12; k++) {
        const a = (i * 1.3) + k * 0.25;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: L(cx + Math.cos(a) * 45, cy + Math.sin(a) * 45) });
        await page.waitForTimeout(100);
        if (k % 4 === 0) await note();
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      // a double-tap on the move side: the dash gesture
      for (let k = 0; k < 2; k++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: L(cx, cy) });
        await page.waitForTimeout(50);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(70);
      }
      // and the DASH button when it is there
      await page.evaluate(() => { const b = document.getElementById('btn-dash'); if (b && b.offsetParent) { b.dispatchEvent(new TouchEvent('touchstart', { bubbles: true })); b.dispatchEvent(new TouchEvent('touchend', { bubbles: true })); } }).catch(() => {});
      // a level-up: tap the first card (after the 300 ms mis-tap guard)
      if (await levelUpOpen(page)) { await page.waitForTimeout(350); await page.tap('#cards-container .card').catch(() => {}); await page.waitForTimeout(300); }
      await note(); i++;
    }
  } else {
    const keys = ['w', 'd', 's', 'a'];
    while (Date.now() < end) {
      const k = keys[i % 4];
      await page.keyboard.down(k);
      for (let s = 0; s < 6; s++) {
        const a = i * 0.9 + s * 0.4;
        await page.mouse.move(vp.width / 2 + Math.cos(a) * 250, vp.height / 2 + Math.sin(a) * 200);
        await page.waitForTimeout(150);
      }
      await page.keyboard.up(k);
      await note();
      if (i % 2 === 0) await page.keyboard.press('Space');
      // a level-up mid-tutorial: take the first card
      await page.keyboard.press('1');
      await note(); i++;
    }
  }
  ok(seen.size >= 3, `${tag} the tutorial advanced under real input: ${seen.size} banner lines ${JSON.stringify([...seen].slice(0, 6))}`);
  await page.screenshot({ path: path.join(SHOTS, `smoke_play_${tag}.png`) });

  // Pause: the menu, and gameplayStop. (Close a level-up first: pause waits for it.)
  if (await levelUpOpen(page)) { if (touch) await page.tap('#cards-container .card').catch(() => {}); else await page.keyboard.press('1'); await page.waitForTimeout(400); }
  if (touch) await page.tap('#btn-pause').catch(() => {}); else await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const paused = await page.evaluate(() => { const p = document.getElementById('pause-menu'); return !!p && getComputedStyle(p).display !== 'none'; });
  const calls2 = await page.evaluate(() => window.__sdkCalls.map(c => c[0]));
  ok(paused && calls2.lastIndexOf('gameplayStop') > calls2.lastIndexOf('gameplayStart'), `${tag} pause shows the menu and the SDK heard gameplayStop`);

  const stored = await page.evaluate(() => { try { return localStorage.getItem('fractured_errors'); } catch (e) { return null; } });
  const errCount = stored ? (JSON.parse(stored).length || Object.keys(JSON.parse(stored)).length || 0) : 0;
  ok(errCount === 0, `${tag} ErrorLog stored nothing (${stored ? stored.slice(0, 120) : 'empty'})`);
  ok(errors.length === 0, `${tag} no page errors or console errors ${JSON.stringify(errors.slice(0, 3))}`);
  const foreign = [...hosts].filter(h => !h.startsWith('localhost') && !h.startsWith('127.0.0.1') && h !== 'sdk.crazygames.com');
  ok(foreign.length === 0, `${tag} no other hosts contacted ${JSON.stringify(foreign)}`);
  await ctx.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('building crazygames + playtest bundles ...');
  const cg = build('crazygames');
  const pt = SOAK ? build('playtest') : null;
  const servers = [serve(cg, 5197)];
  if (pt) servers.push(serve(pt, 5196));
  const kill = () => servers.forEach(s => { try { process.kill(-s.pid); } catch (e) {} });
  process.on('exit', kill);
  try {
    ok(await waitUp('http://localhost:5197/'), 'crazygames bundle served by vite preview');
    const browser = await chromium.launch();
    await playCrazyGames(browser, 'http://localhost:5197/', { width: 1280, height: 720 });
    await playCrazyGames(browser, 'http://localhost:5197/', { width: 384, height: 717, touch: true });
    await browser.close();

    if (pt) {
      ok(await waitUp('http://localhost:5196/'), 'playtest bundle served by vite preview');
      let code = 0, out = '';
      try {
        out = execSync('node qa/soak_check.cjs --seconds 45 --throttle 4 --phone --quality low', { cwd: ROOT, env: { ...process.env, FRACTURED_URL: 'http://localhost:5196/' }, stdio: 'pipe' }).toString();
      } catch (e) { code = e.status || 1; out = (e.stdout || '').toString() + (e.stderr || '').toString(); }
      out.split('\n').filter(Boolean).forEach(l => console.log('    ' + l));
      ok(code === 0, 'built playtest bundle: the phone soak (4x throttle, LOW) holds every invariant');
    }
  } finally {
    kill();
    if (!KEEP) fs.rmSync(OUT, { recursive: true, force: true });
  }
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
