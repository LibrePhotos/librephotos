import { createFileRoute } from "@tanstack/react-router";
import { deleteAll } from "~/features/albums_tags/auto_albums";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/albums/auto/delete_all")({
  server: {
    handlers: {
      POST: endpoint("user", ({ user }) => deleteAll(user)),
    },
  },
});
