# Changelog

## 0.2.0 (2026-06-06)

### Added
- **`PINGLET_DEBUG=1`** — Debug mode: prints JSON payload to stderr instead of sending. Users can inspect exactly what data would be transmitted before opting out.
- **`Pinglet.selfTrack(name, endpoint)`** — Static helper for internal dogfooding. Ersetzt das manuelle `new Pinglet({...}).track('run')` in CLI und Server.
- **`lib/utils.ts`** — Shared sanitization module (sanitizeText, sanitizePackageName, sanitizeEvent, sanitizeProperties, sanitizeClientId). Vorher 1:1 in SDK und Server dupliziert.
- **First-run notice** — Einmalige Konsolen-Notice beim ersten `track()`-Aufruf (TTY only), wie Next.js es macht.
- **`docs/telemetry.md`** — Neue Dokumentation des Opt-out Telemetry-Modells.
- **`docs/v02-plan.md`** — Vollständiger Plan und Migrationsdokumentation.
- **V0.1 → v0.2 State-Migration** — Bestehende Consent-Files werden respektiert. Ohne Consent-File: neuer Default (ON).

### Changed
- **Telemetry-Modell: Opt-in → Opt-out**
  - Tracking ist jetzt ON by default (Level 1: `run`-Events)
  - Kein Consent-Prompt mehr bei `npm install`
  - Kein Fallback-Prompt in `init()` mehr
  - `Pinglet.init()` ist jetzt ein No-op (backward compat)
- **SDK (`pinglet.ts`)** — ~280 → ~210 Zeilen. Komplexe Consent-Logik entfernt.
- **Server (`pinglet-server.ts`)** — ~440 → ~395 Zeilen. Sanitize-Funktionen in lib/utils.ts extrahiert.
- **Tests** — 12 → 15 Tests. Neues Default-Verhalten und v0.1-Migration abgedeckt.
- **`_internal` Option** — Ist jetzt redundant (Tracking ist immer ON), bleibt aber backward-kompatibel erhalten.
- **Version** — 0.1.3 → 0.2.0

### Deleted
- **`postinstall.mjs`** — Komplett entfernt (148 Zeilen). Kein Consent-Prompt mehr bei `npm install`.
- **`PostinstallState`-Interface** — Nicht mehr benötigt.
- **`loadPostinstallState()`** — Nicht mehr benötigt.
- **`consentNeverAsked`-Logik** — Ersetzt durch einfaches Opt-out Modell.
- **`package.json`** — `"postinstall"`-Script entfernt, `"postinstall.mjs"` aus `files`-Array entfernt.
- **Duplizierte Sanitize-Funktionen** — Aus `pinglet.ts` und `pinglet-server.ts` entfernt, zentral in `lib/utils.ts`.

### Migration (v0.1 → v0.2)

| Wer | Was passiert | Manuelles Tun? |
|-----|-------------|----------------|
| **Endnutzer** (npm install von Package mit pinglet) | Kein Prompt mehr bei Install. Tracking ON by default (Level 1). | `DO_NOT_TRACK=1` zum Ausschalten |
| **v0.1 User mit consent=true** | Bleiben opted IN | ❌ Nichts |
| **v0.1 User mit consent=false** | Bleiben opted OUT | ❌ Nichts |
| **v0.1 User ohne Consent** (kein Postinstall gesehen) | **Neu: opted IN** (Default) | Nur wenn du keine Daten senden willst |
| **Package Maintainer** (nutzt pinglet SDK) | Nichts ändert sich. `new Pinglet({...})` API ist identisch. | `init()` ist jetzt No-op, kann entfernt werden |
| **Server Betreiber** | Server-API unverändert. Neues Datenformat? Nein. | Einfach neues Release deployen |
