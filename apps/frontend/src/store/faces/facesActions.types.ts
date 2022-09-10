import { z } from "zod";

export type IFacesState = {
  labeledFacesList: ICompletePersonFaceList[];
  inferredFacesList: ICompletePersonFaceList[];
  facesVis: any[];
  training: boolean;
  trained: boolean;
  clustering: boolean;
  clustered: boolean;
  error: any;
};

export const IncompletePersonFace = z.object({
  id: z.number(),
  name: z.string(),
  kind: z.string(),
  face_count: z.number(),
});

export const IncompletePersonFaceList = z.array(IncompletePersonFace);
export type IIncompletePersonFaceListResponse = z.infer<typeof IncompletePersonFaceListResponse>;
export type IIncompletePersonFaceListRequest = z.infer<typeof IncompletePersonFaceListRequest>;
export const IncompletePersonFaceListResponse = IncompletePersonFaceList;
export const IncompletePersonFaceListRequest = z.object({
  inferred: z.boolean(),
});

export const PersonFace = z.object({
  id: z.number(),
  image: z.string().nullable(),
  face_url: z.string().nullable(),
  photo: z.string(),
  person_label_probability: z.number(),
  isTemp: z.boolean().optional(),
  person: z.number().optional(),
});

export const PersonFaceListResponse = z.object({
  data: z.object({
    results: z.array(PersonFace),
  }),
});
export type IPersonFaceListResponse = z.infer<typeof CompletePersonFace>;
export const PersonFaceListRequest = z.object({
  person: z.number(),
  page: z.number(),
  inferred: z.boolean(),
});
export type IPersonFaceListRequest = z.infer<typeof PersonFaceListRequest>;

export const PersonFaceList = z.array(PersonFace);

export const CompletePersonFace = z.object({
  id: z.number(),
  name: z.string(),
  kind: z.string(),
  face_count: z.number(),
  faces: PersonFaceList,
});
export type ICompletePersonFace = z.infer<typeof CompletePersonFace>;
export const CompletePersonFaceList = z.array(CompletePersonFace);
export type ICompletePersonFaceList = z.infer<typeof CompletePersonFaceList>;

export const Face = z.object({
  id: z.number(),
  image: z.string().nullable(),
  photo: z.string().nullable(),
  person: z.number(),
  person_label_probability: z.number(),
  person_name: z.string(),
});

export const FaceList = z.array(Face);

export const SetFacesLabelResponse = z.object({
  status: z.boolean(),
  results: FaceList,
  updated: FaceList,
  not_updated: FaceList,
});

// To-Do: Should be siilar to SetFacesLabelResponse
export const DeleteFacesResponse = z.object({
  status: z.boolean(),
  results: z.array(z.string()),
  deleted: z.array(z.string()),
  not_deleted: z.array(z.string()),
});

export const TrainFacesResponse = z.object({
  status: z.boolean(),
  // To-Do: Why is it not a number?!?!
  job_id: z.string().optional(),
});

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

export const InferredFaces = FaceList;
