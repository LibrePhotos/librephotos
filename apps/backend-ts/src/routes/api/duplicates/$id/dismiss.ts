import { createFileRoute } from "@tanstack/react-router";
import { dismissDuplicate } from "~/features/stats_admin_stacks_dupes/dupes";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/duplicates/$id/dismiss")({
  server: {
    handlers: {
      POST: endpoint("user", ({ user, params }) => dismissDuplicate(user.id, params.id)),
    },
  },
});
