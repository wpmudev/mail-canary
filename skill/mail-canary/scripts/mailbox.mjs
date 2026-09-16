// Mail transport. Two providers, no npm dependencies.
//
//   agentmail  REST API. Set mail_provider: "agentmail" and an API key.
//   himalaya   Any IMAP/SMTP mailbox, via the himalaya CLI bundled with OpenClaw.
//              Set mail_provider: "himalaya". This is the default.
//
// Both expose the same two operations: list recent subjects, and send a message.
// Nothing else in the skill knows or cares which is in use.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { settings, DATA } from './lib.mjs';

const cfg = settings();

/** Resolve the AgentMail key from env, settings, or a configured env file. */
function agentmailKey() {
  if (process.env.AGENTMAIL_API_KEY) return process.env.AGENTMAIL_API_KEY.trim();
  if (cfg.agentmail_api_key) return String(cfg.agentmail_api_key).trim();

  const envFile = cfg.env_file;
  if (envFile && fs.existsSync(envFile)) {
    const line = fs.readFileSync(envFile, 'utf8')
      .split(/\r?\n/).find((l) => /^\s*AGENTMAIL_API_KEY\s*=/.test(l));
    if (line) return line.replace(/^\s*AGENTMAIL_API_KEY\s*=\s*/, '').trim().replace(/^["']|["']$/g, '');
  }
  throw new Error(
    'No AgentMail API key. Set AGENTMAIL_API_KEY in the environment, or agentmail_api_key / env_file in ' +
    path.join(DATA, 'settings.json')
  );
}

async function agentmailApi(method, pathname, body, idemKey) {
  const res = await fetch('https://api.agentmail.to/v0' + pathname, {
    method,
    headers: {
      Authorization: 'Bearer ' + agentmailKey(),
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(idemKey ? { 'Idempotency-Key': idemKey } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`AgentMail ${method} ${pathname} failed (${res.status}): ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

function himalaya(args, input) {
  return execFileSync('himalaya', args, {
    encoding: 'utf8',
    input,
    timeout: 60_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Subjects of recent messages in the canary mailbox.
 *
 * Paginated deliberately: at fifty sites the mailbox accumulates fast, and a single
 * page of 100 would silently drop the current run's heartbeats off the end — every
 * site would then report as not-delivered.
 */
export async function recentSubjects(mailbox, { pages = 5, perPage = 100 } = {}) {
  const provider = (cfg.mail_provider || 'himalaya').toLowerCase();
  const subjects = [];

  if (provider === 'agentmail') {
    const box = encodeURIComponent(mailbox);
    for (let page = 0; page < pages; page++) {
      const res = await agentmailApi('GET', `/inboxes/${box}/messages?limit=${perPage}&offset=${page * perPage}`);
      const msgs = Array.isArray(res) ? res : (res.messages ?? res.data ?? []);
      if (!msgs.length) break;
      for (const m of msgs) subjects.push(String(m.subject ?? ''));
      if (msgs.length < perPage) break;
    }
    return subjects;
  }

  // himalaya: list envelopes as JSON. Check Junk as well as Inbox, because a
  // heartbeat filtered into spam has still been delivered.
  for (const folder of cfg.mail_folders || ['INBOX', 'Junk']) {
    try {
      const out = himalaya(['envelope', 'list', '-f', folder, '-o', 'json', '-s', String(pages * perPage)]);
      const rows = JSON.parse(out);
      for (const r of rows) subjects.push(String(r.subject ?? ''));
    } catch {
      // A folder that does not exist is not an error — plenty of mailboxes have no Junk.
    }
  }
  return subjects;
}

/**
 * Send a plain-text message from the canary mailbox.
 * `idemKey` prevents a double-send when the same digest runs twice in a day.
 */
export async function sendMail(mailbox, { to, subject, text, idemKey }) {
  const provider = (cfg.mail_provider || 'himalaya').toLowerCase();
  const recipients = Array.isArray(to) ? to : [to];

  if (provider === 'agentmail') {
    await agentmailApi(
      'POST',
      `/inboxes/${encodeURIComponent(mailbox)}/messages/send`,
      { to: recipients, subject, text },
      idemKey
    );
    return;
  }

  const raw = [
    `From: ${mailbox}`,
    `To: ${recipients.join(', ')}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    text,
  ].join('\n');

  himalaya(['message', 'send'], raw);
}
