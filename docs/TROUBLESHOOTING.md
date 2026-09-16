# Troubleshooting

---

## The plugin

### "Not set up yet" won't go away

The destination field is empty or the address didn't validate. It must be a full,
valid email address — `canary@youragency.com`, not `canary` or a URL.

### The endpoint returns 404

Three usual causes:

**Permalinks.** The REST API needs them enabled. Settings → Permalinks, pick anything
other than Plain, save. You don't have to change what's selected — just saving the page
flushes the rules.

**Plugin not active.** Check Plugins → Installed Plugins.

**A security plugin blocking REST.** Wordfence, iThemes and others can disable the REST
API for unauthenticated requests. Allow `/wp-json/mail-canary/v1/` specifically.

### The endpoint returns 403

The token no longer matches. Almost always because it was rotated on the settings page
but the new command was never given to the agent. Copy the current command from Settings
→ Mail Canary and re-run `/mail-canary add` with it.

### The endpoint returns 429

Rate limiting, working as intended — one heartbeat per minute. Wait a minute. The test
button on the settings page bypasses it, so use that if you're testing by hand.

### "Send a test heartbeat" says WordPress could not send it

That's a real finding, not a plugin problem. This site cannot send **any** email right
now, including contact form notifications and WooCommerce order confirmations. The error
shown is what WordPress reported. Start with whatever mail plugin is named next to it.

### The test says it sent, but nothing arrives

Also a real finding, and the exact thing this tool exists to catch. WordPress handed the
message off and something after that lost it. Check the sending account for suspensions,
send limits, or domain verification problems. Check the spam folder of the canary mailbox
too.

---

## The mailbox

### Mail Canary can't read the mailbox

Check which provider is configured — `mail_provider` in `mail-canary-data/settings.json`,
defaulting to `himalaya`.

**himalaya:** confirm it is configured and can see the mailbox.

```bash
himalaya envelope list -o json
```

If that fails, the problem is himalaya's own configuration, not this skill. Ports are
usually 993 for IMAP and 587 for SMTP.

**agentmail:** confirm the key is reachable. It is read from `AGENTMAIL_API_KEY` in the
environment, then `agentmail_api_key` in settings, then any file named by `env_file`.
A missing key produces a message naming all three.

### Gmail won't connect

You need an **app password**, not your normal one. Requires 2FA on the account.
Google also caps free accounts at 500 sends a day and has suspended accounts for
automation patterns. It works, but it isn't the sensible choice.

### Outlook won't connect

It won't. Microsoft retired basic authentication in April 2026. Use a custom domain
mailbox or AgentMail instead.

### Heartbeats land in spam

Add the canary mailbox address to your contacts, and check Junk when verifying. The agent
searches Junk as well as Inbox, but a provider that silently drops rather than filters
will look identical to a delivery failure.

---

## The monitoring

### "I cannot see this site's heartbeats"

The plugin is sending to a different address than the agent watches. The alert names
both. Fix it on the site: Settings → Mail Canary, change the address, then
`check <site>`.

This is deliberately never treated as healthy. Nobody can see those heartbeats, so
nothing is known either way.

### A site reports "last check too old"

Nothing has checked it in over 36 hours, so the previous verdict has expired. Usually the
scheduled job stopped. Ask your agent:

> List your scheduled jobs.

You want two: a ping around 09:00 and a verify fifteen minutes later. If they're missing,
re-create them — `/mail-canary setup` does it.

### Everything went stale at once

You'll get one message rather than a wall of per-site alarms. It means the scheduler
stopped, not that anything is broken. Same fix as above.

### No digest this morning

**This is the one worth paying attention to.** The digest arriving is the proof the
monitoring works. If it stops:

1. Is OpenClaw running?
2. Do the scheduled jobs still exist?
3. Can the agent still send from the canary mailbox?
4. Check `mail-canary-data/send-errors.log` in the workspace

Failed sends are logged there with the timestamp and error.

### Alerts about a site I removed

Demo fixtures. Run `/mail-canary demo off` — it clears the fake entries and leaves real
sites alone.

### A site alerts on the first miss instead of the second

By design if `wp_mail()` returned false, because that's unambiguous. The two-strike rule
only applies to "sent but never arrived", which genuinely can be a slow relay once.

---

## Older plugin builds

If a site is flagged as being on an outdated plugin, it's still being monitored normally.
Plugin 1.0.0 accepted the token in the URL, which wrote it into that site's access log on
every single check. From 1.1.0 the skill sends it in an `X-Mail-Canary-Token` header
instead, and the plugin reads that first. Older paths still work, so nothing breaks while
you get to it.

Updating stops the token being written into that site's logs. Worth doing, and worth
rotating the token afterwards from Settings, then Mail Canary, since the old one has been
sitting in the logs for as long as the site has been monitored.

---

## Still stuck

Ask the agent directly — it can read its own state:

> Show me everything you know about acmedental.com.

Or run the scripts by hand from the workspace:

```bash
node skills/mail-canary/scripts/list.mjs
node skills/mail-canary/scripts/report.mjs
```

`list.mjs` shows both the **computed** state and the **stored** one. If those two
disagree, the computed one is correct — that's the point of it, and a divergence usually
means something changed since the last check.

---

## Creating the scheduled jobs fails

Some OpenClaw Gateway builds validate the delivery block on a cron job **even when the
job is not meant to deliver anything**, and reject an empty channel or recipient. You'll
see the job refused rather than the scheduler misbehaving.

A route of `channel: "last"`, `to: "current"` is accepted. That's harmless here, because
the job itself delivers nothing — it wakes the skill, and the skill sends its own email
over SMTP afterwards.

If jobs are being rejected, read the validation error rather than retrying the same
payload. The two useful checks:

> List your scheduled jobs.

and, to confirm the scheduler works at all, independently of Mail Canary:

> Create a one-shot job for 2 minutes from now that writes the current time to test.txt.

If that fails too, the problem is the install rather than this skill.

---

## The digest didn't send, but nothing errored

Check what transport was used. These emails must go out through the **configured mail
skill over SMTP**, from the canary mailbox.

Local binaries like `sendmail` or `mail` are commonly blocked by host policy, and even
where they run, the message doesn't come from the canary mailbox and tends to be
rejected or spam-filtered at the other end. If you see an agent reaching for
`/usr/sbin/sendmail`, that's the wrong path.
