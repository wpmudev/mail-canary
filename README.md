# Mail Canary

**Know when a WordPress site stops being able to send email, before your client tells you.**

WordPress email fails silently. An SMTP key gets rotated, a free tier hits its daily
limit, a host lands on a blacklist. Contact form notifications and WooCommerce order
confirmations simply stop arriving, and nothing anywhere reports an error, because the
one channel that would tell you is the channel that broke.

Mail Canary asks each of your sites to send a heartbeat email, then checks whether it
actually arrived. If it did, that site can genuinely deliver email. If it didn't, you get
told which site, what broke, and where to go and fix it.

> **From the WPMU DEV experiments shelf.** This came out of a run of small projects
> exploring what people can build with
> [OpenClaw on Unlimited Hosting](https://wpmudev.com/unlimited-hosting/). Use it as it
> is, or as a starting point to shape something that fits how you work. 🙂

---

## What makes it different

Most email monitoring checks whether `wp_mail()` returned `true`. That only means
WordPress handed the message to your SMTP plugin and stopped caring. **Most real failures
happen after that point** — the provider rejects it, the account is suspended, the message
disappears — and WordPress reports success the whole time.

The only way to know an email arrived is for it to arrive somewhere you can look.

Mail Canary uses two signals together:

| Site answered? | `wp_mail()` said | Heartbeat arrived | Verdict |
|---|---|---|---|
| No | — | — | Site is down. **Not an email alert.** |
| Endpoint errored | — | — | Monitoring has stopped. Plugin removed or token changed. |
| Yes | failed | ❌ | Broken inside WordPress. You get the exact error. |
| Yes | worked | ❌ | Handed off and lost. Provider, blacklist, or suspension. |
| Yes | worked | ✅ | Healthy. |

That second signal is why a site being offline never produces a false "your email is
broken" alarm, and why a site whose plugin was deleted stops counting as monitored
instead of quietly reporting healthy forever.

---

## The two halves

| | What it is | Where it goes |
|---|---|---|
| **`plugin/`** | A small WordPress plugin. One settings field. Sends a heartbeat when asked. | Zip it and upload to each site you want to watch |
| **`skill/`** | An OpenClaw skill. Does the asking, the checking, and the emailing. | Copy into your agent's workspace |

Neither is useful without the other, which is why they live in one repo and share a
version number.

---

## Quick start

**1. Install the plugin** on a site. Zip `plugin/mail-canary/`, upload it under
Plugins → Add New → Upload Plugin, activate.

**2. Set the destination.** Settings → Mail Canary. Enter the mailbox your agent reads.
One field, that's all.

**3. Copy the command** it shows you and paste it into OpenClaw:

```
/mail-canary add https://yoursite.com/wp-json/mail-canary/v1/ping?token=…
```

**4. Done.** It runs a full check immediately and tells you whether that site's email
works. Repeat step 1–3 for each site.

Full walkthrough, written for someone who has never done this before:
**[docs/SETUP.md](docs/SETUP.md)**

---

## What you'll hear from it

One short email each morning. On a good day it's a few lines saying every site is
sending normally — which also proves the monitoring itself is still alive.

When something breaks, the same email carries the whole picture:

```
acmedental.com - WordPress is refusing to send

wp_mail() is returning false, so nothing is leaving the site at all.

Error:        SMTP Error: 401 Unauthorized, the API key was rejected
Mailer:       WP Mail SMTP, sending via smtp.sendgrid.net
Last working: 17 August 09:14, which is 2 days 6 hours ago

What this means: contact form notifications and WooCommerce order
emails have not reached anyone for two days. Submissions and orders
are still being saved, so nothing is lost, but nobody has been told
about them.

Likely cause: a 401 from SendGrid almost always means the API key
was rotated or revoked.

When it is fixed, reply "check acmedental.com" and I will confirm
within a minute rather than waiting for tomorrow.
```

Every kind of email it can send: **[docs/EMAILS.md](docs/EMAILS.md)**

---

## Documentation

| Guide | What's in it |
|---|---|
| **[SETUP.md](docs/SETUP.md)** | Step by step from nothing, assuming no prior knowledge |
| **[COMMANDS.md](docs/COMMANDS.md)** | Every command, what it does, what you get back |
| **[EMAILS.md](docs/EMAILS.md)** | Every email type, when it fires, and what it means |
| **[TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)** | When something doesn't work |
| **[HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md)** | The design, for anyone extending it |

---

## Requirements

- **WordPress** 5.8+, PHP 7.4+
- **OpenClaw** running somewhere it stays online
- **A mailbox** with working IMAP and SMTP. Reached either through the **himalaya** CLI
  that ships with OpenClaw (the default, works with any IMAP account) or through the
  **AgentMail** API. Gmail and Outlook both have problems for this — see
  [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).
- **Somewhere to be notified.** Email by default, Telegram optional as a backup.

---

## Security, briefly

The plugin does very little on purpose. It stores none of your mail credentials, never
calls home, creates no database tables and schedules nothing. The only thing it can do is
send one fixed message to one address you configured. It does open an outbound connection
when it sends that message, because that is the entire job.

- **Token-protected endpoint**, compared with `hash_equals()` so there is no timing signal
- **Token travels in a request header**, not the URL, so it is never written into the
  site's access log. It appears in a URL exactly once, in the setup command you paste
  into your agent, and never again
- **Rate limited** to one heartbeat per minute, claimed atomically via `add_option()`
  rather than read-then-write, so concurrent requests cannot all slip through together
- **Rotatable token**, one click, old one dies immediately
- **Clean uninstall** — deleting the plugin removes everything it stored

Even with a stolen token, the worst anyone can do is make your site email you a
heartbeat once a minute, to an address only an administrator can change.

The response deliberately does not include the site's admin email or anything else the
monitor has no use for. Full notes on what was reviewed and what changed are in
[HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md#security).

---

## Contributing

It's an experiment, and deliberately small. If you extend it, the design notes in
[HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md) explain why things are the way they are —
particularly the rule that shapes the whole thing:

> **A verdict must never outlive its evidence.**

Most of the bugs found while building this were versions of the same mistake: reporting
a stored result as though it were current. If you change the state logic, that's the
thing to hold onto.

---

## Licence

GPL-2.0-or-later: you may use it under version 2 of the GNU General Public License or,
at your option, any later version. [LICENSE](LICENSE) holds the full text of version 2,
which is why GitHub labels the repository GPL-2.0.
