import { useMutation } from '@tanstack/react-query';
import { fetchClient } from '../../api';
import { Cookies } from 'react-cookie';


const logout =  () => {
  const cookies = new Cookies();
  return fetchClient.post('/auth/token/blacklist/', { refresh: cookies.get('refresh') });
};


export const useLogoutMutation = () => {
  return useMutation({
    mutationFn: logout,
  });
}; 