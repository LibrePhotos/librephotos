import { z } from "zod";
import { PageFields } from "./common";

/**
 * Face-tagging schemas (backend api/views/faces.py). Faces are NOT mirrored to
 * the on-device SQLite (doc 02); the mobile tagging workflow is online-only and
 * reads these endpoints directly.
 */

/** One face row (GET /api/faces/). `person` is null for unknown/other faces. */
export const PersonFace = z.looseObject({
  id: z.number(),
  image: z.string().nullable().optional(),
  face_url: z.string().nullable().optional(),
  photo: z.string().nullable().optional(),
  photo_image_hash: z.string().nullable().optional(),
  person_label_probability: z.number().nullable().optional(),
  person: z.number().nullable().optional(),
  person_name: z.string().nullable().optional(),
  timestamp: z.string().nullable().optional(),
});
export type PersonFace = z.infer<typeof PersonFace>;

/** DRF-paginated face list. */
export const PersonFaceListResponse = z.object({
  ...PageFields,
  results: PersonFace.array(),
});
export type PersonFaceListResponse = z.infer<typeof PersonFaceListResponse>;

/**
 * One cluster / person-with-incomplete-labels bucket (GET /api/faces/incomplete/, bare array).
 * IncompletePersonFaceListSerializer sends the person's name and kind, never null; the appended
 * "Unknown - Other" entry (id 0) has that name as its kind too.
 */
export const IncompletePersonFace = z.looseObject({
  id: z.number(),
  name: z.string(),
  kind: z.string().optional(),
  face_count: z.number(),
});
export type IncompletePersonFace = z.infer<typeof IncompletePersonFace>;

export const IncompleteFacesResponse = IncompletePersonFace.array();
export type IncompleteFacesResponse = z.infer<typeof IncompleteFacesResponse>;

/**
 * One relabelled face in the answer of POST /api/labelfaces (FaceListSerializer). `person` is null
 * and `person_name` is "Unknown - Other" for a face moved back to unknown.
 */
export const LabelledFace = z.looseObject({
  id: z.number(),
  image: z.string().nullable().optional(),
  face_url: z.string().optional(),
  photo: z.string().nullable().optional(),
  timestamp: z.string().nullable().optional(),
  person: z.number().nullable().optional(),
  person_label_probability: z.number().optional(),
  person_name: z.string().optional(),
});
export type LabelledFace = z.infer<typeof LabelledFace>;

/** POST /api/labelfaces response. */
export const SetFacesLabelResponse = z.looseObject({
  status: z.boolean(),
  results: LabelledFace.array().default([]),
  updated: LabelledFace.array().default([]),
  not_updated: LabelledFace.array().default([]),
  /**
   * Why the edit, saved in LibrePhotos, did not reach the file or its sidecar (read-only library, a
   * HEIC/RAW original); null when it was written or writing is off. Optional: older servers omit it.
   */
  write_error: z.string().nullable().optional(),
});
export type SetFacesLabelResponse = z.infer<typeof SetFacesLabelResponse>;

/** POST /api/deletefaces response (arrays hold face image URLs). */
export const DeleteFacesResponse = z.looseObject({
  status: z.boolean(),
  results: z.string().array().default([]),
  deleted: z.string().array().default([]),
  not_deleted: z.string().array().default([]),
});
export type DeleteFacesResponse = z.infer<typeof DeleteFacesResponse>;

/**
 * POST /api/trainfaces, /api/scanphotos, /api/fullscanphotos, GET /api/scanfaces.
 * `already_running` is set by the endpoint functions, not the server: the job
 * was already queued or running (a 409) and `job_id` is that job's.
 */
export const JobTriggerResponse = z.looseObject({
  status: z.boolean(),
  job_id: z.string().nullable().optional(),
  already_running: z.boolean().optional(),
});
export type JobTriggerResponse = z.infer<typeof JobTriggerResponse>;

/** How the face list orders a person's faces (`order_by`). */
export const FaceOrderBy = z.enum(["confidence", "date"]);
export type FaceOrderBy = z.infer<typeof FaceOrderBy>;

/** Which guess the suggested faces come from (`analysis_method`). */
export const FaceAnalysisMethod = z.enum(["clustering", "classification"]);
export type FaceAnalysisMethod = z.infer<typeof FaceAnalysisMethod>;

/** One face on the face cluster chart (api/faces/classify.py build_scatter_point). */
const ClusterFacePoint = z.object({
  person_id: z.number(),
  person_name: z.string(),
  person_label_is_inferred: z.boolean(),
  color: z.string(),
  face_url: z.string(),
  value: z.object({
    x: z.number(),
    y: z.number(),
    size: z.number(),
  }),
});

/** `GET /clusterfaces`: every face with an encoding, projected onto three axes. */
export const ClusterFacesResponse = z.object({
  status: z.boolean(),
  data: ClusterFacePoint.array(),
});
export type ClusterFacesResponse = z.infer<typeof ClusterFacesResponse>;

/** A face box drawn by hand, each side a fraction of the displayed image. */
export type NormalizedFaceBox = { top: number; right: number; bottom: number; left: number };

/** `POST /addface` (201): the new face, its box in big-thumbnail pixels like every other face's. */
export const AddFaceResponse = z.object({
  status: z.boolean(),
  /**
   * Why the edit, saved in LibrePhotos, did not reach the file or its sidecar (read-only library, a
   * HEIC/RAW original); null when it was written or writing is off. Optional: older servers omit it.
   */
  write_error: z.string().nullable().optional(),
  face: z.object({
    face_id: z.number(),
    face_url: z.string(),
    person: z.number(),
    person_name: z.string(),
    location: z.object({
      top: z.number(),
      right: z.number(),
      bottom: z.number(),
      left: z.number(),
    }),
  }),
});
export type AddFaceResponse = z.infer<typeof AddFaceResponse>;

/** The unknown/other sentinel name — labeling faces with it rejects them. */
export const UNKNOWN_PERSON_NAME = "Unknown - Other";
