import { createFileRoute } from "@tanstack/react-router";
import { duplicateStats } from "~/features/stats_admin_stacks_dupes/dupes";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/duplicates/stats")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user }) => duplicateStats(user.id)),
    },
  },
});
