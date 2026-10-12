import { useQuery } from "@tanstack/react-query";
import { jwtDecode } from "jwt-decode";
import type { Token } from "..";
import { getAuthCookie } from "../../authCookies";

const AuthQueryKeys = ["auth"] as const;

export const useAccessToken = () =>
  useQuery({
    queryKey: AuthQueryKeys,
    queryFn: () => {
      const accessToken = getAuthCookie("access");

      if (!accessToken) {
        return { access: null };
      }
      const decodedToken = jwtDecode<Token>(accessToken);
      return { access: decodedToken };
    },
  });
