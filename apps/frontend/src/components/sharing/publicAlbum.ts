import { shareAddress } from "../../api_client/urls";
import { validatePhotoSearch, type PhotoSearch } from "../photolist/photoSearch";

/**
 * The address of a public album, as its owner hands it out. shareAddress carries the
 * subpath the app may be served under.
 */
export function publicAlbumLink(slug: string): string {
  return `${shareAddress}/public/s/${slug}`;
}

/**
 * The public album's search params: `?slideshow=1` opens it playing as a slideshow (#1457), and
 * `?photo=` is the photo open in the lightbox (#2231), so a link can point at one photo.
 */
export type PublicAlbumSearch = { slideshow?: 1 } & PhotoSearch;

/**
 * The address that opens a public album playing as a slideshow from its first photo. The same
 * album, the same slug: only how the page starts differs.
 */
export function publicSlideshowLink(slug: string): string {
  return `${publicAlbumLink(slug)}?slideshow=1`;
}

/**
 * The public album route's search: the router reads `?slideshow=1` as the number 1, a hand-typed
 * `?slideshow=true` as true. Anything else, and every other param but `?photo=`, is dropped.
 */
export function validatePublicAlbumSearch(search: Record<string, unknown>): PublicAlbumSearch {
  const { slideshow } = search;
  const playing = slideshow === 1 || slideshow === "1" || slideshow === true || slideshow === "true";
  return { ...(playing ? { slideshow: 1 } : {}), ...validatePhotoSearch(search) };
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
