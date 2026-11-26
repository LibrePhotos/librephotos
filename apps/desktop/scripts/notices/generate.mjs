import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..", "..");
const tauriRoot = join(desktopRoot, "src-tauri");
export const NOTICES_PATH = join(desktopRoot, "public", "THIRD-PARTY-NOTICES.txt");

export const HEADER = [
  "LibrePhotos Viewer: third-party notices",
  "",
  "LibrePhotos Viewer is free software under the MIT license: https://github.com/LibrePhotos/librephotos",
  "It contains the open-source components listed below, each under its own license.",
  "",
  "This product includes DNG technology under license by Adobe.",
  "This software is based in part on the work of the Independent JPEG Group.",
  "",
  "Components under the Mozilla Public License 2.0 are used unmodified. Their source code is",
  "available at the repository or crates.io address given with each of them.",
  "",
  "On Windows, pictures in the formats HEIC, HEIF and AVIF, and videos, are decoded by components of",
  "Windows (Windows Imaging Component, Media Foundation, Microsoft Edge WebView2), not by this app.",
];

const LICENSE_FILE = /^(licen[cs]e|copying|notice|copyright|unlicense|authors)([-._].*)?$/i;

export function licenseFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => LICENSE_FILE.test(name) && statSync(join(dir, name)).isFile())
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8").replace(/\r\n/g, "\n").trim() }));
}

export function shippedCrates(metadata) {
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const root = metadata.resolve.root;
  const seen = new Set();
  const queue = [root];
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (dep.dep_kinds.some((kind) => kind.kind === null)) queue.push(dep.pkg);
    }
  }
  seen.delete(root);
  return [...seen]
    .map((id) => packages.get(id))
    .filter(Boolean)
    .map((pkg) => ({
      kind: "crate",
      name: pkg.name,
      version: pkg.version,
      license: pkg.license ?? pkg.license_file ?? "see the license files",
      source: pkg.repository ?? `https://crates.io/crates/${pkg.name}/${pkg.version}`,
      dir: dirname(pkg.manifest_path),
    }));
}

export function shippedNpmPackages(lock, nodeModulesRoot) {
  return Object.entries(lock.packages ?? {})
    .filter(([key, entry]) => key.startsWith("node_modules/") && !entry.dev && !entry.devOptional && !entry.link)
    .map(([key, entry]) => {
      const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
      const dir = resolve(nodeModulesRoot, "..", key);
      const manifest = existsSync(join(dir, "package.json")) ? JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) : {};
      const repository = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
      return {
        kind: "npm",
        name,
        version: entry.version,
        license: entry.license ?? manifest.license ?? "see the license files",
        source: repository ?? `https://www.npmjs.com/package/${name}/v/${entry.version}`,
        dir,
      };
    });
}

export function render(components) {
  const unique = new Map();
  for (const component of components) {
    unique.set(`${component.kind}:${component.name}@${component.version}`, component);
  }
  const sorted = [...unique.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.version.localeCompare(b.version, "en", { numeric: true }),
  );
  const texts = new Map();
  const entries = sorted.map((component) => {
    const refs = licenseFiles(component.dir).map((file) => {
      if (!texts.has(file.text)) texts.set(file.text, { id: `T${texts.size + 1}`, users: [] });
      const text = texts.get(file.text);
      text.users.push(`${component.name} ${component.version}`);
      return `${file.name}: ${text.id}`;
    });
    return { component, refs };
  });
  const rule = "=".repeat(78);
  const lines = [...HEADER, "", `Components (${sorted.length})`, rule, ""];
  for (const { component, refs } of entries) {
    const label = component.kind === "crate" ? "Rust crate" : "npm package";
    lines.push(`${component.name} ${component.version} (${label}), ${component.license}`, `  ${component.source}`);
    lines.push(refs.length ? `  License text: ${refs.join(", ")}` : "  The package ships no license file; see its license above.");
    lines.push("");
  }
  lines.push(`License texts (${texts.size})`, rule, "");
  for (const [text, { id, users }] of texts) {
    lines.push(`[${id}] used by ${users.join(", ")}`, "-".repeat(78), text, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function generate({ target }) {
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      ["metadata", "--format-version", "1", "--locked", "--filter-platform", target, "--manifest-path", join(tauriRoot, "Cargo.toml")],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    ),
  );
  const lock = JSON.parse(readFileSync(join(desktopRoot, "package-lock.json"), "utf8"));
  const nodeModules = join(desktopRoot, "node_modules");
  if (!existsSync(nodeModules)) {
    throw new Error("apps/desktop/node_modules is missing: run npm ci in apps/desktop first");
  }
  return render([...shippedCrates(metadata), ...shippedNpmPackages(lock, nodeModules)]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: {
      target: { type: "string", default: "x86_64-pc-windows-msvc" },
      out: { type: "string", default: NOTICES_PATH },
    },
  });
  const text = generate({ target: values.target });
  writeFileSync(values.out, text);
  console.log(`wrote ${values.out} (${text.length} bytes)`);
}
