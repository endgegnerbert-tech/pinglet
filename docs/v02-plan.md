# pinglet v0.2 — Real usage for every npm package

> **Scope:** All npm packages — CLI tools, libraries, frameworks, API clients, build tools, dev servers, anything installable via npm.
>
> **Goal:** From ~2% tracking rate to ~80%+. Zero consent friction. Industry-standard opt-out model.

---

## 🔍 Problem

### pinglet v0.1 hat drei fundamentale Probleme

**1. postinstall.mjs ist broken für Dependencies**

Der Consent-Prompt läuft bei `npm install <paket>`. Aber `detectHostPackage()` liest `INIT_CWD/package.json` — das ist das **User-Projekt**, nicht das zu installierende Package. Consent wird unter falschem Namen gespeichert. Die Runtime findet ihn nie → kein Tracking.

**2. Consent nur in TTY = 90%+ der Installs sehen es nie**

CI, Docker, `npm install --ignore-scripts`, non-interactive Terminals → kein Prompt → kein Consent-File → `optedOut: true`.

**3. Selbst wenn es klappt: User muss erst Level > 0 wählen**

Die Hürde ist zu hoch. Resultat: von ~1.100 wöchentlichen Downloads kommen 27 Pings an. ~2,4% Conversion. Die Daten sind wertlos.

### Was die Industrie macht

| Tool | Modell | Default | Resultat |
|------|--------|---------|----------|
| **Next.js** | Opt-out | ON | ~80%+ senden Daten |
| **VS Code** | Opt-out | ON | ~80%+ senden Daten |
| **Homebrew** | Opt-out | ON | ~80%+ senden Daten |
| **Angular CLI** | Opt-in | OFF | ~5% senden Daten |
| **pinglet v0.1** | Broken | OFF | **~2% senden Daten** |

Kein einziges erfolgreiches OSS-Dev-Tool verwendet ein Install-Prompt-Modell. Alle setzen auf dokumentiertes Opt-out.

---

## 🎯 Vision v0.2

> **pinglet tracked by default. Punkt. Wer nicht will, sagt `DO_NOT_TRACK=1`.**
>
> Kein Prompt. Kein postinstall. Kein Consent-File-Judo.
> Nur: `npm install` → `analytics.track('run')` → Daten kommen an.
>
> Dokumentiert im README. Open Source. Jeder kann nachlesen was passiert.

### Für ALLE npm packages

pinglet ist nicht nur für CLI-Tools. Jedes npm package kann Runtime-Analytics gebrauchen:

- **CLI-Tools** (TypeScript, ESLint, Create React App): Welche Commands werden genutzt?
- **Libraries** (React, Lodash, Express): Welche Versionen sind aktiv? Wird die Library überhaupt noch genutzt?
- **Frameworks** (Next.js, Astro, Nuxt): Wie viele aktive Projekte? Welche Features?
- **API-Clients** (axios, got, undici): Wer nutzt welche Version?
- **Dev-Server, Build-Tools, Code-Generatoren, Scaffolding-Tools** — alles was läuft.

---

## 🏆 Differenzierung von der Konkurrenz

| Feature | Next.js Tel. | PostHog | OpenTelemetry | **pinglet v0.2** |
|---------|:---:|:---:|:---:|:---:|
| **Für ALLE npm packages** | ❌ Nur Next.js | ❌ Web-Fokus | ❌ Enterprise | **✅ Beliebiges Package** |
| **Fertig in 5 Minuten** | ❌ | ❌ Account+Setup | ❌ Massiv Overhead | **✅ npm i + 5 Zeilen Code** |
| **Self-hosted (1-Click)** | ❌ Vercel only | ⚠️ Bezahlt | ✅ Aber schwer | **✅ Railway 1-Click Deploy** |
| **Zero Dependencies** | ⚠️ conf | ❌ Heavy SDK | ❌ Sehr heavy | **✅ 0 Dependencies** |
| **Anonym by Design** | ⚠️ Project ID | ❌ User-Account | ❌ | **✅ Kein IP, Cookie, Hostname** |
| **Open Source** | ✅ | ⚠️ BSL License | ✅ | **✅ MIT** |
| **Multi-Package** | ❌ | ❌ | ❌ | **✅ Ein Server, viele Packages** |
| **SDK Größe** | ~5KB | >100KB | >500KB | **<1KB gzipped** |
| **Datenschutz** | Mittel | Drittanbieter | Selbstverwaltet | **✅ Volle Kontrolle** |

**Die Positionierung:**

> pinglet ist das Next.js-Telemetry-Modell — aber als generisches, self-hosted, zero-dep SDK für **jedes npm package**.

