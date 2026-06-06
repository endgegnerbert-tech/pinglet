import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { Pinglet } from '../dist/pinglet.js';
import { createPingletServer } from '../dist/pinglet-server.js';

const execFile = promisify(execFileCallback);

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

/** Write a postinstall consent file (v0.1 format) to test migration. */
async function writeConsent(configHome, packageName, consent = true, level = 2) {
  const dir = join(configHome, 'pinglet');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
  const safe = packageName.replace(/[^a-z0-9@/_.-]/gi, '_').replace(/[/]/g, '_');
  await writeFile(join(dir, `${safe}.json`), JSON.stringify({ consent, level }));
  const runtimeName = `${safe}_runtime`;
  await writeFile(join(dir, `${runtimeName}.json`), JSON.stringify({ optedOut: !consent || level === 0, clientId: 'test-client-id-12345' }));
}

// ============================================================
// v0.2 default behavior: tracking ON without any consent file
// ============================================================

test('v0.2: without any consent file, tracking is ON by default', async () => {
  const configHome = await mkdtemp(join(tmpdir(), 'pinglet-default-on-'));
  const origXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = configHome;

  // No consent file written — test default behavior

  const pinglet = new Pinglet({
    packageName: 'default-on-cli',
    packageVersion: '1.0.0',
    endpoint: 'http://127.0.0.1:0/ping',
    silent: true,
  });

  assert.equal(pinglet.isOptedOut, false, 'v0.2: tracking should be ON by default');
  if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = origXdg;
});

test('v0.2: tracking ON by default actually sends pings', async () => {
  const configHome = await mkdtemp(join(tmpdir(), 'pinglet-sends-'));
  const origXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = configHome;

  const received = [];
  const server = createPingletServer({ dataDir: join(configHome, 'data'), silent: true });
  const port = await listen(server);

  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });

  const pinglet = new Pinglet({
    packageName: 'sends-cli',
    packageVersion: '1.2.3',
    endpoint: `http://127.0.0.1:${port}/ping`,
    silent: true,
  });

  await pinglet.track('run');
  await close(server);
  if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = origXdg;

  assert.equal(received.length, 1, 'v0.2: should send ping by default');
  assert.equal(received[0].event, 'run');
  assert.ok(received[0].clientId);
});

test('v0.2: DO_NOT_TRACK env var disables tracking', async () => {
  const configHome = await mkdtemp(join(tmpdir(), 'pinglet-dnt-'));
  const origXdg = process.env.XDG_CONFIG_HOME;
  const origDnt = process.env.DO_NOT_TRACK;
  process.env.XDG_CONFIG_HOME = configHome;
  process.env.DO_NOT_TRACK = '1';

  const received = [];
  const server = createPingletServer({ dataDir: join(configHome, 'data'), silent: true });
  const port = await listen(server);

  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { received.push(JSON.parse(body)); res.writeHead(200); res.end('{}'); });
  });

  await new Pinglet({
    packageName: 'dnt-cli',
    packageVersion: '1.0.0',
    endpoint: `http://127.0.0.1:${port}/ping`,
    silent: true,
  }).track('run');

  await close(server);
  if (origDnt === undefined) delete process.env.DO_NOT_TRACK; else process.env.DO_NOT_TRACK = origDnt;
  if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = origXdg;

  assert.equal(received.length, 0, 'DO_NOT_TRACK=1 should suppress pings');
});

// ============================================================
// v0.1 → v0.2 migration: existing consent files are respected
// ============================================================

test('v0.1 migration: consent=true level=2 allows tracking', async () => {
  const configHome = await mkdtemp(join(tmpdir(), 'pinglet-migrate-allow-'));
  const origXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = configHome;
  await writeConsent(configHome, 'migrate-cli', true, 2);

  const pinglet = new Pinglet({
    packageName: 'migrate-cli',
    packageVersion: '1.0.0',
    endpoint: 'http://127.0.0.1:0/ping',
    silent: true,
  });

  assert.equal(pinglet.isOptedOut, false, 'v0.1 consent=true level=2 should still work');
  if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = origXdg;
});

test('v0.1 migration: consent=false disables tracking', async () => {
  const configHome = await mkdtemp(join(tmpdir(), 'pinglet-migrate-off-'));
  const origXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = configHome;
  await writeConsent(configHome, 'off-cli', false, 0);

  const pinglet = new Pinglet({
    packageName: 'off-cli',
    packageVersion: '1.0.0',
    endpoint: 'http://127.0.0.1:0/ping',
    silent: true,
  });

  assert.equal(pinglet.isOptedOut, true, 'v0.1 consent=false should stay disabled');
  if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = origXdg;
});

