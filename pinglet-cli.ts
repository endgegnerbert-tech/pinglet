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

const COMMANDS = new Set(['login', 'logout', 'status', 'ls', 'packages', 'show', 'stats', 'snippet', 'health']);

function usage(): string {
  return `pinglet — anonymous runtime analytics for npm packages

  pinglet                            Quick status overview
  pinglet login --url <url>          Login once (token saved, not password)
  pinglet logout                     Remove local login
  pinglet health                     Check server health + version

  pinglet ls                         List tracked packages
  pinglet <pkg>                      Show analytics for a package (shortcut)
  pinglet show <pkg>                 Same as pinglet <pkg>
  pinglet stats --pkg <pkg>          Same as above (explicit)

  pinglet snippet <pkg>              Print copy-paste SDK code
  pinglet snippet --pkg <pkg> --package-version 1.0.0

Options:
  --url <url>         Server URL
  --user <user>       Admin username (default: admin)
  --password <pass>   Admin password (login only; prepend with space to hide from history)
  --json              Raw JSON output

Env: PINGLET_SERVER_URL PINGLET_ADMIN_USER
`;
}

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function parseArgs(args: string[]): CliOptions {
  const cmd = args[0]?.startsWith('-') ? undefined : args[0];
  return {
    command: cmd,
    url: readArg(args, '--url') ?? process.env.PINGLET_SERVER_URL,
    pkg: readArg(args, '--pkg') ?? process.env.PINGLET_PACKAGE ?? (cmd && !COMMANDS.has(cmd) ? cmd : undefined),
    packageVersion: readArg(args, '--package-version') ?? process.env.PINGLET_PACKAGE_VERSION,
    user: readArg(args, '--user') ?? process.env.PINGLET_ADMIN_USER ?? 'admin',
    password: readArg(args, '--password') ?? process.env.PINGLET_ADMIN_PASSWORD,
    json: args.includes('--json'),
  };
}

function getConfigDir(): string {
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
}
function getPingletDir(): string { return join(getConfigDir(), 'pinglet'); }
function getConfigPath(): string { return join(getPingletDir(), 'config.json'); }

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.pathname = parsed.pathname.replace(/\/$/, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

function loadConfig(): PingletConfig | undefined {
  const path = getConfigPath();
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<PingletConfig>;
    if (typeof parsed.serverUrl === 'string' && typeof parsed.adminUser === 'string' &&
        typeof parsed.token === 'string' && typeof parsed.tokenExpiresAt === 'string') {
      return parsed as PingletConfig;
    }
  } catch { /* ignore */ }
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
    function cleanup(): void { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); }
    function onData(buffer: Buffer): void {
      const text = buffer.toString('utf-8');
      for (const char of text) {
        if (char === '\x03') { cleanup(); process.stdout.write('\n'); reject(new Error('Cancelled')); return; }
        if (char === '\r' || char === '\n') { cleanup(); process.stdout.write('\n'); resolve(value); return; }
        if (char === '\x7f') { value = value.slice(0, -1); continue; }
        value += char;
      }
    }
    process.stdout.write(`${question}: `);
    stdin.setRawMode(true); stdin.resume(); stdin.on('data', onData);
  });
}

function requireOption(value: string | undefined, message: string): string {
  if (!value) { console.error(message); process.exit(1); }
  return value;
}

function basicAuth(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

function getSavedAuth(opts: CliOptions): { serverUrl: string; headers: Record<string, string> } {
  const config = loadConfig();
  const serverUrl = requireOption(opts.url ?? config?.serverUrl, 'Not logged in. Run: pinglet login --url <url>');

  if (opts.password) {
    return { serverUrl: normalizeUrl(serverUrl), headers: { Authorization: basicAuth(opts.user, opts.password) } };
  }

  if (!config?.token) { console.error('Not logged in. Run: pinglet login --url <url>'); process.exit(1); }
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
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
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
    method: 'POST', headers: { Authorization: basicAuth(user, password) },
  });
  const body = await response.json().catch(() => ({})) as JsonObject;

  if (!response.ok || typeof body.token !== 'string' || typeof body.expiresAt !== 'string') {
    throw new Error(`Login failed: ${response.status}: ${JSON.stringify(body)}`);
  }

  saveConfig({ serverUrl, adminUser: user, token: body.token, tokenExpiresAt: body.expiresAt });
  console.log(`Logged in to ${serverUrl} as ${user}.`);
  console.log(`Token saved to ${getConfigPath()} (expires ${body.expiresAt}).`);
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
  for (const [key, count] of rows) console.log(`${key.padEnd(24)} ${String(count).padStart(8)}`);
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
  const serverUrl = normalizeUrl(requireOption(opts.url ?? config?.serverUrl, 'Missing server URL. Run: pinglet login --url <url>'));
  const pkg = requireOption(opts.pkg, 'Missing package name. Usage: pinglet snippet <name>');
  const version = opts.packageVersion ?? '1.0.0';
  console.log(`npm install pinglet\n`);
  console.log(`import { Pinglet } from 'pinglet';\n
const analytics = new Pinglet({
  packageName: '${pkg}',
  packageVersion: '${version}',
  endpoint: '${serverUrl}/ping',
});

await analytics.track('run');
await analytics.track('command:build');`);
}

