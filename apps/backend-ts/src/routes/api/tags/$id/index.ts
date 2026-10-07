import { createFileRoute } from "@tanstack/react-router";
import { detail, remove, saveName } from "~/features/albums_tags/tags";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/tags/$id/")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, params, query }) => detail(user, params.id, query)),
      PUT: endpoint("user", ({ user, params, request }) => saveName(user, params.id, request, false)),
      PATCH: endpoint("user", ({ user, params, request }) => saveName(user, params.id, request, true)),
      DELETE: endpoint("user", ({ user, params }) => remove(user, params.id)),
    },
  },
});
