import { createFileRoute } from "@tanstack/react-router";
import { countStats } from "~/features/stats_admin_stacks_dupes/stats";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/stats")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user }) => countStats(user.id)),
    },
  },
});
