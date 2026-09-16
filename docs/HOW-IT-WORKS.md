# How it works

The technical version, including the bits that went wrong on the way.

This is an experiment rather than a shipped product, so this document is unusually
honest about the design decisions and the mistakes that shaped them. If you are going to
extend it, the mistakes are the more useful half.

---

## The lie at the centre of everything

```php
$sent = wp_mail( $to, $subject, $body );
if ( $sent ) {
    // Hooray! ...probably nothing.
}
```

`wp_mail()` returning `true` means WordPress successfully handed your message to
PHPMailer, which successfully handed it to whatever SMTP plugin is installed, which
successfully opened a socket to a mail server that said "yep, got it."

None of those things is delivery. The provider can reject it a second later. The account
can be suspended. The message can land in a spam folder nobody opens. The sending domain
can be blacklisted. `wp_mail()` said `true` and went home.

**So the only honest test is a round trip.** Send a real email, then go and look for it
somewhere else. Everything below is machinery around that one idea.

Hence the name. A canary in a coal mine doesn't detect gas. It just goes quiet, and you
notice.

---

## The two-signal design

The naive version of this tool watches a mailbox and alerts when nothing arrives. It's
also useless, because "nothing arrived" has at least four causes and only one of them is
an email fault:

- The email failed
- The site was down when we asked
- The plugin was deactivated so nothing was sent
- We never asked in the first place

So the site is asked directly, and it answers:

```
POST /wp-json/mail-canary/v1/ping
X-Mail-Canary-Token: ...

→ {
    "id": "mc-acmedental-com-1754300000-a1b2c3",
    "wp_mail_returned": false,
    "error": "SMTP Error: 401 Unauthorized",
    "mailer": "WP Mail SMTP",
    "smtp_host": "smtp.sendgrid.net",
    "destination": "canary@youragency.com"
  }
```

That response is the second signal, and it collapses the ambiguity:

| Endpoint | `wp_mail()` | Arrived | Meaning |
|---|---|---|---|
| No answer | — | — | Site down. Not an email problem. |
| 404 / 403 | — | — | Plugin gone or token changed. Monitoring stopped. |
| ✅ | `false` | ❌ | Broken inside WordPress. **Known instantly, no waiting.** |
| ✅ | `true` | ❌ | Lost after handoff. The genuinely ambiguous one. |
| ✅ | `true` | ✅ | Healthy. |

Row three is the quiet win. Because the site tells us `wp_mail()` failed at the moment it
failed, we don't sit through a ten-minute grace window waiting for an email that was never
going to exist.

---

## Heartbeat IDs, or: how one mailbox watches fifty sites

Every ping mints a fresh ID:

```
mc-acmedental-com-1754300000-a1b2c3
   └── site ─────┘ └ epoch ─┘ └rand┘
```

It goes in the subject line **and** an `X-Mail-Canary-Id` header, and the monitor matches
it **exactly**.

This is doing more work than it looks. Loose matching — by sender, by subject prefix, by
site name — would mean yesterday's heartbeat, still sitting in the inbox, could be
mistaken for today's. A site whose email broke this morning would keep reporting healthy
forever, on the strength of a message from before it broke.

Exact matching also means fifty sites can share one mailbox with zero ambiguity, which is
the difference between "add a site" being one paste and being a provisioning exercise.

---

## The check cycle

Two stages, ten minutes apart, because email is usually instant but occasionally isn't,
and a greylisting relay taking four minutes is not a fault.

```
09:00  ping.mjs      ask every site to send a heartbeat, record what it said
       ...
09:15  pending.mjs   which IDs should be in the mailbox by now
       (agent)       search the mailbox for those exact IDs
       verify.mjs    reconcile: found → healthy, not found → failed
       report.mjs    what deserves an alert
       summary.mjs   counts for the digest
       (agent)       write and send the email
```

The agent does the mailbox search because that's the part needing a mail client. Every
decision either side of it is a script, deliberately.

