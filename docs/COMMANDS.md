# Commands

Everything you can say to your agent, and what comes back.

The slash command is `/mail-canary`. Variations like `/mail_canary` and `/mailcanary`
work too, and plain English generally does — *"check acmedental.com"* or *"which sites
are broken?"* are understood.

---

## `/mail-canary setup`

Runs first-time configuration: canary mailbox, notification address, and a test email
that has to actually arrive before anything is saved.

Re-run it any time to change settings. Existing answers are offered as defaults.

---

## `/mail-canary add <url>`

Registers a site and immediately runs a full check.

```
/mail-canary add https://acme.com/wp-json/mail-canary/v1/ping?token=…
```

Paste the whole line from the plugin's settings page. The token is split out and stored
separately, so it never travels in a URL again.

**Expected output — working site:**

```
acme.com added.

Sent a heartbeat, checking the mailbox in a few minutes.
Mailer: WP Mail SMTP, sending via smtp.sendgrid.net

[a few minutes later]

acme.com - email is working.
Heartbeat delivered in 41 seconds.
Monitoring is on.
```

**Expected output — broken site:**

```
acme.com added, but its email is not working.

wp_mail() returned false, so WordPress is refusing to send at all.
Error: SMTP Error: 401 Unauthorized
Mailer: WP Mail SMTP, sending via smtp.sendgrid.net

Anything the contact form has collected has stayed in the database
and never reached an inbox.

Want me to monitor it anyway, or would you rather fix it first?
```

A site isn't monitored until one heartbeat completes the round trip. That's deliberate —
alerting that email "broke" on a site whose email never worked is misleading.

---

## `/mail-canary check [site]`

Runs the full cycle now instead of waiting for morning. Name a site to check just that
one.

```
/mail-canary check
/mail-canary check acmedental.com
```

This is what you use after fixing something. Expected output:

```
acmedental.com - fixed. Heartbeat delivered in 12 seconds.
Back to normal monitoring.
```

If it's still broken, it compares the errors rather than repeating itself:

```
acmedental.com - still failing, but the error has changed.

Was: SMTP Error: 401 Unauthorized
Now: SMTP Error: Could not connect to SMTP host

Progress of a sort. The key is being accepted now, but the host
cannot be reached. Worth checking the hostname and port.
```

---

## `/mail-canary status`

A quick picture without waiting for the morning digest.

```
6 sites monitored.
5 sending normally, 1 needs attention.

acmedental.com - WordPress refusing to send since 17 August
Last check: 2 hours ago
Next scheduled check: tomorrow 09:00
```

---

## `/mail-canary list`

Every tracked site, worst state first.

```
acmedental.com        smtp_failed      WP Mail SMTP, smtp.sendgrid.net
shopfront.co          not_delivered    2 misses, last delivered 30h ago
oldclient.net         unreachable      site did not respond
youragency.com      healthy          delivered 41s ago
northgatedental.co.uk healthy          delivered 12s ago
```

---

## `/mail-canary remove <site>`

Stops tracking. No confirmation email, no further checks.

---

## `/mail-canary digest`

Sends the daily digest now, on demand. Same content, same path as the 09:15 job.

Useful for confirming the alert route works without waiting until morning, and for taking
screenshots.

---

## `/mail-canary fallback <channel> <target>`

Sets a backup alert channel, used **only** when an email alert has failed twice.

```
/mail-canary fallback telegram 123456789
/mail-canary fallback off
```

Off by default. Setup never asks for it.

---

## `/mail-canary demo [scene]`

Loads a fixture state so every screen can be seen without waiting for a real site to
break. Demo entries are frozen — they're never pinged, and real sites are untouched.

```
/mail-canary demo              list the scenes
/mail-canary demo mixed        load one
/mail-canary demo journey      an ordered walkthrough
/mail-canary demo off          remove fixtures, keep real sites
```

| Scene | Shows |
|---|---|
| `reset` | Nothing tracked |
| `healthy` | Everything fine, the quiet state |
| `one-strike` | A single miss, deliberately not alerted |
| `smtp-broken` | `wp_mail()` refused, with a real error |
| `not-delivered` | Accepted but never arrived, two strikes |
| `plugin-removed` | Endpoint 404, monitoring stopped |
| `destination-mismatch` | Heartbeats going somewhere we can't see |
| `stale` | A check too old to trust |
| `site-down` | Unreachable, correctly not an email alert |
| `never-worked` | A site whose email has never once been delivered |
| `mixed` | Everything at once |
| `recovered` | Back to working |

**Always run `demo off` when finished.** Fixtures left in place mean the daily digest
keeps reporting on sites that don't exist.

---

## Running the scripts directly

Everything above is the agent driving these. You can run them yourself for debugging —
from the workspace directory, or anywhere, since they locate it themselves.

| Script | Does |
|---|---|
| `node scripts/add.mjs "<url>" ["label"]` | Register a site |
| `node scripts/ping.mjs [--all\|<site>]` | Stage one: send heartbeats |
| `node scripts/pending.mjs` | Which IDs to look for in the mailbox |
| `node scripts/verify.mjs --found "id1,id2"` | Reconcile the search |
| `node scripts/report.mjs` | What deserves an alert |
| `node scripts/summary.mjs` | Counts and the digest verdict |
| `node scripts/list.mjs` | Every site and its computed state |
| `node scripts/arm.mjs <site>` | Monitor a site that failed its first check |
| `node scripts/remove.mjs <site>` | Stop tracking |
| `node scripts/demo.mjs <scene>` | Load a fixture state |

All output JSON. `report.mjs` and `summary.mjs` are the two worth reading if you want to
know what the agent is basing its email on.

`summary.mjs` returns a single `verdict` field, which is the quickest way to see where
things stand:

| verdict | Meaning |
|---|---|
| `all_clear` | Every site verified healthy, on fresh evidence |
| `problems` | Something is failing or cannot be checked |
| `checking` | A heartbeat is in its grace window, or a site is newly added |
| `no_sites` | Nothing is being monitored |
