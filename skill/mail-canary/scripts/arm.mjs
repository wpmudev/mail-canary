#!/usr/bin/env node
// Arms a site whose first check failed, when the member chooses to monitor it anyway.
// Usage: node arm.mjs acme.com
//
// Normally a site is armed automatically by verify.mjs on its first healthy round trip.
// This exists for the case in setup: the first check fails, the member says "monitor it
// anyway", and that has to be recordable without hand-editing the data file.

import { load, save, find, currentState, settings } from './lib.mjs';

const key = process.argv[2];
if (!key) { console.error('ERROR: usage: arm.mjs <site>'); process.exit(1); }

const list = load();
const site = find(list, key);
if (!site) { console.error(`ERROR: not tracking ${key}`); process.exit(1); }

if (site.armed) {
  console.log(JSON.stringify({ site: site.site, armed: true, already: true }));
  process.exit(0);
}

site.armed = true;
site.armed_at = new Date().toISOString();
// Remembered so a later recovery reads as "this finally started working" rather than
// "this broke and came back", which would be wrong.
site.armed_in_failed_state = currentState(site, settings().grace_minutes || 10) !== 'healthy';

save(list);

console.log(JSON.stringify({
  site: site.site,
  armed: true,
  armed_in_failed_state: site.armed_in_failed_state,
  status: currentState(site, settings().grace_minutes || 10),
}, null, 2));
