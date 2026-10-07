import { createFileRoute } from "@tanstack/react-router";
import { oidcCallback } from "~/features/users_settings/oidc";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/accounts/oidc/$id/login/callback")({
  server: {
    handlers: {
      GET: endpoint("none", ({ params, request, query }) => oidcCallback(params.id, request, query)),
    },
  },
});
