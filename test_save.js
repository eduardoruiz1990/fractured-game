import { SaveManager } from './src/core/SaveManager.js';

let storage = {};
global.localStorage = {
    getItem: (k) => storage[k] || null,
    setItem: (k, v) => { storage[k] = v; }
};
global.window = { location: { reload: () => {} } };

const s1 = new SaveManager();
s1.addLucidity(100);
s1.buyUpgrade('hp', 50);
s1.addTokenToInventory('twitch', 'common');

console.log("Storage after s1:", storage['fractured_meta']);

const s2 = new SaveManager();
console.log("s2 metaState:", s2.metaState);
