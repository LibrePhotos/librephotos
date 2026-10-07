import { createFileRoute } from "@tanstack/react-router";
import { startService } from "~/features/stats_admin_stacks_dupes/services";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/services/$name/start")({
  server: {
    handlers: {
      POST: endpoint("admin", ({ params }) => startService(params.name)),
    },
  },
});
