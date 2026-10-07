// The HTTP surface the tasks own or that calls the sidecars synchronously:
// /api/scanfaces and /api/trainfaces (people_faces/jobs.rs), POST
// /api/photosedit/generateim2txt (photo_edits/caption.rs), and the two
// synchronous sidecar reads other areas embed: the semantic-search hashes of
// /api/photos/searchlist/ and the similar photos of the photo detail.
import { client, pgArray, rows, sql } from "../../lib/db";
import { ownedBy, visibleTo } from "../../lib/scope";
import { config } from "../../lib/config";
import { ApiError } from "../../lib/errors";
import { json } from "../../lib/http";
import { JobType, enqueue } from "../../lib/jobs";
import type { User } from "../../lib/users";
import { siteSettings } from "../../lib/settings";
import { captionContext, captionPrompt, cleanCaption, ensureCaptionRow, storeGeneratedCaption } from "./captions";
import { clipModelDir, storedEmbedding } from "./clip";
import { captioningPresent, queueIfMissing, startDownload } from "./models";
import { mediaPath } from "./photos";
import * as sidecars from "./sidecars";

const statusMessage = (status: number, message: string) => json({ status: false, message }, status);

/** POST /api/trainfaces: queue faces.cluster (embeddings, clustering, then faces.train); the job id is the clustering job's. */
export async function trainFacesEndpoint(user: User): Promise<Response | object> {
  if (!config.features.faceCluster) return statusMessage(403, "Face clustering is disabled");
  await queueIfMissing(user.id);
  try {
    const q = await enqueue("faces.cluster", { user_id: user.id }, { lrj: { jobType: JobType.ClusterAllFaces, userId: user.id } });
    return { status: true, job_id: q.lrjId };
  } catch (e) {
    console.error("failed to queue face training", e);
    return { status: false };
  }
}

/** GET|POST /api/scanfaces: queue a full faces.scan. */
export async function scanFacesEndpoint(user: User): Promise<Response | object> {
  if (!config.features.faceDetection) return statusMessage(403, "Face detection is disabled");
  await queueIfMissing(user.id);
  try {
    const q = await enqueue("faces.scan", { user_id: user.id, full_scan: true }, { lrj: { jobType: JobType.ScanFaces, userId: user.id } });
    return { status: true, job_id: q.lrjId };
  } catch (e) {
    console.error("could not start the face scan", e);
    return statusMessage(500, "Could not start the face scan.");
  }
}

const CAPTION_FAILED = "Failed to generate caption. Check service logs for details.";

/** Python str(value) of a JSON request value. */
const pyStr = (v: unknown) => (typeof v === "string" ? v : v === true ? "True" : v === false ? "False" : v === null ? "None" : JSON.stringify(v));

/**
 * POST /api/photosedit/generateim2txt/: caption one of the requester's
 * photos synchronously. Only IsOwnerOrReadOnly, so anonymous gets the
 * owner-scope 404 rather than a 401.
 */
