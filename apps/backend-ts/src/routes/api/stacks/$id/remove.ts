import { createFileRoute } from "@tanstack/react-router";
import { removeFromStack } from "~/features/stats_admin_stacks_dupes/stacks";
import { endpoint, jsonBody } from "~/lib/http";

export const Route = createFileRoute("/api/stacks/$id/remove")({
  server: {
    handlers: {
      POST: endpoint("user", async ({ user, params, request }) => removeFromStack(user.id, params.id, await jsonBody(request))),
    },
  },
});
