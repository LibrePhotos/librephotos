import { useMutation } from '@tanstack/react-query';
import { queryClient } from '../../api';
import { fetchClient } from '../../api';
import { PersonFaceList } from '../types';
import { z} from "zod";
import { notification } from "../../../service/notifications";
import { FacesQueryKeys } from './useFetchFacesQuery';
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

const setFacesPersonLabel = (data: SetFacesLabelRequest) => 
    fetchClient.post<SetFacesLabelResponse>('/labelfaces', { 
      person_name: data.personName, 
      face_ids: data.faceIds 
    }).then(response => {
      const payload = SetFacesLabelResponse.parse(response);
      notification.addFacesToPerson(payload.results[0].person_name ?? 'unknown', payload.results.length);
      return payload;
    });

export const useSetFacesPersonLabelMutation = () => useMutation({
    mutationFn: setFacesPersonLabel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FacesQueryKeys });
    }
  });
  