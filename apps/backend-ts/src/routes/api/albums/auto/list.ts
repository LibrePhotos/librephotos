import { createFileRoute } from "@tanstack/react-router";
import { list } from "~/features/albums_tags/auto_albums";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/albums/auto/list")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, request, query }) => list(user, request, query)),
    },
  },
});
