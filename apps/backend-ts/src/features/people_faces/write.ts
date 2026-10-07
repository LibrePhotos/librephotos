// Write services of the people_faces area (port of lp_db::write::people_faces).
// Side effects: S3 (person deleted: faces detached, mobile-sync tombstone),
// S19 (face labelling: Person.face_count, default cover_photo/cover_face,
// PhotoSearch.search_captions). Faces are only soft-deleted by the API.
import { sql } from "drizzle-orm";
import { db, pgArray, row, rows, type Tx } from "~/lib/db";
import { ownedBy } from "~/lib/scope";
import { drfTs } from "~/lib/time";

type Conn = Tx;

/** get_or_create_person(name, owner, KIND_USER); returns the id. */
export async function getOrCreateUserPerson(tx: Conn, userId: number, name: string): Promise<number> {
  const existing = await row<{ id: number }>(
    sql`SELECT id FROM api_person WHERE name = ${name} AND cluster_owner_id = ${userId} AND kind = 'USER' ORDER BY id LIMIT 1`,
    tx,
  );
  if (existing) return existing.id;
  const r = await row<{ id: number }>(
    sql`INSERT INTO api_person (name, kind, cluster_owner_id, face_count, cover_face_id, cover_photo_id, last_modified)
        VALUES (${name}, 'USER', ${userId}, 0, NULL, NULL, now()) RETURNING id`,
    tx,
  );
  return r!.id;
}

/** PersonSerializer.update rename, plus S19 (Django leaves the captions on the old name). */
export async function renamePerson(personId: number, name: string, taggingModel: string) {
  await db.transaction(async (tx) => {
    const photos = await rows<{ photo_id: string }>(
      sql`WITH u AS (UPDATE api_person SET name = ${name}, last_modified = now() WHERE id = ${personId})
          SELECT DISTINCT photo_id FROM api_face WHERE person_id = ${personId} AND photo_id IS NOT NULL`,
      tx,
    );
    await rebuildSearchCaptions(
      tx,
      photos.map((p) => p.photo_id),
      taggingModel,
    );
  });
}

/** PersonSerializer.create: the requester's person already called name (any kind), else a new USER one. */
export async function createPerson(userId: number, name: string): Promise<number> {
  return db.transaction(async (tx) => {
    const existing = await row<{ id: number }>(
      sql`SELECT id FROM api_person WHERE name = ${name} AND cluster_owner_id = ${userId} ORDER BY id LIMIT 1`,
      tx,
    );
    return existing ? existing.id : getOrCreateUserPerson(tx, userId, name);
  });
}

/** Cover photo + that photo's first face of the person as cover face. */
export async function setPersonCover(personId: number, photoId: string) {
  await db.execute(sql`UPDATE api_person SET cover_photo_id = ${photoId}::uuid,
      cover_face_id = (SELECT id FROM api_face WHERE photo_id = ${photoId}::uuid AND person_id = ${personId} ORDER BY id LIMIT 1),
      last_modified = now()
    WHERE id = ${personId}`);
}

/**
 * DeletionLog tombstones of deleted USER persons (api/sync_signals.py). Run
 * before the delete. clock_timestamp(), not now(): Django stamps each row at
 * insert time, after any last_modified bump of the same request.
 */
async function personsDeletedTombstones(tx: Conn, ids: number[]) {
  if (!ids.length) return;
  await tx.execute(sql`INSERT INTO api_deletionlog (entity, entity_id, owner_id, deleted_at)
    SELECT 'person', v.eid, v.uid, clock_timestamp() FROM (
      SELECT p.id::text AS eid, p.cluster_owner_id AS uid FROM api_person p
      WHERE p.id = ANY(${pgArray(ids, "int")}) AND p.kind = 'USER' AND p.cluster_owner_id IS NOT NULL) v
    WHERE EXISTS (SELECT 1 FROM api_user u WHERE u.id = v.uid)
    ORDER BY v.eid, v.uid`);
}

/** Person.delete(): the collector's SET_NULLs, the reset_person signal (S3) and the sync tombstone. */
export async function deletePerson(personId: number) {
  await db.transaction(async (tx) => {
    await personsDeletedTombstones(tx, [personId]);
    await tx.execute(sql`UPDATE api_face SET
        person_id = CASE WHEN person_id = ${personId} THEN NULL ELSE person_id END,
        classification_person_id = CASE WHEN classification_person_id = ${personId} THEN NULL ELSE classification_person_id END,
        cluster_person_id = CASE WHEN cluster_person_id = ${personId} THEN NULL ELSE cluster_person_id END
      WHERE person_id = ${personId} OR classification_person_id = ${personId} OR cluster_person_id = ${personId}`);
    await tx.execute(sql`UPDATE api_cluster SET person_id = NULL WHERE person_id = ${personId}`);
    await tx.execute(sql`DELETE FROM api_person WHERE id = ${personId}`);
  });
}

