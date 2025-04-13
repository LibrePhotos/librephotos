import { useQuery } from '@tanstack/react-query';
import { fetchClient } from '../../api';
import type { User } from '../types';
import { UserSchema } from '../types';


export const UserSelfDetailsQueryKeys = ["userSelfDetails"]
// User Self Details Query
export const useFetchUserSelfDetailsQuery = (userId: string) => 
  useQuery<User>({
    queryKey: [...UserSelfDetailsQueryKeys, userId],
    queryFn: async () => {
      const response = await fetchClient.get<User>(`/user/${userId}/`);
      return UserSchema.parse(response);
    },
    enabled: !!userId
  });