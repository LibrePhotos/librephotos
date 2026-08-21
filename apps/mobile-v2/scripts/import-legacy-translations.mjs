#!/usr/bin/env node
/**
 * Best-effort importer for legacy React-Native app translations
 * (apps/mobile/src/Translations/resources) into the mobile-v2 i18next resources.
 *
 * Reality check (why this is "best-effort"):
 *   - The legacy app only ships an English resource (`en.js`); it never had
 *     other locales, so there are NO non-English strings to import.
 *   - Its key structure (`auth.label.username`, `actions.continue`, …) barely
 *     overlaps the mobile-v2 key surface, so only a handful of keys map.
 *
 * This script therefore does two useful things and is committed as the reusable
 * mechanism:
 *   1. Applies the explicit LEGACY→MOBILE_V2 key map below and reports which
 *      mobile-v2 keys a legacy value could seed (so a human can confirm wording).
 *   2. Writes a per-locale JSON under src/i18n/locales/generated/ for every
 *      locale that yielded at least one mapped string. Locales with nothing to
 *      import are skipped — at runtime they fall back to English (i18next
 *      fallbackLng), which is the correct behaviour until Weblate fills them in.
 *
 * Run: node scripts/import-legacy-translations.mjs
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, "..");
const LEGACY_DIR = resolve(APP_ROOT, "../mobile/src/Translations/resources");
const OUT_DIR = resolve(APP_ROOT, "src/i18n/locales/generated");

/** Legacy locales to attempt (the legacy app only ever had "en"). */
const LEGACY_LOCALES = ["en"];

/** Explicit legacy(dotted) → mobile-v2(dotted) key map (mechanical, reviewed). */
const KEY_MAP = {
  "auth.label.username": "login.username",
  "auth.label.password": "login.password",
  "auth.label.submit": "login.submit",
  "actions.continue": "common.retry",
};

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function setDeep(target, dottedKey, value) {
  const parts = dottedKey.split(".");
  let node = target;
  for (let i = 0; i < parts.length - 1; i++) {
    node[parts[i]] ??= {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
}

async function loadLegacy(locale) {
  try {
    const mod = await import(pathToFileURL(resolve(LEGACY_DIR, `${locale}.js`)).href);
    return mod.default ?? mod;
  } catch (err) {
    console.warn(`  ! could not load legacy ${locale}: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log("Importing legacy translations → mobile-v2 i18next resources\n");
  let totalWritten = 0;

  for (const locale of LEGACY_LOCALES) {
    const legacy = await loadLegacy(locale);
    if (!legacy) continue;
    const flat = flatten(legacy);
    const resource = {};
    let mapped = 0;
    for (const [legacyKey, targetKey] of Object.entries(KEY_MAP)) {
      if (flat[legacyKey] != null) {
        setDeep(resource, targetKey, flat[legacyKey]);
        mapped += 1;
      }
    }
    console.log(`  ${locale}: ${mapped} key(s) mapped from ${Object.keys(flat).length} legacy strings`);

    // Only emit non-English locales — English is the hand-authored base (en.ts).
    if (locale !== "en" && mapped > 0) {
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(resolve(OUT_DIR, `${locale}.json`), JSON.stringify(resource, null, 2) + "\n");
      totalWritten += 1;
    }
  }

  console.log(
    `\nDone. ${totalWritten} generated locale file(s). ` +
      "Non-English locales with no import fall back to English at runtime."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
