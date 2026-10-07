import { createFileRoute } from "@tanstack/react-router";
import { testEmail } from "~/features/users_settings/email";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/email-config/test")({
  server: {
    handlers: {
      POST: endpoint("admin", ({ user, request }) => testEmail(user, request)),
    },
  },
});
