#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
export const tauriDir = resolve(here, "../../src-tauri");
export const BUNDLE_ID = "com.librephotos.viewer";
export const APP_NAME = "LibrePhotos Viewer";
export const DMG_URL = "https://github.com/LibrePhotos/librephotos/releases/download/#{version}/librephotos-desktop-#{version}-macos-universal.dmg";

export const UTI_BY_EXTENSION = {
  jpg: "public.jpeg",
  jpeg: "public.jpeg",
  jpe: "public.jpeg",
  jfif: "public.jpeg",
  png: "public.png",
  gif: "com.compuserve.gif",
  webp: "org.webmproject.webp",
  bmp: "com.microsoft.bmp",
  tif: "public.tiff",
  tiff: "public.tiff",
  heic: "public.heic",
  heif: "public.heif",
  hif: "public.heif",
  avif: "public.avif",
  jxl: "public.jpeg-xl",
  dng: "public.camera-raw-image",
  cr2: "public.camera-raw-image",
  cr3: "public.camera-raw-image",
  nef: "public.camera-raw-image",
  nrw: "public.camera-raw-image",
  arw: "public.camera-raw-image",
  orf: "public.camera-raw-image",
  rw2: "public.camera-raw-image",
  raf: "public.camera-raw-image",
  pef: "public.camera-raw-image",
  srw: "public.camera-raw-image",
  raw: "public.camera-raw-image",
};

export const DATA_LOCATIONS = [
  `~/Library/Application Support/${BUNDLE_ID}`,
  `~/Library/Caches/${BUNDLE_ID}`,
  `~/Library/HTTPStorages/${BUNDLE_ID}`,
  `~/Library/Preferences/${BUNDLE_ID}.plist`,
  `~/Library/Saved Application State/${BUNDLE_ID}.savedState`,
  `~/Library/WebKit/${BUNDLE_ID}`,
];

export function readTauriConfig(dir = tauriDir) {
  return JSON.parse(readFileSync(join(dir, "tauri.conf.json"), "utf8"));
}

export function associationProblems(config) {
  const problems = [];
  for (const association of config.bundle.fileAssociations) {
    const wanted = new Set();
    for (const ext of association.ext) {
      const uti = UTI_BY_EXTENSION[ext];
      if (uti) wanted.add(uti);
      else problems.push(`${association.name}: no UTI known for .${ext}`);
    }
    const declared = new Set(association.contentTypes ?? []);
    for (const uti of wanted) if (!declared.has(uti)) problems.push(`${association.name}: contentTypes lacks ${uti}`);
    for (const uti of declared) if (!wanted.has(uti)) problems.push(`${association.name}: contentTypes has ${uti}, which none of its extensions maps to`);
  }
  return problems;
}

function escapeXml(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function plist(entries) {
  const body = Object.entries(entries)
    .map(([key, value]) => {
      const node = typeof value === "boolean" ? (value ? "<true/>" : "<false/>") : `<string>${escapeXml(value)}</string>`;
      return `  <key>${escapeXml(key)}</key>\n  ${node}`;
    })
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    body,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

export function baseEntitlements(text) {
  const entries = {};
  for (const match of text.matchAll(/<key>([^<]+)<\/key>\s*<(true|false)\/>/g)) entries[match[1]] = match[2] === "true";
  return entries;
}

export function appStoreEntitlements(base, teamId) {
  if (!teamId) return { ...base };
  if (!/^[A-Z0-9]{10}$/.test(teamId)) throw new Error(`APPLE_TEAM_ID must be 10 letters or digits, got ${teamId}`);
  return {
    ...base,
    "com.apple.application-identifier": `${teamId}.${BUNDLE_ID}`,
    "com.apple.developer.team-identifier": teamId,
  };
}

export function bundleVersion(version, build) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`version must be X.Y.Z, got ${version}`);
  if (!/^\d+$/.test(String(build))) throw new Error(`build must be a whole number, got ${build}`);
  return String(build);
}

export function overlay({ flavor, version, build, identity, entitlementsPath, profilePath }) {
  const macOS = { bundleVersion: bundleVersion(version, build), signingIdentity: identity || "-", hardenedRuntime: true };
  if (flavor === "app-store") {
    if (!entitlementsPath) throw new Error("the App Store build needs its entitlements");
    macOS.entitlements = entitlementsPath;
    macOS.files = profilePath ? { "embedded.provisionprofile": profilePath } : {};
  } else if (flavor === "developer-id") {
    macOS.entitlements = null;
  } else {
    throw new Error(`unknown flavor ${flavor}; use developer-id or app-store`);
  }
  return { version, bundle: { macOS } };
}

export function cask({ version, sha256, url = DMG_URL }) {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`sha256 must be 64 hex digits, got ${sha256}`);
  const verified = url.startsWith("https://github.com/") ? ',\n      verified: "github.com/LibrePhotos/librephotos/"' : "";
  const zap = DATA_LOCATIONS.map(path => `    "${path}",`).join("\n");
  return `cask "librephotos-viewer" do
  version "${version}"
  sha256 "${sha256}"

  url "${url}"${verified}
  name "${APP_NAME}"
  desc "Fast picture viewer with a local library and LibrePhotos server backup"
  homepage "https://docs.librephotos.com/docs/user-guide/desktop/"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :monterey"

  app "${APP_NAME}.app"

  zap trash: [
${zap}
  ]
end
`;
}

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  console.log(`wrote ${path}`);
}

function main(argv) {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      flavor: { type: "string" },
      version: { type: "string", default: "0.0.0" },
      build: { type: "string", default: "1" },
      identity: { type: "string", default: process.env.APPLE_SIGNING_IDENTITY || "-" },
      "team-id": { type: "string", default: process.env.APPLE_TEAM_ID || "" },
      profile: { type: "string", default: "" },
      sha256: { type: "string" },
      url: { type: "string" },
      out: { type: "string" },
    },
  });
  if (command === "check") {
    const problems = associationProblems(readTauriConfig());
    for (const problem of problems) console.log(`::error::${problem}`);
    if (problems.length > 0) process.exit(1);
    console.log("file associations: every extension has its UTI in contentTypes");
    return;
  }
  if (!values.out) throw new Error("--out is required");
  if (command === "overlay") {
    const out = resolve(values.out);
    let entitlementsPath = null;
    if (values.flavor === "app-store") {
      const base = baseEntitlements(readFileSync(join(tauriDir, "macos", "AppStore.entitlements"), "utf8"));
      entitlementsPath = join(out, "AppStore.entitlements");
      write(entitlementsPath, plist(appStoreEntitlements(base, values["team-id"])));
    }
    const config = overlay({
      flavor: values.flavor,
      version: values.version,
      build: values.build,
      identity: values.identity,
      entitlementsPath,
      profilePath: values.profile ? resolve(values.profile) : null,
    });
    write(join(out, `tauri.${values.flavor}.json`), `${JSON.stringify(config, null, 2)}\n`);
    return;
  }
  if (command === "cask") {
    write(resolve(values.out), cask({ version: values.version, sha256: values.sha256 ?? "", url: values.url ?? DMG_URL }));
    return;
  }
  throw new Error(`usage: config.mjs check | overlay --flavor developer-id|app-store --out DIR | cask --version X --sha256 S --out FILE`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
