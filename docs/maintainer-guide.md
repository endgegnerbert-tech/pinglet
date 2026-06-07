# Maintainer guide

This is the page package authors should read before adding `pinglet` to a CLI.

## What you will be able to see

With the built-in server, you can see aggregated package usage:

```json
{
  "pkg": "my-cli",
  "totalPings": 1420,
  "uniqueUsers": 312,
  "events": {
    "run": 980,
    "command:build": 310,
    "command:deploy": 130
  },
  "versions": {
    "1.4.0": 900,
    "1.3.2": 520
  },
  "platforms": {
    "darwin": 800,
    "linux": 500,
    "win32": 120
  },
  "ci": {
    "true": 40,
    "false": 1380
  },
  "days": {
    "2026-06-03": 1420
  }
}
```

This is enough to answer:

- how many anonymous active users your CLI has
- which commands/features are used
- whether a version is still active
- whether usage is mostly CI or local users
- which platforms matter most
- whether usage changed after a release/post

## 1. Run a server

For local testing:

```bash
npx -p @black-knight.dev/pinglet pinglet-server
```

For deployment:

```bash
PORT=3456 \
PINGLET_DATA_DIR=/var/lib/pinglet \
PINGLET_ADMIN_USER=admin \
PINGLET_ADMIN_PASSWORD=change-this-long-random-password \
npx -p @black-knight.dev/pinglet pinglet-server
```

`POST /ping` is public by default so open-source packages can send runtime pings without shipping a secret in the npm package. `GET /stats` and `GET /packages` are protected when `PINGLET_ADMIN_PASSWORD` is set.

Optional: set `PINGLET_INGEST_TOKEN` only for private/internal tools. Do not put a secret token into a public npm package; users can read it.

## 2. Add the SDK to your CLI

```bash
npm install @black-knight.dev/pinglet
```

```ts
import { Pinglet } from '@black-knight.dev/pinglet';

const analytics = new Pinglet({
  packageName: 'my-cli',
  packageVersion: '1.0.0',
  endpoint: 'https://telemetry.example.com/ping',
});

await analytics.track('run');
```

## 3. Track only low-cardinality events

Good:

```ts
await analytics.track('command:build');
await analytics.track('command:deploy');
await analytics.track('error:config');
```

Avoid:

```ts
await analytics.track(`command:${rawUserInput}`);
await analytics.track('error', { stack: error.stack });
await analytics.track('open-file', { path: filePath });
```

## 4. Add a README telemetry disclosure

Copy this into your package README:

````markdown
## 📡 Telemetry

This package collects anonymous runtime usage data via pinglet
to understand which features are used and improve the project.

**Collected:**
- event name, e.g. `run` or `command:build`
- package version
- Node.js version
- platform (`darwin`, `linux`, `win32`)
- whether it appears to run in CI
- anonymous random client id (SHA-256 hashed, one-way)

**Not collected:**
- source code or file contents
- file paths, project names, git remotes
- usernames, hostnames, environment variables, secrets
- logs, stack traces, raw command arguments

**Opt out:**

```bash
DO_NOT_TRACK=1 my-command
PINGLET_OPT_OUT=1 my-command
my-command --no-telemetry
```

[Learn more about pinglet telemetry](https://github.com/endgegnerbert-tech/pinglet)
````

## 5. Login once and check analytics from your terminal

Install the CLI:

```bash
npm install -g @black-knight.dev/pinglet
# or via npx: npx -p @black-knight.dev/pinglet pinglet login ...
```

Then login:

```bash
pinglet login --url https://telemetry.example.com --user admin
```

Enter the admin password once. The CLI stores a 30-day token locally, not your password.

Then:

```bash
pinglet packages
pinglet stats --pkg my-cli
```

You can also generate copy-paste SDK code for your package:

```bash
pinglet snippet --pkg my-cli --package-version 1.0.0
```

Useful commands:

```bash
pinglet status
pinglet logout
```

You will see:

- real active usage: total pings and anonymous active users
- commands/features: event counts
- active versions: version distribution
- CI vs local usage
- platform split: macOS/Linux/Windows
- usage by day

## Railway deploy checklist

1. Push the repo to GitHub.
2. Create a Railway project from the repo.
3. Add a persistent volume mounted at `/data`.
4. Set env vars:

```bash
PINGLET_DATA_DIR=/data
PINGLET_ADMIN_USER=admin
PINGLET_ADMIN_PASSWORD=<long-random-password>
```

5. Railway runs `npm start` from `railway.json`.
6. Login once:

```bash
pinglet login --url https://your-app.up.railway.app --user admin
```

   (Install the CLI first: `npm install -g @black-knight.dev/pinglet`)

7. Put the Railway URL into your package as the `endpoint` with `/ping` appended.

Example client endpoint:

```ts
endpoint: 'https://your-app.up.railway.app/ping'
```

## Recommended first events

For most CLIs, start with only these:

| Event | When |
| --- | --- |
| `run` | CLI starts successfully |
| `command:<name>` | a top-level command is invoked |
| `error:<code>` | a known sanitized error happens |

Do not track every internal step. Keep the signal small and understandable.
