#!/usr/bin/env node
/**
 * packages/api-client is compiled into the apps from source: the web app
 * (apps/frontend, Yarn) aliases it and resolves its imports from its own
 * node_modules, the mobile app (apps/mobile, root npm workspace) imports it as a
 * workspace, and the desktop app (apps/desktop, its own npm install) aliases its
 * React-free `core` entry. No install checks the package's peer ranges, so this does.
 *
 * Fails when
 * - a consumer's installed zod, React or React Query does not satisfy the
 *   package's peer range (the package's own dev install included: its tests run
 *   on it), or
 * - the web app and the mobile app are on different zod majors.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The package's runtime peers, which both apps must provide. */
export const SHARED = ["zod", "react", "@tanstack/react-query"];

const API_CLIENT = "packages/api-client";
const LOCAL_DB = "packages/local-db";

export const LOCAL_DB_SHARED = ["drizzle-orm"];
const MOBILE = "apps/mobile";
const DESKTOP = "apps/desktop";

/* ---- a small semver subset ---------------------------------------------- */

/** "4.6.6" -> [4, 6, 6]. Pre-release and build suffixes are not supported. */
export function parseVersion(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!m) throw new Error(`unsupported version "${version}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** A comparator such as "^4", "~5.96.0", ">=18", "19.2.3" or "*" -> [op, lower, upper) bounds. */
function comparator(text) {
  const m = /^(\^|~|>=|<=|>|<|=)?v?(\*|x|\d+)(?:\.(\*|x|\d+))?(?:\.(\*|x|\d+))?$/.exec(text);
  if (!m) throw new Error(`unsupported range "${text}"`);
  const op = m[1] ?? "=";
  const parts = [m[2], m[3], m[4]];
  const wild = parts.findIndex(p => p === undefined || p === "*" || p === "x");
  const given = (wild === -1 ? parts : parts.slice(0, wild)).map(Number);
  const low = [given[0] ?? 0, given[1] ?? 0, given[2] ?? 0];
  if (given.length === 0) return () => true;
  // The first version above the range a partial or caret/tilde comparator covers.
  const bump = index => low.map((n, i) => (i < index ? n : i === index ? n + 1 : 0));
  let high;
  if (op === "^") {
    const first = low.findIndex(n => n !== 0);
    high = bump(Math.min(first === -1 ? given.length - 1 : first, given.length - 1));
  } else if (op === "~") {
    high = bump(given.length === 1 ? 0 : 1);
  } else if (given.length < 3) {
    high = bump(given.length - 1);
  }
  switch (op) {
    case "^":
    case "~":
      return v => compare(v, low) >= 0 && compare(v, high) < 0;
    case "=":
      return high ? v => compare(v, low) >= 0 && compare(v, high) < 0 : v => compare(v, low) === 0;
    case ">=":
      return v => compare(v, low) >= 0;
    case ">":
      return high ? v => compare(v, high) >= 0 : v => compare(v, low) > 0;
    case "<":
      return v => compare(v, low) < 0;
    case "<=":
      return high ? v => compare(v, high) < 0 : v => compare(v, low) <= 0;
    default:
      throw new Error(`unsupported range "${text}"`);
  }
}

/** Does `version` satisfy the npm range `range`? Supports `||`, AND-ed comparators, ^ ~ >= > <= < = and x/* wildcards. */
export function satisfies(version, range) {
  const v = parseVersion(version);
  // Parse every comparator before testing any, so bad syntax always throws.
  const sets = range.split("||").map(set => set.trim().split(/\s+/).filter(Boolean).map(comparator));
  return sets.some(set => set.every(test => test(v)));
}

export function major(version) {
  return parseVersion(version)[0];
}

/* ---- lockfiles ------------------------------------------------------------ */

/**
 * The version yarn.lock (v1) resolved for the dependency `name@range`, i.e. the
 * block whose header lists that exact specifier.
 */
export function versionFromYarnLock(lockText, name, range) {
  const wanted = `${name}@${range}`;
  let inBlock = false;
  for (const line of lockText.split(/\r?\n/)) {
    if (line && !line.startsWith(" ") && !line.startsWith("#")) {
      const specifiers = line
        .replace(/:$/, "")
        .split(",")
        .map(s => s.trim().replace(/^"|"$/g, ""));
      inBlock = specifiers.includes(wanted);
      continue;
    }
    const m = inBlock && /^ {2}version "?([^"\s]+)"?$/.exec(line);
    if (m) return m[1];
  }
  return undefined;
}

/**
 * The version a workspace at `workspaceDir` gets when it imports `name`, read
 * from the root package-lock.json the way Node resolves it: its own
 * node_modules first, then the hoisted root copy.
 */
export function versionFromPackageLock(lock, workspaceDir, name) {
  const packages = lock.packages ?? {};
  for (const key of [`${workspaceDir}/node_modules/${name}`, `node_modules/${name}`]) {
    if (packages[key]?.version) return packages[key].version;
  }
  return undefined;
}

/* ---- the check ------------------------------------------------------------ */

function declared(manifest, name) {
  return manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
}

/**
 * What the check looks at, from the repo's files:
 * { peers: { name: range }, installed: { consumer: { name: version | undefined } } }
 */
export function collect(repoRoot) {
  const json = path => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
  const apiClient = json(`${API_CLIENT}/package.json`);
  const web = json("apps/frontend/package.json");
  const yarnLock = readFileSync(join(repoRoot, "apps/frontend/yarn.lock"), "utf8");
  const packageLock = json("package-lock.json");
  const desktop = json(`${DESKTOP}/package.json`);
  const desktopLock = json(`${DESKTOP}/package-lock.json`);

  const installed = { web: {}, mobile: {}, "api-client (dev)": {}, desktop: {} };
  for (const name of SHARED) {
    const webRange = declared(web, name);
    installed.web[name] = webRange && versionFromYarnLock(yarnLock, name, webRange);
    installed.mobile[name] = versionFromPackageLock(packageLock, MOBILE, name);
    installed["api-client (dev)"][name] = versionFromPackageLock(packageLock, API_CLIENT, name);
    // The desktop imports `core` (no React Query): only what it declares, zod always.
    if (name === "zod" || declared(desktop, name)) {
      installed.desktop[name] = versionFromPackageLock(desktopLock, "", name);
    }
  }
  return { peers: { ...apiClient.peerDependencies }, installed, localDb: collectLocalDb(repoRoot, packageLock, desktopLock) };
}

export function collectLocalDb(repoRoot, packageLock, desktopLock) {
  const manifest = JSON.parse(readFileSync(join(repoRoot, `${LOCAL_DB}/package.json`), "utf8"));
  const installed = { mobile: {}, "local-db (dev)": {} };
  if (desktopLock) installed.desktop = {};
  const nested = [];
  for (const name of LOCAL_DB_SHARED) {
    installed.mobile[name] = versionFromPackageLock(packageLock, MOBILE, name);
    installed["local-db (dev)"][name] = versionFromPackageLock(packageLock, LOCAL_DB, name);
    if (desktopLock) installed.desktop[name] = versionFromPackageLock(desktopLock, "", name);
    for (const dir of [MOBILE, LOCAL_DB]) {
      const key = `${dir}/node_modules/${name}`;
      if (packageLock.packages?.[key]) nested.push(key);
    }
  }
  return { peers: { ...manifest.peerDependencies }, installed, nested };
}

export function findLocalDbProblems({ peers, installed, nested }) {
  const problems = [];
  for (const name of LOCAL_DB_SHARED) {
    const range = peers[name];
    if (!range) {
      problems.push(`${LOCAL_DB} does not declare ${name} as a peer dependency`);
      continue;
    }
    for (const [consumer, versions] of Object.entries(installed)) {
      const version = versions[name];
      if (!version) problems.push(`${consumer}: ${name} is not installed (no lockfile entry)`);
      else if (!satisfies(version, range))
        problems.push(`${consumer}: ${name} ${version} does not satisfy the ${LOCAL_DB} peer range ${range}`);
    }
  }
  for (const key of nested) problems.push(`a second copy is installed at ${key}; the app and ${LOCAL_DB} must share one`);
  return problems;
}

/** Every mismatch, as a message; empty when the versions agree. */
export function findProblems({ peers, installed }) {
  const problems = [];
  for (const name of SHARED) {
    const range = peers[name];
    if (!range) {
      problems.push(`${API_CLIENT} does not declare ${name} as a peer dependency`);
      continue;
    }
    for (const [consumer, versions] of Object.entries(installed)) {
      if (!(name in versions)) continue;
      const version = versions[name];
      if (!version) problems.push(`${consumer}: ${name} is not installed (no lockfile entry)`);
      else if (!satisfies(version, range))
        problems.push(`${consumer}: ${name} ${version} does not satisfy the ${API_CLIENT} peer range ${range}`);
    }
  }
  const zods = Object.entries(installed)
    .filter(([consumer, versions]) => consumer !== "api-client (dev)" && versions.zod)
    .map(([consumer, versions]) => [consumer, versions.zod]);
  if (new Set(zods.map(([, version]) => major(version))).size > 1) {
    problems.push(
      `zod majors differ: ${zods.map(([consumer, version]) => `${consumer} ${version}`).join(", ")}. The shared schemas run under all of them; bump zod in every manifest together`
    );
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const facts = collect(repoRoot);
  const problems = [...findProblems(facts), ...findLocalDbProblems(facts.localDb)];
  for (const [consumer, versions] of Object.entries(facts.installed)) {
    console.log(`${consumer}: ${Object.entries(versions).map(([n, v]) => `${n} ${v ?? "?"}`).join(", ")}`);
  }
  console.log(`peers: ${SHARED.map(n => `${n} ${facts.peers[n] ?? "?"}`).join(", ")}`);
  for (const [consumer, versions] of Object.entries(facts.localDb.installed)) {
    console.log(`${consumer}: ${LOCAL_DB_SHARED.map(n => `${n} ${versions[n] ?? "?"}`).join(", ")}`);
  }
  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`);
    process.exit(1);
  }
  console.log("shared dependencies agree");
}
