# Email style

Every email this skill sends must stand on its own. The reader is on a phone, has not
looked at this tool in weeks, and should not have to ask a single follow-up question to
know what broke, what it means for their client, and what to do about it.

**A thin alert is a failed alert.** If the reader has to come back and ask "which mailer?"
or "how long has this been going on?", the email did not do its job.

## The rule for every message

Answer these five, in this order, every time:

1. **What is wrong** — in one line, at the top
2. **The evidence** — the real error, the mailer, the SMTP host, the addresses
3. **How long** — when it last worked, and what that means in days
4. **What it means for the client** — the consequence in business terms, not technical ones
5. **What to do next** — the likely cause, and how to get it re-checked

Never send a bare fact without its consequence. "wp_mail() is failing" means nothing to
someone at a client meeting. "Enquiries have not reached anyone for two days" does.

## Formatting

- **Plain text.** No HTML, no logo, no footer, no unsubscribe.
- Use hyphens and colons, never em dashes.
- Label lines (`Error:`, `Mailer:`, `Last working:`) so the eye can find things.
- Blank lines between blocks. A wall of text gets skimmed and misread.
- Never print the ping URL or token. Refer to sites by hostname.
- Never send to a client. These quote raw errors and name infrastructure.

---

# The daily digest

Sent every morning after the verify stage. This is the main thing the member sees.

## Lead with the verdict

`summary.mjs` returns a single `verdict` word. Use it rather than inferring from counts:

| verdict | Means | Digest opens with |
|---|---|---|
| `all_clear` | Every site verified healthy on fresh evidence | "All 6 sites are sending email normally." |
| `problems` | Something is failing, or cannot be checked | "2 of 6 sites cannot send email." |
| `checking` | A heartbeat is inside its grace window, or a site has been added but not yet checked | "Still checking 1 site, everything else is fine." |
| `no_sites` | Nothing is being monitored | Do not send a digest at all. |

**Never say "all clear" on `checking`.** Nothing is wrong, but nothing is confirmed
either, and the two are not the same thing.

Equally, never call it a fault. A site in `not_yet_checked` has been added and not yet
verified. Say "not checked yet", never "cannot send email".

## Subject lines

The subject alone must say whether today needs attention.

| Situation | Subject |
|---|---|
| All fine | `[Mail Canary] All 6 sites sending normally` |
| Some broken | `[Mail Canary] 2 of 6 sites cannot send email` |
| Only coverage gaps | `[Mail Canary] 5 of 6 sites checked, 1 could not be reached` |
| Both | `[Mail Canary] 2 of 6 cannot send email, 1 not being checked` |

Never the same subject two days running when the situation has changed. The subject is
how someone decides whether to open it during a meeting.

## When everything is fine

Short. This arrives 350 days a year and its only job is to be glanceable and to prove
the monitor is alive.

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

Delivery times are worth including: a site that normally delivers in 8 seconds and today
took 4 minutes is not broken, but it is worth someone noticing.

## When something is wrong

Lead with the problems. Healthy sites go at the bottom as a short list, because nobody
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

2. shopfront.co - accepted but never arrived

   WordPress reports the message as sent, but two heartbeats in a row
   have not turned up. Something is dropping them after handoff.

   Mailer:       WP Mail SMTP, sending via smtp-relay.gmail.com
   Sending as:   orders@shopfront.co
   Last working: 18 August 09:12, which is 30 hours ago
   Misses:       2 in a row

   What this means: order confirmations may be reaching some customers
   and not others. Worth asking the client whether anyone has complained
   about missing receipts.

   Likely cause: with Google relay this is usually a send limit, a
   suspended account, or the sending domain being rejected. Check the
   Google Workspace admin console for warnings on that account.

   When it is fixed, reply "check shopfront.co".

WORKING NORMALLY

  youragency.com, northgatedental.co.uk, millerandco.com, bellandco.com

Checked 19 August at 09:15.
```

Two things that make this land: **the consequence is spelled out per site** (order
receipts, not "email"), and **the likely cause is specific to the actual error and
provider**, not a generic checklist.

## Coverage gaps in the digest

A site we could not check is not a site that is fine, and it is not a site whose email
is broken. It gets its own section, and the wording must not imply either.

```
NOT BEING CHECKED

