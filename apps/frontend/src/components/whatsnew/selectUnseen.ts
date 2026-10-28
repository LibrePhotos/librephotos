import { parseInstant } from "../../util/dateUtils";
import type { WhatsNewRelease } from "./whatsNewReleases";

/** At most this many releases at once: someone who skipped more reads the release notes. */
export const MAX_SHOWN_RELEASES = 3;

export type WhatsNewViewer = Readonly<{
  /** The running server's tag (`/api/imagetag/`); "" or "dev" for a development build. */
  runningTag: string;
  /** The release whose card the user last closed or opened; "" before the first. */
  lastSeenRelease: string;
  /** `date_joined`, an ISO instant. */
  dateJoined: string;
  isAdmin: boolean;
}>;

/**
 * What the card does for this user: nothing; remember the running release without showing anything
 * (a new user, or releases with nothing for them); or show the unseen releases, newest first.
 */
export type WhatsNewDecision =
  | { kind: "nothing" }
  | { kind: "markSeen"; tag: string }
  | { kind: "show"; tag: string; releases: readonly WhatsNewRelease[] };

const NOTHING: WhatsNewDecision = { kind: "nothing" };

/** The index of the release (post) that covers `tag`; -1 when none of the bundled ones does. */
function releaseIndex(releases: readonly WhatsNewRelease[], tag: string): number {
  return tag ? releases.findIndex(release => release.versions.includes(tag)) : -1;
}

/**
 * The releases with only the highlights and after-update steps this user may see, leaving out those
 * with nothing left.
 */
export function withHighlights(releases: readonly WhatsNewRelease[], isAdmin: boolean): WhatsNewRelease[] {
  const forEveryone = (item: Readonly<{ audience: string }>) => item.audience === "all";
  return releases
    .map(release =>
      isAdmin
        ? release
        : {
            ...release,
            highlights: release.highlights.filter(forEveryone),
            after_update: release.after_update.filter(forEveryone),
          }
    )
    .filter(release => release.highlights.length > 0 || release.after_update.length > 0);
}

/** The releases from the running one down to the one last seen; null when there is nothing newer. */
function unseenReleases(
  releases: readonly WhatsNewRelease[],
  running: number,
  viewer: WhatsNewViewer
): readonly WhatsNewRelease[] | null {
  if (viewer.lastSeenRelease) {
    const seen = releaseIndex(releases, viewer.lastSeenRelease);
    // The same release (another patch of it) or a newer one, after a downgrade: nothing is new.
    if (seen !== -1 && seen <= running) return null;
    // A release older than the bundled ones counts as seen long ago: all of them are new.
    return releases.slice(running, seen === -1 ? undefined : seen);
  }
  // Joined after this release came out: they know the app as it is now.
  const joined = parseInstant(viewer.dateJoined).toMillis();
  const published = parseInstant(releases[running]?.date ?? "").toMillis();
  if (joined > published) return [];
  // An existing user meets the card for the first time: this release only.
  return releases.slice(running, running + 1);
}

/**
 * Which releases the What's new card shows (#2305). The bundled list is newest first, so no version
 * is parsed and the old 2026wNN tags need no special case. A development build or a tag the list
 * does not have shows nothing.
 */
export function selectUnseen(releases: readonly WhatsNewRelease[], viewer: WhatsNewViewer): WhatsNewDecision {
  const tag = viewer.runningTag;
  const running = releaseIndex(releases, tag);
  if (running === -1 || tag === viewer.lastSeenRelease) return NOTHING;
  const unseen = unseenReleases(releases, running, viewer);
  if (unseen === null) return NOTHING;
  const shown = withHighlights(unseen, viewer.isAdmin).slice(0, MAX_SHOWN_RELEASES);
  return shown.length > 0 ? { kind: "show", tag, releases: shown } : { kind: "markSeen", tag };
}

/**
 * What the account menu's What's new opens: the running release and the ones before it that have
 * something to show, newest first. A development build shows the newest releases.
 */
export function releasesForMenu(
  releases: readonly WhatsNewRelease[],
  runningTag: string,
  isAdmin: boolean
): WhatsNewRelease[] {
  const running = Math.max(releaseIndex(releases, runningTag), 0);
  return withHighlights(releases.slice(running), isAdmin).slice(0, MAX_SHOWN_RELEASES);
}
