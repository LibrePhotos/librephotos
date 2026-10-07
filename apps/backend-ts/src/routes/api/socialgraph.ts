import { createFileRoute } from "@tanstack/react-router";
import { socialGraphView } from "~/features/stats_admin_stacks_dupes/stats";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/socialgraph")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user }) => socialGraphView(user.id)),
    },
  },
});
