import { createFileRoute } from "@tanstack/react-router";
import { serverStats } from "~/features/stats_admin_stacks_dupes/server";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/serverstats")({
  server: {
    handlers: {
      GET: endpoint("admin", () => serverStats()),
    },
  },
});
