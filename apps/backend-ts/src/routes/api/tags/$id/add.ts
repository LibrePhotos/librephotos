import { createFileRoute } from "@tanstack/react-router";
import { addPhotos } from "~/features/albums_tags/tags";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/tags/$id/add")({
  server: {
    handlers: {
      POST: endpoint("user", ({ user, params, request }) => addPhotos(user, params.id, request)),
    },
  },
});
