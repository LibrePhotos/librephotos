import { createFileRoute } from "@tanstack/react-router";
import { removePhotos } from "~/features/albums_tags/tags";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/tags/$id/remove")({
  server: {
    handlers: {
      POST: endpoint("user", ({ user, params, request }) => removePhotos(user, params.id, request)),
    },
  },
});
