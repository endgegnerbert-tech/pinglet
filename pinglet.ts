/**
 * pinglet — anonymous runtime usage pings for npm packages.
 *
 * Opt-out model (industry standard, like Next.js/VS Code/Homebrew):
 *  - Tracking is ON by default (level 1: "run" events)
 *  - No consent prompts at install time or first run
 *  - Opt-out anytime: PINGLET_OPT_OUT=1, DO_NOT_TRACK=1, --no-telemetry
 *  - One-time notice on first track() call (TTY only)
 *  - Fully documented in README — open source transparency
 *
 * v0.2.0: Removed postinstall consent prompt. Default opt-in.
 * See docs/v02-plan.md for reasoning.
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

import { sanitizePackageName, sanitizeProperties } from './lib/utils.js';

const PINGLET_VERSION = '0.2.0';
const DEFAULT_TIMEOUT_MS = 1_500;
const NOTIFIED_FILENAME = '.notified';

type TelemetryValue = string | number | boolean | null;
export type TelemetryProperties = Record<string, TelemetryValue>;

export interface PingletOptions {
  /** Your package name, e.g. "@scope/package-name". */
  packageName: string;
  /** Your package version, e.g. "1.0.0". */
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
  /**
   * Internal: keep anonymous per-install client id working without consent file.
   * In v0.2 this is functionally a no-op (tracking is on by default),
   * but kept for backward compatibility.
   * @deprecated No longer needed — tracking is on by default.
   */
  _internal?: boolean;
  /**
   * Internal: telemetry level override.
   * @deprecated No longer needed.
   */
  _internalLevel?: number;
}

interface PingletState {
  optedOut: boolean;
  clientId: string;
  level: number;
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

function saveState(path: string, state: PingletState): void {
  try {
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // Never break the host tool.
  }
}

function normalizeLevel(level: unknown, fallback = 1): number {
  return level === 0 || level === 1 || level === 2 || level === 3 ? level : fallback;
}

function canTrackEvent(level: number, event: string): boolean {
  if (level <= 0) return false;
  if (level === 1) return event === 'run';
  return true;
}

function selectPropertiesForLevel(
  opts: Required<Pick<PingletOptions, 'salt' | 'silent' | 'timeoutMs'>> & PingletOptions,
  level: number,
  properties?: TelemetryProperties,
): TelemetryProperties | undefined {
  if (level >= 3) return sanitizeProperties({ ...(opts.meta ?? {}), ...(properties ?? {}) }) as TelemetryProperties | undefined;
  return undefined;
}

function loadOrCreateState(packageName: string, salt: string): PingletState {
  const path = getStateFilePath(packageName);

  // === v0.1 migration: respect existing consent files ===
  try {
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      // v0.1 postinstall format: { consent: bool, level: number }
      if (typeof parsed.consent === 'boolean' && typeof parsed.level === 'number') {
        const level = normalizeLevel(parsed.level, 1);
        // Reuse or create runtime state with clientId
        const runtimePath = getStateFilePath(`${packageName}:runtime`);
        if (existsSync(runtimePath)) {
          const rp = JSON.parse(readFileSync(runtimePath, 'utf-8')) as Partial<PingletState>;
          if (typeof rp.clientId === 'string') {
            return {
              optedOut: !parsed.consent || parsed.level === 0,
              clientId: rp.clientId,
              level,
            };
          }
        }
        const rawId = randomBytes(32).toString('hex');
        const clientId = createHash('sha256').update(`${rawId}:${salt}`).digest('hex').slice(0, 32);
        const state: PingletState = { optedOut: !parsed.consent || parsed.level === 0, clientId, level };
        writeFileSync(runtimePath, JSON.stringify(state, null, 2), 'utf-8');
        return state;
      }

      // v0.1 runtime format: { optedOut: bool, clientId: string, level: number }
      if (typeof parsed.clientId === 'string') {
        return {
          optedOut: parsed.optedOut === true,
          clientId: parsed.clientId as string,
          level: normalizeLevel(parsed.level, parsed.optedOut === true ? 0 : 1),
        };
      }
    }
  } catch {
    // Corrupt file — fall through to create fresh state
  }

  // === v0.2 default: tracking ON ===
  // In v0.1, optedOut=true in runtime state was the DEFAULT when no consent
  // file existed. In v0.2 we default to opted IN. Old runtime optedOut is
  // ignored unless a consent file exists (handled above).
  const runtimePath = getStateFilePath(`${packageName}:runtime`);
  try {
    if (existsSync(runtimePath)) {
      const parsed = JSON.parse(readFileSync(runtimePath, 'utf-8')) as Partial<PingletState>;
      if (typeof parsed.clientId === 'string') {
        // v0.2: tracking ON by default. Ignore v0.1 default-opt-out.
        return {
          optedOut: false,
          clientId: parsed.clientId,
          level: normalizeLevel(parsed.level, 1),
        };
      }
    }
  } catch {
    // Corrupt file — create fresh
  }

