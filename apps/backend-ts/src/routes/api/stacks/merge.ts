import { createFileRoute } from "@tanstack/react-router";
import { mergeStacks } from "~/features/stats_admin_stacks_dupes/stacks";
import { endpoint, jsonBody } from "~/lib/http";

export const Route = createFileRoute("/api/stacks/merge")({
  server: {
    handlers: {
      POST: endpoint("user", async ({ user, request }) => mergeStacks(user.id, await jsonBody(request))),
    },
  },
});
