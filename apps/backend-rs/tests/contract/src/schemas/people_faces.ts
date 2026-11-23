// Schemas the frontend defines inside hook files (which import React /
// TanStack), copied verbatim so the harness can parse with them.
import { PersonFace } from "@fe/faces/types";
import { z } from "zod";

// apps/frontend/src/api_client/albums/hooks/useFetchPeopleAlbumsQuery.ts
export const PersonResponse = z.object({
  name: z.string(),
  face_url: z.string().nullable(),
  face_count: z.number(),
  face_photo_url: z.string(),
  video: z.boolean().optional(),
  id: z.number(),
  newPersonName: z.string().optional(),
  cover_photo: z.string().optional(),
});
export const PeopleResponse = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: PersonResponse.array(),
});

// apps/frontend/src/api_client/faces/hooks/useFetchFacesQuery.ts
export const PersonFaceListResponse = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(PersonFace),
});

// apps/frontend/src/api_client/faces/hooks/useClusterFacesQuery.ts
export const DataPoint = z.object({
  x: z.number(),
  y: z.number(),
  size: z.number(),
});
export const ClusterFaceDatapoint = z.object({
  person_id: z.number(),
  person_name: z.string(),
  person_label_is_inferred: z.boolean().nullable(),
  color: z.string(),
  face_url: z.string(),
  value: DataPoint,
});
export const ClusterFacesResponse = z.object({
  status: z.boolean(),
  data: z.array(ClusterFaceDatapoint),
});

// apps/frontend/src/api_client/faces/hooks/useRescanFacesQuery.ts
export const ScanFacesResponse = z.object({
  status: z.boolean(),
  job_id: z.string().optional(),
});

// apps/frontend/src/api_client/faces/hooks/useAddFaceMutation.ts
export const AddFaceResponse = z.object({
  status: z.boolean(),
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

/** `{"status": false, "message"}` error bodies of the face views (not validated by the UI). */
export const StatusMessage = z.object({ status: z.literal(false), message: z.string() });
