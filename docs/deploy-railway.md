# Deploy pinglet on Railway

This is the simple production path:

1. deploy one tiny Node server on Railway
2. send package runtime pings to `https://your-app.up.railway.app/ping`
3. run `pinglet login` once from your laptop
4. read analytics with `pinglet packages` and `pinglet stats --pkg <name>`

## How it works

Railway uses **Nixpacks** — automatic build detection. No Dockerfile needed. Nixpacks reads `railway.json`, installs Node, runs `npm ci && npm start`, and deploys. A persistent volume at `/data` keeps your analytics across redeploys.

## 1. Prepare the repo

Push this project to GitHub.

Railway already knows how to run it because the repo contains:

- `railway.json`
- `npm start`
- `pinglet-server`

## 2. Create the Railway service

1. Open Railway.
2. New Project.
3. Deploy from GitHub repo.
4. Pick your `pinglet` repo.
5. Wait until first deploy finishes.

## 3. Add persistent storage

Important: without a volume, Railway redeploys can delete local files.

1. In the Railway service, add a Volume.
2. Mount path: `/data`.
3. Set this variable:

```bash
PINGLET_DATA_DIR=/data
```

## 4. Add secure admin login

Set these Railway variables:

```bash
PINGLET_ADMIN_USER=admin
PINGLET_ADMIN_PASSWORD=<long-random-password>
```

Generate a password locally:

```bash
openssl rand -base64 32
```

Do not put this password into your npm package. It is only for you, to read analytics.

## 5. Deploy / restart

Redeploy the Railway service after adding env vars.

Check health:

```bash
curl https://your-app.up.railway.app/health
```

Expected:

```json
{"ok":true,"version":"0.1.3"}
```

## 6. Login once from your machine

```bash
npx pinglet login --url https://your-app.up.railway.app --user admin
```

Paste the admin password when asked.

`pinglet` stores a 30-day token in:

```txt
~/.config/pinglet/config.json
```

It does **not** store your admin password.

## 7. Add pinglet to your CLI package

Get a copy-paste snippet:

```bash
npx pinglet snippet --pkg my-cli --package-version 1.0.0
```

Then install and add it:

```bash
npm install @black-knight.dev/pinglet
```

```ts
import { Pinglet } from '@black-knight.dev/pinglet';

const analytics = new Pinglet({
  packageName: 'my-cli',
  packageVersion: '1.0.0',
  endpoint: 'https://your-app.up.railway.app/ping',
});

await analytics.track('run');
await analytics.track('command:build');
```

## 8. Read analytics

```bash
npx pinglet packages
npx pinglet stats --pkg my-cli
```

You will see:

- real active usage
- anonymous active users
- commands/features used
- versions still active
- CI vs local usage
- platform split
- usage by day

## Security notes

- `POST /ping` is public by default. That is normal for public npm packages because shipped secrets are visible to users.
- Admin reads are protected by login token / Basic Auth when `PINGLET_ADMIN_PASSWORD` is set.
- Use a Railway volume for persistence.
- Do not track file paths, raw user input, source code, logs, stack traces or secrets.
- Your hosting provider may still log IPs at proxy/access-log level. Disable/anonymize provider logs if your privacy requirements demand it.

## Optional private ingest token

Only for private/internal CLIs:

```bash
PINGLET_INGEST_TOKEN=<token>
```

Then in your private CLI:

```ts
new Pinglet({
  packageName: 'internal-cli',
  packageVersion: '1.0.0',
  endpoint: 'https://your-app.up.railway.app/ping',
  ingestToken: '<token>',
});
```

Do not use this for public npm packages because everyone can read the token from the package.
