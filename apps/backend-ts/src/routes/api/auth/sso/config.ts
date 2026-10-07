import { createFileRoute } from "@tanstack/react-router";
import { ssoConfig } from "~/features/users_settings/oidc";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/auth/sso/config")({
  server: {
    handlers: {
      GET: endpoint("none", () => ssoConfig()),
    },
  },
});
