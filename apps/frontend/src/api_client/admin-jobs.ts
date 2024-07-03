import { z } from "zod";

import { SimpleUser } from "../store/user/user.zod";
import { api } from "./api";

enum AdminJobsEndpoints {
  jobs = "jobs",
  deleteJob = "deleteJob",
}

export const JobSchema = z.object({
  job_id: z.string(),
  queued_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  finished: z.boolean(),
  failed: z.boolean(),
  job_type: z.number(),
  job_type_str: z.string(),
  started_by: SimpleUser,
  error: z.any().optional(),
  progress_current: z.number().optional(),
  progress_target: z.number().optional(),
  id: z.number(),
});

export type Job = z.infer<typeof JobSchema>;

export const JobRequestSchema = z.object({
  pageSize: z.number().optional(),
  page: z.number().optional(),
});

export type JobRequest = z.infer<typeof JobRequestSchema>;

export const JobsResponseSchema = z
  .object({
    count: z.number(),
    next: z.string().nullable(),
    previous: z.string().nullable(),
    results: z.array(JobSchema),
  })
  .optional();

export type JobsResponse = z.infer<typeof JobsResponseSchema>;

const adminJobsApi = api
  .injectEndpoints({
    endpoints: builder => ({
      [AdminJobsEndpoints.jobs]: builder.query<JobsResponse, JobRequest>({
        query: ({ pageSize = 10, page = 0 }) => ({
          url: `jobs/?page_size=${pageSize}&page=${page}`,
        }),
        transformResponse: JobsResponseSchema.parse,
      }),
      [AdminJobsEndpoints.deleteJob]: builder.mutation<void, number>({
        query: id => ({
          method: "DELETE",
          url: `jobs/${id}/`,
        }),
      }),
    }),
  })
  .enhanceEndpoints<"Jobs">({
    addTagTypes: ["Jobs"],
    endpoints: {
      [AdminJobsEndpoints.jobs]: {
        providesTags: ["Jobs"],
      },
      [AdminJobsEndpoints.deleteJob]: {
        invalidatesTags: ["Jobs"],
      },
    },
  });

export const { useJobsQuery, useDeleteJobMutation } = adminJobsApi;
