#!/usr/bin/env node
// Shows every tracked site, worst state first.

import { load, minutesSince, currentState, settings } from './lib.mjs';

const grace = settings().grace_minutes || 10;

const RANK = {
  smtp_failed: 0, not_delivered: 1, destination_mismatch: 2, endpoint_error: 3,
  stale: 4, never_checked: 5, unreachable: 6, awaiting: 7, healthy: 8,
};

const rows = load().map((s) => ({
  site: s.site,
  label: s.label || null,
  armed: s.armed === true,
  // Computed from evidence, never the stored field — a stored status can be older
  // than the thing it claims to describe.
  status: currentState(s, grace),
  stored_status: s.status || null,
  destination: s.destination || null,
  destination_ok: s.destination_ok ?? null,
  legacy_plugin: s.legacy_plugin === true,
  expected_destination: s.expected_destination || null,
  mailer: s.mailer,
  smtp_host: s.smtp_host,
  last_error: s.last_error,
  consecutive_failures: s.consecutive_failures || 0,
  last_ping_minutes_ago: minutesSince(s.last_ping_at),
  last_delivered_minutes_ago: minutesSince(s.last_delivered_at),
  demo: s.demo === true,
}));

rows.sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9));

console.log(JSON.stringify(rows, null, 2));
