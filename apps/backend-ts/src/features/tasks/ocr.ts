// `ocr.generate` (processing_jobs.generate_ocr / _run_ocr_for_photo) and
// `media.classify` (processing_jobs.classify_media); port of lp_tasks::ocr.
import { arrayLiteral, client } from "../../lib/db";
import { JobType } from "../../lib/jobs";
import { siteSettings } from "../../lib/settings";
import { classifyDocument, extensionLower, isScreenshot } from "./detect";
import { PHOTO_CONCURRENCY, forEachPhoto, loadPhoto, thumbnailPath, type TaskPhoto } from "./photos";
import { CANCEL_CHECK_EVERY, ItemCounter, complete, isCancelled, lastFinishedStart, setProgress, sinceParams, startItems } from "./run";
import * as sidecars from "./sidecars";
import { siglipLabels } from "./things";

/** OCR_MIN_CONFIDENCE: per-block confidence handed to the sidecar. */
export const OCR_MIN_CONFIDENCE = 0.6;
/** PhotoOcr.MAX_TEXT_LENGTH / MAX_BLOCKS (S18). */
const MAX_TEXT_LENGTH = 20_000;
const MAX_BLOCKS = 500;
/** Originals cv2 can decode; anything else (RAW, HEIC) is read from the big thumbnail. */
const CV2_DECODABLE = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"];

/** ml_models._is_model_not_selected. */
export function modelNotSelected(value: string): boolean {
  const v = value.trim();
  return !v || v.toLowerCase() === "none";
}

export async function generateOcr(userId: number, fullScan: boolean, jobId: string): Promise<void> {
  const model = (await siteSettings()).OCR_MODEL;
  if (modelNotSelected(model)) {
    await setProgress(jobId, 0, 0);
    await complete(jobId);
    return;
  }
  const [useSince, since] = sinceParams(await lastFinishedStart(userId, JobType.GenerateOcr, true));
  const ids: { id: string }[] = await client`SELECT p.id::text AS id FROM api_photo p LEFT JOIN api_photo_ocr o ON o.photo_id = p.id
    WHERE p.owner_id = ${userId} AND NOT p.video
      AND (${fullScan} OR (
        (o.photo_id IS NULL OR o.engine <> ${model})
        AND (${useSince}::boolean IS FALSE OR p.added_on > ${since}::timestamptz OR o.photo_id IS NOT NULL)))
    ORDER BY p.id`;
  if (!(await startItems(jobId, ids.length))) return;
  await forEachPhoto(
    jobId,
    ids.map((r) => r.id),
    PHOTO_CONCURRENCY,
    (id) => ocrPhoto(id),
  );
}

/** ocr_image_source: the original when cv2 reads it, else the big thumbnail. */
function imageSource(photo: TaskPhoto): string | null {
  if (photo.main_path && CV2_DECODABLE.includes(extensionLower(photo.main_path))) return photo.main_path;
  return thumbnailPath(photo);
}

function isFalsy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

export async function ocrPhoto(photoId: string): Promise<void> {
  const model = (await siteSettings()).OCR_MODEL;
  if (modelNotSelected(model)) return;
  const photo = await loadPhoto(photoId);
  if (!photo) return;
  const imagePath = imageSource(photo);
  if (!imagePath) {
    console.warn(`no OCR image source for ${photo.image_hash}`);
    return;
  }
  let data: sidecars.OcrResult;
  try {
    data = await sidecars.ocr(imagePath, OCR_MIN_CONFIDENCE);
  } catch (e) {
    if (e instanceof sidecars.SidecarError && e.kind === "status") {
      throw new Error(`Photo ${photo.image_hash}: OCR service returned status ${e.status} for ${imagePath}: ${e.detail}`);
    }
    throw new Error(`Photo ${photo.image_hash}: ${(e as Error).message}`);
  }
  const text = typeof data.text === "string" ? data.text : "";
  const storedText = [...text].slice(0, MAX_TEXT_LENGTH).join("");
  const blocks = Array.isArray(data.blocks) ? data.blocks.slice(0, MAX_BLOCKS) : isFalsy(data.blocks) ? [] : data.blocks;
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const int = (v: unknown) => (typeof v === "number" ? Math.trunc(v) : null);
  await client.begin(async (tx) => {
    await tx`INSERT INTO api_photo_ocr (photo_id, text, blocks, engine, mean_confidence, text_area_fraction, created_at, updated_at, source_width, source_height)
      VALUES (${photoId}, ${storedText}, ${JSON.stringify(blocks)}::text::jsonb, ${model}, ${num(data.mean_confidence)}, ${num(data.text_area_fraction)},
              now(), now(), ${int(data.image_width)}, ${int(data.image_height)})
      ON CONFLICT (photo_id) DO UPDATE SET text = EXCLUDED.text, blocks = EXCLUDED.blocks, engine = EXCLUDED.engine,
        mean_confidence = EXCLUDED.mean_confidence, text_area_fraction = EXCLUDED.text_area_fraction, updated_at = now(),
        source_width = EXCLUDED.source_width, source_height = EXCLUDED.source_height`;
    const labels = (await siglipLabels(tx as unknown as typeof client, [photoId])).get(photoId) ?? [];
    const isDocument = classifyDocument(text, num(data.text_area_fraction), labels);
    // _derive_is_document: never over a manual correction; Django saves with
    // update_fields, so last_modified stays as it is.
    await tx`UPDATE api_photo SET is_document = ${isDocument} WHERE id = ${photoId} AND category_source <> 'user' AND is_document <> ${isDocument}`;
  });
}