---

## 📋 Umsetzung

### Schritt 1: `postinstall.mjs` entfernen

**Was:**
- `postinstall.mjs` löschen
- `"postinstall": "node postinstall.mjs"` aus `package.json` entfernen
- `"hasInstallScript": true` aus package.json entfernen

**Dateien:**
- `/postinstall.mjs` → gelöscht
- `/package.json` → scripts.postinstall entfernt, hasInstallScript entfernt

**Check:**
- `npm install @black-knight.dev/pinglet` zeigt keine Prompts mehr
- Kein `postinstall`-Script im published Package

---

### Schritt 2: SDK vereinfachen (`pinglet.ts`)

**Was:**
- `PostinstallState`-Interface entfernen (nicht mehr nötig)
- `loadPostinstallState()` entfernen
- `consentNeverAsked`-Feld aus der Klasse entfernen
- `init()`-Methode vereinfachen — kein Fallback-Prompt mehr
- Neue Default-Werte: `optedOut = false`, `level = 1`
- `loadOrCreateState()`: Wenn kein State-File existiert → neu mit `optedOut: false, level: 1`

**Warum:**
- Kein Consent-File mehr nötig → kein broken `detectHostPackage()`
- Jeder `new Pinglet(...)` trackt sofort
- `_internal`-Flag bleibt für Server/CLI-Selbsttracking (wird dann redundant und kann später auch raus)

**Geänderte Datei:**
- `/pinglet.ts`

**Check:**
```ts
const a = new Pinglet({
  packageName: 'test',
  packageVersion: '1.0.0',
  endpoint: 'http://localhost:3456/ping',
});
await a.track('run'); // ✅ trackt ohne Fragen
assert.equal(a.isOptedOut, false);
```

---

### Schritt 3: First-Run Notice (wie Next.js)

**Was:**
- Einmalige Konsolen-Notice beim ersten `track()`-Aufruf
- Text: _"pinglet: This package collects anonymous usage data. Learn more at https://github.com/endgegnerbert-tech/pinglet. Disable with DO_NOT_TRACK=1."_
- Status in `~/.config/pinglet/.notified` speichern
- Nur einmal, nie wieder — auch nicht nach Update
- Nur im TTY (nicht in CI, Pipe, etc.)

**Wo:**
- Neue Methode `maybeNotify()` in `pinglet.ts`
- Wird in `track()` aufgerufen (beim ersten mal)

**Datei:**
- `/pinglet.ts`

**Check:**
- Erster `track()`-Aufruf im Terminal zeigt Notice
- Zweiter Aufruft zeigt nichts
- In CI zeigt nichts
- Notice erscheint nach löschen von `~/.config/pinglet/.notified` wieder

---

### Schritt 4: State-File Migration (v0.1 → v0.2)

**Was:**
- Wenn ein v0.1-State-File existiert mit `consent: true / level: X` → übernehmen
- Wenn `consent: false / level: 0` → respektieren (`optedOut: true`)
- Wenn **kein** State-File (95% der Fälle) → neuer Default: `optedOut: false, level: 1`
- Alte `:runtime`-State-Files können ignoriert werden (Client-ID wird neu generiert — akzeptabler Bruch)

**Wo:**
- `loadOrCreateState()` in `pinglet.ts`

**Datei:**
- `/pinglet.ts`

**Check:**
- v0.1-User mit `consent: true / level: 2` → tracked weiter mit Level 2
- v0.1-User mit `consent: false` → bleibt opted out
- Neuinstallation → tracked by default

---

### Schritt 5: README + Docs aktualisieren

**Was:**
- README.md: Neue Telemetry-Sektion
- `docs/telemetry.md`: Detaillierte Beschreibung (was, warum, opt-out)
- `docs/security.md`: Consent-Modell aktualisieren
- `docs/maintainer-guide.md`: Vereinfachen — kein postinstall mehr nötig

**README Telemetry-Sektion:**

```markdown
## 📡 Telemetry

**@black-knight.dev/pinglet** collects anonymous runtime usage data to help
maintainers understand how their packages are actually used.

### What's collected

- Random anonymous client ID (SHA-256 hashed, no hardware/user link)
- Event name (`run`, `command:build`)
- Package name + version
- Node.js version + platform (darwin/linux/win32)
- CI flag

### What's NOT collected

❌ IP address, hostname, username, email
❌ File paths, project names, git remotes
❌ Source code, logs, stack traces, secrets
❌ Environment variables or API keys

### Opt-out

```bash
DO_NOT_TRACK=1 npx my-tool
PINGLET_OPT_OUT=1 npx my-tool
npx my-tool --no-telemetry
```

### Transparency

pinglet is 100% open source (MIT). The entire SDK is a single file:
[github.com/endgegnerbert-tech/pinglet/blob/main/pinglet.ts](...)

The server is also open source and self-hosted — no third-party analytics.
```

