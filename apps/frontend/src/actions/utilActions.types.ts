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

export const GenerateEventAlbumsResponse = z.object({
  status: z.boolean(),
  // To-Do: Why is it not a number?!?!
  job_id: z.string().optional(),
});

export const GenerateEventAlbumsTitlesResponse = z.object({
  status: z.boolean(),
  // To-Do: Why is it not a number?!?!
  job_id: z.string().optional(),
});

export const SearchTermExamples = z.array(z.string());

export const TimelinePoint = z.object({
  data: z.array(z.number()),
  color: z.string(),
  loc: z.string(),
  start: z.number(),
  end: z.number(),
});

export const LocationTimeline = z.array(TimelinePoint);

export const CountStats = z.object({
  num_photos: z.number(),
  num_missing_photos: z.number(),
  num_faces: z.number(),
  num_people: z.number(),
  num_unknown_faces: z.number(),
  num_labeled_faces: z.number(),
  num_inferred_faces: z.number(),
  num_albumauto: z.number(),
  num_albumdate: z.number(),
  num_albumuser: z.number(),
});

export const PhotoMonthCount = z.object({
  month: z.string(),
  count: z.number(),
});

// To-Do: Why y?!?!
export const WordCloud = z.object({
  label: z.string(),
  y: z.number(),
});

export const WordCloudResponse = z.object({
  captions: WordCloud.array(),
  people: WordCloud.array(),
  locations: WordCloud.array(),
});
