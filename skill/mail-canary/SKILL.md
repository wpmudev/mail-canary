---
name: mail-canary
description: Checks that your WordPress sites can actually deliver email, and emails you when one stops — before your client notices.
user-invocable: true
homepage: https://wpmudev.com/
---

# Mail Canary

WordPress email fails silently. An SMTP key gets rotated, a free tier runs out, an IP
gets blacklisted — and contact form enquiries simply stop arriving. Nobody finds out for
weeks, because **the channel that would tell you is the broken channel.**

Mail Canary asks each site to send a heartbeat, then checks whether it actually arrived.

## How it works

Each site runs the **Mail Canary plugin**, which is not part of this skill. It lives in
the repo at `plugin/mail-canary/`, and the member installs it on each WordPress site
themselves from https://github.com/wpmudev/mail-canary . It exposes
one token-protected endpoint. Calling it makes the site send a heartbeat through
`wp_mail()` — inheriting whatever SMTP plugin is configured — and returns what happened
locally.

Two signals, checked together:

| Endpoint | `wp_mail()` | Heartbeat arrived | Verdict |
|---|---|---|---|
| unreachable | — | — | **Site down — coverage gap, not an email alert** |
| errored (404/403/500) | — | — | **Monitoring has stopped — coverage gap** |
| ✅ | `false` | ❌ | Broken inside WordPress. Known immediately. |
| ✅ | `true` | ❌ | Handed off but lost downstream. |
| ✅ | `true` | ✅ | Healthy. |

The endpoint answers "was it even sent", which is why a quiet or offline site never
produces a false email alarm.

### Coverage gaps are not email alerts, but they are never silent

`report.mjs` returns two lists. `alerts` are sites where email is broken.
**`coverage_gaps` are sites we can no longer check at all** — plugin deactivated or
deleted, token regenerated, site down.

A coverage gap is not an email fault and must not be reported as one. But it must never
pass quietly either: a monitor that stops monitoring and says nothing leaves the member
believing they are covered when they are not. Report gaps beneath the alerts, and send a
message even when `alerts` is empty if `coverage_gaps` is not.

## Talking to the member

This skill exists for agency owners, not developers. Most of what it says is read on a
phone, between other things.

- **Lead with the consequence, not the mechanism.** "wp_mail() is failing" means nothing.
  "Enquiries have not reached anyone for two days" does.
- **Name the mailer and the SMTP host every time.** "Which plugin even handles mail on
  this site?" is the first thing they would go and look up.
- **Quote errors verbatim.** `SMTP Error: 401 Unauthorized` is worth more than any
  paraphrase, and lets them search for it.
- **Never guess a cause.** If the error does not say why, report the error and stop.
- **Never say a site is fine when it merely has not been checked.** Those are different,
  and conflating them is the failure this skill exists to prevent.
- **Never print the token or the ping URL** in chat, an alert, or anything screenshottable.

During setup, explain what each answer is for rather than just asking for it. Someone
setting this up for the first time does not know why the canary mailbox has to be
separate from their notification address, and will make that mistake unless told.

## Data

`mail-canary-data/sites.json` inside the agent's **workspace directory** — the directory
containing `AGENTS.md`. Never a hardcoded absolute path.

## Scripts — use these, never do it by hand

Never compute a verdict, edit JSON, or decide whether to alert yourself.

| Task | Command |
|---|---|
| Add a site | `node {baseDir}/scripts/add.mjs "<ping url>" ["label"]` |
| Send heartbeats | `node {baseDir}/scripts/ping.mjs [--all\|<site>] [--include-unarmed]` |
| What to look for | `node {baseDir}/scripts/pending.mjs [--grace 10]` |
| Reconcile the mailbox | `node {baseDir}/scripts/verify.mjs --found "id1,id2"` |
| What to say now | `node {baseDir}/scripts/report.mjs` |
| Monitor a site that failed its first check | `node {baseDir}/scripts/arm.mjs <site>` |
| List sites | `node {baseDir}/scripts/list.mjs` |
| Remove a site | `node {baseDir}/scripts/remove.mjs <site>` |
| Counts for the digest | `node {baseDir}/scripts/summary.mjs` |
| Demo states | `node {baseDir}/scripts/demo.mjs <scene>` |

## How often it checks

Once a day, at 09:00 in the member's timezone. That is a deliberate trade: each check
makes every site send a real email, so checking hourly would mean 24 heartbeats per site
per day — enough to matter on a free SMTP tier, and enough that the mailbox becomes
noise.

Daily means up to 24 hours between a break and the alert. When that is too slow for a
particular member, the fix is to change the two cron jobs to a shorter interval — the
skill does not care how often it is run.

**For testing, run them every few minutes rather than waiting for tomorrow.**

## After a failure — what happens next