test('v0.1 migration: level 0 disables tracking', async () => {
  const configHome = await mkdtemp(join(tmpdir(), 'pinglet-migrate-level0-'));
  const origXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = configHome;
  await writeConsent(configHome, 'level0-cli', true, 0);

  const pinglet = new Pinglet({
    packageName: 'level0-cli',
    packageVersion: '1.0.0',
    endpoint: 'http://127.0.0.1:0/ping',
    silent: true,
  });

  assert.equal(pinglet.isOptedOut, true, 'v0.1 level 0 should disable tracking');
  if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = origXdg;
});

// ============================================================
// Level-based event filtering
// ============================================================

test('level 1 tracks only run events', async () => {
  const configHome = await mkdtemp(join(tmpdir(), 'pinglet-level1-'));
  const origXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = configHome;
  await writeConsent(configHome, 'basic-cli', true, 1);

  const received = [];
  const server = createPingletServer({ dataDir: join(configHome, 'data'), silent: true });
  const port = await listen(server);

  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { received.push(JSON.parse(body)); res.writeHead(200); res.end('{}'); });
  });

  const endpoint = `http://127.0.0.1:${port}/ping`;
  await new Pinglet({ packageName: 'basic-cli', packageVersion: '1.0.0', endpoint, silent: true }).track('run');
  await new Pinglet({ packageName: 'basic-cli', packageVersion: '1.0.0', endpoint, silent: true }).track('command:build', { target: 'prod' });

  await close(server);
  if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = origXdg;

  assert.equal(received.length, 1);
  assert.equal(received[0].event, 'run');
});

test('level 2 strips properties but keeps event names', async () => {
  const configHome = await mkdtemp(join(tmpdir(), 'pinglet-level2-'));
  const origXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = configHome;
  await writeConsent(configHome, 'standard-cli', true, 2);

  const received = [];
  const server = createPingletServer({ dataDir: join(configHome, 'data'), silent: true });
  const port = await listen(server);

  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { received.push(JSON.parse(body)); res.writeHead(200); res.end('{}'); });
  });

  const endpoint = `http://127.0.0.1:${port}/ping`;
  await new Pinglet({ packageName: 'standard-cli', packageVersion: '1.0.0', endpoint, silent: true }).track('command:build', { target: 'prod' });

  await close(server);
  if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = origXdg;

  assert.equal(received.length, 1);
  assert.equal(received[0].event, 'command:build');
  assert.equal(received[0].properties, undefined);
});

test('level 3 includes properties', async () => {
  const configHome = await mkdtemp(join(tmpdir(), 'pinglet-level3-'));
  const origXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = configHome;
  await writeConsent(configHome, 'extended-cli', true, 3);

  const received = [];
  const server = createPingletServer({ dataDir: join(configHome, 'data'), silent: true });
  const port = await listen(server);

  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { received.push(JSON.parse(body)); res.writeHead(200); res.end('{}'); });
  });

  const endpoint = `http://127.0.0.1:${port}/ping`;
  await new Pinglet({ packageName: 'extended-cli', packageVersion: '1.0.0', endpoint, silent: true }).track('command:build', { target: 'prod' });

  await close(server);
  if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = origXdg;

  assert.equal(received.length, 1);
  assert.equal(received[0].event, 'command:build');
  assert.equal(received[0].properties.target, 'prod');
});

// ============================================================
// Privacy: no PII in payload
// ============================================================

test('client sends anonymous runtime ping without PII fields', async () => {
  const configHome = await mkdtemp(join(tmpdir(), 'pinglet-pii-'));
  const origXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = configHome;
  await writeConsent(configHome, 'pii-safe', true, 3);

  const received = [];
  const server = createPingletServer({ dataDir: join(configHome, 'data'), silent: true });
  const port = await listen(server);

  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });

  await new Pinglet({
    packageName: 'pii-safe',
    packageVersion: '1.2.3',
    endpoint: `http://127.0.0.1:${port}/ping`,
    silent: true,
  }).track('command:build', { target: 'prod' });

  await close(server);
  if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = origXdg;

  assert.equal(received.length, 1);
  assert.equal(received[0].pkg, 'pii-safe');
  assert.equal(received[0].event, 'command:build');
  assert.equal(received[0].properties.target, 'prod');
  assert.ok(received[0].clientId);
  assert.equal(received[0].machineId, undefined);
  assert.equal(received[0].hostname, undefined);
  assert.equal(received[0].username, undefined);
});

// ============================================================
// Server tests (unchanged from v0.1)
// ============================================================

test('server preserves scoped package names with dots in stats', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'pinglet-scoped-'));
  const server = createPingletServer({ dataDir, silent: true });
  const port = await listen(server);

  const response = await fetch(`http://127.0.0.1:${port}/ping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pkg: '@black-knight.dev/emet',
      pkgVersion: '1.2.0',
      event: 'run',
      clientId: 'abcdef1234567890',
    }),
  });
  assert.equal(response.status, 200);

  const statsResponse = await fetch(`http://127.0.0.1:${port}/stats?pkg=${encodeURIComponent('@black-knight.dev/emet')}`);
  const stats = await statsResponse.json();
  await close(server);

  assert.equal(stats.pkg, '@black-knight.dev/emet');
  assert.equal(stats.totalPings, 1);
});

