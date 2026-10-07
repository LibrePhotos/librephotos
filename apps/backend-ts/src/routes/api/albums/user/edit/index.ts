import { createFileRoute } from "@tanstack/react-router";
import { editCreate, editList } from "~/features/albums_tags/user_albums";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/albums/user/edit/")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, request, query }) => editList(user, request, query)),
      POST: endpoint("user", ({ user, request }) => editCreate(user, request)),
    },
  },
});
