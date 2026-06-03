# Agent quickstart

Use this when an AI agent should deploy **pinglet** or help a human add it to a package.

## What pinglet is

A tiny npm package that tracks **real runtime usage** (not download counts).  
Package authors add 5 lines of code → deploy a server → see active users, commands, versions.

---

## 1. Deploy the pinglet server

The human needs **one** server. All packages send analytics to it.

### Option A: Railway (easiest — 2 minutes)

1. Human pushes the **pinglet repo** to GitHub.
2. Human creates a Railway project from that repo.
3. **Agent runs:**
   ```bash
   railway volume add --mount-path /data
   railway variables set PINGLET_DATA_DIR=/data PINGLET_ADMIN_USER=admin PINGLET_ADMIN_PASSWORD=$(openssl rand -base64 32)
   railway up --detach
   ```
4. Get URL: `railway domain`
5. Verify: `curl https://app.up.railway.app/health`

**Known limitation:** Railway deploy API sometimes times out. If `railway up` fails with timeout, retry after 30 seconds. The server stays online during retries.

### Option B: Docker (any host)

```bash
docker build -t pinglet . 2>/dev/null || true
# Use the Dockerfile if present, otherwise skip build
docker run -d -p 3456:3456 \
  -v pinglet-data:/data \
  -e PINGLET_DATA_DIR=/data \
  -e PINGLET_ADMIN_USER=admin \
  -e PINGLET_ADMIN_PASSWORD=$(openssl rand -base64 32) \
  --restart unless-stopped \
  node:22-alpine sh -c "npm install -g @black-knight.dev/pinglet && pinglet-server"
```

### Option C: Self-host (no Docker, no cloud)

```bash
npx -p @black-knight.dev/pinglet pinglet-server
```

Use a terminal multiplexer like `tmux` or `screen` to keep it running after logout.

---

## 2. Login from the agent environment

Once the server is online:

```bash
npx pinglet login --url https://your-server.example.com --user admin
```

Ask the human for the admin password. Never ask them to type it in plain view.

After login, the agent can read analytics without the password:

```bash
npx pinglet                # status overview
npx pinglet ls             # list tracked packages
npx pinglet my-package     # stats for a package
npx pinglet health         # server health check
```

The login token is stored in `~/.config/pinglet/config.json` (mode 0o600).

---

## 3. Add pinglet to a package

### Install

```bash
npm install @black-knight.dev/pinglet
```

### Add code

In the package entrypoint (CLI main, server start, MCP server, etc.):

```ts
import { Pinglet } from '@black-knight.dev/pinglet';

const analytics = new Pinglet({
  packageName: '@scope/package-name',  // exact npm name
  packageVersion: '1.0.0',            // semver
  endpoint: 'https://your-server.example.com/ping',
});
```

Then track events:

```ts
await analytics.track('run');
await analytics.track('command:build');
await analytics.track('server:start');
await analytics.track('tool:call');
```

### Generate a code snippet automatically

If the agent is logged in:

```bash
npx pinglet snippet @scope/package-name
```

---

## 4. Privacy rules for agents

**Never track these:**
- Research queries, prompts, user input
- Source code, file paths, project names (except the package name itself)
- URLs, environment variables, API keys, secrets, tokens
- Logs, stack traces, raw command arguments
- Any user-generated content

**Safe to track:**
- `run`, `tool:call`, `tool:success`, `tool:error`
- `command:build`, `command:deploy`, `command:start`
- `server:start`, `cli:login`, `cli:stats`
- Non-PII metadata: `mode=fast`, `host=claude-code`

---

## 5. Read analytics

```bash
npx pinglet                                  # status: server + packages
npx pinglet @scope/package-name              # detailed stats
npx pinglet @scope/package-name --json       # raw JSON
```

Analytics available:
- Total pings, unique anonymous users
- Events/commands used
- Active versions
- Platform split (macOS, Linux, Windows)
- CI vs local usage
- Usage by day

---

## 6. Consent flow (for end users)

When a user runs `npm install` of the package in an interactive terminal, a postinstall script asks:

```
Level [0-3] (default 2):
  0 — No telemetry
  1 — Basic: just "the tool was run"
  2 — Standard: run + which commands  ← default
  3 — Extended: + non-PII metadata
```

CI installs never ask. No tracking at `npm install`. Users can opt out anytime with:
`PINGLET_OPT_OUT=1`, `DO_NOT_TRACK=1`, `--no-telemetry`

---

## 7. Troubleshooting for agents

### Ping not arriving?
```bash
# Check server health
curl https://your-server.example.com/health

# Check if logged in
npx pinglet health

# Test ping manually
curl -X POST https://your-server.example.com/ping \
  -H 'content-type: application/json' \
  -d '{"pkg":"test","pkgVersion":"1.0","event":"run","clientId":"test","platform":"linux","ci":false}'

# Check if package appears
npx pinglet ls
```

### Deploy failed?
- Railway: retry after 30 seconds (API sometimes times out)
- Docker: check if port 3456 is free
- Self-host: check if the process is still running

### No data after adding code?
- Did the human publish the new version of their package?
- Did someone actually run the command that triggers `track()`?
- Check the server has a volume mounted (data survives redeploys)
