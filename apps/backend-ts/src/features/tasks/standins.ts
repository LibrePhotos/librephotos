// MINIMAL STAND-INS for endpoints owned by other areas, added on the tasks
// branch only so `run_suite.sh mut:sidecars` can exercise the sidecar paths:
//   GET /api/photos/searchlist/   (search_sharing_public: SearchListViewSet)
//   GET /api/photos/{hash|uuid}/  (timeline_photos: PhotoSerializer)
//   GET /api/jobs/                (jobs_zip_services: LongRunningJob list)
// When the owning area's full version lands, drop these and keep the calls
// into ./endpoints (semanticSearchHashes, similarPhotos).
import { sql } from "drizzle-orm";
import { pgArray, rows } from "../../lib/db";
import { ApiError } from "../../lib/errors";
import { JOB_LABELS } from "../../lib/jobs";
import { drfPage, pageRequest, validFor, offset } from "../../lib/pagination";
import { groupByDate, pigFromRow, pigRows } from "../../lib/pig";
import type { QueryMap } from "../../lib/query";
import { likeEscape, ownedBy, visibleManager, visibleTo } from "../../lib/scope";
import { drfTs } from "../../lib/time";
import type { User } from "../../lib/users";
import { isAdmin } from "../../lib/users";
import { semanticSearchHashes, similarPhotos } from "./endpoints";

// ------------------------------------------------------------- searchlist

/** Python's str.isspace set (Unicode whitespace plus \x1c..\x1f). */
const isPySpace = (c: string) => /\s/u.test(c) || (c >= "\x1c" && c <= "\x1f");
const isPlain = (c: string) => !isPySpace(c) && c !== '"' && c !== "'";

function quotedEnd(chars: string[], start: number): number | null {
  const q = chars[start];
  let k = start + 1;
  while (k < chars.length) {
    if (chars[k] === q) return k + 1;
    if (chars[k] === "\\") {
      if (k + 1 < chars.length && chars[k + 1] !== "\n") k += 2;
      else return null;
    } else k++;
  }
  return null;
}

/** django.utils.text.smart_split. */
function djangoSmartSplit(text: string): string[] {
  const chars = [...text];
  const n = chars.length;
  const out: string[] = [];
  let i = 0;
  while (i < n) {
    if (isPySpace(chars[i])) {
      i++;
      continue;
    }
    const start = i;
    let j = i;
    while (j < n && isPlain(chars[j])) j++;
    let end: number | null = null;
    while (j < n && (chars[j] === '"' || chars[j] === "'")) {
      let k = quotedEnd(chars, j);
      if (k === null) break;
      while (k < n && isPlain(chars[k])) k++;
      end = k;
      j = k;
    }
    if (end === null) {
      let k = start;
      while (k < n && !isPySpace(chars[k])) k++;
      end = k;
    }
    out.push(chars.slice(start, end).join(""));
    i = end;
  }
  return out;
}

/** DRF search_smart_split: the search terms of ?search=. */
export function smartSplit(search: string): string[] {
  const terms: string[] = [];
  for (const token of djangoSmartSplit(search)) {
    const term = token.replace(/^,+|,+$/g, "");
    const first = term[0];
    if ((first === '"' || first === "'") && term.length >= 1 && term[term.length - 1] === first) {
      const inner = term.length >= 2 ? [...term].slice(1, -1).join("") : "";
      terms.push(inner.replaceAll(`\\${first}`, first).replaceAll("\\\\", "\\"));
    } else {
      for (const sub of term.split(",")) {
        if (sub) {
          let s = [...sub];
          while (s.length && isPySpace(s[0])) s = s.slice(1);
          while (s.length && isPySpace(s[s.length - 1])) s = s.slice(0, -1);
          terms.push(s.join(""));
        }
      }
    }
  }
  return terms;
}

const pattern = (t: string) => `%${likeEscape(t)}%`;
const icontains = (col: string, t: string) => sql`UPPER(${sql.raw(col)}::text) LIKE UPPER(${pattern(t)})`;

/** One term over the PhotoSearch fields, the timestamp text, the OCR full-text match and semantic hits. */
function termWithoutTags(term: string, semantic: string[] | null, p: string, s: string) {
  const parts = [
    icontains(`${s}.search_captions`, term),
    icontains(`${s}.search_location`, term),
    sql`UPPER((${sql.raw(p)}.exif_timestamp AT TIME ZONE 'UTC')::text || '+00') LIKE UPPER(${pattern(term)})`,
    sql`${sql.raw(p)}.id IN (SELECT so.photo_id FROM api_photo_ocr so WHERE to_tsvector('simple'::regconfig, COALESCE(so.text, '')) @@ plainto_tsquery('simple'::regconfig, ${term}))`,
  ];
  if (semantic) parts.push(sql`${sql.raw(p)}.image_hash = ANY(${pgArray(semantic, "text")})`);
  return sql`(${sql.join(parts, sql` OR `)})`;
}

