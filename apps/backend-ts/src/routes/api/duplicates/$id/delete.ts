import { createFileRoute } from "@tanstack/react-router";
import { deleteDuplicate } from "~/features/stats_admin_stacks_dupes/dupes";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/duplicates/$id/delete")({
  server: {
    handlers: {
      DELETE: endpoint("user", ({ user, params }) => deleteDuplicate(user.id, params.id)),
    },
  },
});
