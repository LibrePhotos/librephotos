import type { JobRequest } from "./types";

const root = ["jobs"] as const;

export const jobKeys = {
  /** The job lists and every job's detail. */
  all: root,
  list: (request: JobRequest) => [...root, "list", request] as const,
  detail: (id: number) => [...root, "detail", id] as const,
  /** Whether the worker can take a job (not under `all`: a job change does not always move it). */
  worker: () => ["worker"] as const,
};
