import { orderBy } from "lodash";
import { z } from "zod";

import { faces } from "../../service/notifications/faces";

export type FacesState = {
  labeledFacesList: CompletePersonFaceList;
  unknownFacesList: CompletePersonFaceList;
  inferredFacesList: CompletePersonFaceList;
  facesVis: any[];
  training: boolean;
  trained: boolean;
  clustering: boolean;
  clustered: boolean;
  orderBy: FacesOrderOption;
  analysisMethod: FaceAnalysisMethod;
  error: any;
  activeTab: FacesTab;
  minConfidence: number;
  tabs: TabSettingsArray;
};

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

export const FaceAnalysisMethod = z.enum(["clustering", "classification"]);
export type FaceAnalysisMethod = z.infer<typeof FaceAnalysisMethod>;

export const IncompletePersonFace = z.object({
  id: z.number(),
  name: z.string(),
  kind: z.string(),
  face_count: z.number(),
});

export const IncompletePersonFaceList = z.array(IncompletePersonFace);
export const IncompletePersonFaceListResponse = IncompletePersonFaceList;
export type IncompletePersonFaceListResponse = z.infer<typeof IncompletePersonFaceListResponse>;
export const IncompletePersonFaceListRequest = z.object({
  inferred: z.boolean(),
  method: FaceAnalysisMethod.optional(),
  orderBy: FacesOrderOption,
  minConfidence: z.number().optional(),
});
export type IncompletePersonFaceListRequest = z.infer<typeof IncompletePersonFaceListRequest>;

export const PersonFace = z.object({
  id: z.number(),
  image: z.string().nullable(),
  face_url: z.string().nullable(),
  photo: z.string(),
  person_label_probability: z.number(),
  isTemp: z.boolean().optional(),
  person: z.number().optional(),
  person_name: z.string().optional(),
  timestamp: z.string().optional().nullable(),
});
export type PersonFace = z.infer<typeof PersonFace>;
export type PersonFaceList = z.infer<typeof PersonFaceList>;

export const PersonFaceListResponse = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(PersonFace),
});
export type PersonFaceListResponse = z.infer<typeof CompletePersonFace>;
export const PersonFaceListRequest = z.object({
  person: z.number().optional(),
  page: z.number(),
  inferred: z.boolean(),
  orderBy: FacesOrderOption,
  method: FaceAnalysisMethod.optional(),
  minConfidence: z.number().optional(),
});

export type PersonFaceListRequest = z.infer<typeof PersonFaceListRequest>;

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

export type NotThisPersonRequest = z.infer<typeof NotThisPersonRequest>;
export const NotThisPersonRequest = z.object({
  faceIds: z.array(z.number()),
});

export type SetFacesLabelRequest = z.infer<typeof SetFacesLabelRequest>;
export const SetFacesLabelRequest = z.object({
  faceIds: z.array(z.number()),
  personName: z.string(),
});

export type SetFacesLabelResponse = z.infer<typeof SetFacesLabelResponse>;
export const SetFacesLabelResponse = z.object({
  status: z.boolean(),
  results: PersonFaceList,
  updated: PersonFaceList,
  not_updated: PersonFaceList,
});

export type DeleteFacesRequest = z.infer<typeof DeleteFacesRequest>;
export const DeleteFacesRequest = z.object({
  faceIds: z.array(z.number()),
});

export type DeleteFacesResponse = z.infer<typeof DeleteFacesResponse>;
// To-Do: Should be siilar to SetFacesLabelResponse
export const DeleteFacesResponse = z.object({
  status: z.boolean(),
  results: z.array(z.string()),
  deleted: z.array(z.string()),
  not_deleted: z.array(z.string()),
});

export type TrainFacesResponse = z.infer<typeof TrainFacesResponse>;
export const TrainFacesResponse = z.object({
  status: z.boolean(),
  // To-Do: Why is it not a number?!?!
  job_id: z.string().optional(),
});

export type ScanFacesResponse = z.infer<typeof ScanFacesResponse>;
export const ScanFacesResponse = z.object({
  status: z.boolean(),
  // To-Do: Why is it not a number?!?!
  job_id: z.string().optional(),
});

export const DataPoint = z.object({
  x: z.number(),
  y: z.number(),
  size: z.number(),
});

export const ClusterFaceDatapoint = z.object({
  person_id: z.number(),
  person_name: z.string(),
  // To-Do: Why ?
  person_label_is_inferred: z.boolean().nullable(),
  color: z.string(),
  face_url: z.string(),
  value: DataPoint,
});

export const ClusterFaces = z.array(ClusterFaceDatapoint);

export type ClusterFacesResponse = z.infer<typeof ClusterFacesResponse>;
export const ClusterFacesResponse = z.object({
  status: z.boolean(),
  data: ClusterFaces,
});

export const InferredFaces = FaceList;
