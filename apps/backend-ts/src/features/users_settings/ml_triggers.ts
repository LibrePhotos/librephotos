// The ML follow-ups the user and site-settings writes start (lp_tasks::clip
// reembed_mismatched and the semantic-search trigger of UserSerializer.update).
// The model download Django chains in front (`do_all_models_exist`) is not
// queued: librephotos-ts has no in-process models to fetch.
import { enqueue, JobType } from "~/lib/jobs";
import { semanticModel } from "~/ml/clip/select";
import { clipEmbedQueued, mismatchedClipOwners } from "./db";

/** Turning semantic search on: batch_calculate_clip_embedding for the user. */
export function queueClipEmbeddings(userId: number) {
  return enqueue("clip.embed", { user_id: userId }, { lrj: { jobType: JobType.CalculateClipEmbeddings, userId } });
}

/** Re-embed every owner of embeddings another model produced (two models never share an index). */
export async function reembedMismatched(): Promise<number> {
  const owners = await mismatchedClipOwners(await semanticModel());
  let queued = 0;
  for (const userId of owners) {
    if (await clipEmbedQueued(userId)) continue;
    await queueClipEmbeddings(userId);
    queued++;
  }
  return queued;
}
