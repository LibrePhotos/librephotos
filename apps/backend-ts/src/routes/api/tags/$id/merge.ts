import { createFileRoute } from "@tanstack/react-router";
import { merge } from "~/features/albums_tags/tags";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/tags/$id/merge")({
  server: {
    handlers: {
      POST: endpoint("user", ({ user, params, request }) => merge(user, params.id, request)),
    },
  },
});
