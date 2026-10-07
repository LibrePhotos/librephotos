import { createFileRoute } from "@tanstack/react-router";
import { ownedList } from "~/features/albums_tags/user_albums";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/albums/user/list")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, request, query }) => ownedList(user, request, query)),
    },
  },
});
