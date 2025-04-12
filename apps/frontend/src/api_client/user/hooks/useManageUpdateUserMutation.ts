import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchClient } from '../../api';
import { QueryKeys } from '../../api';
import { ManageUser } from '../types';



// Manage Update User Mutation
export const useManageUpdateUserMutation = () => {
  const queryClient = useQueryClient();
  
  return useMutation({  
    mutationFn: async (data: ManageUser) => {
      const response = await fetchClient.patch<ManageUser>(`/manage/user/${data.id}/`, data);
      return ManageUser.parse(response);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QueryKeys.userList] });
    }
  });
};
