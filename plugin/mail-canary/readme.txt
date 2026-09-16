=== Mail Canary ===
Contributors: wpmudevexperiments
Tags: email, smtp, monitoring, deliverability, wp_mail
Requires at least: 5.8
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Lets an external monitor confirm this site's email is actually being delivered, not just handed off.

== Description ==

**About this project.** Mail Canary came out of a run of small projects exploring what
people can build with AI agents and WordPress. Use it as it is, or as a starting point to
shape something that fits how you work.

WordPress email fails silently. An SMTP key gets rotated, a free tier hits its daily
limit, a host lands on a blacklist, and contact form notifications simply stop arriving
with no error anywhere.

The catch is that `wp_mail()` returning true only means WordPress handed the message off.
Most real failures happen after that point, and WordPress reports success the whole time.

Mail Canary exposes one token-protected endpoint. When an external monitor calls it, this
site sends a heartbeat email through `wp_mail()` — using whatever SMTP plugin is already
configured — and reports back what happened locally. The monitor then checks whether that
exact heartbeat arrived.

This plugin is one half of the system. The monitoring side is an OpenClaw skill, available
with the plugin at https://github.com/wpmudev/mail-canary

= What it does not do =

* No phoning home. The site talks to nobody except your own mail server, and only to
  send the heartbeat you asked for.
* None of your mail credentials are stored. Those stay in whichever SMTP plugin you
  already use. No database tables, no scheduled tasks.
* No reading of your email. It only sends.
* It can only ever send one fixed message to one address an administrator configured.

== Installation ==

1. Upload and activate the plugin
2. Go to Settings, then Mail Canary
3. Enter the mailbox your monitor watches
4. Copy the command shown and paste it into your monitor

== Frequently Asked Questions ==

= Does this send email to my visitors or clients? =

No. It sends one small automated message to an address you configure, and nowhere else.

= What happens if the token leaks? =

The endpoint accepts one heartbeat per minute, and that limit is claimed atomically, so
sending a burst of simultaneous requests does not get past it. The message body and the
destination are fixed, so a leaked token cannot be used to send anything to anyone else.
You can issue a new token from the settings screen at any time; the old one stops working
immediately.

= Where does the token travel? =

In an X-Mail-Canary-Token request header, so it is never written into your web server's
access log. It appears in a URL exactly once, in the setup command you copy from the
settings page, and never again after your monitor has stored it.

= Does it work with my SMTP plugin? =

It uses `wp_mail()`, so it inherits whatever is already configured. WP Mail SMTP,
FluentSMTP, Post SMTP, Easy WP SMTP, Mailgun and SendGrid are detected by name; anything
else still works, it just reports as "none detected".

= Will it slow my site down? =

No. It does nothing at all until an authenticated request arrives, which is typically
once a day.

== Changelog ==

= 1.1.0 =
* Security: the token is now read from an X-Mail-Canary-Token header first, so it is no
  longer written into the site's access log on every check. The query string and JSON
  body are still accepted so existing monitors keep working.
* Security: the one-per-minute rate limit is now claimed atomically, so a burst of
  simultaneous requests can no longer all slip through together.
* Security: the ping response no longer returns the site's admin email address. Nothing
  ever used it.
* The settings page test button now bypasses the rate limit for its own send instead of
  clearing it for everyone.
* Responses include token_in_url so a monitor can tell you to update.

= 1.0.0 =
* First release