/** Person._calculate_face_count() then _set_default_cover_photo() (S19). Deleted faces count, as in Django. */
export async function recomputePersons(tx: Conn, personIds: number[]) {
  if (!personIds.length) return;
  const ids = pgArray(personIds, "int");
  await tx.execute(sql`UPDATE api_person AS p SET face_count = (
        SELECT COUNT(*) FROM api_face f JOIN api_photo ph ON ph.id = f.photo_id
        WHERE f.person_id = p.id AND NOT ph.hidden AND NOT ph.in_trashcan AND ph.owner_id = p.cluster_owner_id),
      last_modified = now()
    WHERE p.id = ANY(${ids})`);
  await tx.execute(sql`UPDATE api_person AS p SET cover_photo_id = ff.photo_id, cover_face_id = ff.id, last_modified = now()
    FROM (SELECT DISTINCT ON (f.person_id) f.person_id, f.id, f.photo_id FROM api_face f
          WHERE f.person_id = ANY(${ids}) ORDER BY f.person_id, f.id) ff
    WHERE p.id = ff.person_id AND p.cover_photo_id IS NULL`);
}

interface CaptionSource {
  id: string;
  video: boolean;
  is_screenshot: boolean;
  is_document: boolean;
  captions_json: unknown;
  main_path: string | null;
  file_paths: string[] | null;
  person_names: string[] | null;
  has_metadata: boolean;
  camera_make: string | null;
  camera_model: string | null;
  lens_make: string | null;
  lens_model: string | null;
  keywords: unknown;
}

function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

/** PhotoMetadata.camera_display / lens_display. */
function makeModelDisplay(make: string | null, model: string | null): string | null {
  const mk = make || null;
  const md = model || null;
  if (mk && md) return md.startsWith(mk) ? md : `${mk} ${md}`;
  return md ?? mk;
}

const nonEmptyStr = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);

/** PhotoSearch.recreate_search_captions (faces by id, files by link id). */
function searchCaptions(src: CaptionSource, taggingModel: string): string {
  let out = "";
  const c = src.captions_json as Record<string, unknown> | null;
  if (c && typeof c === "object" && truthy(c)) {
    const model = c[taggingModel] as Record<string, unknown> | undefined;
    const tags = truthy(model) && model && typeof model === "object" ? model.tags : undefined;
    if (Array.isArray(tags) && tags.length) out += tags.filter((t): t is string => typeof t === "string").join(" ") + " ";
    for (const key of ["user_caption", "im2txt"]) {
      const s = nonEmptyStr(c[key]);
      if (s) out += s + " ";
    }
  }
  for (const n of src.person_names ?? []) out += n + " ";
  if (src.main_path !== null) out += src.main_path + " ";
  for (const p of src.file_paths ?? []) out += p + " ";
  if (src.video) out += "type: video ";
  if (src.is_screenshot) out += "type: screenshot ";
  if (src.is_document) out += "type: document ";
  if (src.has_metadata) {
    const cam = makeModelDisplay(src.camera_make, src.camera_model);
    if (cam) out += cam + " ";
    const lens = makeModelDisplay(src.lens_make, src.lens_model);
    if (lens) out += lens + " ";
    if (Array.isArray(src.keywords) && src.keywords.length)
      out += src.keywords.filter((k): k is string => typeof k === "string").join(" ") + " ";
  }
  return out.trim();
}

/** Rebuild api_photo_search.search_captions of these photos in one read and one upsert (S19). */
export async function rebuildSearchCaptions(tx: Conn, photoIds: string[], taggingModel: string) {
  if (!photoIds.length) return;
  const sources = await rows<CaptionSource>(
    sql`SELECT ph.id, ph.video, ph.is_screenshot, ph.is_document, c.captions_json,
        mf.path AS main_path,
        (SELECT json_agg(fl.path ORDER BY pf.id) FROM api_photo_files pf
           JOIN api_file fl ON fl.hash = pf.file_id WHERE pf.photo_id = ph.id) AS file_paths,
        (SELECT json_agg(pe.name ORDER BY f.id) FROM api_face f
           JOIN api_person pe ON pe.id = f.person_id WHERE f.photo_id = ph.id) AS person_names,
        (m.photo_id IS NOT NULL) AS has_metadata, m.camera_make, m.camera_model, m.lens_make, m.lens_model, m.keywords
      FROM api_photo ph
      LEFT JOIN api_photo_caption c ON c.photo_id = ph.id
      LEFT JOIN api_file mf ON mf.hash = ph.main_file_id
      LEFT JOIN api_photometadata m ON m.photo_id = ph.id
      WHERE ph.id = ANY(${pgArray(photoIds, "uuid")})`,
    tx,
  );
  if (!sources.length) return;
  const payload = sources.map((s) => ({ id: s.id, c: searchCaptions(s, taggingModel) }));
  await tx.execute(sql`INSERT INTO api_photo_search (photo_id, search_captions, search_location, created_at, updated_at)
    SELECT (x->>'id')::uuid, x->>'c', NULL, now(), now()
    FROM jsonb_array_elements(${JSON.stringify(payload)}::text::jsonb) x
    ON CONFLICT (photo_id) DO UPDATE SET search_captions = EXCLUDED.search_captions, updated_at = now()`);
}

