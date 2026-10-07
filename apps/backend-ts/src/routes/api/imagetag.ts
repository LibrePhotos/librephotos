import { createFileRoute } from "@tanstack/react-router";
import { imageTag } from "~/features/stats_admin_stacks_dupes/server";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/imagetag")({
  server: {
    handlers: {
      GET: endpoint("user", () => imageTag()),
    },
  },
});
