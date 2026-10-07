import { createFileRoute } from "@tanstack/react-router";
import { share } from "~/features/albums_tags/user_albums";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/useralbum/share")({
  server: {
    handlers: {
      POST: endpoint("user", ({ user, request }) => share(user, request)),
    },
  },
});
