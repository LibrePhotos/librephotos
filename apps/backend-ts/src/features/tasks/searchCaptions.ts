// `PhotoSearch.recreate_search_captions` (S19), batched: one read for any
// number of photos, one upsert (port of lp_tasks::search_captions).
//
// Django rebuilds from the rows as stored, and its callers rebuild before
// saving the caption they just changed, so a new tag or caption only shows up
// in search_captions on the next rebuild. Here (as in Rust) the caller writes
// its change first, in the same transaction, and the rebuild sees it.
import { arrayLiteral } from "../../lib/db";
import type { Exec } from "./things";

interface Source {
  id: string;
  video: boolean;
  is_screenshot: boolean;
  is_document: boolean;
  captions_json: unknown;
  main_path: string | null;
  person_names: string[] | null;
  file_paths: string[] | null;
  camera_make: string | null;
  camera_model: string | null;
  lens_make: string | null;
  lens_model: string | null;
  keywords: unknown;
}

export async function rebuildSearchCaptions(tx: Exec, photoIds: string[], taggingModel: string): Promise<void> {
  if (!photoIds.length) return;
  const rs: Source[] = await tx`SELECT p.id::text AS id, p.video, p.is_screenshot, p.is_document, pc.captions_json,
      mf.path AS main_path,
      (SELECT json_agg(pe.name ORDER BY f.id) FROM api_face f JOIN api_person pe ON pe.id = f.person_id WHERE f.photo_id = p.id) AS person_names,
      (SELECT json_agg(fl.path ORDER BY pf.id) FROM api_photo_files pf JOIN api_file fl ON fl.hash = pf.file_id WHERE pf.photo_id = p.id) AS file_paths,
      md.camera_make, md.camera_model, md.lens_make, md.lens_model, md.keywords
    FROM api_photo p
    LEFT JOIN api_photo_caption pc ON pc.photo_id = p.id
    LEFT JOIN api_file mf ON mf.hash = p.main_file_id
    LEFT JOIN api_photometadata md ON md.photo_id = p.id
    WHERE p.id = ANY(${arrayLiteral(photoIds)}::uuid[])`;
  if (!rs.length) return;
  const ids = rs.map((r) => r.id);
  const captions = rs.map((r) => compose(r, taggingModel));
  await tx`INSERT INTO api_photo_search (photo_id, search_captions, search_location, created_at, updated_at)
    SELECT u.id, u.captions, NULL, now(), now()
    FROM jsonb_to_recordset(${JSON.stringify(ids.map((id, i) => ({ id, captions: captions[i] })))}::text::jsonb) AS u(id uuid, captions text)
    ON CONFLICT (photo_id) DO UPDATE SET search_captions = EXCLUDED.search_captions, updated_at = now()`;
}

const truthyStr = (v: unknown) => (typeof v === "string" && v ? v : null);

function compose(row: Source, taggingModel: string): string {
  const parts: string[] = [];
  const cj = row.captions_json;
  if (cj && typeof cj === "object" && !Array.isArray(cj) && Object.keys(cj).length) {
    const c = cj as Record<string, any>;
    const m = c[taggingModel];
    const tags: string[] = m && Array.isArray(m.tags) ? m.tags.filter((t: unknown) => typeof t === "string") : [];
    if (tags.length) parts.push(tags.join(" "));
    const user = truthyStr(c.user_caption);
    if (user) parts.push(user);
    const im2txt = truthyStr(c.im2txt);
    if (im2txt) parts.push(im2txt);
  }
  for (const n of row.person_names ?? []) parts.push(n);
  if (row.main_path !== null) parts.push(row.main_path);
  for (const p of row.file_paths ?? []) parts.push(p);
  if (row.video) parts.push("type: video");
  if (row.is_screenshot) parts.push("type: screenshot");
  if (row.is_document) parts.push("type: document");
  const camera = display(row.camera_make, row.camera_model);
  if (camera) parts.push(camera);
  const lens = display(row.lens_make, row.lens_model);
  if (lens) parts.push(lens);
  if (Array.isArray(row.keywords) && row.keywords.length) parts.push(row.keywords.filter((k) => typeof k === "string").join(" "));
  // Each part is followed by a space, then the whole is stripped (Python str.strip()).
  return parts.map((p) => p + " ").join("").trim();
}

/** `PhotoMetadata.camera_display` / `lens_display`. */
function display(make: string | null, model: string | null): string | null {
  const mk = make || null;
  const md = model || null;
  if (mk && md) return md.startsWith(mk) ? md : `${mk} ${md}`;
  return md ?? mk;
}
