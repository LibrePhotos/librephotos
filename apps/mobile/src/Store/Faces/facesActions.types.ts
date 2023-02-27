import { z } from 'zod'

export type IFacesState = {
  labeledFacesList: ICompletePersonFaceList
  inferredFacesList: ICompletePersonFaceList
  facesVis: any[]
  training: boolean
  trained: boolean
  clustering: boolean
  clustered: boolean
  orderBy: IFacesOrderOption
  error: any
  activeTab: IFacesTab
  tabs: ITabSettingsArray
}

export const FacesTab = z.enum(['labeled', 'inferred'])
export type IFacesTab = z.infer<typeof FacesTab>

export const TabSettings = z.object({
  scrollPosition: z.number(),
})
export type ITabSettings = z.infer<typeof TabSettings>
export const TabSettingsArray = z.record(FacesTab, TabSettings)
export type ITabSettingsArray = z.infer<typeof TabSettingsArray>

export const FacesOrderOption = z.enum(['confidence', 'date'])
export type IFacesOrderOption = z.infer<typeof FacesOrderOption>

export const IncompletePersonFace = z.object({
  id: z.number(),
  name: z.string(),
  kind: z.string(),
  face_count: z.number(),
})

export const IncompletePersonFaceList = z.array(IncompletePersonFace)
export const IncompletePersonFaceListResponse = IncompletePersonFaceList
export type IIncompletePersonFaceListResponse = z.infer<
  typeof IncompletePersonFaceListResponse
>
export const IncompletePersonFaceListRequest = z.object({
  inferred: z.boolean(),
})
export type IIncompletePersonFaceListRequest = z.infer<
  typeof IncompletePersonFaceListRequest
>

export const PersonFace = z.object({
  id: z.number(),
  image: z.string().nullable(),
  face_url: z.string().nullable(),
  photo: z.string(),
  person_label_probability: z.number(),
  isTemp: z.boolean().optional(),
  person: z.number().optional(),
  person_name: z.string().optional(),
  timestamp: z.string().optional(),
})
export type IPersonFace = z.infer<typeof PersonFace>

export const PersonFaceListResponse = z.object({
  data: z.object({
    results: z.array(PersonFace),
  }),
})
export type IPersonFaceListResponse = z.infer<typeof CompletePersonFace>
export const PersonFaceListRequest = z.object({
  person: z.number(),
  page: z.number(),
  inferred: z.boolean(),
  orderBy: FacesOrderOption,
})
export type IPersonFaceListRequest = z.infer<typeof PersonFaceListRequest>

export const PersonFaceList = z.array(PersonFace)

export const CompletePersonFace = z.object({
  id: z.number(),
  name: z.string(),
  kind: z.string(),
  face_count: z.number(),
  faces: PersonFaceList,
})
export type ICompletePersonFace = z.infer<typeof CompletePersonFace>
export const CompletePersonFaceList = z.array(CompletePersonFace)
export type ICompletePersonFaceList = z.infer<typeof CompletePersonFaceList>

export const Face = z.object({
  id: z.number(),
  image: z.string().nullable(),
  photo: z.string().nullable(),
  person: z.number(),
  person_label_probability: z.number(),
  person_name: z.string(),
})

export const FaceList = z.array(Face)

export type INotThisPersonRequest = z.infer<typeof NotThisPersonRequest>
export const NotThisPersonRequest = z.object({
  faceIds: z.array(z.number()),
})

export type ISetFacesLabelRequest = z.infer<typeof SetFacesLabelRequest>
export const SetFacesLabelRequest = z.object({
  faceIds: z.array(z.number()),
  personName: z.string(),
})

export type ISetFacesLabelResponse = z.infer<typeof SetFacesLabelResponse>
export const SetFacesLabelResponse = z.object({
  status: z.boolean(),
  results: PersonFaceList,
  updated: PersonFaceList,
  not_updated: PersonFaceList,
})

export type IDeleteFacesRequest = z.infer<typeof DeleteFacesRequest>
export const DeleteFacesRequest = z.object({
  faceIds: z.array(z.number()),
})

export type IDeleteFacesResponse = z.infer<typeof DeleteFacesResponse>
// To-Do: Should be siilar to SetFacesLabelResponse
export const DeleteFacesResponse = z.object({
  status: z.boolean(),
  results: z.array(z.string()),
  deleted: z.array(z.string()),
  not_deleted: z.array(z.string()),
})

export type ITrainFacesResponse = z.infer<typeof TrainFacesResponse>
export const TrainFacesResponse = z.object({
  status: z.boolean(),
  // To-Do: Why is it not a number?!?!
  job_id: z.string().optional(),
})

export type IScanFacesResponse = z.infer<typeof ScanFacesResponse>
export const ScanFacesResponse = z.object({
  status: z.boolean(),
  // To-Do: Why is it not a number?!?!
  job_id: z.string().optional(),
})

export const DataPoint = z.object({
  x: z.number(),
  y: z.number(),
  size: z.number(),
})

export const ClusterFaceDatapoint = z.object({
  person_id: z.number(),
  person_name: z.string(),
  // To-Do: Why ?
  person_label_is_inferred: z.boolean().nullable(),
  color: z.string(),
  face_url: z.string(),
  value: DataPoint,
})

export const ClusterFaces = z.array(ClusterFaceDatapoint)

export type IClusterFacesResponse = z.infer<typeof ClusterFacesResponse>
export const ClusterFacesResponse = z.object({
  status: z.boolean(),
  data: ClusterFaces,
})

export const InferredFaces = FaceList
