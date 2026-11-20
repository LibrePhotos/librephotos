export const SOURCE_PATHS = [
  /^apps\/backend\//,
  /^apps\/frontend\/src\//,
  /^apps\/mobile\/src\//,
  /^apps\/desktop\//,
  /^packages\/[^/]+\/src\//,
  /^deploy\//,
];

export const DOCS_PATHS = [/^apps\/docs\/docs\//, /^apps\/docs\/blog\//];

export const EXEMPT_PATHS = [
  ["test", /(^|\/)(tests?|__tests__|__mocks__|e2e|fixtures)\//],
  ["test", /\.(test|spec)\.[cm]?[jt]sx?$/],
  ["test", /(^|\/)(test_[^/]*|[^/]*_test|conftest)\.py$/],
  ["test", /(^|\/)__snapshots__\/|\.snap$/],
  ["ci", /^\.github\//],
  ["lockfile", /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|uv\.lock|poetry\.lock)$/],
  ["translation", /^apps\/frontend\/src\/locales\/(?!en\/)[^/]+\//],
  ["markdown", /\.md$/],
];

const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "overrides", "resolutions", "engines"];
const VERSION = /v?\d+(?:\.\d+)*(?:[-.]?(?:a|b|rc|alpha|beta|pre|post|dev|next|canary)\.?\d*)?/g;
const DIGEST = /sha256:[0-9a-f]{64}|\b[0-9a-f]{40}\b/g;

export function exemptReason(path) {
  return EXEMPT_PATHS.find(([, pattern]) => pattern.test(path))?.[0] ?? null;
}

const isSource = (path) => SOURCE_PATHS.some((pattern) => pattern.test(path));
const isDocs = (path) => DOCS_PATHS.some((pattern) => pattern.test(path));

function withoutVersions(line) {
  return line.replace(DIGEST, "<digest>").replace(VERSION, "<version>");
}

function withoutQuotedVersions(line) {
  return line.replace(DIGEST, "<digest>").replace(/(["'])(.*?)\1/g, (_, quote, body) => `${quote}${body.replace(VERSION, "<version>")}${quote}`);
}

function stripDependencyVersions(manifest) {
  const copy = { ...manifest };
  delete copy.packageManager;
  for (const section of DEPENDENCY_SECTIONS) {
    if (copy[section] && typeof copy[section] === "object") copy[section] = JSON.stringify(Object.keys(copy[section]).sort());
  }
  return JSON.stringify(copy);
}

function packageJsonVersionOnly(file) {
  try {
    return stripDependencyVersions(JSON.parse(file.oldText)) === stripDependencyVersions(JSON.parse(file.text));
  } catch {
    return false;
  }
}

function linesPairUp(file, normalize, eligible = () => true) {
  return file.hunks.every(
    (hunk) =>
      hunk.removed.length === hunk.added.length &&
      hunk.removed.every((removed, index) => eligible(removed) && eligible(hunk.added[index]) && normalize(removed) === normalize(hunk.added[index])),
  );
}

const IMAGE_LINE = /^\s*(?:FROM\s|ARG\s+\w*VERSION\w*=|(?:-\s*)?image:\s)/i;

export function versionOnly(file) {
  if (file.status !== "modified" || file.hunks.length === 0) return false;
  const name = file.path.slice(file.path.lastIndexOf("/") + 1);
  if (name === "package.json") return packageJsonVersionOnly(file);
  if (/^(requirements|constraints)[^/]*\.txt$/.test(name)) return linesPairUp(file, withoutVersions);
  if (name === "pyproject.toml" || name === "Cargo.toml") return linesPairUp(file, withoutQuotedVersions);
  if (/^\.(nvmrc|node-version|python-version)$/.test(name)) return linesPairUp(file, withoutVersions);
  if (/^Dockerfile/.test(name) || /\.ya?ml$/.test(name)) return linesPairUp(file, withoutVersions, (line) => IMAGE_LINE.test(line));
  return false;
}

export function docsViolation(files) {
  if (files.some((file) => isDocs(file.path) || isDocs(file.oldPath ?? file.path))) return null;
  const sources = files
    .filter((file) => isSource(file.path) || isSource(file.oldPath ?? file.path))
    .filter((file) => !exemptReason(file.path))
    .filter((file) => !versionOnly(file))
    .map((file) => file.path);
  return sources.length === 0 ? null : { sources };
}
