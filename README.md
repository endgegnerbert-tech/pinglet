# pinglet

> Tiny anonymous runtime analytics for Node.js CLI tools — real usage, not npm download noise.

`pinglet` helps package authors answer: **is my CLI actually being used?** It sends small runtime pings only when the tool runs. It does **not** run on `npm install`.

## Why

npm downloads include CI installs, mirrors, caches and bots. For CLI tools, downloads are not the same as active usage. `pinglet` tracks runtime events like `run`, `command:build`, or `error:config` with privacy-first defaults.

## Privacy defaults

| Collected | Not collected |
| --- | --- |
| Anonymous random client id | Hardware id, hostname, username |
| Event name | File paths, source code, logs |
| Package/version | Env vars, secrets, tokens |
| Node version, platform | User generated content |
| CI flag | IP address in client payload |
| Server timestamp | Local timezone/client clock |

Important: the bundled server does not store IPs, but your hosting provider/proxy may log access IPs. Disable or anonymize access logs if you need stricter privacy.

## What you can see

The built-in server returns aggregate stats like:

- total runtime pings
- anonymous unique users
- events/commands used
- active package versions
- platform split
- CI vs local usage
- pings per day

See [`docs/maintainer-guide.md`](docs/maintainer-guide.md) for the full integration checklist and a README telemetry disclosure you can copy.

## Install

```bash
npm install pinglet
```

## Client usage

```ts
import { Pinglet } from 'pinglet';

const analytics = new Pinglet({
  packageName: 'my-cli',
  packageVersion: '1.0.0',
  endpoint: 'https://your-pinglet-server.example/ping',
});

await analytics.init();
await analytics.track('run');
await analytics.track('command:build', { target: 'production' });
```

### Consent and opt-out

By default, `pinglet` asks once in interactive terminals. In non-interactive terminals it does not send until consent can be asked. If your app has its own consent/privacy notice, you can disable the built-in prompt:

```ts
new Pinglet({
  packageName: 'my-cli',
  packageVersion: '1.0.0',
  endpoint: 'https://example.com/ping',
  askConsent: false,
});
```

Users can always opt out:

```bash
PINGLET_OPT_OUT=1 my-cli
DO_NOT_TRACK=1 my-cli
my-cli --no-telemetry
my-cli --disable-telemetry
```

Persistent local state is stored under `~/.config/pinglet/` or `$XDG_CONFIG_HOME/pinglet/`.

## Self-hosted server

Local:

```bash
npx -p pinglet pinglet-server
```

Production-style:

```bash
PORT=3456 \
PINGLET_DATA_DIR=./telemetry-data \
PINGLET_ADMIN_USER=admin \
PINGLET_ADMIN_PASSWORD=change-this-long-random-password \
npx -p pinglet pinglet-server
```

Endpoints:

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/ping` | Receive a runtime event |
| `POST` | `/auth/login` | Create a 30-day CLI admin token |
| `GET` | `/auth/check` | Verify saved CLI login token |
| `GET` | `/packages` | List tracked packages, admin auth if configured |
| `GET` | `/stats?pkg=my-cli` | Aggregated analytics, admin auth if configured |
| `GET` | `/health` | Health check |

### Deploy on Railway

Short version:

1. Push this repo to GitHub.
2. Create a Railway project from the GitHub repo.
3. Add a persistent volume mounted at `/data`.
4. Set environment variables:

```bash
PINGLET_DATA_DIR=/data
PINGLET_ADMIN_USER=admin
PINGLET_ADMIN_PASSWORD=<long-random-password>
```

Railway will use `railway.json` and `npm start` to run the server.

Full idiot-proof guide: [`docs/deploy-railway.md`](docs/deploy-railway.md).

### Login once, then read analytics

```bash
npx pinglet login --url https://your-app.up.railway.app --user admin
```

Enter your admin password once. The CLI stores a 30-day admin token locally, not your password.

Then use:

```bash
npx pinglet packages
npx pinglet stats --pkg my-cli
```

Generate copy-paste SDK code for your package:

```bash
npx pinglet snippet --pkg my-cli --package-version 1.0.0
```

Example stats:

```json
{
  "pkg": "my-cli",
  "totalPings": 1420,
  "uniqueUsers": 312,
  "events": { "run": 980, "command:build": 310 },
  "versions": { "1.0.0": 1420 },
  "platforms": { "darwin": 800, "linux": 620 },
  "ci": { "true": 40, "false": 1380 },
  "days": { "2026-06-03": 1420 }
}
```

You can also import the server:

```ts
import { startPingletServer } from 'pinglet/server';

startPingletServer({ port: 3456, dataDir: './data' });
```

## API

### `new Pinglet(options)`

| Option | Required | Description |
| --- | --- | --- |
| `packageName` | yes | Your package name |
| `packageVersion` | yes | Current version |
| `endpoint` | yes | URL receiving `POST /ping` |
| `askConsent` | no | Built-in first-run prompt, default `true` |
| `salt` | no | Stable salt for anonymous local id |
| `silent` | no | Suppress console output |
| `timeoutMs` | no | Network timeout, default `1500` |
| `ingestToken` | no | Optional write token for private/internal telemetry endpoints |
| `meta` | no | Non-PII primitive properties on every event |

### Methods

- `await pinglet.init()` — handle consent once.
- `await pinglet.track(event, properties?)` — send event, never throws.
- `pinglet.optOut()` — persistently disable telemetry.
- `pinglet.optIn()` — persistently enable telemetry.
- `pinglet.isOptedOut` — current opt-out state.

## Best-practice checklist for package authors

- Add a visible `Telemetry` section to your README.
- Never track during `npm install` / postinstall.
- Keep events low-cardinality: `command:build`, not full user input.
- Do not send paths, project names, source code, logs, stack traces, tokens or free text.
- Support `DO_NOT_TRACK=1` and a package-specific opt-out env var.
- Keep telemetry failures silent and non-blocking.

More notes:

- [`docs/deploy-railway.md`](docs/deploy-railway.md) — step-by-step Railway deployment.
- [`docs/agent-quickstart.md`](docs/agent-quickstart.md) — instructions for AI agents adding pinglet to another CLI.
- [`docs/maintainer-guide.md`](docs/maintainer-guide.md) — what users need to do to add pinglet.
- [`docs/market-research.md`](docs/market-research.md) — positioning and product research.
- [`examples/basic-cli.mjs`](examples/basic-cli.mjs) — minimal CLI example.

## License

MIT
