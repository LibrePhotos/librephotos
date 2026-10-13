import { authKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { getAuthCookie } from "../../authCookies";

const hasAccessCookie = () => !!getAuthCookie("access");

/**
 * Whether the user is signed in: a synchronous cookie read. It is also the initial data, so the
 * first render already has the answer and the protected layout never shows a loading state (#2238).
 * The query stays so that the login can set the answer (`setQueryData`) and a refetch re-reads it.
 */
export const useIsAuthenticatedQuery = () =>
  useQuery({
    queryKey: authKeys.isAuthenticated(),
    queryFn: hasAccessCookie,
    initialData: hasAccessCookie,
  });
