// /photosedit/savecaption/ and /photosedit/generateim2txt/ (port of
// lp_api::photo_edits::caption and lp_db::write::photo_edits::caption):
// PhotoCaption storage, the PhotoSearch.search_captions rebuild and the
// #hashtag AlbumThings. Both views only have IsOwnerOrReadOnly, so an
// anonymous caller gets the owner-scope 404 rather than a 401.
import { existsSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { config } from "~/lib/config";
import { db, jsonbParam, row, rows, type Tx } from "~/lib/db";
import { ApiError } from "~/lib/errors";
import { json } from "~/lib/http";
import { enqueue, JobType } from "~/lib/jobs";
import { pyTruthy } from "~/lib/query";
import { siteSettings } from "~/lib/settings";
import { captionInProcess } from "~/ml/caption/select";
import type { User } from "~/lib/users";
import { object, pyStr, required, statusMessage } from "./common";
import { ownedByHash } from "./reads";

const CAPTION_FAILED = "Failed to generate caption. Check service logs for details.";

export async function ensureCaptionRow(tx: Tx | typeof db, photoId: string) {
  await tx.execute(sql`INSERT INTO api_photo_caption (photo_id, captions_json, created_at, updated_at)
    VALUES (${photoId}, NULL, now(), now()) ON CONFLICT (photo_id) DO NOTHING`);
}

/** The caption as apply_user_caption stores it. */
export const cleanCaption = (c: string) => c.replaceAll("<start>", "").replaceAll("<end>", "").trim();

class NotAnObject extends Error {}

async function setCaptionKey(tx: Tx, photoId: string, key: string, caption: string, taggingModel: string) {
  await ensureCaptionRow(tx, photoId);
  const cur = await row<{ c: unknown }>(sql`SELECT captions_json AS c FROM api_photo_caption WHERE photo_id = ${photoId} FOR UPDATE`, tx);
  let captions: Record<string, unknown>;
  const c = typeof cur?.c === "string" ? safeJson(cur.c) : cur?.c;
  if (c === null || c === undefined) captions = {};
  else if (typeof c === "object" && !Array.isArray(c)) captions = c as Record<string, unknown>;
  else throw new NotAnObject("captions_json is not an object");
  captions[key] = caption;
  await tx.execute(sql`UPDATE api_photo_caption SET captions_json = ${jsonbParam(captions)}, updated_at = now() WHERE photo_id = ${photoId}`);
  await rebuildSearchCaptions(tx, photoId, taggingModel);
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** PhotoMetadata.camera_display / lens_display */
function display(make: string | null, model: string | null): string | null {
  const mk = make || null;
  const md = model || null;
  if (mk && md) return md.startsWith(mk) ? md : `${mk} ${md}`;
  return md ?? mk;
}

/** PhotoSearch.recreate_search_captions for one photo, then save (S19). */
export async function rebuildSearchCaptions(tx: Tx, photoId: string, taggingModel: string) {
  const src = await row<{
    video: boolean;
    is_screenshot: boolean;
    is_document: boolean;
    captions_json: unknown;
    face_names: string[];
    main_path: string | null;
    file_paths: string[];
    camera_make: string | null;
    camera_model: string | null;
    lens_make: string | null;
    lens_model: string | null;
    keywords: unknown;
    has_metadata: boolean;
  }>(
    sql`SELECT p.video, p.is_screenshot, p.is_document, c.captions_json,
        to_jsonb(ARRAY(SELECT pe.name FROM api_face f JOIN api_person pe ON pe.id = f.person_id WHERE f.photo_id = p.id ORDER BY f.id)) AS face_names,
        mf.path AS main_path,
        to_jsonb(ARRAY(SELECT fl.path FROM api_photo_files pf JOIN api_file fl ON fl.hash = pf.file_id WHERE pf.photo_id = p.id ORDER BY pf.id)) AS file_paths,
        md.camera_make, md.camera_model, md.lens_make, md.lens_model, md.keywords, (md.photo_id IS NOT NULL) AS has_metadata
      FROM api_photo p
      LEFT JOIN api_photo_caption c ON c.photo_id = p.id
      LEFT JOIN api_file mf ON mf.hash = p.main_file_id
      LEFT JOIN api_photometadata md ON md.photo_id = p.id
      WHERE p.id = ${photoId}`,
    tx,
  );
  if (!src) return;
  const parts: string[] = [];
  const captions = typeof src.captions_json === "string" ? safeJson(src.captions_json) : src.captions_json;
  if (captions && typeof captions === "object" && !Array.isArray(captions) && Object.keys(captions).length) {
    const cj = captions as Record<string, unknown>;
    const model = cj[taggingModel];
    const tags = model && typeof model === "object" && !Array.isArray(model) ? (model as Record<string, unknown>).tags : undefined;
    if (Array.isArray(tags) && tags.length) parts.push(tags.map(pyStr).join(" "));
    for (const k of ["user_caption", "im2txt"]) if (pyTruthy(cj[k])) parts.push(pyStr(cj[k]));
  }
  const list = (v: unknown) => (Array.isArray(v) ? (v as string[]) : typeof v === "string" ? (safeJson(v) as string[]) : []);
  for (const n of list(src.face_names)) parts.push(n);
  if (src.main_path !== null) parts.push(src.main_path);
  for (const p of list(src.file_paths)) parts.push(p);
  if (src.video) parts.push("type: video");
  if (src.is_screenshot) parts.push("type: screenshot");
  if (src.is_document) parts.push("type: document");
  if (src.has_metadata) {
    const cam = display(src.camera_make, src.camera_model);
    if (cam !== null) parts.push(cam);
    const lens = display(src.lens_make, src.lens_model);
    if (lens !== null) parts.push(lens);
    const kw = typeof src.keywords === "string" ? safeJson(src.keywords) : src.keywords;
    if (Array.isArray(kw) && kw.length) parts.push(kw.map(pyStr).join(" "));
  }
  // Every piece is followed by one space, then the whole is stripped (Python's str.strip()).
  const searchCaptions = parts.map((p) => p + " ").join("").replace(/^\s+|\s+$/g, "");
  await tx.execute(sql`INSERT INTO api_photo_search (photo_id, search_captions, search_location, created_at, updated_at)
    VALUES (${photoId}, ${searchCaptions}, NULL, now(), now())
    ON CONFLICT (photo_id) DO UPDATE SET search_captions = EXCLUDED.search_captions, updated_at = now()`);
}

/** Words of `caption` that are hashtags (# plus at least one character). */
const hashtags = (caption: string) =>
  caption
    .split(/\s+/)
    .filter((w) => w.startsWith("#") && [...w].length > 1);

/** The AlbumThing.photos m2m receiver: recount, top the covers up to 4, bump last_modified. */
async function albumThingChanged(tx: Tx, albumId: number) {
  await tx.execute(sql`UPDATE api_albumthing AS a SET photo_count = (
      SELECT COUNT(*) FROM api_albumthing_photos ap JOIN api_photo p ON p.id = ap.photo_id
      WHERE ap.albumthing_id = a.id AND NOT p.hidden), last_modified = now() WHERE a.id = ${albumId}`);
  await tx.execute(sql`INSERT INTO api_albumthing_cover_photos (albumthing_id, photo_id)
    SELECT ${albumId}, x.photo_id FROM (
      SELECT ap.photo_id, MIN(ap.id) AS ord FROM api_albumthing_photos ap
      JOIN api_photo p ON p.id = ap.photo_id
      WHERE ap.albumthing_id = ${albumId} AND NOT p.hidden AND ap.photo_id NOT IN (
        SELECT c.photo_id FROM api_albumthing_cover_photos c WHERE c.albumthing_id = ${albumId} AND c.photo_id IS NOT NULL)
      GROUP BY ap.photo_id ORDER BY ord
      LIMIT (SELECT CASE WHEN COUNT(*) < 4 THEN 4 - COUNT(*) ELSE 0 END
             FROM api_albumthing_cover_photos c WHERE c.albumthing_id = ${albumId})) x`);
}

/** _sync_hashtag_album_things */
async function syncHashtagAlbumThings(tx: Tx, photoId: string, caption: string) {
  const p = await row<{ owner_id: number; image_hash: string }>(sql`SELECT owner_id, image_hash FROM api_photo WHERE id = ${photoId}`, tx);
  if (!p) return;
  for (const tag of hashtags(caption)) {
    let albumId = (
      await row<{ id: number }>(
        sql`SELECT id FROM api_albumthing WHERE title = ${tag} AND owner_id = ${p.owner_id}
          AND thing_type = 'hashtag_attribute' ORDER BY id LIMIT 1`,
        tx,
      )
    )?.id;
    if (albumId === undefined) {
      albumId = (await row<{ id: number }>(
        sql`INSERT INTO api_albumthing (title, thing_type, favorited, owner_id, photo_count, last_modified)
          VALUES (${tag}, 'hashtag_attribute', FALSE, ${p.owner_id}, 0, now()) RETURNING id`,
        tx,
      ))!.id;
    }
    const has = await row<{ h: boolean }>(
      sql`SELECT EXISTS (SELECT 1 FROM api_albumthing_photos ap JOIN api_photo p ON p.id = ap.photo_id
        WHERE ap.albumthing_id = ${albumId} AND p.image_hash = ${p.image_hash}) AS h`,
      tx,
    );
    if (!has?.h) {
      await tx.execute(sql`INSERT INTO api_albumthing_photos (albumthing_id, photo_id) VALUES (${albumId}, ${photoId})`);
      await albumThingChanged(tx, albumId);
    }
  }
  const linked = await rows<{ id: number; title: string }>(
    sql`SELECT DISTINCT a.id, a.title FROM api_albumthing a JOIN api_albumthing_photos ap ON ap.albumthing_id = a.id
      WHERE ap.photo_id = ${photoId} AND a.thing_type = 'hashtag_attribute' AND a.owner_id = ${p.owner_id} ORDER BY a.id`,
    tx,
  );
  for (const a of linked) {
    if (!caption.includes(a.title)) {
      await tx.execute(sql`DELETE FROM api_albumthing_photos WHERE albumthing_id = ${a.id} AND photo_id = ${photoId}`);
      await albumThingChanged(tx, a.id);
    }
  }
}

export async function saveCaption(user: User | null, raw: unknown) {
  const body = object(raw);
  const imageHash = pyStr(required(body, "image_hash"));
  const caption = required(body, "caption");
  const photo = user ? await ownedByHash(user.id, imageHash) : undefined;
  if (!photo) return statusMessage(404, "photo not found");
  await ensureCaptionRow(db, photo.id);
  if (!photo.has_thumbnail_row) throw ApiError.internal("photo has no thumbnail");
  if (!photo.thumbnail_big || typeof caption !== "string") return { status: false };
  const tagging = (await siteSettings()).TAGGING_MODEL;
  try {
    await db.transaction(async (tx) => {
      const cleaned = cleanCaption(caption);
      await setCaptionKey(tx, photo.id, "user_caption", cleaned, tagging);
      await syncHashtagAlbumThings(tx, photo.id, cleaned);
    });
    return { status: true };
  } catch (e) {
    console.warn(`could not save captions for ${imageHash}: ${e instanceof Error ? e.message : e}`);
    return { status: false };
  }
}

/** The files of every captioning model (lp_ml::models CATALOG, ml_type Captioning). */
const CAPTION_FILES = [
  "lfm2_vl_450m/vision_encoder_q4.onnx",
  "lfm2_vl_450m/vision_encoder_q4.onnx_data",
  "lfm2_vl_450m/embed_tokens_q4.onnx",
  "lfm2_vl_450m/embed_tokens_q4.onnx_data",
  "lfm2_vl_450m/decoder_model_merged_q4.onnx",
  "lfm2_vl_450m/decoder_model_merged_q4.onnx_data",
  "lfm2_vl_450m/tokenizer.json",
];

const captioningPresent = () => CAPTION_FILES.every((f) => existsSync(path.join(config.mediaRoot, "data_models", f)));

const autoDownload = () => {
  const v = process.env.LP_ML_AUTO_DOWNLOAD;
  return v === undefined || v === "" || ["1", "true", "yes", "on"].includes(v.toLowerCase());
};

/** start_model_download: queue a Download Models job unless one is underway. */
async function startModelDownload(userId: number) {
  if (!autoDownload()) return;
  try {
    const running = await row<{ r: boolean }>(
      sql`SELECT EXISTS (SELECT 1 FROM api_longrunningjob WHERE job_type = ${JobType.DownloadModels} AND NOT finished) AS r`,
    );
    if (running?.r) return;
    await enqueue("models.download", { user_id: userId }, { lrj: { jobType: JobType.DownloadModels, userId } });
  } catch (e) {
    console.error("failed to queue the model download", e);
  }
}

/** _caption_prompt(_caption_context(llm_settings)) */
function captionPrompt(llm: Record<string, unknown> | null, person: string | null, location: string | null): string {
  const flag = (k: string) => pyTruthy(llm?.[k]);
  if (!flag("enabled")) return "Describe this image in a short, natural image caption.";
  const name = flag("add_person") ? person : null;
  const place = flag("add_location") && location ? location : null;
  let prompt = "Write a short, natural image caption.";
  if (name !== null)
    prompt += ` The person in the photo is named ${name}. Use the name '${name}' directly in the caption — do not say 'a person named'. Keep the caption casual and to the point, like a friend tagging a photo.`;
  if (place !== null) prompt += ` This photo was taken at ${place}.`;
  if (flag("add_keywords")) prompt += " Include relevant tags and keywords.";
  return prompt;
}

/** api.image_captioning.generate_caption: in-process (src/ml/caption) or over the captioning sidecar. */
async function callCaptioner(imagePath: string, prompt: string): Promise<string> {
  if (captionInProcess()) return (await import("../../ml/caption/inprocess")).generateCaption(imagePath, prompt);
  const res = await fetch(`${config.sidecar("caption", 8007)}/generate-caption`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_path: imagePath, prompt }),
    signal: AbortSignal.timeout(300_000),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = {};
  }
  const caption = body && typeof body === "object" ? (body as Record<string, unknown>).caption : undefined;
  if (!res.ok || caption === undefined) throw new Error(`captioning sidecar returned HTTP ${res.status}: ${text.slice(0, 500)}`);
  return pyStr(caption);
}

