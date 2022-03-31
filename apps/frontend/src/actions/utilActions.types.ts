import { z } from "zod";

import { SimpleUser } from "../store/user/user.zod";

export const Job = z.object({
  job_id: z.string(),
  queued_at: z.string(),
  started_at: z.string(),
  finished_at: z.string(),
  finished: z.boolean(),
  failed: z.boolean(),
  job_type: z.number(),
  job_type_str: z.string(),
  started_by: SimpleUser,
  result: z.object({}),
  id: z.number(),
});

export const SiteSettings = z.object({
  allow_registration: z.boolean(),
  allow_upload: z.boolean(),
  skip_patterns: z.string(),
  heavyweight_process: z.number(),
  map_api_key: z.string(),
});

interface DirTree {
  title: string;
  absolutePath?: string;
  children?: DirTree[];
}

// cast to z.ZodType<Category>
export const DirTree: z.ZodType<DirTree> = z.lazy(() =>
  z.object({
    title: z.string(),
    absolutePath: z.string().optional(),
    children: z.array(DirTree).optional(),
  })
);
