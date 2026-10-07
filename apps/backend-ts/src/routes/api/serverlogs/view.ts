import { createFileRoute } from "@tanstack/react-router";
import { serverLogsView } from "~/features/stats_admin_stacks_dupes/server";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/serverlogs/view")({
  server: {
    handlers: {
      GET: endpoint("admin", ({ query }) => serverLogsView(query)),
    },
  },
});
