import { createFileRoute } from "@tanstack/react-router";
import { detail, remove } from "~/features/albums_tags/auto_albums";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/albums/auto/$id")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, params }) => detail(user, params.id)),
      DELETE: endpoint("user", ({ user, params }) => remove(user, params.id)),
    },
  },
});
