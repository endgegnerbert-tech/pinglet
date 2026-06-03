# Market research: npm / CLI runtime analytics

## Short conclusion

Package authors do not need another npm-download dashboard. They need a small, trustworthy way to answer questions npm downloads cannot answer:

- Did anyone actually run my CLI?
- Which commands/features are used?
- Which package versions are still active?
- Are users on macOS/Linux/Windows?
- Is usage real user activity or mostly CI?
- Did a release increase/decrease active usage?

`pinglet` should stay focused on **runtime analytics for CLI/package authors**, not general website analytics, security scanning, or bundle-size scoring.

## What existing tools already cover

| Area | Existing tools | Gap for pinglet |
| --- | --- | --- |
| Download counts | npm download API, npm-stat, npm trends dashboards | Counts installs/downloads, not executions |
| Popularity comparison | npm trends-style tools | Good for market trends, weak for one maintainer's active users |
| Security/dependency health | Socket, Snyk, deps.dev, OpenSSF Scorecard | Different problem; do not compete early |
| Website analytics | Plausible, PostHog, Sleek, Simple Analytics | Browser/web focus, not CLI runtime usage |
| Heavy observability | OpenTelemetry, Application Insights, Segment | Too much setup for a small package author |
| Internal CLI telemetry | Astro, AWS CDK, Salesforce, Next.js-style telemetry | Built for one project, not a neutral drop-in SDK |

## What maintainers likely want first

Priority order for MVP:

1. **Active users** — unique anonymous clients by day/week/month.
2. **Events by command/feature** — `run`, `command:build`, `command:deploy`.
3. **Version adoption** — which released versions are still actually used.
4. **Trend over time** — did the latest release/post improve usage?
5. **CI vs local** — separate automation noise from human CLI usage.
6. **Platform split** — enough to prioritize bugs/support.
7. **Low friction setup** — 5 lines client code + one server command.
8. **Trust story** — visible telemetry disclosure, no install-time requests, easy opt-out.

Later, only after adoption:

- hosted dashboard
- CSV/export/API keys
- retention cohorts
- project/team accounts
- alerts for usage drops/errors

## What developers do NOT want

Avoid these because they trigger distrust:

- network requests during `npm install` or `postinstall`
- hidden telemetry with no README section
- no opt-out
- collecting commands with raw user arguments
- file paths, project names, git remotes, source code, env vars, logs, stack traces
- pretending hashed/pseudonymous identifiers are automatically "not personal data"
- sending data to Google Analytics or a third-party ad/marketing platform by default
- a huge SDK with many dependencies

## Product positioning

Best one-liner:

> Tiny anonymous runtime analytics for Node.js CLI tools — real usage, not npm download noise.

Best launch angle:

> npm downloads tell you who installed. `pinglet` tells you if your CLI is actually used.

Best trust angle:

> No install-time tracking. No paths, secrets, logs, hostnames or usernames. Self-hostable. Opt-out built in.

## Evidence from research

- npm's official download-count API reports total package downloads over a time range from processed registry logs; it does not represent runtime usage.
- Astro documents anonymous CLI telemetry and explicit opt-out via command/env var, while listing data it does and does not collect.
- AWS CDK documents telemetry data minimization, redaction, opt-out, and avoidance of full logs/stack traces without explicit opt-in.
- Developer-tool telemetry backlash is usually about defaults, vague disclosure, pseudonymous identifiers, and collection inside sensitive CLI workflows.

## Decision for pinglet

Keep v0.1 intentionally small:

- SDK + self-hosted NDJSON server
- aggregate stats endpoint
- README disclosure template
- tests proving no PII-ish fields are sent/stored

Do not build a dashboard yet. First validate that maintainers install it and ask for richer views.
