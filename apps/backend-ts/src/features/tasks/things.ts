// Album memberships the tasks maintain (port of lp_tasks::things):
// tagging-model AlbumThings (photo_count over non-hidden photos, covers
// topped up to 4), and the SigLIP labels document detection reads.
import { arrayLiteral, client } from "../../lib/db";

export type Exec = typeof client;

/**
 * `PhotoCaption._update_tag_album_things` for several photos of one owner:
 * each photo leaves every `thingType` album of its owner, then joins one per
 * title (created as needed), inserted in the given order. Every touched
 * album is locked, recounted and given covers once.
 */
export async function replaceThingMembershipsMany(
  tx: Exec,
  ownerId: number,
  thingType: string,
  photos: { id: string; titles: string[] }[],
): Promise<void> {
  if (!photos.length) return;
  const ids = photos.map((p) => p.id);
  const pairIds: string[] = [];
  const pairTitles: string[] = [];
  const pairOrder: number[] = [];
  const all = new Set<string>();
  photos.forEach((p, i) => {
    for (const t of [...new Set(p.titles)].sort()) {
      pairIds.push(p.id);
      pairTitles.push(t);
      pairOrder.push(i);
      all.add(t);
    }
  });
  const allTitles = [...all].sort();
  await tx`INSERT INTO api_albumthing (title, thing_type, favorited, owner_id, photo_count, last_modified)
    SELECT t, ${thingType}, FALSE, ${ownerId}, 0, now() FROM unnest(${arrayLiteral(allTitles)}::text[]) AS t
    ON CONFLICT (title, thing_type, owner_id) DO NOTHING`;
  // Lock every album this change touches, in id order, so concurrent writers
  // recount after each other instead of over stale snapshots.
  const touched: { id: number }[] = await tx`SELECT a.id FROM api_albumthing a
    WHERE a.owner_id = ${ownerId} AND a.thing_type = ${thingType}
      AND (a.title = ANY(${arrayLiteral(allTitles)}::text[]) OR EXISTS (SELECT 1 FROM api_albumthing_photos l
             WHERE l.albumthing_id = a.id AND l.photo_id = ANY(${arrayLiteral(ids)}::uuid[])))
    ORDER BY a.id FOR UPDATE`;
  if (!touched.length) return;
  await tx`DELETE FROM api_albumthing_photos l USING api_albumthing a
    WHERE l.albumthing_id = a.id AND l.photo_id = ANY(${arrayLiteral(ids)}::uuid[]) AND a.owner_id = ${ownerId} AND a.thing_type = ${thingType}`;
  if (pairIds.length) {
    await tx`INSERT INTO api_albumthing_photos (albumthing_id, photo_id)
      SELECT a.id, u.photo_id FROM unnest(${arrayLiteral(pairIds)}::uuid[], ${arrayLiteral(pairTitles)}::text[], ${arrayLiteral(pairOrder)}::int4[]) AS u(photo_id, title, ord)
      JOIN api_albumthing a ON a.owner_id = ${ownerId} AND a.thing_type = ${thingType} AND a.title = u.title
      ORDER BY u.ord, a.id
      ON CONFLICT DO NOTHING`;
  }
  await refreshThings(
    tx,
    touched.map((t) => t.id),
  );
}

/**
 * photo_count = non-hidden photos, last_modified bumped (Django saves the
 * album after each membership change), covers topped up to 4.
 */
export async function refreshThings(tx: Exec, albumIds: number[]): Promise<void> {
  const ids = arrayLiteral(albumIds);
  await tx`UPDATE api_albumthing a SET last_modified = now(), photo_count = (
      SELECT count(*) FROM api_albumthing_photos l JOIN api_photo p ON p.id = l.photo_id
      WHERE l.albumthing_id = a.id AND NOT p.hidden)
    WHERE a.id = ANY(${ids}::int[])`;
  await tx`INSERT INTO api_albumthing_cover_photos (albumthing_id, photo_id)
    SELECT s.albumthing_id, s.photo_id FROM (
      SELECT l.albumthing_id, l.photo_id,
             row_number() OVER (PARTITION BY l.albumthing_id ORDER BY l.id) AS rn,
             (SELECT count(*) FROM api_albumthing_cover_photos c WHERE c.albumthing_id = l.albumthing_id) AS have
      FROM api_albumthing_photos l JOIN api_photo p ON p.id = l.photo_id
      WHERE l.albumthing_id = ANY(${ids}::int[]) AND NOT p.hidden
        AND NOT EXISTS (SELECT 1 FROM api_albumthing_cover_photos c WHERE c.albumthing_id = l.albumthing_id AND c.photo_id = l.photo_id)
    ) s WHERE s.rn <= 4 - s.have
    ON CONFLICT DO NOTHING`;
}

/** Lower-cased `siglip2_tag` album titles per photo (document detection). */
export async function siglipLabels(tx: Exec, photoIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!photoIds.length) return out;
  const rs: { photo_id: string; title: string }[] = await tx`SELECT l.photo_id::text AS photo_id, a.title FROM api_albumthing_photos l
    JOIN api_albumthing a ON a.id = l.albumthing_id
    WHERE l.photo_id = ANY(${arrayLiteral(photoIds)}::uuid[]) AND a.thing_type = 'siglip2_tag' AND a.title <> ''`;
  for (const r of rs) {
    const list = out.get(r.photo_id) ?? [];
    list.push(r.title.toLowerCase());
    out.set(r.photo_id, list);
  }
  return out;
}
