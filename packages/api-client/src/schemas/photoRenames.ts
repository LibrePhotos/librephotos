import { z } from "zod";
import { UuidString } from "./common";
import { MoveRefusalReason, RefusedCount } from "./photoMoves";

/** What renaming does with one photo (#2773). */
export const RenameStatus = z.enum(["rename", "unchanged", "undated", "refused", "no_free_name"]);
export type RenameStatus = z.infer<typeof RenameStatus>;

/** One photo of the rename preview: its main file's name now and the one it gets. */
export const RenameRow = z.object({
  photo_id: UuidString,
  image_hash: z.string(),
  name: z.string(),
  /** Null when the photo keeps its name. */
  new_name: z.string().nullable(),
  /** More files renamed with it: RAW, Live Photo video, XMP sidecars. */
  other_files: z.number(),
  status: RenameStatus,
  /** The " (n)" the new name got because the name was taken; 0: none. */
  number: z.number(),
  /** Why a refused photo keeps its name. */
  reason: MoveRefusalReason.nullable(),
});
export type RenameRow = z.infer<typeof RenameRow>;

/** `POST /photos/rename/preview/`: what renaming the selection would do. Changes nothing. */
export const RenamePreviewResponse = z.object({
  photos: z.number(),
  files: z.number(),
  unchanged: z.number(),
  undated: z.number(),
  /** The image hashes of the undated photos, to set their date. */
  undated_hashes: z.string().array(),
  numbered: z.number(),
  no_free_name: z.number(),
  refused: RefusedCount.array(),
  /** The first photos one by one; the rest are only counted. */
  rows: RenameRow.array(),
});
export type RenamePreviewResponse = z.infer<typeof RenamePreviewResponse>;

/** `POST /photos/rename/` (200): the selection was renamed within the request; the counts are photos. */
export const RenamePhotosResponse = z.object({
  renamed: z.number(),
  unchanged: z.number(),
  undated: z.number(),
  refused: z.number(),
  failed: z.number(),
});
export type RenamePhotosResponse = z.infer<typeof RenamePhotosResponse>;

/** `POST /photos/rename/` (202): a large selection is renamed in the "Rename Photos" job. */
export const RenamePhotosStartedResponse = z.object({
  job_id: z.string(),
});
export type RenamePhotosStartedResponse = z.infer<typeof RenamePhotosStartedResponse>;

/** Either answer of `POST /photos/rename/`: the job's start carries `job_id`. */
export const RenamePhotosAnswer = z.union([RenamePhotosStartedResponse, RenamePhotosResponse]);
export type RenamePhotosAnswer = z.infer<typeof RenamePhotosAnswer>;