3. wp2445.tempurl.host - I cannot see this site's heartbeats

   The site is sending its heartbeat to support@acmedental.co.uk,
   but I am watching canary@youragency.com. I never see the messages,
   so I cannot tell you whether its email is working.

   Sending to:   support@acmedental.co.uk
   I watch:      canary@youragency.com
   Mailer:       none detected, using PHP mail()
   Last confirmed delivery: 17 August 18:25, 2 days ago

   This is not necessarily a fault on the site. It usually means the
   plugin's destination was changed, or it was set up before the
   monitor's mailbox was decided.

   To fix: on that site, go to Settings then Mail Canary and change
   the address to canary@youragency.com. Then reply "check wp2445".
```

Same shape for the other gaps:

- **Plugin removed or token changed** — endpoint returned 404 or 403, so nothing was
  sent. Say the plugin may have been deactivated, updated, or its token regenerated,
  and that reinstalling or copying the new command fixes it.
- **Site not responding** — the site did not answer at all. Say plainly that this is a
  site problem rather than an email one, but that it does mean the site is not being
  monitored while it lasts.
- **Check too old** — the last check is more than 36 hours old, so whatever it said is
  no longer a statement about now. Usually means the scheduled job stopped running.

---

# Immediate alerts

Between daily digests, a newly broken site gets its own email straight away rather than
waiting for the morning. Same detail blocks as above, one site per email.

Subject: `[Mail Canary] acmedental.com cannot send email`

Do not send an immediate alert for something already reported in that morning's digest.

## Never worked

A site whose first check failed has never been working, and saying "broke" would be
wrong. Usually a newly inherited site, and often the most valuable thing the tool says.

```
inherited.co.uk - email has never worked here

This is the first check on this site, and it failed. Nothing has
broken: it has not been able to send since it was added.

Error:      Could not authenticate. SMTP username and password not accepted.
Mailer:     Easy WP SMTP, sending via mail.inherited.co.uk
Sending as: admin@inherited.co.uk

What this means: anything the contact form has collected has stayed
in the database and never reached an inbox. Worth checking how far
back that goes, because there may be enquiries nobody ever saw.

Likely cause: the SMTP credentials are wrong or were never completed.
Worth confirming the username, password and port with whoever hosts
that mailbox.
```

That middle paragraph is the point of this message. Someone taking over a site should
be told there may be months of unanswered enquiries sitting in the database.

## Recovery

Short. The problem is over.

```
acmedental.com is sending email again.

Heartbeat delivered in 14 seconds via WP Mail SMTP, smtp.sendgrid.net.
Back to normal monitoring, and it will appear as normal in tomorrow's
daily check.
```

If the site was armed while already failing, it never worked before, so "again" is wrong:

```
inherited.co.uk is sending email now.

First successful delivery since this site was added. Whatever was
wrong has been fixed.
```

## Still broken on re-check

When someone fixes something and asks for a re-check that still fails, compare the two
errors. Naming what changed is worth far more than repeating the alert.

```
acmedental.com is still failing, but the error has changed.

Was: SMTP Error: 401 Unauthorized
Now: SMTP Error: Could not connect to SMTP host

That is progress of a sort. The key is being accepted now, but the
host cannot be reached. Worth checking the hostname and port in
WP Mail SMTP against what SendGrid lists.
```

If the error is identical, say so plainly rather than pretending something happened:

```
acmedental.com is still failing with exactly the same error.

SMTP Error: 401 Unauthorized

Nothing has changed since the last check, so whatever was adjusted
has not taken effect. Worth confirming the settings actually saved.
```

---

## Never write

- "Your emails are going to spam" unless a heartbeat was actually found in Junk
- "This is costing you £X" — you have no idea
- "Urgent action required" — the subject line already carries the weight
- A cause you are guessing at. If the error does not tell you, say what the error was
  and stop.
- Anything about the token, the ping URL, or the plugin's internals
- A count of affected form submissions unless you have actually looked and counted
