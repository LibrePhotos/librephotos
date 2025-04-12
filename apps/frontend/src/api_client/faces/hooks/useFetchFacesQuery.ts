import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchClient } from '../../api';
import {  CompletePersonFaceList, PersonFace, FaceAnalysisMethod, FacesOrderOption, CompletePersonFace } from '../types';
import { QueryKeys as IncompleteFacesQueryKeys, IncompletePersonFaceListRequest } from './useFetchIncompleteFacesQuery';
import { z } from "zod"


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
  

const fetchFaces = (params: PersonFaceListRequest) => {
    const { person, page = 0, inferred = false, orderBy = 'confidence', method, minConfidence } = params;
    const url = `/faces/?person=${person}&page=${page}&inferred=${inferred}&order_by=${orderBy}${
      method ? `&analysis_method=${method}` : ''
    }${minConfidence ? `&min_confidence=${minConfidence}` : ''}`;
    
    return fetchClient.get(url)
      .then(response => {
        const parsedResponse = PersonFaceListResponse.parse(response);
        return parsedResponse.results;
      });
  };

export const QueryKeys = ["faces"];

export const useFetchFacesQuery = (params: PersonFaceListRequest) => {
  return useQuery({
    queryKey: [QueryKeys, params],
    queryFn: () => fetchFaces(params),
    enabled: !!params,
    onSettled: (data) => {
        // Update incompleteFaces cache when fetching faces
        const queryClient = useQueryClient();
        const incompleteParams: IncompletePersonFaceListRequest = {
          method: params.method,
          orderBy: params.orderBy,
          inferred: params.inferred,
          minConfidence: params.minConfidence,
        };
  
        const incompleteData = queryClient.getQueryData<CompletePersonFaceList>(
          [...IncompleteFacesQueryKeys, incompleteParams]
        );
  
        if (incompleteData) {
          queryClient.setQueryData<CompletePersonFaceList>(
            [...IncompleteFacesQueryKeys, incompleteParams], 
            draft => {
              if (!draft) return draft;
              const indexToReplace = draft.findIndex(group => group.id === params[0].person);
              if (indexToReplace === -1) return draft;
  
              const groupToChange = draft[indexToReplace];
              const { faces } = groupToChange;
              const newFaces = [
                ...faces.slice(0, (params[0].page - 1) * 100),
                ...data,
                ...faces.slice(params[0].page * 100)
              ];
              
              const updatedGroup = { ...groupToChange, faces: newFaces };
              
              return [
                ...draft.slice(0, indexToReplace),
                updatedGroup,
                ...draft.slice(indexToReplace + 1)
              ];
            }
          );
        }
      }
    });
}; 