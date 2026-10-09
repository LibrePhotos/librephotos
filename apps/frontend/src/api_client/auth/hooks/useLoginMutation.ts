import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { ApiError, fetchClient } from "../../api";
import { setAuthCookie } from "../../authCookies";
import { IsAuthenticatedQueryKeys } from "./useIsAuthenticatedQuery";

export const LoginPost = z.object({
  username: z.string(),
  password: z.string(),
});

export type LoginPost = z.infer<typeof LoginPost>;

export const LoginResponse = z.object({
  refresh: z.string(),
  access: z.string(),
});

export type LoginResponse = z.infer<typeof LoginResponse>;

const login = (credentials: LoginPost) =>
  fetchClient.post("/auth/token/obtain/", credentials).then(response => {
    const data = parseWithNotification(LoginResponse, response, "Failed to parse login response");
    setAuthCookie("access", data.access);
    setAuthCookie("refresh", data.refresh);
    return data;
  });

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

/**
 * True for a backend that is down or still starting: the request never got an
 * answer (fetch rejects with a TypeError), or the proxy answered for it. Wrong
 * credentials (401) and a 500 are already reported in api.ts.
 */
export function isBackendUnreachable(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  return error instanceof ApiError && error.status >= 502 && error.status <= 504;
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
      queryClient.setQueryData(IsAuthenticatedQueryKeys, true);
      queryClient.invalidateQueries();
      if (navigateOnSuccess && options?.redirectTo && isSameOriginPath(options.redirectTo)) {
        // As an href, so the query string of the page left behind survives
        // (`to` takes a route path only).
        navigate({ href: options.redirectTo });
      } else if (navigateOnSuccess) {
        navigate({ to: "/" });
      }
    },
    // Without this a login against a stopped backend did nothing visible.
    onError: error => {
      if (isBackendUnreachable(error)) {
        notification.backendUnreachable();
      }
    },
  });
};
