import { createFileRoute } from "@tanstack/react-router";
import { resolveDuplicate } from "~/features/stats_admin_stacks_dupes/dupes";
import { endpoint, jsonBody } from "~/lib/http";

export const Route = createFileRoute("/api/duplicates/$id/resolve")({
  server: {
    handlers: {
      POST: endpoint("user", async ({ user, params, request }) => resolveDuplicate(user.id, params.id, await jsonBody(request))),
    },
  },
});