/** GET /api/photos/searchlist/ (SearchListViewSet.list + api/filters.py). */
export async function searchList(user: User, q: QueryMap) {
  const raw = q.get("search") ?? "";
  if (raw.includes("\0")) throw ApiError.validation("Null characters are not allowed.");
  const terms = smartSplit(raw);
  const topk = user.semanticSearchTopk;
  const semantic = topk > 0 && terms.length ? await semanticSearchHashes(user.id, raw, topk) : null;
  const where = [ownedBy("p", user.id), visibleManager("p")];
  if (q.flag("video")) where.push(sql`p.video`);
  else if (q.flag("photo")) where.push(sql`NOT p.video`);
  if (q.flag("is_screenshot")) where.push(sql`p.is_screenshot`);
  if (q.flag("is_document")) where.push(sql`p.is_document`);
  if (terms.length) {
    // Django filters all terms in ONE filter() call, so the tags join is shared.
    const noTags = sql.join(
      terms.map((t) => termWithoutTags(t, semantic, "p", "pig_s")),
      sql` AND `,
    );
    const withTags = sql.join(
      terms.map((t) => sql`(${termWithoutTags(t, semantic, "sp", "sps")} OR ${icontains("stg.name", t)})`),
      sql` AND `,
    );
    where.push(sql`((${noTags}) OR p.id IN (SELECT stp.photo_id FROM api_tag_photos stp JOIN api_tag stg ON stg.id = stp.tag_id
      JOIN api_photo sp ON sp.id = stp.photo_id LEFT JOIN api_photo_search sps ON sps.photo_id = sp.id WHERE ${withTags}))`);
  }
  const rs = await pigRows(sql`WHERE ${sql.join(where, sql` AND `)} ORDER BY p.exif_timestamp DESC, p.id`);
  return { results: topk === 0 ? groupByDate(rs) : rs.map(pigFromRow) };
}

// ----------------------------------------------------------- photo detail

