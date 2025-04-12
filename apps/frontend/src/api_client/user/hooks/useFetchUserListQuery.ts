import { useQuery } from '@tanstack/react-query';
import { fetchClient } from '../../api';
import type { UserList } from '../types';
import { UserSchema } from '../types';
import { z } from 'zod';


export const QueryKeys = ["userList"]

export const ApiUserListResponseSchema = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(UserSchema),
});
// User List Query
export const useFetchUserListQuery = () => 
  useQuery<UserList>({
    queryKey: QueryKeys,
    queryFn: async () => {
      const response = await fetchClient.get<UserList>('/user/');
      return ApiUserListResponseSchema.parse(response).results;
    }
  });

