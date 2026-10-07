import { createFileRoute } from "@tanstack/react-router";
import { addToStack } from "~/features/stats_admin_stacks_dupes/stacks";
import { endpoint, jsonBody } from "~/lib/http";

export const Route = createFileRoute("/api/stacks/$id/add")({
  server: {
    handlers: {
      POST: endpoint("user", async ({ user, params, request }) => addToStack(user.id, params.id, await jsonBody(request))),
    },
  },
});
