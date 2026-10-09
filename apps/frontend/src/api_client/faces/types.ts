import { z } from "zod";

export const FacesTab = z.enum(["labeled", "inferred", "unknown"]);
export type FacesTab = z.infer<typeof FacesTab>;

export const TabSettings = z.object({
  scrollPosition: z.number(),
});
export type TabSettings = z.infer<typeof TabSettings>;
export const TabSettingsArray = z.record(FacesTab, TabSettings);
export type TabSettingsArray = z.infer<typeof TabSettingsArray>;

export const FacesOrderOption = z.enum(["confidence", "date"]);
export type FacesOrderOption = z.infer<typeof FacesOrderOption>;

/**
 * The order the faces dashboard keeps in its URL: the backend's two orders, plus "person",
 * an older order the dashboard still sorts by date.
 */
export const FacesRouteOrder = z.enum(["confidence", "date", "person"]);
export type FacesRouteOrder = z.infer<typeof FacesRouteOrder>;

export const FaceAnalysisMethod = z.enum(["clustering", "classification"]);
export type FaceAnalysisMethod = z.infer<typeof FaceAnalysisMethod>;

export const IncompletePersonFace = z.object({
  id: z.number(),
  name: z.string(),
  kind: z.string(),
  face_count: z.number(),
});

export const PersonFace = z.object({
  id: z.number(),
  image: z.string().nullable(),
  face_url: z.string().nullable(),
  photo: z.string(),
  photo_image_hash: z.string().nullable().optional(),
  person_label_probability: z.number(),
  isTemp: z.boolean().optional(),
  person: z.number().nullable().optional(),
  person_name: z.string().optional(),
  timestamp: z.string().optional().nullable(),
});
export type PersonFace = z.infer<typeof PersonFace>;
export type PersonFaceList = z.infer<typeof PersonFaceList>;

export const PersonFaceList = z.array(PersonFace);

export const CompletePersonFace = z.object({
  id: z.number(),
  name: z.string(),
  kind: z.string(),
  face_count: z.number(),
  faces: PersonFaceList,
});
export type CompletePersonFace = z.infer<typeof CompletePersonFace>;
export const CompletePersonFaceList = z.array(CompletePersonFace);
export type CompletePersonFaceList = z.infer<typeof CompletePersonFaceList>;

export const Face = z.object({
  id: z.number(),
  image: z.string().nullable(),
  photo: z.string().nullable(),
  person: z.number(),
  person_label_probability: z.number(),
  person_name: z.string(),
});

export const FaceList = z.array(Face);
export const InferredFaces = FaceList;
