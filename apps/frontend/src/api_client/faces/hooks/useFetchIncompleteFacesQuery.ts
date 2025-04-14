import { useQuery } from '@tanstack/react-query';
import { fetchClient } from '../../api';
import { CompletePersonFaceList, CompletePersonFace, FaceAnalysisMethod, FacesOrderOption, IncompletePersonFace} from '../types';
import { z } from 'zod';    

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


export const IncompleteFacesQueryKeys = ['incompleteFaces'] as const;

const fetchIncompleteFaces = (params: IncompletePersonFaceListRequest) => {
  const { inferred = false, method = 'clustering', orderBy = 'confidence', minConfidence } = params;
  const url = `/faces/incomplete/?inferred=${inferred}${
    `&order_by=${orderBy}`
  }${inferred ? `&analysis_method=${method}` : ''}${
    minConfidence ? `&min_confidence=${minConfidence}` : ''
  }`;
  
  return fetchClient.get<IncompletePersonFaceListResponse>(url)
    .then(response => {
      const payload = IncompletePersonFaceListResponse.parse(response);
      const newFacesList: CompletePersonFaceList = payload.map(person => {
        const completePersonFace: CompletePersonFace = { ...person, faces: [] };
        for (let i = 0; i < person.face_count; i += 1) {
          completePersonFace.faces.push({
            id: i,
            image: null,
            face_url: null,
            photo: '',
            person_label_probability: 1,
            person: person.id,
            isTemp: true,
          });
        }
        return completePersonFace;
      });
      return newFacesList;
    });
};

export const useFetchIncompleteFacesQuery = (request: IncompletePersonFaceListRequest) => useQuery({
    queryKey: [...IncompleteFacesQueryKeys, request],
    queryFn: () => fetchIncompleteFaces(request),
});