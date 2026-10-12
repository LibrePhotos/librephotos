import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { authKeys } from "../keys";
import type { SsoConfig } from "../types";

/**
 * What the login screen needs to know about single sign-on: whether to offer it,
 * what to call the button, and where it points. Unauthenticated on purpose — the
 * login screen has to be able to ask before anyone is logged in.
 */
export const useSsoConfigQuery = () =>
  useQuery({
    queryKey: authKeys.ssoConfig(),
    queryFn: () => apiClient.get<SsoConfig>("/auth/sso/config/"),
    // Providers change only when an admin reconfigures them, and a failure here
    // must never keep the password form from rendering.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
