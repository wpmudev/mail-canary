# Changelog

An experimental project, so expect this list to move in bigger steps than a settled
product would.

## 1.1.0

Security review of the plugin. No critical vulnerabilities were found; these are the
things that were wrong anyway.

### Fixed

- **The token no longer travels in the URL.** It is read from an `X-Mail-Canary-Token`
  header first, so it stops being written into each site's web server access log on every
  check. The JSON body and query string are still accepted, so sites on 1.0.0 keep
  working, and the response now reports `token_in_url` so the monitor can prompt you.
- **The rate limit is now atomic.** It read a transient, decided, then wrote one, which
  meant concurrent requests could all pass the check together. It now claims a
  time-bucketed option through `add_option()`, where the unique index on `option_name`
  lets exactly one caller win.
- **The ping response no longer discloses the site's admin email.** `from_address` was
  returned to any token holder and nothing in the skill ever read it.
- **The settings page test no longer clears the shared cooldown**, which briefly gave a
  free send to anyone else holding the token. It bypasses the limit for its own send.

### Changed

- The skill sends the token in a header, keeping the body for older plugin builds.
- README, plugin readme, HOW-IT-WORKS, TROUBLESHOOTING and SKILL.md corrected. The README
  previously claimed the token was "sent in a POST body, never a query string", and the
  plugin readme claimed "no outbound connections. The site never contacts anything" when
  sending mail is exactly that.
- `uninstall.php` clears the rate limiter's options too.

## 1.0.0

First release.

**Plugin**
- Token-protected `/ping` endpoint, accepts GET and POST
- Sends a heartbeat through `wp_mail()` and reports the local result
- Detects which mail plugin is active and which SMTP host was used
- Rate limited to one heartbeat per minute
- Token rotation from the settings screen
- Clean uninstall, multisite aware
- Fully translatable

**Skill**
- Two-stage check: ask the site, then verify the mailbox ten minutes later
- Nine states, including four that mean "cannot check" rather than "broken"
- Alert thresholds per state: immediate for `wp_mail()` failures, two strikes for
  delivery misses
- Daily digest with a single-word verdict
- Eleven demo fixtures for screenshots and testing
- Falls back to GET for sites still on the first plugin build
