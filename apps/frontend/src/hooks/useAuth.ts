import { useAccessToken } from "../api_client/auth/hooks";

export function useAuth() {
  const { data: auth } = useAccessToken();

  return {
    isAuthenticated: !!auth?.access,
    userId: auth?.access?.user_id ? parseInt(auth.access.user_id, 10) : null,
  };
}
