import { useMutation } from '@tanstack/react-query';
import { fetchClient } from '../../api';
import { Cookies } from 'react-cookie';
import { useNavigate } from 'react-router-dom'; 

const logout =  () => {
  const cookies = new Cookies();
  return fetchClient.post('/auth/token/blacklist/', { refresh: cookies.get('refresh') });
};


export const useLogoutMutation = () => {
  const navigate = useNavigate();


  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      const cookies = new Cookies();
      cookies.remove('access');
      cookies.remove('refresh');
      cookies.remove('jwt');
      navigate("/login");
    },
  });
}; 