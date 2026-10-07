import { createFileRoute } from "@tanstack/react-router";
import { detectStacks } from "~/features/stats_admin_stacks_dupes/stacks";
import { endpoint, jsonBody } from "~/lib/http";

export const Route = createFileRoute("/api/stacks/detect")({
  server: {
    handlers: {
      POST: endpoint("user", async ({ user, request }) => detectStacks(user.id, await jsonBody(request))),
    },
  },
});
