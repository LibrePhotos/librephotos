import { Cookies } from "react-cookie";
import { useQuery } from "@tanstack/react-query";

export const IsAuthenticatedQueryKeys = ["isAuthenticated"]

export const useIsAuthenticatedQuery = () => useQuery({
    queryKey: IsAuthenticatedQueryKeys,
    queryFn: () => {
      const cookies = new Cookies();
      const token = cookies.get('access');
      return !!token;
    },
  }); 