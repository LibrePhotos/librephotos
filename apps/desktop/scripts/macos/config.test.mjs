import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  BUNDLE_ID,
  DATA_LOCATIONS,
  appStoreEntitlements,
  associationProblems,
  baseEntitlements,
  bundleVersion,
  cask,
  overlay,
  plist,
  readTauriConfig,
  tauriDir,
} from "./config.mjs";

const base = baseEntitlements(readFileSync(join(tauriDir, "macos", "AppStore.entitlements"), "utf8"));

test("every file type the app opens is claimed by its UTI", () => {
  assert.deepEqual(associationProblems(readTauriConfig()), []);
});

test("a stale contentTypes list is caught", () => {
  const config = {
    bundle: { fileAssociations: [{ name: "Image", ext: ["jpg", "heic", "xyz"], contentTypes: ["public.jpeg", "public.png"] }] },
  };
  assert.deepEqual(associationProblems(config), [
    "Image: no UTI known for .xyz",
    "Image: contentTypes lacks public.heic",
    "Image: contentTypes has public.png, which none of its extensions maps to",
  ]);
});

test("the App Store build is sandboxed with only what the viewer needs", () => {
  assert.deepEqual(base, {
    "com.apple.security.app-sandbox": true,
    "com.apple.security.network.client": true,
    "com.apple.security.files.user-selected.read-write": true,
    "com.apple.security.files.bookmarks.app-scope": true,
    "com.apple.security.assets.pictures.read-write": true,
  });
});

test("a team ID adds the identifiers App Store Connect checks, and only then", () => {
  assert.deepEqual(appStoreEntitlements(base, ""), base);
  const signed = appStoreEntitlements(base, "ABCDE12345");
  assert.equal(signed["com.apple.application-identifier"], `ABCDE12345.${BUNDLE_ID}`);
  assert.equal(signed["com.apple.developer.team-identifier"], "ABCDE12345");
  assert.equal(signed["com.apple.security.app-sandbox"], true);
  assert.throws(() => appStoreEntitlements(base, "team"), /10 letters/);
});

test("plists are written the way codesign reads them", () => {
  assert.equal(
    plist({ "a.b": true, c: false, d: "x & <y>" }),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      "<dict>",
      "  <key>a.b</key>\n  <true/>",
      "  <key>c</key>\n  <false/>",
      "  <key>d</key>\n  <string>x &amp; &lt;y&gt;</string>",
      "</dict>",
      "</plist>",
      "",
    ].join("\n"),
  );
  assert.deepEqual(baseEntitlements(plist({ "a.b": true, c: false })), { "a.b": true, c: false });
});

test("the overlays sign ad hoc unless an identity is given", () => {
  assert.deepEqual(overlay({ flavor: "developer-id", version: "1.7.0", build: "42" }), {
    version: "1.7.0",
    bundle: { macOS: { bundleVersion: "42", signingIdentity: "-", hardenedRuntime: true, entitlements: null } },
  });
  const store = overlay({
    flavor: "app-store",
    version: "1.7.0",
    build: "43",
    identity: "Apple Distribution: LibrePhotos (ABCDE12345)",
    entitlementsPath: "/tmp/AppStore.entitlements",
    profilePath: "/tmp/viewer.provisionprofile",
  });
  assert.deepEqual(store.bundle.macOS, {
    bundleVersion: "43",
    signingIdentity: "Apple Distribution: LibrePhotos (ABCDE12345)",
    hardenedRuntime: true,
    entitlements: "/tmp/AppStore.entitlements",
    files: { "embedded.provisionprofile": "/tmp/viewer.provisionprofile" },
  });
  assert.deepEqual(overlay({ flavor: "app-store", version: "1.7.0", build: "1", entitlementsPath: "/e" }).bundle.macOS.files, {});
  assert.throws(() => overlay({ flavor: "app-store", version: "1.7.0", build: "1" }), /entitlements/);
  assert.throws(() => overlay({ flavor: "mas", version: "1.7.0", build: "1" }), /unknown flavor/);
  assert.throws(() => bundleVersion("1.7", "1"), /X\.Y\.Z/);
  assert.throws(() => bundleVersion("1.7.0", "1.2"), /whole number/);
});

test("the cask installs the app and zaps every folder the app writes", () => {
  const sha = "a".repeat(64);
  const text = cask({ version: "1.7.0", sha256: sha });
  assert.match(text, /^cask "librephotos-viewer" do$/m);
  assert.match(text, /version "1\.7\.0"/);
  assert.match(text, new RegExp(`sha256 "${sha}"`));
  assert.match(text, /url "https:\/\/github\.com\/LibrePhotos\/librephotos\/releases\/download\/#\{version\}\/librephotos-desktop-#\{version\}-macos-universal\.dmg",\n {6}verified: "github\.com\/LibrePhotos\/librephotos\/"/);
  assert.match(text, /app "LibrePhotos Viewer\.app"/);
  assert.match(text, /depends_on macos: :monterey$/m);
  for (const path of DATA_LOCATIONS) assert.ok(text.includes(`"${path}",`), path);
  assert.doesNotMatch(cask({ version: "1.7.0", sha256: sha, url: "file:///tmp/x.dmg" }), /verified/);
  assert.throws(() => cask({ version: "1.7.0", sha256: "abc" }), /64 hex/);
});

test("the minimum macOS matches the cask", () => {
  assert.equal(readTauriConfig().bundle.macOS.minimumSystemVersion, "12.0");
  assert.equal(readTauriConfig().identifier, BUNDLE_ID);
});
