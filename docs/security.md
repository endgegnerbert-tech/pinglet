# Security & Privacy

## What pinglet collects — and doesn't

### Client sends

| Collected | Not collected |
| --- | --- |
| Anonymous random client id (SHA-256 hashed, one-way) | Real machine id, hardware serial |
| Event name (`run`, `command:build`) | Raw command arguments |
| Package name + version | File paths, project names, git remotes |
| Node.js version (`v22.0.0`) | Environment variables, secrets, API keys |
| Platform (`darwin`, `linux`, `win32`) | Username, hostname |
| CI flag (true / false) | User-generated content, logs, stack traces |
| Timestamp (server-side) | Client's local timezone / clock |

### Server stores

| Stored | Stripped before storage |
| --- | --- |
| Package name + version ✅ | IP address ❌ |
| Event name ✅ | Oversized fields (truncated at 128 chars) ✅ |
| Hashed client id ✅ | Arbitrary payload fields ❌ |

### Server never stores

- Access IPs in the payload
- Access logs (by default — your provider may still log)
- Secrets or credentials

## Consent model

1. **At `npm install`** (postinstall script): interactive terminal shows a level picker (0–3). Answer saved to `~/.config/pinglet/<package>.json`.
2. **Fallback at first run**: if postinstall never ran (CI, `--ignore-scripts`), the `Pinglet.init()` method asks once when TTY is available.
3. **Non-interactive environments**: never ask, never track.
4. **Opt-out overrides**: `PINGLET_OPT_OUT=1`, `DO_NOT_TRACK=1`, or `--no-telemetry`.

Choose from levels:

| Level | What | Example events |
| --- | --- | --- |
| 0 | Off — no telemetry | — |
| 1 | Basic | `run` only |
| 2 | Standard (default) | `run`, `command:build` |
| 3 | Extended | + non-PII metadata like `mode` |

## Anonymous client id

The client id is:

1. Random 32 bytes, never derived from hardware or user data
2. Hashed with SHA-256
3. Only 32 hex chars stored
4. Not reversible

If the state file is deleted, a new random id is generated. There is no way to link old and new ids.

## Server security

### Authentication

| Endpoint | Auth |
| --- | --- |
| `POST /ping` | Public (optionally protected by `PINGLET_INGEST_TOKEN`) |
| `GET /stats?pkg=` | Admin: Basic Auth or Bearer token |
| `GET /packages` | Admin: Basic Auth or Bearer token |
| `POST /auth/login` | Admin: Basic Auth → returns 30-day token |
| `GET /health` | Public |

### Rate limiting

- 200 pings per minute per IP address
- Returns HTTP 429 with `{"error":"Rate limit exceeded"}`

### Storage

- NDJSON files in `PINGLET_DATA_DIR`
- No database needed
- File permissions: `0o600` for config files, `0o700` for directories
- Admin sessions stored as SHA-256 hashed tokens in `.pinglet-admin-sessions.json`

### Transport

- Use HTTPS in production. Railway provides it automatically.
- The server does not enforce HTTPS — configure it at the proxy/reverse-proxy level.

## Deployment hardening

### Railway

1. Set a strong `PINGLET_ADMIN_PASSWORD` (generate: `openssl rand -base64 32`)
2. Mount a persistent volume at `/data`
3. Set `PINGLET_DATA_DIR=/data`
4. Railway TLS is automatic

### Docker

```bash
docker build -t pinglet .
docker run -p 3456:3456 \
  -v pinglet-data:/data \
  -e PINGLET_DATA_DIR=/data \
  -e PINGLET_ADMIN_USER=admin \
  -e PINGLET_ADMIN_PASSWORD=<password> \
  pinglet
```

### Self-hosted

```bash
PORT=3456 \
PINGLET_DATA_DIR=/var/lib/pinglet \
PINGLET_ADMIN_USER=admin \
PINGLET_ADMIN_PASSWORD=<password> \
npx -p @black-knight.dev/pinglet pinglet-server
```

Behind nginx or Caddy for TLS termination.

## GDPR & compliance

- No personal data collected by the pinglet server (no IPs, no usernames, no email)
- Anonymous client ids are random, non-reversible, not linkable to individuals
- Users can opt out at any time
- Data is stored on servers the package author controls
- No third-party analytics services involved

## What to tell your users

A disclosure to add to your package README is in [`maintainer-guide.md`](maintainer-guide.md#4-add-a-readme-telemetry-disclosure).

## Reporting issues

Security issues: open a GitHub issue or email the maintainer.
