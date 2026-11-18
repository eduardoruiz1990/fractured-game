/**
 * Camera fit, the desktop/portrait split, and the control band (Patch 71).
 *
 * Run with:  node test_viewport.js
 *
 * WHY THIS FILE EXISTS: the portrait layout changes where the camera is centred, how
 * much of the canvas the world is allowed to use, and how far the camera zooms out.
 * All three hang off ONE boolean. If that boolean can ever be true on a desktop, a
 * desktop player gets a phone layout — a band across the bottom of their monitor and
 * a camera pushed off centre — with no setting to turn it off. So the two properties
 * asserted hardest here are:
 *
 *   1. no desktop-shaped viewport can reach the portrait path, and
 *   2. with portraitMode false, updateZoom() computes byte-identical results to the
 *      pre-patch formula. That is the actual guarantee that this change cannot
 *      regress the platform 100% of current players are on.
 *
 * Renderer.updateZoom is driven through the real prototype method on a stub object
 * rather than a constructed Renderer — the constructor needs a live canvas, and the
 * method only ever touches `this.canvas.width/height` and `this.portraitMode`.
 */

import { isPortraitLayout, PORTRAIT_MAX_WIDTH } from './src/core/Layout.js';

global.window = { addEventListener: () => {}, matchMedia: () => ({ matches: false }) };
global.document = { createElement: () => ({ getContext: () => null }), addEventListener: () => {} };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
// Node 22 exposes a getter-only `navigator`, so it is defined rather than assigned.
if (!('maxTouchPoints' in globalThis.navigator)) {
    Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 0 }, configurable: true });
}

const { Renderer } = await import('./src/core/Renderer.js');

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
    if (condition) {
        passed++;
        console.log(`  \x1b[32m✓\x1b[0m ${label}`);
    } else {
        failed++;
        console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
    }
}

/** Runs the REAL updateZoom against a stub, returning everything it publishes. */
const fit = (width, height, portraitMode = false) => {
    const stub = { canvas: { width, height }, portraitMode };
    Renderer.prototype.updateZoom.call(stub);
    return stub;
};

/** The formula exactly as it stood before Patch 71. */
const legacyZoom = (w, h) => Math.max(0.70, Math.min(1.3, Math.min(w / 900, h / 620)));

console.log('\nThe desktop/portrait split');
{
    // The whole safety argument. A desktop must never satisfy this predicate.
    const desktops = [
        ['1920x1080', 1920, 1080], ['1366x768', 1366, 768], ['2560x1440', 2560, 1440],
        ['1280x1024', 1280, 1024], ['a narrow window', 700, 900], ['a very narrow window', 420, 1000]
    ];
    desktops.forEach(([name, w, h]) => {
        check(`mouse, ${name}: stays on the desktop layout`,
              isPortraitLayout({ touch: false, width: w, height: h }) === false);
    });

    check('touch phone in portrait: gets the portrait layout',
          isPortraitLayout({ touch: true, width: 390, height: 844 }) === true);
    check('touch phone in LANDSCAPE: does not',
          isPortraitLayout({ touch: true, width: 844, height: 390 }) === false);
    check('touch tablet in portrait (above the phone width): does not',
          isPortraitLayout({ touch: true, width: 1024, height: 1366 }) === false);
    check(`the width cut-off is ${PORTRAIT_MAX_WIDTH}px`,
          isPortraitLayout({ touch: true, width: PORTRAIT_MAX_WIDTH, height: 1200 }) === true &&
          isPortraitLayout({ touch: true, width: PORTRAIT_MAX_WIDTH + 1, height: 1200 }) === false);

    // Total on rubbish input: this runs inside the resize handler on the boot path.
    check('degenerate viewports do not throw and do not opt in',
          isPortraitLayout({ touch: true, width: 0, height: 0 }) === false &&
          isPortraitLayout({ touch: true, width: NaN, height: 800 }) === false &&
          isPortraitLayout(undefined) === false &&
          isPortraitLayout({}) === false);
}