export async function generateIm2txt(user: User | null, raw: unknown) {
  if (!config.features.imageCaptioning) return statusMessage(403, "Image captioning is disabled");
  const body = object(raw);
  const imageHash = pyStr(required(body, "image_hash"));
  const photo = user ? await ownedByHash(user.id, imageHash) : undefined;
  if (!photo || !user) return statusMessage(404, "photo not found");
  if (!captioningPresent()) {
    // A fresh install (or a model switch) can be asked for a caption before
    // the download ran: start it, the frontend shows a notice.
    await startModelDownload(user.id);
    return json({
      status: false,
      reason: "model_downloading",
      message: "The captioning model is being downloaded. Try again in a few minutes.",
    });
  }
  await ensureCaptionRow(db, photo.id);
  if (!photo.has_thumbnail_row) throw ApiError.internal("photo has no thumbnail");
  const settings = await siteSettings();
  if (!photo.thumbnail_big || settings.CAPTIONING_MODEL.toLowerCase() === "none") return statusMessage(500, CAPTION_FAILED);
  const imagePath = path.join(config.mediaRoot, photo.thumbnail_big);
  const ctx = await row<{ person_name: string | null; search_location: string | null }>(
    sql`SELECT (SELECT pe.name FROM api_face f JOIN api_person pe ON pe.id = f.person_id
               WHERE f.photo_id = ${photo.id} ORDER BY f.id LIMIT 1) AS person_name,
             (SELECT s.search_location FROM api_photo_search s WHERE s.photo_id = ${photo.id}) AS search_location`,
  );
  const llmRaw = typeof user.llmSettings === "string" ? safeJson(user.llmSettings) : user.llmSettings;
  const llm = llmRaw && typeof llmRaw === "object" ? (llmRaw as Record<string, unknown>) : null;
  const prompt = captionPrompt(llm, ctx?.person_name ?? null, ctx?.search_location ?? null);
  let caption: string;
  try {
    caption = cleanCaption(await callCaptioner(imagePath, prompt));
  } catch (e) {
    console.warn(`could not generate caption for ${imagePath}: ${e}`);
    return statusMessage(500, CAPTION_FAILED);
  }
  try {
    await db.transaction((tx) => setCaptionKey(tx, photo.id, "im2txt", caption, settings.TAGGING_MODEL));
  } catch (e) {
    console.warn(`could not store caption for ${imagePath}: ${e}`);
    return statusMessage(500, CAPTION_FAILED);
  }
  return { status: true };
}
