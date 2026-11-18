/**
 * The few LibrePhotos API answers the library reads, through `serverFetch` (Rust sends them with
 * the session's token). Parsed by hand with guards: the shapes follow `packages/api-client`
 * (`searchPhotos`, `fetchPhotoDetails`), reduced to the fields used here.
 */
import { serverFetch } from "./api";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export type ServerHit = { imageHash: string; date: string | null; video: boolean };

function hitOf(item: unknown): ServerHit | null {
  if (!isRecord(item)) return null;
  const imageHash = str(item.image_hash) ?? str(item.id);
  if (!imageHash) return null;
  return { imageHash, date: str(item.date) ?? str(item.exif_timestamp), video: item.type === "video" || item.video === true };
}

/**
 * The server's search (`/api/photos/searchlist/`): captions, places, things, people and, with
 * semantic search on, CLIP. The answer is date groups (`{date, items}`) or a flat list.
 */
export async function searchServer(query: string): Promise<ServerHit[]> {
  const res = await serverFetch(`/api/photos/searchlist/?search=${encodeURIComponent(query)}`);
  const results = isRecord(res) && Array.isArray(res.results) ? res.results : [];
  const hits: ServerHit[] = [];
  for (const r of results) {
    if (isRecord(r) && Array.isArray(r.items)) {
      for (const item of r.items) {
        const h = hitOf(item);
        if (h) hits.push(h);
      }
    } else {
      const h = hitOf(r);
      if (h) hits.push(h);
    }
  }
  return hits;
}

export type ServerPhoto = {
  caption: string | null;
  people: string[];
  tags: string[];
  favourite: boolean;
  rating: number;
  place: string | null;
  imageHash: string | null;
};

/** Tags of every tagging model in `captions_json` (`{ places365: { categories, attributes }, <model>: { tags } }`). */
function tagsOf(captions: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const [key, value] of Object.entries(captions)) {
    if (!isRecord(value)) continue;
    for (const field of key === "places365" ? ["categories", "environment"] : ["tags"]) {
      const list = value[field];
      if (Array.isArray(list)) {
        for (const t of list) {
          if (typeof t === "string" && t) out.add(t);
        }
      } else if (typeof list === "string" && list) {
        out.add(list);
      }
    }
  }
  return [...out];
}

/** Caption, people, tags and rating of a server photo (`/api/photos/<id>/`). */
export async function fetchServerPhoto(photoId: string): Promise<ServerPhoto> {
  const res = await serverFetch(`/api/photos/${encodeURIComponent(photoId)}/`);
  if (!isRecord(res)) throw new Error("unexpected answer from the server");
  const captions = isRecord(res.captions_json) ? res.captions_json : {};
  const people = Array.isArray(res.people)
    ? res.people.flatMap(p => {
        const name = isRecord(p) ? str(p.name) : null;
        return name ? [name] : [];
      })
    : [];
  const rating = typeof res.rating === "number" ? res.rating : 0;
  return {
    caption: str(captions.user_caption) ?? str(captions.im2txt),
    people,
    tags: tagsOf(captions),
    // The web app's favourite threshold (`favorite_min_rating`, 4 by default).
    favourite: rating >= 4,
    rating,
    place: str(res.search_location),
    imageHash: str(res.image_hash),
  };
}
