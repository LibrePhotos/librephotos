import { thumbHashToDataURL } from "thumbhash";

// Tiles mount and unmount as the grid scrolls: each hash is decoded once. A screen holds a few
// hundred tiles, and a decoded placeholder is a ~2 KB data URL.
const MAX_CACHED = 1000;
const cache = new Map<string, string | null>();

function decode(hash: string): string | null {
  try {
    const bytes = Uint8Array.from(atob(hash), char => char.charCodeAt(0));
    return thumbHashToDataURL(bytes);
  } catch {
    // Not base64, or too short to be a ThumbHash: the tile keeps its dominant colour.
    return null;
  }
}

/**
 * The placeholder picture of a tile: its base64 ThumbHash decoded to a small PNG data URL. Null
 * without a hash (a photo scanned before the backend made them) or for one that cannot be read.
 */
export function thumbhashDataUrl(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const known = cache.get(hash);
  if (known !== undefined) return known;
  const url = decode(hash);
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(hash, url);
  return url;
}

/**
 * `url` with a short digest of the photo's ThumbHash as `?v=`. The backend makes the ThumbHash
 * again whenever it builds the thumbnails again (a rotation), so a changed picture gets a new
 * address, and the server lets the browser keep each one for a year without asking again.
 * Unchanged without a hash.
 */
export function withThumbhashVersion(url: string, hash: string | null | undefined): string {
  if (!hash) return url;
  // FNV-1a, 32 bits: short, and two versions of one photo practically never share it.
  let digest = 0x811c9dc5;
  for (let i = 0; i < hash.length; i++) {
    digest = Math.imul(digest ^ hash.charCodeAt(i), 0x01000193) >>> 0;
  }
  return `${url}${url.includes("?") ? "&" : "?"}v=${digest.toString(36)}`;
}
