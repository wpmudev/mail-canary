# Setup

Three things: a mailbox the agent can read, an address to notify, and a real test.
Aim to be finished inside three minutes.

## Step 1 — the canary mailbox

This one account does both jobs: it **receives** the heartbeats from every site, and it
**sends** the alerts to the member. So it needs working IMAP and working SMTP.

```
First, the mailbox I'll work from.

It needs to do two things: receive the heartbeats your sites send,
and send you an alert when something breaks. So I need IMAP and SMTP
on the same account.

Give it its own mailbox — not your normal inbox. It will collect a
few automated messages a day and nothing else.

A custom-domain mailbox works well. Gmail and Outlook both have
problems for this.
```

Store as `canary_mailbox`. Then prove both directions actually work:

- **IMAP** — list the folder. If it fails, stop.
- **SMTP** — hold until Step 3, where the test doubles as the notification test.

### Which provider

Mail Canary reaches the mailbox one of two ways, set as `mail_provider`:

- **`himalaya`** (default) — the mail CLI bundled with OpenClaw. Works with any IMAP
  account. Verify with `himalaya envelope list -o json`.
- **`agentmail`** — the AgentMail API. Needs a key in `AGENTMAIL_API_KEY`, or
  `agentmail_api_key` in settings, or a file named by `env_file`.

Ask which they are using, or detect it: if `himalaya envelope list` works, use himalaya.

If neither is reachable:

```
I can't reach that mailbox yet.

If you're using a normal IMAP mailbox, himalaya needs configuring with
its credentials (ports 993 and 587). Check with:

  himalaya envelope list -o json

If you're using AgentMail, I need an API key.

Say `/mail-canary setup` again once one of those is sorted.
```

Do not continue without a readable mailbox. Without it there is no way to tell delivered
from lost, and every alert would be a guess.

## Step 2 — where alerts go

```
Where should I email you when something breaks?

This is the address you actually read — yours, or a shared inbox
your team watches.
```

Store as `notify_email`.

**It must not be the canary mailbox.** If they give the same address, say why and ask
again:

```
That's the same mailbox I'm watching for heartbeats. Alerts need to
go somewhere you'll actually see them — give me your normal address.
```

Multiple recipients are fine; store them comma-separated.

## Step 3 — prove the alert can reach them

Send a real test email from the canary mailbox to `notify_email`:

```
Subject: [Mail Canary] Setup test

This is Mail Canary checking it can reach you.

If you're reading this, alerts will arrive here when one of your
sites stops being able to send email.

Nothing is wrong. You can delete this.
```

Then ask:

```
Sent a test to you@youragency.com — did it arrive?
`yes` / `no`
```

**If it did not arrive, stop.** Do not save, do not create the daily jobs. Notifications
are the entire product; a monitor that cannot reach anyone is worse than none, because it
creates a belief in coverage that does not exist.

Worth mentioning once it lands:

```
Landed. Worth adding canary@youragency.com to your contacts so
future alerts don't end up in spam.
```

## Step 4 — the first site

```
Now add a site.

1. Install the Mail Canary plugin on it (zip from GitHub)
2. Settings → Mail Canary → enter canary@youragency.com → Save
3. Copy the line it shows you and paste it here

It looks like: /mail-canary add https://yoursite.com/wp-json/...
```

## Step 5 — the check that has to pass

Run the full cycle immediately: `add.mjs`, then `ping.mjs --include-unarmed`, then wait,
then search the mailbox, then `verify.mjs`.

While waiting, say so plainly:

```
Sent a heartbeat to acme.com. Checking the mailbox in a few minutes —
I'll tell you either way.
```

**Monitoring only starts once this passes.** Do not create the daily jobs, and do not
report setup as complete, until at least one site is armed.

**On success:**

```
✅ acme.com — email is working.
Heartbeat delivered in 40 seconds. Mailer: WP Mail SMTP → smtp.sendgrid.net

Monitoring is on. I'll check every morning at 9am and send you a
short digest either way, with the full details on anything broken.
```

Then create the two daily jobs.

**On failure, treat it as a finding rather than a setup problem:**

```
⚠️ acme.com — the heartbeat never arrived.

wp_mail() returned true, so WordPress thinks it sent it. Something
after that is dropping it.
Mailer: WP Mail SMTP → smtp.sendgrid.net

This is worth knowing: this site's contact form is very likely not
reaching anyone right now.

Want me to keep monitoring it anyway, or fix this first?
```

If they choose to monitor anyway, run `arm.mjs <site>`. That records
`armed_in_failed_state`, so a later success reads as *"email is working now — first
successful delivery since this site was added"* rather than *"recovered"*, which would
imply it had ever worked.

## Saved settings

```json
{
  "canary_mailbox": "canary@youragency.com",
  "notify_email": "you@youragency.com",
  "mail_provider": "himalaya",
  "timezone": "Asia/Kolkata",
  "grace_minutes": 10,
  "fallback_channel": null,
  "fallback_target": null,
  "setup_complete": true
}
```

`setup_complete` is `true` only when the mailbox is readable, the test email reached
`notify_email`, and at least one site has completed a round trip.

## The limitation worth stating out loud

Alerts are sent from the canary mailbox. **If that mailbox's own sending breaks, alerts
stop arriving and nothing will tell you.** Nothing can fully solve that — a monitor
cannot report its own outage through the channel that is down.

Three things reduce it:

1. Every alert send is checked for success. A failure is written to
   `mail-canary-data/send-errors.log` with the timestamp and error.
2. A digest email goes out every morning, whether or not anything is wrong. If the
   member stops seeing it, the alert path itself has died, which is the only way to
   catch that.
3. An optional fallback channel, off by default, used only when an email alert has
   failed twice. Mention it exists; do not set it up unless asked.

Say this once during setup, plainly, and do not repeat it:

```
One thing worth knowing: alerts come from this mailbox, so if this
mailbox itself stops sending, the alerts stop too and nothing will
tell you.

You'll get a short digest every morning either way, so you'd notice
if it stopped arriving. If you want a backup channel as well, say
`/mail-canary fallback` and I'll set one up.
```
