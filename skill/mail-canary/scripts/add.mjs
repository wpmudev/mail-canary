#!/usr/bin/env node
// Registers a site from the URL its Mail Canary settings page provides.
// Usage: node add.mjs "https://acme.com/wp-json/mail-canary/v1/ping?token=..." ["Acme Ltd"]

import { load, save, find, hostOf } from './lib.mjs';

const url = process.argv[2];
const label = process.argv[3] || null;

const die = (m) => { console.error('ERROR: ' + m); process.exit(1); };

if (!url) die('usage: add.mjs <ping_url> ["label"]');

const host = hostOf(url);
if (!host) die(`"${url}" is not a valid URL`);
if (!/\/mail-canary\/v1\/ping/.test(url)) {
  die('that URL is not a Mail Canary ping endpoint — copy it from Settings → Mail Canary');
}
if (!/[?&]token=/.test(url)) die('that URL has no token — copy the full line from the settings page');

// Split the token out of the pasted URL. The member still pastes one line; we just do
// not store it, or send it, as a query parameter. Query strings end up in the web
// server's access log on every single check, and on shared hosting those are not private.
let endpoint;
let token;
try {
  const u = new URL(url);
  token = u.searchParams.get('token') || '';
  u.searchParams.delete('token');
  endpoint = u.toString();
} catch {
  die('could not parse that URL');
}
if (!token) die('that URL has no token — copy the full line from the settings page');

const list = load();
const existing = find(list, host);

if (existing) {
  existing.endpoint = endpoint;
  existing.token = token;
  delete existing.ping_url;
  if (label) existing.label = label;
  save(list);
  console.log(JSON.stringify({ site: host, updated: true, armed: existing.armed === true }, null, 2));
  process.exit(0);
}

list.push({
  site: host,
  label,
  endpoint,
  token,
  added: new Date().toISOString(),
  // A site is not monitored until one heartbeat has completed the round trip.
  // Alerting that email "broke" on a site whose email never worked is misleading.
  armed: false,
  last_ping_id: null,
  last_ping_at: null,
  last_reachable: null,
  last_wp_mail_returned: null,
  last_error: null,
  last_delivered_id: null,
  last_delivered_at: null,
  mailer: null,
  smtp_host: null,
  destination: null,
  consecutive_failures: 0,
  alerted_state: null,
  demo: false,
  frozen: false,
});

save(list);
console.log(JSON.stringify({
  site: host,
  added: true,
  armed: false,
  next: 'run ping.mjs then verify — the site is not monitored until one heartbeat completes the round trip',
}, null, 2));
