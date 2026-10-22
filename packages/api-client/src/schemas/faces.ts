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
  /**
   * The group's place when groups that look alike sit together (#622); null without a cluster
   * centroid chain (too many groups, "Unknown - Other"). Optional: older servers omit it.
   */
  similarity_rank: z.number().nullable().optional(),
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
  /** null for a face without a crop (legacy rows). */
  face_url: z.string().nullable().optional(),
  photo: z.string().nullable().optional(),
  timestamp: z.string().nullable().optional(),
  person: z.number().nullable().optional(),
  person_label_probability: z.number().optional(),
  person_name: z.string().optional(),
});
export type LabelledFace = z.infer<typeof LabelledFace>;

/**
 * A face's people by id: the one it is labelled with and the two suggested ones. POST
 * /api/labelfaces answers them as they were before the request (`previous`), and
 * POST /api/restore-face-labels/ takes them back (#127).
 */
export const FaceLabels = z.object({
  id: z.number(),
  person: z.number().nullable(),
  cluster_person: z.number().nullable(),
  classification_person: z.number().nullable(),
});
export type FaceLabels = z.infer<typeof FaceLabels>;

/** A named person faces were sent away from ("Not Anna", #2747): never suggested for them again. */
export const RejectedPerson = z.object({
  id: z.number(),
  name: z.string(),
});
export type RejectedPerson = z.infer<typeof RejectedPerson>;

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
  /** Each face's people before the request, for an undo. Optional: older servers omit it. */
  previous: FaceLabels.array().optional(),
  /** Who is no longer suggested for these faces (#2747). Optional: older servers omit it. */
  rejected_people: RejectedPerson.array().optional(),
  /**
   * The faces labelled along with the ones sent: the same face in the other frames of a burst or
   * bracket stack or a duplicate group (#2754). They are in `results` and `previous` too. Optional:
   * older servers omit it.
   */
  twin_ids: z.number().array().optional(),
});
export type SetFacesLabelResponse = z.infer<typeof SetFacesLabelResponse>;

/**
 * POST /api/deletefaces response. The string arrays hold the crop URLs of the deleted faces; a face
 * without a crop is only in `deleted_ids`.
 */
export const DeleteFacesResponse = z.looseObject({
  status: z.boolean(),
  /** Optional: older servers omit it. */
  deleted_ids: z.number().array().optional(),
  results: z.string().array().default([]),
  deleted: z.string().array().default([]),
  not_deleted: z.string().array().default([]),
});
export type DeleteFacesResponse = z.infer<typeof DeleteFacesResponse>;

/** POST /api/restore-faces/ and /api/restore-face-labels/ response: the faces restored. */
export const RestoreFacesResponse = z.looseObject({
  restored_ids: z.number().array(),
  /**
   * Why the edit, saved in LibrePhotos, did not reach the file or its sidecar; null when it was
   * written or writing is off.
   */
  write_error: z.string().nullable(),
});
export type RestoreFacesResponse = z.infer<typeof RestoreFacesResponse>;

/**
 * POST /api/trainfaces, /api/scanphotos, /api/fullscanphotos, GET /api/scanfaces.
 * `already_running` is set by the endpoint functions, not the server: the job
 * was already queued or running (a 409) and `job_id` is that job's.
 */
export const JobTriggerResponse = z.looseObject({
  status: z.boolean(),
  // Optional: before 1.2.0 a failed start answered 200 with {"status": false} and no job_id.
  job_id: z.string().optional(),
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
