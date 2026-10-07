import { createFileRoute } from "@tanstack/react-router";
import { photoMonthCounts } from "~/features/stats_admin_stacks_dupes/stats";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/photomonthcounts")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user }) => photoMonthCounts(user.id)),
    },
  },
});
