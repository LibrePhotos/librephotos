// Read queries of the people_faces area (port of lp_db::people_faces):
// PersonViewSet.get_queryset, FaceIncompleteListViewSet, FaceListView and the
// inputs of face_classify.cluster_faces. Every face query is scoped to the
// requester's own photos (photo__owner).
import { sql, type SQL } from "drizzle-orm";
import { client, row, rows } from "~/lib/db";
import { likeEscape, ownedBy } from "~/lib/scope";
import { drfTs } from "~/lib/time";

export interface PersonRow {
  id: number;
  name: string;
  face_count: number;
  cover_face_id: number | null;
  cover_face_image: string | null;
  cover_photo_hash: string | null;
  cover_photo_video: boolean | null;
  first_face_image: string | null;
  first_face_photo_hash: string | null;
  first_face_photo_video: boolean | null;
  /** COUNT(*) OVER () of the unpaginated list. */
  total: number;
}

// `ff`: the person's first face on the requester's photos. The LATERAL join
// runs as a per-person index probe (a correlated form becomes a hash join
// over every face, ~5x slower on the 50k library).
function personSelect(userId: number, userKindOnly: boolean): SQL {
  return sql`SELECT p.id, p.name, p.face_count, p.cover_face_id, cf.image AS cover_face_image,
      cp.image_hash AS cover_photo_hash, cp.video AS cover_photo_video,
      ff.image AS first_face_image, ff.image_hash AS first_face_photo_hash, ff.video AS first_face_photo_video,
      (COUNT(*) OVER ())::int AS total
    FROM api_person p
    LEFT JOIN api_face cf ON cf.id = p.cover_face_id
    LEFT JOIN api_photo cp ON cp.id = p.cover_photo_id
    LEFT JOIN LATERAL (SELECT f.image, ph.image_hash, ph.video FROM api_face f
      JOIN api_photo ph ON ph.id = f.photo_id WHERE f.person_id = p.id AND ${ownedBy("ph", userId)}
      ORDER BY f.id LIMIT 1) ff ON TRUE
    WHERE p.cluster_owner_id = ${userId}${userKindOnly ? sql` AND p.kind = 'USER'` : sql``}`;
}

/** DRF SearchFilter on name (icontains): every term must be contained. */
const searchSql = (terms: string[]): SQL =>
  sql.join(
    terms.map((t) => sql` AND UPPER(p.name::text) LIKE UPPER(${"%" + likeEscape(t) + "%"}) ESCAPE '\\'`),
    sql``,
  );

/** One page of the requester's user-labelled persons, ordered by name. */
export const listPersons = (userId: number, search: string[], limit: number, offset: number) =>
  rows<PersonRow>(sql`${personSelect(userId, true)}${searchSql(search)} ORDER BY p.name, p.id LIMIT ${limit} OFFSET ${offset}`);

