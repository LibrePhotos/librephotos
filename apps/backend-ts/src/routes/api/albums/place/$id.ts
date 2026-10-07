import { createFileRoute } from "@tanstack/react-router";
import { placeDetail } from "~/features/albums_tags/things_places";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/albums/place/$id")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, params, query }) => placeDetail(user, params.id, query)),
    },
  },
});
