#!/usr/bin/env node
/**
 * pinglet-server - minimal self-hosted backend for pinglet telemetry events.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { sanitizeText, sanitizePackageName, sanitizeEvent, sanitizeProperties } from './lib/utils.js';
import { Pinglet } from './pinglet.js';

export interface PingletServerOptions {
  port?: number;
  dataDir?: string;
  /** Optional write token for POST /ping. Leave empty for public OSS telemetry endpoints. */
  ingestToken?: string;
  /** Admin username for GET /stats and GET /packages. */
  adminUser?: string;
  /** Admin password for GET /stats and GET /packages. */
  adminPassword?: string;
  /** Backwards-compatible alias: protects admin endpoints as password when adminPassword is unset. */
  secret?: string;
  silent?: boolean;
}

type TelemetryValue = string | number | boolean | null;
type TelemetryProperties = Record<string, TelemetryValue>;

interface StoredPing {
  pkg: string;
  pkgVersion: string;
  event: string;
  clientId: string;
  nodeVersion: string;
  platform: string;
  ci: boolean;
  ts: string;
  properties?: TelemetryProperties;
}

interface AdminSession {
  tokenHash: string;
  user: string;
  createdAt: string;
  expiresAt: string;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;


function getFilePath(dataDir: string, packageName: string): string {
  const safe = sanitizePackageName(packageName).replace(/[\/]/g, '_').slice(0, 96);
  return join(dataDir, `${safe}.ndjson`);
}

function readBody(req: IncomingMessage, limitBytes = 8192): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf-8');
      if (Buffer.byteLength(body) > limitBytes) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function getSessionFilePath(dataDir: string): string {
  return join(dataDir, '.pinglet-admin-sessions.json');
}

function loadSessions(dataDir: string): AdminSession[] {
  const path = getSessionFilePath(dataDir);
  if (!existsSync(path)) return [];

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter((session): session is AdminSession => {
      if (!session || typeof session !== 'object') return false;
      const candidate = session as Partial<AdminSession>;
      return typeof candidate.tokenHash === 'string' &&
        typeof candidate.user === 'string' &&
        typeof candidate.createdAt === 'string' &&
        typeof candidate.expiresAt === 'string' &&
        Date.parse(candidate.expiresAt) > now;
    });
  } catch {
    return [];
  }
}