export async function countPersons(userId: number, search: string[]): Promise<number> {
  const r = await row<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM api_person p WHERE p.kind = 'USER' AND p.cluster_owner_id = ${userId}${searchSql(search)}`,
  );
  return r!.n;
}

/** PersonViewSet.get_object(): a user-labelled person of the requester (the list's ?search= applies too). */
export const personForOwner = (userId: number, personId: bigint, search: string[]) =>
  row<PersonRow>(sql`${personSelect(userId, true)} AND p.id = ${personId.toString()}::bigint${searchSql(search)}`);

/** A person of the requester of any kind (PersonSerializer.create can hand back a cluster). */
export const ownedPersonAnyKind = (userId: number, personId: number) =>
  row<PersonRow>(sql`${personSelect(userId, false)} AND p.id = ${personId}`);

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
/** uuid.UUID(s)-ish parse (braces, urn: prefix and dashes optional); the canonical text or null. */
export function parseUuid(s: string): string | null {
  let t = s.trim();
  if (t.toLowerCase().startsWith("urn:uuid:")) t = t.slice(9);
  if (t.startsWith("{") && t.endsWith("}")) t = t.slice(1, -1);
  if (!UUID_RE.test(t)) return null;
  const h = t.replace(/-/g, "").toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The requester's photo by image hash first, then by primary key (cover photo). */
export async function ownedPhotoByHashOrId(userId: number, ref: string): Promise<string | undefined> {
  const asUuid = parseUuid(ref);
  const r = await row<{ id: string }>(sql`SELECT id FROM (
      SELECT 0 AS k, h.id FROM (SELECT id FROM api_photo p WHERE ${ownedBy("p", userId)} AND image_hash = ${ref} ORDER BY id LIMIT 1) h
      UNION ALL
      SELECT 1 AS k, id FROM api_photo p WHERE ${ownedBy("p", userId)} AND id = ${asUuid}::uuid
    ) x ORDER BY k LIMIT 1`);
  return r?.id;
}

export type AnalysisMethod = "clustering" | "classification";
/** null = labelled faces of user-labelled persons. */
export type Inferred = { method: AnalysisMethod; min: number } | null;

export interface IncompletePerson {
  id: number;
  name: string;
  kind: string;
  face_count: number;
}

/** FaceIncompleteListViewSet.get_queryset: persons with faces in the requested bucket, by name. */
export function incompletePersons(userId: number, inferred: Inferred) {
  const on =
    inferred === null
      ? sql`f.person_id = p.id AND NOT f.deleted`
      : inferred.method === "clustering"
        ? sql`f.cluster_person_id = p.id AND NOT f.deleted AND f.person_id IS NULL AND f.cluster_probability >= ${inferred.min}::float8`
        : sql`f.classification_person_id = p.id AND NOT f.deleted AND f.person_id IS NULL AND f.classification_probability >= ${inferred.min}::float8`;
  return rows<IncompletePerson>(sql`SELECT p.id, p.name, p.kind, COUNT(f.id)::int AS face_count FROM api_person p
    JOIN api_face f ON ${on}
    JOIN api_photo ph ON ph.id = f.photo_id AND ${ownedBy("ph", userId)}
    WHERE p.cluster_owner_id = ${userId}${inferred === null ? sql` AND p.kind = 'USER'` : sql``}
    GROUP BY p.id ORDER BY p.name, p.id`);
}

/** The "Unknown - Other" bucket size of the incomplete list. */
export async function unknownFaceCount(userId: number, inferred: Inferred): Promise<number> {
  const extra =
    inferred === null
      ? sql``
      : inferred.method === "clustering"
        ? sql` AND (f.cluster_person_id IS NULL OR f.cluster_probability <= ${inferred.min}::float8)`
        : sql` AND f.classification_probability <= ${inferred.min}::float8`;
  const r = await row<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM api_face f JOIN api_photo ph ON ph.id = f.photo_id
    WHERE NOT f.deleted AND f.person_id IS NULL AND ${ownedBy("ph", userId)}${extra}`);
  return r!.n;
}

/** FaceListView.get_queryset filter. person null = the unknown bucket. */
export type FaceFilter =
  | { kind: "labeled"; person: number | null }
  | { kind: "inferred"; method: AnalysisMethod; person: number | null; min: number };

function faceFilterSql(userId: number, f: FaceFilter): SQL {
  let cond: SQL;
  if (f.kind === "labeled") cond = f.person === null ? sql`f.person_id IS NULL` : sql`f.person_id = ${f.person}`;
  else {
    const [personCol, probCol] =
      f.method === "classification" ? ["f.classification_person_id", "f.classification_probability"] : ["f.cluster_person_id", "f.cluster_probability"];
    const pc = sql.raw(personCol);
    const pr = sql.raw(probCol);
    if (f.person !== null) cond = sql`f.person_id IS NULL AND ${pc} = ${f.person} AND ${pr} >= ${f.min}::float8`;
    else if (f.method === "classification") cond = sql`f.person_id IS NULL AND ${pr} <= ${f.min}::float8`;
    else cond = sql`f.person_id IS NULL AND (${pc} IS NULL OR ${pr} <= ${f.min}::float8)`;
  }
  return sql` WHERE ${ownedBy("ph", userId)} AND NOT f.deleted AND ${cond}`;
}

export interface FaceListRow {
  id: number;
  image: string | null;
  photo_id: string | null;
  image_hash: string | null;
  exif_timestamp: string | null;
  cluster_probability: number;
  classification_probability: number;
  total: number;
}

