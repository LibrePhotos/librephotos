import { createFileRoute } from "@tanstack/react-router";
import { thingDetail } from "~/features/albums_tags/things_places";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/albums/thing/$id")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, params, query }) => thingDetail(user, params.id, query)),
    },
  },
});