const mediaUrl = (name: string) =>
  "/media/" + [...new TextEncoder().encode(name.replaceAll("\\", "/"))].map((b) => (/[A-Za-z0-9/~!*()'\-_.]/.test(String.fromCharCode(b)) && b < 128 ? String.fromCharCode(b) : "%" + b.toString(16).toUpperCase().padStart(2, "0"))).join("");

const display = (make: string | null, model: string | null) => (make && model ? (model.startsWith(make) ? model : `${make} ${model}`) : model || make || null);

/** GET /api/photos/{hash|uuid}/ (PhotoSerializer); stand-in: no file_variants/stacks/metadata/ocr. */
export async function photoDetail(viewer: User | null, id: string) {
  const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
  const lookup = isUuid ? sql`p.id = ${id}::uuid` : sql`p.image_hash = ${id}`;
  const vid = viewer?.id ?? null;
  const [r] = await rows<any>(sql`SELECT p.id::text AS id, p.exif_gps_lat, p.exif_gps_lon, ${drfTs("p.exif_timestamp")} AS exif_timestamp,
      p.geolocation_json, p.image_hash, p.rating, p.hidden, p.public, p.removed, p.in_trashcan, p.video, p.size, p.local_orientation,
      p.clip_embeddings, p.clip_embeddings_model, p.owner_id, u.username, u.first_name, u.last_name, cap.captions_json,
      COALESCE(s.search_captions, '') AS search_captions, COALESCE(s.search_location, '') AS search_location,
      t.thumbnail_big, t.square_thumbnail, t.square_thumbnail_small, (md.id IS NOT NULL) AS has_md, md.width, md.height,
      md.focal_length, md.aperture, md.iso, md.shutter_speed, md.camera_make, md.camera_model, md.lens_make, md.lens_model, md.focal_length_35mm,
      (SELECT json_agg(fi.path ORDER BY pf.id) FROM api_photo_files pf JOIN api_file fi ON fi.hash = pf.file_id WHERE pf.photo_id = p.id) AS image_path,
      (SELECT json_agg(st.user_id ORDER BY st.id) FROM api_photo_shared_to st WHERE st.photo_id = p.id) AS shared_to,
      (SELECT json_agg(json_build_object('id', f.id, 'image', f.image,
          'person', CASE WHEN f.person_id IS NOT NULL THEN COALESCE(fp.name, '') END,
          'cluster_person', CASE WHEN f.cluster_person_id IS NOT NULL THEN COALESCE(fc.name, '') END,
          'classification_person', CASE WHEN f.classification_person_id IS NOT NULL THEN COALESCE(fl.name, '') END,
          'cluster_probability', f.cluster_probability, 'classification_probability', f.classification_probability,
          'top', f.location_top, 'bottom', f.location_bottom, 'left', f.location_left, 'right', f.location_right) ORDER BY f.id)
        FROM api_face f LEFT JOIN api_person fp ON fp.id = f.person_id LEFT JOIN api_person fc ON fc.id = f.cluster_person_id
        LEFT JOIN api_person fl ON fl.id = f.classification_person_id WHERE f.photo_id = p.id AND NOT f.deleted) AS faces
    FROM api_photo p JOIN api_user u ON u.id = p.owner_id JOIN api_thumbnail t ON t.photo_id = p.id
    LEFT JOIN api_photo_caption cap ON cap.photo_id = p.id LEFT JOIN api_photo_search s ON s.photo_id = p.id
    LEFT JOIN api_photometadata md ON md.photo_id = p.id
    WHERE ${lookup} AND ${visibleManager("p")} AND ${visibleTo("p", vid)}
    ORDER BY p.exif_timestamp DESC, p.id LIMIT 1`);
  if (!r) throw ApiError.notFound();
  const cj = r.captions_json;
  const fileUrl = (n: string | null) => (n ? mediaUrl(n) : "");
  return {
    id: r.id,
    exif_gps_lat: r.exif_gps_lat,
    exif_gps_lon: r.exif_gps_lon,
    exif_timestamp: r.exif_timestamp,
    captions_json: cj && typeof cj === "object" && Object.keys(cj).length ? cj : { im2txt: "" },
    search_captions: r.search_captions,
    search_location: r.search_location,
    big_thumbnail_url: fileUrl(r.thumbnail_big),
    square_thumbnail_url: fileUrl(r.square_thumbnail),
    small_square_thumbnail_url: fileUrl(r.square_thumbnail_small),
    geolocation_json: r.geolocation_json,
    people: (r.faces ?? []).map((f: any) => {
      const [name, type, probability] =
        f.person !== null
          ? [f.person, "user", 1]
          : f.cluster_person !== null
            ? [f.cluster_person, "cluster", f.cluster_probability]
            : f.classification_person !== null
              ? [f.classification_person, "classification", f.classification_probability]
              : ["", "", 0];
      return {
        name,
        type,
        probability,
        location: { top: f.top, bottom: f.bottom, left: f.left, right: f.right },
        face_url: f.image ? mediaUrl(f.image) : "",
        face_id: f.id,
      };
    }),
    image_hash: r.image_hash,
    image_path: r.image_path ?? [],
    rating: r.rating,
    hidden: r.hidden,
    public: r.public,
    removed: r.removed,
    in_trashcan: r.in_trashcan,
    shared_to: r.shared_to ?? [],
    similar_photos: await similarPhotos(r.owner_id, vid, r.clip_embeddings, r.clip_embeddings_model),
    video: r.video,
    owner: { id: r.owner_id, username: r.username, first_name: r.first_name, last_name: r.last_name },
    size: Number(r.size),
    height: r.has_md ? r.height : 0,
    width: r.has_md ? r.width : 0,
    focal_length: r.focal_length,
    fstop: r.aperture,
    iso: r.iso,
    shutter_speed: r.shutter_speed,
    lens: display(r.lens_make, r.lens_model),
    camera: display(r.camera_make, r.camera_model),
    focalLength35Equivalent: r.focal_length_35mm,
    digitalZoomRatio: null,
    subjectDistance: null,
    embedded_media: [],
    file_variants: null,
    stacks: null,
    metadata: null,
    ocr: null,
    local_orientation: r.local_orientation,
  };
}

// --------------------------------------------------------------- jobs list

/** GET /api/jobs/: the requester's LongRunningJobs (all for an admin), newest first, DRF paged. */
export async function jobsList(user: User, request: Request, q: QueryMap) {
  const scope = isAdmin(user) ? sql`TRUE` : sql`j.started_by_id = ${user.id}`;
  const [{ n }] = await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM api_longrunningjob j WHERE ${scope}`);
  const pr = validFor(pageRequest(q, "page_size", 10, 1000), n);
  const rs = await rows<any>(sql`SELECT j.id, j.job_id, j.job_type, j.finished, j.failed, j.cancelled, j.progress_current, j.progress_target,
      j.progress_step, j.result, ${drfTs("j.queued_at")} AS queued_at, ${drfTs("j.started_at")} AS started_at,
      ${drfTs("j.finished_at")} AS finished_at, u.id AS uid, u.username, u.first_name, u.last_name
    FROM api_longrunningjob j LEFT JOIN api_user u ON u.id = j.started_by_id WHERE ${scope}
    ORDER BY j.queued_at DESC, j.id DESC LIMIT ${pr.pageSize} OFFSET ${offset(pr)}`);
  return drfPage(
    request,
    pr,
    n,
    rs.map((j) => ({
      id: j.id,
      job_id: j.job_id,
      job_type: j.job_type,
      job_type_str: JOB_LABELS[j.job_type] ?? "",
      finished: j.finished,
      failed: j.failed,
      cancelled: j.cancelled,
      progress_current: j.progress_current,
      progress_target: j.progress_target,
      progress_step: j.progress_step,
      result: j.result,
      queued_at: j.queued_at,
      started_at: j.started_at,
      finished_at: j.finished_at,
      started_by: j.uid === null ? null : { id: j.uid, username: j.username, first_name: j.first_name, last_name: j.last_name },
    })),
  );
}
