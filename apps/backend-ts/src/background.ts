// Background work started with the server: the job worker (LP_WORKER=0 to
// disable) and its maintenance tasks.
import { config } from "./lib/config";
import { runWorker } from "./lib/jobs";
import "./jobs";

export async function startBackground(): Promise<void> {
  if (!config.workerEnabled) return;
  runWorker(Math.max(1, config.workerConcurrency)).catch((e) => console.error("job worker crashed", e));
  void inProcessMlStartup();
}

/**
 * librephotos-rs's startup checks for in-process CLIP / similarity: queue
 * clip.embed for embeddings of another semantic model, and rebuild missing or
 * outdated in-process similarity indices. Nothing with the sidecars.
 */
async function inProcessMlStartup() {
  const { clipInProcess, similarityInProcess } = await import("./ml/clip/select");
  try {
    if (clipInProcess()) {
      const { reembedMismatched } = await import("./features/users_settings/ml_triggers");
      const n = await reembedMismatched();
      if (n) console.info(`queued clip.embed for ${n} users with embeddings of another semantic model`);
    }
    if (similarityInProcess()) {
      const { rebuildStaleIndices } = await import("./features/tasks/clip");
      const n = await rebuildStaleIndices();
      if (n) console.info(`rebuilt ${n} similarity indices`);
    }
  } catch (e) {
    console.error(`in-process ML startup checks failed: ${(e as Error).message}`);
  }
}
