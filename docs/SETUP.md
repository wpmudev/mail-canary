# Setup

Written assuming you've never done this before. About fifteen minutes, most of which is
getting a mailbox.

---

## What you need first

**1. OpenClaw, running somewhere it stays online.** On WPMU DEV Unlimited Hosting it's a
one-click app. Anywhere else works too, as long as it's always on — a laptop that sleeps
won't check anything overnight.

**2. A mailbox your agent can use.** This is the only fiddly part, so it's worth getting
right.

It needs **IMAP** (so the agent can read the heartbeats) and **SMTP** (so it can email
you when something breaks). Same account does both.

| Option | Verdict |
|---|---|
| **AgentMail** free plan | ✅ Easiest. Gives the agent its own address in a couple of minutes. |
| **Custom domain mailbox** (`canary@youragency.com`) | ✅ Works well. WPMU DEV Pro Email, Fastmail, most hosts. |
| **Gmail** | ⚠️ Needs an app password, caps at 500 sends/day, and Google has suspended accounts for automation. |
| **Outlook / Microsoft** | ❌ Basic auth was retired in April 2026. Doesn't work. |

**Give it its own mailbox.** Not your inbox, not a client's. It'll collect a few
automated messages a day and nothing else, and mixing it with real mail makes everything
harder to reason about.

**3. An address to be notified at.** Your normal work email. It must be different from
the canary mailbox — alerts need to land somewhere you actually read.

---

## Step 1: connect the mailbox

Mail Canary reads and sends through one of two providers. Pick whichever suits the
mailbox you chose.

### Option A: himalaya (default, any IMAP mailbox)

Himalaya is a mail CLI that ships with OpenClaw. Configure it with your canary mailbox's
IMAP and SMTP credentials — ports are usually **993** for IMAP and **587** for SMTP, and
your provider will confirm.

Check it works:

```bash
himalaya envelope list -o json
```

If that returns JSON, you're done. Nothing further to set.

### Option B: AgentMail

If you're using AgentMail, set the provider and supply a key. In
`mail-canary-data/settings.json`:

```json
{
  "mail_provider": "agentmail",
  "agentmail_api_key": "..."
}
```

The key can also come from an `AGENTMAIL_API_KEY` environment variable, or from a file
you point at with `"env_file": "/path/to/.env"`.

**Either way, confirm the mailbox is readable before continuing.** Without it there is no
way to tell a delivered heartbeat from a lost one, and every alert would be a guess.

---

## Step 2: install the skill

Only the `skill/mail-canary/` folder goes into your agent. The plugin half of
this repo has no business in an agent workspace.

```bash
git clone https://github.com/wpmudev/mail-canary.git
openclaw skills install ./mail-canary/skill/mail-canary
```

A `git:` install will not work here, because OpenClaw expects `SKILL.md` at the
root of whatever it clones and this repo keeps it one level down.

Or copy it by hand, if you'd rather:

```bash
scp -r skill/mail-canary you@yourserver:~/<app>/public_html/.openclaw/workspace/skills/
```

