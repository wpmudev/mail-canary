# Every email it can send

Six kinds, and no others. If you get something that isn't on this list, something is
wrong.

Everything is **plain text** — no HTML, no logo, no footer, no unsubscribe. These are
operational messages between a tool and its owner, and they should look like it.

All of them go to your notification address only. **Never to a client.** They quote raw
SMTP errors and name infrastructure.

---

## 1. The daily digest

**When:** every morning, after the verify stage. This is the main thing you see.

**Subject tells you whether to open it:**

| Situation | Subject |
|---|---|
| All fine | `[Mail Canary] All 6 sites sending normally` |
| Something broken | `[Mail Canary] 2 of 6 sites cannot send email` |
| Only coverage gaps | `[Mail Canary] 5 of 6 sites checked, 1 could not be reached` |
| Both | `[Mail Canary] 2 of 6 cannot send email, 1 not being checked` |

### On a good day

```
All 6 sites are sending email normally.

  youragency.com            delivered 09:04, 41 seconds
  northgatedental.co.uk       delivered 09:04, 12 seconds
  millerandco.com             delivered 09:05, 1m 20s
  shopfront.co                delivered 09:05, 8 seconds
  acmedental.com              delivered 09:05, 33 seconds
  bellandco.com               delivered 09:06, 15 seconds

Checked 19 August at 09:15. Nothing needs doing.
```

Delivery times are included on purpose. A site that normally takes 8 seconds and today
took 4 minutes isn't broken, but it's worth someone noticing.

**This email arriving is also the proof that the monitoring works.** If it stops turning
up, the problem is the monitor, not your sites.

### When something is wrong

Problems first, in full. Healthy sites get a one-line list at the bottom, because nobody
needs detail about things that work.

```
2 of 6 sites cannot send email.

NEEDS ATTENTION

1. acmedental.com - WordPress is refusing to send

   wp_mail() is returning false, so nothing is leaving the site at all.

   Error:        SMTP Error: 401 Unauthorized, the API key was rejected
   Mailer:       WP Mail SMTP, sending via smtp.sendgrid.net
   Sending as:   noreply@acmedental.com
   Last working: 17 August 09:14, which is 2 days 6 hours ago

   What this means: contact form notifications and WooCommerce order
   emails have not reached anyone for two days. Submissions and orders
   are still being saved, so nothing is lost, but nobody has been told
   about them.

   Likely cause: a 401 from SendGrid almost always means the API key
   was rotated or revoked. Compare the key in WP Mail SMTP against the
   one in your SendGrid dashboard.

   When it is fixed, reply "check acmedental.com" and I will confirm
   within a minute rather than waiting for tomorrow.

WORKING NORMALLY

  youragency.com, northgatedental.co.uk, millerandco.com, bellandco.com

Checked 19 August at 09:15.
```

Every problem block answers the same five things in the same order: **what is wrong, the
evidence, how long, what it means for the client, what to do next.**

---

## 2. Immediate failure alert

**When:** a site newly breaks between digests. One site per email, so it can be forwarded
or acted on on its own.

**Subject:** `[Mail Canary] acmedental.com cannot send email`

Same detail block as the digest. Two flavours:

### WordPress refused to send

The unambiguous one. Alerts on the **first** failure, because there's nothing to wait for.

```
acmedental.com - WordPress is refusing to send

wp_mail() is returning false, so nothing is leaving the site at all.

Error:        SMTP Error: 401 Unauthorized
Mailer:       WP Mail SMTP, sending via smtp.sendgrid.net
Last working: 17 August 09:14, which is 2 days 6 hours ago
```

### Accepted, then vanished

WordPress said it sent. Nothing arrived. Alerts only on the **second** consecutive miss,
because one miss can be a slow relay or a greylist.

```
shopfront.co - email is accepted but not arriving

WordPress reports the message as sent, but two heartbeats in a row
have not turned up. Something is dropping them after handoff.

Mailer:       WP Mail SMTP, sending via smtp-relay.gmail.com
Last working: 18 August 09:12, which is 30 hours ago
Misses:       2 in a row

Likely cause: with Google relay this is usually a send limit, a
suspended account, or the sending domain being rejected.
```

