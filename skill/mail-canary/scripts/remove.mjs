#!/usr/bin/env node
// Stops tracking a site.
// Usage: node remove.mjs acme.com

import { load, save, find } from './lib.mjs';

const key = process.argv[2];
if (!key) { console.error('ERROR: usage: remove.mjs <site>'); process.exit(1); }

const list = load();
const site = find(list, key);
if (!site) { console.error(`ERROR: not tracking ${key}`); process.exit(1); }

save(list.filter((s) => s !== site));
console.log(JSON.stringify({ site: site.site, removed: true }));
