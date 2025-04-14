import { useQuery } from '@tanstack/react-query';
import { fetchClient } from '../../api';
import type { UserList } from '../types';
import { User } from '../types';
import { z } from 'zod';

export const UserListQueryKeys = ['userList'] as const;

export const UserListResponse = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(User),
});
// User List Query
export const useFetchUserListQuery = () => 
  useQuery<UserList>({
    queryKey: UserListQueryKeys,
    queryFn: async () => {
      const response = await fetchClient.get<UserList>('/user/');
      return UserListResponse.parse(response).results;
    }
  });

