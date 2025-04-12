import { fetchClient } from "../../api";

import { useQuery } from "@tanstack/react-query";

export const QueryKeys = ["isAuthenticated"]

export const useIsAuthenticatedQuery = () => useQuery({
    queryKey: QueryKeys,
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