import { z } from "zod";
import { UuidString } from "./common";

/** What to do with a photo whose name is taken in the folder (#352); a file is never overwritten. */
export const MoveOnConflict = z.enum(["rename", "skip"]);
export type MoveOnConflict = z.infer<typeof MoveOnConflict>;

/** Why a photo of the selection does not move: a Nextcloud copy, a file another photo uses, no files on disk. */
export const MoveRefusalReason = z.enum(["nextcloud", "shared_file", "not_on_disk"]);
export type MoveRefusalReason = z.infer<typeof MoveRefusalReason>;

/** A photo whose main file's name is taken in the folder, and the name "rename" gives it. */
export const MoveClash = z.object({
  photo_id: UuidString,
  name: z.string(),
  renamed_to: z.string().nullable(),
});
export type MoveClash = z.infer<typeof MoveClash>;

export const RefusedCount = z.object({
  reason: MoveRefusalReason,
  photos: z.number(),
});
export type RefusedCount = z.infer<typeof RefusedCount>;

/** `POST /photos/move/preview/`: what moving the selection to `target_folder` would do. Changes nothing. */
export const MovePreviewResponse = z.object({
  target_folder: z.string(),
  photos: z.number(),
  files: z.number(),
  unchanged: z.number(),
  refused: RefusedCount.array(),
  clashes: MoveClash.array(),
});
export type MovePreviewResponse = z.infer<typeof MovePreviewResponse>;

/** `POST /photos/move/` (200): the selection moved within the request; the counts are photos. */
export const MovePhotosResponse = z.object({
  target_folder: z.string(),
  moved: z.number(),
  skipped: z.number(),
  unchanged: z.number(),
  refused: z.number(),
  failed: z.number(),
});
export type MovePhotosResponse = z.infer<typeof MovePhotosResponse>;

/** `POST /photos/move/` (202): a large selection moves in the "Move Photos" job. */
export const MovePhotosStartedResponse = z.object({
  job_id: z.string(),
  target_folder: z.string(),
});
export type MovePhotosStartedResponse = z.infer<typeof MovePhotosStartedResponse>;

/** Either answer of `POST /photos/move/`: the job's start carries `job_id`. */
export const MovePhotosAnswer = z.union([MovePhotosStartedResponse, MovePhotosResponse]);
export type MovePhotosAnswer = z.infer<typeof MovePhotosAnswer>;

/** A folder the move picker shows. */
export const LibraryFolder = z.object({
  name: z.string(),
  path: z.string(),
  has_subfolders: z.boolean(),
});
export type LibraryFolder = z.infer<typeof LibraryFolder>;

/** `GET /photos/move/folders/?path=`: one level of the library; without `path` its root folders. */
export const LibraryFolderListing = z.object({
  path: z.string().nullable(),
  folders: LibraryFolder.array(),
  truncated: z.boolean(),
});
export type LibraryFolderListing = z.infer<typeof LibraryFolderListing>;
