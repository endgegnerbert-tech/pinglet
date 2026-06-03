/**
 * pinglet - anonymous runtime usage pings for Node.js CLI tools.
 *
 * Consent flow:
 * 1. When user runs "npm install <package>" and pinglet is a dependency,
 *    postinstall.mjs runs and asks for consent with privacy levels (0-3).
 * 2. Answer saved to ~/.config/pinglet/<package>.json
 * 3. At runtime Pinglet reads that file -- no second question.
 * 4. If no consent file exists (CI, non-interactive install) -> no tracking.
 *
 * Opt-out anytime:
 *   PINGLET_OPT_OUT=1, DO_NOT_TRACK=1, --no-telemetry
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const PINGLET_VERSION = '0.1.0';
const DEFAULT_TIMEOUT_MS = 1_500;

type TelemetryValue = string | number | boolean | null;
export type TelemetryProperties = Record<string, TelemetryValue>;

export interface PingletOptions {
  /** Your package name, eg "my-cool-cli". */
  packageName: string;
  /** Your package version, eg "1.0.0". */
  packageVersion: string;
  /** Endpoint URL that receives POST pings. */
  endpoint: string;
  /** Stable salt for anonymous local client id. */
  salt?: string;
  /** Suppress console output. Default false. */
  silent?: boolean;
  /** Network timeout. Default 1500ms. */
  timeoutMs?: number;
  /** Write token for private/internal endpoints. */
  ingestToken?: string;
  /** Non-PII properties included with every ping. */
  meta?: TelemetryProperties;
}

interface PingletState {
  optedOut: boolean;
  clientId: string;
}

/** Shape written by postinstall.mjs */
interface PostinstallState {
  consent: boolean;
  level: number;
}

function sanitizePackageName(packageName: string): string {
  return packageName.replace(/[^a-z0-9@/_.-]/gi, '_').slice(0, 96);
}

function getConfigDir(): string {
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
}

function getPingletDir(): string {
  return join(getConfigDir(), 'pinglet');
}

function getStateFilePath(packageName: string): string {
  const dir = getPingletDir();
  mkdirSync(dir, { recursive: true });
  const safe = sanitizePackageName(packageName).replace(/[/]/g, '_');
  return join(dir, `${safe}.json`);
}

function loadPostinstallState(packageName: string): PostinstallState | null {
  const path = getStateFilePath(packageName);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<PostinstallState>;
    if (typeof parsed.consent === 'boolean' && typeof parsed.level === 'number') {
      return parsed as PostinstallState;
    }
  } catch {
    // Ignore corrupt files.
  }
  return null;
}

function saveState(path: string, state: PingletState): void {
  try {
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // Never break the host tool.
  }
}

function loadOrCreateState(packageName: string, salt: string): PingletState {
  const path = getStateFilePath(packageName);

  // First check if there's an old-format state (from postinstall-less versions)
  try {
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      // Postinstall format: has "consent" and "level"
      if (typeof parsed.consent === 'boolean' && typeof parsed.level === 'number') {
        // Already handled by postinstall — create or keep runtime-only state
        // We need a separate runtime state for clientId
        const runtimePath = getStateFilePath(`${packageName}:runtime`);
        if (existsSync(runtimePath)) {
          const rp = JSON.parse(readFileSync(runtimePath, 'utf-8')) as Partial<PingletState>;
          if (typeof rp.clientId === 'string') {
            return { optedOut: !parsed.consent || parsed.level === 0, clientId: rp.clientId };
          }
        }
        // Create fresh runtime state
        const rawId = randomBytes(32).toString('hex');
        const clientId = createHash('sha256').update(`${rawId}:${salt}`).digest('hex').slice(0, 32);
        const state: PingletState = { optedOut: !parsed.consent || parsed.level === 0, clientId };
        writeFileSync(runtimePath, JSON.stringify(state, null, 2), 'utf-8');
        return state;
      }
      // Old format: has "optedOut" and "clientId"
      if (typeof parsed.clientId === 'string') {
        return { optedOut: parsed.optedOut === true, clientId: parsed.clientId as string };
      }
    }
  } catch {
    // Fall through
  }

  // No state at all -> create fresh, opted out by default
  // (postinstall wasn't asked or ran in CI)
  const rawId = randomBytes(32).toString('hex');
  const clientId = createHash('sha256').update(`${rawId}:${salt}`).digest('hex').slice(0, 32);
  const state: PingletState = { optedOut: true, clientId };
  saveState(getStateFilePath(`${packageName}:runtime`), state);
  return state;
}

function shouldOptOut(): boolean {
  return (
    process.env.PINGLET_OPT_OUT === '1' ||
    process.env.DO_NOT_TRACK === '1' ||
    process.argv.includes('--no-telemetry') ||
    process.argv.includes('--disable-telemetry')
  );
}

