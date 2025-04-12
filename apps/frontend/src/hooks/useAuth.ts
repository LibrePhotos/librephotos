import { useIsAuthenticatedQuery } from '../api_client/auth';

export function useAuth() {
  const { data: isAuthenticated } = useIsAuthenticatedQuery();
  const userId = localStorage.getItem('user_id');
  const accessToken = localStorage.getItem('access_token');

  return {
    isAuthenticated: !!isAuthenticated,
    userId: userId ? parseInt(userId, 10) : null,
    accessToken,
  };
} 