---

## Why the decisions live in scripts, not in the model

An earlier draft had the model doing everything: computing due dates, deciding thresholds,
writing JSON by hand. It mostly worked. "Mostly" is a bad property for the tool you rely
on to tell you your client's contact form is dead.

The split ended up being:

- **Scripts** do arithmetic, dates, file I/O, and every yes/no decision
- **The model** does judgement — is this error worth explaining, what does it mean for
  the client, how should this be worded

Which means there is **no AI deciding whether your email works.** The checks are fixed
rules over fixed data. The model's job is to explain an arbitrary SMTP error in English,
which is a genuinely good use for a language model and a genuinely bad use for a lookup
table that goes stale.

---

## The one rule that matters

> **A verdict must never outlive its evidence.**

Nearly every bug found while building this was a version of the same mistake: reporting a
stored result as if it were current. Three separate times, in three different places.

**The first one.** A site's plugin gets deactivated. The endpoint returns 404, so no new
heartbeat is sent — which means `last_ping_id` still holds the *previous* run's ID, and
`last_delivered_id` still matches it. The old code checked "do these match?" before
checking "did we actually send anything?", concluded healthy, and reported that site as
fine **forever**. Coverage silently stopped and the tool cheerfully said all was well.

**The second one.** A site was sending its heartbeats to `support@example.com` while the
monitor watched `canary@example.com`. Nobody had ever compared the two. The site carried
a stale `healthy` from a manual check days earlier, and the digest reported it as fine —
about a site nobody could see.

**The third one.** In the digest itself:

```js
all_clear: failing.length === 0 && gaps.length === 0
```

No complaints equals all clear. Which is exactly the "silence means fine" fallacy this
entire tool exists to fight, sitting in the function that writes your morning email.

The fixes were structural rather than case-by-case:

- One function, `currentState()`, computes state from evidence. Nothing reads the stored
  `status` field to make a decision — it's kept only so a divergence is visible.
- Any check older than 36 hours returns `stale`, whatever it used to say.
- `destination_mismatch` is checked **before** any health verdict.
- `all_clear` now requires positive, fresh evidence for **every** site.

---

## Coverage gaps are not failures

Three states mean "we cannot check this site": `unreachable`, `endpoint_error`,
`destination_mismatch`. Plus `stale`, meaning "we haven't checked recently enough to say."

These are reported **separately from failures**, and the wording never implies anything
about whether email works, because we don't know:

> I can't tell you whether email is working here until it's reachable again.

Conflating them would be a lie in one direction ("your email is broken" when the site is
just offline for maintenance) or the other ("all fine" when nothing has been checked in a
week). Both teach people to ignore the tool, which is the only failure mode that actually
kills a monitor.

There's a nice detail here: if **every** site is stale, that's one fact about the monitor,
not N facts about N sites. It collapses into a single `monitoring_stopped` message rather
than a wall of alarming per-site gaps.

---

## Alert thresholds, and why they differ

| State | Alerts after | Why |
|---|---|---|
| `smtp_failed` | 1st failure | `wp_mail()` said no. Nothing ambiguous, nothing to wait for. |
| `not_delivered` | 2nd consecutive | One miss can be a slow relay or a greylist. Two means broken. |
| `destination_mismatch` | Immediately | A wrong address is configuration, not weather. |
| `unreachable` | 2nd consecutive | Sites blip. |

"Consecutive" means consecutive failures **of that kind** — a subtlety that was a bug for
a while. A site unreachable for three days accumulated a failure count, then came back and
had its very first delivery miss, and the inflated counter tripped the two-strike
threshold on strike one. The count now resets when the kind of failure changes.

---

## The plugin is deliberately boring

It holds no credentials, opens no outbound connections, creates no tables, schedules
nothing, and stores three options. It can only ever send one fixed message to one address
you configured.

