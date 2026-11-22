import { authKeys, decodeJwtClaims, userIdFromAccessToken } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import type { Token } from "..";
import { getAuthCookie } from "../../authCookies";

export function accessTokenClaims(accessToken: string): Token | null {
  const claims = decodeJwtClaims(accessToken);
  if (!claims) return null;
  const userId = userIdFromAccessToken(accessToken);
  return {
    user_id: userId === null ? "" : String(userId),
    name: typeof claims.name === "string" ? claims.name : "",
    is_admin: claims.is_admin === true,
  };
}

export const useAccessToken = () =>
  useQuery({
    queryKey: authKeys.accessToken(),
    queryFn: () => {
      const accessToken = getAuthCookie("access");
      return { access: accessToken ? accessTokenClaims(accessToken) : null };
    },
  });
