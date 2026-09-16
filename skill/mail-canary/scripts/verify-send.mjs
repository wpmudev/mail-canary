#!/usr/bin/env node
// Deterministic verify + daily digest. NO LLM in the loop.
//
// The scheduled jobs used to be agent turns: a model had to run the scripts, search the
// mailbox, and compose the email. A model can silently do none of that while the run
// still reports "ok". A script cannot — it does the whole job or exits non-zero, and the
// run status reflects that.
//
// Usage: node verify-send.mjs [--dry-run]

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { load, settings, currentState, minutesSince, pendingIds, DATA } from './lib.mjs';
import { recentSubjects, sendMail } from './mailbox.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const HERE = path.dirname(fileURLToPath(import.meta.url));

const cfg = settings();
const grace = Number(cfg.grace_minutes) || 10;
const TZ = cfg.timezone || 'UTC';
const MAILBOX = cfg.canary_mailbox;

if (!MAILBOX) {
  console.error(`canary_mailbox is not set in ${path.join(DATA, 'settings.json')}`);
  process.exit(1);
}

/* ---------------------------------------------------------------- helpers */

/**
 * Run a sibling script. A non-zero exit is fatal, always.
 *
 * Swallowing a failure here and carrying on with empty data would produce a digest
 * saying "all clear" built on nothing — which is the exact failure this script exists
 * to eliminate, one layer down.
 */
function run(script, args = []) {
  try {
    return execFileSync('node', [path.join(HERE, script), ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000,
    });
  } catch (e) {
    console.error(`${script} failed (exit ${e.status ?? 1}):\n${(e.stderr ?? e.message ?? '').toString()}`);
    process.exit(1);
  }
}

function runJson(script, args = []) {
  const out = run(script, args);
  try {
    return JSON.parse(out);
  } catch {
    console.error(`${script} produced output that is not JSON:\n${out.slice(0, 400)}`);
    process.exit(1);
  }
}

const fmtTime = (iso) => iso
  ? new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso)).replace(',', ' at')
  : 'unknown';

const fmtClock = (iso) => iso
  ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
      .format(new Date(iso))
  : '??:??';

function rel(iso) {
  if (!iso) return 'never';
  const mins = minutesSince(iso);
  if (mins === null) return 'unknown';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h < 24) return `${h}h ${m}m ago`;
  return `${Math.floor(h / 24)}d ${h % 24}h ago`;
}

const pad = (n) => '  '.repeat(n);

/* ------------------------------------------------- stage 1: what to look for */

const list = load();
const pending = pendingIds(list).map((p) => p.id);

/* ------------------------------------------------- stage 2: search the mailbox */

let subjects;
try {
  subjects = await recentSubjects(MAILBOX);
} catch (e) {
  console.error('Could not read the canary mailbox: ' + e.message);
  process.exit(1);
}

const seen = new Set();
for (const subject of subjects) {
  for (const id of subject.match(/\bmc-[A-Za-z0-9._-]+\b/g) ?? []) seen.add(id);
}
const found = pending.filter((id) => seen.has(id));

/* ------------------------------------------------- stage 3: reconcile and report */

run('verify.mjs', ['--found', found.join(',')]);

const report = runJson('report.mjs');
const summary = runJson('summary.mjs');

console.log(JSON.stringify({
  mailbox: MAILBOX,
  provider: cfg.mail_provider || 'himalaya',
  pending: pending.length,
  found: found.length,
  verdict: summary.verdict,
  dry_run: DRY_RUN,
}, null, 2));

if (summary.verdict === 'no_sites') {
  console.log('Nothing is being monitored. No digest sent.');
  process.exit(0);
}

/* ------------------------------------------------- stage 4: build the digest */

// Counts come from summary.mjs, which computes state from evidence. report.mjs
// de-duplicates states it has already alerted on, so building counts from its alerts
// would wrongly say "all clear" on day two of the same failure.
//
// Coverage gaps come from report.mjs, because only it carries the fields the copy
// needs — reason, error, last_check_at — and only it emits monitoring_stopped.
const bySite = (name) => list.find((x) => x.site === name) ?? {};

