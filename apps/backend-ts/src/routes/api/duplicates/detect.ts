import { createFileRoute } from "@tanstack/react-router";
import { detectDuplicates } from "~/features/stats_admin_stacks_dupes/dupes";
import { endpoint, jsonBody } from "~/lib/http";

export const Route = createFileRoute("/api/duplicates/detect")({
  server: {
    handlers: {
      POST: endpoint("user", async ({ user, request }) => detectDuplicates(user.id, await jsonBody(request))),
    },
  },
});