export interface LabeledFace {
  id: number;
  image: string | null;
  photo_id: string | null;
  exif_timestamp: string | null;
  cluster_probability: number;
  old_person_id: number | null;
}

/**
 * SetFacePersonLabel.post: move the requester's faces among faceIds to the
 * person called personName (created if needed), or back to unknown (null,
 * which also clears the inferred labels). Returns the person and the
 * relabelled faces, ordered by id.
 */
export async function labelFaces(
  userId: number,
  faceIds: number[],
  personName: string | null,
  taggingModel: string,
): Promise<{ person: { id: number; name: string } | null; faces: LabeledFace[] }> {
  return db.transaction(async (tx) => {
    const person = personName === null ? null : { id: await getOrCreateUserPerson(tx, userId, personName), name: personName };
    const faces = faceIds.length
      ? await rows<LabeledFace>(
          sql`SELECT f.id, f.image, f.photo_id, ${drfTs("ph.exif_timestamp")} AS exif_timestamp, f.cluster_probability,
              f.person_id AS old_person_id
            FROM api_face f JOIN api_photo ph ON ph.id = f.photo_id
            WHERE f.id = ANY(${pgArray(faceIds, "int")}) AND ${ownedBy("ph", userId)} ORDER BY f.id FOR UPDATE OF f`,
          tx,
        )
      : [];
    const ids = faces.map((f) => f.id);
    if (ids.length) {
      const set =
        person !== null
          ? sql`person_id = ${person.id}`
          : sql`person_id = NULL, cluster_person_id = NULL, classification_person_id = NULL`;
      await tx.execute(sql`UPDATE api_face SET ${set} WHERE id = ANY(${pgArray(ids, "int")})`);
    }
    const affected = new Set<number>();
    for (const f of faces) if (f.old_person_id !== null) affected.add(f.old_person_id);
    if (person) affected.add(person.id);
    await recomputePersons(
      tx,
      [...affected].sort((a, b) => a - b),
    );
    const photos = [...new Set(faces.map((f) => f.photo_id).filter((p): p is string => p !== null))].sort();
    await rebuildSearchCaptions(tx, photos, taggingModel);
    return { person, faces };
  });
}

/** DeleteFaces.post: soft-delete the requester's faces among faceIds; (id, image) of each by id. */
export async function deleteFaces(userId: number, faceIds: number[]): Promise<{ id: number; image: string | null }[]> {
  if (!faceIds.length) return [];
  const r = await rows<{ id: number; image: string | null }>(sql`UPDATE api_face SET deleted = TRUE
    WHERE id = ANY(${pgArray(faceIds, "int")}) AND photo_id IN (SELECT ph.id FROM api_photo ph WHERE ${ownedBy("ph", userId)})
    RETURNING id, image`);
  return r.sort((a, b) => a.id - b.id);
}

export interface NewManualFace {
  photoId: string;
  /** Stored name, e.g. faces/<hash>_manual_<hex8>.jpg. */
  image: string;
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** FaceEncoding hex, or "" when the face service gave none. */
  encoding: string;
}

/** AddFaceView.post after validation: person get-or-create, the face row, then S19. */
export async function addManualFace(userId: number, personName: string, face: NewManualFace, taggingModel: string) {
  return db.transaction(async (tx) => {
    const personId = await getOrCreateUserPerson(tx, userId, personName);
    const r = await row<{ id: number }>(
      sql`INSERT INTO api_face (image, cluster_probability, location_top, location_bottom, location_left, location_right,
          encoding, person_id, cluster_id, classification_probability, deleted, classification_person_id, cluster_person_id, photo_id)
        VALUES (${face.image}, 0.0, ${face.top}, ${face.bottom}, ${face.left}, ${face.right}, ${face.encoding}, ${personId},
          NULL, 0.0, FALSE, NULL, NULL, ${face.photoId}::uuid) RETURNING id`,
      tx,
    );
    await recomputePersons(tx, [personId]);
    await rebuildSearchCaptions(tx, [face.photoId], taggingModel);
    return { faceId: r!.id, personId };
  });
}
