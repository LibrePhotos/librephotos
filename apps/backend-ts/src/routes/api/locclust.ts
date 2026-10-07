import { createFileRoute } from "@tanstack/react-router";
import { locationClusters } from "~/features/albums_tags/misc";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/locclust")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user }) => locationClusters(user)),
    },
  },
});
