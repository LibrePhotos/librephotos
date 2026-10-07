import { createFileRoute } from "@tanstack/react-router";
import { thingList } from "~/features/albums_tags/things_places";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/albums/thing/list")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, request, query }) => thingList(user, request, query)),
    },
  },
});
