import { z } from "zod";

interface DirTreeItem {
  title: string;
  absolutePath?: string;
  children?: DirTreeItem[];
}

// cast to z.ZodType<Category>
export const DirTree: z.ZodType<DirTreeItem> = z.lazy(() =>
  z.object({
    title: z.string(),
    absolute_path: z.string().optional(),
    children: z.array(DirTree).optional(),
  })
);

export const DeleteMissingPhotosResponse = z.object({
  status: z.boolean(),
  // To-Do: Why is it not a number?!?!
  job_id: z.string().optional(),
});


export const SearchTermExamples = z.array(z.string());

