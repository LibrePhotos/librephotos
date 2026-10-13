import { authKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { jwtDecode } from "jwt-decode";
import type { Token } from "..";
import { getAuthCookie } from "../../authCookies";

export const useAccessToken = () =>
  useQuery({
    queryKey: authKeys.accessToken(),
    queryFn: () => {
      const accessToken = getAuthCookie("access");

      if (!accessToken) {
        return { access: null };
      }
      const decodedToken = jwtDecode<Token>(accessToken);
      return { access: decodedToken };
    },
  });
