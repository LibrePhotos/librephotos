import { createFileRoute } from "@tanstack/react-router";
import { stackStats } from "~/features/stats_admin_stacks_dupes/stacks";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/stacks/stats")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user }) => stackStats(user.id)),
    },
  },
});
