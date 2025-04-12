import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { fetchClient, queryClient, QueryKeys } from './api';
import { notification } from '../service/notifications';

// Add auth to QueryKeys
export const AuthQueryKeys = {
  auth: 'auth',
} as const;

const LoginResponseSchema = z.object({
  access: z.object({
    token: z.string(),
    user_id: z.number(),
  }),
  refresh: z.string(),
});

export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const useLoginMutation = () => useMutation({
  mutationFn: async ({ username, password }: { username: string; password: string }) => {
    const response = await fetchClient.post('/auth/token/obtain/', { username, password });
    return LoginResponseSchema.parse(response);
  },
  onSuccess: (data) => {
    // Store tokens in localStorage or cookies as needed
    localStorage.setItem('access_token', data.access.token);
    localStorage.setItem('refresh_token', data.refresh);
    localStorage.setItem('user_id', data.access.user_id.toString());
    notification.requestFailed('Login', 'Login successful');
  },
  onError: (error) => {
    notification.requestFailed('Login', error.message);
  },
});

export const useIsAuthenticatedQuery = () => useQuery({
  queryKey: [AuthQueryKeys.auth],
  queryFn: async () => {
    const token = localStorage.getItem('access_token');
    if (!token) return false;
    try {
      await fetchClient.get('/auth/token/verify/');
      return true;
    } catch {
      return false;
    }
  },
}); 