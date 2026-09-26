import { z } from "zod";

/**
 * Face-tagging schemas (backend api/views/faces.py). Faces are NOT mirrored to
 * the on-device SQLite (doc 02); the mobile tagging workflow is online-only and
 * reads these endpoints directly.
 */

/** One face row (GET /api/faces/). `person` is null for unknown/other faces. */
export const PersonFace = z
  .object({
    id: z.number(),
    image: z.string().nullable().optional(),
    face_url: z.string().nullable().optional(),
    photo: z.string().nullable().optional(),
    photo_image_hash: z.string().nullable().optional(),
    person_label_probability: z.number().nullable().optional(),
    person: z.number().nullable().optional(),
    person_name: z.string().nullable().optional(),
    timestamp: z.string().nullable().optional(),
  })
  .passthrough();
export type PersonFace = z.infer<typeof PersonFace>;

/** DRF-paginated face list. */
export const PersonFaceListResponse = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: PersonFace.array(),
});
export type PersonFaceListResponse = z.infer<typeof PersonFaceListResponse>;

/** One cluster / person-with-incomplete-labels bucket (GET /api/faces/incomplete/, bare array). */
export const IncompletePersonFace = z
  .object({
    id: z.number(),
    name: z.string().nullable(),
    kind: z.string().nullable().optional(),
    face_count: z.number(),
  })
  .passthrough();
export type IncompletePersonFace = z.infer<typeof IncompletePersonFace>;

export const IncompleteFacesResponse = IncompletePersonFace.array();
export type IncompleteFacesResponse = z.infer<typeof IncompleteFacesResponse>;

/** POST /api/labelfaces response. */
export const SetFacesLabelResponse = z
  .object({
    status: z.boolean(),
    results: PersonFace.array().default([]),
    updated: PersonFace.array().default([]),
    not_updated: PersonFace.array().default([]),
  })
  .passthrough();
export type SetFacesLabelResponse = z.infer<typeof SetFacesLabelResponse>;

/** POST /api/deletefaces response (arrays hold face image URLs). */
export const DeleteFacesResponse = z
  .object({
    status: z.boolean(),
    results: z.string().array().default([]),
    deleted: z.string().array().default([]),
    not_deleted: z.string().array().default([]),
  })
  .passthrough();
export type DeleteFacesResponse = z.infer<typeof DeleteFacesResponse>;

/** POST /api/trainfaces, GET /api/scanfaces. */
export const JobTriggerResponse = z
  .object({
    status: z.boolean(),
    job_id: z.string().nullable().optional(),
  })
  .passthrough();
export type JobTriggerResponse = z.infer<typeof JobTriggerResponse>;

/** The unknown/other sentinel name — labeling faces with it rejects them. */
export const UNKNOWN_PERSON_NAME = "Unknown - Other";
