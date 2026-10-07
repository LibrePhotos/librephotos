import { createFileRoute } from "@tanstack/react-router";
import { getEmailConfig, postEmailConfig } from "~/features/users_settings/email";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/email-config/")({
  server: {
    handlers: {
      GET: endpoint("admin", () => getEmailConfig()),
      POST: endpoint("admin", ({ request }) => postEmailConfig(request)),
    },
  },
});
