// src/data/Build.js
//
// Patch 159: which build this is, e.g. "2.0.0-crazygames-02ff6c4". Vite replaces
// __FRACTURED_BUILD__ at build time (vite.config.js: package.json version, the build
// mode, and the git commit). It is sent with the portal feedback context and shown in
// Settings, so a player report can be matched to the exact upload. Outside Vite (the
// Node test scripts) the name is undefined, and this reads 'dev'.
/* global __FRACTURED_BUILD__ */
export const BUILD_ID = (typeof __FRACTURED_BUILD__ === 'string' && __FRACTURED_BUILD__) ? __FRACTURED_BUILD__ : 'dev';
