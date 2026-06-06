/**
 * Shared utility functions for pinglet SDK, server, and CLI.
 * These handle input sanitization — the same logic must run client-side
 * (before sending) and server-side (after receiving) to ensure privacy.
 */

type TelemetryValue = string | number | boolean | null;
export type TelemetryProperties = Record<string, TelemetryValue>;

/** Truncate and strip control characters from arbitrary input. */
export function sanitizeText(value: unknown, fallback: string, maxLength: number): string {
  const text = typeof value === 'string' ? value : fallback;
  return text.replace(/[\n\r\t]/g, ' ').slice(0, maxLength);
}

/** Sanitize a package name: alphanumeric, @, /, _, ., - only. */
export function sanitizePackageName(value: unknown): string {
  return sanitizeText(value, '', 96).replace(/[^a-z0-9@/_.-]/gi, '_');
}

/** Sanitize an event name: alphanumeric, _, ., :, - only. */
export function sanitizeEvent(value: unknown): string {
  return sanitizeText(value, '', 128).replace(/[^a-z0-9_.:-]/gi, '_');
}

/** Strip PII from properties: max 20 keys, max 64 char keys, max 128 char string values. */
export function sanitizeProperties(input: unknown): TelemetryProperties | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;

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

/** Client id: lowercase hex only, max 64 chars. */
export function sanitizeClientId(value: unknown): string {
  return sanitizeText(value, '', 64).replace(/[^a-f0-9]/gi, '').slice(0, 64);
}
