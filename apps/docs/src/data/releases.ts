// Release index helpers, shared by the <Since> component (bundled by Docusaurus) and the release
// scripts in apps/docs/scripts (run by Node, which strips the types). Keep this file free of imports
// and of TypeScript-only syntax that Node cannot strip (enums, namespaces, parameter properties).

export type Audience = "all" | "admin";

export type Highlight = {
  id: string;
  audience: Audience;
  title: string;
  body: string;
  shot?: string;
  learn_more: string;
  open_in_app?: string;
};

export type ReleaseEntry = {
  /** The tag the post is named after, also its slug. */
  release: string;
  /** Every tag the post covers, newest last; starts with `release`. */
  versions: string[];
  date: string;
  title: string;
  permalink: string;
  summary: string;
  highlights: Highlight[];
};

export type ReleaseIndex = {
  latest: string;
  /** Newest first. */
  releases: ReleaseEntry[];
};

/** The part of the index that <Since> needs; the JSON import satisfies it without a cast. */
export type SinceIndex = {
  latest: string;
  releases: { versions: string[]; permalink: string }[];
};

export type SinceState =
  | { released: true; version: string; permalink: string }
  | { released: false; version: string; latest: string };

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(version: string): [number, number, number] {
  const match = VERSION.exec(version);
  if (!match) {
    throw new Error(`"${version}" is not a release version like 1.4.0`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative when a is older than b, 0 when equal, positive when newer. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) {
      return left[i] - right[i];
    }
  }
  return 0;
}

export function isPatchRelease(version: string): boolean {
  return parseVersion(version)[2] !== 0;
}

/**
 * Whether `version` is out, judged by the release posts in the index. A version at or below the
 * latest release that has no post is a typo (or a release without its post), so it throws: the
 * docs build then fails instead of showing a wrong marker.
 */
export function sinceState(version: string, index: SinceIndex): SinceState {
  parseVersion(version);
  const entry = index.releases.find((r) => r.versions.includes(version));
  if (entry) {
    return { released: true, version, permalink: entry.permalink };
  }
  if (compareVersions(version, index.latest) <= 0) {
    throw new Error(
      `<Since version="${version}"> names a release that is not newer than ${index.latest} but has no release post in apps/docs/blog`,
    );
  }
  return { released: false, version, latest: index.latest };
}

export function sinceLabel(state: SinceState): string {
  return state.released ? `New in ${state.version}` : `Not released yet (comes after ${state.latest})`;
}
