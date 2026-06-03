# AI agent quickstart

Use this when an AI coding agent should add `pinglet` analytics to a Node.js CLI/package.

## Goal

Set up privacy-first runtime analytics with minimal human input.

The agent should help with:

1. checking whether a pinglet server URL exists
2. logging into the server once, if needed
3. generating a snippet
4. adding the SDK to the target CLI
5. adding a telemetry disclosure to the target README
6. verifying pings and reading stats

## Human input required

Ask the human for only these values:

- pinglet server URL, e.g. `https://your-app.up.railway.app`
- admin username, usually `admin`
- admin password, only for `pinglet login`
- target package name
- target package version

Never ask the human for secrets that will be embedded into a public npm package.

## Commands for the agent

### 1. Check server

```bash
curl https://your-app.up.railway.app/health
```

Expected:

```json
{"ok":true,"version":"0.1.0"}
```

### 2. Login once

```bash
npx pinglet login --url https://your-app.up.railway.app --user admin
```

The human enters the password. The CLI stores a token, not the password.

### 3. Generate SDK snippet

```bash
npx pinglet snippet --pkg my-cli --package-version 1.0.0
```

### 4. Add dependency

If `pinglet` is published:

```bash
npm install pinglet
```

For local dogfooding before publishing:

```bash
npm install ../pingu
```

### 5. Add minimal SDK code

For a CLI entrypoint:

```ts
import { Pinglet } from 'pinglet';

const analytics = new Pinglet({
  packageName: 'my-cli',
  packageVersion: '1.0.0',
  endpoint: 'https://your-app.up.railway.app/ping',
});

await analytics.track('run');
await analytics.track('command:build');
```

For MCP/agent tools that cannot prompt in stdio mode, do not show interactive consent inside the protocol stream. Either:

- keep telemetry disabled unless an endpoint env var is set, or
- document telemetry clearly and use `askConsent: false` only after the host app has its own disclosure.

## Privacy rules for agents

Never track:

- prompts
- queries
- source code
- file paths
- project names, unless explicitly intended as package names
- URLs
- raw command arguments
- stack traces
- logs
- env vars
- tokens/secrets

Good events:

```txt
run
tool:call
tool:success
tool:error
command:build
command:deploy
```

Good properties:

```txt
mode=fast
host=claude-code
command=build
```

## Verify

Trigger the target CLI once, then read stats:

```bash
npx pinglet packages
npx pinglet stats --pkg my-cli
```

Expected stats should include:

- total pings
- active users
- commands/features
- active versions
- platforms
- CI vs local
- usage by day

## Railway deployment for agents

If the human wants the agent to deploy:

1. Verify Railway CLI is installed and logged in:

```bash
railway whoami
```

2. If not logged in, stop and ask the human to run Railway login.
3. Create/deploy the project only after human confirmation.
4. Set these variables:

```bash
PINGLET_DATA_DIR=/data
PINGLET_ADMIN_USER=admin
PINGLET_ADMIN_PASSWORD=<human-provided-long-random-password>
```

5. Ensure a persistent volume is mounted at `/data`.

Do not silently deploy paid/cloud resources without explicit human approval.
