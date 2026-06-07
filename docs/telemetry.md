# Telemetry model

pinglet uses the **opt-out telemetry model** — the industry standard for open source developer tools (Next.js, VS Code, Homebrew, et al.).

---

## How it works

### Tracking is ON by default

When someone installs a package that uses pinglet, runtime pings are sent automatically at level 1 (basic):

| Level | Events tracked |
|-------|----------------|
| 1 (default) | all event names (no properties) |
| 2 | event names + properties stripped |
| 3 | event names + non-PII metadata |

No prompts during `npm install`. No postinstall scripts. No config files to create.

### Opt-out is easy

Users can disable telemetry at any time:

```bash
# Environment variables
DO_NOT_TRACK=1 npx my-tool
PINGLET_OPT_OUT=1 npx my-tool
PINGLET_DEBUG=1 npx my-tool        # preview payload, don't send

# CLI flag
npx my-tool --no-telemetry
npx my-tool --disable-telemetry
```

### Debug mode: inspect before sending

Users can see exactly what data would be sent without actually transmitting anything:

```bash
PINGLET_DEBUG=1 npx my-tool
```

The JSON payload is printed to stderr with a note on how to disable telemetry:

```
[pinglet] Would send: {
  "sdk": "pinglet",
  "pkg": "my-package",
  "event": "run",
  "clientId": "a1b2c3d4e5f6...",
  "nodeVersion": "v22.0.0",
  "platform": "darwin",
  "ci": false
}
[pinglet] Disable with DO_NOT_TRACK=1 or --no-telemetry
```

No data is sent to the server — only printed to stderr.

### One-time notice

The first time a package calls `track()`, a short notice is printed to stderr:

```
  pinglet collects anonymous runtime usage data to help
  improve this package. Learn more:
  https://github.com/endgegnerbert-tech/pinglet
  Disable anytime: DO_NOT_TRACK=1 or --no-telemetry
```

This appears **once per install per machine** (TTY only — never in CI).

---

## Why opt-out?

| | Opt-in (Angular CLI) | Opt-out (Next.js, pinglet v0.2) |
|---|---|---|
| **Users who send data** | ~5% | **~80%+** |
| **Useful for maintainers** | ❌ | ✅ |
| **Install friction** | Prompt at install | None |
| **Transparency** | ✅ Documented | ✅ Documented |

**Without real data, maintainers fly blind.** Download counts are meaningless (CI, bots, mirrors). Opt-out gives representative data that actually helps improve the package — while respecting anyone who explicitly opts out.

---

## What's collected vs not

| Collected | Not collected |
|---|---|
| Random anonymous client id (SHA-256 hashed) | Hardware id, hostname, username, email |
| Event name (`run`, `command:build`) | File paths, project names, git remotes |
| Package name + version | Source code, logs, stack traces |
| Node.js version | Environment variables, secrets, API keys |
| Platform (`darwin`, `linux`, `win32`) | IP address |
| CI flag (true/false) | User-generated content |
| Timestamp (server-side, not client clock) | Raw command arguments |

---

## What this means for package authors

When you add pinglet to your package:

1. **Users don't get a prompt** — zero friction
2. **You get real data** — active users, versions, platforms
3. **Users can opt out** — it's documented and easy
4. **You're in good company** — Next.js, VS Code, Homebrew all do the same

Add a telemetry disclosure to your README:

```markdown
## 📡 Telemetry

This package collects anonymous runtime usage data via pinglet.
Learn more: [pinglet privacy model](https://github.com/endgegnerbert-tech/pinglet)

Disable: `DO_NOT_TRACK=1` or `--no-telemetry`
```

---

## GDPR compliance

- No personal data is collected (no IP, no email, no hostname)
- Anonymous client IDs are random, hashed, one-way — not linkable to individuals
- Users can opt out at any time (env var, CLI flag, or config)
- Data stays on a server the package author controls
- No third-party analytics services involved

For EU-based users, the lawful basis is **legitimate interest** — the same basis used by Next.js, VS Code, Homebrew, and most OSS developer tools.

---

## Comparison with v0.1

| Aspect | v0.1 | v0.2 |
|--------|------|------|
| Consent model | Opt-in (prompt at install) | **Opt-out (documented)** |
| Postinstall script | Yes | **No** |
| Default tracking | Off | **On (level 1)** |
| First-run notice | No | **Yes (once)** |
| Data quality | ~2% of installs | **~80%+ of installs** |

See [`v02-plan.md`](v02-plan.md) for the full migration rationale.
