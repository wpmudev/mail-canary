#!/usr/bin/env node
// Asks each site to send a heartbeat, and records what happened locally.
// Usage: node ping.mjs [--all | <site>] [--include-unarmed]
//
// Prints the per-site outcome. Sites where wp_mail() returned false are already
// known-broken at this point — no waiting required.

import { load, save, find, ping, settings } from './lib.mjs';

const expectedMailbox = (settings().canary_mailbox || '').trim().toLowerCase();

const args = process.argv.slice(2);
const all = args.includes('--all') || args.length === 0;
const includeUnarmed = args.includes('--include-unarmed');
const target = args.find((a) => !a.startsWith('--'));

const list = load();

let sites;
if (all) {
  sites = list.filter((s) => !s.frozen && (includeUnarmed || s.armed));
} else {
  const one = find(list, target);
  if (!one) { console.error(`ERROR: not tracking ${target}`); process.exit(1); }
  if (one.frozen) { console.error(`ERROR: ${one.site} is demo data`); process.exit(1); }
  sites = [one];
}

const results = [];

for (let i = 0; i < sites.length; i += 4) {
  await Promise.all(sites.slice(i, i + 4).map(async (site) => {
    const r = await ping(site);

    site.last_ping_at = new Date().toISOString();
    site.last_reachable = r.reachable;
    // Whether the endpoint itself succeeded. A 404/403/500 leaves last_ping_id holding
    // the PREVIOUS run's id, so this flag is what stops a stale match reporting a site
    // whose plugin was removed as healthy.
    site.last_ping_ok = r.reachable && r.ok;

    if (r.reachable && r.ok) {
      site.last_ping_id = r.id;
      site.last_wp_mail_returned = r.wp_mail_returned;
      site.last_error = r.error || null;
      site.mailer = r.mailer || site.mailer;
      site.smtp_host = r.smtp_host || null;
      site.destination = r.destination || site.destination;

      // The site tells us where it sent the heartbeat. If that is not the mailbox we
      // watch, we will never find it, and "not found" would wrongly read as a delivery
      // failure. Worse, an older stored 'healthy' would go on standing forever.
      const dest = (r.destination || '').trim().toLowerCase();
      site.destination_ok = expectedMailbox ? dest === expectedMailbox : null;
      site.expected_destination = expectedMailbox || null;

      // Answered on GET because the installed plugin predates POST support. Works, but
      // means the token is going into that site’s access logs on every check.
      site.legacy_plugin = r.legacy_plugin === true;
    } else {
      site.last_error = r.error || 'ping failed';
      if (!r.reachable) site.last_wp_mail_returned = null;
    }

    results.push({
      site: site.site,
      reachable: r.reachable,
      wp_mail_returned: r.reachable && r.ok ? r.wp_mail_returned : null,
      id: r.id || null,
      destination_ok: site.destination_ok,
      legacy_plugin: site.legacy_plugin === true,
      destination: r.destination || null,
      expected_destination: expectedMailbox || null,
      mailer: r.mailer || null,
      smtp_host: r.smtp_host || null,
      error: site.last_error,
    });
  }));
}

save(list);

console.log(JSON.stringify({
  pinged: results.length,
  results,
  next: 'wait for the grace window, then search the mailbox for these ids and run verify.mjs',
}, null, 2));
