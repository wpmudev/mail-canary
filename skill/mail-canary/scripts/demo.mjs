#!/usr/bin/env node
// Demo states for screenshots. Fixtures are frozen — ping.mjs skips them, so they
// hold still. Real sites are untouched by every scene.
//
//   node demo.mjs list | <scene> | journey | off

import { load, save, MINUTE } from './lib.mjs';

const ago = (mins) => new Date(Date.now() - mins * MINUTE).toISOString();

const mk = (site, o = {}) => ({
  site,
  label: o.label ?? null,
  endpoint: `https://${site}/wp-json/mail-canary/v1/ping`,
  token: 'demo',
  added: ago(60 * 24 * 7),
  demo: true,
  frozen: true,
  armed: o.armed ?? true,
  status: o.status,
  last_ping_id: `mc-${site.replace(/\W+/g, '-')}-demo`,
  last_ping_at: ago(o.pingedMinsAgo ?? 12),
  last_reachable: o.reachable ?? true,
  last_ping_ok: o.pingOk ?? (o.reachable !== false),
  destination_ok: o.destinationOk ?? true,
  expected_destination: o.expectedDestination ?? 'canary@youragency.com',
  last_wp_mail_returned: o.wpMail ?? true,
  last_error: o.error ?? null,
  last_delivered_id: o.delivered ? `mc-${site.replace(/\W+/g, '-')}-demo` : null,
  last_delivered_at: o.delivered ? ago(11) : (o.lastDeliveredMinsAgo ? ago(o.lastDeliveredMinsAgo) : null),
  mailer: o.mailer ?? 'WP Mail SMTP',
  smtp_host: o.smtpHost ?? 'smtp.sendgrid.net',
  destination: o.destination ?? 'canary@youragency.com',
  consecutive_failures: o.fails ?? 0,
  alerted_state: o.alerted ?? null,
});

const HEALTHY = [
  mk('youragency.com', { label: 'PixelTrail', status: 'healthy', delivered: true }),
  mk('northgatedental.co.uk', { label: 'Northgate Dental', status: 'healthy', delivered: true, mailer: 'FluentSMTP', smtpHost: 'smtp.mailgun.org' }),
  mk('millerandco.com', { label: 'Miller & Co', status: 'healthy', delivered: true, mailer: 'none detected (PHP mail())', smtpHost: null }),
];

const SCENES = {
  reset: { what: 'Nothing tracked yet.', entries: () => [] },

  healthy: {
    what: 'Three sites, all delivering. The skill stays silent.',
    entries: () => HEALTHY,
  },

  'smtp-broken': {
    what: 'wp_mail() returned false — broken inside WordPress. Known instantly, no waiting.',
    entries: () => [
      mk('acmedental.com', {
        label: 'Acme Dental', status: 'smtp_failed', wpMail: false, fails: 1,
        error: 'SMTP Error: 401 Unauthorized — the API key was rejected',
        mailer: 'WP Mail SMTP', smtpHost: 'smtp.sendgrid.net',
        lastDeliveredMinsAgo: 60 * 24 * 3,
      }),
      ...HEALTHY.slice(0, 2),
    ],
  },

  'not-delivered': {
    what: 'WordPress said it sent, but nothing arrived. Two strikes — this is the ambiguous one.',
    entries: () => [
      mk('shopfront.co', {
        label: 'Shopfront', status: 'not_delivered', wpMail: true, fails: 2,
        mailer: 'WP Mail SMTP', smtpHost: 'smtp-relay.gmail.com',
        lastDeliveredMinsAgo: 60 * 30,
      }),
      ...HEALTHY.slice(0, 2),
    ],
  },

  'one-strike': {
    what: 'A single miss. Not alerted yet — one miss can be a slow relay.',
    entries: () => [
      mk('shopfront.co', { label: 'Shopfront', status: 'not_delivered', wpMail: true, fails: 1 }),
      ...HEALTHY.slice(0, 2),
    ],
  },

  'plugin-removed': {
    what: 'Endpoint 404 — plugin deactivated. Monitoring has stopped; must never look healthy.',
    entries: () => [
      mk('acmedental.com', {
        label: 'Acme Dental', status: 'endpoint_error', pingOk: false, fails: 2,
        error: 'endpoint returned HTTP 404',
        delivered: true, // stale success from before the plugin was removed
        lastDeliveredMinsAgo: 60 * 26,
      }),
      ...HEALTHY.slice(0, 2),
    ],
  },

  'destination-mismatch': {
    what: 'Site is sending heartbeats to a different address than we watch. We cannot see them, so we cannot call it healthy.',
    entries: () => [
      mk('wp2445.example.com', {
        label: 'Old Client Site', status: 'destination_mismatch',
        destinationOk: false, destination: 'support@someoneelse.com',
        expectedDestination: 'canary@youragency.com', fails: 2,
        delivered: true, lastDeliveredMinsAgo: 60 * 35,
      }),
      ...HEALTHY.slice(0, 2),
    ],
  },

  stale: {
    what: 'Last check is 40 hours old. Whatever it said then is not a statement about now.',
    entries: () => [
      mk('forgotten.example.com', {
        label: 'Forgotten', status: 'healthy', delivered: true,
        pingedMinsAgo: 60 * 40, fails: 0,
      }),
      ...HEALTHY.slice(0, 2),
    ],
  },

  'site-down': {
    what: 'Site unreachable. Deliberately NOT an email alert — a different problem.',
    entries: () => [
      mk('oldclient.net', {
        label: 'Old Client', status: 'unreachable', reachable: false, wpMail: null, fails: 2,
        error: 'site did not respond within 20s',
      }),
      ...HEALTHY.slice(0, 2),
    ],
  },

  'never-worked': {
    what: 'Newly added site whose email has never once arrived. The takeover moment.',
    entries: () => [
      mk('inherited.co.uk', {
        label: 'Inherited Site', status: 'smtp_failed', armed: false, wpMail: false, fails: 1,
        error: 'Could not authenticate. SMTP username and password not accepted.',
        mailer: 'Easy WP SMTP', smtpHost: 'mail.inherited.co.uk',
      }),
      ...HEALTHY.slice(0, 2),
    ],
  },

  recovered: {
    what: 'Was broken, now delivering again. One confirmation message, then silence.',
    entries: () => [
      mk('acmedental.com', {
        label: 'Acme Dental', status: 'healthy', delivered: true, alerted: 'smtp_failed',
      }),
      ...HEALTHY.slice(0, 2),
    ],
  },

  mixed: {
    what: 'Everything at once — the batched alert. Best single screenshot.',
    entries: () => [
      mk('acmedental.com', {
        label: 'Acme Dental', status: 'smtp_failed', wpMail: false, fails: 1,
        error: 'SMTP Error: 401 Unauthorized — the API key was rejected',
        smtpHost: 'smtp.sendgrid.net', lastDeliveredMinsAgo: 60 * 24 * 3,
      }),
      mk('shopfront.co', {
        label: 'Shopfront', status: 'not_delivered', wpMail: true, fails: 2,
        smtpHost: 'smtp-relay.gmail.com', lastDeliveredMinsAgo: 60 * 30,
      }),
      mk('oldclient.net', {
        label: 'Old Client', status: 'unreachable', reachable: false, wpMail: null, fails: 2,
        error: 'site did not respond within 20s',
      }),
      HEALTHY[0],
    ],
  },
};

