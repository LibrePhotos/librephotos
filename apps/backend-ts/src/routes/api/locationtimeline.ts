import { createFileRoute } from "@tanstack/react-router";
import { locationTimeline } from "~/features/stats_admin_stacks_dupes/stats";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/locationtimeline")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user }) => locationTimeline(user.id)),
    },
  },
});
