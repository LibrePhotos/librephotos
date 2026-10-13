import { shareAddress } from "../../api_client/urls";

/**
 * The address of a public album, as its owner hands it out. shareAddress carries the
 * subpath the app may be served under.
 */
export function publicAlbumLink(slug: string): string {
  return `${shareAddress}/public/s/${slug}`;
}

/**
 * True for a public album whose owner keeps the capture dates private (the
 * default). The server then sends every photo in one group without a date,
 * which a date view shows as a "Without Timestamp" day: wrong, the photos do
 * have dates. Such an album is shown as a flat grid instead.
 */
export function isUndatedShare(groups: ReadonlyArray<{ date?: string | null }>): boolean {
  return groups.length === 1 && !groups[0]?.date;
}
