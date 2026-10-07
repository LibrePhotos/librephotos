import { createFileRoute } from "@tanstack/react-router";
import { setPrimary } from "~/features/stats_admin_stacks_dupes/stacks";
import { endpoint, jsonBody } from "~/lib/http";

export const Route = createFileRoute("/api/stacks/$id/primary")({
  server: {
    handlers: {
      POST: endpoint("user", async ({ user, params, request }) => setPrimary(user.id, params.id, await jsonBody(request))),
    },
  },
});
