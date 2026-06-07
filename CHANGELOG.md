# Changelog

## 0.2.2 (2026-06-07)

### Fixed
- **Docs: `npx pinglet` → `pinglet`** — All docs now use the correct command.
  The package is scoped so `npx pinglet` never worked. Added install instructions.
- **Docs: Level 1 description updated** — Now says "all event names, no properties"
  instead of "`run` only" across README, security.md, telemetry.md.
- **Docs: Version badges** — Updated to 0.2.2.

### Changed
- **Version** — 0.2.1 → 0.2.2 (docs-only release, no code changes) 

### Fixed
- **Removed `socket.unref()`** — `await track()` now reliably waits for the HTTP
  response. Previously, Node could exit before the ping was sent in short-lived
  CLI processes. Railway HTTP logs showed `499` (Client closed connection).
  This was the #1 cause of lost pings.
- **Level 1 now sends ALL event names** — `canTrackEvent()` no longer blocks
  events like `command:build`, `tool:call`, `tool:success`. Properties are still
  only included at level 3+. Matches VS Code / Next.js standard behavior.
- **CLI: `pinglet snippet <pkg>` positional arg** — Works without `--pkg` now.
  `parseArgs()` recognizes `snippet`, `show`, `stats` as commands that accept a
  package argument as `args[1]`.
- **CLI: Fixed snippet output package name** — `npm install pinglet` →
  `npm install @black-knight.dev/pinglet`, import from `'pinglet'` →
  `from '@black-knight.dev/pinglet'`.
- **Server: `/` encoding changed to `+`** — Old `_` encoding was lossy for scope
  names containing underscores (e.g. `@a_b/c`). `+` is never valid in npm package
  names. Legacy `_` files are still readable.
- **Server: `listPackages` restores `/`** — Decodes both `+` (new) and `_` (legacy).
- **Server: `loadStats` legacy fallback** — Finds old `_`-encoded data files.
- **Removed `sanitizeClientId`** — Exported from `lib/utils.ts` but never imported anywhere.
- **Removed unused `readdir` import** — From `test/pinglet.test.js`.

### Added
- **Auto-init event** — `new Pinglet(...)` now automatically sends an `init` event.
  You see who imports and instantiates the SDK, even if the developer forgets to
  call `track('run')`.
- **Notice shows package name** — The stderr notice now includes a `[package-name]`
  prefix: `[my-cli] Collects anonymous runtime usage to help improve this package.`
  End users immediately see which package is sending telemetry.
- **Snippet includes `silent: true`** — No surprise notice for end users. Developers
  can set `silent: false` if they want the notice shown.

### Changed
- **Version** — 0.2.0 → 0.2.1
- **SDK (`pinglet.ts`)** — `maybeNotify()` now accepts `packageName`. Updated doc comments.
- **Tests** — 6 tests updated for new level 1 + auto-init behavior. All 15 tests pass.

### Migration (v0.1 → v0.2.1)

| Who | What happens | Action needed? |
|-----|-------------|----------------|
| **End user** (runs CLI/tool) | No notice when `silent: true`. Notice shows package name. | `DO_NOT_TRACK=1` to disable |
| **Package maintainer** (uses pinglet SDK) | **API is unchanged.** All fixes are in the SDK. | `npm update @black-knight.dev/pinglet` for v0.2.1 |
| **Server operator** | New `+` encoding for file names. Old `_` files remain readable. | Deploy new release (Railway: done) |

---

## 0.2.0 (2026-06-06)

### Added
- **`PINGLET_DEBUG=1`** — Debug mode: prints JSON payload to stderr instead of
  sending. Users can inspect exactly what data would be transmitted before opting out.
- **`Pinglet.selfTrack(name, endpoint)`** — Static helper for internal dogfooding.
  Replaces manual `new Pinglet({...}).track('run')` in CLI and server.
- **`lib/utils.ts`** — Shared sanitization module (sanitizeText, sanitizePackageName,
  sanitizeEvent, sanitizeProperties, sanitizeClientId). Previously duplicated 1:1
  in SDK and server.
- **First-run notice** — One-time console notice on first `track()` call (TTY only),
  similar to Next.js.
- **`docs/telemetry.md`** — New documentation for the opt-out telemetry model.
- **`docs/v02-plan.md`** — Full plan and migration documentation.
- **v0.1 → v0.2 state migration** — Existing consent files are respected. Without
  a consent file: new default is ON.

### Changed
- **Telemetry model: opt-in → opt-out**
  - Tracking is ON by default (level 1: `run` events)
  - No consent prompt on `npm install`
  - No fallback prompt in `init()`
  - `Pinglet.init()` is now a no-op (backward compatible)
- **SDK (`pinglet.ts`)** — ~280 → ~210 lines. Complex consent logic removed.
- **Server (`pinglet-server.ts`)** — ~440 → ~395 lines. Sanitize functions extracted
  to `lib/utils.ts`.
- **Tests** — 12 → 15 tests. New default behavior and v0.1 migration covered.
- **`_internal` option** — Now redundant (tracking is always ON), kept for backward
  compatibility.
- **Version** — 0.1.3 → 0.2.0

### Deleted
- **`postinstall.mjs`** — Completely removed (148 lines). No consent prompt on
  `npm install` anymore.
- **`PostinstallState` interface** — No longer needed.
- **`loadPostinstallState()`** — No longer needed.
- **`consentNeverAsked` logic** — Replaced by simple opt-out model.
- **`package.json`** — `"postinstall"` script removed, `"postinstall.mjs"` removed
  from `files` array.
- **Duplicated sanitize functions** — Removed from `pinglet.ts` and
  `pinglet-server.ts`, centralized in `lib/utils.ts`.

### Migration (v0.1 → v0.2)

| Who | What happens | Action needed? |
|-----|-------------|----------------|
| **End user** (npm install of a package using pinglet) | No prompt on install. Tracking ON by default (level 1). | `DO_NOT_TRACK=1` to disable |
| **v0.1 user with consent=true** | Stay opted IN | ❌ Nothing |
| **v0.1 user with consent=false** | Stay opted OUT | ❌ Nothing |
| **v0.1 user without consent** (never saw postinstall) | **New: opted IN** (default) | Only if you don't want to send data |
| **Package maintainer** (uses pinglet SDK) | Nothing changes. `new Pinglet({...})` API is identical. | `init()` is now a no-op, can be removed |
| **Server operator** | Server API unchanged. New data format? No. | Just deploy the new release |

---

## 0.1.3 (2026-06-03)

Initial public release.
