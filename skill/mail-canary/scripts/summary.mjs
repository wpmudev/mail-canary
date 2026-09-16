#!/usr/bin/env node
// Counts for the daily digest.
//
// Every state here is COMPUTED from evidence, never read from the stored `status`
// field. A stored status can be older than the thing it claims to describe, and a
// digest built on stale data will cheerfully report a site as healthy long after
// anyone could actually know that.
//
// `all_clear` requires positive, fresh evidence for every single site. The absence
// of an alert is not the same as proof of health.

import { load, minutesSince, currentState, settings } from './lib.mjs';

const cfg = settings();
const grace = cfg.grace_minutes || 10;

const GAP_STATES = {
  unreachable: 'site not responding',
  endpoint_error: 'monitoring stopped, plugin or token problem',
  destination_mismatch: 'sending heartbeats to a different address than we watch',
  stale: 'last check is too old to be meaningful',
};
const BAD_STATES = ['smtp_failed', 'not_delivered'];

// Demo fixtures are included deliberately: the digest is the main thing to screenshot,
// and filtering them made it report 0 sites during a demo. 'demo off' clears them.
const list = load();

const rows = list.map((s) => ({
  site: s.site,
  state: currentState(s, grace),
  mailer: s.mailer || null,
  legacy_plugin: s.legacy_plugin === true,
  destination: s.destination || null,
  expected_destination: s.expected_destination || null,
  last_delivered_minutes_ago: minutesSince(s.last_delivered_at),
  last_ping_minutes_ago: minutesSince(s.last_ping_at),
}));

const healthy = rows.filter((r) => r.state === 'healthy');
const failing = rows.filter((r) => BAD_STATES.includes(r.state));
const gaps = rows.filter((r) => GAP_STATES[r.state])
  .map((r) => ({ ...r, why: GAP_STATES[r.state] }));
const unknown = rows.filter((r) =>
  !['healthy', 'awaiting'].includes(r.state) && !BAD_STATES.includes(r.state) && !GAP_STATES[r.state]);
const awaiting = rows.filter((r) => r.state === 'awaiting');

const lastCheck = list.map((s) => s.last_ping_at).filter(Boolean).sort().pop();

console.log(JSON.stringify({
  monitored: rows.length,
  healthy: healthy.length,
  failing,
  coverage_gaps: gaps,
  unknown,
  awaiting: awaiting.length,
  last_check_minutes_ago: minutesSince(lastCheck),

  // One unambiguous word for the digest to lead with. "all_clear: false" on its own
  // was misleading: an empty list and a site still inside its grace window both looked
  // like something was wrong when nothing was.
  //
  //   no_sites  nothing is being monitored
  //   problems  something is failing or cannot be checked
  //   checking  a heartbeat is still inside its grace window, no verdict yet
  //   all_clear every site verified healthy, on fresh evidence
  verdict: rows.length === 0 ? 'no_sites'
    : (failing.length || gaps.length) ? 'problems'
    : (awaiting.length || unknown.length) ? 'checking'
    : 'all_clear',

  // True only when every site has a fresh, verified healthy result. Not "nothing
  // was flagged" — that is how a site nobody can see gets counted as fine.
  all_clear: rows.length > 0 && healthy.length === rows.length,

  // What to say when all_clear is false but nothing is outright failing.
  verified_of_total: `${healthy.length}/${rows.length}`,

  // Sites still on a plugin build that only speaks GET. Not a fault, but worth one
  // mention so the token stops being written to their access logs.
  outdated_plugins: rows.filter((r) => r.legacy_plugin).map((r) => r.site),

  // Added but never yet pinged. Nothing has failed, so this must not read as a fault.
  not_yet_checked: unknown.map((r) => r.site),
}, null, 2));