---

## 3. Never worked

**When:** a newly added site fails its very first check.

**Subject:** `[Mail Canary] inherited.co.uk has never been able to send email`

Worded differently on purpose. Nothing broke — it has never worked, and that's a
different and often more valuable thing to be told.

```
inherited.co.uk - email has never worked here

This is the first check on this site, and it failed. Nothing has
broken: it has not been able to send since it was added.

Error:      Could not authenticate. SMTP username and password not accepted.
Mailer:     Easy WP SMTP, sending via mail.inherited.co.uk

What this means: anything the contact form has collected has stayed
in the database and never reached an inbox. Worth checking how far
back that goes, because there may be enquiries nobody ever saw.
```

That middle paragraph is the point. Someone taking over a site should be told there may
be months of unanswered enquiries sitting in the database.

---

## 4. Coverage gap

**When:** a site can no longer be checked at all.

**Subject:** `[Mail Canary] 1 site is no longer being checked`

**This is not a failure alert, and the wording never implies your email is broken** —
because nobody knows. Four causes:

### Heartbeats going somewhere we can't see

```
wp2445.tempurl.host - I cannot see this site's heartbeats

The site is sending its heartbeat to support@acmedental.co.uk,
but I am watching canary@youragency.com. I never see the messages,
so I cannot tell you whether its email is working.

Sending to:   support@acmedental.co.uk
I watch:      canary@youragency.com
Last confirmed delivery: 17 August 18:25, 2 days ago

To fix: on that site, go to Settings then Mail Canary and change
the address to canary@youragency.com. Then reply "check wp2445".
```

### Plugin removed or token changed

Endpoint returned 404 or 403, so no heartbeat was sent at all.

### Site not responding

Didn't answer. Said plainly to be a site problem rather than an email one — but it does
mean the site isn't being monitored while it lasts.

### Check too old

Nothing has checked this site in over 36 hours, so whatever it last said is no longer a
statement about now. Usually means the scheduled job stopped running.

If **every** site is stale, you get one message instead of one per site:

```
The scheduled check has not run recently. 6 sites affected.

Nothing is known to be broken. The checking itself stopped, so
nothing is being verified.
```

---

## 5. Recovery

**When:** a site that was broken starts working again. One message, then silence.

**Subject:** `[Mail Canary] acmedental.com is working again`

```
acmedental.com is sending email again.

Heartbeat delivered in 14 seconds via WP Mail SMTP, smtp.sendgrid.net.
Back to normal monitoring.
```

If the site was being monitored while already broken — it never worked — the wording
changes, because "again" would be wrong:

```
inherited.co.uk is sending email now.

First successful delivery since this site was added. Whatever was
wrong has been fixed.
```

---

## 6. The heartbeat itself

**When:** every check, from each monitored site to your canary mailbox.

**Not for you to read.** This is the thing being looked for.

**Subject:** `[Mail Canary] acmedental.com mc-acmedental-com-1754300000-a1b2c3`

```
Automated delivery check. Nothing to action.

Site: https://acmedental.com
ID:   mc-acmedental-com-1754300000-a1b2c3
Sent: 2026-08-19T09:04:11Z
```

One per site per check, into the canary mailbox, never to your notification address.
Safe to auto-archive or filter away.

---

## What you will never get

- **A daily "all clear" that says nothing.** The digest always includes what was actually
  checked and when.
- **The same alert every day for the same fault.** One email per fault. A still-broken
  site appears in the digest, not as a repeated alarm.
- **A guessed cause.** If the error doesn't say why, you get the error and nothing
  invented on top.
- **"Your emails are going to spam"** unless a heartbeat was genuinely found in Junk.
- **A cost estimate.** It has no idea what a lost enquiry was worth.
- **Anything containing your token or ping URL.**
