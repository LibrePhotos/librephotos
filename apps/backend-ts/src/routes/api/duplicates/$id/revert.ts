import { createFileRoute } from "@tanstack/react-router";
import { revertDuplicate } from "~/features/stats_admin_stacks_dupes/dupes";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/duplicates/$id/revert")({
  server: {
    handlers: {
      POST: endpoint("user", ({ user, params }) => revertDuplicate(user.id, params.id)),
    },
  },
});
