import { z } from "zod";

export interface DirTree {
  title: string;
  absolute_path: string;
  children: DirTree[];
}

export type DirTreeResponse = DirTree[];

export const DirTree = z.lazy(() =>
  z.object({
    title: z.string(),
    absolute_path: z.string(),
    children: z.array(DirTree),
  })
);

export const DirTreeResponse = z.array(DirTree); 