**Dateien:**
- `/README.md`
- `/docs/telemetry.md` (neu)
- `/docs/security.md`
- `/docs/maintainer-guide.md`

**Check:**
- README erklärt transparent was passiert
- Opt-out Methoden sind dokumentiert
- Maintainer-Guide ist kürzer und klarer

---

### Schritt 6: Security-Doc aktualisieren

**Was:**
- Consent-Modell-Sektion ersetzen mit dem neuen Modell
- Kein postinstall mehr erwähnen
- Neuen Abschnitt "Warum Opt-out?" einfügen

**Datei:**
- `/docs/security.md`

**Check:**
- Keine Erwähnung von postinstall oder install-time consent
- Opt-out-Modell korrekt beschrieben

---

### Schritt 7: Server aktualisieren + deployen

**Was:**
- Version auf `0.2.0` in package.json
- Railway Deployment checken
- Neuen Release auf npm publish

**Dateien:**
- `/package.json` → version: "0.2.0"
- `/pinglet-server.ts` → version string auf "0.2.0"

**Check:**
- `npx pinglet health` zeigt "ok, version 0.2.0"
- Server läuft auf https://pinglet-production.up.railway.app
- Release published auf npm

---

## 📅 Migrationspfad v0.1 → v0.2

| Aspekt | v0.1 | v0.2 | Breaking? |
|--------|------|------|-----------|
| Consent | Prompt bei Install | **Kein Prompt** | ✅ Ja |
| Default | Level 1 (nach Consent) | **Level 1 (immer)** | ✅ Ja |
| Opt-Out | env var + CLI flag | env var + CLI flag | ❌ Nein |
| postinstall.mjs | Ja | **Gelöscht** | ❌ Nur pinglet-Repo |
| `_internal` | Bypasst Consent | **Wird unnötig** | ❌ Backward kompatibel |
| Client-ID | Aus State-File | Aus State-File | ❌ Gleich |
| init() | Zeigt evtl. Prompt | **Kein Prompt** | ✅ Ja |
| First-Run Notice | Nein | **Einmalig** | ❌ Neu |

**Breaking Changes für Maintainer (pinglet-Nutzer):**
1. `init()` zeigt keinen Prompt mehr → Code der darauf wartet läuft durch
2. Kein postinstall mehr → keine Install-Fragen mehr an Endnutzer
3. Wer in v0.1 opted out war bleibt opted out (Migration Step 4)
4. `_internal`-Flag ist jetzt redundant (aber noch da)

---

## ✅ Erfolgskriterien

| Metrik | v0.1 | v0.2 Ziel |
|--------|------|-----------|
| Conversion (Downloads → Pings) | ~2% | **>50%** |
| Pings pro Tracked Package | 27/Woche | **>500/Woche** (für emet) |
| Code-Größe SDK | ~180 Zeilen | **<150 Zeilen** |
| Dependencies | 0 | **0** 🎯 |
| postinstall.mjs | 80 Zeilen | **0 Zeilen** |
| First-Run Notice | Nein | **Ja, einmalig** |
| GDPR-Komplexität | Hoch (consent mgmt) | **Niedrig (dokumentiert)** |

---

## ❌ Was NICHT geändert wird

- Server-Code (`pinglet-server.ts`) — funktioniert, unverändert
- Datenmodell (NDJSON, clientId, events) — bleibt
- CLI-Tools (`pinglet-cli.ts`) — bleibt
- API-Endpoints (POST /ping, GET /stats, GET /packages) — bleiben
- Rate Limiting — bleibt
- Security/Auth — bleibt

---

## 📊 Erwartete Ergebnisse nach v0.2

**emet (Beispiel):**
- npm Downloads/Woche: ~1.100
- Erwartete Pings/Woche: ~800 (bei >50% CI-Filter)
- Erwartete Unique Users: ~300
- Aktive Versionen: sichtbar
- CI vs Local: sichtbar
- Plattform-Split: sichtbar

**pinglet-cli (Selbsttracking):**
- `_internal`-Flag wird redundant, aber backward-kompatibel
- Server-Start + CLI-Nutzung werden ganz normal getrackt

**Beliebige neue Packages:**
- npm install → 5 Zeilen Code → Daten kommen an
- Kein Prompts, keine Config, keine Fragen
- Maintainer sieht nach 24h erste echte Daten
