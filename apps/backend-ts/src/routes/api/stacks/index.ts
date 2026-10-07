import { createFileRoute } from "@tanstack/react-router";
import { listStacks } from "~/features/stats_admin_stacks_dupes/stacks";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/stacks/")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, query }) => listStacks(user.id, query)),
    },
  },
});
