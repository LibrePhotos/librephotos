import { createFileRoute } from "@tanstack/react-router";
import { serverLogs } from "~/features/stats_admin_stacks_dupes/server";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/serverlogs/")({
  server: {
    handlers: {
      GET: endpoint("admin", () => serverLogs()),
    },
  },
});
