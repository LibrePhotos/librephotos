import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PLACEHOLDERS,
  identityFrom,
  packageNames,
  placeholdersIn,
  readTauriConfig,
  renderManifest,
  singlePackagePriConfig,
  storeVersion,
} from "./pack.mjs";

const template = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src-tauri", "windows", "AppxManifest.xml"),
  "utf8"
);

function manifestFor(env = {}) {
  const config = readTauriConfig();
  return renderManifest({
    template,
    identity: identityFrom(env),
    version: "1.7.0",
    arch: "x64",
    executable: "librephotos-viewer.exe",
    displayName: config.productName,
    associations: config.bundle.fileAssociations,
  });
}

test("the Store version keeps the fourth part at 0", () => {
  assert.equal(storeVersion("1.7.0"), "1.7.0.0");
  assert.equal(storeVersion("0.0.0"), "0.0.0.0");
  assert.throws(() => storeVersion("1.7"), /X\.Y\.Z/);
  assert.throws(() => storeVersion("1.7.0.1"), /X\.Y\.Z/);
  assert.throws(() => storeVersion("v1.7.0"), /X\.Y\.Z/);
  assert.throws(() => storeVersion("1.70000.0"), /65535/);
});

test("the identity comes from the environment, with visible placeholders", () => {
  const unset = identityFrom({});
  assert.deepEqual(unset, PLACEHOLDERS);
  assert.deepEqual(placeholdersIn(unset), ["name", "publisher", "publisherDisplayName"]);
  const reserved = identityFrom({
    MSIX_IDENTITY_NAME: "12345LibrePhotos.LibrePhotosViewer",
    MSIX_PUBLISHER: "CN=1A2B3C4D-0000-1111-2222-333344445555",
    MSIX_PUBLISHER_DISPLAY_NAME: "LibrePhotos",
  });
  assert.deepEqual(placeholdersIn(reserved), []);
  assert.throws(() => identityFrom({ MSIX_IDENTITY_NAME: "has space" }), /MSIX_IDENTITY_NAME/);
  assert.throws(() => identityFrom({ MSIX_PUBLISHER: "LibrePhotos" }), /MSIX_PUBLISHER/);
});

test("the manifest declares every extension the installer registers", () => {
  const manifest = manifestFor();
  const declared = [...manifest.matchAll(/<uap:FileType>\.([a-z0-9]+)<\/uap:FileType>/g)].map((m) => m[1]);
  const configured = readTauriConfig().bundle.fileAssociations.flatMap((a) => a.ext);
  assert.deepEqual(declared, configured);
  const nsis = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src-tauri", "windows", "installer-hooks.nsh"),
    "utf8"
  );
  const hooked = [...nsis.matchAll(/!insertmacro \$\{MACRO\} "\.([a-z0-9]+)"/g)].map((m) => m[1]);
  assert.deepEqual(declared, hooked);
});

test("the manifest is filled in completely and asks only for full trust", () => {
  const manifest = manifestFor({ MSIX_PUBLISHER_DISPLAY_NAME: "A & B <test>" });
  assert.doesNotMatch(manifest, /\{\{/);
  assert.match(manifest, /<PublisherDisplayName>A &amp; B &lt;test&gt;<\/PublisherDisplayName>/);
  assert.match(manifest, /Version="1\.7\.0\.0" ProcessorArchitecture="x64"/);
  assert.match(manifest, /EntryPoint="Windows\.FullTrustApplication"/);
  assert.match(manifest, /Executable="librephotos-viewer\.exe"/);
  const capabilities = [...manifest.matchAll(/Capability Name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(capabilities, ["runFullTrust"]);
  assert.doesNotMatch(manifest, /unvirtualizedResources/);
  assert.match(manifest, /Parameters="&quot;%1&quot;"/);
});

test("package names follow the installer's", () => {
  assert.deepEqual(packageNames("1.7.0", "x64"), {
    msix: "librephotos-desktop-1.7.0-windows-x64.msix",
    upload: "librephotos-desktop-1.7.0-windows-x64.msixupload",
  });
});

test("every scale stays in the one resources.pri of a single package", () => {
  const config = [
    "<resources>",
    "  <packaging>",
    '    <autoResourcePackage qualifier="Scale"/>',
    "  </packaging>",
    '  <index root="/"/>',
    "</resources>",
  ].join("\n");
  assert.equal(singlePackagePriConfig(config), '<resources>\n  <index root="/"/>\n</resources>');
});
