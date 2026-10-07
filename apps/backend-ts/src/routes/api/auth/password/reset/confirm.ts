import { createFileRoute } from "@tanstack/react-router";
import { confirmReset } from "~/features/users_settings/password_reset";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/auth/password/reset/confirm")({
  server: {
    handlers: {
      POST: endpoint("optional", ({ request }) => confirmReset(request)),
    },
  },
});
