/**
 * The viewer route contract.
 *
 * Opening the lightbox used to be `router.push('/photo/<id>')` and nothing else,
 * which meant the viewer's very first job was to ask the database what it had
 * just been asked to show. On a real phone that round-trip happened before
 * anything could be painted, so the tap felt like it had been ignored.
 *
 * The grid already holds everything a slide needs to render — hash, camera-roll
 * uri, media type — so it hands them over as route params. The viewer paints
 * that seed on its first frame and only then reads the database for the rest of
 * the pager. Params are a hint, never a source of truth: a deep link or a
 * notification carries only `id`, and the viewer falls back to a single indexed
 * lookup.
 */
import type { ViewerSlide } from "@/db/queries/detail";

/** The subset of a grid tile the viewer can render a slide from. */
export type ViewerSeedSource = {
  key: string;
  photoId?: string | null;
  imageHash?: string | null;
  type?: string | null;
  localUri?: string | null;
};

export type PhotoRoute = {
  pathname: "/photo/[id]";
  params: { id: string } & Record<string, string>;
};

/**
 * Where a tapped tile routes to, seeded with what the tile already knows.
 *
 * `id` stays what it has always been — the image hash when there is one, the
 * tile key otherwise — so existing links, notifications and the memories card
 * keep working. A camera-roll asset has no hash until it is hashed, which is why
 * the id must never be assumed to be one.
 */
export function photoRoute(item: ViewerSeedSource): PhotoRoute {
  const params: { id: string } & Record<string, string> = { id: item.imageHash ?? item.key };
  if (item.imageHash) params.sh = item.imageHash;
  if (item.localUri) params.su = item.localUri;
  if (item.type) params.st = item.type;
  if (item.photoId) params.sr = item.photoId;
  // A tile with no server row but a camera-roll file is keyed by its asset id.
  if (!item.photoId && item.localUri) params.sl = item.key;
  return { pathname: "/photo/[id]", params };
}

/**
 * The slide to paint on the viewer's first frame, from route params alone —
 * no database, no query, no waiting. Null when the params carry nothing
 * renderable (a bare deep link), in which case the viewer resolves the id
 * against the mirror instead.
 */
export function seedSlideFromParams(params: Record<string, unknown>): ViewerSlide | null {
  const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
  const id = str(params.id);
  const image_hash = str(params.sh);
  const local_uri = str(params.su);
  const local_id = str(params.sl);
  const remote_id = str(params.sr);
  // Nothing to draw without either a camera-roll file or a server-side hash.
  if (!local_uri && !image_hash) return null;
  return {
    key: remote_id ?? local_id ?? image_hash ?? id ?? "",
    remote_id,
    local_id,
    image_hash,
    local_uri,
    type: str(params.st),
  };
}
