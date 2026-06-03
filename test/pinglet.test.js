import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('client sends anonymous runtime ping without PII fields', async () => {
  const previousConfigHome = process.env.XDG_CONFIG_HOME;
  const configHome = await mkdtemp(join(tmpdir(), 'pinglet-config-'));
  process.env.XDG_CONFIG_HOME = configHome;

  const received = [];
  const server = await new Promise((resolve) => {
    const httpServer = createPingletServer({ dataDir: join(configHome, 'data'), silent: true });
    httpServer.on('request', () => {});
    resolve(httpServer);
  });

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

  const port = await listen(server);

  const pinglet = new Pinglet({
    packageName: 'example-cli',
    packageVersion: '1.2.3',
    endpoint: `http://127.0.0.1:${port}/ping`,
    askConsent: false,
    silent: true,
  });

  await pinglet.track('command:build', { target: 'prod', ignored: { nested: true } });
  await close(server);

  if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousConfigHome;

  assert.equal(received.length, 1);
  assert.equal(received[0].pkg, 'example-cli');
  assert.equal(received[0].event, 'command:build');
  assert.equal(received[0].properties.target, 'prod');
  assert.ok(received[0].clientId);
  assert.equal(received[0].machineId, undefined);
  assert.equal(received[0].hostname, undefined);
  assert.equal(received[0].username, undefined);
});

test('server preserves scoped package names with dots in stats', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'pinglet-scoped-data-'));
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
  const dataDir = await mkdtemp(join(tmpdir(), 'pinglet-data-'));
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
  const dataDir = await mkdtemp(join(tmpdir(), 'pinglet-auth-data-'));
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

test('cli login stores token and then reads analytics without password', async () => {
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

  await execFile(process.execPath, [
    'dist/pinglet-cli.js',
    'login',
    '--url',
    url,
    '--user',
    'admin',
    '--password',
    'secret',
  ], { cwd: process.cwd(), env });

  const packages = await execFile(process.execPath, [
    'dist/pinglet-cli.js',
    'packages',
  ], { cwd: process.cwd(), env });

  const stats = await execFile(process.execPath, [
    'dist/pinglet-cli.js',
    'stats',
    '--pkg',
    'cli-login-test',
  ], { cwd: process.cwd(), env });

  await close(server);

  assert.match(packages.stdout, /cli-login-test/);
  assert.match(stats.stdout, /Active users:\s+1/);
  assert.match(stats.stdout, /command:build/);
});
