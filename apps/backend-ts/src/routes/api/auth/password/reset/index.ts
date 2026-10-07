import { createFileRoute } from "@tanstack/react-router";
import { requestReset } from "~/features/users_settings/password_reset";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/auth/password/reset/")({
  server: {
    handlers: {
      POST: endpoint("optional", ({ user, request }) => requestReset(user, request)),
    },
  },
});
