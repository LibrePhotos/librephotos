import { createFileRoute } from "@tanstack/react-router";
import { oidcLogin } from "~/features/users_settings/oidc";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/accounts/oidc/$id/login/")({
  server: {
    handlers: {
      GET: endpoint("none", ({ params, request }) => oidcLogin(params.id, request)),
    },
  },
});
