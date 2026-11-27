import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { HEADER, MACOS_TARGETS, WINDOWS_TARGET, header, licenseFiles, render, shippedCrates, shippedNpmPackages } from "./generate.mjs";

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), "lpview-notices-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function crate(dir, name, files) {
  const path = join(dir, name);
  mkdirSync(path, { recursive: true });
  for (const [file, text] of Object.entries(files)) writeFileSync(join(path, file), text);
  return path;
}

test("only normal dependencies reachable from the app ship", () => {
  const metadata = {
    resolve: {
      root: "app",
      nodes: [
        {
          id: "app",
          deps: [
            { pkg: "image", dep_kinds: [{ kind: null }] },
            { pkg: "tauri-build", dep_kinds: [{ kind: "build" }] },
            { pkg: "tempfile", dep_kinds: [{ kind: "dev" }] },
          ],
        },
        { id: "image", deps: [{ pkg: "png", dep_kinds: [{ kind: null }] }] },
        { id: "png", deps: [] },
        { id: "tauri-build", deps: [{ pkg: "toml", dep_kinds: [{ kind: null }] }] },
        { id: "toml", deps: [] },
        { id: "tempfile", deps: [] },
      ],
    },
    packages: ["app", "image", "png", "tauri-build", "toml", "tempfile"].map((id) => ({
      id,
      name: id,
      version: "1.0.0",
      license: "MIT",
      manifest_path: `/r/${id}/Cargo.toml`,
    })),
  };
  assert.deepEqual(shippedCrates(metadata).map((c) => c.name).sort(), ["image", "png"]);
});

test("a crate without a repository points at crates.io", () => {
  const metadata = {
    resolve: { root: "app", nodes: [{ id: "app", deps: [{ pkg: "x", dep_kinds: [{ kind: null }] }] }, { id: "x", deps: [] }] },
    packages: [
      { id: "app", name: "app", version: "0.1.0", manifest_path: "/r/app/Cargo.toml" },
      { id: "x", name: "x", version: "2.3.4", license: "MPL-2.0", manifest_path: "/r/x/Cargo.toml" },
    ],
  };
  assert.equal(shippedCrates(metadata)[0].source, "https://crates.io/crates/x/2.3.4");
});

test("npm dev, optional-dev and workspace links do not ship", (t) => {
  const root = scratch(t);
  const nodeModules = join(root, "node_modules");
  crate(nodeModules, "react", { "package.json": JSON.stringify({ license: "MIT", repository: "github:facebook/react" }) });
  const lock = {
    packages: {
      "": {},
      "node_modules/react": { version: "19.0.0", license: "MIT" },
      "node_modules/vite": { version: "8.0.0", dev: true },
      "node_modules/fsevents": { version: "2.0.0", devOptional: true },
      "node_modules/@librephotos/api-client": { link: true },
    },
  };
  const shipped = shippedNpmPackages(lock, nodeModules);
  assert.deepEqual(shipped.map((p) => p.name), ["react"]);
  assert.equal(shipped[0].source, "github:facebook/react");
});

test("license files are found by name and line endings are normalised", (t) => {
  const dir = crate(scratch(t), "c", { "LICENSE-MIT": "a\r\nb\r\n", "NOTICE": "n", "README.md": "no", "COPYING": "c" });
  assert.deepEqual(licenseFiles(dir), [
    { name: "COPYING", text: "c" },
    { name: "LICENSE-MIT", text: "a\nb" },
    { name: "NOTICE", text: "n" },
  ]);
});

test("identical license texts are printed once and every component refers to them", (t) => {
  const dir = scratch(t);
  const a = crate(dir, "a", { LICENSE: "MIT text" });
  const b = crate(dir, "b", { LICENSE: "MIT text" });
  const c = crate(dir, "c", {});
  const text = render([
    { kind: "crate", name: "b", version: "1.0.0", license: "MIT", source: "https://b", dir: b },
    { kind: "crate", name: "a", version: "1.0.0", license: "MIT", source: "https://a", dir: a },
    { kind: "npm", name: "c", version: "1.0.0", license: "ISC", source: "https://c", dir: c },
  ]);
  assert.ok(text.startsWith(HEADER.join("\n")));
  assert.match(text, /This product includes DNG technology under license by Adobe\./);
  assert.match(text, /based in part on the work of the Independent JPEG Group\./);
  assert.equal(text.split("MIT text").length - 1, 1);
  assert.match(text, /\[T1\] used by a 1\.0\.0, b 1\.0\.0/);
  assert.ok(text.indexOf("a 1.0.0 (Rust crate)") < text.indexOf("b 1.0.0 (Rust crate)"));
  assert.match(text, /c 1\.0\.0 \(npm package\), ISC\n {2}https:\/\/c\n {2}The package ships no license file/);
});

test("the header names the system codecs of the platform the notices ship with", (t) => {
  const windows = header([WINDOWS_TARGET]).join("\n");
  assert.deepEqual(header([WINDOWS_TARGET]), HEADER);
  assert.match(windows, /On Windows, pictures in the formats HEIC, HEIF and AVIF/);
  assert.doesNotMatch(windows, /macOS/);

  const mac = header(MACOS_TARGETS).join("\n");
  assert.match(mac, /On macOS, pictures in the formats HEIC, HEIF and AVIF are decoded by ImageIO/);
  assert.doesNotMatch(mac, /Windows Imaging Component|WebView2/);
  assert.match(mac, /This product includes DNG technology under license by Adobe\./);

  const dir = crate(scratch(t), "a", { LICENSE: "MIT text" });
  const text = render([{ kind: "crate", name: "a", version: "1.0.0", license: "MIT", source: "https://a", dir }], MACOS_TARGETS);
  assert.ok(text.startsWith(header(MACOS_TARGETS).join("\n")));
  assert.doesNotMatch(text, /Windows/);
});

test("crates shipped for several targets are listed once", (t) => {
  const dir = crate(scratch(t), "objc2", { LICENSE: "MIT text" });
  const objc2 = { kind: "crate", name: "objc2", version: "0.6.5", license: "MIT", source: "https://o", dir };
  const text = render([objc2, { ...objc2 }], MACOS_TARGETS);
  assert.equal(text.split("objc2 0.6.5 (Rust crate)").length - 1, 1);
  assert.match(text, /Components \(1\)/);
});
