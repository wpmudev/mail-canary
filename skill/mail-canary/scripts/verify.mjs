#!/usr/bin/env node
// Reconciles the mailbox search against what was sent, and decides each site's state.
// Usage: node verify.mjs --found "mc-acme-com-123-abc,mc-shop-456-def" [--grace 10]
//        node verify.mjs --found ""        (nothing arrived)
//
// Only exact id matches count. A heartbeat from an earlier ping has a different id
// and is ignored, so a stale message can never make a broken site look healthy.

import { load, save, verdict, minutesSince, settings } from './lib.mjs';

const args = process.argv.slice(2);
// Falls back to the configured grace, not a hardcoded 10, so verify and report never
// disagree about whether a site is still inside its window.
const grace = Number(args[args.indexOf('--grace') + 1]) || settings().grace_minutes || 10;

if (!args.includes('--found')) {
  console.error('ERROR: usage: verify.mjs --found "id1,id2" [--grace 10]   (use "" for none)');
  process.exit(1);
}

const found = new Set(
  String(args[args.indexOf('--found') + 1] || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
);

const list = load();
const now = new Date().toISOString();
const changes = [];

for (const site of list) {
  // A site that was pinged but did not answer — or whose endpoint errored — still
  // needs a recorded state even without a heartbeat id, otherwise it shows as
  // "never checked" and the member has no idea coverage has stopped.
  if (!site.last_ping_id && site.last_reachable !== false && site.last_ping_ok !== false
      && site.destination_ok !== false) continue;

  const delivered = found.has(site.last_ping_id);
  if (delivered) {
    site.last_delivered_id = site.last_ping_id;
    site.last_delivered_at = now;
  }

  const state = verdict(site, grace);
  if (state === 'awaiting') continue; // still inside the window, decide nothing yet

  const previous = site.status || null;
  site.status = state;

  if (state === 'healthy') {
    site.consecutive_failures = 0;
    if (!site.armed) {
      site.armed = true;
      site.armed_at = now;
    }
  } else if (state !== 'never_checked') {
    // "Consecutive" means consecutive failures of THIS kind. Carrying a count over from
    // a different failure would let a first miss trip a two-strike threshold — a site
    // that was unreachable for days would alert on its very first delivery miss.
    const sameKind = previous === state;
    site.consecutive_failures = (sameKind ? (site.consecutive_failures || 0) : 0) + 1;
  }

  changes.push({
    site: site.site,
    was: previous,
    now: state,
    armed: site.armed === true,
    consecutive_failures: site.consecutive_failures || 0,
    minutes_since_ping: minutesSince(site.last_ping_at),
  });
}

save(list);

console.log(JSON.stringify({ grace_minutes: grace, matched: found.size, changes }, null, 2));
