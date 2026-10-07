import { createFileRoute } from "@tanstack/react-router";
import { makePublic } from "~/features/albums_tags/user_albums";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/useralbum/makepublic")({
  server: {
    handlers: {
      POST: endpoint("user", ({ user, request }) => makePublic(user, request)),
    },
  },
});
