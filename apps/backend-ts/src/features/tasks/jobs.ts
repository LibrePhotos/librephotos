// The lp-tasks job registry (port of lp_tasks::register_jobs): background
// follow-ups that call the ML sidecars or external services. Same kinds and
// payloads as Rust (payloads carry ids only):
//
// | kind               | payload                  | Django                                      |
// | faces.scan         | {user_id, full_scan?}    | scan_faces                                  |
// | faces.cluster      | {user_id}                | generate_face_embeddings + cluster_all_faces |
// | faces.train        | {user_id}                | train_faces                                 |
// | tags.generate      | {user_id, full_scan?}    | generate_tags                               |
// | geo.locate         | {user_id, full_scan?}    | add_geolocation                             |
// | clip.embed         | {user_id, full_scan?}    | batch_calculate_clip_embedding              |
// | similarity.build   | {user_id}                | build_image_similarity_index                |
// | ocr.generate       | {user_id, full_scan?}    | generate_ocr                                |
// | media.classify     | {user_id}                | classify_media                              |
// | captions.generate  | {photo_id}               | generate_captions_im2txt                    |
// | models.download    | {user_id}                | download_models                             |
// | nextcloud.scan     | {user_id}                | nextcloud scan_photos                       |
//
// A job enqueued with an LRJ reports on it; one enqueued without gets its
// own, as Django's get_or_create_job does.
import { JobType, registerJob, type JobCtx } from "../../lib/jobs";
import { generateIm2txt } from "./captions";
import { buildIndex, embed } from "./clip";
import { clusterAllFaces, trainFaces } from "./cluster";
import { generateFaceEmbeddings, scanFaces } from "./faces";
import { locate } from "./geocode";
import { registerModelJobs, waitForDownload } from "./models";
import { registerNextcloudJobs } from "./nextcloud";
import { classifyMedia, generateOcr } from "./ocr";
import { begin, complete, fail } from "./run";
import { generateTags } from "./tags";

interface UserPayload {
  userId: number;
  fullScan: boolean;
}

function userPayload(ctx: JobCtx): UserPayload {
  const p = ctx.payload ?? {};
  const userId = p.user_id;
  if (!Number.isInteger(userId)) throw new Error(`${ctx.job.kind} payload: missing field \`user_id\``);
  return { userId, fullScan: p.full_scan === true };
}

/** Run a user job on its LongRunningJob: created when the enqueuer made none, failed with the error when the work throws. */
async function tracked(ctx: JobCtx, jobType: JobType, work: (p: UserPayload, jobId: string) => Promise<void>) {
  const p = userPayload(ctx);
  const jobId = await begin(ctx.lrjId, jobType, p.userId);
  try {
    await work(p, jobId);
  } catch (e) {
    console.error(`${ctx.job.kind} failed: ${(e as Error).message}`);
    await fail(jobId, (e as Error).message);
    throw e;
  }
}

/** The ML job handlers, keyed by kind (also what `cli.ts run-job` runs). */
export const TASK_HANDLERS: Record<string, (ctx: JobCtx) => Promise<void>> = {
  "faces.scan": async (ctx) => {
    await waitForDownload();
    await tracked(ctx, JobType.ScanFaces, (p, jobId) => scanFaces(p.userId, p.fullScan, jobId));
  },
  "faces.cluster": async (ctx) => {
    await waitForDownload();
    const p = userPayload(ctx);
    await generateFaceEmbeddings(p.userId);
    await clusterAllFaces(p.userId, ctx.lrjId);
  },
  "faces.train": async (ctx) => {
    await trainFaces(userPayload(ctx).userId, ctx.lrjId);
  },
  "tags.generate": async (ctx) => {
    await waitForDownload();
    await tracked(ctx, JobType.GenerateTags, (p, jobId) => generateTags(p.userId, p.fullScan, jobId));
  },
  "geo.locate": (ctx) => tracked(ctx, JobType.AddGeolocation, (p, jobId) => locate(p.userId, p.fullScan, jobId)),
  "clip.embed": async (ctx) => {
    await waitForDownload();
    const p = userPayload(ctx);
    const jobId = await begin(ctx.lrjId, JobType.CalculateClipEmbeddings, p.userId);
    // embed fails the job itself when only the index build failed.
    await embed(p.userId, p.fullScan, jobId);
  },
  "similarity.build": async (ctx) => {
    const p = userPayload(ctx);
    try {
      await buildIndex(p.userId);
      if (ctx.lrjId) await complete(ctx.lrjId);
    } catch (e) {
      if (ctx.lrjId) await fail(ctx.lrjId, (e as Error).message);
      throw e;
    }
  },
  "ocr.generate": async (ctx) => {
    await waitForDownload();
    await tracked(ctx, JobType.GenerateOcr, (p, jobId) => generateOcr(p.userId, p.fullScan, jobId));
  },
  "media.classify": (ctx) => tracked(ctx, JobType.ClassifyMedia, (p, jobId) => classifyMedia(p.userId, jobId)),
  "captions.generate": async (ctx) => {
    await waitForDownload();
    const photoId = ctx.payload?.photo_id;
    if (typeof photoId !== "string") throw new Error("captions.generate payload: missing field `photo_id`");
    const outcome = await generateIm2txt(photoId);
    if (ctx.lrjId) {
      if (outcome.ok) await complete(ctx.lrjId);
      else await fail(ctx.lrjId, "Failed to generate caption");
    }
  },
};

export function registerTaskJobs() {
  registerModelJobs();
  registerNextcloudJobs();
  for (const [kind, handler] of Object.entries(TASK_HANDLERS)) registerJob(kind, handler);
}

registerTaskJobs();