test('server stores pings and returns aggregate stats only', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'pinglet-aggr-'));
  const server = createPingletServer({ dataDir, silent: true });
  const port = await listen(server);

  const payload = {
    pkg: 'stats-cli',
    pkgVersion: '0.0.1',
    event: 'run',
    clientId: 'abcdef1234567890',
    nodeVersion: 'v22.0.0',
    platform: 'darwin',
    ci: false,
    ip: 'should-not-store',
  };

  const response = await fetch(`http://127.0.0.1:${port}/ping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 200);

  const statsResponse = await fetch(`http://127.0.0.1:${port}/stats?pkg=stats-cli`);
  const stats = await statsResponse.json();
  await close(server);

  assert.equal(stats.totalPings, 1);
  assert.equal(stats.uniqueUsers, 1);
  assert.equal(stats.events.run, 1);

  const stored = await readFile(join(dataDir, 'stats-cli.ndjson'), 'utf-8');
  assert.match(stored, /abcdef1234567890/);
  assert.doesNotMatch(stored, /should-not-store/);
});

test('admin endpoints can be protected with username and password', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'pinglet-auth-'));
  const server = createPingletServer({
    dataDir,
    adminUser: 'owner',
    adminPassword: 'secret',
    silent: true,
  });
  const port = await listen(server);

  const payload = {
    pkg: 'private-cli',
    pkgVersion: '1.0.0',
    event: 'run',
    clientId: 'abcdef1234567890',
  };

  const writeResponse = await fetch(`http://127.0.0.1:${port}/ping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(writeResponse.status, 200);

  const unauthenticated = await fetch(`http://127.0.0.1:${port}/stats?pkg=private-cli`);
  assert.equal(unauthenticated.status, 401);

  const authenticated = await fetch(`http://127.0.0.1:${port}/stats?pkg=private-cli`, {
    headers: { Authorization: `Basic ${Buffer.from('owner:secret').toString('base64')}` },
  });
  const stats = await authenticated.json();

  const packagesResponse = await fetch(`http://127.0.0.1:${port}/packages`, {
    headers: { Authorization: `Basic ${Buffer.from('owner:secret').toString('base64')}` },
  });
  const packages = await packagesResponse.json();
  await close(server);

  assert.equal(authenticated.status, 200);
  assert.equal(stats.totalPings, 1);
  assert.deepEqual(packages.packages, ['private-cli']);
});

// ============================================================
// Integration: CLI login + read analytics
// ============================================================

test('cli login + default tracking reads analytics', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'pinglet-cli-data-'));
  const configHome = await mkdtemp(join(tmpdir(), 'pinglet-cli-config-'));

  const server = createPingletServer({
    dataDir,
    adminUser: 'admin',
    adminPassword: 'secret',
    silent: true,
  });
  const port = await listen(server);
  const url = `http://127.0.0.1:${port}`;
  const env = { ...process.env, XDG_CONFIG_HOME: configHome };

  await fetch(`${url}/ping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pkg: 'cli-login-test',
      pkgVersion: '1.0.0',
      event: 'command:build',
      clientId: 'abcdef1234567890',
      platform: 'linux',
      ci: true,
    }),
  });

  await execFile(process.execPath, ['dist/pinglet-cli.js', 'login', '--url', url, '--user', 'admin', '--password', 'secret'],
    { cwd: process.cwd(), env });

  const packages = await execFile(process.execPath, ['dist/pinglet-cli.js', 'packages'], { cwd: process.cwd(), env });
  const stats = await execFile(process.execPath, ['dist/pinglet-cli.js', 'stats', '--pkg', 'cli-login-test'],
    { cwd: process.cwd(), env });

  await close(server);

  assert.match(packages.stdout, /cli-login-test/);
  assert.match(stats.stdout, /Active users:\s+1/);
  assert.match(stats.stdout, /command:build/);
});

// ============================================================
// _internal backward compatibility (no-op in v0.2)
// ============================================================

test('_internal flag is backward compatible', async () => {
  const configHome = await mkdtemp(join(tmpdir(), 'pinglet-internal-'));
  const origXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = configHome;

  const received = [];
  const server = createPingletServer({ dataDir: join(configHome, 'data'), silent: true });
  const port = await listen(server);

  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { received.push(JSON.parse(body)); res.writeHead(200); res.end('{}'); });
  });

  const endpoint = `http://127.0.0.1:${port}/ping`;
  await new Pinglet({ packageName: 'internal-cli', packageVersion: '1.0.0', endpoint, silent: true, _internal: true }).track('run');

  await close(server);
  if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = origXdg;

  assert.equal(received.length, 1);
  assert.ok(received[0].clientId);
  assert.equal(received[0].event, 'run');
});
