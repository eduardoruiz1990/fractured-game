// Patch 102 (2026-11-15): build TARGET switch — CrazyGames vs itch.io.
//
// The target is the Vite MODE:
//   npm run build            -> --mode crazygames   (the v2 CrazyGames submission)
//   npm run build:itch       -> --mode itch         (self-hosted, no portal)
//   npm run dev              -> development         (no portal; unchanged behaviour)
//   npm run dev:crazygames   -> --mode crazygames   (SDK present on localhost)
//
// The ONLY thing the target changes is whether index.html carries the CrazyGames
// SDK v3 <script> tag. Everything else is decided at RUNTIME by PortalSDK._probe():
// no tag -> no window.CrazyGames -> `available === false` -> every portal method is
// a no-op and storage falls through to localStorage. Keeping the switch to one tag
// means there is no second code path to drift.
//
// Why `dev` stays tag-free: with the tag present, LIVE_ENVIRONMENTS includes 'local',
// so on localhost `available` is TRUE and requestAd() renders the SDK's
// "midgame ad would appear here" placeholder on the death screen. That is what you
// want when testing ads (dev:crazygames), and noise when working on anything else.
const CRAZYGAMES_SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

// Patch 159: the build id (src/data/Build.js) — version, target and commit.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
function buildId(mode) {
  let version = '0.0.0', sha = 'nogit';
  try { version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version; } catch (e) {}
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || sha;
    // A build of uncommitted changes is not that commit: say so.
    if (execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()) sha += '+dirty';
  } catch (e) {}
  return `${version}-${mode}-${sha}`;
}

function portalSdkTag(mode) {
  return {
    name: 'fractured-portal-sdk-tag',
    transformIndexHtml(html) {
      if (mode !== 'crazygames') return html;
      // A classic (non-module) script in <head> blocks parsing, so window.CrazyGames
      // exists before /src/main.js (a deferred module script) runs PortalSDK.init().
      return {
        html,
        tags: [{ tag: 'script', attrs: { src: CRAZYGAMES_SDK_URL }, injectTo: 'head' }]
      };
    }
  };
}

export default ({ mode }) => ({
  base: './',
  define: { __FRACTURED_BUILD__: JSON.stringify(buildId(mode)) },
  plugins: [portalSdkTag(mode)]
});
