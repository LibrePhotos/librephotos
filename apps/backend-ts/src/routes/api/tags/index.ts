import { createFileRoute } from "@tanstack/react-router";
import { create, list } from "~/features/albums_tags/tags";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/tags/")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, request, query }) => list(user, request, query)),
      POST: endpoint("user", ({ user, request }) => create(user, request)),
    },
  },
});
