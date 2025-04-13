import { useMutation,useQueryClient } from '@tanstack/react-query';
import { queryClient, fetchClient } from '../../api';
import { CompletePersonFaceList } from '../types';
import { QueryKeys as IncompleteFacesQueryKeys } from './useFetchIncompleteFacesQuery';
import { z } from 'zod';

const QueryKeys = ["deleteFaces"];

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

const deleteFaces = (data: DeleteFacesRequest) => 
    fetchClient.post<DeleteFacesResponse>('/deletefaces', { face_ids: data.faceIds })
      .then(response => DeleteFacesResponse.parse(response));

export const useDeleteFacesMutation = () => useMutation(
    {   
        mutationKey: QueryKeys,
        mutationFn: deleteFaces,
        onMutate: async (variables) => {
            // Get the current query client
      const queryClient = useQueryClient();
      
      // Cancel any outgoing refetches for incompleteFaces
      await queryClient.cancelQueries({ queryKey: IncompleteFacesQueryKeys });
      
      // Snapshot the previous value
      const previousIncompleteFaces = queryClient.getQueryData<CompletePersonFaceList>([IncompleteFacesQueryKeys]);
      
      // Optimistically update the cache
      queryClient.setQueryData<CompletePersonFaceList>([IncompleteFacesQueryKeys], old => {
        if (!old) return old;
        
        return old.map(personGroup => ({
          ...personGroup,
          faces: personGroup.faces.filter(face => !variables.faceIds.includes(face.id)),
          face_count: personGroup.faces.filter(face => !variables.faceIds.includes(face.id)).length
        })).filter(personGroup => personGroup.faces.length > 0);
      });
      
      return { previousIncompleteFaces };
    },
    
    onError: (_err, _variables, context) => {
      if (context?.previousIncompleteFaces) {
        queryClient.setQueryData<CompletePersonFaceList>([IncompleteFacesQueryKeys], context.previousIncompleteFaces);
      }
    }
  }
);