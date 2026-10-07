import { createFileRoute } from "@tanstack/react-router";
import { detail, remove, saveTitle } from "~/features/albums_tags/user_albums";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/albums/user/$id")({
  server: {
    handlers: {
      GET: endpoint("optional", ({ user, params, query }) => detail(user, params.id, query)),
      PUT: endpoint("user", ({ user, params, request, query }) => saveTitle(user, params.id, request, query, false)),
      PATCH: endpoint("user", ({ user, params, request, query }) => saveTitle(user, params.id, request, query, true)),
      DELETE: endpoint("user", ({ user, params }) => remove(user, params.id)),
    },
  },
});
