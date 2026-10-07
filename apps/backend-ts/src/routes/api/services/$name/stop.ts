import { createFileRoute } from "@tanstack/react-router";
import { stopService } from "~/features/stats_admin_stacks_dupes/services";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/services/$name/stop")({
  server: {
    handlers: {
      POST: endpoint("admin", ({ params }) => stopService(params.name)),
    },
  },
});
