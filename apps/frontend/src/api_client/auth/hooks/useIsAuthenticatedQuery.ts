import { useQuery } from "@tanstack/react-query";
import { getAuthCookie } from "../../authCookies";

export const IsAuthenticatedQueryKeys = ["isAuthenticated"];

export const useIsAuthenticatedQuery = () =>
  useQuery({
    queryKey: IsAuthenticatedQueryKeys,
    queryFn: () => {
      const token = getAuthCookie("access");
      return !!token;
    },
  });
