// Shared storage and helpers for mail-canary.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MINUTE = 60_000;

// Locate the agent workspace by walking up for AGENTS.md, starting from this file.
// Never depend on cwd — the agent may run these scripts from anywhere.
function findWorkspace() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'AGENTS.md'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return process.cwd();
}

export const DATA = process.env.MAILCANARY_DATA || path.join(findWorkspace(), 'mail-canary-data');
export const FILE = path.join(DATA, 'sites.json');
export const SETTINGS = path.join(DATA, 'settings.json');

// A verdict must never outlive its evidence. Anything older than this is not a
// statement about now, whatever it used to say.
export const STALE_AFTER_HOURS = 36;

export function settings() {
  if (!fs.existsSync(SETTINGS)) return {};
  try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { return {}; }
}

export function load() {
  if (!fs.existsSync(FILE)) return [];
  let list;
  try { list = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
  return list.map(migrate);
}

/**
 * Split a legacy token-in-URL entry into endpoint + token.
 *
 * The token used to live in the query string, which meant it was written into the web
 * server's access log on every check. On shared or multi-tenant hosting those logs are
 * not private, so the token is stored separately and sent in an X-Mail-Canary-Token
 * header instead. It never appears in a URL after setup.
 */
function migrate(site) {
  if (site.endpoint && site.token) return site;
  if (!site.ping_url) return site;

  try {
    const u = new URL(site.ping_url);
    const token = u.searchParams.get('token') || '';
    u.searchParams.delete('token');
    return { ...site, endpoint: u.toString(), token, ping_url: undefined };
  } catch {
    return site;
  }
}

export function save(list) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

export function find(list, key) {
  const k = String(key).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return list.find((s) => s.site === k || s.label?.toLowerCase() === String(key).toLowerCase());
}

export const hostOf = (url) => {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return null; }
};

export const minutesSince = (iso) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / MINUTE) : null;

/**
 * Call a site's ping endpoint. Never throws — an unreachable site is a result,
 * not a crash, and must be distinguishable from an email failure.
 */
export async function ping(site) {
  if (!site.endpoint || !site.token) {
    return { reachable: false, ok: false, error: 'no endpoint or token stored for this site' };
  }

  // Token in a header, not the URL and not the body. Plugin 1.1.0 and later read the
  // header first; the body is kept so sites still on 1.0.0 keep working.
  const post = () => fetch(site.endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-mail-canary-token': site.token,
    },
    body: JSON.stringify({ token: site.token }),
    signal: AbortSignal.timeout(20_000),
  });

  // Older plugin builds registered GET only. Falling back keeps those sites working
  // instead of breaking every existing install the day the skill updates.
  const legacyUrl = () => {
    const u = new URL(site.endpoint);
    u.searchParams.set('token', site.token);
    return u.toString();
  };

  const get = () => fetch(legacyUrl(), {
    headers: { accept: 'application/json', 'x-mail-canary-token': site.token },
    signal: AbortSignal.timeout(20_000),
  });

  try {
    // POST first: a GET puts the token in the query string, and from there into every
    // access log between here and the site.
    let res = await post();
    let legacy = false;

    if (404 === res.status || 405 === res.status) {
      const fallback = await get();
      if (fallback.ok) {
        res = fallback;
        legacy = true;
      }
    }

    let body = null;
    try { body = await res.json(); } catch { /* non-JSON response */ }

    if (!res.ok) {
      return {
        reachable: true,
        ok: false,
        http_status: res.status,
        error: body?.error || `endpoint returned HTTP ${res.status}`,
      };
    }
    if (!body || body.ok !== true) {
      return { reachable: true, ok: false, error: body?.error || 'endpoint returned an unexpected response' };
    }
    return { reachable: true, ok: true, legacy_plugin: legacy, ...body };
  } catch (e) {
    return {
      reachable: false,
      ok: false,
      error: e.name === 'TimeoutError' ? 'site did not respond within 20s' : e.message,
    };
  }
}

/**
 * Decide a site's state from its last ping and whether that heartbeat arrived.
 *
 *   unreachable          the site itself did not answer — NOT an email problem
 *   destination_mismatch the site is sending heartbeats to a DIFFERENT address than the
 *                        one we watch, so we cannot see them and cannot judge it. Never
 *                        healthy: we have no evidence either way.
 *   stale                the last check is too old to mean anything. A verdict from
 *                        yesterday is not a statement about today.
 *   endpoint_error  the site answered but the endpoint failed (plugin deactivated or
 *                   deleted, token regenerated, 500). Monitoring has STOPPED. This must
 *                   be checked before the delivered-id match: no new heartbeat was sent,
 *                   so the previous run's id is still sitting in last_ping_id, and a
 *                   stale match would report a site with no plugin as healthy forever.
 *   smtp_failed     wp_mail() returned false; known immediately, no waiting
 *   not_delivered   wp_mail() said yes but the heartbeat never arrived
 *   awaiting        sent, still inside the grace window
 *   healthy         arrived
 */
export function verdict(site, graceMinutes, opts = {}) {
  const staleHours = opts.staleAfterHours ?? STALE_AFTER_HOURS;

  if (site.last_reachable === false) return 'unreachable';
  if (site.last_ping_ok === false) return 'endpoint_error';

  // Checked before any health verdict. If the site sends its heartbeat somewhere we
  // do not watch, no amount of looking in our own mailbox tells us anything.
  if (site.destination_ok === false) return 'destination_mismatch';

  if (site.last_wp_mail_returned === false) return 'smtp_failed';

  const age = minutesSince(site.last_ping_at);
  if (age === null) return 'never_checked';

  // A stored 'healthy' does not survive the check that produced it going stale.
  if (age > staleHours * 60) return 'stale';

  if (site.last_delivered_id && site.last_delivered_id === site.last_ping_id) return 'healthy';
  return age < graceMinutes ? 'awaiting' : 'not_delivered';
}

/** Current state, computed from evidence. Never read site.status directly. */
export function currentState(site, graceMinutes = 10, opts = {}) {
  return verdict(site, graceMinutes, opts);
}

/**
 * Heartbeat ids that should now be in the mailbox.
 *
 * Single source of truth — pending.mjs and verify-send.mjs both call this. Two copies
 * of these rules is how they drift apart and start disagreeing.
 */
export function pendingIds(list) {
  const out = [];
  for (const s of list) {
    if (!s.last_ping_id) continue;
    if (s.last_delivered_id === s.last_ping_id) continue; // already confirmed
    if (s.last_wp_mail_returned === false) continue;      // known broken, nothing to find
    if (s.last_reachable === false) continue;             // never sent
    if (s.last_ping_ok === false) continue;               // endpoint failed, nothing sent
    if (s.destination_ok === false) continue;             // sent to an address we do not watch
    out.push({ site: s.site, id: s.last_ping_id, sent_at: s.last_ping_at });
  }
  return out;
}
