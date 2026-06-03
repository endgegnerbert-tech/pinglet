/**
 * pinglet - anonymous runtime usage pings for Node.js CLI tools.
 *
 * Privacy defaults:
 * - no install-time tracking
 * - no IP/hostname/username/file path collection in the client payload
 * - explicit opt-out via env vars and CLI flags
 * - first-run consent prompt in interactive terminals by default
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const PINGLET_VERSION = '0.1.0';
const DEFAULT_TIMEOUT_MS = 1_500;

type TelemetryValue = string | number | boolean | null;
export type TelemetryProperties = Record<string, TelemetryValue>;

export interface PingletOptions {
  /** Your package name, for example "my-cool-cli". */
  packageName: string;
  /** Your package version, for example "2.1.0". */
  packageVersion: string;
  /** Endpoint URL that receives POST pings. */
  endpoint: string;
  /** Ask for consent on first run in interactive terminals. Default: true. */
  askConsent?: boolean;
  /** Stable salt for the anonymous local client id. Keep consistent per project. */
  salt?: string;
  /** Suppress all console output. Default: false. */
  silent?: boolean;
  /** Network timeout. Tracking never throws. Default: 1500ms. */
  timeoutMs?: number;
  /** Optional write token for private/internal telemetry endpoints. Avoid for public OSS packages. */
  ingestToken?: string;
  /** Non-PII properties included with every ping. */
  meta?: TelemetryProperties;
}

interface PingletState {
  optedOut: boolean;
  clientId: string;
  consentAsked: boolean;
}

function sanitizePackageName(packageName: string): string {
  return packageName.replace(/[^a-z0-9@/_.-]/gi, '_').slice(0, 96);
}

function getConfigDir(): string {
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
}

function getStateFilePath(packageName: string): string {
  const dir = join(getConfigDir(), 'pinglet');
  mkdirSync(dir, { recursive: true });
  return join(dir, `${sanitizePackageName(packageName).replace(/[\/]/g, '_')}.json`);
}

function saveState(path: string, state: PingletState): void {
  try {
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // Telemetry must never break the host tool.
  }
}

function loadState(path: string, salt: string): PingletState {
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<PingletState>;
      if (typeof parsed.clientId === 'string') {
        return {
          optedOut: parsed.optedOut === true,
          clientId: parsed.clientId,
          consentAsked: parsed.consentAsked === true,
        };
      }
    } catch {
      // Fall through and create a fresh state.
    }
  }

  // Anonymous stable local id. This is random, not derived from hardware/user data.
  const rawId = randomBytes(32).toString('hex');
  const clientId = createHash('sha256').update(`${rawId}:${salt}`).digest('hex').slice(0, 32);
  const state: PingletState = { optedOut: false, clientId, consentAsked: false };
  saveState(path, state);
  return state;
}

function envFlagIsEnabled(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function shouldOptOut(): boolean {
  return (
    envFlagIsEnabled(process.env.PINGLET_OPT_OUT) ||
    envFlagIsEnabled(process.env.DO_NOT_TRACK) ||
    process.argv.includes('--no-telemetry') ||
    process.argv.includes('--disable-telemetry')
  );
}

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function askUserConsent(packageName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log('');
    console.log(`  ${packageName} can send anonymous usage pings to help improve the tool.`);
    console.log('  Collected: event name, package version, Node version, platform, CI flag.');
    console.log('  Not collected: IP in payload, hostname, username, file paths, env vars, secrets.');
    console.log('  Opt out anytime with PINGLET_OPT_OUT=1, DO_NOT_TRACK=1, or --no-telemetry.');
    console.log('');
    rl.question('  Allow anonymous telemetry? [Y/n] ', (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() !== 'n');
    });
  });
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
  opts: Required<Pick<PingletOptions, 'askConsent' | 'salt' | 'silent' | 'timeoutMs'>> & PingletOptions,
  state: PingletState,
  event: string,
  properties?: TelemetryProperties,
): Record<string, unknown> {
  return {
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
}

async function sendPing(endpoint: string, data: Record<string, unknown>, timeoutMs: number, ingestToken?: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return;
  }

  const request = url.protocol === 'https:' ? httpsRequest : url.protocol === 'http:' ? httpRequest : undefined;
  if (!request) return;

  const body = JSON.stringify(data);

  return new Promise((resolve) => {
    const req = request(
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
      (res) => {
        res.resume();
        res.on('end', resolve);
      },
    );

    req.on('socket', (socket) => socket.unref());
    req.on('error', () => resolve());
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve();
    });
    req.write(body);
    req.end();
  });
}

export class Pinglet {
  private readonly opts: Required<Pick<PingletOptions, 'askConsent' | 'salt' | 'silent' | 'timeoutMs'>> & PingletOptions;
  private readonly statePath: string;
  private state: PingletState;
  private initialized = false;
  private blockedUntilConsent = false;

  constructor(opts: PingletOptions) {
    this.opts = {
      askConsent: true,
      silent: false,
      salt: `${opts.packageName}:pinglet`,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      ...opts,
    };
    this.statePath = getStateFilePath(opts.packageName);
    this.state = loadState(this.statePath, this.opts.salt);
  }

  /** Call once at startup. Safe to call multiple times. */
  async init(): Promise<this> {
    if (this.initialized) return this;
    this.initialized = true;

    if (this.opts.askConsent && !this.state.consentAsked) {
      if (!isInteractive()) {
        this.blockedUntilConsent = true;
        return this;
      }

      const allowed = await askUserConsent(this.opts.packageName);
      this.state.optedOut = !allowed;
      this.state.consentAsked = true;
      this.blockedUntilConsent = false;
      saveState(this.statePath, this.state);

      if (!this.opts.silent) {
        console.log(allowed
          ? '  Thanks. You can opt out anytime with --no-telemetry.\n'
          : '  Telemetry disabled. No usage pings will be sent.\n');
      }
    }

    return this;
  }

  /** True if telemetry is disabled by config, env var, or CLI flag. */
  get isOptedOut(): boolean {
    return this.blockedUntilConsent || this.state.optedOut || shouldOptOut();
  }

  /** Send a named runtime event. Never throws. */
  async track(event: string, properties?: TelemetryProperties): Promise<void> {
    if (!this.initialized) await this.init();
    if (this.isOptedOut) return;

    const ping = buildPing(this.opts, this.state, event, properties);
    await sendPing(this.opts.endpoint, ping, this.opts.timeoutMs, this.opts.ingestToken);
  }

  /** Persistently disable telemetry for this user/package. */
  optOut(): void {
    this.state.optedOut = true;
    this.state.consentAsked = true;
    this.blockedUntilConsent = false;
    saveState(this.statePath, this.state);
    if (!this.opts.silent) console.log(`[${this.opts.packageName}] Telemetry disabled.`);
  }

  /** Persistently enable telemetry for this user/package. */
  optIn(): void {
    this.state.optedOut = false;
    this.state.consentAsked = true;
    this.blockedUntilConsent = false;
    saveState(this.statePath, this.state);
    if (!this.opts.silent) console.log(`[${this.opts.packageName}] Telemetry enabled.`);
  }
}
