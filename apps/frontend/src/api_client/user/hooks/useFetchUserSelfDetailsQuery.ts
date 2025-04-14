import { useQuery } from '@tanstack/react-query';
import { fetchClient } from '../../api';
import { User } from '../types';

export const UserSelfDetailsQueryKeys = ['userSelfDetails'] as const;

// User Self Details Query
export const useFetchUserSelfDetailsQuery = (userId: string) => 
  useQuery<User>({
    queryKey: [...UserSelfDetailsQueryKeys, userId],
    queryFn: async () => {
      const response = await fetchClient.get<User>(`/user/${userId}/`);
      return User.parse(response);
    },
    enabled: !!userId
  });