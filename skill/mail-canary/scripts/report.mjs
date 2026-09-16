#!/usr/bin/env node
// Returns what should be said right now, split into two kinds.
// Usage: node report.mjs [--force]
//
//   alerts         email is broken on a site we are successfully monitoring
//   coverage_gaps  we have STOPPED being able to check a site — the plugin was removed,
//                  the token changed, the site is down. Not an email fault, but it must
//                  never pass silently: a monitor that quietly stops monitoring is the
//                  exact failure this tool exists to prevent.
//
// Alerting policy:
//   smtp_failed     alert on the FIRST failure — wp_mail() said no, nothing ambiguous
//   not_delivered   alert on the SECOND consecutive failure — one miss can be a slow relay
//   endpoint_error  report as a coverage gap after 2 consecutive failures
//   unreachable     report as a coverage gap after 2 consecutive failures
//   never verified  alert once, worded differently — this email never worked

import { load, save, currentState, settings } from './lib.mjs';

const grace = settings().grace_minutes || 10;

const force = process.argv.includes('--force');

const COVERAGE_STATES = {
  endpoint_error: 'monitoring stopped',
  unreachable: 'site not responding',
  destination_mismatch: 'heartbeats going to an address we do not watch',
  stale: 'last check too old to be meaningful',
};

const list = load();
const alerts = [];
const coverage_gaps = [];
const skipped = [];

// If EVERY site is stale, the scheduled check has stopped running. That is one fact
// about the monitor, not N facts about N sites. Reporting it per-site would be both
// noisy and wrong: nothing is known to be broken, the checking simply stopped.
const states = list.map((s) => currentState(s, grace));
const allStale = list.length > 0 && states.every((st) => st === 'stale');

for (const s of list) {
  // Computed, never the stored field. A stored status outlives its evidence.
  const state = currentState(s, grace);

  if (!state || state === 'awaiting' || state === 'never_checked') {
    skipped.push({ site: s.site, why: state || 'no data' });
    continue;
  }

  if (state === 'healthy') {
    if (s.alerted_state && s.alerted_state !== 'healthy') {
      alerts.push({
        site: s.site, label: s.label,
        state: s.armed_in_failed_state ? 'working_at_last' : 'recovered',
        mailer: s.mailer, destination: s.destination,
      });
      if (!force) { s.alerted_state = 'healthy'; s.armed_in_failed_state = false; }
    }
    continue;
  }

  // Suppressed when every site is stale — reported once below instead.
  if (state === 'stale' && allStale) {
    skipped.push({ site: s.site, why: 'stale, but every site is — reported as monitoring_stopped' });
    continue;
  }

  // Coverage gaps — we cannot check this site at all
  if (COVERAGE_STATES[state]) {
    // A wrong destination or a stale check is a fact about configuration, not a flaky
    // network. There is nothing transient to wait out, so report on the first sight.
    const gapThreshold = (state === 'destination_mismatch' || state === 'stale') ? 0 : 2;
    if (!force && (s.consecutive_failures || 0) < gapThreshold) {
      skipped.push({ site: s.site, why: `${s.consecutive_failures || 0}/${gapThreshold} — waiting before reporting ${state}` });
      continue;
    }
    if (!force && s.alerted_state === state) {
      skipped.push({ site: s.site, why: 'already reported this coverage gap' });
      continue;
    }
    coverage_gaps.push({
      site: s.site, label: s.label, state,
      reason: COVERAGE_STATES[state],
      error: s.last_error,
      destination: s.destination || null,
      expected_destination: s.expected_destination || null,
      mailer: s.mailer || null,
      consecutive_failures: s.consecutive_failures || 0,
      last_delivered_at: s.last_delivered_at,
    });
    if (!force) s.alerted_state = state;
    continue;
  }

  // A site that never completed a round trip is a different message from one that
  // used to work and broke.
  const kind = s.armed && !s.armed_in_failed_state ? state : 'never_worked';

  const threshold = state === 'smtp_failed' ? 1 : 2;
  if (!force && (s.consecutive_failures || 0) < threshold) {
    skipped.push({ site: s.site, why: `${s.consecutive_failures || 0}/${threshold} failures — waiting` });
    continue;
  }
  if (!force && s.alerted_state === kind) {
    skipped.push({ site: s.site, why: 'already alerted for this state' });
    continue;
  }

  alerts.push({
    site: s.site,
    label: s.label,
    state: kind,
    consecutive_failures: s.consecutive_failures || 0,
    wp_mail_returned: s.last_wp_mail_returned,
    error: s.last_error,
    destination: s.destination || null,
    expected_destination: s.expected_destination || null,
    mailer: s.mailer,
    smtp_host: s.smtp_host,
    last_delivered_at: s.last_delivered_at,
  });

  if (!force) s.alerted_state = kind;
}

if (allStale) {
  const oldest = list
    .map((s) => s.last_ping_at)
    .filter(Boolean)
    .sort()[0] || null;

  coverage_gaps.push({
    site: null,
    state: 'monitoring_stopped',
    reason: 'the scheduled check has not run recently',
    sites_affected: list.length,
    last_check_at: oldest,
    note: 'Nothing is known to be broken. The checking itself stopped, so nothing is being verified.',
  });
}

if (!force) save(list);

const order = { smtp_failed: 0, never_worked: 1, not_delivered: 2, working_at_last: 3, recovered: 4 };
alerts.sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9));

console.log(JSON.stringify({ tracked: list.length, alerts, coverage_gaps, skipped }, null, 2));
