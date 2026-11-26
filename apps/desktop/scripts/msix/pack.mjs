import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..", "..");
const tauriRoot = join(appRoot, "src-tauri");
export const NOTICES_NAME = "THIRD-PARTY-NOTICES.txt";

export const PLACEHOLDERS = {
  name: "PLACEHOLDER.LibrePhotosViewer",
  publisher: "CN=PLACEHOLDER-PartnerCenter-Publisher",
  publisherDisplayName: "PLACEHOLDER Partner Center publisher",
};

export const DESCRIPTION = "Fast, private, local photo viewer";

export function storeVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`the version must be X.Y.Z, got ${version}`);
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 65535)) throw new Error(`every part of ${version} must be at most 65535`);
  return `${parts.join(".")}.0`;
}

export function identityFrom(env) {
  const pick = (key, fallback) => (env[key] ?? "").trim() || fallback;
  const identity = {
    name: pick("MSIX_IDENTITY_NAME", PLACEHOLDERS.name),
    publisher: pick("MSIX_PUBLISHER", PLACEHOLDERS.publisher),
    publisherDisplayName: pick("MSIX_PUBLISHER_DISPLAY_NAME", PLACEHOLDERS.publisherDisplayName),
  };
  if (!/^[A-Za-z0-9.-]{3,50}$/.test(identity.name)) {
    throw new Error(`MSIX_IDENTITY_NAME must be 3 to 50 letters, digits, dots or dashes, got ${identity.name}`);
  }
  if (!/^CN=[^,]+(,\s*[A-Z]+=[^,]+)*$/.test(identity.publisher)) {
    throw new Error(`MSIX_PUBLISHER must be the publisher's distinguished name (CN=...), got ${identity.publisher}`);
  }
  return identity;
}

export function placeholdersIn(identity) {
  return Object.keys(PLACEHOLDERS).filter((key) => identity[key] === PLACEHOLDERS[key]);
}

function xml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function fileTypeAssociations(associations) {
  return associations
    .map((association) => {
      const types = association.ext.map((ext) => `              <uap:FileType>.${ext.toLowerCase()}</uap:FileType>`);
      return [
        '        <uap3:Extension Category="windows.fileTypeAssociation">',
        `          <uap3:FileTypeAssociation Name="${xml(association.name.toLowerCase())}" Parameters="&quot;%1&quot;">`,
        `            <uap:DisplayName>${xml(association.description)}</uap:DisplayName>`,
        "            <uap:SupportedFileTypes>",
        ...types,
        "            </uap:SupportedFileTypes>",
        "          </uap3:FileTypeAssociation>",
        "        </uap3:Extension>",
      ].join("\n");
    })
    .join("\n");
}

export function renderManifest({ template, identity, version, arch, executable, displayName, associations }) {
  const values = {
    IDENTITY_NAME: xml(identity.name),
    PUBLISHER: xml(identity.publisher),
    PUBLISHER_DISPLAY_NAME: xml(identity.publisherDisplayName),
    VERSION: storeVersion(version),
    ARCH: arch,
    EXECUTABLE: xml(executable),
    DISPLAY_NAME: xml(displayName),
    DESCRIPTION: xml(DESCRIPTION),
    FILE_TYPE_ASSOCIATIONS: fileTypeAssociations(associations),
  };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (whole, key) => {
    if (!(key in values)) throw new Error(`the manifest template has an unknown field ${whole}`);
    return values[key];
  });
}

export function readTauriConfig() {
  return JSON.parse(readFileSync(join(tauriRoot, "tauri.conf.json"), "utf8"));
}

function versionKey(name) {
  return name.split(".").map((part) => part.padStart(8, "0")).join(".");
}

