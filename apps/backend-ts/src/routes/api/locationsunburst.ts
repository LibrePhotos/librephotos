import { createFileRoute } from "@tanstack/react-router";
import { locationSunburstView } from "~/features/stats_admin_stacks_dupes/stats";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/locationsunburst")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user }) => locationSunburstView(user.id)),
    },
  },
});
