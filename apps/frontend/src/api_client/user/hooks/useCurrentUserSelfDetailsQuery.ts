import { useAccessToken } from '../../auth/hooks';
import { useFetchUserSelfDetailsQuery } from './useFetchUserSelfDetailsQuery';

export const useCurrentUserSelfDetailsQuery = () => {
  const { data: auth } = useAccessToken();
  return useFetchUserSelfDetailsQuery(auth?.access?.user_id?.toString() ?? '');;
};