const JOURNEY = [
  ['reset', '/mail-canary list', 'Empty — nothing tracked'],
  ['reset', '/mail-canary add <url from the plugin>', 'Adding a site by pasting one URL'],
  ['healthy', '/mail-canary list', 'Three sites, all healthy'],
  ['healthy', '/mail-canary check', 'Nothing wrong — the skill stays silent'],
  ['one-strike', '/mail-canary check', 'One miss, deliberately not alerted yet'],
  ['smtp-broken', '/mail-canary check', 'wp_mail() failed — instant, with the real error'],
  ['not-delivered', '/mail-canary check', 'Sent but never arrived — two strikes'],
  ['plugin-removed', '/mail-canary check', 'Plugin deactivated — monitoring stopped, reported as a coverage gap'],
  ['destination-mismatch', '/mail-canary check', 'Heartbeats going somewhere we cannot see, never counted as healthy'],
  ['stale', '/mail-canary check', 'A check too old to trust, reported as a gap not as health'],
  ['site-down', '/mail-canary check', 'Site down, correctly NOT reported as email failure'],
  ['never-worked', '/mail-canary check', 'A newly inherited site whose email never worked'],
  ['mixed', '/mail-canary check', 'Batched alert with every state at once'],
  ['recovered', '/mail-canary check', 'Recovery confirmation'],
];

const [cmd] = process.argv.slice(2);

if (!cmd || cmd === 'list') {
  console.log('Scenes:\n');
  for (const [n, s] of Object.entries(SCENES)) console.log(`  ${n.padEnd(16)} ${s.what}`);
  console.log('\n  journey          ordered blog walkthrough');
  console.log('  off              remove demo data, keep real sites');
  process.exit(0);
}

if (cmd === 'journey') {
  console.log('Walkthrough — load the scene, send the command, screenshot.\n');
  JOURNEY.forEach(([scene, command, caption], i) => {
    console.log(`${String(i + 1).padStart(2)}. scene: ${scene}\n    send:  ${command}\n    shot:  ${caption}\n`);
  });
  process.exit(0);
}

if (cmd === 'off') {
  const kept = load().filter((s) => !s.demo);
  save(kept);
  console.log(`demo data removed — ${kept.length} real site(s) kept`);
  process.exit(0);
}

const scene = SCENES[cmd];
if (!scene) { console.error(`ERROR: unknown scene "${cmd}". Run: node demo.mjs list`); process.exit(1); }

const real = load().filter((s) => !s.demo);
const entries = scene.entries();
save([...real, ...entries]);

console.log(JSON.stringify({
  scene: cmd, what: scene.what, seeded: entries.length, real_sites_kept: real.length,
  next: 'run report.mjs (or /mail-canary check) to see this state',
}, null, 2));
