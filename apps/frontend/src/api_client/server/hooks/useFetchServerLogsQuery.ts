import { useQuery } from '@tanstack/react-query';
import { Cookies } from 'react-cookie';

import { QueryKeys } from "../../api";

const API_BASE_URL = '/api';

export const useFetchServerLogsQuery = () => useQuery({
  queryKey: [QueryKeys.serverLogs],
  queryFn: async () => {
    const response = await fetch(`${API_BASE_URL}/serverlogs`, { 
      credentials: 'include',
      headers: {
        'Authorization': `Bearer ${new Cookies().get('access')}`
      }
    });
    return response.blob();
  },
}); 