function saveSessions(dataDir: string, sessions: AdminSession[]): void {
  writeFileSync(getSessionFilePath(dataDir), JSON.stringify(sessions, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

function createAdminSession(dataDir: string, user: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS).toISOString();
  const sessions = loadSessions(dataDir);
  sessions.push({ tokenHash: hashToken(token), user, createdAt: createdAt.toISOString(), expiresAt });
  saveSessions(dataDir, sessions);
  return { token, expiresAt };
}

function hasValidSession(req: IncomingMessage, dataDir: string): boolean {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return false;

  const tokenHash = hashToken(auth.slice('Bearer '.length));
  return loadSessions(dataDir).some((session) => timingSafeStringEqual(session.tokenHash, tokenHash));
}

function hasValidIngestAuth(req: IncomingMessage, ingestToken: string): boolean {
  if (!ingestToken) return true;
  const bearer = req.headers.authorization === `Bearer ${ingestToken}`;
  const headerToken = req.headers['x-pinglet-token'] === ingestToken;
  return bearer || headerToken;
}

function parseBasicAuth(req: IncomingMessage): { user: string; password: string } | undefined {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Basic ')) return undefined;

  try {
    const decoded = Buffer.from(auth.slice('Basic '.length), 'base64').toString('utf-8');
    const separator = decoded.indexOf(':');
    if (separator === -1) return undefined;
    return { user: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return undefined;
  }
}

function hasValidBasicAdminAuth(req: IncomingMessage, adminUser: string, adminPassword: string): boolean {
  if (!adminPassword) return true;
  const credentials = parseBasicAuth(req);
  if (!credentials) return false;

  return timingSafeStringEqual(credentials.user, adminUser) &&
    timingSafeStringEqual(credentials.password, adminPassword);
}

function hasValidAdminAuth(req: IncomingMessage, adminUser: string, adminPassword: string, dataDir: string): boolean {
  if (!adminPassword) return true;
  return hasValidSession(req, dataDir) || hasValidBasicAdminAuth(req, adminUser, adminPassword);
}

function storePing(dataDir: string, data: Record<string, unknown>): StoredPing | undefined {
  const pkg = sanitizePackageName(data.pkg);
  const event = sanitizeEvent(data.event);
  const clientId = sanitizeText(data.clientId, '', 64).replace(/[^a-f0-9]/gi, '').slice(0, 64);

  if (!pkg || !event || !clientId) return undefined;

  const safe: StoredPing = {
    pkg,
    pkgVersion: sanitizeText(data.pkgVersion, 'unknown', 64),
    event,
    clientId,
    nodeVersion: sanitizeText(data.nodeVersion, '', 24),
    platform: sanitizeText(data.platform, '', 16),
    ci: data.ci === true,
    ts: new Date().toISOString(),
    properties: sanitizeProperties(data.properties),
  };

  appendFileSync(getFilePath(dataDir, safe.pkg), `${JSON.stringify(safe)}\n`, 'utf-8');
  return safe;
}

function loadStats(dataDir: string, pkg: string) {
  const path = getFilePath(dataDir, pkg);
  const empty = {
    totalPings: 0,
    uniqueUsers: 0,
    events: {} as Record<string, number>,
    versions: {} as Record<string, number>,
    platforms: {} as Record<string, number>,
    ci: { true: 0, false: 0 },
    days: {} as Record<string, number>,
  };

  if (!existsSync(path)) return empty;

  const users = new Set<string>();
  const lines = readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean);

  for (const line of lines) {
    try {
      const data = JSON.parse(line) as Partial<StoredPing>;
      if (data.clientId) users.add(data.clientId);
      if (data.event) empty.events[data.event] = (empty.events[data.event] ?? 0) + 1;
      if (data.pkgVersion) empty.versions[data.pkgVersion] = (empty.versions[data.pkgVersion] ?? 0) + 1;
      if (data.platform) empty.platforms[data.platform] = (empty.platforms[data.platform] ?? 0) + 1;
      if (typeof data.ci === 'boolean') empty.ci[String(data.ci) as 'true' | 'false'] += 1;
      if (data.ts) {
        const day = data.ts.slice(0, 10);
        empty.days[day] = (empty.days[day] ?? 0) + 1;
      }
    } catch {
      // Ignore malformed lines instead of making stats unavailable.
    }
  }

  return { ...empty, totalPings: lines.length, uniqueUsers: users.size };
}

function listPackages(dataDir: string) {
  if (!existsSync(dataDir)) return [];

  return readdirSync(dataDir)
    .filter((file) => file.endsWith('.ndjson'))
    .map((file) => file.slice(0, -'.ndjson'.length))
    .sort();
}

// Simple in-memory rate limiter: max 200 pings per minute from same IP
const pingRateMap = new Map<string, { count: number; resetAt: number }>();
function checkPingRate(req: IncomingMessage): boolean {
  const ip = (req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown').toString().split(',')[0].trim();
  const now = Date.now();
  const entry = pingRateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    pingRateMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count += 1;
  if (entry.count > 200) return false;
  return true;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendUnauthorized(res: ServerResponse): void {
  res.setHeader('WWW-Authenticate', 'Basic realm="pinglet"');
  sendJson(res, 401, { error: 'Unauthorized' });
}

export function createPingletServer(options: PingletServerOptions = {}) {
  const dataDir = options.dataDir ?? process.env.PINGLET_DATA_DIR ?? './data';
  const ingestToken = options.ingestToken ?? process.env.PINGLET_INGEST_TOKEN ?? '';
  const adminUser = options.adminUser ?? process.env.PINGLET_ADMIN_USER ?? 'admin';
  const adminPassword = options.adminPassword ?? process.env.PINGLET_ADMIN_PASSWORD ?? options.secret ?? process.env.PINGLET_SECRET ?? '';
  mkdirSync(dataDir, { recursive: true });

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Pinglet-Token');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'POST' && url.pathname === '/auth/login') {
      if (!adminPassword) {
        sendJson(res, 400, { error: 'Admin auth is not configured. Set PINGLET_ADMIN_PASSWORD first.' });
        return;
      }

      if (!hasValidBasicAdminAuth(req, adminUser, adminPassword)) {
        sendUnauthorized(res);
        return;
      }

      const session = createAdminSession(dataDir, adminUser);
      sendJson(res, 200, { ok: true, token: session.token, expiresAt: session.expiresAt });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/auth/check') {
      if (!hasValidAdminAuth(req, adminUser, adminPassword, dataDir)) {
        sendUnauthorized(res);
        return;
      }

      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/ping') {
      if (!checkPingRate(req)) {
        sendJson(res, 429, { error: 'Rate limit exceeded. Max 200 pings/minute.' });
        return;
      }

      if (!hasValidIngestAuth(req, ingestToken)) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }

      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const stored = storePing(dataDir, parsed);

        if (!stored) {
          sendJson(res, 400, { error: 'Missing or invalid fields' });
          return;
        }

        sendJson(res, 200, { ok: true });
      } catch {
        sendJson(res, 400, { error: 'Bad request' });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/stats') {
      if (!hasValidAdminAuth(req, adminUser, adminPassword, dataDir)) {
        sendUnauthorized(res);
        return;
      }

      const pkg = url.searchParams.get('pkg');
      if (!pkg) {
        sendJson(res, 400, { error: 'Missing ?pkg=' });
        return;
      }

      sendJson(res, 200, { pkg: sanitizePackageName(pkg), ...loadStats(dataDir, pkg) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/packages') {
      if (!hasValidAdminAuth(req, adminUser, adminPassword, dataDir)) {
        sendUnauthorized(res);
        return;
      }

      sendJson(res, 200, { packages: listPackages(dataDir) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, version: '0.2.0' });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  });
}

export function startPingletServer(options: PingletServerOptions = {}) {
  const port = options.port ?? Number(process.env.PORT ?? 3456);
  const dataDir = options.dataDir ?? process.env.PINGLET_DATA_DIR ?? './data';
  const adminPassword = options.adminPassword ?? process.env.PINGLET_ADMIN_PASSWORD ?? options.secret ?? process.env.PINGLET_SECRET ?? '';
  const ingestToken = options.ingestToken ?? process.env.PINGLET_INGEST_TOKEN ?? '';
  const server = createPingletServer({ ...options, dataDir });

  server.listen(port, () => {
    // Self-analytics: fire-and-forget, never blocks server startup
    Pinglet.selfTrack('server', `http://127.0.0.1:${port}/ping`);

    if (options.silent) return;
    console.log(`pinglet-server running on http://localhost:${port}`);
    console.log('POST /ping              receive telemetry events');
    console.log('POST /auth/login        create CLI admin token');
    console.log('GET  /packages          list tracked packages');
    console.log('GET  /stats?pkg=name    aggregated analytics');
    console.log(`Data dir: ${dataDir}`);
    console.log(adminPassword ? 'Admin auth: enabled' : 'Admin auth: disabled (set PINGLET_ADMIN_PASSWORD)');
    if (ingestToken) console.log('Ingest token: enabled');
  });

  return server;
}

const currentFile = pathToFileURL(fileURLToPath(import.meta.url)).href;
const invokedFile = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (currentFile === invokedFile) {
  startPingletServer();
}