Notably it **does not use WP-Cron**. The obvious design has the plugin schedule its own
heartbeat, and it's a trap: WP-Cron only fires when someone visits the site. On a quiet
client site it can sit idle for hours, producing "missing heartbeat" alarms that have
nothing to do with email — precisely on the low-traffic sites agencies have most of.
Driving it externally means the timing is as reliable as your agent's scheduler, and the
endpoint answering at all becomes the "did we even ask" signal.

The rate limit exists for one reason: without it, a leaked token means unlimited email.
One per minute caps the damage at "your own mailbox gets mildly annoying" rather than
"your SendGrid quota is gone and your domain is flagged."

It has to be claimed **atomically**, which is less obvious than it sounds. The first
version read a transient, decided, then wrote one. A dozen simultaneous requests all read
"no cooldown" and all sent, so the cap was really one per minute *per concurrent request*.
It now claims a time-bucketed option via `add_option()`, where the unique index on
`option_name` means the database picks exactly one winner and refuses the rest.

---

## Security

The plugin is small on purpose, and the attack surface is one token-protected endpoint
that can send one fixed message to one administrator-configured address. There is no SQL
from user input, no filesystem access, no deserialisation and no outbound HTTP.

What a review in September 2026 found and changed, because the mistakes are the useful
part:

**The token was in the URL.** `mail_canary_ping_url()` built `?token=…`, the route
accepted `GET`, and that URL was what got pasted into the monitor. Every check therefore
wrote the token in plaintext into the site's access log, where it survives in backups and
log shipping. The README claimed the opposite. The plugin now reads
`X-Mail-Canary-Token` first, falling back to a JSON body and then the query string so
existing installs keep working, and reports `token_in_url: true` when a caller is still
using the old path.

**The rate limit had a race.** Described above. Read-then-write is not a rate limit under
concurrency.

**It handed out the site's admin email.** The ping response included `from_address`,
which nothing in the skill ever read. Combined with the logged token, anyone with access
to a logfile could collect the site owner's address and the mail infrastructure behind
it. The field is gone.

**The admin test button cleared the shared cooldown** rather than bypassing it for
itself, which briefly handed a free send to anyone else holding the token. It now passes
a bypass flag instead.

Still true and worth knowing: the token is stored in `wp_options` in plaintext, as any
site-held credential must be, and anyone who can read the database can read it. The
mitigation is the blast radius, not secrecy. Rotate it from the settings page if a site
is ever compromised.

---

## Things it deliberately does not do

- **Read your email.** It searches its own canary mailbox for specific IDs. That's it.
- **Touch WordPress admin.** No SSH, no wp-admin credentials, no database access. One
  plugin, one endpoint, one job.
- **Auto-fix anything.** It tells you what broke and where to look. Automatically
  reconfiguring someone's SMTP settings is a great way to turn one broken site into two.
- **Claim to know things it doesn't.** If the error doesn't say why, it reports the error
  and stops. No invented causes.

---

## Extending it

Everything lives in `skill/mail-canary/`:

| File | Job |
|---|---|
| `lib.mjs` | Storage, the ping, and `verdict()` — the state machine |
| `ping.mjs` | Stage one: ask every site |
| `pending.mjs` | Which IDs to look for |
| `verify.mjs` | Reconcile the search against what was sent |
| `report.mjs` | What deserves an alert right now |
| `summary.mjs` | Counts and the one-word `verdict` for the digest |
| `demo.mjs` | Eleven fixture states, for screenshots and testing |

`references/alerts.md` is the wording rules. `SKILL.md` is the routing and the hard rules.

If you change the state logic, start at `verdict()` in `lib.mjs` — it's about twenty
lines and everything else defers to it. And keep the order of those checks: they are
sequenced so that "can we even see this site" is settled before "is its email working",
which is the whole reason the first two bugs above are fixed.

Then run the fixtures:

```bash
node scripts/demo.mjs mixed && node scripts/report.mjs
```

Eleven scenes, no network, no waiting. If they all still behave, you probably haven't
broken anything interesting.
