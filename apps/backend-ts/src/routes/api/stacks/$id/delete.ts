import { createFileRoute } from "@tanstack/react-router";
import { deleteStack } from "~/features/stats_admin_stacks_dupes/stacks";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/stacks/$id/delete")({
  server: {
    handlers: {
      DELETE: endpoint("user", ({ user, params }) => deleteStack(user.id, params.id)),
    },
  },
});
