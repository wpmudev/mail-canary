# Demo mode

`demo.mjs` loads any state on demand, so every screen can be captured without waiting for
a real site to break.

Fixtures are marked `demo: true` and `frozen: true`. Frozen sites are skipped by
`ping.mjs`, so nothing calls out to the network and the fixtures hold still while you
screenshot. Real sites survive every scene; `demo off` removes only the fixtures.

```
/mail-canary demo             list scenes
/mail-canary demo <scene>     load one
/mail-canary demo journey     ordered walkthrough
/mail-canary demo off         remove fixtures, keep real sites
```

## Scenes

| Scene | State |
|---|---|
| `reset` | Nothing tracked |
| `healthy` | Three sites delivering — proves the skill stays quiet |
| `one-strike` | A single miss, deliberately not alerted |
| `smtp-broken` | `wp_mail()` returned false, with a real error string |
| `not-delivered` | Accepted but never arrived, two strikes |
| `plugin-removed` | Endpoint 404 — monitoring stopped, must never look healthy |
| `site-down` | Unreachable — correctly not an email alert |
| `never-worked` | A site whose email has never once been delivered |
| `recovered` | Back to working after a failure |
| `mixed` | Everything at once — the batched alert |

## Walkthrough

| # | Scene | Send | Captures |
|---|---|---|---|
| 1 | `reset` | `/mail-canary list` | Empty state |
| 2 | `reset` | `/mail-canary add <url>` | Adding a site with one paste |
| 3 | `healthy` | `/mail-canary list` | Three healthy sites |
| 4 | `healthy` | `/mail-canary check` | Nothing wrong — silence |
| 5 | `one-strike` | `/mail-canary check` | One miss, not alerted |
| 6 | `smtp-broken` | `/mail-canary check` | Instant failure with the real error |
| 7 | `not-delivered` | `/mail-canary check` | Two strikes, then alert |
| 8 | `site-down` | `/mail-canary check` | Site down, not an email alert |
| 9 | `never-worked` | `/mail-canary check` | Inherited site that never worked |
| 10 | `mixed` | `/mail-canary check` | Every state at once |
| 11 | `recovered` | `/mail-canary check` | Recovery confirmation |

Scenes 4, 5 and 8 are the ones worth including even though nothing dramatic happens.
They are what separates a monitor people trust from one they mute — a tool that stays
quiet when all is well, waits before crying wolf, and refuses to blame email for a
problem that is not email.

Scene 10 is the one to use if only one screenshot is used.

## Rules

- **Never present demo output as real data.** If asked, say plainly these are fixtures.
- Run `demo off` when finished — leaving fixtures means the daily job keeps reporting on
  sites that do not exist.
- Real sites survive every scene, so adding one mid-demo is safe.
