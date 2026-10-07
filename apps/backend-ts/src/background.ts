// Background work started with the server: the job worker (LP_WORKER=0 to
// disable) and its maintenance tasks.
import { config } from "./lib/config";
import { runWorker } from "./lib/jobs";
import "./jobs";

export async function startBackground(): Promise<void> {
  if (!config.workerEnabled) return;
  runWorker(Math.max(1, config.workerConcurrency)).catch((e) => console.error("job worker crashed", e));
}
