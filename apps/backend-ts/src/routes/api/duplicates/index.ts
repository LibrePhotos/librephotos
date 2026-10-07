import { createFileRoute } from "@tanstack/react-router";
import { listDuplicates } from "~/features/stats_admin_stacks_dupes/dupes";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/duplicates/")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, query }) => listDuplicates(user.id, query)),
    },
  },
});
