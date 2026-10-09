import { useQuery } from "@tanstack/react-query";
import { jwtDecode } from "jwt-decode";
import { z } from "zod";
import { Token } from "..";
import { getAuthCookie } from "../../authCookies";

export const AuthResponse = z.object({
  access: z.object({
    user_id: z.string(),
    name: z.string(),
    is_admin: z.boolean(),
  }),
});

export const AuthQueryKeys = ["auth"] as const;

export const useAccessToken = () =>
  useQuery({
    queryKey: AuthQueryKeys,
    queryFn: async () => {
      const accessToken = getAuthCookie("access");

      if (!accessToken) {
        return { access: null };
      }
      const decodedToken = jwtDecode<Token>(accessToken);
      return { access: decodedToken };
    },
  });