async function printStatus(opts: CliOptions): Promise<void> {
  const config = loadConfig();
  if (!config) { console.log('Not logged in. Run: pinglet login --url <url>'); return; }

  const serverUrl = normalizeUrl(opts.url ?? config.serverUrl);

  // Check health (public, no auth)
  let health = 'unknown';
  let version = '';
  try {
    const r = await fetch(`${serverUrl}/health`);
    if (r.ok) { health = 'online'; const h = await r.json() as JsonObject; version = String(h.version ?? ''); }
    else health = 'unreachable';
  } catch { health = 'unreachable'; }

  console.log(`Server:  ${serverUrl}`);
  console.log(`Status:  ${health}${version ? ` (v${version})` : ''}`);
  console.log(`User:    ${config.adminUser}`);
  console.log(`Token:   expires ${config.tokenExpiresAt}`);

  // Try to list packages
  let pkgCount = 0;
  try {
    const r2 = await fetch(`${serverUrl}/packages`, { headers: { Authorization: `Bearer ${config.token}` } });
    if (r2.ok) { const j = await r2.json() as JsonObject; pkgCount = (j.packages as unknown[])?.length ?? 0; }
  } catch { /* ok */ }

  console.log(`Tracking: ${pkgCount} package${pkgCount !== 1 ? 's' : ''}`);

  if (pkgCount > 0) {
    const r3 = await fetch(`${serverUrl}/packages`, { headers: { Authorization: `Bearer ${config.token}` } });
    const pkgs = (await r3.json() as JsonObject).packages as string[];
    pkgs.slice(0, 8).forEach((p) => console.log(`          ${p}`));
    if (pkgs.length > 8) console.log(`          ... and ${pkgs.length - 8} more`);
  }

  console.log(`\nCommands: ls | <pkg> | show <pkg> | snippet <pkg> | health | logout`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(usage()); return; }

  const opts = parseArgs(args);

  // No args → status overview
  if (args.length === 0) { await printStatus(opts); return; }

  // Self-analytics: track CLI usage (fire-and-forget, never blocks)
  const saved = loadConfig();
  if (saved) {
    import('./pinglet.js').then(({ Pinglet }) => {
      Pinglet.selfTrack('cli', `${saved.serverUrl}/ping`);
    }).catch(() => {});
  }

  // Route commands
  switch (opts.command) {
    case 'login': return await login(opts);
    case 'logout': deleteConfig(); console.log('Logged out.'); return;
    case 'health': { const r = await fetchJson('/health', opts); console.log(opts.json ? JSON.stringify(r, null, 2) : `ok, version ${r.version ?? 'unknown'}`); return; }
    case 'status': { const r = await fetchJson('/auth/check', opts); console.log(opts.json ? JSON.stringify(r, null, 2) : 'Logged in. Token accepted.'); return; }
    case 'snippet': printSnippet(opts); return;
    case 'ls': case 'packages': {
      const r = await fetchJson('/packages', opts);
      const pkgs = Array.isArray(r.packages) ? r.packages : [];
      if (opts.json) console.log(JSON.stringify(r, null, 2));
      else if (pkgs.length === 0) console.log('No packages tracked yet.');
      else pkgs.forEach((pkg) => console.log(String(pkg)));
      return;
    }
    case 'show': case 'stats':
    default: {
      // Default: treat as stats
      const pkg = opts.pkg || (opts.command && !COMMANDS.has(opts.command) ? opts.command : undefined);
      requireOption(pkg, 'Missing package name. Usage: pinglet <pkg>');
      const r = await fetchJson(`/stats?pkg=${encodeURIComponent(pkg!)}`, opts);
      if (opts.json) console.log(JSON.stringify(r, null, 2));
      else printStats(r);
      return;
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
