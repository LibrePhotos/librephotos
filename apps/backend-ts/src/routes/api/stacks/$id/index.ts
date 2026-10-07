import { createFileRoute } from "@tanstack/react-router";
import { deleteStack, stackDetail } from "~/features/stats_admin_stacks_dupes/stacks";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/stacks/$id/")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, params }) => stackDetail(user.id, params.id)),
      DELETE: endpoint("user", ({ user, params }) => deleteStack(user.id, params.id)),
    },
  },
});
