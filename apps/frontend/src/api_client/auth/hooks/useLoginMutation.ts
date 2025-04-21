import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchClient } from '../../api';
import { Cookies } from 'react-cookie';
import { z} from "zod";
import { useNavigate } from '@tanstack/react-router'; 
export const LoginPost = z.object({
  username: z.string(),
  password: z.string(),
});

export type LoginPost = z.infer<typeof LoginPost>;

export const LoginResponse = z.object({
  refresh: z.string(),
  access: z.string(),
});

export type LoginResponse = z.infer<typeof LoginResponse>;

const login =  (credentials: LoginPost) => 
  fetchClient.post<LoginResponse>('/auth/token/obtain/', credentials)
    .then(response => {
      const data = LoginResponse.parse(response);
      const cookies = new Cookies();
      cookies.set('access', data.access);
      cookies.set('refresh', data.refresh);
      return data;
    })

export const useLoginMutation = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: login,
    onSuccess: () => {
      queryClient.invalidateQueries();
      navigate({to: "/"});
    },
  });
}; 