import { useQuery } from '@tanstack/react-query';
import { API } from '../../api';
import { QueryKeys } from '../../api';
import type { FetchUserListQueryResponse } from '../types';

export const useFetchUserListQuery = () => {
  return useQuery<FetchUserListQueryResponse>({
    queryKey: [QueryKeys.userList],
    queryFn: () => API.fetchUserList()
  });
}; 