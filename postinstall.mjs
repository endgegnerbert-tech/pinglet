#!/usr/bin/env node
/**
 * pinglet postinstall — asks for consent once when someone installs a package
 * that depends on pinglet.
 *
 * This runs during npm install. Rules:
 * - Only in interactive TTY terminals
 * - Never in CI
 * - Never blocks the install
 * - Answer saved to ~/.config/pinglet/<package>.json
 * - Never shows again for the same package
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

function getConfigDir() {
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
}

function getPingletDir() {
  return join(getConfigDir(), "pinglet");
}

function getStatePath(packageName) {
  const safe = packageName.replace(/[^a-z0-9@/_.-]/gi, "_");
  const dir = getPingletDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, `${safe}.json`);
}

function loadState(packageName) {
  const path = getStatePath(packageName);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function saveState(packageName, state) {
  const path = getStatePath(packageName);
  writeFileSync(path, JSON.stringify(state, null, 2), { encoding: "utf-8", mode: 0o600 });
}

function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function isCI() {
  return Boolean(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.CIRCLECI ||
    process.env.GITLAB_CI ||
    process.env.TRAVIS ||
    process.env.JENKINS_HOME
  );
}

async function askConsent(packageName) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("");
  console.log(`  ── ${packageName} ──`);
  console.log(`  This package can send anonymous usage data to help improve it.`);
  console.log(`  No personal data, no file paths, no source code, no secrets.`);
  console.log(`  You can opt out anytime via DO_NOT_TRACK=1 or --no-telemetry.`);
  console.log("");

  const answer = await rl.question(
    "  Choose telemetry level:\n" +
    "    0 - No telemetry\n" +
    "    1 - Basic (just the tool was run)\n" +
    "    2 - Standard (run + which commands are used)  ← default\n" +
    "    3 - Extended (run + commands + non-PII metadata)\n" +
    "  \n" +
    "  Level [0-3] (default 2): "
  );
  rl.close();

  const trimmed = answer.trim();
  if (trimmed === "0") return { consent: false, level: 0 };
  if (trimmed === "3") return { consent: true, level: 3 };
  if (trimmed === "1") return { consent: true, level: 1 };

  return { consent: true, level: 2 }; // default
}

/**
 * Try to detect the host package name.
 * npm sets INIT_CWD to the directory where npm install was run.
 * We look for package.json there.
 */
function detectHostPackage() {
  try {
    const initCwd = process.env.INIT_CWD || process.cwd();
    const pkgPath = join(initCwd, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.name) return pkg.name;
    }

    // Try parent directory
    const parentPkgPath = join(dirname(initCwd), "package.json");
    if (existsSync(parentPkgPath)) {
      const pkg = JSON.parse(readFileSync(parentPkgPath, "utf-8"));
      if (pkg.name) return pkg.name;
    }
  } catch {
    // Silently fall through
  }
  return undefined;
}

async function main() {
  // Never in CI
  if (isCI()) return;

  // Never in non-interactive
  if (!isInteractive()) return;

  const packageName = detectHostPackage();

  // If we can't detect the package, show a generic prompt
  const name = packageName || "this package";

  // Already answered?
  const existing = loadState(name);
  if (existing && typeof existing.consent === "boolean") return;

  const state = await askConsent(name);
  saveState(name, state);

  if (state.consent) {
    console.log(`  ✅ Thanks! You can opt out anytime with --no-telemetry.\n`);
  } else {
    console.log(`  🚫 Telemetry disabled. No data will be sent.\n`);
  }
}

main().catch(() => {
  // Never throw — postinstall must never break the install
});