This matters as much as the alert itself.

**While a site stays broken**, nothing further is sent. The state is recorded in
`alerted_state`, and `report.mjs` will not repeat an alert for a state it has already
reported. One email per fault, not one per day.

A still-broken site appears in every daily digest under NEEDS ATTENTION, with its full
detail block, so nothing gets quietly forgotten. What it does not get is a second
immediate alert for a fault already reported.

**When the member fixes it**, the next check finds the heartbeat, the site returns to
`healthy`, `alerted_state` is cleared, and a short recovery message goes out. If it
breaks again later, that is a new fault and alerts again.

**They should not have to wait for tomorrow's run.** Every failure alert ends by telling
them to ask for a re-check, and `/mail-canary check <site>` runs the full cycle for that
one site immediately — ping, wait out the grace window, verify, confirm.

## The check cycle

Checking is two stages, ten minutes apart. Email is usually delivered in seconds but can
take minutes; ten minutes is long enough that a slow relay is not mistaken for a failure.

**Stage 1 — send**

1. `ping.mjs --all` — each site sends a heartbeat and reports its local result
2. Any site where `wp_mail_returned` is `false` is **already known broken** — no waiting

**Stage 2 — verify, ten minutes later**

1. `pending.mjs` — lists the exact ids to look for
2. **Search the canary mailbox for each id**, using the mail skill. Check Junk as well
   as Inbox. Ids appear in the subject line and in the `X-Mail-Canary-Id` header.
3. `verify.mjs --found "<comma separated ids you actually found>"`
4. `report.mjs` — returns `alerts` and `coverage_gaps`
5. Run `summary.mjs` for the digest counts. **Always send the daily digest**, whether
   or not anything is wrong. Format per
   `{baseDir}/references/alerts.md` and **send it as an email from `canary_mailbox` to
   `notify_email`, using the configured mail skill over SMTP.**

   **Never use `sendmail`, `mail`, or any local binary to send these.** Host policy
   commonly blocks them, and even where it does not, mail sent that way does not come
   from the canary mailbox and will not be trusted by the recipient's provider. If the
   mail skill cannot send, that is a failure to report, not a reason to find another
   transport.
6. Confirm the send succeeded. If it failed, retry once. If it fails again:
   - append the timestamp and error to `mail-canary-data/send-errors.log`
   - if `fallback_channel` is configured in settings, send the same message there
   - raise it the next time the member is in chat, whether or not the fallback worked

   An alert nobody receives is the failure this skill exists to prevent.

### Matching ids — the rule that matters

**Only an exact match on the current `id` counts.** Every ping generates a new id, so a
heartbeat sitting in the mailbox from yesterday's run has a different id and must be
ignored. Matching loosely — by sender, by subject prefix, by site name — would let a
stale message make a broken site look healthy, which is the single worst bug this skill
could have.

This is also how one mailbox serves many sites: the id contains the site, so ten sites
can share one inbox with no ambiguity.

## Setup

If `mail-canary-data/settings.json` is missing, run `{baseDir}/references/setup.md`.

**A site is not monitored until one heartbeat has completed the full round trip.**
`add.mjs` sets `armed: false`, and only a successful verify arms it. Never create the
daily jobs until at least one site is armed — alerting that email "broke" on a site
whose email never worked in the first place is misleading and destroys trust in every
later alert.

## Commands

The slash command is **`/mail-canary`**, generated from this skill's `name`. Accept the
obvious variations people will type — `/mail_canary`, `/mailcanary` — and treat a bare
`/mail-canary` with no sub-command as `status`.

| Command | Action |
|---|---|
| `/mail-canary setup` | Run first-time configuration. Re-run to change settings. |
| `/mail-canary add <url>` | Register a site. Immediately ping, wait, verify, and report. |
| `/mail-canary check [site]` | Run the full cycle now. Name a site to check just that one |
| `/mail-canary status` | How many sites, what state, when last checked |
| `/mail-canary list` | Every site, worst state first |
| `/mail-canary remove <site>` | Stop tracking |
| `/mail-canary digest` | Send the daily digest email now, on demand |
| `/mail-canary fallback <channel> <target>` | Set a backup alert channel, used only if email fails. `off` to clear |
| `/mail-canary demo [scene]` | Load a demo state. See `{baseDir}/references/demo.md` |

On `add`, run the whole cycle end to end rather than just registering — the most useful
moment in this skill is telling someone within a few minutes that a site they just took
over has never been able to send email.

## Creating the scheduled jobs

Some Gateway builds validate the delivery block even when no delivery is wanted, and
reject an empty channel or recipient. If a job is refused, the problem is the request
shape rather than the scheduler. A delivery route of `channel: "last"`, `to: "current"`
is accepted, and works fine here because **the job is not delivering anything** — it
wakes the skill, and the skill sends its own email over SMTP.