const failing = (summary.failing ?? []).map((row) => {
  const s = bySite(row.site);
  return {
    ...row,
    error: s.last_error,
    mailer: s.mailer,
    destination: s.destination,
    last_delivered_at: s.last_delivered_at,
    consecutive_failures: s.consecutive_failures,
  };
});

const gaps = report.coverage_gaps ?? [];
const FAILURE_STATES = new Set(['smtp_failed', 'never_worked', 'not_delivered']);
const recovered = (report.alerts ?? []).filter((a) => !FAILURE_STATES.has(a.state));

const healthySites = list.filter((s) => currentState(s, grace) === 'healthy');
const tracked = summary.monitored ?? list.length;
const nFail = failing.length;
const nGap = gaps.length;

let subject;
if (nFail === 0 && nGap === 0) {
  subject = `[Mail Canary] All ${tracked} sites sending normally`;
} else if (nFail > 0 && nGap === 0) {
  subject = `[Mail Canary] ${nFail} of ${tracked} sites cannot send email`;
} else if (nFail === 0) {
  subject = `[Mail Canary] ${tracked - nGap} of ${tracked} sites checked, ${nGap} could not be reached`;
} else {
  subject = `[Mail Canary] ${nFail} of ${tracked} cannot send email, ${nGap} not being checked`;
}

const lines = [];

if (nFail > 0) {
  lines.push(`${nFail} of ${tracked} sites cannot send email.`, '', 'NEEDS ATTENTION', '');

  failing.forEach((a, i) => {
    const n = i + 1;
    if (a.state === 'smtp_failed') {
      lines.push(`${n}. ${a.site} - WordPress is refusing to send`, '');
      lines.push(`${pad(3)}wp_mail() is returning false, so nothing is leaving the site at all.`);
    } else if (a.state === 'never_worked') {
      lines.push(`${n}. ${a.site} - email has never worked here`, '');
      lines.push(`${pad(3)}This is the first check on this site, and it failed. Nothing has broken: it has not been able to send since it was added.`);
    } else {
      lines.push(`${n}. ${a.site} - accepted but never arrived`, '');
      lines.push(`${pad(3)}WordPress reports the message as sent, but the heartbeat has not turned up. Something is dropping it after handoff.`);
    }
    lines.push('');
    if (a.error) lines.push(`${pad(3)}Error:        ${a.error}`);
    if (a.mailer) lines.push(`${pad(3)}Mailer:       ${a.mailer}`);
    if (a.destination) lines.push(`${pad(3)}Sending to:   ${a.destination}`);
    if (a.last_delivered_at) lines.push(`${pad(3)}Last working: ${rel(a.last_delivered_at)} (${fmtTime(a.last_delivered_at)})`);
    if (a.consecutive_failures > 1) lines.push(`${pad(3)}Misses:       ${a.consecutive_failures} in a row`);
    lines.push('');
    if (a.state === 'never_worked') {
      lines.push(`${pad(3)}What this means: anything the contact form has collected has stayed in the database and never reached an inbox. There may be enquiries nobody ever saw.`);
    } else if (a.state === 'not_delivered') {
      lines.push(`${pad(3)}What this means: messages may be reaching some recipients and not others. Worth asking whether anyone has complained about missing receipts.`);
    } else {
      lines.push(`${pad(3)}What this means: contact form notifications and order emails have not reached anyone since then. Submissions are still being saved, so nothing is lost, but nobody is being told about them.`);
    }
    lines.push('', `${pad(3)}Worth checking: the mailer plugin's SMTP settings on the site. The error above is what the site itself reported.`);
    lines.push('', `${pad(3)}When it is fixed, tomorrow's check will confirm it.`, '');
  });
}

// Recovery is rendered whatever else is happening. Previously this only appeared
// alongside a failure, so good news on an otherwise-clean day was silently dropped.
if (recovered.length > 0) {
  lines.push('BACK TO NORMAL', '');
  for (const a of recovered) {
    lines.push(a.state === 'working_at_last'
      ? `${pad(2)}${a.site} is sending email now. First successful delivery since this site was added.`
      : `${pad(2)}${a.site} is sending email again. Back to normal monitoring.`);
  }
  lines.push('');
}

