#!/usr/bin/env node
// Lists the heartbeat ids the agent should now search the mailbox for.
// The agent does the IMAP search (himalaya), then feeds results to verify.mjs.
// Usage: node pending.mjs [--grace 10]

import { load, minutesSince, settings, pendingIds } from './lib.mjs';

const args = process.argv.slice(2);
// Must match verify.mjs exactly. If this said 10 while verify used a configured 15,
// the agent would be told to search the mailbox while verify was still waiting.
const grace = Number(args[args.indexOf('--grace') + 1]) || settings().grace_minutes || 10;

const list = load();
const pending = pendingIds(list).map((p) => ({
  site: p.site,
  id: p.id,
  sent_minutes_ago: minutesSince(p.sent_at),
  grace_expired: (minutesSince(p.sent_at) ?? 0) >= grace,
}));

console.log(JSON.stringify({
  grace_minutes: grace,
  pending,
  search_hint: 'Search the canary mailbox (including Junk) for each id. Ids appear in the subject line and in the X-Mail-Canary-Id header. Match the id EXACTLY — an older heartbeat from a previous ping does not count.',
}, null, 2));
