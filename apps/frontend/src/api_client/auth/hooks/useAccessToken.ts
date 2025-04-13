import { useQuery } from '@tanstack/react-query';
import { fetchClient } from '../../api';
import { z } from 'zod';
import { Cookies } from 'react-cookie';
import jwtDecode from 'jwt-decode';
import { Token } from '..';

export const AuthResponse = z.object({
  access: z.object({
    user_id: z.string(),
    name: z.string(),
    is_admin: z.boolean(),
  }),
});

export const AuthQueryKeys = ['auth'] as const;

export const useAccessToken = () => {
  return useQuery({
    queryKey: AuthQueryKeys,
    queryFn: async () => {
      const cookies = new Cookies();
      const accessToken = cookies.get('access');
      
      if (!accessToken) {
        return { access: null };
      }
      const decodedToken = jwtDecode<Token>(accessToken);
      return { access: decodedToken };
    },
  });
}; 