export function findSdkBin(env = process.env) {
  if (env.WINDOWS_SDK_BIN) return env.WINDOWS_SDK_BIN;
  const kits = join(env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Windows Kits", "10", "bin");
  const candidates = existsSync(kits)
    ? readdirSync(kits)
        .filter((name) => /^10\.\d+\.\d+\.\d+$/.test(name))
        .sort((a, b) => versionKey(b).localeCompare(versionKey(a)))
        .map((name) => join(kits, name, "x64"))
        .filter((dir) => ["makeappx.exe", "makepri.exe"].every((tool) => existsSync(join(dir, tool))))
    : [];
  if (!candidates.length) throw new Error(`no Windows SDK with makeappx.exe and makepri.exe under ${kits}; set WINDOWS_SDK_BIN`);
  return candidates[0];
}

function run(program, args, options = {}) {
  console.log(`> ${basename(program)} ${args.join(" ")}`);
  const result = spawnSync(program, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${basename(program)} exited with ${result.status ?? result.error?.message}`);
  }
}

export function singlePackagePriConfig(config) {
  return config.replace(/<packaging>[\s\S]*?<\/packaging>\s*/, "");
}

export function packageNames(version, arch) {
  const stem = `librephotos-desktop-${version}-windows-${arch}`;
  return { msix: `${stem}.msix`, upload: `${stem}.msixupload` };
}

function pack({ exe, notices, version, out, arch, requireIdentity }) {
  if (!existsSync(notices)) {
    throw new Error(`the third-party notices ${notices} are missing: run node apps/desktop/scripts/notices/generate.mjs`);
  }
  const config = readTauriConfig();
  const identity = identityFrom(process.env);
  const missing = placeholdersIn(identity);
  if (missing.length && requireIdentity) {
    throw new Error(`the Store identity is not set (${missing.join(", ")}); see the desktop development docs`);
  }
  for (const key of missing) {
    console.log(`::warning::MSIX ${key} is the placeholder ${PLACEHOLDERS[key]}: fine for a test install, not for the Store`);
  }
  const sdk = findSdkBin();
  const layout = join(out, "layout");
  rmSync(layout, { recursive: true, force: true });
  mkdirSync(join(layout, "Assets"), { recursive: true });
  const executable = basename(exe);
  copyFileSync(exe, join(layout, executable));
  copyFileSync(notices, join(layout, NOTICES_NAME));
  run("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(here, "assets.ps1"),
    "-Source",
    join(tauriRoot, "icons", "icon.png"),
    "-OutDir",
    join(layout, "Assets"),
  ]);
  const manifest = renderManifest({
    template: readFileSync(join(tauriRoot, "windows", "AppxManifest.xml"), "utf8"),
    identity,
    version,
    arch,
    executable,
    displayName: config.productName,
    associations: config.bundle.fileAssociations,
  });
  writeFileSync(join(layout, "AppxManifest.xml"), manifest);
  const priConfig = join(out, "priconfig.xml");
  run(join(sdk, "makepri.exe"), ["createconfig", "/cf", priConfig, "/dq", "en-US", "/pv", "10.0.0", "/o"]);
  writeFileSync(priConfig, singlePackagePriConfig(readFileSync(priConfig, "utf8")));
  run(join(sdk, "makepri.exe"), [
    "new",
    "/pr",
    layout,
    "/cf",
    priConfig,
    "/mn",
    join(layout, "AppxManifest.xml"),
    "/of",
    join(layout, "resources.pri"),
    "/o",
  ]);
  const names = packageNames(version, arch);
  const msix = join(out, names.msix);
  run(join(sdk, "makeappx.exe"), ["pack", "/o", "/h", "SHA256", "/d", layout, "/p", msix]);
  const zip = join(out, `${names.upload}.zip`);
  rmSync(zip, { force: true });
  run("powershell", [
    "-NoProfile",
    "-Command",
    `Compress-Archive -LiteralPath '${msix.replace(/'/g, "''")}' -DestinationPath '${zip.replace(/'/g, "''")}' -Force`,
  ]);
  renameSync(zip, join(out, names.upload));
  console.log(`packed ${names.msix} and ${names.upload} (${storeVersion(version)}, ${identity.name}, ${identity.publisher})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: {
      exe: { type: "string" },
      notices: { type: "string", default: join(appRoot, "public", NOTICES_NAME) },
      version: { type: "string" },
      out: { type: "string", default: "dist-msix" },
      arch: { type: "string", default: "x64" },
      "require-identity": { type: "boolean", default: false },
    },
  });
  if (!values.exe || !values.version) {
    console.error("usage: node pack.mjs --exe <librephotos-viewer.exe> --version <X.Y.Z> [--notices <THIRD-PARTY-NOTICES.txt>] [--out <dir>] [--arch x64] [--require-identity]");
    process.exit(2);
  }
  try {
    mkdirSync(values.out, { recursive: true });
    pack({
      exe: resolve(values.exe),
      notices: resolve(values.notices),
      version: values.version,
      out: resolve(values.out),
      arch: values.arch,
      requireIdentity: values["require-identity"],
    });
  } catch (error) {
    console.error(`msix: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