export async function generateIm2txtEndpoint(user: User | null, body: unknown): Promise<Response | object> {
  if (!config.features.imageCaptioning) return statusMessage(403, "Image captioning is disabled");
  if (!body || typeof body !== "object" || Array.isArray(body)) throw ApiError.validation("Invalid data. Expected a dictionary, but got " + (Array.isArray(body) ? "list" : typeof body) + ".");
  const b = body as Record<string, unknown>;
  if (!("image_hash" in b)) throw ApiError.badRequest("image_hash", "This field is required.");
  const imageHash = pyStr(b.image_hash);
  const [photo] = user
    ? await client`SELECT p.id::text AS id, (t.photo_id IS NOT NULL) AS has_thumbnail_row, t.thumbnail_big
        FROM api_photo p LEFT JOIN api_thumbnail t ON t.photo_id = p.id
        WHERE p.owner_id = ${user.id} AND p.image_hash = ${imageHash} ORDER BY p.id LIMIT 1`
    : [];
  if (!photo || !user) return statusMessage(404, "photo not found");
  if (!captioningPresent()) {
    // A fresh install (or a model switch) can be asked for a caption before
    // the download ran: start it, the frontend shows a notice.
    await startDownload(user.id);
    return {
      status: false,
      reason: "model_downloading",
      message: "The captioning model is being downloaded. Try again in a few minutes.",
    };
  }
  await ensureCaptionRow(photo.id);
  if (!photo.has_thumbnail_row) throw ApiError.internal("photo has no thumbnail");
  if (!photo.thumbnail_big || (await siteSettings()).CAPTIONING_MODEL.toLowerCase() === "none") return statusMessage(500, CAPTION_FAILED);
  const imagePath = mediaPath(photo.thumbnail_big);
  const prompt = captionPrompt(await captionContext(photo.id, user.id));
  let caption: string;
  try {
    caption = cleanCaption(await sidecars.generateCaption(imagePath, prompt));
  } catch (e) {
    console.warn(`could not generate caption for ${imagePath}: ${(e as Error).message}`);
    return statusMessage(500, CAPTION_FAILED);
  }
  try {
    await storeGeneratedCaption(photo.id, caption);
  } catch (e) {
    console.warn(`could not store caption for ${imagePath}: ${(e as Error).message}`);
    return statusMessage(500, CAPTION_FAILED);
  }
  return { status: true };
}

/** search_similar_embedding's default cut for CLIP ViT-B/32 text queries. */
const SEARCH_THRESHOLD = 27;
/** The photo detail's search_similar_image threshold. */
const SIMILAR_THRESHOLD = 90;

/**
 * SemanticSearchFilter: image hashes the user's similarity index returns
 * for the query text (top `topk`). An error status answers no hits (logged);
 * an unreachable sidecar is a 500, as in Django.
 */
export async function semanticSearchHashes(userId: number, query: string, topk: number): Promise<string[]> {
  let emb: number[];
  try {
    emb = (await sidecars.queryEmbeddings(query, clipModelDir())).emb;
  } catch (e) {
    throw ApiError.internal(e);
  }
  try {
    const reply = await sidecars.similaritySearch(userId, Array.from(Float32Array.from(emb)), SEARCH_THRESHOLD, Math.max(0, topk));
    return (reply.result ?? []).filter((h): h is string => typeof h === "string");
  } catch (e) {
    if (e instanceof sidecars.SidecarError && e.kind === "status") {
      console.error(`error retrieving similar embeddings for user ${userId}: status ${e.status}`);
      return [];
    }
    throw ApiError.internal(e);
  }
}

/**
 * PhotoSerializer.get_similar_photos: the owner's index matches for a stored
 * embedding that `viewer` may see, as {image_hash, type}. Any sidecar failure
 * is an empty list. Embeddings another model produced are not searchable.
 */
export async function similarPhotos(
  ownerId: number,
  viewer: number | null,
  clipEmbeddings: unknown,
  clipEmbeddingsModel: string | null,
): Promise<{ image_hash: string; type: "video" | "image" }[]> {
  if (clipEmbeddingsModel !== null && clipEmbeddingsModel !== "clip_vit_b32") return [];
  const emb = storedEmbedding(clipEmbeddings);
  if (!emb) return [];
  let hashes: string[];
  try {
    const reply = await sidecars.similaritySearch(ownerId, emb, SIMILAR_THRESHOLD);
    hashes = (reply.result ?? []).filter((h): h is string => typeof h === "string");
  } catch (e) {
    console.warn(`similarity service: ${(e as Error).message}`);
    return [];
  }
  if (!hashes.length) return [];
  const rs = await rows<{ image_hash: string; video: boolean }>(
    sql`SELECT p.image_hash, p.video FROM api_photo p WHERE ${ownedBy("p", ownerId)} AND ${visibleTo("p", viewer)}
      AND p.image_hash = ANY(${pgArray(hashes, "text")}) ORDER BY p.exif_timestamp DESC, p.id`,
  );
  return rs.map((r) => ({ image_hash: r.image_hash, type: r.video ? "video" : "image" }));
}
