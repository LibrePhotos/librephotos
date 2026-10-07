import { createFileRoute } from "@tanstack/react-router";
import { viewsetCreate, viewsetList } from "~/features/albums_tags/user_albums";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/albums/user/")({
  server: {
    handlers: {
      GET: endpoint("optional", ({ user, request, query }) => viewsetList(user, request, query)),
      POST: endpoint("user", ({ user, request, query }) => viewsetCreate(user, request, query)),
    },
  },
});
