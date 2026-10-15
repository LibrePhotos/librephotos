import { authKeys, endpoints, type LoginPost } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { apiClient } from "../../api";
import { setAuthCookie } from "../../authCookies";
import { mutationErrorMeta } from "../../mutationErrors";

const login = async (credentials: LoginPost) => {
  const data = await endpoints.login(apiClient, credentials);
  setAuthCookie("access", data.access);
  setAuthCookie("refresh", data.refresh);
  return data;
};

type UseLoginOptions = {
  navigateOnSuccess?: boolean;
  /**
   * Where to go after signing in: the page that sent the visitor to /login.
   * Anything but a path on this origin is ignored. Defaults to the timeline.
   */
  redirectTo?: string;
};

/**
 * The router does a full page load to any href that parses as a URL, so an
 * unchecked redirect target would forward the visitor to another site. The
 * login route checks it already; this keeps the next caller safe as well.
 */
function isSameOriginPath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return false;
  }
  try {
    return new URL(value, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

export const useLoginMutation = (options?: UseLoginOptions) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const navigateOnSuccess = options?.navigateOnSuccess ?? true;

  return useMutation({
    mutationFn: login,
    onSuccess: () => {
      // The cookies are set now. A "logged out" answer cached earlier in this
      // tab (sign-up, for one, never observes the query) would otherwise bounce
      // the protected shell back to /login until its refetch lands.
      queryClient.setQueryData(authKeys.isAuthenticated(), true);
      queryClient.invalidateQueries();
      if (navigateOnSuccess && options?.redirectTo && isSameOriginPath(options.redirectTo)) {
        // As an href, so the query string of the page left behind survives
        // (`to` takes a route path only).
        navigate({ href: options.redirectTo });
      } else if (navigateOnSuccess) {
        navigate({ to: "/" });
      }
    },
    // No "could not save" toast: wrong credentials are reported by api.ts (401), and a backend that is
    // down or still starting gets BackendStatusGate's screen (#2310), which replaced the old
    // "try again in a few minutes" toast.
    meta: mutationErrorMeta({ reportsErrors: true }),
  });
};
