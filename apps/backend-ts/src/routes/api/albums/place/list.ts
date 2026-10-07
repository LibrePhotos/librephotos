import { createFileRoute } from "@tanstack/react-router";
import { placeList } from "~/features/albums_tags/things_places";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/albums/place/list")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, request, query }) => placeList(user, request, query)),
    },
  },
});
