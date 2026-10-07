// `tags.generate`: tagging-model tags per photo (processing_jobs.generate_tags
// + PhotoCaption.generate_tag_captions); port of lp_tasks::tags with the tags
// sidecar instead of Rust's in-process tagger (no shared embedding).
import { client } from "../../lib/db";
import { config } from "../../lib/config";
import { JobType } from "../../lib/jobs";
import { siteSettings } from "../../lib/settings";
import { forEachPhoto, loadPhoto, thumbnailPath } from "./photos";
import { lastFinishedStart, sinceParams, startItems } from "./run";
import { rebuildSearchCaptions } from "./searchCaptions";
import * as sidecars from "./sidecars";
import { replaceThingMembershipsMany, type Exec } from "./things";

/** tag_thing_type: the AlbumThing type a tagging model files its tags under. */
export const thingType = (taggingModel: string) => `${taggingModel}_tag`;

/** Photos the tags job keeps in flight (the sidecar queues them). */
const TAG_IN_FLIGHT = 4;

export async function generateTags(userId: number, fullScan: boolean, jobId: string): Promise<void> {
  const model = (await siteSettings()).TAGGING_MODEL;
  const [useSince, since] = sinceParams(fullScan ? undefined : await lastFinishedStart(userId, JobType.GenerateTags, false));
  const ids: { id: string }[] = await client`SELECT p.id::text AS id FROM api_photo p LEFT JOIN api_photo_caption pc ON pc.photo_id = p.id
    WHERE p.owner_id = ${userId}
      AND (pc.photo_id IS NULL OR pc.captions_json IS NULL OR NOT (pc.captions_json ? ${model}))
      AND (${useSince}::boolean IS FALSE OR p.added_on > ${since}::timestamptz)
    ORDER BY p.id`;
  if (!(await startItems(jobId, ids.length))) return;
  await forEachPhoto(
    jobId,
    ids.map((r) => r.id),
    TAG_IN_FLIGHT,
    (id) => tagPhoto(id),
  );
}

/**
 * `generate_tag_job` for one photo. Only an unreachable or timed-out sidecar
 * is an error; an error status or an unusable reply is logged and the photo
 * skipped, as in Django.
 */
export async function tagPhoto(photoId: string): Promise<void> {
  const photo = await loadPhoto(photoId);
  if (!photo) return;
  const model = (await siteSettings()).TAGGING_MODEL;
  const [{ captions_json: existing }] = await client`WITH ins AS (
      INSERT INTO api_photo_caption (photo_id, captions_json, created_at, updated_at) VALUES (${photoId}, NULL, now(), now())
      ON CONFLICT (photo_id) DO NOTHING RETURNING captions_json)
    SELECT captions_json FROM ins UNION ALL SELECT captions_json FROM api_photo_caption WHERE photo_id = ${photoId} LIMIT 1`;
  if (!config.features.sceneClassification) return;
  const thumb = thumbnailPath(photo);
  if (!thumb) return;
  if (existing && typeof existing === "object" && (existing as Record<string, unknown>)[model] != null) return;
  const [{ confidence }] = await client`SELECT confidence FROM api_user WHERE id = ${photo.owner_id}`;
  let reply: Record<string, unknown>;
  try {
    reply = await sidecars.generateTags(thumb, confidence, model);
  } catch (e) {
    if (e instanceof sidecars.SidecarError && (e.kind === "status" || e.kind === "body")) {
      console.warn(`tag service gave no tags for ${thumb}: ${e.message}`);
      return;
    }
    throw new Error(`Photo ${photo.image_hash}: ${(e as Error).message}`);
  }
  await storeTags(photoId, photo.owner_id, model, reply);
}

/** Store a tagger reply ({"tags": {...}}): captions_json[model], the tag albums, search captions. */
export async function storeTags(photoId: string, ownerId: number, model: string, reply: Record<string, unknown> | null): Promise<void> {
  const tags = reply?.tags;
  if (tags === null || tags === undefined) return;
  const inner = (tags as Record<string, unknown>).tags;
  const titles = Array.isArray(inner) ? inner.filter((t): t is string => typeof t === "string") : [];
  await client.begin(async (txn) => {
    const tx = txn as unknown as Exec;
    await tx`UPDATE api_photo_caption c SET captions_json = jsonb_set(
        CASE WHEN jsonb_typeof(c.captions_json) = 'object' THEN c.captions_json ELSE '{}'::jsonb END,
        ARRAY[${model}::text], ${JSON.stringify(tags)}::text::jsonb), updated_at = now()
      WHERE c.photo_id = ${photoId}`;
    await replaceThingMembershipsMany(tx, ownerId, thingType(model), [{ id: photoId, titles }]);
    await rebuildSearchCaptions(tx, [photoId], model);
  });
}