  // Fresh install: tracking ON, level 1 (basic)
  const rawId = randomBytes(32).toString('hex');
  const clientId = createHash('sha256').update(`${rawId}:${salt}`).digest('hex').slice(0, 32);
  const state: PingletState = { optedOut: false, clientId, level: 1 };
  saveState(runtimePath, state);
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
    properties: selectPropertiesForLevel(opts, state.level, properties),
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

/** Show first-run notice once per install. Like Next.js does. */
function maybeNotify(silent: boolean): void {
  if (silent) return;
  const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!isTTY) return;

  const dir = getPingletDir();
  const noticePath = join(dir, NOTIFIED_FILENAME);
  if (existsSync(noticePath)) return;

  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(noticePath, PINGLET_VERSION, 'utf-8');
  } catch {
    return; // Never break the host tool
  }

  console.error('');
  console.error('  pinglet collects anonymous runtime usage data to help');
  console.error('  improve this package. Learn more:');
  console.error('  https://github.com/endgegnerbert-tech/pinglet');
  console.error('  Disable anytime: DO_NOT_TRACK=1 or --no-telemetry');
  console.error('');
}

export class Pinglet {
  private readonly opts: Required<Pick<PingletOptions, 'salt' | 'silent' | 'timeoutMs'>> & PingletOptions;
  private state: PingletState;
  private notified = false;

  /**
   * Fire-and-forget self-tracking helper for internal use (CLI, server dogfooding).
   * Never throws. Uses the same opt-out model as any other package.
   */
  static selfTrack(name: string, endpoint: string): void {
    try {
      const pinglet = new Pinglet({
        packageName: `pinglet-${name}`,
        packageVersion: PINGLET_VERSION,
        endpoint,
        silent: true,
        timeoutMs: 500,
        meta: { app: `pinglet-${name}` },
      });
      pinglet.track('run');
    } catch {
      // Never break the host process
    }
  }

  constructor(opts: PingletOptions) {
    this.opts = {
      silent: false,
      salt: `${opts.packageName}:pinglet`,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      ...opts,
    };
    this.state = loadOrCreateState(opts.packageName, this.opts.salt);

    // _internal flag: backward compat — in v0.2 tracking is ON by default
    if (opts._internal) {
      this.state = {
        ...this.state,
        optedOut: false,
        level: Math.max(this.state.level, normalizeLevel(opts._internalLevel, 1)),
      };
    }
  }

  /**
   * Prepare the client. In v0.2 this is a no-op (no consent prompt needed).
   * Kept for backward compatibility with v0.1 code.
   */
  async init(): Promise<this> {
    return this;
  }

  /** True if telemetry is disabled by env var or CLI flag. */
  get isOptedOut(): boolean {
    return this.state.optedOut || shouldOptOut();
  }

  /** Send a named runtime event. Never throws. */
  async track(event: string, properties?: TelemetryProperties): Promise<void> {
    // First-run notice (once per install, TTY only)
    if (!this.notified) {
      this.notified = true;
      maybeNotify(this.opts.silent);
    }

    if (this.isOptedOut) return;
    if (!canTrackEvent(this.state.level, event)) return;
    const ping = buildPing(this.opts, this.state, event, properties);

    // PINGLET_DEBUG: print payload to stderr instead of sending
    if (process.env.PINGLET_DEBUG === '1') {
      if (!this.opts.silent) {
        console.error('[pinglet] Would send:', JSON.stringify(ping, null, 2));
        console.error('[pinglet] Disable with DO_NOT_TRACK=1 or --no-telemetry');
      }
      return;
    }

    await sendPing(this.opts.endpoint, ping, this.opts.timeoutMs, this.opts.ingestToken);
  }

  /** Persistently disable telemetry for this user/package. */
  optOut(): void {
    this.state.optedOut = true;
    this.state.level = 0;
    writeFileSync(getStateFilePath(this.opts.packageName), JSON.stringify({
      consent: false,
      level: 0,
    }, null, 2), { encoding: 'utf-8', mode: 0o600 });
    saveState(getStateFilePath(`${this.opts.packageName}:runtime`), this.state);
    if (!this.opts.silent) console.log(`[${this.opts.packageName}] Telemetry disabled.`);
  }

  /** Re-enable telemetry. */
  optIn(level = 1): void {
    this.state.optedOut = false;
    this.state.level = normalizeLevel(level, 1);
    writeFileSync(getStateFilePath(this.opts.packageName), JSON.stringify({
      consent: this.state.level > 0,
      level: this.state.level,
    }, null, 2), { encoding: 'utf-8', mode: 0o600 });
    saveState(getStateFilePath(`${this.opts.packageName}:runtime`), this.state);
    if (!this.opts.silent) console.log(`[${this.opts.packageName}] Telemetry enabled (level ${this.state.level}).`);
  }
}
