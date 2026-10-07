import { createFileRoute } from "@tanstack/react-router";
import { listServices } from "~/features/stats_admin_stacks_dupes/services";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/services/")({
  server: {
    handlers: {
      GET: endpoint("admin", () => listServices()),
    },
  },
});