if (nGap > 0) {
  lines.push('NOT BEING CHECKED', '');
  gaps.forEach((g, i) => {
    const n = nFail + i + 1;
    if (g.state === 'monitoring_stopped') {
      lines.push(`${n}. The scheduled check has not run recently.`, '');
      lines.push(`${pad(3)}Nothing is known to be broken, but the checking itself stopped, so nothing is being verified.`);
      if (g.last_check_at) lines.push(`${pad(3)}Last check:   ${fmtTime(g.last_check_at)}`);
    } else if (g.state === 'destination_mismatch') {
      lines.push(`${n}. ${g.site} - I cannot see this site's heartbeats`, '');
      lines.push(`${pad(3)}The site is sending its heartbeat somewhere I do not watch, so I cannot tell you whether its email is working.`);
      lines.push(`${pad(3)}Sending to:   ${g.destination ?? 'unknown'}`);
      lines.push(`${pad(3)}I watch:      ${MAILBOX}`);
      lines.push('', `${pad(3)}This is not necessarily a fault on the site. On that site, change the Mail Canary destination to ${MAILBOX}.`);
    } else if (g.state === 'endpoint_error') {
      lines.push(`${n}. ${g.site} - monitoring has stopped`, '');
      lines.push(`${pad(3)}The site's Mail Canary endpoint is not answering. The plugin may have been deactivated, updated, or its token regenerated.`);
      if (g.error) lines.push(`${pad(3)}Error:        ${g.error}`);
    } else if (g.state === 'unreachable') {
      lines.push(`${n}. ${g.site} - site not responding`, '');
      lines.push(`${pad(3)}The site itself did not answer. That is a site problem rather than an email one, but it does mean the site is not being monitored while it lasts.`);
    } else {
      lines.push(`${n}. ${g.site} - last check too old to be meaningful`, '');
      lines.push(`${pad(3)}The last check is more than 36 hours old, so whatever it said is no longer a statement about now. Usually means the scheduled job stopped running.`);
    }
    lines.push('');
  });
}

if (nFail === 0 && nGap === 0) {
  lines.push(`All ${tracked} sites are sending email normally.`, '');
  for (const site of healthySites) {
    const secs = site.last_delivered_at && site.last_ping_at
      ? Math.max(0, Math.round((new Date(site.last_delivered_at) - new Date(site.last_ping_at)) / 1000))
      : null;
    lines.push(`${pad(2)}${site.site.padEnd(38)} delivered ${fmtClock(site.last_delivered_at)}${secs !== null ? `, ${secs}s` : ''}`);
  }
  lines.push('', `Checked ${fmtTime(new Date().toISOString())}. Nothing needs doing.`);
} else {
  if (healthySites.length) {
    lines.push('WORKING NORMALLY', '', `${pad(2)}${healthySites.map((s) => s.site).join(', ')}`, '');
  }
  lines.push(`Checked ${fmtTime(new Date().toISOString())}.`);
}

const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';

/* ------------------------------------------------- stage 5: send */

const recipients = String(cfg.notify_email ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (!recipients.length) {
  console.error(`notify_email is not set in ${path.join(DATA, 'settings.json')}`);
  process.exit(1);
}

if (DRY_RUN) {
  console.log('--- DRY RUN, not sending ---');
  console.log('To:      ' + recipients.join(', '));
  console.log('Subject: ' + subject);
  console.log('---\n' + body);
  process.exit(0);
}

// Keyed on the day, not the run. A manual trigger plus the scheduled run should not
// produce two identical digests.
const idemKey = `mailcanary-digest-${new Date().toISOString().slice(0, 10)}`;

let result;
try {
  await sendMail(MAILBOX, { to: recipients, subject, text: body, idemKey });
  result = 'sent';
} catch (first) {
  try {
    await sendMail(MAILBOX, { to: recipients, subject, text: body, idemKey });
    result = 'sent-on-retry';
  } catch (second) {
    fs.mkdirSync(DATA, { recursive: true });
    fs.appendFileSync(path.join(DATA, 'send-errors.log'),
      `${new Date().toISOString()} digest send failed: ${second.message}\n`);
    console.error('Digest could not be sent: ' + second.message);
    process.exit(1);
  }
}

console.log(JSON.stringify({ send: result, subject, to: recipients }, null, 2));
