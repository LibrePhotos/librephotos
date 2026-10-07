import { createFileRoute } from "@tanstack/react-router";
import { serviceStatus } from "~/features/stats_admin_stacks_dupes/services";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/services/$name/")({
  server: {
    handlers: {
      GET: endpoint("admin", ({ params }) => serviceStatus(params.name)),
    },
  },
});
