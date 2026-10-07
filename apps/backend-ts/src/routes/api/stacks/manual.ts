import { createFileRoute } from "@tanstack/react-router";
import { manualStack } from "~/features/stats_admin_stacks_dupes/stacks";
import { endpoint, jsonBody } from "~/lib/http";

export const Route = createFileRoute("/api/stacks/manual")({
  server: {
    handlers: {
      POST: endpoint("user", async ({ user, request }) => manualStack(user.id, await jsonBody(request))),
    },
  },
});