function sanitizeProperties(input?: TelemetryProperties): TelemetryProperties | undefined {
  if (!input) return undefined;

  const safe: TelemetryProperties = {};
  for (const [rawKey, rawValue] of Object.entries(input).slice(0, 20)) {
    const key = rawKey.replace(/[^a-z0-9_.:-]/gi, '_').slice(0, 64);
    if (!key) continue;
    if (typeof rawValue === 'string') safe[key] = rawValue.slice(0, 128);
    else if (typeof rawValue === 'number' && Number.isFinite(rawValue)) safe[key] = rawValue;
    else if (typeof rawValue === 'boolean' || rawValue === null) safe[key] = rawValue;
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function buildPing(
  opts: Required<Pick<PingletOptions, 'salt' | 'silent' | 'timeoutMs'>> & PingletOptions,
  state: PingletState,
  event: string,
  properties?: TelemetryProperties,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    sdk: 'pinglet',
    sdkVersion: PINGLET_VERSION,
    pkg: sanitizePackageName(opts.packageName),
    pkgVersion: String(opts.packageVersion).slice(0, 64),
    event: event.replace(/[^a-z0-9_.:-]/gi, '_').slice(0, 128),
    clientId: state.clientId,
    nodeVersion: process.version.slice(0, 24),
    platform: platform(),
    ci: Boolean(process.env.CI || process.env.GITHUB_ACTIONS || process.env.CIRCLECI),
    properties: sanitizeProperties({ ...(opts.meta ?? {}), ...(properties ?? {}) }),
  };

  return payload;
}

async function sendPing(endpoint: string, data: Record<string, unknown>, timeoutMs: number, ingestToken?: string): Promise<void> {
  let url: URL;
  try { url = new URL(endpoint); } catch { return; }

  // Only http/https — silently ignore file://, ftp:// etc.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

  const mod = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const body = JSON.stringify(data);

  return new Promise((resolve) => {
    const req = mod(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': `pinglet/${PINGLET_VERSION}`,
          ...(ingestToken ? { Authorization: `Bearer ${ingestToken}` } : {}),
        },
      },
      (res) => { res.resume(); res.on('end', resolve); },
    );
    req.on('socket', (socket) => socket.unref());
    req.on('error', () => resolve());
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(); });
    req.write(body);
    req.end();
  });
}

export class Pinglet {
  private readonly opts: Required<Pick<PingletOptions, 'salt' | 'silent' | 'timeoutMs'>> & PingletOptions;
  private state: PingletState;
  private consentNeverAsked: boolean;
  private initCalled = false;

  constructor(opts: PingletOptions) {
    this.opts = {
      silent: false,
      salt: `${opts.packageName}:pinglet`,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      ...opts,
    };
    this.consentNeverAsked = !existsSync(getStateFilePath(opts.packageName));
    this.state = loadOrCreateState(opts.packageName, this.opts.salt);
  }

  /**
   * Call once at startup.
   * If postinstall never ran (--ignore-scripts, non-interactive install),
   * shows a fallback consent prompt once when TTY is available.
   */
  async init(): Promise<this> {
    if (this.initCalled) return this;
    this.initCalled = true;

    // Fallback: postinstall never ran → ask once if we have a terminal
    if (this.consentNeverAsked && this.state.optedOut && !this.opts.silent) {
      if (process.stdin.isTTY && process.stdout.isTTY) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        console.log('');
        console.log(`  ${this.opts.packageName} can send anonymous usage pings.`);
        console.log('  Choose level (0=off, 1=basic, 2=standard, 3=extended):');
        const answer = await rl.question('  Level [0-3] (default 2): ');
        rl.close();

        const level = ['2', '0', '1', '3'].includes(answer.trim())
          ? Number(answer.trim()) : 2;

        const consentFile = getStateFilePath(this.opts.packageName);
        writeFileSync(consentFile, JSON.stringify({
          consent: level > 0,
          level,
        }), { encoding: 'utf-8', mode: 0o600 });

        // Reload state with the new consent
        this.state = loadOrCreateState(this.opts.packageName, this.opts.salt);
        console.log(level > 0
          ? '  Tracking enabled. Opt out anytime with --no-telemetry.\n'
          : '  Telemetry disabled.\n');
      }
    }

    return this;
  }

  /** True if telemetry is disabled by consent, env var, or CLI flag. */
  get isOptedOut(): boolean {
    return this.state.optedOut || shouldOptOut();
  }

  /** Send a named runtime event. Never throws. */
  async track(event: string, properties?: TelemetryProperties): Promise<void> {
    if (this.isOptedOut) return;
    const ping = buildPing(this.opts, this.state, event, properties);
    await sendPing(this.opts.endpoint, ping, this.opts.timeoutMs, this.opts.ingestToken);
  }

  /** Persistently disable telemetry for this user/package. */
  optOut(): void {
    this.state.optedOut = true;
    const path = getStateFilePath(this.opts.packageName);
    saveState(path, this.state);
    if (!this.opts.silent) console.log(`[${this.opts.packageName}] Telemetry disabled.`);
  }

  /** Re-enable telemetry. */
  optIn(): void {
    this.state.optedOut = false;
    const path = getStateFilePath(this.opts.packageName);
    saveState(path, this.state);
    if (!this.opts.silent) console.log(`[${this.opts.packageName}] Telemetry enabled.`);
  }
}
