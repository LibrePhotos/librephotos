import { useQuery } from "@tanstack/react-query";
import { getAuthCookie } from "../../authCookies";
import { authKeys } from "../keys";

export const useIsAuthenticatedQuery = () =>
  useQuery({
    queryKey: authKeys.isAuthenticated(),
    queryFn: () => {
      const token = getAuthCookie("access");
      return !!token;
    },
  });