Do not respond to a rejected job by retrying the same payload. Read the validation error
and change the shape.

## The scheduled jobs

Two jobs, fifteen minutes apart, in the member's timezone.
Create them with **no `announce`, no channel, and no delivery option** — the job wakes the skill, and the skill
sends its own email.

**09:00** — *"Run the mail-canary skill: ping all armed sites."*

**09:15** — *"Run the mail-canary skill verify stage: list pending heartbeat ids, search
the canary mailbox for each exact id, reconcile with verify.mjs, then run report.mjs. If
there are alerts or coverage gaps, send them as an email from canary_mailbox to
notify_email, both read from mail-canary-data/settings.json. Send the digest every day,
including when everything is fine. The one exception: if summary.mjs returns verdict
no_sites, send nothing, because nothing is being monitored."*

The second job's wording matters. When cron fires there is no human in the session, so
composing a reply sends it nowhere — the message must be delivered outbound. And the
digest sends every day regardless of findings, so "nothing is wrong" is never a reason
to skip it.

## The fallback channel

Alerts go by email. But email is also the thing being monitored, so if the canary
mailbox's own sending breaks, alerts stop and nothing says so.

An optional fallback covers that. It is **not configured by default** and setup does not
ask for it — it exists for members who want a second path and are willing to set one up.

```
/mail-canary fallback telegram <chat id>
/mail-canary fallback off
```

Stored as `fallback_channel` and `fallback_target`. Used **only** when an email alert
fails twice — never as the primary channel, never in parallel. A member who set it up
and then sees a Telegram message knows immediately that their email path is broken,
which is information in itself.

## Older plugin builds

The first release of the plugin registered `GET` only, and put the token in the URL. The
skill now sends it in an `X-Mail-Canary-Token` header, so it never reaches the site's
access logs.

`ping()` tries POST first and falls back to GET on a 404 or 405, marking the site
`legacy_plugin`. **An outdated plugin is never a failure** — the site keeps being
monitored normally. Mention it once, in the digest, alongside what upgrading gains:

> Two sites are on an older Mail Canary plugin build: neeltest1234.example.com and
> acme.com. They are being checked normally. Updating the plugin stops the access token
> being written into those sites' server logs on every check.

Do not repeat it every day, and never let it block arming a site.

## Detail is the product

The single biggest failure mode of a monitoring email is being too thin to act on. Every
message must answer, in order: what is wrong, the evidence, how long, what it means for
the client, and what to do next.

Use `summary.mjs` for counts and `report.mjs` for detail. Never tally states by hand.

Never send a bare technical fact without its consequence. "wp_mail() is failing" means
nothing to someone between client meetings. "Order confirmations have not reached
customers for two days" does.

Full formats in `{baseDir}/references/alerts.md`.

## Hard rules

1. **Never report a coverage gap as an email failure.** `unreachable` and
   `endpoint_error` mean we could not check — not that email is broken. Conflating them
   teaches the member to ignore both. Equally, **never let a coverage gap pass in
   silence**: a site whose plugin was removed must stop counting as monitored.
2. **Never alert on a single `not_delivered`.** Two consecutive misses. One miss is a
   slow relay or a greylist.
3. **`smtp_failed` alerts on the first failure.** `wp_mail()` returned false — there is
   nothing ambiguous about it and no reason to wait.
4. **Only exact id matches count as delivered.**
5. **Never mark a site armed without a completed round trip.**
6. **The daily digest always sends**, including when everything is fine — unless
   `summary.mjs` returns `verdict: no_sites`, in which case send nothing. It is the
   proof the monitoring itself is alive: if it stops arriving, that is information.
   Between digests, stay silent unless something has newly broken.
7. **Never invent a cause.** Report the error string the site returned. If there is no
   error, say the message was accepted and never arrived — do not speculate about
   blacklists or spam filters.
8. **Alerts go to `notify_email`, never to a client.** These messages name broken
   infrastructure and quote raw SMTP errors. They are for the member only.
9. **`notify_email` must never equal `canary_mailbox`.** Alerts would land in the
   mailbox being monitored instead of somewhere the member reads.
10. **Never put the token in a URL.** `add.mjs` splits it out of the pasted line and
    stores `endpoint` and `token` separately, and `ping()` sends it in the
    `X-Mail-Canary-Token` header. A
    token in a query string is written into the web server's access log on every check,
    and on shared hosting those logs are not private. Never print the token in chat, an
    alert, or a screenshot.
11. **Never use the fallback channel as the primary.** It fires only after an email
    alert has failed twice. Sending to both routinely would train the member to ignore
    one of them.
12. **The ping URL contains a token.** Never print it in a chat message, an alert, or a
   screenshot. Refer to sites by hostname.
