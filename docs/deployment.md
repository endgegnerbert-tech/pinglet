# Deployment

Deploy a `pinglet` server once. All your npm packages can send analytics to the same server.

## Quickstart (30 seconds)

```bash
npm install -g pinglet
PORT=3456 PINGLET_ADMIN_USER=admin PINGLET_ADMIN_PASSWORD=<password> pinglet-server
```

Done. `POST /ping` is ready, `GET /stats` works with the admin password.

But this server dies when your terminal closes. For production, use one of the options below.

---

## Railway (recommended — free / $5 tier)

Idiot-proof, one-click, persistent. Full guide: [`deploy-railway.md`](deploy-railway.md)

What you need:
- Push the repo to GitHub
- Create a Railway project from the repo
- One Railway volume, three env vars
- That's it

**What Railway gives you automatically:**
- HTTPS
- Public URL
- Auto-restart on crash
- Logs
- Zero-config (reads `railway.json`)

---

## Docker

Use the included `Dockerfile`:

```bash
# Build
docker build -t pinglet .

# Run with persistent volume
docker run -d \
  --name pinglet \
  -p 3456:3456 \
  -v pinglet-data:/data \
  -e PINGLET_DATA_DIR=/data \
  -e PINGLET_ADMIN_USER=admin \
  -e PINGLET_ADMIN_PASSWORD=$(openssl rand -base64 32) \
  --restart unless-stopped \
  pinglet
```

Works on any host: Fly.io, Render, DigitalOcean, AWS, your own VPS.

---

## Fly.io

```bash
fly launch --dockerfile Dockerfile
fly volumes create pinglet_data --size 1
fly secrets set PINGLET_DATA_DIR=/data PINGLET_ADMIN_USER=admin PINGLET_ADMIN_PASSWORD=<password>
fly deploy
```

---

## After deploying

### 1. Login from your machine

```bash
npx pinglet login --url https://your-app.example.com --user admin
```

Enter the admin password once. A 30-day token is saved locally.

### 2. Check health

```bash
npx pinglet health
```

### 3. Add to your npm packages

```bash
npm install pinglet
```

Then 5 lines of code. See [`maintainer-guide.md`](maintainer-guide.md) for the full integration checklist.

### 4. Read analytics

```bash
npx pinglet                  # status overview
npx pinglet ls               # list packages
npx pinglet my-cli           # show stats
```

---

## All env vars

| Var | Default | Description |
| --- | --- | --- |
| `PORT` | `3456` | HTTP port |
| `PINGLET_DATA_DIR` | `./data` | Where NDJSON files and sessions are stored |
| `PINGLET_ADMIN_USER` | `admin` | Admin username for Basic Auth |
| `PINGLET_ADMIN_PASSWORD` | — | Set this to protect `/stats` and `/packages` |
| `PINGLET_INGEST_TOKEN` | — | Optional: protect `POST /ping` |

---

## Important: persistent data

The NDJSON files are your only data. Without a persistent volume/directory:
- Railway restarts → all analytics lost
- Docker container removed → all analytics lost

Always mount a volume at `PINGLET_DATA_DIR`. On Railway, set `PINGLET_DATA_DIR=/data` and mount a volume at `/data`. On Docker, use `-v`.
