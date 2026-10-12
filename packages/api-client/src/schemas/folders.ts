import { z } from "zod";

/**
 * One folder of a directory tree: `GET /dirtree/?path=` (admin, below the data root) and
 * `GET /nextcloud/listdir/?fpath=` (the user's Nextcloud). Both answer a list of these.
 */
export type DirTree = {
  title: string;
  absolute_path: string;
  children: DirTree[];
};

export const DirTree: z.ZodType<DirTree> = z.lazy(() =>
  z.object({
    title: z.string(),
    absolute_path: z.string(),
    children: z.array(DirTree),
  })
);

export const DirTreeResponse = z.array(DirTree);
export type DirTreeResponse = z.infer<typeof DirTreeResponse>;
