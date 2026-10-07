import { createFileRoute } from "@tanstack/react-router";
import { sharedFromMe } from "~/features/albums_tags/user_albums";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/albums/user/shared/fromme")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, request, query }) => sharedFromMe(user, request, query)),
    },
  },
});
