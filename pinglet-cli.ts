#!/usr/bin/env node
/**
 * pinglet - admin CLI for reading analytics from a self-hosted pinglet server.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

type JsonObject = Record<string, unknown>;

interface PingletConfig {
  serverUrl: string;
  adminUser: string;
  token: string;
  tokenExpiresAt: string;
}

interface CliOptions {
  command?: string;
  url?: string;
  pkg?: string;
  packageVersion?: string;
  user: string;
  password?: string;
  json: boolean;
}

function usage(): string {
  return `pinglet - login once, then read analytics from your pinglet server

First time:
  pinglet login --url https://your-app.up.railway.app --user admin

After login:
  pinglet packages
  pinglet stats --pkg my-cli

Commands:
  login              Login once and store a local admin token (not your password)
  logout             Remove local login token
  status             Check if the saved login still works
  packages           List tracked packages
  stats --pkg <name> Show package analytics
  snippet --pkg <n>  Print copy-paste SDK code for your CLI package

Options:
  --url <url>         Server URL, e.g. https://app.up.railway.app
  --pkg <name>        Package name for stats/snippet
  --package-version <version> Package version for snippet, default 1.0.0
  --user <user>       Admin username, default admin
  --password <pass>   Admin password (only for login; otherwise prompted)
  --json              Print raw JSON
  --help              Show help

Env alternatives:
  PINGLET_SERVER_URL
  PINGLET_ADMIN_USER
  PINGLET_ADMIN_PASSWORD
`;
}

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function parseArgs(args: string[]): CliOptions {
  return {
    command: args.find((arg) => !arg.startsWith('-')),
    url: readArg(args, '--url') ?? process.env.PINGLET_SERVER_URL,
    pkg: readArg(args, '--pkg') ?? process.env.PINGLET_PACKAGE,
    packageVersion: readArg(args, '--package-version') ?? process.env.PINGLET_PACKAGE_VERSION,
    user: readArg(args, '--user') ?? process.env.PINGLET_ADMIN_USER ?? 'admin',
    password: readArg(args, '--password') ?? process.env.PINGLET_ADMIN_PASSWORD,
    json: args.includes('--json'),
  };
}

function getConfigDir(): string {
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
}

function getPingletDir(): string {
  return join(getConfigDir(), 'pinglet');
}

function getConfigPath(): string {
  return join(getPingletDir(), 'config.json');
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function loadConfig(): PingletConfig | undefined {
  const path = getConfigPath();
  if (!existsSync(path)) return undefined;

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<PingletConfig>;
    if (
      typeof parsed.serverUrl === 'string' &&
      typeof parsed.adminUser === 'string' &&
      typeof parsed.token === 'string' &&
      typeof parsed.tokenExpiresAt === 'string'
    ) {
      return parsed as PingletConfig;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function saveConfig(config: PingletConfig): void {
  const dir = getPingletDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

function deleteConfig(): void {
  const path = getConfigPath();
  if (existsSync(path)) rmSync(path);
}

async function promptText(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question}${suffix}: `);
  rl.close();
  return answer.trim() || defaultValue || '';
}

async function promptPassword(question: string): Promise<string> {
  if (!process.stdin.isTTY) return promptText(question);

  return new Promise((resolve, reject) => {
    let value = '';
    const stdin = process.stdin;

    function cleanup(): void {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
    }

    function onData(buffer: Buffer): void {
      const text = buffer.toString('utf-8');
      for (const char of text) {
        if (char === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          reject(new Error('Cancelled'));
          return;
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u007f') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    }

    process.stdout.write(`${question}: `);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

function requireOption(value: string | undefined, message: string): string {
  if (!value) {
    console.error(message);
    console.error('');
    console.error(usage());
    process.exit(1);
  }
  return value;
}

function basicAuth(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

function getSavedAuth(opts: CliOptions): { serverUrl: string; headers: Record<string, string> } {
  const config = loadConfig();
  const serverUrl = requireOption(opts.url ?? config?.serverUrl, 'Missing server URL. Run: pinglet login --url <server-url>');

  if (opts.password) {
    return { serverUrl: normalizeUrl(serverUrl), headers: { Authorization: basicAuth(opts.user, opts.password) } };
  }

  if (!config?.token) {
    console.error('Not logged in. Run: pinglet login --url <server-url>');
    process.exit(1);
  }

  if (Date.parse(config.tokenExpiresAt) <= Date.now()) {
    console.error('Saved login expired. Run: pinglet login');
    process.exit(1);
  }

  return { serverUrl: normalizeUrl(serverUrl), headers: { Authorization: `Bearer ${config.token}` } };
}

async function fetchJson(path: string, opts: CliOptions): Promise<JsonObject> {
  const auth = getSavedAuth(opts);
  const url = new URL(path, `${auth.serverUrl}/`);

  const response = await fetch(url, { headers: auth.headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(body)}`);
  return body as JsonObject;
}

async function login(opts: CliOptions): Promise<void> {
  const existing = loadConfig();
  const rawUrl = opts.url ?? await promptText('Server URL', existing?.serverUrl);
  const serverUrl = normalizeUrl(requireOption(rawUrl, 'Missing server URL'));
  const user = opts.user || await promptText('Admin user', existing?.adminUser ?? 'admin');
  const password = opts.password ?? await promptPassword('Admin password');

  if (!password) throw new Error('Missing admin password');

  const response = await fetch(new URL('/auth/login', `${serverUrl}/`), {
    method: 'POST',
    headers: { Authorization: basicAuth(user, password) },
  });
  const body = await response.json().catch(() => ({})) as JsonObject;

  if (!response.ok || typeof body.token !== 'string' || typeof body.expiresAt !== 'string') {
    throw new Error(`Login failed: ${response.status} ${response.statusText}: ${JSON.stringify(body)}`);
  }

  saveConfig({ serverUrl, adminUser: user, token: body.token, tokenExpiresAt: body.expiresAt });
  console.log(`Logged in to ${serverUrl} as ${user}.`);
  console.log(`Token saved to ${getConfigPath()} and expires at ${body.expiresAt}.`);
}

function sortEntries(record: unknown): [string, number][] {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return [];
  return Object.entries(record as Record<string, unknown>)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .sort((a, b) => b[1] - a[1]);
}

function printSection(title: string, record: unknown): void {
  const rows = sortEntries(record);
  if (rows.length === 0) return;

  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
  for (const [key, count] of rows) {
    console.log(`${key.padEnd(24)} ${String(count).padStart(8)}`);
  }
}

function printStats(stats: JsonObject): void {
  console.log(`Package:      ${stats.pkg}`);
  console.log(`Total pings:  ${stats.totalPings}`);
  console.log(`Active users: ${stats.uniqueUsers}`);

  printSection('Commands / features', stats.events);
  printSection('Active versions', stats.versions);
  printSection('Platforms', stats.platforms);
  printSection('CI vs local', stats.ci);
  printSection('Usage by day', stats.days);
}

function printSnippet(opts: CliOptions): void {
  const config = loadConfig();
  const serverUrl = normalizeUrl(requireOption(opts.url ?? config?.serverUrl, 'Missing server URL. Run: pinglet login --url <server-url>'));
  const pkg = requireOption(opts.pkg, 'Missing --pkg <your-package-name>');
  const version = opts.packageVersion ?? '1.0.0';

  console.log(`npm install pinglet\n`);
  console.log(`import { Pinglet } from 'pinglet';

const analytics = new Pinglet({
  packageName: '${pkg}',
  packageVersion: '${version}',
  endpoint: '${serverUrl}/ping',
});

await analytics.track('run');
await analytics.track('command:build');`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(usage());
    return;
  }

  const opts = parseArgs(args);

  if (opts.command === 'login') {
    await login(opts);
    return;
  }

  if (opts.command === 'logout') {
    deleteConfig();
    console.log('Logged out. Local pinglet token removed.');
    return;
  }

  if (opts.command === 'status') {
    const result = await fetchJson('/auth/check', opts);
    if (opts.json) console.log(JSON.stringify(result, null, 2));
    else console.log('Logged in and server accepted the saved token.');
    return;
  }

  if (opts.command === 'snippet') {
    printSnippet(opts);
    return;
  }

  if (opts.command === 'packages') {
    const result = await fetchJson('/packages', opts);
    if (opts.json) console.log(JSON.stringify(result, null, 2));
    else {
      const packages = Array.isArray(result.packages) ? result.packages : [];
      if (packages.length === 0) console.log('No packages tracked yet.');
      else packages.forEach((pkg) => console.log(String(pkg)));
    }
    return;
  }

  if (opts.command === 'stats') {
    const pkg = requireOption(opts.pkg, 'Missing --pkg or PINGLET_PACKAGE');
    const result = await fetchJson(`/stats?pkg=${encodeURIComponent(pkg)}`, opts);
    if (opts.json) console.log(JSON.stringify(result, null, 2));
    else printStats(result);
    return;
  }

  console.error(`Unknown command: ${opts.command}`);
  console.error('');
  console.error(usage());
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
