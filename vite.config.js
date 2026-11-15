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
  plugins: [portalSdkTag(mode)]
});
