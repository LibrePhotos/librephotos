import { createFileRoute } from "@tanstack/react-router";
import { duplicateDetail } from "~/features/stats_admin_stacks_dupes/dupes";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/duplicates/$id/")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, params }) => duplicateDetail(user.id, params.id)),
    },
  },
});