console.log('\nDesktop camera is untouched by this patch');
{
    [[1920, 1080], [1366, 768], [2560, 1440], [1280, 800], [800, 600]].forEach(([w, h]) => {
        const r = fit(w, h, false);
        // Patch 165: the landscape floor rose from 0.70 to 0.90; above it, unchanged.
        check(`${w}x${h}: zoom matches the pre-patch formula, floored at 0.90`,
              Math.abs(r.zoom - Math.max(0.90, legacyZoom(w, h))) < 1e-12,
              `${r.zoom} vs ${legacyZoom(w, h)}`);
        check(`${w}x${h}: no band, camera on the canvas centre, world uses the whole canvas`,
              r.controlBandH === 0 && r.cameraCenterY === h / 2 &&
              r.cameraCenterX === w / 2 && r.worldViewHeight === h && r.worldViewWidth === w,
              `band ${r.controlBandH}, centreY ${r.cameraCenterY}, viewH ${r.worldViewHeight}`);
    });
}

console.log('\nPortrait band and camera');
{
    [[390, 844], [375, 667], [412, 915], [360, 640]].forEach(([w, h]) => {
        const r = fit(w, h, true);
        check(`${w}x${h}: band is a usable size and never eats the screen`,
              r.controlBandH >= 140 && r.controlBandH <= 300 && r.controlBandH <= h * 0.4,
              `band ${r.controlBandH} of ${h}`);
        check(`${w}x${h}: world viewport plus band accounts for the whole canvas`,
              Math.abs((r.worldViewHeight + r.controlBandH) - h) < 1e-9,
              `${r.worldViewHeight} + ${r.controlBandH} vs ${h}`);
        check(`${w}x${h}: the camera sits above the canvas centre, so thumbs are clear`,
              r.cameraCenterY < h / 2 && r.cameraCenterY === r.worldViewHeight / 2,
              `centreY ${r.cameraCenterY} vs canvas centre ${h / 2}`);
        // Patch 165: the horde camera. Portrait sits just under the landscape floor
        // (0.86 vs 0.90): close enough to read a crowd, a little wider than landscape.
        check(`${w}x${h}: portrait sits at the horde camera's floor`,
              r.zoom < 0.90 && r.zoom >= 0.86, `zoom ${r.zoom}`);
    });

    // The band must not swallow a short screen if portraitMode is ever forced on one.
    const squat = fit(390, 400, true);
    check('a short portrait viewport keeps at least 60% of itself for the world',
          squat.worldViewHeight >= 400 * 0.6, `viewH ${squat.worldViewHeight}`);
}

console.log('\nPortrait draws enemies large enough to read (Patch 165)');
{
    const z = fit(390, 844, true).zoom;
    check('a 12-unit enemy is at least 20px across on a 390px phone',
          24 * z >= 20, `${(24 * z).toFixed(1)}px at zoom ${z}`);
    check('the phone still sees at least 430 world units across',
          390 / z >= 430, `${(390 / z).toFixed(0)} world units`);
}

console.log('\nDegenerate canvas');
{
    // Patch 51d: a zero-sized canvas is a real case (hidden tab, zero-laid-out iframe).
    // updateZoom must publish usable numbers rather than NaN, which would reach
    // createRadialGradient and kill the render loop.
    [[0, 0], [0, 800], [800, 0]].forEach(([w, h]) => {
        const r = fit(w, h, true);
        check(`${w}x${h}: publishes finite, positive geometry`,
              Number.isFinite(r.zoom) && r.zoom > 0 &&
              Number.isFinite(r.cameraCenterX) && Number.isFinite(r.cameraCenterY) &&
              Number.isFinite(r.worldViewWidth) && Number.isFinite(r.worldViewHeight) &&
              r.worldViewWidth > 0 && r.worldViewHeight > 0,
              JSON.stringify({ zoom: r.zoom, cx: r.cameraCenterX, cy: r.cameraCenterY }));
    });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