interface ClassifyRow {
  id: string;
  is_screenshot: boolean;
  is_document: boolean;
  exif_gps_lat: number | null;
  exif_gps_lon: number | null;
  main_path: string | null;
  has_metadata: boolean;
  camera_model: string | null;
  aperture: number | null;
  iso: number | null;
  focal_length: number | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  has_ocr: boolean;
  ocr_text: string | null;
  text_area_fraction: number | null;
}

/**
 * `classify_media`: re-derive is_screenshot for every photo not corrected
 * by hand, and is_document for those with OCR. Writes in batches of 200
 * without touching last_modified (Django's bulk_update).
 */
export async function classifyMedia(userId: number, jobId: string): Promise<void> {
  const BATCH = 200;
  const [{ n }] = await client`SELECT count(*)::int AS n FROM api_photo WHERE owner_id = ${userId} AND category_source <> 'user'`;
  if (!(await startItems(jobId, n))) return;
  const counter = new ItemCounter(jobId, n);
  const all: ClassifyRow[] = await client`SELECT p.id::text AS id, p.is_screenshot, p.is_document, p.exif_gps_lat, p.exif_gps_lon,
      f.path AS main_path, (m.id IS NOT NULL) AS has_metadata, m.camera_model, m.aperture, m.iso, m.focal_length,
      m.gps_latitude, m.gps_longitude, (o.photo_id IS NOT NULL) AS has_ocr, o.text AS ocr_text, o.text_area_fraction
    FROM api_photo p
    LEFT JOIN api_file f ON f.hash = p.main_file_id
    LEFT JOIN api_photometadata m ON m.photo_id = p.id
    LEFT JOIN api_photo_ocr o ON o.photo_id = p.id
    WHERE p.owner_id = ${userId} AND p.category_source <> 'user'`;
  for (let start = 0; start < all.length; start += BATCH) {
    const batch = all.slice(start, start + BATCH);
    // Polled every 100 rows like Django; batches are 200, so check both halves' starts.
    for (let i = start; i < start + batch.length; i += CANCEL_CHECK_EVERY) {
      if (await isCancelled(jobId)) {
        await counter.flush();
        return;
      }
    }
    await writeClassified(batch, counter);
  }
  await counter.finish();
}

async function writeClassified(batch: ClassifyRow[], counter: ItemCounter): Promise<void> {
  const withOcr = batch.filter((r) => r.has_ocr).map((r) => r.id);
  const labels = await siglipLabels(client, withOcr);
  const shots: { id: string; v: boolean }[] = [];
  const docs: { id: string; v: boolean }[] = [];
  for (const r of batch) {
    const shot = isScreenshot({
      main_path: r.main_path,
      has_metadata: r.has_metadata,
      camera_model: r.camera_model,
      aperture: r.aperture,
      iso: r.iso,
      focal_length: r.focal_length,
      photo_gps: r.exif_gps_lat !== null || r.exif_gps_lon !== null,
      metadata_gps: r.gps_latitude !== null || r.gps_longitude !== null,
    });
    if (shot !== r.is_screenshot) shots.push({ id: r.id, v: shot });
    if (r.has_ocr) {
      const doc = classifyDocument(r.ocr_text, r.text_area_fraction, labels.get(r.id) ?? []);
      if (doc !== r.is_document) docs.push({ id: r.id, v: doc });
    }
  }
  if (shots.length || docs.length) {
    await client.begin(async (tx) => {
      if (shots.length) {
        await tx`UPDATE api_photo p SET is_screenshot = u.v FROM unnest(${arrayLiteral(shots.map((s) => s.id))}::uuid[], ${arrayLiteral(shots.map((s) => s.v))}::bool[]) AS u(id, v) WHERE p.id = u.id`;
      }
      if (docs.length) {
        await tx`UPDATE api_photo p SET is_document = u.v FROM unnest(${arrayLiteral(docs.map((s) => s.id))}::uuid[], ${arrayLiteral(docs.map((s) => s.v))}::bool[]) AS u(id, v) WHERE p.id = u.id`;
      }
    });
  }
  for (let i = 0; i < batch.length; i++) await counter.done(null);
}
