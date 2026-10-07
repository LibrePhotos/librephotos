import { createFileRoute } from "@tanstack/react-router";
import { storageStats } from "~/features/stats_admin_stacks_dupes/server";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/storagestats")({
  server: {
    handlers: {
      GET: endpoint("user", () => storageStats()),
    },
  },
});
