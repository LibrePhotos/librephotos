import { JobDetail } from "@librephotos/api-client";
import { z } from "zod";

// The job schemas are shared with the mobile app and live in
// packages/api-client; this module re-exports them under their old names.
export { Job, JobDetail, JobsResponse, WorkerAvailabilityResponse } from "@librephotos/api-client";

export const JobRequest = z.object({
  pageSize: z.number().optional(),
  page: z.number().optional(),
  /** Narrow the list to the caller's own jobs. Only meaningful for staff, who
   *  otherwise get the global list; everyone else is already scoped server-side. */
  mine: z.boolean().optional(),
});

export type JobRequest = z.infer<typeof JobRequest>;

export const CancelJobResponse = z.object({
  status: z.boolean(),
  job: JobDetail.optional(),
  message: z.string().optional(),
});

export type CancelJobResponse = z.infer<typeof CancelJobResponse>;