/** One page of FaceListView, with the unpaginated count in total. */
export function listFaces(userId: number, f: FaceFilter, byDate: boolean, limit: number, offset: number) {
  const order =
    f.kind === "labeled"
      ? "f.id DESC"
      : f.method === "clustering"
        ? "f.cluster_probability DESC, f.id"
        : "f.classification_probability DESC, f.id";
  return rows<FaceListRow>(sql`SELECT f.id, f.image, f.photo_id, ph.image_hash, ${drfTs("ph.exif_timestamp")} AS exif_timestamp,
      f.cluster_probability, f.classification_probability, (COUNT(*) OVER ())::int AS total
    FROM api_face f JOIN api_photo ph ON ph.id = f.photo_id${faceFilterSql(userId, f)}
    ORDER BY ${sql.raw((byDate ? "ph.exif_timestamp, " : "") + order)} LIMIT ${limit} OFFSET ${offset}`);
}

export async function countFaces(userId: number, f: FaceFilter): Promise<number> {
  const r = await row<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM api_face f JOIN api_photo ph ON ph.id = f.photo_id${faceFilterSql(userId, f)}`);
  return r!.n;
}

export interface VizFace {
  id: number;
  image: string | null;
  encoding: string;
  person_id: number | null;
}

// Both scatter-plot statements are Django's own text with the user id as a
// literal (psycopg interpolates client side): the rows come back unordered,
// and a prepared statement's generic plan joins the other way round and so
// returns them (and assigns the colors) in another order.
const uid = (userId: number) => String(Math.trunc(userId));

/** collect_visualizable_faces: the requester's non-deleted faces carrying an encoding. */
export async function vizFaces(userId: number): Promise<VizFace[]> {
  const r = (await client.unsafe(
    `SELECT api_face.id, api_face.image, api_face.encoding, api_face.person_id FROM api_face
     INNER JOIN api_photo ON (api_face.photo_id = api_photo.id)
     WHERE (api_photo.owner_id = ${uid(userId)} AND NOT api_face.deleted)`,
  )) as VizFace[];
  return r.filter((f) => f.encoding !== "");
}

/** build_person_color_map: persons with a face on the requester's photos, in Postgres' DISTINCT order. */
export async function vizPersons(userId: number): Promise<{ id: number; name: string }[]> {
  return (await client.unsafe(
    `SELECT DISTINCT api_person.id, api_person.name, api_person.kind, api_person.cover_photo_id,
       api_person.cover_face_id, api_person.face_count, api_person.cluster_owner_id,
       api_person.last_modified FROM api_person
     INNER JOIN api_face ON (api_person.id = api_face.person_id)
     INNER JOIN api_photo ON (api_face.photo_id = api_photo.id)
     WHERE api_photo.owner_id = ${uid(userId)}`,
  )) as { id: number; name: string }[];
}

/** Person.objects.filter(name=, cluster_owner=, kind__in=(CLUSTER, UNKNOWN)).exists() */
export async function isClusterLabel(userId: number, name: string): Promise<boolean> {
  const r = await row<{ e: boolean }>(
    sql`SELECT EXISTS (SELECT 1 FROM api_person WHERE name = ${name} AND cluster_owner_id = ${userId} AND kind IN ('CLUSTER', 'UNKNOWN')) AS e`,
  );
  return r!.e;
}

export interface AddFacePhoto {
  id: string;
  image_hash: string;
  thumbnail_big: string | null;
  boxes: number[][];
}

/** Photo.objects.owned_by(user).filter(**_get_photo_filter_kwargs(ref)).first(), with its face boxes. */
export function addFacePhoto(userId: number, ref: string) {
  const isUuid = ref.length === 36 && ref.split("-").length === 5;
  const asUuid = isUuid ? parseUuid(ref) : null;
  const match = asUuid !== null ? sql`p.id = ${asUuid}::uuid` : sql`p.image_hash = ${ref}`;
  return row<AddFacePhoto>(sql`SELECT p.id, p.image_hash, t.thumbnail_big,
      COALESCE((SELECT jsonb_agg(jsonb_build_array(f.location_top, f.location_right, f.location_bottom, f.location_left) ORDER BY f.id)
        FROM api_face f WHERE f.photo_id = p.id AND NOT f.deleted), '[]'::jsonb) AS boxes
    FROM api_photo p LEFT JOIN api_thumbnail t ON t.photo_id = p.id
    WHERE ${ownedBy("p", userId)} AND ${match} ORDER BY p.id LIMIT 1`);
}
